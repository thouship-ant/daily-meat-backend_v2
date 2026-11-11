import { Injectable } from '@nestjs/common';
import { DeliverySlot, Prisma } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { parseClock } from '../../common/utils/time';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const KEY = 'slots:active';
// Cancelled / failed orders give their place back
const NOT_BOOKING = ['CANCELLED', 'FAILED'] as const;

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

  /**
   * Active slots for one delivery day with how many orders are already booked at the hub, so the app can show
   * "N left" / "Full". `hubId` null = not known (counts every hub together).
   */
  async availability(date: string, hubId: number | null): Promise<(DeliverySlot & { booked: number; remaining: number | null; isFull: boolean })[]> {
    const slots = await this.listActive();
    const rows = await this.prisma.order.groupBy({
      by: ['deliverySlotId'],
      where: { deliveryDate: new Date(`${date}T00:00:00.000Z`), status: { notIn: [...NOT_BOOKING] }, ...(hubId != null ? { hubId } : {}) },
      _count: { _all: true },
    });
    const booked = new Map(rows.map((r) => [r.deliverySlotId, r._count._all]));
    return slots.map((s) => {
      const n = booked.get(s.id) ?? 0;
      const limit = s.maxOrders && s.maxOrders > 0 ? s.maxOrders : null;
      return { ...s, booked: n, remaining: limit == null ? null : Math.max(0, limit - n), isFull: limit != null && n >= limit };
    });
  }

  /**
   * Refuses the order when the slot already holds its maximum for that hub and day. Call inside the order
   * transaction: the advisory lock makes two customers taking the last place at the same moment queue up, so the
   * limit is never exceeded.
   */
  async assertHasRoom(tx: Prisma.TransactionClient, slot: DeliverySlot, deliveryDate: string, hubId: number): Promise<void> {
    const limit = slot.maxOrders && slot.maxOrders > 0 ? slot.maxOrders : null;
    if (limit == null) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`slot:${slot.id}:${deliveryDate}:${hubId}`}))`;
    const booked = await tx.order.count({
      where: { deliverySlotId: slot.id, deliveryDate: new Date(`${deliveryDate}T00:00:00.000Z`), hubId, status: { notIn: [...NOT_BOOKING] } },
    });
    if (booked >= limit) {
      throw ApiException.badRequest('SLOT_FULL', `The ${slot.label} slot is full for that day. Please choose another slot.`);
    }
  }

  async getActive(id: string): Promise<DeliverySlot> {
    const slot = await this.prisma.deliverySlot.findFirst({ where: { id, isActive: true } });
    if (!slot) throw ApiException.badRequest('SLOT_UNAVAILABLE', 'The selected delivery slot is not available.');
    return slot;
  }

  async create(data: { startTime: string; endTime: string; label: string; isActive?: boolean; maxOrders?: number | null }) {
    const slot = await this.prisma.deliverySlot.create({ data });
    await this.cache.del(KEY);
    return slot;
  }

  async update(id: string, data: Partial<{ startTime: string; endTime: string; label: string; isActive: boolean; maxOrders: number | null }>) {
    const slot = await this.prisma.deliverySlot.update({ where: { id }, data });
    await this.cache.del(KEY);
    return slot;
  }

  async remove(id: string) {
    await this.prisma.deliverySlot.delete({ where: { id } });
    await this.cache.del(KEY);
  }
}
