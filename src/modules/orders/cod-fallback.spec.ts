import { OrderPlacementService } from './order-placement.service';

/** COD above the limit: allowed once, only after exactly one unpaid online attempt. */
function make(unpaid: number, openCod: number) {
  const db: any = {
    order: {
      count: async ({ where }: any) => (where.paymentMethod === 'ONLINE' ? unpaid : openCod),
    },
  };
  const config: any = { get: () => 2000 };
  const svc = new OrderPlacementService(db, null as any, null as any, null as any, null as any, null as any, null as any, config);
  return svc;
}

describe('COD above the limit', () => {
  it('is refused when the customer has not tried to pay online', async () => {
    const r = await make(0, 0).codStatus('u1');
    expect(r).toMatchObject({ fallbackAllowed: false, reason: 'PAY_ONLINE_FIRST' });
  });

  it('is allowed after one failed or pending online payment', async () => {
    const r = await make(1, 0).codStatus('u1');
    expect(r).toMatchObject({ fallbackAllowed: true, reason: 'ALLOWED', limit: 2000 });
  });

  it('is limited to one open order at a time', async () => {
    const r = await make(1, 1).codStatus('u1');
    expect(r).toMatchObject({ fallbackAllowed: false, reason: 'ALREADY_USED' });
  });

  it('asks for another payment type after the online payment failed again', async () => {
    const r = await make(2, 0).codStatus('u1');
    expect(r.fallbackAllowed).toBe(false);
    expect(r.reason).toBe('ONLINE_FAILED_AGAIN');
    expect(r.message).toMatch(/another payment type/);
  });
});
