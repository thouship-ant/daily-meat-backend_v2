jest.mock('expo-server-sdk', () => ({ Expo: class {} })); // ESM-only package pulled in through the push service

import { MarketingService } from './marketing.service';

function make(flag: unknown) {
  const sent: any[] = [];
  const prisma: any = { user: { findMany: async () => [{ pushToken: 'ExponentPushToken[a]' }] } };
  const push: any = { send: async (...a: any[]) => { sent.push(a); } };
  const hubs: any = { customerScope: async () => undefined };
  const config: any = { get: (k: string) => (k === 'MARKETING_PUSH_ENABLED' ? flag : undefined) };
  return { svc: new MarketingService(prisma, push, {} as any, hubs, config), sent };
}

describe('Marketing Broadcast flag', () => {
  it('sends when the flag is on, unset, or the string "true"', async () => {
    for (const flag of [true, undefined, 'true']) {
      const { svc, sent } = make(flag);
      const r: any = await svc.broadcast({ title: 'Hi', body: 'There' });
      await new Promise((res) => setTimeout(res, 5)); // the send runs in the background
      expect(r.devices).toBe(1);
      expect(sent).toHaveLength(1);
    }
  });

  it('sends nothing and says so when the flag is false (boolean or string)', async () => {
    for (const flag of [false, 'false', 'FALSE']) {
      const { svc, sent } = make(flag);
      const r: any = await svc.broadcast({ title: 'Hi', body: 'There' });
      await new Promise((res) => setTimeout(res, 5));
      expect(r).toMatchObject({ enabled: false, devices: 0, customers: 0 });
      expect(r.message).toMatch(/turned off/);
      expect(sent).toHaveLength(0);
    }
  });

  it('scheduled plans do not go out while the flag is off', async () => {
    const found: any[] = [];
    const prisma: any = { scheduledNotification: { findMany: async (a: any) => { found.push(a); return []; } } };
    const config: any = { get: () => 'false' };
    const svc = new MarketingService(prisma, {} as any, {} as any, {} as any, config);
    await svc.runDuePlans();
    expect(found).toHaveLength(0); // it did not even look for plans
  });
});
