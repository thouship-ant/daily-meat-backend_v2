import { OrderStatus } from '@prisma/client';

/**
 * Domain events. Business modules (orders, payments, ...) EMIT these and know nothing about who listens.
 * The notifications module (push + realtime) subscribes to them. That is what keeps orders, drivers and
 * notifications loosely coupled: nobody imports NotificationsService just to announce that something happened.
 */
export const DomainEvents = {
  /** categories / products / variants / banners were changed by an admin: connected apps reload them */
  CatalogChanged: 'catalog.changed',
  OrderPlaced: 'order.placed',
  OrderPaid: 'order.paid',
  /** a Cash on Delivery order that was already placed got paid online */
  CodOrderPaidOnline: 'order.cod_paid_online',
  /** online payment of a COD order closed (5 minutes after it went out for delivery): the driver collects cash */
  CodOnlinePaymentClosed: 'order.cod_online_payment_closed',
  OrderStatusChanged: 'order.status_changed',
  OrdersAssigned: 'orders.assigned',
  /** confirmed orders of a set were offered to a present driver, who can accept them */
  DriverOfferCreated: 'driver.offer_created',
  /** confirmed orders of a set are open for present drivers to pick (nobody in the queue can take them) */
  DriverOpenOrders: 'driver.open_orders',
  OrderCancelled: 'order.cancelled',
  DriverArrived: 'driver.arrived',
  DriverLocationUpdated: 'driver.location_updated',
  UserRegistered: 'user.registered',
  OrderAddressChanged: 'order.address_changed',
  AddressUpdateRequested: 'order.address_update_requested',
} as const;

export type OrderActor = 'CUSTOMER' | 'ADMIN' | 'DRIVER' | 'SYSTEM';

export interface OrderSummary {
  id: string;
  userId: string;
  driverId: string | null;
  status: OrderStatus;
  customerName?: string | null;
  address?: string;
  schedule?: string;
}

export interface OrderPlacedEvent {
  order: OrderSummary;
  paymentMethod: string;
}
export interface OrderPaidEvent {
  order: OrderSummary;
}
export interface CodOrderPaidOnlineEvent {
  order: OrderSummary;
  hubId: number | null;
  amount: number;
  /** gateway reference of the payment */
  reference: string;
}
export interface CodOnlinePaymentClosedEvent {
  order: OrderSummary;
  amount: number;
}
export interface OrderStatusChangedEvent {
  order: OrderSummary;
  previous: OrderStatus;
  actor: OrderActor;
  reason?: string;
}
export interface DriverOpenOrdersEvent {
  driverIds: string[];
  setNumber: number;
  count: number;
}
export interface DriverOfferCreatedEvent {
  driverId: string;
  offerId: string;
  count: number;
  setNumber: number;
  expiresAt: Date;
}
export interface OrdersAssignedEvent {
  driverId: string;
  orders: OrderSummary[];
  previousDrivers: Record<string, number>;
}
export interface OrderCancelledEvent {
  order: OrderSummary;
  actor: OrderActor;
  reason?: string;
}
export interface DriverArrivedEvent {
  orderId: string;
  userId: string;
}
export interface DriverLocationEvent {
  driverId: string;
  orderIds: string[];
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
}
export interface OrderAddressChangedEvent {
  order: OrderSummary;
}
export interface AddressUpdateRequestedEvent {
  userId: string;
  orderId: string;
  message: string;
}
