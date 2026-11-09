import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ApiException, ErrorCode } from '../api-error';
import { IS_PUBLIC_KEY } from '../decorators';

/** Global guard: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<T>(err: unknown, user: T, info: { name?: string } | undefined): T {
    if (err instanceof ApiException) throw err;
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw ApiException.unauthorized('Access token expired.', ErrorCode.TOKEN_EXPIRED);
      }
      throw ApiException.unauthorized('Invalid or missing access token.');
    }
    return user;
  }
}
