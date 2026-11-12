import { Order } from '@prisma/client';

/** Minutes after "out for delivery" during which a customer can still pay a COD order online. */
export const ONLINE_PAY_GRACE_MINUTES = 5;

/** How many times the customer is asked to retry a failed online payment. */
export const PAYMENT_RETRY_LIMIT = 3;

const PAYABLE_STATUSES = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'PICKED', 'OUT_FOR_DELIVERY'];

export interface OnlinePayState {
  /** the customer may pay this Cash on Delivery order online right now */
  available: boolean;
  /** when the option goes away (only known once the order is out for delivery) */
  closesAt: Date | null;
}

/**
 * A Cash on Delivery order can be paid online until it is out for delivery, plus a short grace period
 * (ONLINE_PAY_GRACE_MINUTES) after it left, after which the driver collects cash as usual.
 */
export function onlinePayState(
  o: Pick<Order, 'paymentMethod' | 'paymentStatus' | 'status' | 'outForDeliveryAt'>,
  now = new Date(),
): OnlinePayState {
  const none = { available: false, closesAt: null };
  // an order above the COD limit whose online payment failed: it is FAILED until it is paid online (with any option)
  if (o.paymentMethod === 'ONLINE' && o.paymentStatus !== 'PAID' && o.status === 'FAILED') return { available: true, closesAt: null };
  if (o.paymentMethod !== 'COD' || o.paymentStatus === 'PAID' || !PAYABLE_STATUSES.includes(o.status)) return none;
  if (o.status !== 'OUT_FOR_DELIVERY') return { available: true, closesAt: null };
  const left = o.outForDeliveryAt ?? now;
  const closesAt = new Date(left.getTime() + ONLINE_PAY_GRACE_MINUTES * 60_000);
  return { available: now < closesAt, closesAt };
}
