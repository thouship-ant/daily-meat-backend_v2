import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException, ErrorCode } from '../../common/api-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HubsService } from '../hubs/hubs.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface DriverInterestInput {
  name: string;
  phone: string;
  email: string;
  hubId?: number;
  locality: string;
  city: string;
  pincode: string;
}

/**
 * Requests from people who want to become delivery partners while onboarding is on hold. Daily Meat contacts them by
 * SMS / e-mail when their hub needs drivers. One request per mobile number: asking again updates it.
 */
@Injectable()
export class DriverInterestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hubs: HubsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The hubs a person can choose from: name, the pincodes it serves and its opening hours (nothing private) */
  async hubChoices() {
    return (await this.hubs.listActive()).map((h) => ({
      id: h.id,
      name: h.name,
      pincodes: h.deliverablePincodes,
      deliveryRadiusKm: h.deliveryRadiusKm,
      storeStartTime: h.storeStartTime,
      storeCloseTime: h.storeCloseTime,
    }));
  }

  /** Has this mobile number already asked to become a delivery partner? (nothing else about the request is revealed) */
  async isRegistered(phone: string): Promise<boolean> {
    return (await this.prisma.driverInterest.count({ where: { phone } })) > 0;
  }

  async submit(input: DriverInterestInput) {
    // already a delivery partner: nothing to register
    const user = await this.prisma.user.findFirst({ where: { phone: input.phone } });
    if (user && (user.role === 'DRIVER' || user.additionalRoles.includes('DRIVER'))) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'This number is already registered as a delivery partner. Please sign in.');
    }
    let hubId: number | null = null;
    if (input.hubId != null) {
      const hub = await this.prisma.hub.findFirst({ where: { id: input.hubId, isActive: true }, select: { id: true } });
      if (!hub) throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Please choose one of the listed hubs.');
      hubId = hub.id;
    }
    const data = { name: input.name, email: input.email, hubId, locality: input.locality, city: input.city, pincode: input.pincode };
    // asking again makes it unread and "not contacted" again
    await this.prisma.driverInterest.upsert({
      where: { phone: input.phone },
      update: { ...data, notifiedAt: null, seenAt: null },
      create: { phone: input.phone, ...data },
    });
    void this.notifications
      .toHubAdmins(hubId, {
        title: 'New delivery partner interest',
        body: `${input.name} (${input.locality}, ${input.city}) wants to become a delivery partner.`,
        data: { type: 'DRIVER_INTEREST', route: 'driver_applications' },
        event: 'driverApplication',
      })
      .catch(() => undefined);
  }

  // ---------- admin ----------

  async adminList(q: { hubId?: number; skip: number; take: number }) {
    const where: Prisma.DriverInterestWhereInput = q.hubId ? { hubId: q.hubId } : {};
    const [items, total] = await Promise.all([
      this.prisma.driverInterest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.take, include: { hub: { select: { id: true, name: true } } } }),
      this.prisma.driverInterest.count({ where }),
    ]);
    return { items, total };
  }

  /** Requests no admin has opened yet */
  unreadCount(hubId?: number | null) {
    return this.prisma.driverInterest.count({ where: { seenAt: null, ...(hubId != null ? { hubId } : {}) } });
  }

  /** An admin opened the request: it is no longer unread (first opening wins) */
  async markSeen(id: string) {
    await this.prisma.driverInterest.updateMany({ where: { id, seenAt: null }, data: { seenAt: new Date() } });
  }

  async markNotified(id: string) {
    const row = await this.prisma.driverInterest.findUnique({ where: { id } });
    if (!row) throw ApiException.notFound('Request');
    return this.prisma.driverInterest.update({ where: { id }, data: { notifiedAt: new Date(), seenAt: row.seenAt ?? new Date() } });
  }
}
