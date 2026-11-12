import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { PushService } from './push.service';
import { RealtimeGateway } from './realtime.gateway';

/** Alarm-style new-order alerts are for hub admins only: a super admin looks after every hub and gets no alarm. */
const ADMIN_ONLY_ALERTS = new Set(['adminNewOrder', 'admin_slot_alert']);

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
      const tokens = await this.users.pushTokensForRole('ADMIN', { superAdmins: !(notice.event && ADMIN_ONLY_ALERTS.has(notice.event)) });
      await this.push.send(tokens, { title: notice.title, body: notice.body, data: notice.data, kind: notice.event });
    } catch (e) {
      this.logger.error(`toAdmins failed: ${(e as Error).message}`);
    }
  }

  /** Like toAdmins, but the push goes only to the admins of that hub (and super admins). */
  async toHubAdmins(hubId: number | null, notice: Notice): Promise<void> {
    try {
      if (notice.event) this.realtime.toAdmins(notice.event, { title: notice.title, body: notice.body, data: notice.data ?? {} });
      const tokens = await this.users.pushTokensForHubAdmins(hubId, { superAdmins: !(notice.event && ADMIN_ONLY_ALERTS.has(notice.event)) });
      await this.push.send(tokens, { title: notice.title, body: notice.body, data: notice.data, kind: notice.event });
    } catch (e) {
      this.logger.error(`toHubAdmins(${hubId}) failed: ${(e as Error).message}`);
    }
  }

  /** Tell every super admin (live + push), e.g. that someone's phone is hanging. */
  async toSuperAdmins(notice: Notice): Promise<void> {
    try {
      if (notice.event) {
        const ids = await this.users.idsForRole('SUPERADMIN');
        ids.forEach((id) => this.realtime.toUser(id, notice.event!, { title: notice.title, body: notice.body, data: notice.data ?? {} }));
      }
      const tokens = await this.users.pushTokensForRole('SUPERADMIN');
      await this.push.send(tokens, { title: notice.title, body: notice.body, data: notice.data, kind: notice.event });
    } catch (e) {
      this.logger.error(`toSuperAdmins failed: ${(e as Error).message}`);
    }
  }

  private readonly slowReported = new Map<string, number>();

  /**
   * A phone told us it was hanging (the app froze or got no answer for a long time). The super admins are told
   * who, how long and on what network. One notice per person every 30 minutes, so a bad connection can't spam them.
   */
  async reportSlowDevice(
    userId: string,
    report: { reason: 'app_frozen' | 'no_server_answer'; seconds: number; network?: string; appVersion?: string; platform?: string },
  ): Promise<{ sent: boolean }> {
    const now = Date.now();
    if (now - (this.slowReported.get(userId) ?? 0) < 30 * 60_000) return { sent: false };
    this.slowReported.set(userId, now);
    if (this.slowReported.size > 2000) for (const [k, t] of this.slowReported) if (now - t > 30 * 60_000) this.slowReported.delete(k);

    const user = await this.users.findById(userId);
    const who = `${user?.name || user?.phone || 'A user'} (${user?.role ?? 'user'})`;
    const what = report.reason === 'app_frozen' ? 'the app froze' : 'the server did not answer';
    const net = report.network ? ` Network: ${report.network}.` : '';
    await this.toSuperAdmins({
      title: 'Phone slow / hanging',
      body: `${who}: ${what} for about ${Math.round(report.seconds)} s and the app was restarted.${net}`,
      data: { type: 'DEVICE_SLOW', userId, phone: user?.phone ?? null, ...report },
      event: 'deviceSlow',
    });
    return { sent: true };
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

  forceLogoutUser(userId: string) {
    this.realtime.forceLogoutUser(userId);
  }
}
