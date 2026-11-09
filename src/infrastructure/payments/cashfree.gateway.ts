import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApiException, ErrorCode } from '../../common/api-error';

const API_VERSION = '2025-01-01';

export interface GatewayCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface GatewayOrder {
  cfOrderId: string;
  paymentSessionId: string;
}

export type GatewayOrderStatus = 'PAID' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED' | 'TERMINATION_REQUESTED' | string;

/** Thin Cashfree client (payments API v2025-01-01). Knows nothing about orders or the database. */
@Injectable()
export class CashfreeGateway {
  private readonly logger = new Logger(CashfreeGateway.name);

  constructor(private readonly config: ConfigService) {}

  get environment(): 'PRODUCTION' | 'SANDBOX' {
    return this.config.get('CASHFREE_ENV') === 'PROD' ? 'PRODUCTION' : 'SANDBOX';
  }

  private get baseUrl() {
    return this.config.get('CASHFREE_ENV') === 'PROD' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  }

  async createOrder(order: { id: string; amount: number }, customer: GatewayCustomer): Promise<GatewayOrder> {
    const res = await this.request<{ cf_order_id: string | number; payment_session_id: string }>('POST', '/orders', {
      order_id: order.id,
      order_amount: order.amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: customer.id,
        customer_name: customer.name || 'Customer',
        customer_email: customer.email || `user_${customer.id}@dailymeat.in`,
        customer_phone: String(customer.phone ?? ''),
      },
      order_meta: {
        notify_url: `${this.config.get('APP_BASE_URL')}/${this.config.get('API_PREFIX')}/payments/webhook`,
        return_url: 'dailymeat://payment-success?order_id={order_id}',
      },
      order_note: 'Daily Meat Order',
    });
    return { cfOrderId: String(res.cf_order_id), paymentSessionId: res.payment_session_id };
  }

  async getOrderStatus(orderId: string): Promise<GatewayOrderStatus> {
    const res = await this.request<{ order_status: string }>('GET', `/orders/${encodeURIComponent(orderId)}`);
    return res.order_status;
  }

  async refund(orderId: string, amount: number, refundId: string): Promise<void> {
    await this.request('POST', `/orders/${encodeURIComponent(orderId)}/refunds`, {
      refund_amount: amount,
      refund_id: refundId,
      refund_note: 'Order cancelled',
    });
  }

  /** Cashfree signs `timestamp + rawBody` with the secret key (HMAC-SHA256, base64). */
  verifyWebhookSignature(rawBody: Buffer | string, timestamp: string | undefined, signature: string | undefined): boolean {
    const secret = this.config.get<string>('CASHFREE_SECRET_KEY');
    if (!secret || !timestamp || !signature) return false;
    const expected = createHmac('sha256', secret).update(timestamp + rawBody.toString()).digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const appId = this.config.get<string>('CASHFREE_APP_ID');
    const secret = this.config.get<string>('CASHFREE_SECRET_KEY');
    if (!appId || !secret) {
      throw ApiException.upstream('Online payments are not configured.');
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'x-client-id': appId,
          'x-client-secret': secret,
          'x-api-version': API_VERSION,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      this.logger.error(`Cashfree ${method} ${path} failed: ${(e as Error).message}`);
      throw ApiException.upstream('Payment gateway is unreachable. Please try again.');
    }
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      // Gateway error bodies are logged, never forwarded to clients verbatim.
      this.logger.error(`Cashfree ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
      throw new ApiException(ErrorCode.PAYMENT_FAILED, json?.message || 'Payment gateway rejected the request.', 502);
    }
    return json as T;
  }
}
