import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ApiException } from '../api-error';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../decorators';

/** Global guard: if a route (or its controller) declares @Roles / @Auth(...), the caller's role must match. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (!roles || roles.length === 0) return true;

    const user = context.switchToHttp().getRequest().user;
    // A super admin may use everything an admin may (the reverse is not true)
    const allowed = !!user && (roles.includes(user.role) || (user.role === 'SUPERADMIN' && roles.includes('ADMIN')));
    if (!allowed) throw ApiException.forbidden();
    return true;
  }
}
