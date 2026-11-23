jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { MarketingService } from './marketing.service';
import { istWeekday, normalizeWeekdays, runsOn, weekdaysLabel, weekdaysToString } from './weekdays';

describe('plan weekdays', () => {
  it('labels the choice the way the admin reads it', () => {
    expect(weekdaysLabel([])).toBe('Every day');
    expect(weekdaysLabel(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).toBe('Every day');
    expect(weekdaysLabel(['FRI'])).toBe('Every FRI');
    expect(weekdaysLabel(['SUN', 'SAT'])).toBe('Every SAT & SUN');
    expect(weekdaysLabel(['THU', 'MON', 'TUE', 'WED'])).toBe('Every MON-THU');
    expect(weekdaysLabel(['MON', 'WED', 'FRI'])).toBe('Every MON, WED & FRI');
    expect(weekdaysLabel('sat,sun')).toBe('Every SAT & SUN');
  });

  it('stores days in week order, without duplicates or junk; all seven days = every day = empty', () => {
    expect(normalizeWeekdays(['sun', 'FRI', 'fri', 'xyz'])).toEqual(['FRI', 'SUN']);
    expect(weekdaysToString(['SUN', 'SAT'])).toBe('SAT,SUN');
    expect(weekdaysToString(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).toBe('');
    expect(weekdaysToString([])).toBe('');
  });

  it('knows the day of the week in IST (a late-night UTC moment is already the next day in India)', () => {
    expect(istWeekday(new Date('2026-11-27T04:30:00Z'))).toBe('FRI'); // 27 Nov 2026 is a Friday
    expect(istWeekday(new Date('2026-11-27T19:00:00Z'))).toBe('SAT'); // 00:30 IST on Saturday
    expect(istWeekday(new Date('2026-11-29T04:30:00Z'))).toBe('SUN');
  });

  it('runs on the chosen days only; nothing chosen = every day', () => {
    expect(runsOn('', 'MON')).toBe(true);
    expect(runsOn(null, 'SUN')).toBe(true);
    expect(runsOn('FRI', 'FRI')).toBe(true);
    expect(runsOn('FRI', 'SAT')).toBe(false);
    expect(runsOn('SAT,SUN', 'SUN')).toBe(true);
  });
});

describe('scheduled plans send only on their days', () => {
  const make = (weekdays: string) => {
    const sent: any[] = [];
    const plan = { id: 3, name: 'W', title: 'T', body: 'B', audience: 'ALL', inactiveDays: null, hubId: null, windowStart: '10:00', windowEnd: '10:01', weekdays };
    const prisma: any = {
      user: { findMany: async () => [{ pushToken: 'ExponentPushToken[a]' }], count: async () => 0 },
      scheduledNotification: { findMany: async () => [plan], updateMany: async () => ({ count: 1 }), update: async () => undefined },
    };
    const push: any = { sendWithReport: async (...a: any[]) => { sent.push(a); return { tokens: 1, invalid: 0, accepted: 1, failed: 0, errors: {} }; } };
    const svc = new MarketingService(prisma, push, {} as any, { customerScope: async () => undefined } as any, { get: () => undefined } as any);
    return { svc, sent };
  };
  const friday10 = new Date('2026-11-27T04:30:30.000Z'); // Friday 10:00 IST
  const saturday10 = new Date('2026-11-28T04:30:30.000Z');

  it('a Friday plan goes out on Friday', async () => {
    const { svc, sent } = make('FRI');
    await svc.runDuePlans(friday10);
    expect(sent).toHaveLength(1);
  });
  it('a Friday plan stays quiet on Saturday', async () => {
    const { svc, sent } = make('FRI');
    await svc.runDuePlans(saturday10);
    expect(sent).toHaveLength(0);
  });
  it('a plan with no days chosen goes out every day', async () => {
    const { svc, sent } = make('');
    await svc.runDuePlans(saturday10);
    expect(sent).toHaveLength(1);
  });
  it('the plan shown to the admin lists its days and a readable label', () => {
    const { svc } = make('SAT,SUN');
    const shown = (svc as any).present({ id: 3, name: 'W', title: 'T', body: 'B', audience: 'ALL', inactiveDays: null, hubId: null, windowStart: '10:00', windowEnd: '11:00', weekdays: 'SAT,SUN', startDate: new Date('2026-11-20'), endDate: new Date('2026-12-01'), isActive: true, lastSentOn: null, lastSentCount: null, lastErrors: null });
    expect(shown.weekdays).toEqual(['SAT', 'SUN']);
    expect(shown.weekdaysLabel).toBe('Every SAT & SUN');
  });
});
