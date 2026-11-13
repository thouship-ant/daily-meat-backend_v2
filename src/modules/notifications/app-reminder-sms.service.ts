import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingService } from '../../infrastructure/messaging/messaging.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * "Come back to Daily Meat" SMS, every Sunday at 8:00 AM IST (Fortius DLT gateway, one approved template).
 *
 * Who is eligible: active customers with a phone number who most likely no longer have the app - no push device
 * registered (the push service removes a device token when the phone reports the app is gone) - and who have not opened
 * the app for APP_REMINDER_SMS_INACTIVE_DAYS days. Customers who turned off promotional messages, deleted accounts and
 * numbers that are not Indian mobiles are left out.
 *
 * Rotation: each Sunday only APP_REMINDER_SMS_PER_RUN (default 50) eligible customers get the SMS, so a full round takes
 * weeks = ceil(eligible / 50). Customers who never got one go first, then the ones who waited longest. Everyone who is sent
 * one is due again on  today + weeks x 7 days  (800 eligible -> 16 weeks); customers who become eligible later (e.g. they
 * uninstall) simply join the queue. Every attempt is written to reminder_sms_logs with its date and time.
 *
 * Settings: APP_REMINDER_SMS_ENABLED (default true), SMS_FORTIUS_APP_REMINDER_TEMPLATE_ID, APP_REMINDER_SMS_INACTIVE_DAYS
 * (default 7), APP_REMINDER_SMS_PER_RUN (default 50). Like the other reminders, the timer runs in production, or
 * elsewhere with SCHEDULED_NOTIFICATIONS_ENABLED=true.
 */

/** The DLT-approved text. {#alp#} is the customer's name - this must stay identical to the registered template. */
export const APP_REMINDER_TEMPLATE =
  'Dear {#alp#}, We have made Daily Meat faster and smoother for you. Order fresh chicken, mutton and fish (sea foods) again: https://dailymeat.in. Have a suggestion or question? Please feel free to send it through Contact on the Daily Meat site.';

const DEFAULT_TEMPLATE_ID = '1777179455851148185';
const DEFAULT_PER_RUN = 50;
const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const BATCH = 10; // parallel sends; each batch is logged once it is done, so a restart repeats at most one batch
const NAME_MAX = 30; // DLT variable length

/** Sunday 08:00 - 08:09 IST (a once-a-minute check; the caller makes sure it runs once per day). */
export function isAppReminderDue(now: Date): boolean {
  const t = new Date(now.getTime() + IST_MS);
  return t.getUTCDay() === 0 && t.getUTCHours() === 8 && t.getUTCMinutes() < 10;
}

/** The IST calendar day (YYYY-MM-DD) of a moment. */
export const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

/** Weeks one full round takes, and the date the customers sent today are due again. */
export function nextRound(eligible: number, perRun: number, today: string) {
  const weeks = Math.max(1, Math.ceil(eligible / Math.max(1, perRun)));
  return { weeks, nextOn: addDays(today, weeks * 7) };
}

/** The name as it goes into the SMS: letters, digits and a few marks only, at most 30 characters. */
export function smsName(name: string | null | undefined): string {
  const clean = String(name ?? '').replace(/[^\p{L}\p{N} .'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return clean || 'Customer';
}

/** 10-digit Indian mobile from "+91XXXXXXXXXX" / "91XXXXXXXXXX" / "XXXXXXXXXX"; null when it is not one. */
export function indianMobile(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

export const appReminderMessage = (name: string | null | undefined) => APP_REMINDER_TEMPLATE.replace('{#alp#}', smsName(name));

export interface SmsRecipient { id: string; name: string | null; mobile: string; createdAt?: Date }

@Injectable()
export class AppReminderSmsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppReminderSmsService.name);
  private timer?: NodeJS.Timeout;
  private lastRunDay = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return String(this.config.get('APP_REMINDER_SMS_ENABLED') ?? 'true').trim().toLowerCase() !== 'false';
  }
  private get templateId(): string {
    return String(this.config.get('SMS_FORTIUS_APP_REMINDER_TEMPLATE_ID') || DEFAULT_TEMPLATE_ID);
  }
  private get perRun(): number {
    return Math.max(1, Math.floor(Number(this.config.get('APP_REMINDER_SMS_PER_RUN') ?? DEFAULT_PER_RUN)) || DEFAULT_PER_RUN);
  }

  onModuleInit() {
    const flag = process.env.SCHEDULED_NOTIFICATIONS_ENABLED;
    const on = flag ? flag === 'true' : process.env.NODE_ENV === 'production';
    if (!on) {
      this.logger.log('App reminder SMS is off (set SCHEDULED_NOTIFICATIONS_ENABLED=true to turn it on).');
      return;
    }
    this.logger.log(`App reminder SMS: ${this.enabled ? `on (Sundays 8:00 AM IST, ${this.perRun} per week)` : 'OFF (APP_REMINDER_SMS_ENABLED=false)'}.`);
    this.timer = setInterval(() => this.tick().catch((e) => this.logger.error(e.message)), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()) {
    if (!this.enabled || !isAppReminderDue(now)) return;
    const day = istDay(now);
    if (this.lastRunDay === day) return;
    this.lastRunDay = day;
    await this.run({ now });
  }

  /** Every customer who is eligible for the SMS, whether or not they are due this week. */
  async audience(now: Date = new Date()): Promise<SmsRecipient[]> {
    const days = Number(this.config.get('APP_REMINDER_SMS_INACTIVE_DAYS') ?? 7) || 7;
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const users = await this.prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        isActive: true,
        promotionalNotifications: true,
        phone: { not: null },
        AND: [
          { OR: [{ pushToken: null }, { pushToken: '' }] },
          { OR: [{ phone: null }, { phone: { not: { startsWith: 'del_' } } }] },
          { OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: cutoff } }] },
          { OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: cutoff } }] },
        ],
      },
      select: { id: true, name: true, phone: true, createdAt: true },
    });
    const out: SmsRecipient[] = [];
    for (const u of users) {
      const mobile = indianMobile(u.phone);
      if (mobile) out.push({ id: u.id, name: u.name, mobile, createdAt: u.createdAt });
    }
    return out;
  }

  /** Last successful SMS per customer: when it was sent and the day they are due again. */
  private async lastSent(userIds: string[]) {
    const map = new Map<string, { sentAt: Date; nextOn: string | null }>();
    if (!userIds.length) return map;
    const rows = await this.prisma.$queryRaw<{ user_id: string; sent_at: Date; next_on: string | null }[]>`
      SELECT DISTINCT ON (user_id) user_id::text AS user_id, sent_at, next_reminder_on::text AS next_on
        FROM reminder_sms_logs
       WHERE status = 'SENT' AND user_id = ANY(${userIds}::uuid[])
       ORDER BY user_id, sent_at DESC`;
    for (const r of rows) map.set(r.user_id, { sentAt: new Date(r.sent_at), nextOn: r.next_on });
    return map;
  }

  /**
   * One Sunday: pick the next customers in the queue (never reminded first, then the longest waiting) who are due,
   * send, and log each attempt.
   */
  async run({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}) {
    const today = istDay(now);
    const eligible = await this.audience(now);
    const { weeks, nextOn } = nextRound(eligible.length, this.perRun, today);
    const last = await this.lastSent(eligible.map((c) => c.id));

    const due = eligible
      .filter((c) => {
        const l = last.get(c.id);
        return !l || !l.nextOn || l.nextOn <= today;
      })
      .sort((a, b) => {
        const la = last.get(a.id)?.sentAt.getTime() ?? 0; // never reminded = 0 = first
        const lb = last.get(b.id)?.sentAt.getTime() ?? 0;
        return la - lb || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
      });
    const batch = due.slice(0, this.perRun);
    const summary = { eligible: eligible.length, due: due.length, weeks, nextReminderOn: nextOn };

    if (dryRun) {
      this.logger.log(`App reminder SMS prepared: ${batch.length} of ${eligible.length} eligible (${due.length} due), round = ${weeks} weeks.`);
      return { ...summary, sent: 0, failed: 0, recipients: batch };
    }

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < batch.length; i += BATCH) {
      const part = batch.slice(i, i + BATCH);
      const results = await Promise.all(part.map((c) => this.messaging.sendTemplateSms(c.mobile, this.templateId, appReminderMessage(c.name))));
      sent += results.filter(Boolean).length;
      failed += results.filter((r) => !r).length;
      try {
        await this.prisma.reminderSmsLog.createMany({
          data: part.map((c, idx) => ({
            userId: c.id,
            phone: c.mobile,
            status: results[idx] ? 'SENT' : 'FAILED',
            templateId: this.templateId,
            sentAt: new Date(),
            eligibleCount: eligible.length,
            cycleWeeks: weeks,
            nextReminderOn: results[idx] ? new Date(`${nextOn}T00:00:00Z`) : null,
          })),
        });
      } catch (e) {
        this.logger.error(`Could not log reminder SMS: ${(e as Error).message}`);
      }
    }
    this.logger.log(`App reminder SMS sent: ${sent}, failed: ${failed}; ${eligible.length} eligible, round = ${weeks} weeks, next for these on ${nextOn}.`);
    return { ...summary, sent, failed, recipients: [] as SmsRecipient[] };
  }
}
