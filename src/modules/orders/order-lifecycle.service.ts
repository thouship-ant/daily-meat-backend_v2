import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Order, OrderStatus, Prisma } from '@prisma/client';
import { ApiException, ErrorCode } from '../../common/api-error';
import {
  DomainEvents,
  OrderActor,
  OrderCancelledEvent,
  OrderPaidEvent,
  OrdersAssignedEvent,
  OrderStatusChangedEvent,
  OrderSummary,
} from '../../common/events/domain-events';
import { toDateOnly } from '../../common/utils/time';
import { CashfreeGateway } from '../../infrastructure/payments/cashfree.gateway';
import { PrismaService, Tx } from '../../infrastructure/prisma/prisma.service';
import { DriverHubsService } from '../users/driver-hubs.service';
import { ORDER_INCLUDE, OrderWithRelations } from './order.presenter';
import { canTransition } from './order-status';

export type RefundOutcome = 'NOT_REQUIRED' | 'REFUNDED' | 'FAILED';

export interface TransitionOptions {
  reason?: string;
  /** customer id when actor is CUSTOMER (ownership check) */
  customerId?: string;
  /** driver id when actor is DRIVER (ownership check) */
  driverId?: string;
}

export interface TransitionResult {
  order: OrderWithRelations;
  refund: RefundOutcome;
}

/**
 * Everything that CHANGES an existing order: status transitions, cancellation (+refund, coupon release),
 * driver assignment and payment confirmation. It talks to the outside world only via domain events.
 */
@Injectable()
export class OrderLifecycleService {
  private readonly logger = new Logger(OrderLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CashfreeGateway,
    private readonly events: EventEmitter2,
    private readonly driverHubs: DriverHubsService,
  ) {}

  // ---------- status transitions ----------

  async transition(orderId: string, to: OrderStatus, actor: OrderActor, opts: TransitionOptions = {}): Promise<TransitionResult> {
    const current = await this.prisma.order.findUnique({ where: { id: orderId } });
    // 404 (not 403) for orders that belong to someone else, so ids cannot be probed.
    if (!current) throw ApiException.notFound('Order');
    if (actor === 'CUSTOMER' && current.userId !== opts.customerId) throw ApiException.notFound('Order');
    if (actor === 'DRIVER' && current.driverId !== opts.driverId) throw ApiException.notFound('Order');

    if (!canTransition(current.status, to, actor)) {
      throw new ApiException(
        to === 'CANCELLED' ? ErrorCode.ORDER_NOT_CANCELLABLE : ErrorCode.INVALID_STATUS_TRANSITION,
        to === 'CANCELLED'
          ? `Order cannot be cancelled because it is currently ${current.status}.`
          : `Cannot move an order from ${current.status} to ${to}.`,
        400,
        { from: current.status, to },
      );
    }
    if (to === 'FAILED' && !opts.reason?.trim()) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'A reason is required when a delivery fails.');
    }
    if (['PICKED', 'OUT_FOR_DELIVERY'].includes(to) && !current.driverId && actor === 'ADMIN') {
      throw ApiException.badRequest(ErrorCode.INVALID_STATUS_TRANSITION, 'Assign a driver before dispatching this order.');
    }

    const reason = opts.reason?.trim().slice(0, 250) || undefined;
    const data = this.sideEffects(current, to, reason);

    const updatedCount = await this.prisma.$transaction(async (tx) => {
      // Compare-and-set: if another request moved the order meanwhile, nothing is updated.
      const res = await tx.order.updateMany({ where: { id: orderId, status: current.status }, data });
      if (res.count === 1 && to === 'CANCELLED') await this.releaseCoupon(tx, orderId);
      return res.count;
    });
    if (updatedCount !== 1) {
      throw ApiException.conflict('The order was just updated by someone else. Please refresh and try again.');
    }

    let refund: RefundOutcome = 'NOT_REQUIRED';
    if (to === 'CANCELLED') refund = await this.refundIfPaid(current);

    const order = await this.load(orderId);
    const summary = this.summarize(order);

    this.events.emit(DomainEvents.OrderStatusChanged, {
      order: summary,
      previous: current.status,
      actor,
      reason,
    } satisfies OrderStatusChangedEvent);
    if (to === 'CANCELLED') {
      this.events.emit(DomainEvents.OrderCancelled, { order: summary, actor, reason } satisfies OrderCancelledEvent);
    }
    return { order, refund };
  }

  /** Customer cancels their own order. */
  cancelByCustomer(customerId: string, orderId: string, reason?: string) {
    return this.transition(orderId, 'CANCELLED', 'CUSTOMER', { customerId, reason });
  }

  // ---------- driver assignment ----------

  async assignDriver(driverId: string, orderIds: string[], reassign = false) {
    const driver = await this.prisma.user.findFirst({ where: { id: driverId, role: 'DRIVER', isActive: true } });
    if (!driver) throw ApiException.notFound('Driver');

    const statuses: OrderStatus[] = reassign ? ['CONFIRMED', 'ASSIGNED'] : ['CONFIRMED'];
    const found = await this.prisma.order.findMany({ where: { id: { in: orderIds }, status: { in: statuses } } });

    // A driver works for one hub at a time (home hub, or the temporary hub while one is active): they cannot take
    // another hub's orders. Drivers with no hub set, and orders with no hub, are unrestricted.
    const driverHub = await this.driverHubs.effectiveHubId(driverId);
    const candidates = driverHub == null ? found : found.filter((o) => o.hubId == null || o.hubId === driverHub);
    if (found.length > 0 && candidates.length === 0) {
      throw ApiException.badRequest('DRIVER_OTHER_HUB', 'This driver is working for a different hub at the moment, so cannot take these orders.');
    }

    const previousDrivers: Record<string, number> = {};
    for (const o of candidates) {
      if (o.status === 'ASSIGNED' && o.driverId && o.driverId !== driverId) {
        previousDrivers[o.driverId] = (previousDrivers[o.driverId] ?? 0) + 1;
      }
    }

    const ids = candidates.map((o) => o.id);
    await this.prisma.order.updateMany({
      where: { id: { in: ids }, status: { in: statuses } },
      data: { driverId, status: 'ASSIGNED' },
    });

    const assigned = ids.length ? await this.prisma.order.findMany({ where: { id: { in: ids } }, include: ORDER_INCLUDE }) : [];
    if (assigned.length) {
      this.events.emit(DomainEvents.OrdersAssigned, {
        driverId,
        orders: assigned.map((o) => this.summarize(o)),
        previousDrivers,
      } satisfies OrdersAssignedEvent);
    }
    return { assigned: ids, skipped: orderIds.filter((id) => !ids.includes(id)) };
  }

  // ---------- payments ----------

  /** Idempotent: safe to call from both the app's verify call and the webhook. Returns true on the first confirmation. */
  async markPaid(orderId: string): Promise<boolean> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, paymentStatus: { not: 'PAID' }, status: { not: 'CANCELLED' } },
      data: { paymentStatus: 'PAID' },
    });
    if (res.count === 0) return false;
    const order = await this.load(orderId);
    this.events.emit(DomainEvents.OrderPaid, { order: this.summarize(order) } satisfies OrderPaidEvent);
    return true;
  }

  /**
   * An online payment failed / expired / was abandoned. The order is cancelled (not deleted - history and
   * audit stay intact) and any coupon it consumed is released.
   */
  async abandonUnpaid(orderId: string, reason = 'Payment not completed'): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: orderId, paymentMethod: 'ONLINE', paymentStatus: { not: 'PAID' }, status: { in: ['PENDING'] } },
        data: { status: 'CANCELLED', paymentStatus: 'FAILED', failureReason: reason },
      });
      if (res.count) await this.releaseCoupon(tx, orderId);
    });
  }

  /** Customer explicitly discards an unpaid online order from their history. */
  async deleteDraft(customerId: string, orderId: string): Promise<void> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId: customerId } });
    if (!order) throw ApiException.notFound('Order');
    if (order.paymentMethod !== 'ONLINE' || order.paymentStatus === 'PAID') {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Only unpaid online orders can be deleted.');
    }
    // Items and coupon redemption cascade with the order.
    await this.prisma.order.delete({ where: { id: orderId } });
  }

  // ---------- helpers ----------

  load(orderId: string): Promise<OrderWithRelations> {
    return this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
  }

  summarize(o: OrderWithRelations | (Order & { user?: { name: string | null } | null })): OrderSummary {
    return {
      id: o.id,
      userId: o.userId,
      driverId: o.driverId,
      status: o.status,
      customerName: (o as OrderWithRelations).user?.name ?? null,
      address: [o.addressStreet, o.addressCity].filter(Boolean).join(', '),
      schedule: o.deliveryDate && o.deliverySlotLabel
        ? `${toDateOnly(o.deliveryDate)} (${o.deliverySlotLabel})`
        : (o.deliverySlotLabel ?? 'ASAP'),
    };
  }

  private sideEffects(current: Order, to: OrderStatus, reason?: string): Prisma.OrderUpdateManyMutationInput & { driverId?: null } {
    const data: Prisma.OrderUpdateManyMutationInput & { driverId?: null } = { status: to };
    switch (to) {
      case 'DELIVERED':
        data.deliveredAt = new Date();
        if (current.paymentMethod === 'COD') data.paymentStatus = 'PAID'; // cash collected
        break;
      case 'PENDING':
        data.driverId = null;
        data.failureReason = null;
        break;
      case 'CONFIRMED':
        if (current.status === 'ASSIGNED') data.driverId = null; // unassigned
        break;
      case 'CANCELLED':
      case 'FAILED':
        if (reason) data.failureReason = reason;
        break;
    }
    return data;
  }

  private releaseCoupon(tx: Tx, orderId: string) {
    return tx.couponRedemption.deleteMany({ where: { orderId } });
  }

  private async refundIfPaid(order: Order): Promise<RefundOutcome> {
    if (order.paymentMethod !== 'ONLINE' || order.paymentStatus !== 'PAID') return 'NOT_REQUIRED';
    try {
      await this.gateway.refund(order.id, Number(order.totalAmount), `REFUND_${order.id}_${Date.now()}`);
      await this.prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'REFUNDED' } });
      return 'REFUNDED';
    } catch (e) {
      // The order is cancelled regardless; ops must retry the refund manually.
      this.logger.error(`REFUND FAILED for order ${order.id}: ${(e as Error).message}`);
      return 'FAILED';
    }
  }
}
