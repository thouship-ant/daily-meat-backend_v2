import { Coupon } from '@prisma/client';
import { toMoney } from '../../common/utils/money';

export enum CouponReason {
  NOT_FOUND = 'NOT_FOUND',
  INACTIVE = 'INACTIVE',
  EXPIRED = 'EXPIRED',
  NOT_STARTED = 'NOT_STARTED',
  ORDER_TOO_LOW = 'ORDER_TOO_LOW',
  ORDER_TOO_HIGH = 'ORDER_TOO_HIGH',
  NOT_FOR_EXISTING_USERS = 'NOT_FOR_EXISTING_USERS',
  USED_ALREADY = 'USED_ALREADY',
  USER_LIMIT_REACHED = 'USER_LIMIT_REACHED',
  LIMIT_REACHED = 'LIMIT_REACHED',
}

export interface CouponContext {
  now: Date;
  orderTotal: number;
  /** orders the user already placed (for "new users only") */
  priorOrders: number;
  userRedemptions: number;
  totalRedemptions: number;
}

export type CouponCheck =
  | { valid: true; discountAmount: number; payableTotal: number }
  | { valid: false; reason: CouponReason; message: string };

const fail = (reason: CouponReason, message: string): CouponCheck => ({ valid: false, reason, message });

/** Pure coupon eligibility + discount maths. No I/O, so it is trivially unit-testable. */
export function checkCoupon(coupon: Coupon, ctx: CouponContext): CouponCheck {
  const total = toMoney(ctx.orderTotal);

  if (!coupon.isActive) return fail(CouponReason.INACTIVE, 'Coupon is inactive.');
  if (coupon.startAt && coupon.startAt > ctx.now) return fail(CouponReason.NOT_STARTED, 'Coupon is not active yet.');
  if (coupon.endAt && coupon.endAt < ctx.now) return fail(CouponReason.EXPIRED, 'Coupon has expired.');

  const min = coupon.minOrderAmount != null ? toMoney(coupon.minOrderAmount) : null;
  const max = coupon.maxOrderAmount != null ? toMoney(coupon.maxOrderAmount) : null;
  if (min != null && total < min) return fail(CouponReason.ORDER_TOO_LOW, `Order total must be at least ${min}.`);
  if (max != null && total > max) return fail(CouponReason.ORDER_TOO_HIGH, `Order total must be at most ${max}.`);

  if (coupon.audienceType === 'new_users_only' && ctx.priorOrders > 0) {
    return fail(CouponReason.NOT_FOR_EXISTING_USERS, 'Coupon is only valid for new customers.');
  }
  if (coupon.autoHideAfterUse && ctx.userRedemptions > 0) {
    return fail(CouponReason.USED_ALREADY, 'Coupon has already been used.');
  }
  if (coupon.perUserLimit != null && ctx.userRedemptions >= coupon.perUserLimit) {
    return fail(CouponReason.USER_LIMIT_REACHED, 'Redemption limit reached for this coupon.');
  }
  if (coupon.totalRedemptionLimit != null && ctx.totalRedemptions >= coupon.totalRedemptionLimit) {
    return fail(CouponReason.LIMIT_REACHED, 'Coupon redemption limit reached.');
  }

  let discount: number;
  if (coupon.discountType === 'flat') {
    discount = toMoney(coupon.discountValue);
  } else {
    discount = toMoney((total * toMoney(coupon.discountValue)) / 100);
    if (coupon.maxDiscountAmount != null) discount = Math.min(discount, toMoney(coupon.maxDiscountAmount));
  }
  discount = Math.min(discount, total);

  return { valid: true, discountAmount: discount, payableTotal: toMoney(total - discount) };
}

export type CouponStatus = 'active' | 'inactive' | 'scheduled' | 'expired' | 'limit_reached';

export function couponStatus(coupon: Coupon, totalRedemptions: number, now = new Date()): CouponStatus {
  if (!coupon.isActive) return 'inactive';
  if (coupon.startAt && coupon.startAt > now) return 'scheduled';
  if (coupon.endAt && coupon.endAt < now) return 'expired';
  if (coupon.totalRedemptionLimit != null && totalRedemptions >= coupon.totalRedemptionLimit) return 'limit_reached';
  return 'active';
}
