import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { ApiException, ErrorCode } from '../../common/api-error';
import { DomainEvents } from '../../common/events/domain-events';
import { UsersService } from '../users/users.service';
import { toUserView, UserView } from '../users/user.mapper';
import { OtpService } from './otp.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number; // seconds
}

export interface AuthResult {
  user: UserView;
  tokens: AuthTokens;
  isNewUser?: boolean;
}

// Compared against when the account does not exist, so response time does not reveal which identifiers are registered.
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.4Jc3gZ8cX3t2wq0y5R5vJcQJf0Hu';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly otp: OtpService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------- customer: OTP ----------

  /** Tells the app whether to show OTP (customer) or password (staff) login. */
  async lookup(identifier: string): Promise<{ exists: boolean; role: Role; loginMethod: 'OTP' | 'PASSWORD' }> {
    const user = await this.users.findByIdentifier(identifier);
    const role = user?.role ?? 'CUSTOMER';
    return { exists: !!user, role, loginMethod: role === 'CUSTOMER' ? 'OTP' : 'PASSWORD' };
  }

  async sendCustomerOtp(identifier: string): Promise<void> {
    const existing = await this.users.findByIdentifier(identifier);
    if (existing && existing.role !== 'CUSTOMER') {
      throw ApiException.badRequest(ErrorCode.INVALID_CREDENTIALS, 'This account signs in with a password.');
    }
    if (existing && !existing.isActive) {
      throw ApiException.forbidden('Account deactivated. Please contact support.');
    }
    await this.otp.send(identifier);
  }

  async verifyCustomerOtp(identifier: string, code: string, deviceId?: string): Promise<AuthResult> {
    let user = await this.users.findByIdentifier(identifier);
    if (user && user.role !== 'CUSTOMER') {
      throw ApiException.badRequest(ErrorCode.INVALID_CREDENTIALS, 'This account signs in with a password.');
    }

    await this.otp.verify(identifier, code);

    let isNewUser = false;
    if (!user) {
      if (deviceId) {
        const limit = Number(this.config.get('MAX_ACCOUNTS_PER_DEVICE') ?? 2);
        if ((await this.users.countByDevice(deviceId)) >= limit) {
          throw ApiException.badRequest(
            ErrorCode.DEVICE_LIMIT_REACHED,
            'Maximum registration limit reached for this device.',
          );
        }
      }
      const byEmail = this.users.isEmail(identifier);
      user = await this.users.create({
        ...(byEmail ? { email: identifier.toLowerCase() } : { phone: identifier }),
        ...(deviceId ? { deviceId } : {}),
        ...(this.otp.isTestAccount(identifier) ? { name: 'testing account', isProfileCompleted: true } : {}),
      });
      isNewUser = true;
      this.events.emit(DomainEvents.UserRegistered, { userId: user.id });
    }

    if (!user.isActive) throw ApiException.forbidden('Account deactivated. Please contact support.');
    return { user: toUserView(user), tokens: await this.issueTokens(user), isNewUser };
  }

  // ---------- staff (admin / driver): password ----------

  /** `expectedRole` makes each API surface accept only its own staff (an admin app cannot log a driver in). */
  async loginWithPassword(identifier: string, password: string, expectedRole: Role): Promise<AuthResult> {
    const user = await this.users.findByIdentifier(identifier);
    const hash = user?.password ?? DUMMY_HASH;
    const valid = await bcrypt.compare(password, hash);

    if (!user || !user.password || !valid || user.role !== expectedRole) {
      throw ApiException.unauthorized('Invalid email/phone or password.', ErrorCode.INVALID_CREDENTIALS);
    }
    if (!user.isActive) {
      throw new ApiException(ErrorCode.ACCOUNT_DEACTIVATED, 'Account deactivated. Please contact support.', 403);
    }
    return { user: toUserView(user), tokens: await this.issueTokens(user) };
  }

  // ---------- tokens ----------

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: this.config.getOrThrow('REFRESH_TOKEN_SECRET') });
    } catch {
      throw ApiException.unauthorized('Invalid or expired refresh token.');
    }
    const user = await this.users.findById(payload.sub);
    if (!user || !user.refreshToken || user.refreshToken !== this.digest(refreshToken)) {
      throw ApiException.unauthorized('Invalid or expired refresh token.');
    }
    if (!user.isActive) throw ApiException.forbidden('Account deactivated. Please contact support.');
    return this.issueTokens(user); // rotates: the old refresh token stops working
  }

  async logout(userId: string, pushToken?: string): Promise<void> {
    await this.users.removePushToken(userId, pushToken);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN') ?? '15m';
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role }, { expiresIn: expiresIn as any });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id },
      {
        secret: this.config.getOrThrow('REFRESH_TOKEN_SECRET'),
        expiresIn: (this.config.get<string>('REFRESH_TOKEN_EXPIRES_IN') ?? '30d') as any,
      },
    );
    // Only a digest is stored, so a database leak does not expose usable refresh tokens.
    await this.users.update(user.id, { refreshToken: this.digest(refreshToken) });
    const decoded = this.jwt.decode(accessToken) as { exp: number; iat: number };
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: decoded.exp - decoded.iat };
  }

  private digest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
