import { Injectable, Logger } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/api-error';
import { CashfreeGateway } from '../../infrastructure/payments/cashfree.gateway';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { onlinePayState } from '../orders/cod-online-payment';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import { DriverOnboardingService } from '../driver-onboarding/driver-onboarding.service';

export type PaymentVerification = {
  orderId: string;
  paymentStatus: 'PAID' | 'PENDING' | 'FAILED';
  alreadyPaid?: boolean;
};

const DEAD_ORDER_STATES = ['EXPIRED', 'TERMINATED', 'TERMINATION_REQUESTED'];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CashfreeGateway,
    private readonly lifecycle: OrderLifecycleService,
    private readonly onboarding: DriverOnboardingService,
  ) {}

  /** The app calls this after the payment sheet closes. The gateway - not the app - decides whether it was paid. */
  async verifyForCustomer(userId: string, orderId: string): Promise<PaymentVerification> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw ApiException.notFound('Order');
    // a COD order can be paid online too (see startCodOnlinePayment); it keeps method COD until the money arrives
    if (order.paymentMethod !== 'ONLINE' && !(order.paymentMethod === 'COD' && (order.gatewayOrderId || order.cfOrderId))) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'This order is not an online payment order.');
    }
    if (order.paymentStatus === 'PAID') return { orderId, paymentStatus: 'PAID', alreadyPaid: true };
    return this.reconcile(orderId);
  }

  /**
   * The customer wants to pay an already placed Cash on Delivery order online. Allowed until the order is out for
   * delivery (plus 5 minutes). Returns the gateway session to open in the app; reuses a still-open session.
   */
  async startCodOnlinePayment(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw ApiException.notFound('Order');
    if (order.paymentStatus === 'PAID') {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'This order is already paid.');
    }
    // a COD order (up to the COD limit), or an order above the limit whose online payment failed (status FAILED)
    const failedOnline = order.paymentMethod === 'ONLINE' && order.status === 'FAILED';
    if (order.paymentMethod !== 'COD' && !failedOnline) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Only Cash on Delivery orders or orders with a failed online payment can be paid this way.');
    }
    if (!onlinePayState(order).available) {
      throw ApiException.badRequest(
        'ONLINE_PAYMENT_CLOSED',
        'Online payment is no longer available for this order. Please pay the delivery partner on delivery.',
      );
    }

    let gatewayId = order.gatewayOrderId ?? order.id;
    // an earlier attempt: it may have been paid meanwhile, or its session may still be open
    if (order.cfOrderId && order.paymentSessionId) {
      const status = await this.gateway.getOrderStatus(gatewayId).catch(() => 'UNKNOWN');
      if (status === 'PAID') {
        if (failedOnline) await this.lifecycle.markPaid(order.id);
        else await this.lifecycle.markCodPaidOnline(order.id, gatewayId);
        return { orderId: order.id, paymentStatus: 'PAID' as const };
      }
      if (status === 'ACTIVE') return this.session(order.id, order.paymentSessionId, order.cfOrderId, Number(order.totalAmount));
      gatewayId = `${order.id}_P${Date.now().toString(36)}`; // the old gateway order is dead: start a new one
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true },
    });
    const gw = await this.gateway.createOrder({ id: gatewayId, amount: Number(order.totalAmount) }, user);
    await this.prisma.order.update({
      where: { id: order.id },
      data: { gatewayOrderId: gatewayId, cfOrderId: gw.cfOrderId, paymentSessionId: gw.paymentSessionId },
    });
    return this.session(order.id, gw.paymentSessionId, gw.cfOrderId, Number(order.totalAmount));
  }

  /**
   * The app says the payment sheet failed or was closed without paying. The gateway is asked first (the customer may
   * have paid after all); otherwise the failure rule runs (see OrderLifecycleService.onlinePaymentFailed) and the
   * answer tells the app what to show: carry on as COD (with retries left) or pay again because the order is FAILED.
   */
  async reportFailedForCustomer(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw ApiException.notFound('Order');
    if (order.paymentStatus !== 'PAID') {
      const real = await this.reconcile(orderId).catch(() => null);
      if (real?.paymentStatus === 'PAID') {
        return { outcome: 'PAID' as const, attempts: order.paymentAttempts, retriesLeft: 0, status: 'PENDING', total: Number(order.totalAmount) };
      }
    }
    return this.lifecycle.onlinePaymentFailed(orderId, { reason: 'Online payment did not go through' });
  }

  private session(orderId: string, sessionId: string, cfOrderId: string, amount: number) {
    return { orderId, paymentStatus: 'PENDING' as const, sessionId, gatewayOrderId: cfOrderId, environment: this.gateway.environment, amount };
  }

  /** Cashfree webhook. Authenticity is proven by the HMAC signature over the raw body. */
  async handleWebhook(rawBody: Buffer | undefined, timestamp?: string, signature?: string): Promise<void> {
    if (!rawBody || !this.gateway.verifyWebhookSignature(rawBody, timestamp, signature)) {
      throw new ApiException(ErrorCode.INVALID_SIGNATURE, 'Invalid webhook signature.', 401);
    }
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      return; // acknowledged, nothing to do
    }
    const orderId: string | undefined = payload?.data?.order?.order_id;
    if (!orderId) return; // e.g. the dashboard's webhook "test" ping

    // a new driver's starting deposit (not an order)
    if (this.onboarding.isDepositGatewayId(orderId)) {
      await this.onboarding.reconcileDeposit(orderId).catch((e) => this.logger.warn(`deposit webhook ${orderId}: ${(e as Error).message}`));
      return;
    }

    // the gateway may know the order by a suffixed id (a retried COD payment)
    const known = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { gatewayOrderId: orderId }] },
      select: { id: true },
    });
    if (!known) return;
    // Do not trust the payload's status: ask the gateway (authoritative, and idempotent for retried webhooks).
    await this.reconcile(known.id);
  }

  private async reconcile(orderId: string): Promise<PaymentVerification> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const gatewayId = order.gatewayOrderId ?? order.id;
    const status = await this.gateway.getOrderStatus(gatewayId);
    const isCod = order.paymentMethod === 'COD';
    if (status === 'PAID') {
      if (isCod) await this.lifecycle.markCodPaidOnline(orderId, gatewayId);
      else await this.lifecycle.markPaid(orderId); // also lifts a FAILED (payment failed) order to PENDING
      return { orderId, paymentStatus: 'PAID' };
    }
    if (DEAD_ORDER_STATES.includes(status)) {
      // The order is not cancelled: up to the COD limit it carries on as COD ("COD - Pending"), above it it is FAILED
      // until the customer pays online. The webhook does not count as one of the customer's retries.
      await this.lifecycle.onlinePaymentFailed(orderId, { countAttempt: false, reason: 'Payment expired or was cancelled' });
      return { orderId, paymentStatus: 'FAILED' };
    }
    return { orderId, paymentStatus: 'PENDING' }; // still ACTIVE: the customer may retry
  }
}
