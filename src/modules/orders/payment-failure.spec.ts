import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderPlacementService } from './order-placement.service';
import { onlinePayState, PAYMENT_RETRY_LIMIT } from './cod-online-payment';

/** In-memory single order standing in for the database. */
function make(order: any, codMax = 3000) {
  const row: any = { id: 'o1', userId: 'u1', driverId: null, addressStreet: 's', addressCity: 'c', deliveryDate: null, deliverySlotLabel: null, outForDeliveryAt: null, paymentAttempts: 0, ...order };
  const emitted: string[] = [];
  const apply = (data: any) => Object.assign(row, data);
  const prisma: any = {
    order: {
      findUniqueOrThrow: async () => ({ ...row }),
      update: async ({ data }: any) => { apply(data); return { ...row }; },
      updateMany: async ({ where, data }: any) => {
        const ok =
          (where.paymentMethod === undefined || where.paymentMethod === row.paymentMethod) &&
          (where.status === undefined || where.status === row.status) &&
          (where.paymentStatus?.not === undefined || where.paymentStatus.not !== row.paymentStatus);
        if (ok) apply(data);
        return { count: ok ? 1 : 0 };
      },
    },
  };
  const events: any = { emit: (name: string) => emitted.push(name) };
  const config: any = { get: (k: string) => (k === 'COD_MAX_AMOUNT' ? codMax : undefined) };
  const svc = new OrderLifecycleService(prisma, null as any, events, null as any, config);
  (svc as any).load = async () => ({ ...row });
  return { svc, row, emitted };
}

const online = (total: number) => ({ paymentMethod: 'ONLINE', paymentStatus: 'PENDING', status: 'PENDING', totalAmount: total });

describe('online payment failed', () => {
  it('up to the COD limit the same order carries on as COD, PENDING, "COD - Pending", and the admins are told', async () => {
    const { svc, row, emitted } = make(online(2500));
    const r = await svc.onlinePaymentFailed('o1');
    expect(r).toMatchObject({ outcome: 'COD', attempts: 1, retriesLeft: PAYMENT_RETRY_LIMIT - 1 });
    expect(row).toMatchObject({ paymentMethod: 'COD', paymentStatus: 'PENDING', status: 'PENDING' });
    expect(emitted).toContain('order.placed');
  });

  it('exactly the limit still counts as COD', async () => {
    const { svc, row } = make(online(3000));
    expect((await svc.onlinePaymentFailed('o1')).outcome).toBe('COD');
    expect(row.paymentMethod).toBe('COD');
  });

  it('counts the retries (3 asked) and stays COD', async () => {
    const { svc } = make(online(1000));
    const a = await svc.onlinePaymentFailed('o1');
    const b = await svc.onlinePaymentFailed('o1');
    const c = await svc.onlinePaymentFailed('o1');
    const d = await svc.onlinePaymentFailed('o1');
    expect([a.retriesLeft, b.retriesLeft, c.retriesLeft, d.retriesLeft]).toEqual([2, 1, 0, 0]);
    expect(d.outcome).toBe('COD');
  });

  it('above the limit the order is FAILED (not cancelled) with payment FAILED, and can be paid online', async () => {
    const { svc, row, emitted } = make(online(3500));
    const r = await svc.onlinePaymentFailed('o1');
    expect(r.outcome).toBe('FAILED');
    expect(row).toMatchObject({ status: 'FAILED', paymentStatus: 'FAILED', paymentMethod: 'ONLINE' });
    expect(emitted).not.toContain('order.placed'); // nothing for the admins yet: it is not confirmed
    expect(onlinePayState(row).available).toBe(true);
  });

  it('paying a FAILED order online moves it to PENDING and PAID', async () => {
    const { svc, row, emitted } = make(online(3500));
    await svc.onlinePaymentFailed('o1');
    expect(await svc.markPaid('o1')).toBe(true);
    expect(row).toMatchObject({ status: 'PENDING', paymentStatus: 'PAID', failureReason: null });
    expect(emitted).toContain('order.paid');
  });

  it('a gateway expiry (webhook) does not use up one of the customer retries', async () => {
    const { svc, row } = make(online(3500));
    await svc.onlinePaymentFailed('o1', { countAttempt: false });
    expect(row.paymentAttempts).toBe(0);
  });

  it('never touches a paid or cancelled order', async () => {
    expect((await make({ ...online(100), paymentStatus: 'PAID' }).svc.onlinePaymentFailed('o1')).outcome).toBe('PAID');
    expect((await make({ ...online(100), status: 'CANCELLED' }).svc.onlinePaymentFailed('o1')).outcome).toBe('NONE');
  });
});

describe('COD limit at checkout', () => {
  const placement = (limit: number) => {
    const config: any = { get: () => limit };
    return new OrderPlacementService({} as any, null as any, null as any, null as any, null as any, null as any, null as any, config);
  };
  it('the old pay-online-first exception is gone: a plain limit, default Rs. 3000', async () => {
    const r = await placement(3000).codStatus('u1');
    expect(r).toMatchObject({ limit: 3000, fallbackAllowed: false });
  });
});
