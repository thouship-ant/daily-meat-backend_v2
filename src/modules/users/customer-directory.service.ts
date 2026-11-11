import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NOT_DELETED_ACCOUNT } from './user.mapper';

export interface CustomerFilter {
  search?: string;
  isActive?: boolean;
  /** e.g. the customers of one hub */
  extraWhere?: Prisma.UserWhereInput;
  createdFrom?: string; // YYYY-MM-DD (India time), inclusive
  createdTo?: string; // YYYY-MM-DD (India time), inclusive
  /** street / city text of a saved address, or - when there is no saved address - the first-login location text */
  location?: string;
  /** 6-digit pincodes, inclusive range */
  pincodeFrom?: string;
  pincodeTo?: string;
}

export type CustomerGroupBy = 'date' | 'pincode' | 'city';

const ADDRESS_SELECT = { title: true, street: true, city: true, pincode: true, createdAt: true } as const;
const WITH_AREA = {
  _count: { select: { orders: true } },
  addresses: { select: ADDRESS_SELECT, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.UserInclude;

export type CustomerRecord = Prisma.UserGetPayload<{ include: typeof WITH_AREA }>;

export interface CustomerArea {
  city: string;
  pincode: string;
  /** where the pincode comes from: a saved delivery address, or the location the app was first opened at */
  pincodeSource: 'ADDRESS' | 'FIRST_LOGIN' | null;
  /** the delivery address the area was taken from (null when it comes from the first-login location) */
  street: string;
}

export type CustomerRow = CustomerRecord & { area: CustomerArea };

const PIN = /^\d{6}$/;
const IST_MS = 5.5 * 3600_000;
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

/**
 * The customer list / export. A customer's pincode is the one of their delivery address (Home, else the oldest
 * saved one - or the one that matched the filter); when they have no address yet it is the pincode of the location
 * where they first opened the app.
 */
@Injectable()
export class CustomerDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  private range(f: CustomerFilter): { from?: string; to?: string } {
    let from = PIN.test((f.pincodeFrom ?? '').trim()) ? f.pincodeFrom!.trim() : undefined;
    let to = PIN.test((f.pincodeTo ?? '').trim()) ? f.pincodeTo!.trim() : undefined;
    if (from && to && from > to) [from, to] = [to, from];
    return { from, to };
  }

  buildWhere(f: CustomerFilter): Prisma.UserWhereInput {
    const and: Prisma.UserWhereInput[] = [{ role: 'CUSTOMER' }, NOT_DELETED_ACCOUNT];
    if (f.isActive !== undefined) and.push({ isActive: f.isActive });
    if (f.search) {
      and.push({
        OR: [
          { name: { contains: f.search, mode: 'insensitive' } },
          { phone: { contains: f.search } },
          { email: { contains: f.search, mode: 'insensitive' } },
        ],
      });
    }
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    const createdAt: Prisma.DateTimeFilter = {};
    if (f.createdFrom && ymd.test(f.createdFrom)) createdAt.gte = new Date(`${f.createdFrom}T00:00:00+05:30`);
    if (f.createdTo && ymd.test(f.createdTo)) createdAt.lte = new Date(`${f.createdTo}T23:59:59.999+05:30`);
    if (createdAt.gte || createdAt.lte) and.push({ createdAt });

    const { from, to } = this.range(f);
    const location = f.location?.trim();
    if (from || to || location) {
      const pin = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
      // customers WITH a saved address are matched on their addresses; the ones without one on the first-login location
      and.push({
        OR: [
          {
            addresses: {
              some: {
                ...(from || to ? { pincode: pin } : {}),
                ...(location
                  ? { OR: [{ street: { contains: location, mode: 'insensitive' } }, { city: { contains: location, mode: 'insensitive' } }] }
                  : {}),
              },
            },
          },
          {
            addresses: { none: {} },
            ...(from || to ? { signupPincode: pin } : {}),
            ...(location ? { signupLocation: { contains: location, mode: 'insensitive' } } : {}),
          },
        ],
      });
    }
    if (f.extraWhere) and.push(f.extraWhere);
    return { AND: and };
  }

  private areaOf(u: CustomerRecord, f: CustomerFilter): CustomerArea {
    const { from, to } = this.range(f);
    const loc = f.location?.trim().toLowerCase();
    const filtering = !!(from || to || loc);
    const matches = (a: { street: string; city: string; pincode: string }) =>
      (!from || a.pincode >= from) &&
      (!to || a.pincode <= to) &&
      (!loc || a.street.toLowerCase().includes(loc) || a.city.toLowerCase().includes(loc));
    const matching = filtering ? u.addresses.filter(matches) : [];
    const pool = matching.length ? matching : u.addresses;
    const primary = pool.find((a) => a.title.trim().toLowerCase() === 'home') ?? pool[0];
    if (primary) {
      return { city: primary.city.trim(), pincode: primary.pincode.trim(), pincodeSource: 'ADDRESS', street: primary.street.trim() };
    }
    if (u.signupPincode || u.signupLocation) {
      return {
        city: (u.signupLocation ?? '').split(',')[0].trim(),
        pincode: (u.signupPincode ?? '').trim(),
        pincodeSource: u.signupPincode ? 'FIRST_LOGIN' : null,
        street: '',
      };
    }
    return { city: '', pincode: '', pincodeSource: null, street: '' };
  }

  private sectionKey(row: CustomerRow, groupBy: CustomerGroupBy): string {
    return groupBy === 'date' ? istDay(row.createdAt) : groupBy === 'pincode' ? row.area.pincode : row.area.city;
  }

  /** Every customer matching the filter, in the requested order (used by the export and the area-based splits). */
  async findAll(f: CustomerFilter, groupBy: CustomerGroupBy = 'date', sort?: 'asc' | 'desc'): Promise<CustomerRow[]> {
    const dir = sort ?? (groupBy === 'date' ? 'desc' : 'asc');
    const users = await this.prisma.user.findMany({
      where: this.buildWhere(f),
      include: WITH_AREA,
      orderBy: { createdAt: groupBy === 'date' ? dir : 'desc' },
    });
    const rows: CustomerRow[] = users.map((u) => ({ ...u, area: this.areaOf(u, f) }));
    if (groupBy !== 'date') {
      const key = (r: CustomerRow) => (groupBy === 'pincode' ? r.area.pincode : r.area.city.toLowerCase());
      rows.sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        if (!ka !== !kb) return ka ? -1 : 1; // customers without an area go last
        const c = ka < kb ? -1 : ka > kb ? 1 : 0;
        return dir === 'asc' ? c : -c;
      });
    }
    return rows;
  }

  /** One page of the list plus the number of customers per section heading across the whole filtered list. */
  async list(
    f: CustomerFilter,
    opts: { skip: number; take: number; groupBy?: CustomerGroupBy; sort?: 'asc' | 'desc' },
  ): Promise<{ items: CustomerRow[]; total: number; groupCounts: Record<string, number> }> {
    const groupBy = opts.groupBy ?? 'date';
    const where = this.buildWhere(f);
    const groupCounts: Record<string, number> = {};

    if (groupBy === 'date') {
      const dir = opts.sort ?? 'desc';
      const [users, total, days] = await Promise.all([
        this.prisma.user.findMany({ where, include: WITH_AREA, orderBy: { createdAt: dir }, skip: opts.skip, take: opts.take }),
        this.prisma.user.count({ where }),
        this.prisma.user.findMany({ where, select: { createdAt: true } }),
      ]);
      for (const d of days) {
        const k = istDay(d.createdAt);
        groupCounts[k] = (groupCounts[k] ?? 0) + 1;
      }
      return { items: users.map((u) => ({ ...u, area: this.areaOf(u, f) })), total, groupCounts };
    }

    const all = await this.findAll(f, groupBy, opts.sort);
    for (const r of all) {
      const k = this.sectionKey(r, groupBy);
      groupCounts[k] = (groupCounts[k] ?? 0) + 1;
    }
    return { items: all.slice(opts.skip, opts.skip + opts.take), total: all.length, groupCounts };
  }
}
