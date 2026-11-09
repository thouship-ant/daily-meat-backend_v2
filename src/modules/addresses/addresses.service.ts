import { Injectable } from '@nestjs/common';
import { Address } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { distanceKm } from '../../common/utils/geo';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HubsService } from '../hubs/hubs.service';

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
  ) {}

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
    const hub = await this.hubs.findForPincode(pincode);
    const updated = await this.prisma.address.update({
      where: { id },
      data: { ...input, isDeliverable: !!hub },
    });
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
