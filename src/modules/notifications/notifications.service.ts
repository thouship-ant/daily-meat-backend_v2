import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { PushService } from './push.service';
import { RealtimeGateway } from './realtime.gateway';

export interface Notice {
  title: string;
  body: string;
  /** deep-link / extra payload for the app */
  data?: Record<string, unknown>;
  /** realtime event name; also selects alarm-style delivery for urgent ones */
  event?: string;
}

/**
 * Delivery channel facade: realtime socket + push. Failures are logged and swallowed - a failed
 * notification must never fail the business operation that triggered it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly push: PushService,
    private readonly realtime: RealtimeGateway,
    private readonly users: UsersService,
  ) {}

  async toUser(userId: string, notice: Notice): Promise<void> {
    try {
      if (notice.event) this.realtime.toUser(userId, notice.event, { title: notice.title, body: notice.body, data: notice.data ?? {} });
      const tokens = await this.users.pushTokensForUser(userId);
      await this.push.send(tokens, { title: notice.title, body: notice.body, data: notice.data, kind: notice.event });
    } catch (e) {
      this.logger.error(`toUser(${userId}) failed: ${(e as Error).message}`);
    }
  }

  async toAdmins(notice: Notice): Promise<void> {
    try {
      if (notice.event) this.realtime.toAdmins(notice.event, { title: notice.title, body: notice.body, data: notice.data ?? {} });
      const tokens = await this.users.pushTokensForRole('ADMIN');
      await this.push.send(tokens, { title: notice.title, body: notice.body, data: notice.data, kind: notice.event });
    } catch (e) {
      this.logger.error(`toAdmins failed: ${(e as Error).message}`);
    }
  }

  /** Silent socket update so open screens refresh without a push. */
  orderStatus(order: { id: string; userId: string; status: string }) {
    const payload = { data: { orderId: order.id, status: order.status } };
    this.realtime.toUser(order.userId, 'orderStatusChanged', payload);
    this.realtime.toOrder(order.id, 'orderStatusChanged', payload);
    this.realtime.toAdmins('adminOrderStatusChanged', payload);
  }

  forceLogoutAdmins() {
    this.realtime.forceLogoutAdmins();
  }
}
