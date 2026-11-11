import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators';
import { RolesGuard } from './roles.guard';

/** A super admin may do everything an admin may; an admin may not do what only a super admin may. */
describe('RolesGuard (SUPERADMIN)', () => {
  const run = (routeRoles: string[] | undefined, userRole: string | null) => {
    const reflector = { getAllAndOverride: (key: string) => (key === ROLES_KEY ? routeRoles : false) } as unknown as Reflector;
    const ctx = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ user: userRole ? { role: userRole } : undefined }) }),
    } as unknown as ExecutionContext;
    return () => new RolesGuard(reflector).canActivate(ctx);
  };

  it('lets a super admin use an admin route', () => {
    expect(run(['ADMIN'], 'SUPERADMIN')()).toBe(true);
  });

  it('lets a super admin use a super-admin-only route', () => {
    expect(run(['SUPERADMIN'], 'SUPERADMIN')()).toBe(true);
  });

  it('keeps an admin out of a super-admin-only route (creating hubs)', () => {
    expect(run(['SUPERADMIN'], 'ADMIN')).toThrow();
  });

  it('still lets an admin use an admin route', () => {
    expect(run(['ADMIN'], 'ADMIN')()).toBe(true);
  });

  it('keeps a customer and a driver out of admin routes, and a super admin out of customer-only routes', () => {
    expect(run(['ADMIN'], 'CUSTOMER')).toThrow();
    expect(run(['ADMIN'], 'DRIVER')).toThrow();
    expect(run(['CUSTOMER'], 'SUPERADMIN')).toThrow();
  });

  it('an unauthenticated caller is refused', () => {
    expect(run(['ADMIN'], null)).toThrow();
  });
});
