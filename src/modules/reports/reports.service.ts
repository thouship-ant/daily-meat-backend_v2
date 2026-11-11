import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { istRange, startOfIstDay } from '../../common/utils/time';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HubsService } from '../hubs/hubs.service';
import { ADMIN_VISIBLE } from '../orders/order-query.service';
import { NOT_DELETED_ACCOUNT } from '../users/user.mapper';

const DAY_MS = 86_400_000;
const IST_MS = 5.5 * 3600_000;
const MAX_DAYS = 92;
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

export interface DailyRow {
  date: string; // YYYY-MM-DD (India time)
  sales: number; // delivered orders' total
  delivered: number;
  placed: number;
  newUsers: number;
}

/**
 * Admin reports: sales and customer-activity KPIs for a period (India time), for all hubs or one.
 * Sales follow the dashboard's rules (delivered orders, counted on the day they were delivered); the customer KPIs
 * use the account's registration, last login and last app-open times.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hubs: HubsService,
  ) {}

  async report(filter: string | undefined, startDate?: string, endDate?: string, hubId?: number) {
    const range = istRange(filter ?? 'week', startDate, endDate);
    if (!range) throw ApiException.badRequest('INVALID_DATE_RANGE', 'Pick a period (today, week, month) or both dates.');
    const end = range.end ?? new Date(startOfIstDay().getTime() + DAY_MS); // open ended = up to the end of today
    const days = Math.round((end.getTime() - range.start.getTime()) / DAY_MS);
    if (days < 1) throw ApiException.badRequest('INVALID_DATE_RANGE', 'The end date cannot be before the start date.');
    if (days > MAX_DAYS) throw ApiException.badRequest('INVALID_DATE_RANGE', `Pick at most ${MAX_DAYS} days at a time.`);

    const instant: Prisma.DateTimeFilter = { gte: range.start, lt: end };
    const orderBase: Prisma.OrderWhereInput = { AND: [ADMIN_VISIBLE, ...(hubId != null ? [{ hubId }] : [])] };
    const scope = await this.hubs.customerScope(hubId);
    const customers: Prisma.UserWhereInput = { AND: [{ role: 'CUSTOMER' }, NOT_DELETED_ACCOUNT, ...(scope ? [scope] : [])] };
    const noOrderInPeriod: Prisma.UserWhereInput = { orders: { none: { AND: [orderBase, { createdAt: instant }] } } };

    const [
      deliveredRows,
      placedRows,
      cancelled,
      registeredRows,
      loggedIn,
      active,
      totalCustomers,
      pushEnabled,
      loggedInNotOrdered,
      activeNotOrdered,
      registeredNeverOrdered,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { AND: [orderBase, { status: 'DELIVERED' }, { OR: [{ deliveredAt: instant }, { deliveredAt: null, createdAt: instant }] }] },
        select: { deliveredAt: true, createdAt: true, totalAmount: true, totalProfit: true, deliveryCharge: true, discountAmount: true },
      }),
      this.prisma.order.findMany({ where: { AND: [orderBase, { createdAt: instant }] }, select: { createdAt: true, userId: true } }),
      this.prisma.order.count({ where: { AND: [orderBase, { status: 'CANCELLED' }, { updatedAt: instant }] } }),
      this.prisma.user.findMany({ where: { AND: [customers, { createdAt: instant }] }, select: { id: true, createdAt: true } }),
      this.prisma.user.count({ where: { AND: [customers, { lastLoginAt: instant }] } }),
      this.prisma.user.count({ where: { AND: [customers, { lastActiveAt: instant }] } }),
      this.prisma.user.count({ where: customers }),
      this.prisma.user.count({ where: { AND: [customers, { pushToken: { not: null } }, { NOT: { pushToken: '' } }] } }),
      this.prisma.user.count({ where: { AND: [customers, { lastLoginAt: instant }, noOrderInPeriod] } }),
      this.prisma.user.count({ where: { AND: [customers, { lastActiveAt: instant }, noOrderInPeriod] } }),
      this.prisma.user.count({ where: { AND: [customers, { createdAt: instant }, { orders: { none: {} } }] } }),
    ]);

    // --- customers who placed an order in the period ---
    const orderedIds = new Set(placedRows.map((o) => o.userId));
    const registeredIds = new Set(registeredRows.map((u) => u.id));
    const newUsersOrdered = [...orderedIds].filter((id) => registeredIds.has(id)).length;
    const ids = [...orderedIds];
    const returning = ids.length
      ? await this.prisma.order.findMany({
          where: { AND: [ADMIN_VISIBLE, { userId: { in: ids } }, { createdAt: { lt: range.start } }] },
          select: { userId: true },
          distinct: ['userId'],
        })
      : [];

    // --- sales ---
    const sum = (pick: (r: (typeof deliveredRows)[number]) => unknown) =>
      money(deliveredRows.reduce((s, r) => s + Number(pick(r) ?? 0), 0));
    const grossSales = sum((r) => r.totalAmount);
    const deliveredCount = deliveredRows.length;

    // --- one row per day ---
    const daily = new Map<string, DailyRow>();
    for (let i = 0; i < days; i++) {
      const date = istDay(new Date(range.start.getTime() + i * DAY_MS));
      daily.set(date, { date, sales: 0, delivered: 0, placed: 0, newUsers: 0 });
    }
    for (const r of deliveredRows) {
      const row = daily.get(istDay(r.deliveredAt ?? r.createdAt));
      if (row) {
        row.sales += Number(r.totalAmount);
        row.delivered += 1;
      }
    }
    for (const o of placedRows) {
      const row = daily.get(istDay(o.createdAt));
      if (row) row.placed += 1;
    }
    for (const u of registeredRows) {
      const row = daily.get(istDay(u.createdAt));
      if (row) row.newUsers += 1;
    }
    const series = [...daily.values()].map((r) => ({ ...r, sales: money(r.sales) }));

    return {
      period: { filter: filter ?? 'week', from: istDay(range.start), to: istDay(new Date(end.getTime() - 1)), days, hubId: hubId ?? null },
      sales: {
        grossSales,
        deliveredOrders: deliveredCount,
        avgOrderValue: deliveredCount ? money(grossSales / deliveredCount) : 0,
        avgDailySales: money(grossSales / days),
        netProfit: sum((r) => r.totalProfit),
        deliveryFees: sum((r) => r.deliveryCharge),
        discounts: sum((r) => r.discountAmount),
      },
      orders: {
        placed: placedRows.length,
        cancelled,
        cancelRate: placedRows.length ? Math.round((cancelled / placedRows.length) * 1000) / 10 : 0, // percent, 1 decimal
      },
      users: {
        totalCustomers,
        registered: registeredRows.length,
        loggedIn, // customers whose latest sign-in falls in the period
        active, // customers whose app was opened in the period
        orderedUsers: orderedIds.size,
        loggedInNotOrdered,
        activeNotOrdered,
        newUsersOrdered,
        registeredNeverOrdered,
        repeatCustomers: returning.length,
        pushEnabled,
      },
      daily: series,
    };
  }
}
