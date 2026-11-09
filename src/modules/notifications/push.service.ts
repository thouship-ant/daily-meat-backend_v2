import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { UsersService } from '../users/users.service';

/** Events that must wake the phone up with an alarm-style sound/priority. */
const ALARM_EVENTS = new Set(['adminNewOrder', 'admin_slot_alert', 'driverAssigned']);

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** socket event name - also decides alert style */
  kind?: string;
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
    const unique = [...new Set(tokens)].filter((t) => Expo.isExpoPushToken(t));
    if (!unique.length) return 0;
    const options = this.alertOptions(payload.kind);
    const messages: ExpoPushMessage[] = unique.map((to) => ({
      to,
      ...options,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    }));
    await this.dispatch(messages);
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

  private async dispatch(messages: ExpoPushMessage[]) {
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        this.handleTickets(tickets, chunk);
      } catch (e) {
        this.logger.error(`Push chunk failed: ${(e as Error).message}`);
      }
    }
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
            if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') {
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
