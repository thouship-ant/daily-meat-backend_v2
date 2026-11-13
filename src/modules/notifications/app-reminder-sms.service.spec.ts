jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import {
  AppReminderSmsService, APP_REMINDER_TEMPLATE, appReminderMessage, indianMobile, isAppReminderDue, nextRound, smsName,
} from './app-reminder-sms.service';

const ist = (s: string) => new Date(`${s}:00+05:30`); // 2026-11-15 is a Sunday

describe('App reminder SMS - text and numbers', () => {
  it('is the approved DLT template with the name in place of {#alp#}', () => {
    expect(appReminderMessage('Hasar')).toBe(APP_REMINDER_TEMPLATE.replace('{#alp#}', 'Hasar'));
    expect(appReminderMessage('Hasar')).toMatch(/^Dear Hasar, We have made Daily Meat faster and smoother for you\./);
    expect(appReminderMessage('Hasar')).toContain('https://dailymeat.in');
    expect(appReminderMessage('Hasar')).not.toContain('{#alp#}');
  });
  it('cleans the name: allowed characters only, 30 max, "Customer" when empty', () => {
    expect(smsName('  Mohamed   Thouship ')).toBe('Mohamed Thouship');
    expect(smsName('A'.repeat(50))).toHaveLength(30);
    expect(smsName('R@m*sh<b>')).toBe('R m sh b');
    expect(smsName(null)).toBe('Customer');
    expect(smsName('###')).toBe('Customer');
  });
  it('accepts Indian mobiles only', () => {
    expect(indianMobile('+918072535572')).toBe('8072535572');
    expect(indianMobile('918072535572')).toBe('8072535572');
    expect(indianMobile('8072535572')).toBe('8072535572');
    expect(indianMobile('1234567890')).toBeNull();
    expect(indianMobile('del_123')).toBeNull();
    expect(indianMobile(null)).toBeNull();
  });
});

describe('App reminder SMS - schedule and round', () => {
  it('is due only on Sunday 8:00 - 8:09 AM IST', () => {
    expect(isAppReminderDue(ist('2026-11-15T08:00'))).toBe(true);
    expect(isAppReminderDue(ist('2026-11-15T08:09'))).toBe(true);
    expect(isAppReminderDue(ist('2026-11-15T08:10'))).toBe(false);
    expect(isAppReminderDue(ist('2026-11-15T07:59'))).toBe(false);
    expect(isAppReminderDue(ist('2026-11-16T08:00'))).toBe(false); // Monday
  });

  it('800 eligible, 50 per run = 16 weeks, due again 7 March 2027', () => {
    expect(nextRound(800, 50, '2026-11-15')).toEqual({ weeks: 16, nextOn: '2027-03-07' });
  });
  it('rounds the weeks up and never goes below 1', () => {
    expect(nextRound(801, 50, '2026-11-15').weeks).toBe(17);
    expect(nextRound(20, 50, '2026-11-15')).toEqual({ weeks: 1, nextOn: '2026-11-22' });
    expect(nextRound(0, 50, '2026-11-15').weeks).toBe(1);
  });
});

/** In-memory stand-ins for the users table and reminder_sms_logs. */
function make(opts: { users?: any[]; sendOk?: boolean | ((n: string) => boolean); flags?: Record<string, unknown> } = {}) {
  const sms: { phone: string; template: string; text: string }[] = [];
  const logs: any[] = [];
  let where: any;
  const prisma: any = {
    user: { findMany: async (a: any) => { where = a.where; return opts.users ?? []; } },
    reminderSmsLog: { createMany: async (a: any) => { logs.push(...a.data); } },
    // DISTINCT ON (user_id) ... latest SENT row per user
    $queryRaw: async (_sql: any, ids: string[]) => {
      const latest = new Map<string, any>();
      for (const l of logs.filter((x) => x.status === 'SENT' && ids.includes(x.userId))) {
        const cur = latest.get(l.userId);
        if (!cur || l.sentAt > cur.sentAt) latest.set(l.userId, l);
      }
      return [...latest.values()].map((l) => ({ user_id: l.userId, sent_at: l.sentAt, next_on: l.nextReminderOn ? l.nextReminderOn.toISOString().slice(0, 10) : null }));
    },
  };
  const messaging: any = {
    sendTemplateSms: async (phone: string, template: string, text: string) => {
      sms.push({ phone, template, text });
      return typeof opts.sendOk === 'function' ? opts.sendOk(phone) : opts.sendOk ?? true;
    },
  };
  const config: any = { get: (k: string) => opts.flags?.[k] };
  return { svc: new AppReminderSmsService(prisma, messaging, config), sms, logs, where: () => where };
}
const user = (id: string, phone: string | null, name = 'Hasar', created = 0) => ({ id, name, phone, createdAt: new Date(2026, 0, 1 + created) });
const phone = (n: number) => `+9198765${String(10000 + n).slice(-5)}`;
const crowd = (n: number) => Array.from({ length: n }, (_, i) => user(`u${String(i).padStart(3, '0')}`, phone(i), `Customer ${i}`, i));
const sunday = ist('2026-11-15T08:00');
const sundayAfter = (weeks: number) => new Date(sunday.getTime() + weeks * 7 * 86_400_000);

describe('App reminder SMS - who is eligible', () => {
  it('active customers with no push device who have not opened the app for 7 days', async () => {
    const { svc, where } = make();
    await svc.audience(sunday);
    const w = where();
    expect(w).toMatchObject({ role: 'CUSTOMER', isActive: true, promotionalNotifications: true });
    expect(JSON.stringify(w)).toContain('"pushToken":null');
    const cutoff = new Date(w.AND[2].OR[1].lastActiveAt.lt).getTime();
    expect(Math.round((sunday.getTime() - cutoff) / 86_400_000)).toBe(7);
  });
});

describe('App reminder SMS - sending and logging', () => {
  it('sends the template with the right id, number and name and logs date/time, result and next date', async () => {
    const { svc, sms, logs } = make({ users: [user('u1', '+918072535572', 'Hasar'), user('u2', '+919876543210', '')] });
    const r = await svc.run({ now: sunday });
    expect(r).toMatchObject({ sent: 2, failed: 0, eligible: 2, weeks: 1, nextReminderOn: '2026-11-22' });
    expect(sms[0]).toMatchObject({ phone: '8072535572', template: '1777179455851148185' });
    expect(sms[0].text).toBe(appReminderMessage('Hasar'));
    expect(sms[1].text).toContain('Dear Customer,');
    expect(logs[0]).toMatchObject({ userId: 'u1', phone: '8072535572', status: 'SENT', eligibleCount: 2, cycleWeeks: 1 });
    expect(logs[0].sentAt).toBeInstanceOf(Date);
    expect(logs[0].nextReminderOn.toISOString().slice(0, 10)).toBe('2026-11-22');
  });

  it('skips numbers that are not Indian mobiles', async () => {
    const { svc, sms } = make({ users: [user('u1', '+918072535572'), user('u2', 'del_55')] });
    await svc.run({ now: sunday });
    expect(sms.map((s) => s.phone)).toEqual(['8072535572']);
  });

  it('logs a failed send without a next date, and retries that customer the next Sunday', async () => {
    const failing = phone(0).replace('+91', '');
    const a = make({ users: crowd(120), sendOk: (n) => n !== failing });
    const r = await a.svc.run({ now: sunday });
    expect(r).toMatchObject({ sent: 49, failed: 1 });
    expect(a.logs.find((l) => l.userId === 'u000')).toMatchObject({ status: 'FAILED', nextReminderOn: null });
    a.sms.length = 0;
    await a.svc.run({ now: sundayAfter(1) });
    expect(a.sms[0].phone).toBe(failing); // never successfully reminded, so first in the queue next Sunday
    expect(a.sms).toHaveLength(50);
  });

  it('dry run sends and logs nothing', async () => {
    const { svc, sms, logs } = make({ users: crowd(3) });
    const r = await svc.run({ dryRun: true, now: sunday });
    expect(r.recipients).toHaveLength(3);
    expect(sms).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });
});

describe('App reminder SMS - 50 per Sunday rotation', () => {
  it('sends to 50 customers a week, the next 50 the week after, and comes back to the first 50 after the round', async () => {
    const { svc, sms, logs } = make({ users: crowd(120) }); // 120 eligible / 50 = 3 weeks
    const week = async (n: number) => {
      sms.length = 0;
      const r = await svc.run({ now: sundayAfter(n) });
      return { r, ids: logs.filter((l) => l.status === 'SENT').slice(-r.sent).map((l) => l.userId) };
    };
    const w0 = await week(0);
    expect(w0.r).toMatchObject({ sent: 50, eligible: 120, due: 120, weeks: 3, nextReminderOn: '2026-12-06' });
    expect(w0.ids[0]).toBe('u000');
    expect(w0.ids[49]).toBe('u049');

    const w1 = await week(1);
    expect(w1.r).toMatchObject({ sent: 50, due: 70 });
    expect(w1.ids[0]).toBe('u050');
    expect(w1.ids[49]).toBe('u099');

    const w2 = await week(2);
    expect(w2.r).toMatchObject({ sent: 20, due: 20 }); // the last 20 customers
    expect(w2.ids[0]).toBe('u100');

    const w3 = await week(3); // the first 50 are due again, exactly 3 weeks after they were sent
    expect(w3.r).toMatchObject({ sent: 50, due: 50 });
    expect(w3.ids[0]).toBe('u000');
    expect(w3.ids[49]).toBe('u049');
  });

  it('a customer who becomes eligible later joins the queue ahead of those already reminded', async () => {
    const users = crowd(60);
    const { svc, sms } = make({ users });
    await svc.run({ now: sunday }); // u000..u049 reminded
    users.push(user('uNEW', '+919000000001', 'New One', 999)); // uninstalled in the meantime
    sms.length = 0;
    await svc.run({ now: sundayAfter(1) });
    expect(sms).toHaveLength(11); // u050..u059 and the new customer
    expect(sms.some((s) => s.phone === '9000000001')).toBe(true);
  });

  it('the weekly size can be changed with APP_REMINDER_SMS_PER_RUN', async () => {
    const { svc } = make({ users: crowd(30), flags: { APP_REMINDER_SMS_PER_RUN: 10 } });
    expect(await svc.run({ now: sunday })).toMatchObject({ sent: 10, weeks: 3 });
  });
});

describe('App reminder SMS - tick', () => {
  it('runs once on Sunday 8 AM, not at other times, and not when switched off', async () => {
    const a = make({ users: [user('u1', '+918072535572')] });
    await a.svc.tick(sunday);
    await a.svc.tick(ist('2026-11-15T08:01'));
    expect(a.sms).toHaveLength(1);
    const b = make({ users: [user('u1', '+918072535572')] });
    await b.svc.tick(ist('2026-11-16T08:00'));
    expect(b.sms).toHaveLength(0);
    const c = make({ users: [user('u1', '+918072535572')], flags: { APP_REMINDER_SMS_ENABLED: 'false' } });
    await c.svc.tick(sunday);
    expect(c.sms).toHaveLength(0);
  });
});
