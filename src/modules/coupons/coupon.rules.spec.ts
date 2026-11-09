import { Coupon } from '@prisma/client';
import { checkCoupon, CouponContext, CouponReason } from './coupon.rules';

const base = (over: Partial<Coupon> = {}): Coupon =>
  ({
    id: 'c1',
    code: 'SAVE',
    title: 't',
    description: null,
    discountType: 'percent',
    discountValue: 10,
    maxDiscountAmount: null,
    minOrderAmount: null,
    maxOrderAmount: null,
    startAt: null,
    endAt: null,
    isActive: true,
    visibility: 'public',
    audienceType: 'all_users',
    totalRedemptionLimit: null,
    perUserLimit: 1,
    autoHideAfterUse: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as unknown as Coupon;

const ctx = (over: Partial<CouponContext> = {}): CouponContext => ({
  now: new Date('2026-11-08T10:00:00Z'),
  orderTotal: 500,
  priorOrders: 0,
  userRedemptions: 0,
  totalRedemptions: 0,
  ...over,
});

describe('checkCoupon', () => {
  it('computes percent discounts and caps them', () => {
    expect(checkCoupon(base(), ctx())).toMatchObject({ valid: true, discountAmount: 50, payableTotal: 450 });
    expect(checkCoupon(base({ maxDiscountAmount: 30 as any }), ctx())).toMatchObject({ discountAmount: 30 });
  });

  it('never discounts more than the order total', () => {
    const r = checkCoupon(base({ discountType: 'flat', discountValue: 999 as any }), ctx({ orderTotal: 200 }));
    expect(r).toMatchObject({ valid: true, discountAmount: 200, payableTotal: 0 });
  });

  it('enforces order amount bounds', () => {
    expect(checkCoupon(base({ minOrderAmount: 600 as any }), ctx())).toMatchObject({ valid: false, reason: CouponReason.ORDER_TOO_LOW });
    expect(checkCoupon(base({ maxOrderAmount: 400 as any }), ctx())).toMatchObject({ valid: false, reason: CouponReason.ORDER_TOO_HIGH });
  });

  it('enforces the validity window and active flag', () => {
    expect(checkCoupon(base({ isActive: false }), ctx())).toMatchObject({ reason: CouponReason.INACTIVE });
    expect(checkCoupon(base({ startAt: new Date('2026-12-01') }), ctx())).toMatchObject({ reason: CouponReason.NOT_STARTED });
    expect(checkCoupon(base({ endAt: new Date('2026-01-01') }), ctx())).toMatchObject({ reason: CouponReason.EXPIRED });
  });

  it('enforces audience and usage limits', () => {
    expect(checkCoupon(base({ audienceType: 'new_users_only' }), ctx({ priorOrders: 2 }))).toMatchObject({ reason: CouponReason.NOT_FOR_EXISTING_USERS });
    expect(checkCoupon(base({ autoHideAfterUse: true }), ctx({ userRedemptions: 1 }))).toMatchObject({ reason: CouponReason.USED_ALREADY });
    expect(checkCoupon(base({ perUserLimit: 2 }), ctx({ userRedemptions: 2 }))).toMatchObject({ reason: CouponReason.USER_LIMIT_REACHED });
    expect(checkCoupon(base({ totalRedemptionLimit: 5 }), ctx({ totalRedemptions: 5 }))).toMatchObject({ reason: CouponReason.LIMIT_REACHED });
  });
});
