import { UsersService } from './users.service';

/** An admin creates a driver account; the driver then completes KYC in the app. */
describe('UsersService.createDriver', () => {
  const make = (existing = false) => {
    const profiles: any[] = [];
    const prisma: any = {
      user: {
        findUnique: async () => (existing ? { id: 'x' } : null),
        create: async (args: any) => ({ id: 'd1', ...args.data }),
      },
      driverProfile: { upsert: async (args: any) => void profiles.push(args) },
    };
    const cache: any = { del: async () => undefined, get: async () => null, set: async () => undefined, wrap: async (_k: string, _t: number, f: any) => f() };
    return { service: new UsersService(prisma, cache, { get: () => undefined } as any), profiles };
  };
  const dto = { name: 'Test Driver', phone: '+919000000000', password: 'password123' };

  it('by default the profile stays a DRAFT, so the driver completes KYC in the app', async () => {
    const { service, profiles } = make();
    await service.createDriver(dto, 'admin1');
    expect(profiles[0].create).toEqual({ userId: 'd1' });
  });

  it('without a password the starting password is STAFF_DRIVER_DEFAULT_PASSWORD', async () => {
    const made: any[] = [];
    const prisma: any = { user: { findUnique: async () => null, create: async (a: any) => (made.push(a.data), { id: 'd1' }) }, driverProfile: { upsert: async () => undefined } };
    const cache: any = { del: async () => undefined, get: async () => null, set: async () => undefined, wrap: async (_k: string, _t: number, f: any) => f() };
    const service = new UsersService(prisma, cache, { get: (k: string) => (k === 'STAFF_DRIVER_DEFAULT_PASSWORD' ? 'Starter@123' : undefined) } as any);
    await service.createDriver({ name: 'A', phone: '+919000000001' });
    expect(await require('bcrypt').compare('Starter@123', made[0].password)).toBe(true);
  });

  it('refuses a phone number that already has an account', async () => {
    const { service } = make(true);
    await expect(service.createDriver(dto)).rejects.toThrow();
  });
});
