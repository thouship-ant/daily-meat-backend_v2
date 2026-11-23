jest.mock('expo-server-sdk', () => ({ Expo: class { static isExpoPushToken(t: string) { return t.startsWith('ExponentPushToken['); } } }));
import { PushService } from './push.service';

/** Expo refuses a whole request that mixes tokens of different Expo projects: nobody in it is notified. */
describe('PushService with tokens of more than one Expo project', () => {
  const tok = (project: string, n: number) => `ExponentPushToken[${project}-${n}]`;

  const make = (opts: { withDetails: boolean }) => {
    const calls: string[][] = [];
    const svc = new PushService({ get: () => undefined } as any, { purgePushToken: async () => undefined } as any);
    (svc as any).expo = {
      chunkPushNotifications: (m: any[]) => [m],
      chunkPushNotificationReceiptIds: () => [],
      sendPushNotificationsAsync: async (msgs: any[]) => {
        const projects = new Set(msgs.map((m) => /\[(\w+)-/.exec(m.to)![1]));
        if (projects.size > 1) {
          const details: Record<string, string[]> = {};
          for (const m of msgs) (details[/\[(\w+)-/.exec(m.to)![1]] ??= []).push(m.to);
          throw Object.assign(new Error('All push notification messages in the same request must be for the same project'), {
            code: 'PUSH_TOO_MANY_EXPERIENCE_IDS',
            details: opts.withDetails ? details : undefined,
          });
        }
        calls.push(msgs.map((m) => m.to));
        return msgs.map((_m, i) => ({ status: 'ok', id: undefined as any, i }));
      },
    };
    return { svc, calls };
  };
  const payload = { title: 't', body: 'b' };
  const mixed = [tok('customerApp', 1), tok('partnerApp', 1), tok('customerApp', 2), tok('customerApp', 3), tok('partnerApp', 2)];

  it('splits the batch by the projects Expo names, so everyone still gets the notification', async () => {
    const { svc, calls } = make({ withDetails: true });
    const r = await svc.sendWithReport(mixed, payload);
    expect(r.accepted).toBe(5);
    expect(r.failed).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.length).sort()).toEqual([2, 3]);
  });

  it('still delivers to everyone when Expo does not say which tokens conflict (batch is halved until each part is one project)', async () => {
    const { svc, calls } = make({ withDetails: false });
    const r = await svc.sendWithReport(mixed, payload);
    expect(r.accepted).toBe(5);
    expect(r.failed).toBe(0);
    expect(calls.flat().sort()).toEqual([...mixed].sort());
  });

  it('a single-project batch is sent in one request, as before', async () => {
    const { svc, calls } = make({ withDetails: true });
    const r = await svc.sendWithReport([tok('customerApp', 1), tok('customerApp', 2)], payload);
    expect(r.accepted).toBe(2);
    expect(calls).toHaveLength(1);
  });
});
