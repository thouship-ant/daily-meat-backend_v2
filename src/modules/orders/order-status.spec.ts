import { canTransition, allowedNext } from './order-status';

describe('order state machine', () => {
  it('lets a driver only move forward along their own steps', () => {
    expect(canTransition('ASSIGNED', 'PICKED', 'DRIVER')).toBe(true);
    expect(canTransition('PICKED', 'OUT_FOR_DELIVERY', 'DRIVER')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'DRIVER')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'FAILED', 'DRIVER')).toBe(true);
    expect(canTransition('ASSIGNED', 'DELIVERED', 'DRIVER')).toBe(false);
    expect(canTransition('PENDING', 'CANCELLED', 'DRIVER')).toBe(false);
  });

  it('lets a customer cancel only until the order is on the road', () => {
    for (const s of ['PENDING', 'CONFIRMED', 'ASSIGNED', 'PICKED'] as const) {
      expect(canTransition(s, 'CANCELLED', 'CUSTOMER')).toBe(true);
    }
    for (const s of ['OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED'] as const) {
      expect(canTransition(s, 'CANCELLED', 'CUSTOMER')).toBe(false);
    }
    expect(canTransition('PENDING', 'CONFIRMED', 'CUSTOMER')).toBe(false);
  });

  it('treats DELIVERED and CANCELLED as final, even for admins', () => {
    expect(allowedNext('DELIVERED', 'ADMIN')).toEqual([]);
    expect(allowedNext('CANCELLED', 'ADMIN')).toEqual([]);
    expect(canTransition('DELIVERED', 'PENDING', 'ADMIN')).toBe(false);
  });

  it('allows admins to fast-forward and to re-dispatch a failed delivery', () => {
    expect(canTransition('CONFIRMED', 'DELIVERED', 'ADMIN')).toBe(true);
    expect(canTransition('FAILED', 'PENDING', 'ADMIN')).toBe(true);
    expect(canTransition('PENDING', 'DELIVERED', 'ADMIN')).toBe(false);
  });

  it('rejects no-op transitions', () => {
    expect(canTransition('PENDING', 'PENDING', 'ADMIN')).toBe(false);
  });
});
