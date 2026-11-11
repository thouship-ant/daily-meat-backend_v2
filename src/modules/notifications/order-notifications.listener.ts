import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CodOnlinePaymentClosedEvent,
  CodOrderPaidOnlineEvent,
  DomainEvents,
  DriverArrivedEvent,
  AddressUpdateRequestedEvent,
  OrderAddressChangedEvent,
  OrderCancelledEvent,
  OrderPaidEvent,
  OrderPlacedEvent,
  OrdersAssignedEvent,
  OrderStatusChangedEvent,
  OrderSummary,
} from '../../common/events/domain-events';
import { NotificationsService } from './notifications.service';

/**
 * Turns order domain events into notifications. This is the ONLY place that knows which message goes to
 * whom - the orders module never imports notifications. Add a channel (SMS, WhatsApp...) here, not in orders.
 */
@Injectable()
export class OrderNotificationsListener {
  constructor(private readonly notifications: NotificationsService) {}

  private adminPayload(o: OrderSummary) {
    return { route: 'admin_order', orderId: o.id, customerName: o.customerName ?? 'Customer', address: o.address, schedule: o.schedule };
  }

  @OnEvent(DomainEvents.OrderPlaced)
  async onPlaced({ order }: OrderPlacedEvent) {
    await this.notifications.toAdmins({
      title: `New Order #${String(order.id).slice(0, 8)}`,
      body: `A new order has been placed and is awaiting assignment. ${order.schedule ?? ''}`.trim(),
      data: this.adminPayload(order),
      event: 'adminNewOrder',
    });
  }

  @OnEvent(DomainEvents.AddressUpdateRequested)
  async onAddressUpdateRequested(e: AddressUpdateRequestedEvent) {
    await this.notifications.toUser(e.userId, {
      title: 'Please update your delivery address',
      body: e.message,
      data: { type: 'ADDRESS_UPDATE_REQUIRED', route: 'customer_order', orderId: e.orderId },
      event: 'orderStatusChanged',
    });
  }

  @OnEvent(DomainEvents.OrderAddressChanged)
  async onAddressChanged({ order }: OrderAddressChangedEvent) {
    await this.notifications.toAdmins({
      title: 'Delivery address changed',
      body: `Order #${String(order.id).slice(0, 8)}: the customer changed the delivery address.`,
      data: { route: 'admin_order', orderId: order.id },
      event: 'adminOrderStatusChanged',
    });
  }

  @OnEvent(DomainEvents.OrderPaid)
  async onPaid({ order }: OrderPaidEvent) {
    await this.notifications.toAdmins({
      title: `New Paid Order #${String(order.id).slice(0, 8)}`,
      body: `A new ONLINE order has been placed and paid successfully. ${order.schedule ?? ''}`.trim(),
      data: this.adminPayload(order),
      event: 'adminNewOrder',
    });
  }

  /**
   * A placed COD order was paid online. Nobody is delivering it yet (pending / confirmed): tell the hub's admins.
   * A driver already has it (assigned, picked up, out for delivery): tell that driver the payment details.
   */
  @OnEvent(DomainEvents.CodOrderPaidOnline)
  async onCodPaidOnline({ order, hubId, amount, reference }: CodOrderPaidOnlineEvent) {
    const short = String(order.id).slice(0, 8);
    const ref = `Rs. ${amount} • Ref ${reference}`;
    this.notifications.orderStatus({ id: order.id, userId: order.userId, status: order.status });
    if (order.driverId && ['ASSIGNED', 'PICKED', 'OUT_FOR_DELIVERY'].includes(order.status)) {
      await this.notifications.toUser(order.driverId, {
        title: `Order #${short} paid online`,
        body: `The customer paid online (${ref}). Do not collect cash on delivery.`,
        data: { route: 'driver_active_orders', orderId: order.id, type: 'COD_PAID_ONLINE' },
        event: 'driverOrderStatusChanged',
      });
    } else {
      await this.notifications.toHubAdmins(hubId, {
        title: `Order #${short} paid online`,
        body: `The customer paid this Cash on Delivery order online (${ref}).`,
        data: this.adminPayload(order),
        event: 'adminOrderStatusChanged',
      });
    }
  }

  /** 5 minutes after the order left: online payment is closed, so the driver collects the cash. */
  @OnEvent(DomainEvents.CodOnlinePaymentClosed)
  async onCodPaymentClosed({ order, amount }: CodOnlinePaymentClosedEvent) {
    if (!order.driverId) return;
    await this.notifications.toUser(order.driverId, {
      title: `Order #${String(order.id).slice(0, 8)}: collect cash`,
      body: `Online payment is now closed for this order. Collect Rs. ${amount} in cash from the customer.`,
      data: { route: 'driver_active_orders', orderId: order.id, type: 'COD_ONLINE_PAYMENT_CLOSED' },
      event: 'driverOrderStatusChanged',
    });
  }

  @OnEvent(DomainEvents.OrderStatusChanged)
  async onStatusChanged(e: OrderStatusChangedEvent) {
    const { order, actor } = e;
    this.notifications.orderStatus({ id: order.id, userId: order.userId, status: order.status });

    switch (order.status) {
      case 'CONFIRMED':
        if (e.previous === 'PENDING') {
          await this.notifications.toUser(order.userId, {
            title: 'Order Confirmed!',
            body: 'Your order has been confirmed and is being prepared.',
            data: { route: 'order_history', orderId: order.id },
            event: 'orderStatusChanged',
          });
        }
        break;
      case 'OUT_FOR_DELIVERY':
        await this.notifications.toUser(order.userId, {
          title: 'Your order is on the way!',
          body: 'Your Daily Meat order is out for delivery and will arrive shortly.',
          data: { route: 'tracking', orderId: order.id },
          event: 'orderStatusChanged',
        });
        if (actor === 'DRIVER') {
          await this.notifications.toAdmins({
            title: `Order #${String(order.id).slice(0, 8)} Out for Delivery`,
            body: `Driver has picked up Order #${String(order.id).slice(0, 8)}.`,
            data: { route: 'admin_order', orderId: order.id },
            event: 'adminOrderStatusChanged',
          });
        }
        break;
      case 'DELIVERED':
        await this.notifications.toUser(order.userId, {
          title: 'Order Delivered!',
          body: 'Your order has been delivered. Enjoy your fresh meat!',
          data: { route: 'order_history', orderId: order.id },
          event: 'orderStatusChanged',
        });
        if (actor === 'DRIVER') {
          await this.notifications.toAdmins({
            title: `Order #${String(order.id).slice(0, 8)} Delivered`,
            body: `Order #${String(order.id).slice(0, 8)} has been successfully delivered.`,
            data: { route: 'admin_order', orderId: order.id },
            event: 'adminOrderStatusChanged',
          });
        }
        break;
      case 'FAILED':
        await this.notifications.toUser(order.userId, {
          title: 'Delivery Failed',
          body: `Unfortunately, we couldn't deliver your order.${e.reason ? ` Reason: ${e.reason}` : ''}`,
          data: { route: 'order_history', orderId: order.id },
          event: 'orderStatusChanged',
        });
        await this.notifications.toAdmins({
          title: `Delivery Failed: Order #${String(order.id).slice(0, 8)}`,
          body: `Driver failed to deliver Order #${String(order.id).slice(0, 8)}.${e.reason ? ` Reason: ${e.reason}` : ''}`,
          data: { route: 'admin_order', orderId: order.id },
          event: 'adminOrderStatusChanged',
        });
        break;
      default:
        break; // CANCELLED is handled by OrderCancelled
    }
  }

  @OnEvent(DomainEvents.OrderCancelled)
  async onCancelled({ order, actor, reason }: OrderCancelledEvent) {
    const suffix = reason ? ` Reason: ${reason}` : '';
    if (actor === 'CUSTOMER') {
      await this.notifications.toAdmins({
        title: 'Order Cancelled',
        body: `Order #${String(order.id).slice(0, 8)} was cancelled by the customer.${suffix}`,
        data: { route: 'admin_order', orderId: order.id },
        event: 'adminOrderStatusChanged',
      });
    } else if (actor === 'ADMIN') {
      await this.notifications.toUser(order.userId, {
        title: 'Order Cancelled',
        body: reason ? `Your order has been cancelled by the store.${suffix}` : 'Your order has been cancelled by the admin.',
        data: { route: 'order_history', orderId: order.id },
        event: 'orderStatusChanged',
      });
    }
    if (order.driverId) {
      await this.notifications.toUser(order.driverId, {
        title: 'Order Cancelled',
        body: `Order #${String(order.id).slice(0, 8)} has been cancelled and removed from your route.${suffix}`,
        data: { route: 'driver_active_orders', orderId: order.id, status: 'CANCELLED' },
        event: 'driverOrderStatusChanged',
      });
    }
  }

  @OnEvent(DomainEvents.OrdersAssigned)
  async onAssigned({ driverId, orders, previousDrivers }: OrdersAssignedEvent) {
    for (const [oldDriverId, count] of Object.entries(previousDrivers)) {
      await this.notifications.toUser(oldDriverId, {
        title: 'Delivery Reassigned',
        body: `${count} order(s) were moved to another driver and removed from your route.`,
        data: { route: 'driver_active_orders' },
      });
    }
    for (const o of orders) this.notifications.orderStatus({ id: o.id, userId: o.userId, status: 'ASSIGNED' });
    await this.notifications.toUser(driverId, {
      title: 'New Delivery Assigned',
      body: `You have been assigned to deliver ${orders.length} new order(s).`,
      data: { route: 'driver_active_orders', orderIds: orders.map((o) => o.id) },
      event: 'driverAssigned',
    });
  }

  @OnEvent(DomainEvents.DriverArrived)
  async onArrived({ orderId, userId }: DriverArrivedEvent) {
    await this.notifications.toUser(userId, {
      title: 'Your delivery partner has arrived',
      body: 'Please be ready to receive your order.',
      data: { route: 'tracking', orderId },
      event: 'orderStatusChanged',
    });
  }
}
