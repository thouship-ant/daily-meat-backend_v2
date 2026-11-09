import { Role, User } from '@prisma/client';

export interface UserView {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  isProfileCompleted: boolean;
  isActive: boolean;
  promotionalNotifications: boolean;
  createdAt: Date;
}

/** The only shape of a user that ever leaves the API (no password, OTP, refresh or push tokens). */
export const toUserView = (u: User): UserView => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
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
