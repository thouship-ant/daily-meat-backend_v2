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
import { rolesOf, toUserView, UserView } from '../users/user.mapper';
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
  async lookup(
    identifier: string,
  ): Promise<{ exists: boolean; role: Role; roles: Role[]; loginMethod: 'OTP' | 'PASSWORD' | 'PASSWORD_AND_OTP' }> {
    const user = await this.users.findByIdentifier(identifier);
    const roles = user ? rolesOf(user) : (['CUSTOMER'] as Role[]);
    const role = user?.role ?? 'CUSTOMER';
    // With several roles the app asks which one to use (`roles.length > 1`); the choice decides OTP vs password.
    // A number with several roles signs in with its password AND an OTP, then picks the role (see multiRole*).
    const loginMethod = roles.length > 1 ? 'PASSWORD_AND_OTP' : role === 'CUSTOMER' ? 'OTP' : 'PASSWORD';
    return { exists: !!user, role, roles, loginMethod };
  }

  async sendCustomerOtp(identifier: string): Promise<void> {
    const existing = await this.users.findByIdentifier(identifier);
    if (existing && !rolesOf(existing).includes('CUSTOMER')) {
      throw ApiException.badRequest(ErrorCode.INVALID_CREDENTIALS, 'This account signs in with a password.');
    }
    this.assertSingleRole(existing);
    if (existing && !existing.isActive) {
      throw ApiException.forbidden('Account deactivated. Please contact support.');
    }
    await this.otp.send(identifier);
  }

  async verifyCustomerOtp(identifier: string, code: string, deviceId?: string): Promise<AuthResult> {
    let user = await this.users.findByIdentifier(identifier);
    if (user && !rolesOf(user).includes('CUSTOMER')) {
      throw ApiException.badRequest(ErrorCode.INVALID_CREDENTIALS, 'This account signs in with a password.');
    }
    this.assertSingleRole(user);

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
    this.users.recordLogin(user.id);
    return { user: toUserView(user, 'CUSTOMER'), tokens: await this.issueTokens(user, 'CUSTOMER'), isNewUser };
  }

  // ---------- staff (admin / driver): password ----------

  /** `expectedRole` makes each API surface accept only its own staff (an admin app cannot log a driver in). */
  async loginWithPassword(identifier: string, password: string, expectedRole: Role): Promise<AuthResult> {
    const user = await this.users.findByIdentifier(identifier);
    const hash = user?.password ?? DUMMY_HASH;
    const valid = await bcrypt.compare(password, hash);

    // A super admin may use the admin app too; it then signs in with its higher role
    const sessionRole: Role = expectedRole === 'ADMIN' && user && rolesOf(user).includes('SUPERADMIN') ? 'SUPERADMIN' : expectedRole;
    if (!user || !user.password || !valid || !rolesOf(user).includes(sessionRole)) {
      throw ApiException.unauthorized('Invalid email/phone or password.', ErrorCode.INVALID_CREDENTIALS);
    }
    if (!user.isActive) {
      throw new ApiException(ErrorCode.ACCOUNT_DEACTIVATED, 'Account deactivated. Please contact support.', 403);
    }
    this.assertSingleRole(user);
    this.users.recordLogin(user.id);
    return { user: toUserView(user, sessionRole), tokens: await this.issueTokens(user, sessionRole) };
  }

  // ---------- one number, several roles: password + OTP, then choose the role ----------

  /** A number with several roles may not sign in with only one factor: it must use the combined flow below. */
  private assertSingleRole(user: User | null) {
    if (user && rolesOf(user).length > 1) {
      throw ApiException.badRequest(
        'MULTI_ROLE_LOGIN_REQUIRED',
        'This number has more than one role. Sign in with your password and the OTP, then choose the role.',
      );
    }
  }

  /** The short-lived tokens of the flow are signed with their own secret, so they can never be used as access tokens. */
  private get flowSecret() {
    return `${this.config.getOrThrow<string>('REFRESH_TOKEN_SECRET')}:role-flow`;
  }

  private signFlow(payload: Record<string, unknown>) {
    return this.jwt.signAsync(payload, { secret: this.flowSecret, expiresIn: '10m' });
  }

  private async readFlow(token: string, purpose: 'role-password' | 'role-select'): Promise<{ sub: string; idn: string }> {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; idn: string; purpose: string }>(token, { secret: this.flowSecret });
      if (p.purpose === purpose && p.sub) return p;
    } catch {
      /* falls through */
    }
    throw ApiException.unauthorized('This sign-in step has expired. Please start again.', ErrorCode.INVALID_CREDENTIALS);
  }

  /** Step 1: the password of the staff (admin / driver) role. On success the OTP is sent to the same number. */
  async multiRoleStart(identifier: string, password: string): Promise<{ challengeToken: string; roles: Role[]; message: string }> {
    const user = await this.users.findByIdentifier(identifier);
    const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    const roles = user ? rolesOf(user) : [];
    if (!user || !user.password || !valid || roles.length < 2 || !roles.some((r) => r === 'ADMIN' || r === 'DRIVER' || r === 'SUPERADMIN')) {
      throw ApiException.unauthorized('Invalid email/phone or password.', ErrorCode.INVALID_CREDENTIALS);
    }
    if (!user.isActive) {
      throw new ApiException(ErrorCode.ACCOUNT_DEACTIVATED, 'Account deactivated. Please contact support.', 403);
    }
    await this.otp.send(identifier);
    const challengeToken = await this.signFlow({ sub: user.id, idn: identifier, purpose: 'role-password' });
    return { challengeToken, roles, message: 'Password verified. An OTP has been sent.' };
  }

  /** Sends the OTP again (the password was already proven by the challenge token). */
  async multiRoleResend(challengeToken: string): Promise<void> {
    const { sub, idn } = await this.readFlow(challengeToken, 'role-password');
    const user = await this.users.findById(sub);
    if (!user || !user.isActive) throw ApiException.unauthorized('Invalid or expired sign-in.', ErrorCode.INVALID_CREDENTIALS);
    await this.otp.send(idn);
  }

  /** Step 2: the OTP. Both factors are now proven, so the app may show the role choice. */
  async multiRoleVerifyOtp(challengeToken: string, code: string): Promise<{ selectionToken: string; roles: Role[]; name: string | null }> {
    const { sub, idn } = await this.readFlow(challengeToken, 'role-password');
    const user = await this.users.findById(sub);
    if (!user || !user.isActive) throw ApiException.unauthorized('Invalid or expired sign-in.', ErrorCode.INVALID_CREDENTIALS);
    await this.otp.verify(idn, code);
    const selectionToken = await this.signFlow({ sub: user.id, idn, purpose: 'role-select' });
    return { selectionToken, roles: rolesOf(user), name: user.name };
  }

  /** Step 3: the chosen role. Returns the usual tokens, issued for that role. */
  async multiRoleSelect(selectionToken: string, role: Role): Promise<AuthResult> {
    const { sub } = await this.readFlow(selectionToken, 'role-select');
    const user = await this.users.findById(sub);
    if (!user || !user.isActive) throw ApiException.unauthorized('Invalid or expired sign-in.', ErrorCode.INVALID_CREDENTIALS);
    if (!rolesOf(user).includes(role)) {
      throw ApiException.badRequest(ErrorCode.INVALID_CREDENTIALS, 'This number does not have that role.');
    }
    this.users.recordLogin(user.id);
    return { user: toUserView(user, role), tokens: await this.issueTokens(user, role) };
  }

  // ---------- tokens ----------

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: { sub: string; role?: Role };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: this.config.getOrThrow('REFRESH_TOKEN_SECRET') });
    } catch {
      throw ApiException.unauthorized('Invalid or expired refresh token.');
    }
    // A token issued by the v1 backend has no `sub` (it carries `id`): it can never be renewed here, so answer 401
    // and let the app sign in again instead of failing with a 500.
    if (!payload?.sub) throw ApiException.unauthorized('Invalid or expired refresh token.');
    const user = await this.users.findById(payload.sub);
    if (!user || !user.refreshToken || user.refreshToken !== this.digest(refreshToken)) {
      throw ApiException.unauthorized('Invalid or expired refresh token.');
    }
    if (!user.isActive) throw ApiException.forbidden('Account deactivated. Please contact support.');
    return this.issueTokens(user, payload.role); // keeps the role picked at sign-in; rotates: the old refresh token stops working
  }

  async logout(userId: string, pushToken?: string): Promise<void> {
    await this.users.removePushToken(userId, pushToken);
  }

  private async issueTokens(user: User, requestedRole?: Role): Promise<AuthTokens> {
    const role = requestedRole && rolesOf(user).includes(requestedRole) ? requestedRole : user.role;
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN') ?? '15m';
    const accessToken = await this.jwt.signAsync({ sub: user.id, role }, { expiresIn: expiresIn as any });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, role },
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
