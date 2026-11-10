import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { distanceKm } from '../../common/utils/geo';
import { DateRange, istRange, startOfIstDay } from '../../common/utils/time';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ORDER_INCLUDE, OrderWithRelations } from './order.presenter';
import { ACTIVE_DELIVERY_STATUSES, OPEN_STATUSES } from './order-status';

export interface AdminOrderFilter {
  status?: OrderStatus;
  hubId?: number;
  driverId?: string;
  period?: string; // today | week | month | custom
  startDate?: string;
  endDate?: string;
  q?: string;
  skip: number;
  take: number;
}

/** Orders the admin should see: COD, paid/refunded online, and online orders still waiting for payment. */
export const ADMIN_VISIBLE: Prisma.OrderWhereInput = {
  OR: [
    { paymentMethod: { not: 'ONLINE' } },
    { paymentStatus: { in: ['PAID', 'REFUNDED'] } },
    { paymentMethod: 'ONLINE', paymentStatus: 'PENDING', status: 'PENDING' },
  ],
};

const istDateString = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Read side of orders. Writes live in the placement / lifecycle services. */
@Injectable()
export class OrderQueryService {
  constructor(private readonly prisma: PrismaService) {}

  // =====================================================================
  // Customer
  // =====================================================================

  async listForCustomer(userId: string, skip: number, take: number, status?: OrderStatus) {
    const where: Prisma.OrderWhereInput = { userId, ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  /** Delivered orders this customer placed before `before` (the admin order page: "N previous orders"). */
  countDeliveredBefore(userId: string, before: Date) {
    return this.prisma.order.count({ where: { userId, status: 'DELIVERED', createdAt: { lt: before } } });
  }

  async getForCustomer(userId: string, id: string): Promise<OrderWithRelations> {
    const order = await this.prisma.order.findFirst({ where: { id, userId }, include: ORDER_INCLUDE });
    if (!order) throw ApiException.notFound('Order');
    return order;
  }

  // =====================================================================
  // Admin
  // =====================================================================

  async listForAdmin(f: AdminOrderFilter) {
    const and: Prisma.OrderWhereInput[] = [ADMIN_VISIBLE];
    const range = istRange(f.startDate && f.endDate ? 'custom' : f.period, f.startDate, f.endDate);
    if (range) and.push(this.statusAwareDate(range));
    if (f.q) {
      const q = f.q.trim();
      and.push({
        OR: [
          { id: { contains: q, mode: 'insensitive' } },
          { user: { phone: { contains: q } } },
          { user: { name: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }
    const where: Prisma.OrderWhereInput = {
      AND: and,
      ...(f.status ? { status: f.status } : {}),
      ...(f.hubId ? { hubId: f.hubId } : {}),
      ...(f.driverId ? { driverId: f.driverId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: f.skip,
        take: f.take,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  async getForAdmin(id: string): Promise<OrderWithRelations> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw ApiException.notFound('Order');
    return order;
  }

  /**
   * Delivered orders count on the day they were delivered, cancelled ones on the day they were cancelled,
   * everything else on the day it was booked or scheduled for.
   */
  statusAwareDate(range: DateRange): Prisma.OrderWhereInput {
    const instant: Prisma.DateTimeFilter = range.end ? { gte: range.start, lt: range.end } : { gte: range.start };
    const day: Prisma.DateTimeFilter = range.end
      ? { gte: asDate(istDateString(range.start)), lt: asDate(istDateString(range.end)) }
      : { gte: asDate(istDateString(range.start)) };
    const bookedOrScheduled: Prisma.OrderWhereInput = { OR: [{ createdAt: instant }, { deliveryDate: day }] };
    return {
      OR: [
        { status: 'DELIVERED', OR: [{ deliveredAt: instant }, { deliveredAt: null, ...bookedOrScheduled }] },
        { status: 'CANCELLED', updatedAt: instant },
        { status: { notIn: ['DELIVERED', 'CANCELLED'] }, ...bookedOrScheduled },
      ],
    };
  }

  async dashboard(period: string | undefined, startDate?: string, endDate?: string) {
    const range = istRange(period, startDate, endDate);
    const visible = ADMIN_VISIBLE;
    const instant = (r: DateRange): Prisma.DateTimeFilter => (r.end ? { gte: r.start, lt: r.end } : { gte: r.start });

    const deliveredWhere: Prisma.OrderWhereInput = {
      AND: [visible, { status: 'DELIVERED' }, ...(range ? [{ OR: [{ deliveredAt: instant(range) }, { deliveredAt: null, createdAt: instant(range) }] }] : [])],
    };
    const totalWhere: Prisma.OrderWhereInput = { AND: [visible, ...(range ? [this.statusAwareDate(range)] : [])] };
    const tomorrow = new Date(Date.now() + (5.5 + 24) * 3600_000).toISOString().slice(0, 10);

    const [delivered, total, pending, active, cancelled, upcoming, recent] = await Promise.all([
      this.prisma.order.aggregate({
        where: deliveredWhere,
        _sum: { totalAmount: true, totalProfit: true, deliveryCharge: true },
        _count: { _all: true },
      }),
      this.prisma.order.count({ where: totalWhere }),
      this.prisma.order.count({ where: { AND: [visible, { status: 'PENDING' }] } }),
      this.prisma.order.count({ where: { AND: [visible, { status: { in: ACTIVE_DELIVERY_STATUSES } }] } }),
      this.prisma.order.count({
        where: { AND: [visible, { status: 'CANCELLED' }, ...(range ? [{ updatedAt: instant(range) }] : [])] },
      }),
      this.prisma.order.count({
        where: { AND: [visible, { status: { in: OPEN_STATUSES } }, { deliveryDate: { gte: asDate(tomorrow) } }] },
      }),
      this.prisma.order.findMany({ where: totalWhere, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);

    return {
      revenue: {
        grossSales: Number(delivered._sum.totalAmount ?? 0),
        netProfit: Number(delivered._sum.totalProfit ?? 0),
        totalDeliveryFees: Number(delivered._sum.deliveryCharge ?? 0),
      },
      orders: { total, pending, active, completed: delivered._count._all, cancelled, upcoming },
      recent,
    };
  }

  /** Nearby open orders and drivers who could take this one along (same area, not yet on the road). */
  async assignmentSuggestions(orderId: string, radiusKm = 5) {
    const target = await this.getForAdmin(orderId);
    if (target.addressLatitude == null || target.addressLongitude == null) {
      throw ApiException.badRequest('NO_COORDINATES', 'This order has no coordinates, so nearby suggestions are unavailable.');
    }
    const lat = Number(target.addressLatitude);
    const lng = Number(target.addressLongitude);

    const [others, busy, drivers] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: { in: ['CONFIRMED', 'ASSIGNED', 'PICKED'] }, id: { not: orderId }, addressLatitude: { not: null } },
        include: { driver: { select: { id: true, name: true, phone: true } } },
      }),
      this.prisma.order.findMany({ where: { status: 'OUT_FOR_DELIVERY', driverId: { not: null } }, select: { driverId: true }, distinct: ['driverId'] }),
      this.prisma.user.findMany({ where: { role: 'DRIVER', isActive: true }, select: { id: true, name: true, phone: true } }),
    ]);
    const busyIds = new Set(busy.map((b) => b.driverId));

    const nearbyUnassignedOrders: Array<{ orderId: string; distanceKm: number; address: string }> = [];
    const nearbyActiveDrivers: Array<{ driver: { id: string; name: string | null; phone: string | null }; distanceKm: number; activeOrderId: string }> = [];
    const seen = new Set<string>();

    for (const o of others) {
      const d = distanceKm(lat, lng, Number(o.addressLatitude), Number(o.addressLongitude));
      if (d > radiusKm) continue;
      const rounded = Math.round(d * 100) / 100;
      if (o.status === 'CONFIRMED') {
        nearbyUnassignedOrders.push({ orderId: o.id, distanceKm: rounded, address: `${o.addressStreet}, ${o.addressCity}` });
      } else if (o.driver && !busyIds.has(o.driver.id) && !seen.has(o.driver.id)) {
        seen.add(o.driver.id);
        nearbyActiveDrivers.push({ driver: o.driver, distanceKm: rounded, activeOrderId: o.id });
      }
    }
    nearbyUnassignedOrders.sort((a, b) => a.distanceKm - b.distanceKm);
    nearbyActiveDrivers.sort((a, b) => a.distanceKm - b.distanceKm);

    return {
      nearbyUnassignedOrders,
      nearbyActiveDrivers,
      freeDrivers: drivers.filter((d) => !busyIds.has(d.id)),
    };
  }

  // =====================================================================
  // Driver
  // =====================================================================

  activeForDriver(driverId: string) {
    return this.prisma.order.findMany({
      where: { driverId, status: { in: ACTIVE_DELIVERY_STATUSES } },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async completedForDriver(driverId: string, skip: number, take: number) {
    const where: Prisma.OrderWhereInput = { driverId, status: { in: ['DELIVERED', 'FAILED'] } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { updatedAt: 'desc' }, skip, take }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  async getForDriver(driverId: string, id: string): Promise<OrderWithRelations> {
    const order = await this.prisma.order.findFirst({ where: { id, driverId }, include: ORDER_INCLUDE });
    if (!order) throw ApiException.notFound('Order');
    return order;
  }

  async driverStats(driverId: string) {
    const today = startOfIstDay();
    const weekStart = new Date(today.getTime() - 6 * 86_400_000);

    const [todayByStatus, deliveredWeek] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: { driverId, updatedAt: { gte: today } },
        _count: { _all: true },
      }),
      this.prisma.order.findMany({
        where: { driverId, status: 'DELIVERED', deliveredAt: { gte: weekStart } },
        select: { deliveredAt: true },
      }),
    ]);
    const count = (s: OrderStatus) => todayByStatus.find((r) => r.status === s)?._count._all ?? 0;

    const dayKey = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const perDay = new Map<string, number>();
    for (const o of deliveredWeek) {
      const k = dayKey(o.deliveredAt!);
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    const weekly = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getTime() + (i - 6) * 86_400_000);
      const key = dayKey(new Date(d.getTime() + 1000));
      return {
        date: key,
        day: new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        count: perDay.get(key) ?? 0,
      };
    });

    return {
      today: {
        assigned: count('ASSIGNED'),
        picked: count('PICKED'),
        outForDelivery: count('OUT_FOR_DELIVERY'),
        delivered: count('DELIVERED'),
      },
      weekly,
    };
  }
}
