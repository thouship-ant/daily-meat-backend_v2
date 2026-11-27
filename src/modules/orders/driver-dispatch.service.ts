import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderOffer } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { DomainEvents, DriverOfferCreatedEvent, DriverOpenOrdersEvent } from '../../common/events/domain-events';
import { istMinutesNow, parseClock, startOfIstDay } from '../../common/utils/time';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DriverHubsService } from '../users/driver-hubs.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { ORDER_INCLUDE, OrderWithRelations } from './order.presenter';

/** Delivery slots go in pairs: slots 1-2 are the 1st set, slots 3-4 the 2nd set (same grouping as the driver app) */
const SLOTS_PER_SET = 2;
/** A set's confirmed orders are sent to drivers from this long before its first slot starts (8 AM set -> 7:15 AM) */
const OPEN_BEFORE_MIN = 45;
/** A driver who gives their present at least this long before the set's last slot starts is in that set's queue */
const JOIN_BEFORE_LAST_SLOT_MIN = 30;
/** orders per set for a driver who has not set their own limit */
const DEFAULT_ORDER_LIMIT = 10;
/** How long a driver has to accept an offer before it goes to the next present driver */
const OFFER_TTL_SECONDS = Number(process.env.DRIVER_OFFER_TTL_SECONDS ?? 300);
/** A driver who declined / let an offer run out is not offered the same set again for this long */
const REFUSED_COOLDOWN_MIN = 20;
const TICK_MS = 30_000;

export interface DispatchSet {
  number: number; // 1 = 1st set
  slotIds: string[];
  openAt: number; // minutes after midnight IST
  joinDeadline: number;
  endAt: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymdOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** today's date in IST as YYYY-MM-DD */
const istToday = (now = new Date()) => ymdOf(new Date(now.getTime() + 330 * 60_000));
const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/**
 * Daily attendance and the offering of confirmed orders to present drivers.
 *
 *  - A driver gives their present in the partner app (one row per driver in driver_attendance, valid for that IST day).
 *  - From 45 minutes before a set's first slot, its confirmed (unassigned) orders are OFFERED to the present drivers one
 *    by one, the one who gave their present first first, up to the driver's own limit per set. The driver accepts
 *    (the orders are assigned to them) or declines / lets it run out (the next driver is offered).
 *  - A driver who gave their present too late for a set's queue (less than 30 minutes before its last slot starts), or
 *    any present driver when nobody in the queue can take the orders, sees the open orders of that set and picks them.
 */
@Injectable()
export class DriverDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DriverDispatchService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  /** sets already announced as open to pick today, so drivers are told once */
  private announcedOpen = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly driverHubs: DriverHubsService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // =====================================================================
  // Attendance
  // =====================================================================

  async getAttendance(driverId: string) {
    const row = await this.prisma.driverAttendance.findUnique({ where: { driverId } });
    const present = !!row?.present && !!row.attendanceDate && ymdOf(row.attendanceDate) === istToday();
    return {
      present,
      presentAt: present ? row!.presentAt : null,
      orderLimit: row?.orderLimit ?? DEFAULT_ORDER_LIMIT,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  async setPresent(driverId: string, present: boolean, actorId: string) {
    const today = istToday();
    const row = await this.prisma.driverAttendance.findUnique({ where: { driverId } });
    const alreadyToday = !!row?.present && !!row.attendanceDate && ymdOf(row.attendanceDate) === today;
    const data = present
      ? { present: true, attendanceDate: dateOnly(today), presentAt: alreadyToday ? row!.presentAt : new Date(), updatedBy: actorId }
      : { present: false, updatedBy: actorId };
    await this.prisma.driverAttendance.upsert({
      where: { driverId },
      create: { driverId, ...data },
      update: data,
    });
    if (present && !alreadyToday) void this.tick(); // a set may already be open: offer it without waiting for the next round
    return this.getAttendance(driverId);
  }

  async setOrderLimit(driverId: string, orderLimit: number, actorId: string) {
    await this.prisma.driverAttendance.upsert({
      where: { driverId },
      create: { driverId, orderLimit, updatedBy: actorId },
      update: { orderLimit, updatedBy: actorId },
    });
    return this.getAttendance(driverId);
  }

  // =====================================================================
  // Sets
  // =====================================================================

  /** Today's sets, from the active meat delivery slots (marinades have their own slot and are not dispatched here) */
  async sets(): Promise<DispatchSet[]> {
    const slots = (await this.prisma.deliverySlot.findMany({ where: { isActive: true, kind: 'MEAT' } })).sort(
      (a, b) => parseClock(a.startTime) - parseClock(b.startTime),
    );
    const out: DispatchSet[] = [];
    for (let i = 0; i < slots.length; i += SLOTS_PER_SET) {
      const group = slots.slice(i, i + SLOTS_PER_SET);
      const first = group[0];
      const last = group[group.length - 1];
      out.push({
        number: i / SLOTS_PER_SET + 1,
        slotIds: group.map((s) => s.id),
        openAt: parseClock(first.startTime) - OPEN_BEFORE_MIN,
        joinDeadline: parseClock(last.startTime) - JOIN_BEFORE_LAST_SLOT_MIN,
        endAt: parseClock(last.endTime),
      });
    }
    return out;
  }

  private openSets(sets: DispatchSet[], now = new Date()) {
    const min = istMinutesNow(now);
    return sets.filter((s) => min >= s.openAt && min < s.endAt);
  }

  private instantOf(minutes: number, now = new Date()) {
    return new Date(startOfIstDay(now).getTime() + minutes * 60_000);
  }

  // =====================================================================
  // Pools and capacity
  // =====================================================================

  /** Confirmed, unassigned orders of this set for today that are not inside a live offer */
  private async pool(set: DispatchSet, today: string, now: Date): Promise<OrderWithRelations[]> {
    const live = await this.prisma.orderOffer.findMany({
      where: { deliveryDate: dateOnly(today), setNumber: set.number, status: 'OFFERED', expiresAt: { gt: now } },
      select: { orderIds: true },
    });
    const offered = new Set(live.flatMap((o) => o.orderIds));
    const orders = await this.prisma.order.findMany({
      where: { status: 'CONFIRMED', driverId: null, deliveryDate: dateOnly(today), deliverySlotId: { in: set.slotIds } },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    const rank = new Map(set.slotIds.map((id, i) => [id, i]));
    return orders
      .filter((o) => !offered.has(o.id))
      .sort((a, b) => (rank.get(a.deliverySlotId ?? '') ?? 99) - (rank.get(b.deliverySlotId ?? '') ?? 99));
  }

  /** Orders the driver already carries (or delivered) in this set today */
  private async taken(driverId: string, set: DispatchSet, today: string): Promise<number> {
    return this.prisma.order.count({
      where: {
        driverId,
        deliveryDate: dateOnly(today),
        deliverySlotId: { in: set.slotIds },
        status: { in: ['ASSIGNED', 'PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
      },
    });
  }

  /**
   * Admin assignment must respect the driver's order limit per set too (the offer / pick flows already do).
   * Counts what the driver already carries in each set and day, plus the orders about to be given to them.
   */
  async assertWithinLimit(driverId: string, orderIds: string[]) {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds }, status: { in: ['CONFIRMED', 'ASSIGNED'] } },
      select: { id: true, driverId: true, deliveryDate: true, deliverySlotId: true },
    });
    const incoming = orders.filter((o) => o.driverId !== driverId && o.deliveryDate && o.deliverySlotId);
    if (incoming.length === 0) return;

    const sets = await this.sets();
    const { orderLimit } = await this.getAttendance(driverId);
    const groups = new Map<string, { set: DispatchSet; date: Date; count: number }>();
    for (const o of incoming) {
      const set = sets.find((s) => s.slotIds.includes(o.deliverySlotId!));
      if (!set) continue; // marinades are not part of the sets
      const key = `${ymdOf(o.deliveryDate!)}|${set.number}`;
      const g = groups.get(key) ?? { set, date: o.deliveryDate!, count: 0 };
      g.count++;
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const already = await this.taken(driverId, g.set, ymdOf(g.date));
      if (already + g.count > orderLimit) {
        throw ApiException.badRequest(
          'DRIVER_ORDER_LIMIT',
          `This driver's limit is ${orderLimit} orders per set and ${already} are already assigned in set ${g.set.number}. Choose another driver or ask the driver to raise the limit.`,
        );
      }
    }
  }

  private async forHub(driverId: string, orders: OrderWithRelations[]) {
    const hub = await this.driverHubs.effectiveHubId(driverId);
    return hub == null ? orders : orders.filter((o) => o.hubId == null || o.hubId === hub);
  }

  /** Drivers who gave their present today, earliest first, with their limit */
  private async presentDrivers(today: string) {
    const rows = await this.prisma.driverAttendance.findMany({
      where: { present: true, attendanceDate: dateOnly(today), driver: { isActive: true, role: 'DRIVER' } },
      orderBy: { presentAt: 'asc' },
    });
    return rows.filter((r) => r.presentAt);
  }

  private async refusedDrivers(set: DispatchSet, today: string, now: Date): Promise<Set<string>> {
    const since = new Date(now.getTime() - REFUSED_COOLDOWN_MIN * 60_000);
    const rows = await this.prisma.orderOffer.findMany({
      where: {
        deliveryDate: dateOnly(today),
        setNumber: set.number,
        OR: [
          { status: 'DECLINED', respondedAt: { gt: since } },
          { status: 'EXPIRED', expiresAt: { gt: since } },
        ],
      },
      select: { driverId: true },
    });
    return new Set(rows.map((r) => r.driverId));
  }

  // =====================================================================
  // Offers
  // =====================================================================

  /** One round: expire old offers, offer open sets to the next driver in the queue */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.orderOffer.updateMany({ where: { status: 'OFFERED', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
      const today = istToday(now);
      for (const set of this.openSets(await this.sets(), now)) await this.offerSet(set, today, now);
    } catch (e) {
      this.logger.error(`dispatch round failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async liveOfferExists(set: DispatchSet, today: string, now: Date) {
    return !!(await this.prisma.orderOffer.findFirst({
      where: { deliveryDate: dateOnly(today), setNumber: set.number, status: 'OFFERED', expiresAt: { gt: now } },
      select: { id: true },
    }));
  }

  /** Drivers in the queue of this set who could take some of its orders right now, in queue order */
  private async eligibleQueue(set: DispatchSet, today: string, now: Date, pool: OrderWithRelations[]) {
    const join = this.instantOf(set.joinDeadline, now);
    const refused = await this.refusedDrivers(set, today, now);
    const out: { driverId: string; capacity: number; orders: OrderWithRelations[] }[] = [];
    for (const d of await this.presentDrivers(today)) {
      if (d.presentAt! > join || refused.has(d.driverId)) continue;
      const capacity = d.orderLimit - (await this.taken(d.driverId, set, today));
      if (capacity <= 0) continue;
      const orders = (await this.forHub(d.driverId, pool)).slice(0, capacity);
      if (orders.length) out.push({ driverId: d.driverId, capacity, orders });
    }
    return out;
  }

  private async offerSet(set: DispatchSet, today: string, now: Date) {
    if (await this.liveOfferExists(set, today, now)) return; // one driver at a time
    const pool = await this.pool(set, today, now);
    if (!pool.length) return;
    const next = (await this.eligibleQueue(set, today, now, pool))[0];
    if (!next) {
      // nobody in the queue can take these orders: every present driver may pick them, and is told once
      const key = `${today}:${set.number}`;
      if (!this.announcedOpen.has(key)) {
        this.announcedOpen.add(key);
        const present = await this.presentDrivers(today);
        if (present.length) {
          this.events.emit(DomainEvents.DriverOpenOrders, {
            driverIds: present.map((d) => d.driverId),
            setNumber: set.number,
            count: pool.length,
          } satisfies DriverOpenOrdersEvent);
        }
      }
      return;
    }
    const offer = await this.prisma.orderOffer.create({
      data: {
        driverId: next.driverId,
        deliveryDate: dateOnly(today),
        setNumber: set.number,
        orderIds: next.orders.map((o) => o.id),
        expiresAt: new Date(now.getTime() + OFFER_TTL_SECONDS * 1000),
      },
    });
    this.events.emit(DomainEvents.DriverOfferCreated, {
      driverId: next.driverId,
      offerId: offer.id,
      count: next.orders.length,
      setNumber: set.number,
      expiresAt: offer.expiresAt,
    } satisfies DriverOfferCreatedEvent);
  }

  /** The offer waiting for this driver (if any) with the orders that are still open */
  async currentOffer(driverId: string): Promise<{ offer: OrderOffer; orders: OrderWithRelations[] } | null> {
    const offer = await this.prisma.orderOffer.findFirst({
      where: { driverId, status: 'OFFERED', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!offer) return null;
    const orders = await this.prisma.order.findMany({
      where: { id: { in: offer.orderIds }, status: 'CONFIRMED', driverId: null },
      include: ORDER_INCLUDE,
    });
    if (!orders.length) {
      await this.prisma.orderOffer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } });
      return null;
    }
    return { offer, orders };
  }

  private async ownOffer(driverId: string, offerId: string) {
    const offer = await this.prisma.orderOffer.findFirst({ where: { id: offerId, driverId } });
    if (!offer) throw ApiException.notFound('Offer');
    if (offer.status !== 'OFFERED' || offer.expiresAt <= new Date()) {
      if (offer.status === 'OFFERED') await this.prisma.orderOffer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } });
      throw ApiException.badRequest('OFFER_EXPIRED', 'This offer is no longer open.');
    }
    return offer;
  }

  async accept(driverId: string, offerId: string) {
    const offer = await this.ownOffer(driverId, offerId);
    const result = await this.lifecycle.assignDriver(driverId, offer.orderIds);
    await this.prisma.orderOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
    return result;
  }

  async decline(driverId: string, offerId: string) {
    const offer = await this.ownOffer(driverId, offerId);
    await this.prisma.orderOffer.update({ where: { id: offer.id }, data: { status: 'DECLINED', respondedAt: new Date() } });
    void this.tick(); // the next driver in the queue gets it now
    return { declined: true };
  }

  // =====================================================================
  // Self-pick (late present, or nobody in the queue can take the orders)
  // =====================================================================

  async available(driverId: string): Promise<{ setNumber: number; capacity: number; orders: OrderWithRelations[] }[]> {
    const att = await this.getAttendance(driverId);
    if (!att.present || !att.presentAt) return [];
    const now = new Date();
    const today = istToday(now);
    const out: { setNumber: number; capacity: number; orders: OrderWithRelations[] }[] = [];
    for (const set of this.openSets(await this.sets(), now)) {
      const pool = await this.pool(set, today, now);
      if (!pool.length) continue;
      const late = att.presentAt > this.instantOf(set.joinDeadline, now);
      const queueCanTake = !late && (await this.liveOfferExists(set, today, now));
      const someoneInQueue = (await this.eligibleQueue(set, today, now, pool)).length > 0;
      // the queue goes first: self-pick is for late drivers, or once nobody in the queue can take the orders
      if (!late && (queueCanTake || someoneInQueue)) continue;
      const capacity = att.orderLimit - (await this.taken(driverId, set, today));
      if (capacity <= 0) continue;
      const orders = await this.forHub(driverId, pool);
      if (orders.length) out.push({ setNumber: set.number, capacity, orders });
    }
    return out;
  }

  async claim(driverId: string, orderIds: string[]) {
    const groups = await this.available(driverId);
    const chosen: string[] = [];
    for (const g of groups) {
      const mine = g.orders.filter((o) => orderIds.includes(o.id)).slice(0, g.capacity);
      chosen.push(...mine.map((o) => o.id));
    }
    if (!chosen.length) throw ApiException.badRequest('NOTHING_TO_CLAIM', 'These orders are not open for you to pick.');
    return this.lifecycle.assignDriver(driverId, chosen);
  }
}
