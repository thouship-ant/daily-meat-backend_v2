import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuthUser } from '../../common/decorators';
import { DomainEvents, OrderPlacedEvent } from '../../common/events/domain-events';
import { toMoney } from '../../common/utils/money';
import { istMinutesNow, istToday } from '../../common/utils/time';
import { CashfreeGateway } from '../../infrastructure/payments/cashfree.gateway';
import { PrismaService, Tx } from '../../infrastructure/prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';
import { HubsService, HubView } from '../hubs/hubs.service';
import { DeliverySlotsService } from './delivery-slots.service';
import { OrderLifecycleService } from './order-lifecycle.service';

export interface PlaceOrderItem {
  variantId: string;
  quantity: number;
  instruction?: string;
}

export interface PlaceOrderAddress {
  title?: string;
  street: string;
  city: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
}

export interface PlaceOrderInput {
  items: PlaceOrderItem[];
  address: PlaceOrderAddress;
  paymentMethod?: 'COD' | 'ONLINE';
  deliveryInstruction?: string;
  deliveryDate?: string; // YYYY-MM-DD, scheduled order
  deliverySlotId?: string;
  couponCode?: string;
  couponId?: string;
}

export interface PlacedOrder {
  orderId: string;
  status: string;
  amounts: { subtotal: number; discount: number; deliveryCharge: number; total: number };
  coupon: { id: string; code: string } | null;
  payment: {
    method: 'COD' | 'ONLINE';
    status: string;
    sessionId: string | null;
    gatewayOrderId: string | null;
    environment: 'PRODUCTION' | 'SANDBOX' | null;
  };
}

const MAX_SCHEDULE_DAYS = 14;

/**
 * Places a customer order. Everything money-related is computed on the server from the database:
 * unit prices, product names, the delivery fee (from the hub's rules) and the coupon discount.
 * The client only says WHAT it wants (variant ids + quantities) - v1 trusted client-sent fees and names.
 */
@Injectable()
export class OrderPlacementService {
  private readonly logger = new Logger(OrderPlacementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hubs: HubsService,
    private readonly coupons: CouponsService,
    private readonly slots: DeliverySlotsService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly gateway: CashfreeGateway,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  async place(user: AuthUser, input: PlaceOrderInput): Promise<PlacedOrder> {
    const paymentMethod = input.paymentMethod ?? 'COD';
    const items = this.mergeItems(input.items);
    if (!items.length) throw ApiException.badRequest(ErrorCode.EMPTY_ORDER, 'Order must contain at least one item.');

    const { hub, slot, deliveryDate, pin } = await this.prepare(user.id, input);

    // ---- 2. place it atomically (retry on the rare order-id collision) ----
    const created = await this.withOrderIdRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const pricing = await this.price(tx, user.id, items, hub, pin, input, paymentMethod, true);
          const { lines, subtotal, totalCost, deliveryCharge, discount, total, validated } = pricing;
          const couponId = validated?.coupon.id ?? null;
          const couponCode = validated?.coupon.code ?? null;

          // the slot may only take so many orders per hub and day (set in Manage Delivery Slots)
          if (slot && deliveryDate) await this.slots.assertHasRoom(tx, slot, deliveryDate, hub.id);

          const id = this.generateOrderId();
          const order = await tx.order.create({
            data: {
              id,
              user: { connect: { id: user.id } },
              hub: { connect: { id: hub.id } },
              subtotalAmount: subtotal,
              deliveryCharge,
              discountAmount: discount,
              totalAmount: total,
              totalCost,
              totalProfit: toMoney(total - deliveryCharge - totalCost),
              paymentMethod,
              deliveryDate: deliveryDate ? new Date(`${deliveryDate}T00:00:00.000Z`) : null,
              deliverySlotId: slot?.id ?? null,
              deliverySlotLabel: slot?.label ?? null,
              deliveryInstruction: input.deliveryInstruction ?? null,
              couponCodeSnapshot: couponCode,
              ...(couponId ? { coupon: { connect: { id: couponId } } } : {}),
              addressTitle: input.address.title ?? null,
              addressStreet: input.address.street,
              addressCity: input.address.city,
              addressPincode: input.address.pincode,
              addressLatitude: pin?.latitude ?? null,
              addressLongitude: pin?.longitude ?? null,
              items: { create: lines },
            },
          });

          if (validated) {
            await this.coupons.redeem(tx, { couponId: validated.coupon.id, userId: user.id, orderId: id, discountAmount: discount });
          }
          return { order, couponId, couponCode };
        },
        { timeout: 15_000 },
      ),
    );
    const { order } = created;

    // ---- 3. online payment: talk to the gateway AFTER the DB transaction (no HTTP call holding a transaction open) ----
    let sessionId: string | null = null;
    let gatewayOrderId: string | null = null;
    if (paymentMethod === 'ONLINE') {
      try {
        const dbUser = await this.prisma.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { id: true, name: true, email: true, phone: true },
        });
        const gw = await this.gateway.createOrder({ id: order.id, amount: Number(order.totalAmount) }, dbUser);
        sessionId = gw.paymentSessionId;
        gatewayOrderId = gw.cfOrderId;
        await this.prisma.order.update({ where: { id: order.id }, data: { cfOrderId: gatewayOrderId, paymentSessionId: sessionId } });
      } catch (e) {
        await this.lifecycle.abandonUnpaid(order.id, 'Could not start online payment').catch(() => undefined);
        throw e;
      }
    } else {
      // COD orders are live immediately; ONLINE orders announce themselves once payment is confirmed.
      const full = await this.lifecycle.load(order.id);
      this.events.emit(DomainEvents.OrderPlaced, {
        order: this.lifecycle.summarize(full),
        paymentMethod,
      } satisfies OrderPlacedEvent);
    }

    return {
      orderId: order.id,
      status: order.status,
      amounts: {
        subtotal: Number(order.subtotalAmount),
        discount: Number(order.discountAmount),
        deliveryCharge: Number(order.deliveryCharge),
        total: Number(order.totalAmount),
      },
      coupon: created.couponId ? { id: created.couponId, code: created.couponCode! } : null,
      payment: {
        method: paymentMethod,
        status: order.paymentStatus,
        sessionId,
        gatewayOrderId,
        environment: paymentMethod === 'ONLINE' ? this.gateway.environment : null,
      },
    };
  }

  /** Price preview for the checkout screen: same rules as `place`, nothing is written. */
  async quote(user: AuthUser, input: PlaceOrderInput) {
    const paymentMethod = input.paymentMethod ?? 'COD';
    const items = this.mergeItems(input.items);
    if (!items.length) throw ApiException.badRequest(ErrorCode.EMPTY_ORDER, 'Order must contain at least one item.');
    const { hub, slot, deliveryDate, pin } = await this.prepare(user.id, input);
    const p = await this.price(this.prisma, user.id, items, hub, pin, input, paymentMethod, false);
    return {
      hubId: hub.id,
      amounts: { subtotal: p.subtotal, deliveryCharge: p.deliveryCharge, discount: p.discount, total: p.total },
      freeDeliveryThreshold: hub.deliveryFeeStrategy === 'amount' ? hub.minOrderForFreeDelivery : null,
      coupon: p.validated ? { id: p.validated.coupon.id, code: p.validated.coupon.code } : null,
      schedule: { date: deliveryDate, slotId: slot?.id ?? null, slotLabel: slot?.label ?? null },
      codAvailable: p.total <= Number(this.config.get('COD_MAX_AMOUNT') ?? 2000) || (await this.codStatus(user.id)).fallbackAllowed,
    };
  }

  /**
   * Cash on Delivery above the COD limit is normally refused ("pay online"). One exception: when the customer's
   * online payment did not go through (failed, cancelled or still pending) they may place ONE such COD order.
   *  - the exception needs exactly one unpaid online attempt in the last 24h; after a second failed online
   *    payment the customer is asked to try another payment type instead;
   *  - only one over-limit COD order can be open (not delivered / cancelled) at a time;
   *  - orders up to the limit are never affected, and a customer may place any number of them.
   */
  async codStatus(userId: string, db: Tx | PrismaService = this.prisma) {
    const limit = Number(this.config.get('COD_MAX_AMOUNT') ?? 2000);
    const since = new Date(Date.now() - 24 * 3600_000);
    const [unpaidOnlineAttempts, openOverLimitCod] = await Promise.all([
      db.order.count({
        where: { userId, paymentMethod: 'ONLINE', paymentStatus: { in: ['PENDING', 'FAILED'] }, createdAt: { gte: since } },
      }),
      db.order.count({
        where: { userId, paymentMethod: 'COD', totalAmount: { gt: limit }, status: { notIn: ['DELIVERED', 'CANCELLED', 'FAILED'] } },
      }),
    ]);
    let reason: 'ALLOWED' | 'PAY_ONLINE_FIRST' | 'ONLINE_FAILED_AGAIN' | 'ALREADY_USED' = 'ALLOWED';
    let message = '';
    if (unpaidOnlineAttempts === 0) {
      reason = 'PAY_ONLINE_FIRST';
      message = `Cash on Delivery is not available for orders above Rs. ${limit}. Please pay online.`;
    } else if (unpaidOnlineAttempts >= 2) {
      reason = 'ONLINE_FAILED_AGAIN';
      message = `Online payment did not go through again. Cash on Delivery is not available for orders above Rs. ${limit}, so please try to make payment with another payment type.`;
    } else if (openOverLimitCod > 0) {
      reason = 'ALREADY_USED';
      message = `You already have a Cash on Delivery order above Rs. ${limit} in progress. Please pay online or with another payment type for this order.`;
    }
    return { limit, unpaidOnlineAttempts, openOverLimitCod, fallbackAllowed: reason === 'ALLOWED', reason, message };
  }

  /** Checks where/when the order can be delivered (hub, pause, slot, date, opening hours). Throws coded errors. */
  private async prepare(userId: string, input: PlaceOrderInput) {
    const hub = await this.hubs.findForPincode(input.address.pincode);
    if (!hub) {
      throw ApiException.badRequest(
        ErrorCode.AREA_NOT_SERVICEABLE,
        `Sorry, we do not deliver to pincode ${input.address.pincode} yet.`,
      );
    }
    if (hub.ordersPaused) {
      throw ApiException.badRequest(
        ErrorCode.ORDERS_PAUSED,
        hub.pauseReason || 'We are temporarily not accepting new orders. Please check back soon!',
      );
    }

    const slot = input.deliverySlotId ? await this.slots.getActive(input.deliverySlotId) : null;
    const deliveryDate = this.validateDeliveryDate(input.deliveryDate);

    // An ASAP order (no date, no slot) is only possible while the store is open.
    if (!deliveryDate && !slot && !this.hubs.isOpenNow(hub, istMinutesNow())) {
      throw ApiException.badRequest(
        ErrorCode.STORE_CLOSED,
        'Store is currently closed. Please select a delivery slot for tomorrow.',
      );
    }
    const pin = await this.resolvePin(userId, input.address);
    return { hub, slot, deliveryDate, pin };
  }

  /**
   * Prices a basket from the database: unit prices, delivery fee, coupon, COD limit.
   * With `lock` (inside the order transaction) the coupon row is locked so concurrent orders cannot overspend it.
   */
  private async price(
    db: Tx,
    userId: string,
    items: PlaceOrderItem[],
    hub: HubView,
    pin: { latitude: number; longitude: number } | null,
    input: PlaceOrderInput,
    paymentMethod: 'COD' | 'ONLINE',
    lock: boolean,
  ) {
    const variants = await db.productVariant.findMany({
      where: { id: { in: items.map((i) => i.variantId) } },
      include: { product: { select: { id: true, name: true, isActive: true, category: { select: { isActive: true } } } } },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));

    let subtotal = 0;
    let totalCost = 0;
    const lines: Prisma.OrderItemCreateWithoutOrderInput[] = [];
    for (const item of items) {
      const v = byId.get(item.variantId);
      if (!v || !v.isActive || !v.inStock || !v.product.isActive || !v.product.category.isActive) {
        throw ApiException.badRequest(
          ErrorCode.ITEM_UNAVAILABLE,
          v ? `${v.product.name} (${v.weight}) is currently unavailable.` : 'An item in your cart is no longer available.',
          { variantId: item.variantId },
        );
      }
      const unit = toMoney(v.discountedPrice || v.price);
      const cost = toMoney(v.costPrice ?? 0);
      subtotal += unit * item.quantity;
      totalCost += cost * item.quantity;
      lines.push({
        product: { connect: { id: v.productId } },
        variant: { connect: { id: v.id } },
        productNameSnapshot: v.product.name,
        variantNameSnapshot: v.weight,
        quantity: item.quantity,
        price: unit,
        costPriceSnapshot: cost,
        instruction: item.instruction ?? null,
      });
    }
    subtotal = toMoney(subtotal);
    totalCost = toMoney(totalCost);

    const deliveryCharge = this.hubs.calculateDeliveryFee(hub, {
      subtotal,
      latitude: pin?.latitude ?? null,
      longitude: pin?.longitude ?? null,
    });
    const beforeDiscount = toMoney(subtotal + deliveryCharge);

    let discount = 0;
    let validated: Awaited<ReturnType<CouponsService['validateOrThrow']>> | null = null;
    if (input.couponCode || input.couponId) {
      validated = await this.coupons.validateOrThrow(
        { userId, orderTotal: beforeDiscount, code: input.couponCode, couponId: input.couponId },
        db,
        lock,
      );
      discount = validated.discountAmount;
    }

    const total = toMoney(beforeDiscount - discount);
    const codMax = Number(this.config.get('COD_MAX_AMOUNT') ?? 2000);
    if (paymentMethod === 'COD' && total > codMax) {
      const cod = await this.codStatus(userId, db);
      if (!cod.fallbackAllowed) {
        throw ApiException.badRequest(ErrorCode.COD_LIMIT_EXCEEDED, cod.message, {
          limit: codMax,
          unpaidOnlineAttempts: cod.unpaidOnlineAttempts,
          reason: cod.reason,
        });
      }
    }
    return { lines, subtotal, totalCost, deliveryCharge, discount, total, validated };
  }

  // ---------- helpers ----------

  /** Two lines for the same variant become one (quantities add up). */
  mergeItems(items: PlaceOrderItem[]): PlaceOrderItem[] {
    const map = new Map<string, PlaceOrderItem>();
    for (const i of items ?? []) {
      const existing = map.get(i.variantId);
      if (existing) existing.quantity += i.quantity;
      else map.set(i.variantId, { ...i });
    }
    return [...map.values()];
  }

  private validateDeliveryDate(date?: string): string | null {
    if (!date) return null;
    const today = istToday();
    const max = new Date(Date.parse(`${today}T00:00:00Z`) + MAX_SCHEDULE_DAYS * 86_400_000).toISOString().slice(0, 10);
    if (date < today) throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Delivery date cannot be in the past.');
    if (date > max) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, `Orders can be scheduled at most ${MAX_SCHEDULE_DAYS} days ahead.`);
    }
    return date;
  }

  /** Prefers the pin of the customer's saved address (set deliberately on a map) over the one sent with the request. */
  private async resolvePin(userId: string, a: PlaceOrderAddress): Promise<{ latitude: number; longitude: number } | null> {
    const saved = await this.prisma.address.findFirst({
      where: { userId, street: a.street, city: a.city, pincode: a.pincode },
      select: { latitude: true, longitude: true },
    });
    if (saved) return { latitude: saved.latitude, longitude: saved.longitude };
    if (a.latitude != null && a.longitude != null) return { latitude: a.latitude, longitude: a.longitude };
    return null;
  }

  private generateOrderId() {
    return `ODDM${randomInt(10000, 100000)}`;
  }

  private async withOrderIdRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (e) {
        const collision =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          /orders_pkey|\bid\b/.test(String(e.meta?.target ?? ''));
        if (!collision || i >= attempts) throw e;
        this.logger.warn('Order id collision, retrying with a new id');
      }
    }
  }
}
