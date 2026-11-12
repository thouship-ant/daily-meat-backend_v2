import { StaffService } from './staff.service';

function make(existing: any = null, target: any = existing, hubs: { id: number }[] = [{ id: 1 }]) {
  const created: any[] = [];
  const updated: any[] = [];
  const profiles: string[] = [];
  const prisma: any = {
    hub: {
      findUnique: async ({ where }: any) => hubs.find((h) => h.id === where.id) ?? null,
      findMany: async () => hubs,
    },
    user: {
      findUnique: async ({ where }: any) => (where.phone && existing && existing.phone === where.phone ? existing : null),
    },
  };
  const users: any = {
    create: async (data: any) => { created.push(data); return { id: 'new', createdAt: new Date(), ...data }; },
    update: async (id: string, data: any) => { updated.push({ id, data }); return { ...(existing ?? {}), id, ...data }; },
    getById: async () => target,
    ensureDriverProfile: async (id: string) => { profiles.push(id); },
  };
  const config: any = { get: () => undefined };
  return { svc: new StaffService(prisma, users, config), created, updated, profiles };
}

describe('StaffService', () => {
  it('uses the right starting password per role', () => {
    const { svc } = make();
    expect(svc.passwordFor('ADMIN')).toBe('DAS@3781');
    expect(svc.passwordFor('DRIVER')).toBe('Dvr@7939');
    expect(svc.passwordFor('CUSTOMER')).toBeNull();
  });

  it('creates a new number with the first role as primary and the rest as extra', async () => {
    const { svc, created } = make();
    const r = await svc.addNumber({ phone: '+919000000001', name: 'Ravi', roles: ['CUSTOMER', 'ADMIN'] });
    expect(r.created).toBe(true);
    expect(created[0]).toMatchObject({ role: 'ADMIN', additionalRoles: ['CUSTOMER'] });
    expect(created[0].password).toMatch(/^\$2[aby]\$/); // hashed
  });

  it('adds roles to a number that already exists, keeping its primary role', async () => {
    const { svc, updated } = make({ id: 'u1', phone: '+919000000002', role: 'CUSTOMER', additionalRoles: [], password: null, name: null });
    const r = await svc.addNumber({ phone: '+919000000002', roles: ['DRIVER'] });
    expect(r.created).toBe(false);
    expect(updated[0].data.additionalRoles).toEqual(['DRIVER']);
    expect(updated[0].data.password).toBeDefined(); // had none: driver starting password
  });

  it('rejects a phone that another account uses, and never edits a super admin', async () => {
    const { svc } = make({ id: 'u1', phone: '+919000000003', role: 'ADMIN' }, { id: 'u2', phone: '+919000000009', role: 'DRIVER' });
    await expect(svc.updateProfile('u2', { phone: '+919000000003' })).rejects.toThrow(/already uses/);
    const sa = make({ id: 's', phone: '+919000000004', role: 'SUPERADMIN' });
    await expect(sa.svc.updateProfile('s', { name: 'x' })).rejects.toThrow();
    await expect(sa.svc.resetPassword('s')).rejects.toThrow();
  });

  it('reset password ends sessions and refuses customers', async () => {
    const ok = make({ id: 'd', phone: '+919000000005', role: 'DRIVER' });
    await ok.svc.resetPassword('d');
    expect(ok.updated[0].data.refreshToken).toBeNull();
    expect(ok.updated[0].data.password).toMatch(/^\$2[aby]\$/);
    const cust = make({ id: 'c', phone: '+919000000006', role: 'CUSTOMER' });
    await expect(cust.svc.resetPassword('c')).rejects.toThrow(/no password/);
  });

  it('sets extra roles on a super admin / admin, never the main role, and only signs out when a role is removed', async () => {
    const sa = make({ id: 's', phone: '+919000000010', role: 'SUPERADMIN', additionalRoles: ['ADMIN', 'DRIVER'], password: 'x' });
    await sa.svc.updateProfile('s', { additionalRoles: ['ADMIN', 'CUSTOMER'] }, 'someone-else');
    expect(sa.updated[0].data.additionalRoles).toEqual(['ADMIN', 'CUSTOMER']);
    expect(sa.updated[0].data.refreshToken).toBeNull(); // DRIVER was removed -> signed out

    const add = make({ id: 'a', phone: '+919000000011', role: 'ADMIN', additionalRoles: [], password: 'x' });
    await add.svc.updateProfile('a', { additionalRoles: ['ADMIN', 'DRIVER'] }, 'someone-else');
    expect(add.updated[0].data.additionalRoles).toEqual(['DRIVER']); // ADMIN is already the main role
    expect(add.updated[0].data.refreshToken).toBeUndefined(); // nothing removed

    const self = make({ id: 'z', phone: '+919000000012', role: 'SUPERADMIN', additionalRoles: ['DRIVER'], password: 'x' });
    await self.svc.updateProfile('z', { additionalRoles: [] }, 'z'); // editing yourself must not sign you out
    expect(self.updated[0].data.refreshToken).toBeUndefined();

    const drv = make({ id: 'd', phone: '+919000000013', role: 'DRIVER' });
    await expect(drv.svc.updateProfile('d', { additionalRoles: ['CUSTOMER'] })).rejects.toThrow(/Admin and Super Admin/);
  });

  it('puts a new Admin / Driver on the only hub, but leaves the hub empty when there are several and none is chosen', async () => {
    const one = make();
    await one.svc.addNumber({ phone: '+919000000020', roles: ['DRIVER'] });
    expect(one.created[0].hub).toEqual({ connect: { id: 1 } });

    const many = make(null, null, [{ id: 1 }, { id: 2 }]);
    await many.svc.addNumber({ phone: '+919000000021', roles: ['ADMIN'] });
    expect(many.created[0].hub).toBeUndefined();
    await many.svc.addNumber({ phone: '+919000000022', roles: ['ADMIN'], hubId: 2 });
    expect(many.created[1].hub).toEqual({ connect: { id: 2 } });

    const cust = make();
    await cust.svc.addNumber({ phone: '+919000000023', roles: ['CUSTOMER'] });
    expect(cust.created[0].hub).toBeUndefined();
  });

  it('sets / clears the hub of an Admin or Driver, rejects an unknown hub and super admins', async () => {
    const a = make({ id: 'a', phone: '+919000000024', role: 'ADMIN' });
    await a.svc.updateProfile('a', { hubId: 1 });
    expect(a.updated[0].data.hub).toEqual({ connect: { id: 1 } });
    await a.svc.updateProfile('a', { hubId: null });
    expect(a.updated[1].data.hub).toEqual({ disconnect: true });
    await expect(a.svc.updateProfile('a', { hubId: 99 })).rejects.toThrow();
    const sa = make({ id: 's', phone: '+919000000025', role: 'SUPERADMIN' });
    await expect(sa.svc.updateProfile('s', { hubId: 1 })).rejects.toThrow(/Admin or a Driver/);
  });

  it('a number that becomes a Driver for the first time starts onboarding; one that is already a Driver does not', async () => {
    const fresh = make();
    await fresh.svc.addNumber({ phone: '+919000000030', roles: ['DRIVER'] });
    expect(fresh.profiles).toEqual(['new']);

    const customer = make({ id: 'c1', phone: '+919000000031', role: 'CUSTOMER', additionalRoles: [], password: null });
    await customer.svc.addNumber({ phone: '+919000000031', roles: ['DRIVER'] });
    expect(customer.profiles).toEqual(['c1']);

    const already = make({ id: 'd1', phone: '+919000000032', role: 'DRIVER', additionalRoles: [], password: 'x' });
    await already.svc.addNumber({ phone: '+919000000032', roles: ['DRIVER'] });
    expect(already.profiles).toEqual([]);
  });

  it('an empty STAFF_*_DEFAULT_PASSWORD setting falls back to the built-in password, never an empty one', () => {
    const prisma: any = {};
    const config: any = { get: () => '' }; // what the container gives for a variable that is set but empty
    const svc = new StaffService(prisma, {} as any, config);
    expect(svc.passwordFor('ADMIN')).toBe('DAS@3781');
    expect(svc.passwordFor('DRIVER')).toBe('Dvr@7939');
  });
});
