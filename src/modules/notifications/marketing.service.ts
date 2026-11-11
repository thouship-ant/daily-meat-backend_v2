import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ScheduledNotification } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HubsService } from '../hubs/hubs.service';
import { UsersService } from '../users/users.service';
import { PushService } from './push.service';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const IST_MS = 330 * 60_000;

export interface PlanInput {
  name?: string;
  title?: string;
  body?: string;
  audience?: string;
  inactiveDays?: number | null;
  startDate?: string;
  endDate?: string;
  windowStart?: string;
  windowEnd?: string;
  isActive?: boolean;
  hubId?: number | null;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Same minute for a plan on a given day on every run/server: one moment inside its range, different each day. */
export function sendMinuteFor(plan: { id: number; windowStart: string; windowEnd: string }, day: string): number {
  const start = toMinutes(plan.windowStart);
  const end = toMinutes(plan.windowEnd);
  if (end <= start) return start;
  let hash = 2166136261;
  for (const ch of `${plan.id}-${day}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822519) >>> 0;
  hash ^= hash >>> 13;
  return start + ((hash >>> 0) % (end - start));
}

/** Promotional pushes: the admin "Marketing Broadcast" and the scheduled plans (message + dates + IST time range). */
@Injectable()
export class MarketingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketingService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly users: UsersService,
    private readonly hubs: HubsService,
  ) {}

  // The plans are sent by a once-a-minute check. It is on in production, and elsewhere only when
  // SCHEDULED_NOTIFICATIONS_ENABLED=true, so a development copy of real data never pushes to real phones.
  onModuleInit() {
    const flag = process.env.SCHEDULED_NOTIFICATIONS_ENABLED;
    const enabled = flag ? flag === 'true' : process.env.NODE_ENV === 'production';
    if (!enabled) {
      this.logger.log('Scheduled notifications are off (set SCHEDULED_NOTIFICATIONS_ENABLED=true to turn them on).');
      return;
    }
    this.timer = setInterval(() => this.runDuePlans().catch((e) => this.logger.error(e.message)), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- audience + sending ----------

  async audienceTokens(target: string = 'ALL', inactiveDays?: number, hubId?: number | null) {
    const scope = await this.hubs.customerScope(hubId);
    const cutoff = new Date(Date.now() - (Number(inactiveDays) || 14) * 86_400_000);
    const customers = await this.prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        isActive: true,
        promotionalNotifications: true,
        pushToken: { not: null },
        OR: [{ phone: null }, { phone: { not: { startsWith: 'del_' } } }],
        ...(target === 'INACTIVE' ? { orders: { none: { createdAt: { gte: cutoff } } } } : {}),
        ...(scope ? { AND: [scope] } : {}),
      },
      select: { pushToken: true },
    });
    const tokens = new Set<string>();
    for (const c of customers) {
      for (const t of String(c.pushToken ?? '').split(',').map((x) => x.trim())) if (t) tokens.add(t);
    }
    return { customers: customers.length, tokens: [...tokens] };
  }

  /** Counts the audience, answers straight away and sends in the background (many Expo requests). */
  async broadcast(input: { target?: string; inactiveDays?: number; title: string; body: string; hubId?: number }) {
    const target = input.target === 'INACTIVE' ? 'INACTIVE' : 'ALL';
    const { tokens, customers } = await this.audienceTokens(target, input.inactiveDays, input.hubId);
    if (!tokens.length) {
      return { message: 'No customers with a registered device matched, so nothing was sent.', devices: 0, customers };
    }
    this.push
      .send(tokens, { title: input.title, body: input.body, data: { route: 'home', type: 'MARKETING' } })
      .then(() => this.logger.log(`Broadcast "${input.title}" sent to ${tokens.length} devices (${customers} customers).`))
      .catch((e) => this.logger.error(`Broadcast failed: ${e.message}`));
    return { message: `Broadcast is being sent to ${tokens.length} devices of ${customers} customers.`, devices: tokens.length, customers };
  }

  /** Preview: the admins' devices only. */
  async sendToAdmins(title: string, body: string) {
    const tokens = await this.users.pushTokensForRole('ADMIN');
    if (tokens.length) await this.push.send(tokens, { title, body, data: { route: 'home', type: 'MARKETING' } });
    return { devices: tokens.length };
  }

  // ---------- plans ----------

  private present(p: ScheduledNotification) {
    return {
      id: p.id, name: p.name, title: p.title, body: p.body, audience: p.audience, inactiveDays: p.inactiveDays,
      startDate: ymd(p.startDate), endDate: ymd(p.endDate), windowStart: p.windowStart, windowEnd: p.windowEnd,
      isActive: p.isActive, hubId: p.hubId, lastSentOn: p.lastSentOn ? ymd(p.lastSentOn) : null, lastSentCount: p.lastSentCount,
    };
  }

  private validate(p: PlanInput, requireAll: boolean) {
    const bad = (m: string) => ApiException.badRequest('INVALID_PLAN', m);
    if (requireAll) {
      for (const f of ['name', 'title', 'body', 'startDate', 'endDate', 'windowStart', 'windowEnd'] as const) {
        if (!p[f]) throw bad(`${f} is required.`);
      }
    }
    if (p.startDate && !YMD.test(p.startDate)) throw bad('startDate must be YYYY-MM-DD.');
    if (p.endDate && !YMD.test(p.endDate)) throw bad('endDate must be YYYY-MM-DD.');
    if (p.startDate && p.endDate && p.endDate < p.startDate) throw bad('endDate cannot be before startDate.');
    if (p.windowStart && !HHMM.test(p.windowStart)) throw bad('windowStart must be HH:mm (24-hour, IST).');
    if (p.windowEnd && !HHMM.test(p.windowEnd)) throw bad('windowEnd must be HH:mm (24-hour, IST).');
    if (p.windowStart && p.windowEnd && p.windowEnd <= p.windowStart) throw bad('The end of the time range must be after its start.');
  }

  private data(p: PlanInput) {
    const out: Record<string, unknown> = {};
    for (const f of ['name', 'title', 'body', 'inactiveDays', 'windowStart', 'windowEnd', 'isActive'] as const) {
      if (p[f] !== undefined) out[f] = p[f];
    }
    if (p.hubId !== undefined) out.hubId = p.hubId;
    if (p.audience !== undefined) out.audience = p.audience === 'INACTIVE' ? 'INACTIVE' : 'ALL';
    if (p.startDate) out.startDate = new Date(`${p.startDate}T00:00:00.000Z`);
    if (p.endDate) out.endDate = new Date(`${p.endDate}T00:00:00.000Z`);
    return out;
  }

  async listPlans(hubId?: number) {
    const plans = await this.prisma.scheduledNotification.findMany({ where: hubId != null ? { hubId } : {}, orderBy: [{ startDate: 'desc' }, { id: 'asc' }] });
    return plans.map((p) => this.present(p));
  }

  async createPlan(input: PlanInput) {
    this.validate(input, true);
    return this.present(await this.prisma.scheduledNotification.create({ data: this.data(input) as any }));
  }

  private async plan(id: number) {
    const p = await this.prisma.scheduledNotification.findUnique({ where: { id } });
    if (!p) throw ApiException.notFound('Scheduled notification');
    return p;
  }

  async updatePlan(id: number, patch: PlanInput) {
    const current = await this.plan(id);
    this.validate({ ...this.present(current), ...patch } as PlanInput, false);
    const data = this.data(patch);
    // moving the dates / time range / text makes the plan eligible again today
    if (['startDate', 'endDate', 'windowStart', 'windowEnd', 'title', 'body'].some((k) => data[k] !== undefined)) data.lastSentOn = null;
    return this.present(await this.prisma.scheduledNotification.update({ where: { id }, data }));
  }

  async deletePlan(id: number) {
    await this.plan(id);
    await this.prisma.scheduledNotification.delete({ where: { id } });
  }

  async testPlan(id: number) {
    const p = await this.plan(id);
    const { devices } = await this.sendToAdmins(p.title, p.body);
    return { message: devices ? `Test sent to ${devices} admin device(s).` : 'No admin device is registered for push.', devices };
  }

  // ---------- the minute check ----------

  async runDuePlans(now = new Date()) {
    const ist = new Date(now.getTime() + IST_MS);
    const today = ist.toISOString().slice(0, 10);
    const minuteNow = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const day = new Date(`${today}T00:00:00.000Z`);
    const plans = await this.prisma.scheduledNotification.findMany({
      where: { isActive: true, startDate: { lte: day }, endDate: { gte: day }, OR: [{ lastSentOn: null }, { lastSentOn: { not: day } }] },
    });
    for (const plan of plans) {
      const at = sendMinuteFor(plan, today);
      if (!(minuteNow >= at && minuteNow < Math.max(toMinutes(plan.windowEnd), at + 1))) continue;
      // claim today's send first: if another instance did, nothing changes and we skip
      const claimed = await this.prisma.scheduledNotification.updateMany({
        where: { id: plan.id, OR: [{ lastSentOn: null }, { lastSentOn: { not: day } }] },
        data: { lastSentOn: day },
      });
      if (!claimed.count) continue;
      try {
        const { tokens, customers } = await this.audienceTokens(plan.audience, plan.inactiveDays ?? undefined, plan.hubId);
        if (tokens.length) {
          await this.push.send(tokens, { title: plan.title, body: plan.body, data: { route: 'home', type: 'SCHEDULED', planId: plan.id } });
        }
        await this.prisma.scheduledNotification.update({ where: { id: plan.id }, data: { lastSentCount: tokens.length } });
        this.logger.log(`Scheduled "${plan.name}" sent to ${tokens.length} devices (${customers} customers).`);
      } catch (e) {
        this.logger.error(`Scheduled "${plan.name}" failed: ${(e as Error).message}`);
      }
    }
  }
}
