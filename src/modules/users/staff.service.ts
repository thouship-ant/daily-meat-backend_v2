import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ApiException } from '../../common/api-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UsersService } from './users.service';
import { toUserView, UserView } from './user.mapper';

export type StaffRole = 'ADMIN' | 'DRIVER' | 'CUSTOMER';
const ROLE_PRIORITY: StaffRole[] = ['ADMIN', 'DRIVER', 'CUSTOMER']; // the first one a number has becomes its primary role

/** Super admin tools for accounts: add a number with roles, change a name / number, reset a password. */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  /** Password a reset sets (an empty setting counts as not set, so it can never become an empty password): Admin accounts and Driver accounts have their own. Customers have none. */
  passwordFor(role: Role): string | null {
    if (role === 'ADMIN' || role === 'SUPERADMIN') return this.config.get<string>('STAFF_ADMIN_DEFAULT_PASSWORD') || 'DAS@3781';
    if (role === 'DRIVER') return this.config.get<string>('STAFF_DRIVER_DEFAULT_PASSWORD') || 'Dvr@7939';
    return null;
  }

  async list(role: StaffRole, opts: { skip: number; take: number; search?: string }) {
    const where: Prisma.UserWhereInput = {
      OR: [{ role: role as Role }, { additionalRoles: { has: role as Role } }],
      ...(opts.search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: opts.search, mode: 'insensitive' } },
                  { phone: { contains: opts.search } },
                ],
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: opts.skip, take: opts.take }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map((u) => ({ ...toUserView(u), hubId: u.hubId })), total };
  }

  /** A number that is new gets an account; one that exists gets the extra roles. Returns the account. */
  /** The hub a new Admin / Driver belongs to: the one asked for, or the only hub there is (null when several and none chosen). */
  private async hubFor(requested?: number | null): Promise<number | null> {
    if (requested != null) {
      const hub = await this.prisma.hub.findUnique({ where: { id: requested }, select: { id: true } });
      if (!hub) throw ApiException.notFound('Hub');
      return hub.id;
    }
    const active = await this.prisma.hub.findMany({ where: { isActive: true }, select: { id: true }, take: 2 });
    return active.length === 1 ? active[0].id : null;
  }

  async addNumber(dto: { phone: string; name?: string; roles: StaffRole[]; hubId?: number }): Promise<{ user: UserView; created: boolean }> {
    const roles = ROLE_PRIORITY.filter((r) => dto.roles.includes(r));
    if (!roles.length) throw ApiException.badRequest('VALIDATION_FAILED', 'Choose at least one role.');
    const hubId = roles.includes('ADMIN') || roles.includes('DRIVER') ? await this.hubFor(dto.hubId) : null;

    const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (existing) {
      const have = new Set<Role>([existing.role, ...(existing.additionalRoles ?? [])]);
      const wasDriver = have.has('DRIVER' as Role); // before the new roles are added
      roles.forEach((r) => have.add(r as Role));
      const additional = [...have].filter((r) => r !== existing.role);
      const data: Prisma.UserUpdateInput = { additionalRoles: additional, isActive: true };
      if (hubId != null && existing.hubId == null) data.hub = { connect: { id: hubId } };
      if (dto.name && !existing.name) data.name = dto.name;
      // a number that becomes Admin / Driver gets that role's starting password if it has none yet
      if (!existing.password) {
        const pw = this.passwordFor(roles[0] as Role);
        if (pw) data.password = await bcrypt.hash(pw, 10);
      }
      const user = await this.users.update(existing.id, data);
      // a number that becomes a Driver for the first time starts onboarding
      if (roles.includes('DRIVER') && !wasDriver) await this.users.ensureDriverProfile(existing.id);
      return { user: toUserView(user), created: false };
    }

    const primary = roles[0] as Role;
    const pw = this.passwordFor(primary);
    const user = await this.users.create({
      phone: dto.phone,
      name: dto.name ?? null,
      role: primary,
      additionalRoles: roles.slice(1) as Role[],
      ...(hubId != null ? { hub: { connect: { id: hubId } } } : {}),
      password: pw ? await bcrypt.hash(pw, 10) : null,
      isProfileCompleted: primary !== 'CUSTOMER' ? true : false,
    });
    if (roles.includes('DRIVER')) await this.users.ensureDriverProfile(user.id); // a new driver starts onboarding
    return { user: toUserView(user), created: true };
  }

  /** Change a name and / or the mobile number. The person has to sign in again with the new number. */
  async updateProfile(id: string, dto: { name?: string; phone?: string; additionalRoles?: StaffRole[]; hubId?: number | null }, actorId?: string): Promise<UserView> {
    const user = await this.users.getById(id);
    // A super admin's name / number are not editable here; their extra roles are (see below)
    if (user.role === 'SUPERADMIN' && (dto.name !== undefined || dto.phone !== undefined)) {
      throw ApiException.forbidden('A super admin name or number cannot be changed here.');
    }
    const data: Prisma.UserUpdateInput = {};
    if (dto.hubId !== undefined) {
      // hubs are for the people who work in one: an Admin or a Driver (a super admin looks after every hub)
      if (user.role !== 'ADMIN' && user.role !== 'DRIVER') {
        throw ApiException.badRequest('VALIDATION_FAILED', 'A hub can only be set on an Admin or a Driver.');
      }
      const hubId = dto.hubId === null ? null : await this.hubFor(dto.hubId);
      data.hub = hubId === null ? { disconnect: true } : { connect: { id: hubId } };
    }
    if (dto.additionalRoles) {
      // only accounts that are Admin / Super Admin can be given other roles to sign in as
      if (user.role !== 'SUPERADMIN' && user.role !== 'ADMIN') {
        throw ApiException.badRequest('VALIDATION_FAILED', 'Extra roles can only be set on Admin and Super Admin accounts.');
      }
      const next = [...new Set(dto.additionalRoles)].filter((r) => (r as Role) !== user.role) as Role[];
      const before = user.additionalRoles ?? [];
      data.additionalRoles = next;
      // someone who loses a role is signed out so the role cannot be used any longer (not the super admin editing themselves)
      if (before.some((r) => !next.includes(r)) && actorId !== id) Object.assign(data, this.endSessions());
      // a number that becomes Driver gets the driver starting password if it has none yet
      if (!user.password && (next.includes('DRIVER') || user.role === 'ADMIN')) {
        const pw = this.passwordFor(user.role);
        if (pw) data.password = await bcrypt.hash(pw, 10);
      }
    }
    if (dto.name !== undefined) data.name = dto.name.trim() || null;
    if (dto.phone && dto.phone !== user.phone) {
      const taken = await this.prisma.user.findUnique({ where: { phone: dto.phone }, select: { id: true } });
      if (taken && taken.id !== id) throw ApiException.conflict('Another account already uses this mobile number.');
      data.phone = dto.phone;
      // the number is the sign-in identity: end old sessions and old devices
      Object.assign(data, this.endSessions());
    }
    const saved = await this.users.update(id, data);
    return { ...toUserView(saved), hubId: saved.hubId } as UserView;
  }

  /** Sets the account's starting password (Admin: DAS@3781, Driver: Dvr@7939) and ends its sessions. */
  async resetPassword(id: string): Promise<{ role: Role }> {
    const user = await this.users.getById(id);
    if (user.role === 'SUPERADMIN') throw ApiException.forbidden('A super admin password cannot be reset here.');
    const pw = this.passwordFor(user.role);
    if (!pw) throw ApiException.badRequest('VALIDATION_FAILED', 'Customers sign in with an OTP and have no password.');
    await this.users.update(id, { password: await bcrypt.hash(pw, 10), ...this.endSessions() });
    return { role: user.role };
  }

  private endSessions(): Prisma.UserUpdateInput {
    return { tokensValidAfter: new Date(), refreshToken: null, pushToken: null, pushDevices: Prisma.DbNull };
  }
}

export type { User };
