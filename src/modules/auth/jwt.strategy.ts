import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuthUser } from '../../common/decorators';
import { UsersService } from '../users/users.service';

interface JwtPayload {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.users.findAuthUser(payload.sub);
    if (!user) throw ApiException.unauthorized('User not found.');
    if (!user.isActive) throw ApiException.unauthorized('Account deactivated.', ErrorCode.ACCOUNT_DEACTIVATED);
    if (user.tokensValidAfter && payload.iat < Math.floor(user.tokensValidAfter / 1000)) {
      throw ApiException.unauthorized('Session ended. Please log in again.', ErrorCode.SESSION_ENDED);
    }
    // Role comes from the database, not the token, so a role change takes effect immediately.
    return { id: user.id, role: user.role, name: user.name, phone: user.phone, email: user.email };
  }
}
