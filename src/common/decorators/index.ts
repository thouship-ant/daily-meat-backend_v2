import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const RESPONSE_MESSAGE_KEY = 'responseMessage';

/** Opts a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route/controller to the given roles (enforced by the global RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Sets the `message` field of the success envelope. */
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE_KEY, message);

/** Shorthand for a role-protected controller: bearer auth in Swagger + role check. */
export const Auth = (...roles: Role[]) =>
  applyDecorators(
    Roles(...roles),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ description: 'Missing, invalid or expired token' }),
    ApiForbiddenResponse({ description: 'Role not allowed' }),
  );

export interface AuthUser {
  id: string;
  role: Role;
  name: string | null;
  phone: string | null;
  email: string | null;
}

/** The authenticated user attached by the JWT strategy. */
export const CurrentUser = createParamDecorator((field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest().user as AuthUser;
  return field ? user?.[field] : user;
});
