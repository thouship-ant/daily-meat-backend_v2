jest.mock('expo-server-sdk', () => ({ Expo: class {} })); // ESM-only package pulled in through the push service

import { dueJobs, istParts, PromoRemindersService, slotOf } from './promo-reminders.service';

// IST = UTC + 5:30. 2026-11-15 is a Sunday, 2026-11-16 a Monday, 2026-11-18 a Wednesday.
const ist = (ymdHm: string) => new Date(`${ymdHm}:00+05:30`);
const TOKEN = (n: string) => `ExponentPushToken[${n}]`;

describe('reminder schedule (IST)', () => {
  it('reads the IST day, hour and weekday', () => {
    expect(istParts(ist('2026-11-15T23:59'))).toEqual({ ymd: '2026-11-15', hour: 23, minute: 59, dow: 0 });
    expect(istParts(new Date('2026-11-15T19:00:00Z')).ymd).toBe('2026-11-16'); // 00:30 IST next day
  });

  it('promo reminders run on Sun / Wed / Fri only', () => {
    expect(dueJobs(ist('2026-11-15T07:00'))).toEqual([{ type: 'promo', group: 'morning', slot: 0 }]);
    expect(dueJobs(ist('2026-11-18T07:55'))).toEqual([{ type: 'promo', group: 'morning', slot: 5 }]);
    expect(dueJobs(ist('2026-11-16T07:00'))).toEqual([]); // Monday
  });

  it('new-customer offers run 10:30 - 11:30 in six slots', () => {
    expect(dueJobs(ist('2026-11-15T10:29'))).toEqual([]);
    expect(dueJobs(ist('2026-11-15T10:30'))).toEqual([{ type: 'promo', group: 'late', slot: 0 }]);
    expect(dueJobs(ist('2026-11-15T11:00'))).toEqual([{ type: 'promo', group: 'late', slot: 3 }]);
    expect(dueJobs(ist('2026-11-15T11:29'))).toEqual([{ type: 'promo', group: 'late', slot: 5 }]);
    expect(dueJobs(ist('2026-11-15T11:30'))).toEqual([]);
  });

  it("tomorrow's plan runs every day at 7 PM and 10 PM", () => {
    expect(dueJobs(ist('2026-11-16T19:00'))).toEqual([{ type: 'tomorrow' }]);
    expect(dueJobs(ist('2026-11-16T22:05'))).toEqual([{ type: 'tomorrow' }]);
    expect(dueJobs(ist('2026-11-16T20:00'))).toEqual([]);
  });

  it('gives each customer a fixed slot 0..5', () => {
    const slot = slotOf('3bd060e6-68ea-4834-9155-c1af456dedf0');
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(6);
    expect(slotOf('3bd060e6-68ea-4834-9155-c1af456dedf0')).toBe(slot);
  });
});

function make(opts: { flags?: Record<string, unknown>; customers?: any[]; todays?: any[]; tomorrows?: any[]; logs?: any[] } = {}) {
  const sent: any[][] = [];
  const created: any[] = [];
  let orderCall = 0;
  const prisma: any = {
    user: { findMany: async () => opts.customers ?? [] },
    order: { findMany: async () => (orderCall++ === 0 ? opts.todays ?? [] : opts.tomorrows ?? []) },
    promoNotificationLog: {
      findMany: async () => opts.logs ?? [],
      createMany: async (a: any) => { created.push(...a.data); },
    },
  };
  const push: any = { sendEach: async (items: any[]) => { sent.push(items); return items.length; } };
  const config: any = { get: (k: string) => opts.flags?.[k] };
  const svc = new PromoRemindersService(prisma, push, {} as any, config);
  return { svc, sent, created };
}

const customer = (id: string, token = TOKEN(id)) => ({ id, pushToken: token, createdAt: new Date('2026-01-01') });

describe("Tomorrow's plan", () => {
  const now = ist('2026-11-16T19:00');

  it('asks customers with no order today, skips those with a live order or one booked for tomorrow', async () => {
    const { svc, sent, created } = make({
      customers: [customer('a'), customer('b'), customer('c'), customer('d'), customer('e', '')],
      todays: [{ userId: 'b', status: 'DELIVERED' }, { userId: 'c', status: 'CANCELLED' }],
      tomorrows: [{ userId: 'd' }],
    });
    const r = await svc.runTomorrowPlan({ now });
    expect(r.counts).toEqual({ noorder: 1, cancelled: 1 });
    expect(r.reminders.map((x) => x.userId).sort()).toEqual(['a', 'c']); // b has an order, d is planned, e has no device
    expect(sent[0].map((m) => m.title)).toEqual(expect.arrayContaining(["Plan tomorrow's meals 🍗", "Plan tomorrow's order 🥩"]));
    expect(created.map((l) => l.kind)).toEqual(['tomorrow19', 'tomorrow19']);
  });

  it('a customer whose only order today was cancelled-then-reordered counts as having an order', async () => {
    const { svc } = make({
      customers: [customer('c')],
      todays: [{ userId: 'c', status: 'CANCELLED' }, { userId: 'c', status: 'PENDING' }],
    });
    expect((await svc.runTomorrowPlan({ now, dryRun: true })).reminders).toHaveLength(0);
  });

  it('TOMORROW_PLAN_ALL_CUSTOMERS=false sends only to customers who cancelled', async () => {
    for (const value of [false, 'false']) {
      const { svc } = make({
        flags: { TOMORROW_PLAN_ALL_CUSTOMERS: value },
        customers: [customer('a'), customer('c')],
        todays: [{ userId: 'c', status: 'CANCELLED' }],
      });
      const r = await svc.runTomorrowPlan({ now, dryRun: true });
      expect(r.reminders.map((x) => x.userId)).toEqual(['c']);
    }
  });

  it('does not send twice in the same run', async () => {
    const { svc } = make({
      customers: [customer('a')],
      logs: [{ userId: 'a', sentOn: new Date('2026-11-16T00:00:00Z'), kind: 'tomorrow19', messageKey: 'x' }],
    });
    expect((await svc.runTomorrowPlan({ now })).sent).toBe(0);
  });

  it('dry run sends and logs nothing', async () => {
    const { svc, sent, created } = make({ customers: [customer('a')] });
    const r = await svc.runTomorrowPlan({ now, dryRun: true });
    expect(r).toMatchObject({ sent: 0, counts: { noorder: 1 } });
    expect(sent).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
});

describe('tick() and the env flags', () => {
  const tomorrowAt7pm = ist('2026-11-16T19:00');

  it('runs tomorrow-plan once per run, even when ticked every minute', async () => {
    const { svc, sent } = make({ customers: [customer('a')] });
    await svc.tick(tomorrowAt7pm);
    await svc.tick(ist('2026-11-16T19:01'));
    expect(sent).toHaveLength(1);
  });

  it('TOMORROW_PLAN_REMINDER_ENABLED=false stops it', async () => {
    const { svc, sent } = make({ flags: { TOMORROW_PLAN_REMINDER_ENABLED: false }, customers: [customer('a')] });
    await svc.tick(tomorrowAt7pm);
    expect(sent).toHaveLength(0);
  });

  it('PROMO_REMINDERS_ENABLED=false stops promo reminders but not the tomorrow plan', async () => {
    const { svc, sent } = make({ flags: { PROMO_REMINDERS_ENABLED: 'false' }, customers: [customer('a')] });
    const promo = jest.spyOn(svc, 'runPromoReminders');
    await svc.tick(ist('2026-11-15T07:00'));
    expect(promo).not.toHaveBeenCalled();
    await svc.tick(tomorrowAt7pm);
    expect(sent).toHaveLength(1);
  });

  it('PROMO_REMINDERS_ENABLED on (default) runs the promo job for that group and slot', async () => {
    const { svc } = make();
    const promo = jest.spyOn(svc, 'runPromoReminders').mockResolvedValue({ sent: 0, reminders: [] } as any);
    await svc.tick(ist('2026-11-15T07:20'));
    expect(promo).toHaveBeenCalledWith(expect.objectContaining({ group: 'morning', slot: 2 }));
  });

  it('MARKETING_PUSH_ENABLED=false stops everything', async () => {
    const { svc, sent } = make({ flags: { MARKETING_PUSH_ENABLED: false }, customers: [customer('a')] });
    const promo = jest.spyOn(svc, 'runPromoReminders');
    await svc.tick(ist('2026-11-15T07:00'));
    await svc.tick(tomorrowAt7pm);
    expect(promo).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
