import { onlinePayState } from './cod-online-payment';
import { OnlinePayWindowJob } from './online-pay-window.job';

const now = new Date('2026-11-13T10:00:00Z');
const base: any = { paymentMethod: 'COD', paymentStatus: 'PENDING', status: 'CONFIRMED', outForDeliveryAt: null };

describe('paying a COD order online', () => {
  it.each(['PENDING', 'CONFIRMED', 'ASSIGNED', 'PICKED'])('is open while the order is %s', (status) => {
    expect(onlinePayState({ ...base, status }, now)).toEqual({ available: true, closesAt: null });
  });

  it('stays open for 5 minutes after the order is out for delivery, then closes', () => {
    const left = new Date(now.getTime() - 4 * 60_000);
    const open = onlinePayState({ ...base, status: 'OUT_FOR_DELIVERY', outForDeliveryAt: left }, now);
    expect(open.available).toBe(true);
    expect(open.closesAt).toEqual(new Date(left.getTime() + 5 * 60_000));
    const late = new Date(now.getTime() - 6 * 60_000);
    expect(onlinePayState({ ...base, status: 'OUT_FOR_DELIVERY', outForDeliveryAt: late }, now).available).toBe(false);
  });

  it('is closed for paid, online, delivered and cancelled orders', () => {
    expect(onlinePayState({ ...base, paymentStatus: 'PAID' }, now).available).toBe(false);
    expect(onlinePayState({ ...base, paymentMethod: 'ONLINE' }, now).available).toBe(false);
    expect(onlinePayState({ ...base, status: 'DELIVERED' }, now).available).toBe(false);
    expect(onlinePayState({ ...base, status: 'CANCELLED' }, now).available).toBe(false);
  });
});

describe('OnlinePayWindowJob', () => {
  it('tells the driver once per order', async () => {
    const claimed = new Set<string>();
    const emitted: any[] = [];
    const prisma: any = {
      order: {
        findMany: async () => [{ id: 'A' }, { id: 'B' }],
        updateMany: async ({ where }: any) => {
          if (claimed.has(where.id)) return { count: 0 };
          claimed.add(where.id);
          return { count: 1 };
        },
      },
    };
    const lifecycle: any = {
      load: async (id: string) => ({ id, totalAmount: 450 }),
      summarize: (o: any) => ({ id: o.id, driverId: 'd1' }),
    };
    const events: any = { emit: (name: string, payload: any) => emitted.push([name, payload]) };
    const job = new OnlinePayWindowJob(prisma, lifecycle, events);
    expect(await job.run(now)).toBe(2);
    expect(await job.run(now)).toBe(0); // already told
    expect(emitted).toHaveLength(2);
    expect(emitted[0][1]).toMatchObject({ amount: 450, order: { id: 'A', driverId: 'd1' } });
  });
});
