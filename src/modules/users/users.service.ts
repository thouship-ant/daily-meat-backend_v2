import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ApiException } from '../../common/api-error';
import { AuthUser } from '../../common/decorators';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NOT_DELETED_ACCOUNT } from './user.mapper';

const AUTH_CACHE_TTL = 30; // seconds
const authKey = (id: string) => `auth:user:${id}`;

export interface CachedAuthUser extends AuthUser {
  additionalRoles: Role[];
  isActive: boolean;
  /** epoch ms; access tokens issued before this are rejected (forced logout) */
  tokensValidAfter: number | null;
}

export interface PushRegistration {
  pushToken: string;
  previousToken?: string;
  platform?: string;
  appVersion?: string;
}

/**
 * Core user persistence. Other modules depend on this (never on Prisma's `user` table directly) so the
 * rules around caching, push tokens and anonymisation live in exactly one place.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  // ---------- lookups ----------

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw ApiException.notFound('User');
    return user;
  }

  /** Used on every authenticated request, so it is cached briefly and invalidated on any user change. */
  async findAuthUser(id: string): Promise<CachedAuthUser | null> {
    return this.cache.wrap(authKey(id), AUTH_CACHE_TTL, async () => {
      const u = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          role: true,
          additionalRoles: true,
          name: true,
          phone: true,
          email: true,
          isActive: true,
          tokensValidAfter: true,
        },
      });
      if (!u) return null as unknown as CachedAuthUser;
      return { ...u, tokensValidAfter: u.tokensValidAfter ? u.tokensValidAfter.getTime() : null };
    });
  }

  findByIdentifier(identifier: string): Promise<User | null> {
    return this.isEmail(identifier)
      ? this.prisma.user.findFirst({ where: { email: { equals: identifier, mode: 'insensitive' } } })
      : this.prisma.user.findUnique({ where: { phone: identifier } });
  }

  isEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  findByPhones(phones: string[]) {
    return this.prisma.user.findMany({
      where: { phone: { in: phones } },
      select: { id: true, phone: true, role: true, additionalRoles: true, isActive: true, refreshToken: true, simGroup: true, lastActiveAt: true, lastLoginAt: true },
    });
  }

  countByDevice(deviceId: string) {
    return this.prisma.user.count({ where: { deviceId } });
  }

  // ---------- writes ----------

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    const user = await this.prisma.user.update({ where: { id }, data });
    await this.invalidate(id);
    return user;
  }

  invalidate(id: string) {
    return this.cache.del(authKey(id));
  }

  async updateProfile(
    id: string,
    dto: { name?: string; email?: string | null; phone?: string; promotionalNotifications?: boolean },
  ): Promise<User> {
    const data: Prisma.UserUpdateInput = { isProfileCompleted: true };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email ? dto.email.toLowerCase() : null;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.promotionalNotifications !== undefined) data.promotionalNotifications = dto.promotionalNotifications;
    return this.update(id, data);
  }

  /**
   * The first location a customer opened the app from (latitude / longitude, with the place name and pincode).
   * Logged once: when the customer already has coordinates the call changes nothing. A customer whose older record
   * has only a place name (no coordinates) gets the coordinates filled in, and keeps the name they already have.
   */
  async setSignupLocationOnce(id: string, location: string, latitude?: number, longitude?: number, pincode?: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { signupLocation: true, signupLatitude: true, signupPincode: true } });
    if (!u || u.signupLatitude != null) return; // unknown user, or the first location is already logged
    const hasCoords = latitude !== undefined && longitude !== undefined;
    if (!hasCoords && u.signupLocation) return; // a name-only request when a name is already stored
    // no pincode sent: take one from the text if it has one ("Crawford 620005")
    const pin = pincode ?? location.match(/(?<!\d)(\d{6})(?!\d)/)?.[1];
    const data: Prisma.UserUpdateInput = {
      ...(u.signupLocation ? {} : { signupLocation: location.slice(0, 255) }),
      ...(pin && !u.signupPincode ? { signupPincode: pin } : {}),
      ...(hasCoords ? { signupLatitude: latitude, signupLongitude: longitude } : {}),
    };
    if (Object.keys(data).length) await this.prisma.user.update({ where: { id }, data });
  }

  /** Whether the customer's first location (coordinates) has been logged yet; the app asks for it when not. */
  hasSignupLocation(u: { signupLatitude: number | null }): boolean {
    return u.signupLatitude != null;
  }

  // ---------- activity (last login / last seen) ----------

  private readonly activityWrittenAt = new Map<string, number>();

  /** The user just signed in (counts as activity too). Never fails the request. */
  recordLogin(id: string): void {
    this.activityWrittenAt.set(id, Date.now());
    this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date(), lastActiveAt: new Date() } }).catch(() => {});
  }

  /** The user's app called the API: at most one database write per user every 10 minutes. Never fails the request. */
  recordActivity(id: string): void {
    const now = Date.now();
    if (now - (this.activityWrittenAt.get(id) ?? 0) < 10 * 60 * 1000) return;
    this.activityWrittenAt.set(id, now);
    this.prisma.user.update({ where: { id }, data: { lastActiveAt: new Date() } }).catch(() => {});
  }

  /** Last sign-in, last activity and where the app was first opened (for the admin's customer page). */
  async getActivity(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { lastLoginAt: true, lastActiveAt: true, signupLocation: true, signupLatitude: true, signupLongitude: true, signupPincode: true },
    });
    return {
      lastLoginAt: u?.lastLoginAt ?? null,
      lastActiveAt: u?.lastActiveAt ?? null,
      registeredLocation:
        u && (u.signupLocation || u.signupLatitude != null)
          ? { text: u.signupLocation, latitude: u.signupLatitude, longitude: u.signupLongitude, pincode: u.signupPincode }
          : null,
    };
  }

  countOrders(userId: string): Promise<number> {
    return this.prisma.order.count({ where: { userId } });
  }

  /** Customer "delete my account": removes personal data but keeps the row so past orders still add up. */
  async anonymize(id: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.address.deleteMany({ where: { userId: id } }),
      this.prisma.supportTicket.deleteMany({ where: { userId: id } }),
      this.prisma.couponRedemption.deleteMany({ where: { userId: id } }),
      this.prisma.user.update({
        where: { id },
        data: {
          name: 'Deleted User',
          email: null,
          phone: `del_${Date.now()}`,
          password: null,
          pushToken: null,
          pushDevices: Prisma.DbNull,
          deviceId: null,
          refreshToken: null,
          isActive: false,
          otp: null,
          tokensValidAfter: new Date(),
        },
      }),
    ]);
    await this.invalidate(id);
  }

  async changePassword(id: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.getById(id);
    if (!user.password) {
      throw ApiException.badRequest('NO_PASSWORD_SET', 'No password set for this account. Contact an admin.');
    }
    if (!(await bcrypt.compare(oldPassword, user.password))) {
      throw ApiException.badRequest('INVALID_CREDENTIALS', 'Incorrect old password.');
    }
    await this.update(id, { password: await bcrypt.hash(newPassword, 10) });
  }

  // ---------- push tokens ----------

  private splitTokens(user: { pushToken: string | null }): string[] {
    return (user.pushToken ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  }

  async registerPushToken(userId: string, reg: PushRegistration): Promise<void> {
    const user = await this.getById(userId);
    const maxChars = Number(this.config.get('PUSH_TOKEN_MAX_CHARS') ?? 255);

    let tokens = this.splitTokens(user);
    const before = tokens.join(',');
    // A device's older token is replaced, not kept (otherwise every notification would arrive twice).
    if (reg.previousToken && reg.previousToken !== reg.pushToken) tokens = tokens.filter((t) => t !== reg.previousToken);
    tokens = tokens.filter((t) => t !== reg.pushToken);
    tokens.push(reg.pushToken); // most recent last, so active devices are the last to be dropped
    while (tokens.length > 1 && tokens.join(',').length > maxChars) tokens.shift();

    const data: Prisma.UserUpdateInput = {};
    if (tokens.join(',') !== before) data.pushToken = tokens.join(',');

    const platform = String(reg.platform ?? '').toLowerCase();
    if (platform === 'android' || platform === 'ios') {
      const existing = ((user.pushDevices as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      const devices: Record<string, unknown> = {};
      for (const t of tokens) if (existing[t]) devices[t] = existing[t];
      devices[reg.pushToken] = { platform, app_version: reg.appVersion ?? null };
      data.pushDevices = devices as Prisma.InputJsonValue;
    }
    if (Object.keys(data).length) await this.update(userId, data);
  }

  /** Logout: drop one device's token, or all of them when none is given. */
  async removePushToken(userId: string, token?: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) return;
    const remaining = token ? this.splitTokens(user).filter((t) => t !== token) : [];
    await this.update(userId, { pushToken: remaining.length ? remaining.join(',') : null, refreshToken: null });
  }

  /** Called by the push sender when Expo reports a token as no longer registered. */
  async purgePushToken(token: string): Promise<void> {
    const users = await this.prisma.user.findMany({ where: { pushToken: { contains: token } } });
    for (const u of users) {
      const kept = this.splitTokens(u).filter((t) => t !== token);
      await this.update(u.id, { pushToken: kept.length ? kept.join(',') : null });
    }
  }

  async pushTokensForUser(userId: string): Promise<string[]> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { pushToken: true } });
    return u ? this.splitTokens(u) : [];
  }

  /** Admins of one hub (plus admins without a hub, and super admins). */
  async pushTokensForHubAdmins(hubId: number | null, opts: { superAdmins?: boolean } = {}): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        pushToken: { not: null },
        OR: [
          ...(opts.superAdmins === false ? [] : [{ role: 'SUPERADMIN' as Role }]),
          { role: 'ADMIN' as Role, ...(hubId == null ? {} : { OR: [{ hubId }, { hubId: null }] }) },
        ],
      },
      select: { pushToken: true },
    });
    return [...new Set(users.flatMap((u) => this.splitTokens(u)))];
  }

  async pushTokensForRole(role: Role, opts: { superAdmins?: boolean } = {}): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        pushToken: { not: null },
        // an account that holds the role as an extra role gets its alerts too; super admins get the admin alerts
        OR: [{ role }, { additionalRoles: { has: role } }, ...(role === 'ADMIN' && opts.superAdmins !== false ? [{ role: 'SUPERADMIN' as Role }] : [])],
      },
      select: { pushToken: true },
    });
    return [...new Set(users.flatMap((u) => this.splitTokens(u)))];
  }

  /** Ids of the active accounts that hold a role (e.g. every super admin, to reach them over the live socket). */
  async idsForRole(role: Role): Promise<string[]> {
    const rows = await this.prisma.user.findMany({ where: { isActive: true, OR: [{ role }, { additionalRoles: { has: role } }] }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  // ---------- admin: customers & drivers ----------

  async listByRole(
    role: Role,
    opts: { skip: number; take: number; search?: string; isActive?: boolean; extraWhere?: Prisma.UserWhereInput },
  ): Promise<{ items: (User & { _count: { orders: number; deliveries: number } })[]; total: number }> {
    const where: Prisma.UserWhereInput = {
      role,
      ...(role === 'CUSTOMER' ? NOT_DELETED_ACCOUNT : {}),
      ...(opts.isActive !== undefined ? { isActive: opts.isActive } : {}),
      ...(opts.search
        ? {
            OR: [
              { name: { contains: opts.search, mode: 'insensitive' } },
              { phone: { contains: opts.search } },
              { email: { contains: opts.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    // e.g. only the customers of one hub
    const scoped: Prisma.UserWhereInput = opts.extraWhere ? { AND: [where, opts.extraWhere] } : where;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: scoped,
        orderBy: { createdAt: 'desc' },
        skip: opts.skip,
        take: opts.take,
        include: { _count: { select: { orders: true, deliveries: true } } },
      }),
      this.prisma.user.count({ where: scoped }),
    ]);
    return { items, total };
  }

  /** A new driver starts onboarding (KYC, hub, selfie, vehicle, deposit, approval). Drivers with no row are the old ones. */
  async ensureDriverProfile(userId: string): Promise<void> {
    await this.prisma.driverProfile.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  async createDriver(dto: { name: string; phone: string; password: string; email?: string }): Promise<User> {
    const exists = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (exists) throw ApiException.conflict('A user with this phone number already exists.');
    const driver = await this.create({
      name: dto.name,
      phone: dto.phone,
      email: dto.email ? dto.email.toLowerCase() : null,
      password: await bcrypt.hash(dto.password, 10),
      role: 'DRIVER',
      isProfileCompleted: true,
    });
    await this.ensureDriverProfile(driver.id);
    return driver;
  }

  async setActive(id: string, role: Role, isActive: boolean): Promise<User> {
    const user = await this.getById(id);
    if (user.role !== role) throw ApiException.notFound(role === 'DRIVER' ? 'Driver' : 'Customer');
    // Deactivating also ends their sessions and stops their pushes (same as `npm run logout:deactivated`).
    return this.update(
      id,
      isActive ? { isActive } : { isActive, tokensValidAfter: new Date(), refreshToken: null, pushToken: null, pushDevices: Prisma.DbNull },
    );
  }

  /** Ends every session of the given role (e.g. "log out all admins"). Returns affected count. */
  async endSessionsForRole(role: Role): Promise<number> {
    const users = await this.prisma.user.findMany({ where: { role }, select: { id: true } });
    await this.prisma.user.updateMany({
      where: { role },
      data: { tokensValidAfter: new Date(), refreshToken: null, pushToken: null },
    });
    await Promise.all(users.map((u) => this.invalidate(u.id)));
    return users.length;
  }
}
