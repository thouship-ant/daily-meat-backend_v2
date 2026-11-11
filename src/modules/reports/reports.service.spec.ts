import { ReportsService } from './reports.service';

// A period of 3 India-time days: 2026-11-10 .. 2026-11-12
const D = (s: string) => new Date(s);

function make() {
  let orderFindMany = 0;
  const prisma: any = {
    order: {
      findMany: async () => {
        orderFindMany += 1;
        if (orderFindMany === 1) {
          // delivered: two on 11-10 (IST), one without deliveredAt booked on 11-11
          return [
            { deliveredAt: D('2026-11-10T06:00:00Z'), createdAt: D('2026-11-10T04:00:00Z'), totalAmount: 300, totalProfit: 60, deliveryCharge: 20, discountAmount: 10 },
            { deliveredAt: D('2026-11-10T17:00:00Z'), createdAt: D('2026-11-10T10:00:00Z'), totalAmount: 200.5, totalProfit: 40, deliveryCharge: 0, discountAmount: 0 },
            { deliveredAt: null, createdAt: D('2026-11-11T05:00:00Z'), totalAmount: 100, totalProfit: 20, deliveryCharge: 10, discountAmount: 5 },
          ];
        }
        if (orderFindMany === 2) {
          // placed: u1 twice, u2 once, u3 once (u3 registered in the period)
          return [
            { createdAt: D('2026-11-10T04:00:00Z'), userId: 'u1' },
            { createdAt: D('2026-11-10T10:00:00Z'), userId: 'u1' },
            { createdAt: D('2026-11-11T05:00:00Z'), userId: 'u2' },
            { createdAt: D('2026-11-12T05:00:00Z'), userId: 'u3' },
          ];
        }
        return [{ userId: 'u1' }]; // u1 also ordered before the period -> repeat customer
      },
      count: async () => 1, // cancelled
    },
    user: {
      findMany: async () => [
        { id: 'u3', createdAt: D('2026-11-12T02:00:00Z') },
        { id: 'u9', createdAt: D('2026-11-12T03:00:00Z') },
      ],
      count: async (arg: any) => {
        const w = JSON.stringify(arg.where);
        if (w.includes('lastLoginAt') && w.includes('"none"')) return 4; // logged in, no order
        if (w.includes('lastActiveAt') && w.includes('"none"')) return 6; // active, no order
        if (w.includes('lastLoginAt')) return 10;
        if (w.includes('lastActiveAt')) return 15;
        if (w.includes('pushToken')) return 80;
        if (w.includes('"none":{}')) return 1; // registered, never ordered
        return 100; // total customers
      },
    },
  };
  const hubs: any = { customerScope: async () => undefined };
  return new ReportsService(prisma, hubs);
}

describe('ReportsService.report', () => {
  it('rolls up sales, orders and customer KPIs for a custom period', async () => {
    const r = await make().report('custom', '2026-11-10', '2026-11-12');

    expect(r.period).toMatchObject({ from: '2026-11-10', to: '2026-11-12', days: 3 });
    expect(r.sales).toEqual({
      grossSales: 600.5,
      deliveredOrders: 3,
      avgOrderValue: 200.17,
      avgDailySales: 200.17,
      netProfit: 120,
      deliveryFees: 30,
      discounts: 15,
    });
    expect(r.orders).toEqual({ placed: 4, cancelled: 1, cancelRate: 25 });
    expect(r.users).toEqual({
      totalCustomers: 100,
      registered: 2,
      loggedIn: 10,
      active: 15,
      orderedUsers: 3,
      loggedInNotOrdered: 4,
      activeNotOrdered: 6,
      newUsersOrdered: 1, // u3
      registeredNeverOrdered: 1,
      repeatCustomers: 1, // u1
      pushEnabled: 80,
    });
  });

  it('has one row per India-time day, with sales on the day delivered', async () => {
    const { daily } = await make().report('custom', '2026-11-10', '2026-11-12');
    expect(daily).toEqual([
      { date: '2026-11-10', sales: 500.5, delivered: 2, placed: 2, newUsers: 0 },
      { date: '2026-11-11', sales: 100, delivered: 1, placed: 1, newUsers: 0 },
      { date: '2026-11-12', sales: 0, delivered: 0, placed: 1, newUsers: 2 },
    ]);
  });

  it('rejects a missing or over-long range', async () => {
    await expect(make().report('custom')).rejects.toThrow();
    await expect(make().report('custom', '2026-01-01', '2026-11-12')).rejects.toThrow(/92 days/);
    await expect(make().report('custom', '2026-11-12', '2026-11-10')).rejects.toThrow();
  });
});
