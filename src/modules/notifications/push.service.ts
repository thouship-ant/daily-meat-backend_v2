import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { UsersService } from '../users/users.service';

/** Events that must wake the phone up with an alarm-style sound/priority. */
const ALARM_EVENTS = new Set(['adminNewOrder', 'admin_slot_alert', 'driverAssigned', 'driverOffer']);

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** socket event name - also decides alert style */
  kind?: string;
}

/** What happened to one batch of pushes: how many tokens were usable, how many Expo accepted, and why the others failed. */
export interface PushReport {
  tokens: number; // tokens given
  invalid: number; // not Expo push tokens (never sent)
  accepted: number; // Expo accepted them for delivery
  failed: number; // Expo refused them (see errors)
  errors: Record<string, number>; // e.g. { DeviceNotRegistered: 3, MessageRateExceeded: 1 }
}

/** Sends Expo push notifications and cleans up tokens Expo says are dead. */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo: Expo;

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {
    const accessToken = this.config.get<string>('EXPO_ACCESS_TOKEN');
    this.expo = new Expo(accessToken ? { accessToken } : {});
  }

  async send(tokens: string[], payload: PushPayload): Promise<number> {
    const report = await this.sendWithReport(tokens, payload);
    return report.accepted + report.failed;
  }

  /** Same as send, but says what Expo did with every token (so a broadcast that "did not arrive" can be explained). */
  async sendWithReport(tokens: string[], payload: PushPayload): Promise<PushReport> {
    const all = [...new Set(tokens)];
    const unique = all.filter((t) => Expo.isExpoPushToken(t));
    const report: PushReport = { tokens: all.length, invalid: all.length - unique.length, accepted: 0, failed: 0, errors: {} };
    if (report.invalid) this.logger.warn(`${report.invalid} of ${all.length} push tokens are not valid Expo tokens and were skipped (e.g. ${String(all.find((t) => !unique.includes(t)) ?? '').slice(0, 24)}).`);
    if (!unique.length) return report;
    const options = this.alertOptions(payload.kind);
    const messages: ExpoPushMessage[] = unique.map((to) => ({
      to,
      ...options,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    }));
    await this.dispatch(messages, report);
    return report;
  }

  /** A different message per customer (reminders that name a product / price): one push per valid device token. */
  async sendEach(items: { tokens: string[]; title: string; body: string; data?: Record<string, unknown> }[]): Promise<number> {
    const options = this.alertOptions();
    const messages: ExpoPushMessage[] = [];
    for (const item of items) {
      for (const to of new Set(item.tokens)) {
        if (!Expo.isExpoPushToken(to)) continue;
        messages.push({ to, ...options, title: item.title, body: item.body, data: item.data ?? {} });
      }
    }
    if (messages.length) await this.dispatch(messages);
    return messages.length;
  }

  private alertOptions(kind?: string): Partial<ExpoPushMessage> {
    if (kind && ALARM_EVENTS.has(kind)) {
      return {
        sound: 'noti.mp3',
        priority: 'high',
        ttl: 3600,
        channelId: this.config.get<string>('ANDROID_ALARM_CHANNEL_ID') || 'order-alarm',
        interruptionLevel: 'time-sensitive',
      };
    }
    const channel = this.config.get<string>('ANDROID_NOTIFICATION_CHANNEL_ID');
    return { sound: 'default', priority: 'high', ttl: 3600, ...(channel ? { channelId: channel } : {}) };
  }

  private async dispatch(messages: ExpoPushMessage[], report?: PushReport) {
    for (const chunk of this.expo.chunkPushNotifications(messages)) await this.sendChunk(chunk, report);
  }

  /**
   * Expo accepts one request only for tokens of ONE Expo project. A batch that mixes projects (e.g. customers' tokens
   * from an old build / another app registered under a different project) is refused as a whole, so nobody in it gets
   * the notification. On that error the batch is split by project (Expo names the groups) and each part is sent on its own.
   */
  private async sendChunk(chunk: ExpoPushMessage[], report?: PushReport): Promise<void> {
    try {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk);
      this.handleTickets(tickets, chunk);
      if (report) {
        for (const t of tickets) {
          if (t.status === 'error') {
            report.failed++;
            const why = String(t.details?.error ?? 'unknown');
            report.errors[why] = (report.errors[why] ?? 0) + 1;
          } else {
            report.accepted++;
          }
        }
      }
    } catch (e) {
      const err = e as { code?: string; message?: string; details?: unknown };
      if (err.code === 'PUSH_TOO_MANY_EXPERIENCE_IDS' || /same project/i.test(String(err.message))) {
        const parts = this.splitByProject(chunk, err.details);
        if (parts.length > 1) {
          this.logger.warn(`Push batch mixed ${parts.length} Expo projects (${parts.map((p) => p.length).join(' + ')} tokens): sending each project on its own.`);
          for (const part of parts) await this.sendChunk(part, report);
          return;
        }
      }
      // the whole chunk was not delivered to Expo (network, bad access token ...): count it as failed
      this.logger.error(`Push chunk failed: ${err.message}`);
      if (report) {
        report.failed += chunk.length;
        report.errors.CHUNK_FAILED = (report.errors.CHUNK_FAILED ?? 0) + chunk.length;
      }
    }
  }

  /** Groups of the chunk that belong to one project each: from Expo's error details, else the chunk cut in half. */
  private splitByProject(chunk: ExpoPushMessage[], details: unknown): ExpoPushMessage[][] {
    if (details && typeof details === 'object') {
      const groups = Object.values(details as Record<string, unknown>).filter((g): g is string[] => Array.isArray(g));
      if (groups.length > 1) {
        const parts = groups.map((tokens) => chunk.filter((m) => tokens.includes(String(m.to))));
        const covered = new Set(parts.flat());
        const rest = chunk.filter((m) => !covered.has(m));
        if (rest.length) parts.push(rest);
        const useful = parts.filter((p) => p.length);
        if (useful.length > 1) return useful;
      }
    }
    if (chunk.length < 2) return [chunk];
    const mid = Math.ceil(chunk.length / 2);
    return [chunk.slice(0, mid), chunk.slice(mid)];
  }

  private handleTickets(tickets: ExpoPushTicket[], chunk: ExpoPushMessage[]) {
    const tokenByTicket = new Map<string, string>();
    tickets.forEach((t, i) => {
      const to = chunk[i].to as string;
      if (t.status === 'error') {
        this.logger.warn(`Push ticket error for ${to}: ${t.message}`);
        if (t.details?.error === 'DeviceNotRegistered') void this.users.purgePushToken(to);
      } else if (t.id) {
        tokenByTicket.set(t.id, to);
      }
    });
    if (!tokenByTicket.size) return;

    // Delivery receipts are available a bit later; check once and drop tokens that turned out to be dead.
    const timer = setTimeout(async () => {
      try {
        for (const ids of this.expo.chunkPushNotificationReceiptIds([...tokenByTicket.keys()])) {
          const receipts = await this.expo.getPushNotificationReceiptsAsync(ids);
          for (const [id, r] of Object.entries(receipts)) {
            if (r.status !== 'error') continue;
            // InvalidCredentials / MismatchSenderId / MessageRateExceeded ... are why a push is accepted but never shows up
            this.logger.warn(`Push receipt error (${r.details?.error ?? 'unknown'}): ${r.message}`);
            if (r.details?.error === 'DeviceNotRegistered') {
              const token = tokenByTicket.get(id);
              if (token) await this.users.purgePushToken(token);
            }
          }
        }
      } catch (e) {
        this.logger.warn(`Receipt check failed: ${(e as Error).message}`);
      }
    }, 60_000);
    timer.unref();
  }
}
