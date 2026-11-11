import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';

/** An admin or super admin switching a customer / driver off must end that account's sessions and pushes at once. */
describe('UsersService.setActive', () => {
  const make = (role: 'CUSTOMER' | 'DRIVER') => {
    const updates: any[] = [];
    const deleted: string[] = [];
    const prisma: any = {
      user: {
        findUnique: async () => ({ id: 'u1', role }),
        update: async (args: any) => {
          updates.push(args);
          return { id: 'u1', role, ...args.data };
        },
      },
    };
    const cache: any = { del: async (k: string) => void deleted.push(k), get: async () => null, set: async () => undefined, wrap: async (_k: string, _t: number, f: any) => f() };
    return { service: new UsersService(prisma, cache, { get: () => undefined } as any), updates, deleted };
  };

  it('deactivating ends the sessions and removes the push tokens', async () => {
    const { service, updates, deleted } = make('CUSTOMER');
    await service.setActive('u1', 'CUSTOMER', false);
    const data = updates[0].data;
    expect(data.isActive).toBe(false);
    expect(data.refreshToken).toBeNull();
    expect(data.pushToken).toBeNull();
    expect(data.pushDevices).toBe(Prisma.DbNull);
    expect(data.tokensValidAfter).toBeInstanceOf(Date);
    expect(deleted).toContain('auth:user:u1'); // the API stops trusting the cached session straight away
  });

  it('reactivating only switches the account back on (the user signs in again)', async () => {
    const { service, updates } = make('DRIVER');
    await service.setActive('u1', 'DRIVER', true);
    expect(updates[0].data).toEqual({ isActive: true });
  });

  it('refuses to deactivate an account of another role through the wrong endpoint', async () => {
    const { service } = make('DRIVER');
    await expect(service.setActive('u1', 'CUSTOMER', false)).rejects.toBeTruthy();
  });
});
