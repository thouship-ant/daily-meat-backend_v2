import { DriverDispatchService } from './driver-dispatch.service';

const SLOTS = [
  { id: 's1', startTime: '08:00 AM', endTime: '09:00 AM', isActive: true, kind: 'MEAT' },
  { id: 's2', startTime: '09:30 AM', endTime: '10:30 AM', isActive: true, kind: 'MEAT' },
  { id: 's3', startTime: '11:00 AM', endTime: '12:00 PM', isActive: true, kind: 'MEAT' },
  { id: 's4', startTime: '12:00 PM', endTime: '01:00 PM', isActive: true, kind: 'MEAT' },
];

/** 2026-11-26 at the given IST time as a Date */
const at = (hh: number, mm: number) => new Date(Date.UTC(2026, 10, 26, hh, mm) - 330 * 60_000);

function build(opts: { attendance: any[]; orders: any[]; taken?: Record<string, number> }) {
  const offers: any[] = [];
  const prisma: any = {
    deliverySlot: { findMany: async () => SLOTS },
    driverAttendance: { findMany: async () => opts.attendance },
    orderOffer: {
      updateMany: async () => ({ count: 0 }),
      findMany: async ({ where }: any) => offers.filter((o) => where.status === o.status || !where.status),
      findFirst: async () => offers.find((o) => o.status === 'OFFERED') ?? null,
      create: async ({ data }: any) => {
        const o = { id: `offer${offers.length + 1}`, status: 'OFFERED', respondedAt: null, ...data };
        offers.push(o);
        return o;
      },
    },
    order: {
      findMany: async () => opts.orders,
      count: async ({ where }: any) => opts.taken?.[where.driverId] ?? 0,
    },
  };
  const emitted: any[] = [];
  const svc = new DriverDispatchService(
    prisma,
    {} as any,
    { effectiveHubId: async () => null } as any,
    { emit: (_e: string, payload: any) => emitted.push(payload) } as any,
  );
  return { svc, offers, emitted };
}

const order = (id: string, slot = 's1') => ({ id, deliverySlotId: slot, hubId: null, createdAt: new Date() });
const driver = (id: string, h: number, m: number, limit = 10) => ({ driverId: id, present: true, presentAt: at(h, m), orderLimit: limit });

describe('DriverDispatchService', () => {
  it('groups the slots in pairs and opens a set 45 minutes before its first slot', async () => {
    const { svc } = build({ attendance: [], orders: [] });
    const sets = await svc.sets();
    expect(sets.map((s) => [s.number, s.openAt, s.joinDeadline, s.endAt])).toEqual([
      [1, 7 * 60 + 15, 9 * 60, 10 * 60 + 30], // set 1 opens 7:15, queue closes 9:00 (30 min before the 9:30 slot)
      [2, 10 * 60 + 15, 11 * 60 + 30, 13 * 60], // set 2 opens 10:15
    ]);
  });

  it('does nothing before the set opens', async () => {
    const { svc, offers } = build({ attendance: [driver('a', 7, 0)], orders: [order('o1')] });
    await svc.tick(at(7, 10));
    expect(offers).toHaveLength(0);
  });

  it('offers the orders to the driver who gave their present first, up to their limit', async () => {
    const { svc, offers, emitted } = build({
      attendance: [driver('first', 6, 50, 2), driver('second', 7, 5)],
      orders: [order('o1'), order('o2'), order('o3')],
    });
    await svc.tick(at(7, 16));
    expect(offers).toHaveLength(1);
    expect(offers[0].driverId).toBe('first');
    expect(offers[0].orderIds).toEqual(['o1', 'o2']); // the limit is 2
    expect(offers[0].setNumber).toBe(1);
    expect(emitted[0]).toMatchObject({ driverId: 'first', count: 2, setNumber: 1 });
  });

  it('skips a driver who is already full for the set', async () => {
    const { svc, offers } = build({
      attendance: [driver('full', 6, 50, 3), driver('next', 7, 5)],
      orders: [order('o1')],
      taken: { full: 3 },
    });
    await svc.tick(at(7, 20));
    expect(offers[0].driverId).toBe('next');
  });

  it('leaves out a driver who gave their present after the queue closed (self-pick instead)', async () => {
    const { svc, offers } = build({ attendance: [driver('late', 9, 10)], orders: [order('o1')] });
    await svc.tick(at(9, 15));
    expect(offers).toHaveLength(0); // 9:10 is later than 9:00 (30 min before the 9:30 slot)
  });

  it('keeps one live offer per set at a time', async () => {
    const { svc, offers } = build({ attendance: [driver('a', 6, 50), driver('b', 7, 0)], orders: [order('o1')] });
    await svc.tick(at(7, 20));
    await svc.tick(at(7, 21));
    expect(offers).toHaveLength(1);
  });
});
