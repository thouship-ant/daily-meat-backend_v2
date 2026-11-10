import { Injectable } from '@nestjs/common';
import { Address } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { distanceKm } from '../../common/utils/geo';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { validateStreet } from '../../common/utils/address-check';
import { HubsService } from '../hubs/hubs.service';
import { ApprovedAddressesService } from './approved-addresses.service';

export interface AddressInput {
  title: string;
  street: string;
  city: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

export interface AddressWithDelivery {
  address: Address;
  isDeliverable: boolean;
  hubId: number | null;
  distanceKm: number | null;
}

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hubs: HubsService,
    private readonly approved: ApprovedAddressesService,
  ) {}

  /** The street line must be a full address (door no., street, building / floor, area), unless an admin approved it. */
  private async assertStreetComplete(street: string, city: string, pincode: string) {
    const problem = validateStreet(String(street ?? ''));
    if (problem && !(await this.approved.isApproved(street, city, pincode))) {
      throw ApiException.badRequest('INCOMPLETE_ADDRESS', problem);
    }
  }

  list(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(userId: string, id: string): Promise<Address> {
    const address = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!address) throw ApiException.notFound('Address');
    return address;
  }

  async create(userId: string, input: AddressInput): Promise<AddressWithDelivery> {
    await this.assertStreetComplete(input.street, input.city, input.pincode);
    const hub = await this.hubs.findForPincode(input.pincode);
    const created = await this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      return tx.address.create({
        data: { ...input, userId, isDeliverable: !!hub, isDefault: count === 0 },
      });
    });
    return this.withDelivery(created, hub);
  }

  async update(userId: string, id: string, input: Partial<AddressInput>): Promise<AddressWithDelivery> {
    const existing = await this.get(userId, id);
    const pincode = input.pincode ?? existing.pincode;
    if (input.street !== undefined) {
      await this.assertStreetComplete(input.street, input.city ?? existing.city, pincode);
    }
    const hub = await this.hubs.findForPincode(pincode);
    const updated = await this.prisma.address.update({
      where: { id },
      data: { ...input, isDeliverable: !!hub },
    });

    // Orders still waiting for delivery that were placed with this address (same street, city and pincode as it was
    // before the edit) now carry the corrected address too, so the driver and the admin see the fixed one.
    try {
      await this.prisma.order.updateMany({
        where: {
          userId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          addressStreet: existing.street,
          addressCity: existing.city,
          addressPincode: existing.pincode,
        },
        data: {
          addressTitle: updated.title,
          addressStreet: updated.street,
          addressCity: updated.city,
          addressPincode: updated.pincode,
          addressLatitude: updated.latitude,
          addressLongitude: updated.longitude,
          addressChangeRequestedAt: null,
        },
      });
    } catch {
      // the address itself is saved; open orders keep the old text
    }
    return this.withDelivery(updated, hub);
  }

  async remove(userId: string, id: string): Promise<void> {
    const address = await this.get(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });
      if (address.isDefault) {
        const next = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  async setDefault(userId: string, id: string): Promise<Address> {
    await this.get(userId, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: { isDefault: true } });
    });
  }

  private withDelivery(address: Address, hub: Awaited<ReturnType<HubsService['findForPincode']>>): AddressWithDelivery {
    return {
      address,
      isDeliverable: !!hub,
      hubId: hub?.id ?? null,
      distanceKm: hub ? Math.round(distanceKm(address.latitude, address.longitude, hub.latitude, hub.longitude) * 100) / 100 : null,
    };
  }
}
