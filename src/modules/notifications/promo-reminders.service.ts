import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HubsService } from '../hubs/hubs.service';
import { PushService } from './push.service';

/**
 * Two automatic customer pushes (ported from v1):
 *
 *  1. Promo reminders - Sunday, Wednesday and Friday (IST). Each push goes out inside a window, so 10,000 pushes don't
 *     all leave in the same second. Every customer has a fixed slot (from their id), so it is restart-safe:
 *       - 7:00 - 8:00 AM  'morning': regular buyers (daily / weekly / monthly pattern) get a reorder reminder; new
 *         customers (no order yet) get the "add your address and order chicken, mutton, fish" intro
 *       - 10:30 - 11:30 AM 'late':   new customers get one product with its weight and price
 *     Switch off with PROMO_REMINDERS_ENABLED=false.
 *
 *  2. "Tomorrow's plan" - every day at 7:00 PM and 10:00 PM IST, customers with no live order today (and none booked for
 *     tomorrow) are asked to pre-book. TOMORROW_PLAN_ALL_CUSTOMERS=false limits it to customers who cancelled today.
 *     Switch off with TOMORROW_PLAN_REMINDER_ENABLED=false.
 *
 * Nothing is sent to customers who turned off promotional notifications, and the same message is never sent twice
 * (promo_notification_logs). MARKETING_PUSH_ENABLED=false turns both off as well. Like the scheduled plans, the timer only
 * runs in production, or elsewhere with SCHEDULED_NOTIFICATIONS_ENABLED=true.
 */

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const SLOTS = 6; // ticks per window: :00 :10 :20 :30 :40 :50
const PROMO_DAYS = new Set([0, 3, 5]); // Sunday, Wednesday, Friday
const NOT_COUNTED = ['CANCELLED', 'FAILED'] as const;
const NEW_CUSTOMER_WINDOW_DAYS = 60; // new customers get the product offers during their first 60 days
const LAPSED_AFTER_GAPS = 3; // a regular stops being reminded after this many typical gaps (or 14 days)
const INTRO_REPEAT_DAYS = 7; // the intro is sent again only after this many days if they still haven't ordered
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;
const CHUNK = 5000;

export type PromoGroup = 'morning' | 'late';
export type DueJob = { type: 'promo'; group: PromoGroup; slot: number } | { type: 'tomorrow' };

export interface Reminder {
  userId: string;
  tokens: string[];
  title: string;
  body: string;
  kind: string;
}

const MESSAGES = {
  cancelled: {
    title: "Plan tomorrow's order 🥩",
    body: 'Your order today was cancelled. Pre-book fresh chicken, mutton or fish for tomorrow and pick your delivery slot!',
  },
  noorder: {
    title: "Plan tomorrow's meals 🍗",
    body: 'Pre-book fresh meat for tomorrow and choose the delivery slot that suits you. Order now!',
  },
};

// ---------- IST date helpers ----------

export function istParts(now: Date = new Date()) {
  const t = new Date(now.getTime() + IST_MS);
  return { ymd: t.toISOString().slice(0, 10), hour: t.getUTCHours(), minute: t.getUTCMinutes(), dow: t.getUTCDay() };
}
const asDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`); // a @db.Date value
const istDayStart = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);
const addDays = (ymd: string, n: number) => new Date(asDate(ymd).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((asDate(a).getTime() - asDate(b).getTime()) / DAY_MS);

/** What should run at this moment (a once-a-minute check calls this; the caller makes sure each job runs once). */
export function dueJobs(now: Date): DueJob[] {
  const { hour, minute, dow } = istParts(now);
  const jobs: DueJob[] = [];
  if (PROMO_DAYS.has(dow)) {
    if (hour === 7) jobs.push({ type: 'promo', group: 'morning', slot: Math.floor(minute / 10) });
    const late = (hour - 10) * 60 + minute - 30; // 10:30 ... 11:20 -> slots 0..5
    if (late >= 0 && late < SLOTS * 10) jobs.push({ type: 'promo', group: 'late', slot: Math.floor(late / 10) });
  }
  if ((hour === 19 || hour === 22) && minute < 10) jobs.push({ type: 'tomorrow' });
  return jobs;
}

/** A fixed slot 0..5 for a customer, derived from their id. */
export const slotOf = (userId: string) => parseInt(String(userId).replace(/-/g, '').slice(-8), 16) % SLOTS;

const rupees = (value: number) => `₹${Number(value) % 1 === 0 ? Number(value) : Number(value).toFixed(2)}`;
const messageKey = (title: string, body: string) => createHash('sha1').update(`${title}|${body}`).digest('hex').slice(0, 40);
const tokensOf = (pushToken: string | null) =>
  String(pushToken ?? '').split(',').map((t) => t.trim()).filter((t) => EXPO_TOKEN.test(t));
const chunks = <T,>(list: T[], size = CHUNK) => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const emojiFor = (name: string) => {
  const n = String(name || '').toLowerCase();
  if (/fish|salmon|sangara|prawn|crab|seer|surmai|pomfret|anchovy|sardine|shrimp/.test(n)) return '🐟';
  if (/mutton|goat|lamb|keema|liver|brain/.test(n)) return '🥩';
  return '🍗';
};

interface CatalogItem { id: string; name: string; weight: string; price: number; popular: boolean }
const offerText = (p: CatalogItem) => `${p.name}${p.weight ? ` (${p.weight})` : ''} at just ${rupees(p.price)}`;

@Injectable()
export class PromoRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromoRemindersService.name);
  private timer?: NodeJS.Timeout;
  private readonly ran = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly hubs: HubsService,
    private readonly config: ConfigService,
  ) {}

  /** A flag is on unless it is set to false (boolean or string). */
  private flag(name: string): boolean {
    return String(this.config.get(name) ?? 'true').trim().toLowerCase() !== 'false';
  }

  onModuleInit() {
    const flag = process.env.SCHEDULED_NOTIFICATIONS_ENABLED;
    const enabled = flag ? flag === 'true' : process.env.NODE_ENV === 'production';
    if (!enabled) {
      this.logger.log('Promo / tomorrow-plan reminders are off (set SCHEDULED_NOTIFICATIONS_ENABLED=true to turn them on).');
      return;
    }
    this.logger.log(
      `Reminders: promo ${this.flag('PROMO_REMINDERS_ENABLED') ? 'on' : 'OFF'}, tomorrow plan ` +
        `${this.flag('TOMORROW_PLAN_REMINDER_ENABLED') ? 'on' : 'OFF'} (all customers: ${this.flag('TOMORROW_PLAN_ALL_CUSTOMERS')}).`,
    );
    this.timer = setInterval(() => this.tick().catch((e) => this.logger.error(e.message)), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs whatever is due now, once per slot / run (the log table also stops a second server from repeating it). */
  async tick(now: Date = new Date()) {
    if (!this.flag('MARKETING_PUSH_ENABLED')) return;
    const day = istParts(now).ymd;
    for (const job of dueJobs(now)) {
      const key = job.type === 'promo' ? `${day}|promo|${job.group}|${job.slot}` : `${day}|tomorrow|${istParts(now).hour}`;
      if (this.ran.has(key)) continue;
      this.ran.add(key);
      if (this.ran.size > 200) this.ran.delete(this.ran.values().next().value as string);
      try {
        if (job.type === 'promo') {
          if (this.flag('PROMO_REMINDERS_ENABLED')) await this.runPromoReminders({ group: job.group, slot: job.slot, now });
        } else if (this.flag('TOMORROW_PLAN_REMINDER_ENABLED')) {
          await this.runTomorrowPlan({ now });
        }
      } catch (e) {
        this.logger.error(`Reminder job ${key} failed: ${(e as Error).message}`);
      }
    }
  }

  // ---------- shared ----------

  private eligibleCustomers() {
    return this.prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        isActive: true,
        promotionalNotifications: true,
        pushToken: { not: null },
        OR: [{ phone: null }, { phone: { not: { startsWith: 'del_' } } }],
      },
      select: { id: true, pushToken: true, createdAt: true },
    });
  }

  private async sentLogs(userIds: string[], since: string): Promise<{ userId: string; sentOn: Date; kind: string; messageKey: string }[]> {
    try {
      const out: { userId: string; sentOn: Date; kind: string; messageKey: string }[] = [];
      for (const ids of chunks(userIds)) {
        out.push(
          ...(await this.prisma.promoNotificationLog.findMany({
            where: { userId: { in: ids }, sentOn: { gte: asDate(since) } },
            select: { userId: true, sentOn: true, kind: true, messageKey: true },
          })),
        );
      }
      return out;
    } catch (e) {
      // If the log can't be read the duplicate check is skipped rather than blocking the pushes
      this.logger.error(`Could not read promo_notification_logs: ${(e as Error).message}`);
      return [];
    }
  }

  private async deliver(reminders: Reminder[], day: string, type: 'PROMO_REMINDER' | 'TOMORROW_PLAN', kindOf: (r: Reminder) => string) {
    await this.push.sendEach(reminders.map((r) => ({ tokens: r.tokens, title: r.title, body: r.body, data: { route: 'home', type } })));
    try {
      await this.prisma.promoNotificationLog.createMany({
        data: reminders.map((r) => ({ userId: r.userId, sentOn: asDate(day), kind: kindOf(r), messageKey: messageKey(r.title, r.body) })),
      });
    } catch (e) {
      this.logger.error(`Could not log reminders: ${(e as Error).message}`);
    }
  }

  // ---------- tomorrow's plan ----------

  async runTomorrowPlan({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}) {
    const { ymd: today, hour } = istParts(now);
    const tomorrow = addDays(today, 1);
    const runKind = `tomorrow${String(hour).padStart(2, '0')}`; // one log entry per run (7 PM and 10 PM)

    // Orders that belong to today: scheduled for today, or booked today as ASAP (no delivery date)
    const todays = await this.prisma.order.findMany({
      where: {
        OR: [
          { deliveryDate: asDate(today) },
          { deliveryDate: null, createdAt: { gte: istDayStart(today), lt: istDayStart(tomorrow) } },
        ],
      },
      select: { userId: true, status: true },
    });
    const liveToday = new Set<string>();
    const cancelledToday = new Set<string>();
    for (const o of todays) {
      if ((NOT_COUNTED as readonly string[]).includes(o.status)) {
        if (o.status === 'CANCELLED') cancelledToday.add(o.userId);
      } else {
        liveToday.add(o.userId);
      }
    }
    const planned = new Set(
      (
        await this.prisma.order.findMany({
          where: { deliveryDate: asDate(tomorrow), status: { notIn: [...NOT_COUNTED] } },
          select: { userId: true },
        })
      ).map((o) => o.userId),
    );

    const includeAll = this.flag('TOMORROW_PLAN_ALL_CUSTOMERS');
    const customers = await this.eligibleCustomers();
    const logs = await this.sentLogs(customers.map((c) => c.id), today);
    const sentThisRun = new Set(logs.filter((l) => l.kind === runKind && l.sentOn.toISOString().slice(0, 10) === today).map((l) => l.userId));

    const reminders: Reminder[] = [];
    for (const user of customers) {
      if (liveToday.has(user.id) || planned.has(user.id) || sentThisRun.has(user.id)) continue;
      const kind = cancelledToday.has(user.id) ? 'cancelled' : includeAll ? 'noorder' : null;
      if (!kind) continue;
      const tokens = tokensOf(user.pushToken);
      if (!tokens.length) continue;
      reminders.push({ userId: user.id, tokens, kind, ...MESSAGES[kind] });
    }

    const counts = this.count(reminders);
    if (!dryRun && reminders.length) await this.deliver(reminders, today, 'TOMORROW_PLAN', () => runKind);
    this.logger.log(`Tomorrow plan reminders ${dryRun ? 'prepared' : 'sent'}: ${JSON.stringify(counts)}`);
    return { sent: dryRun ? 0 : reminders.length, counts, reminders };
  }

  // ---------- promo reminders ----------

  private count(reminders: Reminder[]) {
    return reminders.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] || 0) + 1 }), {});
  }

  /** Cheapest sellable cut of every active product, with its price. */
  private async loadCatalog(): Promise<CatalogItem[]> {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, variants: { some: { isActive: true, inStock: true } } },
      include: { variants: { where: { isActive: true, inStock: true } } },
    });
    const out: CatalogItem[] = [];
    for (const p of products) {
      const priced = p.variants
        .map((v) => ({ weight: v.weight, price: Number(v.discountedPrice) > 0 ? Number(v.discountedPrice) : Number(v.price) }))
        .filter((v) => v.price > 0)
        .sort((a, b) => a.price - b.price)[0];
      if (priced) out.push({ id: p.id, name: p.name, weight: priced.weight, price: priced.price, popular: p.isPopular });
    }
    return out;
  }

  /** Popular / best-selling products first. */
  private async rankCatalog(catalog: CatalogItem[]) {
    const sold = await this.prisma.$queryRaw<{ product_id: string; qty: bigint }[]>`
      SELECT product_id::text AS product_id, SUM(quantity) AS qty FROM order_items GROUP BY product_id`;
    const qty = new Map(sold.map((s) => [s.product_id, Number(s.qty)]));
    return [...catalog].sort((a, b) => Number(b.popular) - Number(a.popular) || (qty.get(b.id) || 0) - (qty.get(a.id) || 0)).slice(0, 3);
  }

  /** Builds the reminders without sending them. */
  async buildPromoReminders(now: Date = new Date()): Promise<{ skipped?: string; reminders: Reminder[] }> {
    const hubs = await this.hubs.listActive();
    if (hubs.length > 0 && hubs.every((h) => h.ordersPaused)) return { skipped: 'orders paused', reminders: [] };
    const catalog = await this.loadCatalog();
    if (!catalog.length) return { skipped: 'no products in stock', reminders: [] };

    const customers = (await this.eligibleCustomers()).filter((c) => tokensOf(c.pushToken).length > 0);
    if (!customers.length) return { reminders: [] };

    // Only customers in a deliverable pincode: at least one saved address in a hub's list. A hub with an empty list
    // delivers everywhere. Customers with no address yet can't be checked, so they stay in (the push asks for one).
    const deliverable = hubs.some((h) => !h.deliverablePincodes.length)
      ? new Set<string>()
      : new Set(hubs.flatMap((h) => h.deliverablePincodes).map((p) => String(p).trim()));
    const addresses: { userId: string; pincode: string }[] = [];
    for (const ids of chunks(customers.map((c) => c.id))) {
      addresses.push(
        ...(await this.prisma.address.findMany({ where: { userId: { in: ids } }, select: { userId: true, pincode: true }, orderBy: { createdAt: 'asc' } })),
      );
    }
    const hasAddress = new Set<string>();
    const pinByUser = new Map<string, string>(); // first saved address inside the delivery area
    for (const a of addresses) {
      hasAddress.add(a.userId);
      const pin = String(a.pincode || '').trim();
      if ((deliverable.size === 0 || deliverable.has(pin)) && !pinByUser.has(a.userId)) pinByUser.set(a.userId, pin);
    }
    const inArea = customers.filter((c) => !hasAddress.has(c.id) || pinByUser.has(c.id));
    if (!inArea.length) return { reminders: [] };

    // Per customer: how many different IST days they ordered on, first and last
    const stats = await this.prisma.$queryRaw<{ user_id: string; days: number; first_day: string; last_day: string }[]>`
      SELECT user_id::text AS user_id, COUNT(DISTINCT d)::int AS days, MIN(d)::text AS first_day, MAX(d)::text AS last_day
        FROM (SELECT user_id, ("createdAt" AT TIME ZONE 'Asia/Kolkata')::date AS d
                FROM orders WHERE status::text NOT IN ('CANCELLED', 'FAILED')) x
       GROUP BY user_id`;
    const statsByUser = new Map(stats.map((s) => [s.user_id, s]));
    const today = istParts(now).ymd;

    const due: { id: string; pushToken: string | null; cadence: 'daily' | 'weekly' | 'monthly'; sinceLast: number }[] = [];
    const fresh: typeof inArea = [];
    for (const user of inArea) {
      const s = statsByUser.get(user.id);
      if (!s) {
        const ageDays = diffDays(today, istParts(user.createdAt).ymd);
        if (ageDays >= 1 && ageDays <= NEW_CUSTOMER_WINDOW_DAYS) fresh.push(user);
        continue;
      }
      const days = Number(s.days);
      if (days < 3) continue; // not enough history to call them a regular
      const avgGap = Math.max(1, diffDays(s.last_day, s.first_day) / (days - 1));
      const sinceLast = diffDays(today, s.last_day);
      const cadence = avgGap <= 2 ? 'daily' : avgGap <= 10 ? 'weekly' : avgGap <= 45 ? 'monthly' : null;
      if (!cadence) continue;
      const lapsed = sinceLast > Math.max(14, avgGap * LAPSED_AFTER_GAPS);
      const gap = Math.round(avgGap);
      // daily buyers: every run; weekly / monthly: the first run once their usual gap has passed (runs are 2-3 days apart)
      const isDue = cadence === 'daily' ? sinceLast >= 1 : sinceLast >= gap && sinceLast < gap + 3;
      if (isDue && !lapsed) due.push({ id: user.id, pushToken: user.pushToken, cadence, sinceLast });
    }

    const reminders: Reminder[] = [];
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const fallback = await this.rankCatalog(catalog);

    if (due.length) {
      // Each regular's most-ordered product that is still available
      const favourites = await this.prisma.$queryRaw<{ user_id: string; product_id: string; qty: bigint }[]>`
        SELECT o.user_id::text AS user_id, oi.product_id::text AS product_id, SUM(oi.quantity) AS qty
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.user_id = ANY(${due.map((d) => d.id)}::uuid[]) AND o.status::text NOT IN ('CANCELLED', 'FAILED')
         GROUP BY o.user_id, oi.product_id`;
      const favByUser = new Map<string, { product: CatalogItem; qty: number }>();
      for (const f of favourites) {
        const product = byId.get(f.product_id);
        if (!product) continue;
        const current = favByUser.get(f.user_id);
        if (!current || Number(f.qty) > current.qty) favByUser.set(f.user_id, { product, qty: Number(f.qty) });
      }
      for (const d of due) {
        const product = favByUser.get(d.id)?.product || fallback[0];
        if (!product) continue;
        const copy = {
          daily: { title: 'Fresh stock is in today 🍗', body: `Order your usual ${offerText(product)}, delivered fresh.` },
          weekly: { title: 'Time to restock for the week 🥩', body: `It's been ${d.sinceLast} days. ${offerText(product)} - order now!` },
          monthly: { title: 'Your monthly meat run 🥩', body: `It's been a while! ${offerText(product)}. Order now!` },
        }[d.cadence];
        reminders.push({ userId: d.id, tokens: tokensOf(d.pushToken), kind: d.cadence, ...copy });
      }
    }

    if (fresh.length) {
      // What other customers order most in each pincode (address snapshot on delivered / live orders)
      const pincodes = [...new Set([...pinByUser.values()].filter(Boolean))];
      const rankedByPin = new Map<string, CatalogItem[]>();
      if (pincodes.length) {
        const rows = await this.prisma.$queryRaw<{ pincode: string; product_id: string; qty: bigint }[]>`
          SELECT o.address_pincode AS pincode, oi.product_id::text AS product_id, SUM(oi.quantity) AS qty
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE o.address_pincode = ANY(${pincodes}::text[]) AND o.status::text NOT IN ('CANCELLED', 'FAILED')
           GROUP BY o.address_pincode, oi.product_id`;
        const byPin = new Map<string, { product: CatalogItem; qty: number }[]>();
        for (const r of rows) {
          const product = byId.get(r.product_id);
          if (!product) continue;
          const key = String(r.pincode).trim();
          byPin.set(key, [...(byPin.get(key) || []), { product, qty: Number(r.qty) }]);
        }
        for (const [pin, list] of byPin) rankedByPin.set(pin, list.sort((x, y) => y.qty - x.qty).map((x) => x.product));
      }
      const dayIndex = Math.floor(asDate(today).getTime() / DAY_MS);

      for (const user of fresh) {
        const withAddress = pinByUser.has(user.id);
        reminders.push({
          userId: user.id,
          tokens: tokensOf(user.pushToken),
          kind: 'intro',
          title: 'Welcome to Daily Meat 👋',
          body: withAddress
            ? 'Place your first order for yummy chicken 🍗, mutton 🥩 and fish 🐟 - fresh to your door!'
            : 'Add your address and place an order for yummy chicken 🍗, mutton 🥩 and fish 🐟 - fresh to your door!',
        });
        // One item per push: top sellers around them, rotating through the top 3 so it differs between runs
        const local = rankedByPin.get(pinByUser.get(user.id) ?? '') || [];
        const pool = (local.length ? local : fallback).slice(0, 3);
        const product = pool.length ? pool[dayIndex % pool.length] : undefined;
        if (product) {
          reminders.push({
            userId: user.id,
            tokens: tokensOf(user.pushToken),
            kind: 'offer',
            title: local.length ? `Popular near you ${emojiFor(product.name)}` : `Fresh pick today ${emojiFor(product.name)}`,
            body: `${product.name}${product.weight ? ` (${product.weight})` : ''} - ${rupees(product.price)} only`,
          });
        }
      }
    }
    return { reminders };
  }

  /**
   * Sends one group in one slot (or just returns the reminders with dryRun).
   * group: 'morning' (regular buyers + new-customer intro) | 'late' (new-customer product offer) | undefined (all);
   * slot: 0..5 | undefined (all)
   */
  async runPromoReminders({ dryRun = false, group, slot, now = new Date() }: { dryRun?: boolean; group?: PromoGroup; slot?: number; now?: Date } = {}) {
    const built = await this.buildPromoReminders(now);
    if (built.skipped) {
      this.logger.log(`Promo reminders skipped: ${built.skipped}`);
      return { sent: 0, skipped: built.skipped, reminders: [] as Reminder[] };
    }
    let reminders = built.reminders.filter(
      (r) => (!group || (group === 'late') === (r.kind === 'offer')) && (slot === undefined || slotOf(r.userId) === slot),
    );

    // Never repeat a message the same day, and don't repeat the intro within INTRO_REPEAT_DAYS
    const today = istParts(now).ymd;
    if (reminders.length) {
      const logs = await this.sentLogs([...new Set(reminders.map((r) => r.userId))], addDays(today, -INTRO_REPEAT_DAYS));
      const sentToday = new Set(logs.filter((l) => l.sentOn.toISOString().slice(0, 10) === today).map((l) => `${l.userId}|${l.messageKey}`));
      const recentIntro = new Set(logs.filter((l) => l.kind === 'intro').map((l) => l.userId));
      reminders = reminders.filter((r) => !sentToday.has(`${r.userId}|${messageKey(r.title, r.body)}`) && !(r.kind === 'intro' && recentIntro.has(r.userId)));
    }

    if (!dryRun && reminders.length) await this.deliver(reminders, today, 'PROMO_REMINDER', (r) => r.kind);
    const counts = this.count(reminders);
    this.logger.log(`Promo reminders ${dryRun ? 'prepared' : 'sent'}: ${JSON.stringify(counts)}`);
    return { sent: dryRun ? 0 : reminders.length, counts, reminders };
  }
}
