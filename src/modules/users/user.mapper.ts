import { Role, User } from '@prisma/client';

/** Every role this account may sign in as: its primary role plus any additional ones. */
export const rolesOf = (u: { role: Role; additionalRoles?: Role[] | null }): Role[] =>
  Array.from(new Set<Role>([u.role, ...(u.additionalRoles ?? [])]));

export interface UserView {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  roles: Role[];
  isProfileCompleted: boolean;
  isActive: boolean;
  promotionalNotifications: boolean;
  createdAt: Date;
}

/** The only shape of a user that ever leaves the API (no password, OTP, refresh or push tokens). */
/** `sessionRole` is the role the caller signed in as; it defaults to the account's primary role. */
export const toUserView = (u: User, sessionRole?: Role): UserView => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: sessionRole && rolesOf(u).includes(sessionRole) ? sessionRole : u.role,
  roles: rolesOf(u),
  isProfileCompleted: u.isProfileCompleted,
  isActive: u.isActive,
  promotionalNotifications: u.promotionalNotifications,
  createdAt: u.createdAt,
});

export const USER_MINI_SELECT = { id: true, name: true, phone: true } as const;

/** Customers who deleted their account are anonymised with a `del_<timestamp>` phone. */
export const NOT_DELETED_ACCOUNT = {
  OR: [{ phone: null }, { phone: { not: { startsWith: 'del_' } } }],
};
