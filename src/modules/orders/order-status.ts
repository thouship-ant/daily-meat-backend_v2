import { OrderStatus } from '@prisma/client';
import { OrderActor } from '../../common/events/domain-events';

/**
 * The order state machine - the single source of truth for who may move an order where.
 * (v1 let an admin set any status from any status, e.g. DELIVERED -> PENDING.)
 *
 *   PENDING -> CONFIRMED -> ASSIGNED -> PICKED -> OUT_FOR_DELIVERY -> DELIVERED
 *                                                         \-> FAILED -> PENDING (re-dispatch)
 *   any state before OUT_FOR_DELIVERY -> CANCELLED
 */
const BASE: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PENDING', 'ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['CONFIRMED', 'PICKED', 'CANCELLED'],
  PICKED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  FAILED: ['PENDING'],
  DELIVERED: [],
  CANCELLED: [],
};

/** Admins may also fast-forward (e.g. mark a hand-delivered order DELIVERED without driver taps). */
const ADMIN_EXTRA: Partial<Record<OrderStatus, OrderStatus[]>> = {
  CONFIRMED: ['PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  ASSIGNED: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  PICKED: ['DELIVERED'],
};

const DRIVER: Partial<Record<OrderStatus, OrderStatus[]>> = {
  ASSIGNED: ['PICKED'],
  PICKED: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
};

/** Customers may cancel until the order is on the road. */
const CUSTOMER_CANCELLABLE: OrderStatus[] = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'PICKED'];

export const ACTIVE_DELIVERY_STATUSES: OrderStatus[] = ['ASSIGNED', 'PICKED', 'OUT_FOR_DELIVERY'];
export const OPEN_STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'PICKED', 'OUT_FOR_DELIVERY'];
export const FINAL_STATUSES: OrderStatus[] = ['DELIVERED', 'CANCELLED', 'FAILED'];

export function canTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  if (from === to) return false;
  switch (actor) {
    case 'ADMIN':
    case 'SYSTEM':
      return BASE[from].includes(to) || !!ADMIN_EXTRA[from]?.includes(to);
    case 'DRIVER':
      return !!DRIVER[from]?.includes(to);
    case 'CUSTOMER':
      return to === 'CANCELLED' && CUSTOMER_CANCELLABLE.includes(from);
  }
}

export function allowedNext(from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return (Object.keys(BASE) as OrderStatus[]).filter((to) => canTransition(from, to, actor));
}
