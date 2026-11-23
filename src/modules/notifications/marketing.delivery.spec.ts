jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { MarketingService } from './marketing.service';

/** A scheduled plan keeps how its last send went: who Expo accepted, who it rejected (and why), who could not be reached. */
describe('Scheduled plan delivery info', () => {
  const plan = { id: 7, name: 'Weekend', title: 'T', body: 'B', audience: 'ALL', inactiveDays: null, hubId: null, windowStart: '10:00', windowEnd: '10:01' };

  const make = (report: any) => {
    const updates: any[] = [];
    const prisma: any = {
      user: { findMany: async () => [{ pushToken: 'a' }, { pushToken: 'b' }, { pushToken: 'c' }], count: async () => 4 },
      scheduledNotification: {
        findMany: async () => [plan],
        updateMany: async () => ({ count: 1 }),
        update: async (a: any) => void updates.push(a.data),
      },
    };
    const push: any = { sendWithReport: async () => report };
    const hubs: any = { customerScope: async () => undefined };
    const config: any = { get: () => undefined };
    return { svc: new MarketingService(prisma, push, {} as any, hubs, config), updates };
  };

  it('stores accepted / rejected (with reasons) / invalid / without-device counts after a send', async () => {
    const { svc, updates } = make({ tokens: 3, invalid: 1, accepted: 1, failed: 1, errors: { DeviceNotRegistered: 1 } });
    // 10:00 IST on a day inside the plan: the minute check sends it
    await svc.runDuePlans(new Date('2026-11-24T04:30:30.000Z'));
    const data = updates.find((u) => u.lastAccepted !== undefined);
    expect(data).toMatchObject({ lastSentCount: 3, lastCustomers: 3, lastAccepted: 1, lastRejected: 1, lastInvalid: 1, lastNoDevice: 4 });
    expect(data.lastErrors).toEqual([{ reason: 'DeviceNotRegistered', count: 1 }]);
  });

  it('the plan shown to the admin carries those numbers', async () => {
    const { svc } = make({});
    const shown = (svc as any).present({
      ...plan, startDate: new Date('2026-11-20'), endDate: new Date('2026-11-30'), isActive: true, lastSentOn: new Date('2026-11-24'), lastSentCount: 3,
      lastCustomers: 3, lastAccepted: 1, lastRejected: 1, lastInvalid: 1, lastNoDevice: 4, lastErrors: [{ reason: 'DeviceNotRegistered', count: 1 }],
    });
    expect(shown).toMatchObject({ lastCustomers: 3, lastAccepted: 1, lastRejected: 1, lastInvalid: 1, lastNoDevice: 4 });
    expect(shown.lastErrors).toEqual([{ reason: 'DeviceNotRegistered', count: 1 }]);
  });
});
