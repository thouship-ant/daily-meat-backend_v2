jest.mock('expo-server-sdk', () => ({ Expo: class {} })); // ESM-only package: not needed here

import { NotificationsService } from './notifications.service';

function make() {
  const calls: any = { roleOpts: [] as any[], pushed: [] as any[], toUser: [] as any[], saved: [] as any[] };
  const users: any = {
    pushTokensForRole: async (role: string, opts: any) => { calls.roleOpts.push({ role, opts }); return ['tok']; },
    pushTokensForHubAdmins: async () => ['tok'],
    pushTokensForUser: async () => ['tok'],
    idsForRole: async () => ['sa1', 'sa2'],
    idsForAdmins: async () => ['a1', 'sa1'],
    idsForHubAdmins: async () => ['a1'],
    findById: async () => ({ name: 'Ravi', phone: '+919000000001', role: 'DRIVER' }),
  };
  const push: any = { send: async (_t: string[], p: any) => { calls.pushed.push(p); } };
  const realtime: any = { toAdmins: () => undefined, toUser: (id: string, ev: string) => calls.toUser.push([id, ev]) };
  const inbox: any = { record: async (ids: string[], n: any) => { calls.saved.push([ids, n.title]); } };
  return { svc: new NotificationsService(push, realtime, users, inbox), calls };
}

describe('NotificationsService', () => {
  it('new-order alerts do not go to super admins, other admin notices still do', async () => {
    const { svc, calls } = make();
    await svc.toAdmins({ title: 't', body: 'b', event: 'adminNewOrder' });
    await svc.toAdmins({ title: 't', body: 'b', event: 'adminOrderStatusChanged' });
    expect(calls.roleOpts[0].opts.superAdmins).toBe(false);
    expect(calls.roleOpts[1].opts.superAdmins).toBe(true);
  });

  it('tells every super admin about a hanging phone, once per 30 minutes per person', async () => {
    const { svc, calls } = make();
    const first = await svc.reportSlowDevice('u1', { reason: 'app_frozen', seconds: 62 });
    const again = await svc.reportSlowDevice('u1', { reason: 'app_frozen', seconds: 70 });
    expect(first.sent).toBe(true);
    expect(again.sent).toBe(false);
    expect(calls.toUser).toEqual([['sa1', 'deviceSlow'], ['sa2', 'deviceSlow']]);
    expect(calls.pushed[0].title).toBe('Phone slow / hanging');
    expect(calls.pushed[0].body).toContain('Ravi (DRIVER)');
  });

  it('keeps a copy of every notice for the people it was sent to (the bell)', async () => {
    const { svc, calls } = make();
    await svc.toUser('u9', { title: 'Order update', body: 'b' });
    await svc.toAdmins({ title: 'New order', body: 'b', event: 'adminNewOrder' });
    await svc.toHubAdmins(1, { title: 'New application', body: 'b' });
    await svc.toSuperAdmins({ title: 'Slow phone', body: 'b' });
    expect(calls.saved).toEqual([
      [['u9'], 'Order update'],
      [['a1', 'sa1'], 'New order'],
      [['a1'], 'New application'],
      [['sa1', 'sa2'], 'Slow phone'],
    ]);
  });
});
