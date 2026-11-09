import { Injectable } from '@nestjs/common';
import { DeliverySlot } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { parseClock } from '../../common/utils/time';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const KEY = 'slots:active';

@Injectable()
export class DeliverySlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Active slots sorted by start time ("9:00 AM" and "09:00" both work). */
  listActive(): Promise<DeliverySlot[]> {
    return this.cache.wrap(KEY, 300, async () => {
      const slots = await this.prisma.deliverySlot.findMany({ where: { isActive: true } });
      return slots.sort((a, b) => parseClock(a.startTime) - parseClock(b.startTime));
    });
  }

  async listAll(): Promise<DeliverySlot[]> {
    const slots = await this.prisma.deliverySlot.findMany();
    return slots.sort((a, b) => parseClock(a.startTime) - parseClock(b.startTime));
  }

  async getActive(id: string): Promise<DeliverySlot> {
    const slot = await this.prisma.deliverySlot.findFirst({ where: { id, isActive: true } });
    if (!slot) throw ApiException.badRequest('SLOT_UNAVAILABLE', 'The selected delivery slot is not available.');
    return slot;
  }

  async create(data: { startTime: string; endTime: string; label: string; isActive?: boolean }) {
    const slot = await this.prisma.deliverySlot.create({ data });
    await this.cache.del(KEY);
    return slot;
  }

  async update(id: string, data: Partial<{ startTime: string; endTime: string; label: string; isActive: boolean }>) {
    const slot = await this.prisma.deliverySlot.update({ where: { id }, data });
    await this.cache.del(KEY);
    return slot;
  }

  async remove(id: string) {
    await this.prisma.deliverySlot.delete({ where: { id } });
    await this.cache.del(KEY);
  }
}
