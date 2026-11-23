import { UsersService } from './users.service';

/** An admin can create a driver who must still do KYC (default) or one that is approved straight away (skipKyc). */
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

  it('skipKyc creates the profile already APPROVED, recorded as approved by the admin without KYC', async () => {
    const { service, profiles } = make();
    await service.createDriver({ ...dto, skipKyc: true }, 'admin1');
    expect(profiles[0].create).toMatchObject({ userId: 'd1', status: 'APPROVED', kycMethod: 'ADMIN_NO_KYC', reviewedById: 'admin1' });
    expect(profiles[0].create.reviewedAt).toBeInstanceOf(Date);
  });

  it('refuses a phone number that already has an account', async () => {
    const { service } = make(true);
    await expect(service.createDriver({ ...dto, skipKyc: true })).rejects.toThrow();
  });
});
