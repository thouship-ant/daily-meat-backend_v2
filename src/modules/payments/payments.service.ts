import { Injectable, Logger } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/api-error';
import { CashfreeGateway } from '../../infrastructure/payments/cashfree.gateway';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';

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
  ) {}

  /** The app calls this after the payment sheet closes. The gateway - not the app - decides whether it was paid. */
  async verifyForCustomer(userId: string, orderId: string): Promise<PaymentVerification> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw ApiException.notFound('Order');
    if (order.paymentMethod !== 'ONLINE') {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'This order is not an online payment order.');
    }
    if (order.paymentStatus === 'PAID') return { orderId, paymentStatus: 'PAID', alreadyPaid: true };
    return this.reconcile(orderId);
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

    const known = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!known) return;
    // Do not trust the payload's status: ask the gateway (authoritative, and idempotent for retried webhooks).
    await this.reconcile(orderId);
  }

  private async reconcile(orderId: string): Promise<PaymentVerification> {
    const status = await this.gateway.getOrderStatus(orderId);
    if (status === 'PAID') {
      await this.lifecycle.markPaid(orderId);
      return { orderId, paymentStatus: 'PAID' };
    }
    if (DEAD_ORDER_STATES.includes(status)) {
      await this.lifecycle.abandonUnpaid(orderId, 'Payment expired or was cancelled');
      return { orderId, paymentStatus: 'FAILED' };
    }
    return { orderId, paymentStatus: 'PENDING' }; // still ACTIVE: the customer may retry
  }
}
