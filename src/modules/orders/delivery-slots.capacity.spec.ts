import { DeliverySlotsService } from './delivery-slots.service';

/** How many orders one hub takes for a slot on one day (Manage Delivery Slots -> max orders). */
describe('DeliverySlotsService capacity', () => {
  const slot = (over: Partial<any> = {}) => ({ id: 's1', label: 'Morning: 9 AM - 11 AM', startTime: '09:00', endTime: '11:00', isActive: true, maxOrders: 2, ...over });

  const make = (booked: number, slots: any[] = [slot()]) => {
    const calls: any = { count: [], lock: 0 };
    const tx: any = {
      $executeRaw: async () => void (calls.lock += 1),
      order: { count: async (args: any) => (calls.count.push(args), booked) },
    };
    const prisma: any = {
      deliverySlot: { findMany: async () => slots },
      order: { groupBy: async () => [{ deliverySlotId: 's1', _count: { _all: booked } }] },
    };
    const cache: any = { wrap: async (_k: string, _t: number, f: any) => f(), del: async () => undefined };
    return { service: new DeliverySlotsService(prisma, cache), tx, calls };
  };

  it('accepts an order while there is room', async () => {
    const { service, tx, calls } = make(1);
    await expect(service.assertHasRoom(tx, slot() as any, '2026-11-13', 1)).resolves.toBeUndefined();
    expect(calls.lock).toBe(1); // serialised with other orders for the same slot/day/hub
    expect(calls.count[0].where).toMatchObject({ deliverySlotId: 's1', hubId: 1, status: { notIn: ['CANCELLED', 'FAILED'] } });
  });

  it('refuses the order that would exceed the limit, with a SLOT_FULL code', async () => {
    const { service, tx } = make(2);
    await expect(service.assertHasRoom(tx, slot() as any, '2026-11-13', 1)).rejects.toMatchObject({ code: 'SLOT_FULL' });
  });

  it('no limit (null or 0) never refuses and does not even count', async () => {
    for (const maxOrders of [null, 0]) {
      const { service, tx, calls } = make(999);
      await expect(service.assertHasRoom(tx, slot({ maxOrders }) as any, '2026-11-13', 1)).resolves.toBeUndefined();
      expect(calls.count).toHaveLength(0);
    }
  });

  it('availability shows what is left per slot and marks a full one', async () => {
    const { service } = make(2, [slot(), slot({ id: 's2', maxOrders: null, startTime: '11:00' })]);
    const list = await service.availability('2026-11-13', 1);
    expect(list[0]).toMatchObject({ id: 's1', booked: 2, remaining: 0, isFull: true });
    expect(list[1]).toMatchObject({ id: 's2', remaining: null, isFull: false });
  });

  it('availability for a half-booked slot reports the places left', async () => {
    const { service } = make(1);
    expect((await service.availability('2026-11-13', 1))[0]).toMatchObject({ booked: 1, remaining: 1, isFull: false });
  });
});
