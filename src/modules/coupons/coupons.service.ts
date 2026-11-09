import { Injectable } from '@nestjs/common';
import { Coupon, Prisma } from '@prisma/client';
import { ApiException, ErrorCode } from '../../common/api-error';
import { toMoney } from '../../common/utils/money';
import { PrismaService, Tx } from '../../infrastructure/prisma/prisma.service';
import { checkCoupon, CouponCheck, couponStatus, CouponReason } from './coupon.rules';

export interface ValidateCouponInput {
  userId: string;
  orderTotal: number;
  code?: string;
  couponId?: string;
}

export type ValidatedCoupon = { coupon: Coupon; discountAmount: number; payableTotal: number };

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  static normalizeCode(code?: string | null) {
    return code ? String(code).trim().toUpperCase() : null;
  }

  // ---------- customer ----------

  /** Returns the check result for the app (never throws for "invalid coupon"). */
  async check(input: ValidateCouponInput, tx?: Tx): Promise<(CouponCheck & { coupon?: Coupon }) | null> {
    const db = tx ?? this.prisma;
    const coupon = await this.find(db, input, !!tx);
    if (!coupon) return null;
    // Public lookups by code must not reveal hidden coupons that are not meant for this user.
    return { ...(await this.evaluate(db, coupon, input)), coupon };
  }

  /** Used by order placement: throws a coded error when the coupon cannot be applied. Locks the coupon row. */
  async validateOrThrow(input: ValidateCouponInput, tx: Tx, lock = true): Promise<ValidatedCoupon> {
    const coupon = await this.find(tx, input, lock);
    if (!coupon) {
      throw ApiException.badRequest(ErrorCode.COUPON_INVALID, 'Coupon not found.', { reason: CouponReason.NOT_FOUND });
    }
    const result = await this.evaluate(tx, coupon, input);
    if (!result.valid) {
      throw ApiException.badRequest(ErrorCode.COUPON_INVALID, result.message, { reason: result.reason });
    }
    return { coupon, discountAmount: result.discountAmount, payableTotal: result.payableTotal };
  }

  async redeem(tx: Tx, data: { couponId: string; userId: string; orderId: string; discountAmount: number }) {
    return tx.couponRedemption.create({
      data: {
        couponId: data.couponId,
        userId: data.userId,
        orderId: data.orderId,
        discountAmount: toMoney(data.discountAmount),
        status: 'used',
      },
    });
  }

  /** Public, currently-valid coupons for this user and basket. */
  async availableFor(userId: string, orderTotal: number) {
    const coupons = await this.prisma.coupon.findMany({
      where: { isActive: true, visibility: 'public' },
      orderBy: { createdAt: 'desc' },
    });
    const out: Array<ReturnType<CouponsService['present']> & { discountAmount: number; payableTotal: number }> = [];
    for (const coupon of coupons) {
      const result = await this.evaluate(this.prisma, coupon, { userId, orderTotal });
      if (result.valid) {
        out.push({
          ...this.present(coupon, 0),
          discountAmount: result.discountAmount,
          payableTotal: result.payableTotal,
        });
      }
    }
    return out;
  }

  // ---------- admin ----------

  async adminList(filters: { status?: 'active' | 'inactive'; visibility?: 'public' | 'hidden'; q?: string; skip: number; take: number }) {
    const where: Prisma.CouponWhereInput = {
      ...(filters.status ? { isActive: filters.status === 'active' } : {}),
      ...(filters.visibility ? { visibility: filters.visibility } : {}),
      ...(filters.q
        ? { OR: [{ code: { contains: filters.q.trim(), mode: 'insensitive' } }, { title: { contains: filters.q.trim(), mode: 'insensitive' } }] }
        : {}),
    };
    const [coupons, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({ where, orderBy: { createdAt: 'desc' }, skip: filters.skip, take: filters.take }),
      this.prisma.coupon.count({ where }),
    ]);
    const counts = await this.prisma.couponRedemption.groupBy({
      by: ['couponId'],
      where: { couponId: { in: coupons.map((c) => c.id) }, status: 'used' },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.couponId, c._count._all]));
    return { items: coupons.map((c) => this.present(c, byId.get(c.id) ?? 0)), total };
  }

  async adminDetails(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw ApiException.notFound('Coupon');
    const [agg, recentOrders] = await Promise.all([
      this.prisma.couponRedemption.aggregate({
        where: { couponId: id, status: 'used' },
        _count: { _all: true },
        _sum: { discountAmount: true },
      }),
      this.prisma.order.findMany({
        where: { couponId: id },
        select: { id: true, userId: true, totalAmount: true, discountAmount: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      ...this.present(coupon, agg._count._all),
      totalDiscountGiven: toMoney(agg._sum.discountAmount ?? 0),
      recentOrders,
    };
  }

  async create(data: Omit<Prisma.CouponUncheckedCreateInput, 'code'> & { code: string }) {
    const coupon = await this.prisma.coupon.create({ data: { ...data, code: CouponsService.normalizeCode(data.code)! } });
    return this.present(coupon, 0);
  }

  async update(id: string, data: Prisma.CouponUncheckedUpdateInput) {
    if (typeof data.code === 'string') data.code = CouponsService.normalizeCode(data.code)!;
    const coupon = await this.prisma.coupon.update({ where: { id }, data });
    return this.present(coupon, await this.prisma.couponRedemption.count({ where: { couponId: id } }));
  }

  // ---------- internals ----------

  /** Locks the coupon row inside an order transaction so two concurrent orders cannot both use the last redemption. */
  private async find(db: Tx | PrismaService, input: ValidateCouponInput, lock: boolean): Promise<Coupon | null> {
    const code = CouponsService.normalizeCode(input.code);
    if (!input.couponId && !code) return null;
    const coupon = await db.coupon.findFirst({ where: input.couponId ? { id: input.couponId } : { code: code! } });
    if (coupon && lock) await (db as Tx).$queryRaw`SELECT id FROM coupons WHERE id = ${coupon.id}::uuid FOR UPDATE`;
    return coupon;
  }

  private async evaluate(db: Tx | PrismaService, coupon: Coupon, input: ValidateCouponInput): Promise<CouponCheck> {
    const [userRedemptions, totalRedemptions, priorOrders] = await Promise.all([
      db.couponRedemption.count({ where: { couponId: coupon.id, userId: input.userId, status: 'used' } }),
      db.couponRedemption.count({ where: { couponId: coupon.id, status: 'used' } }),
      coupon.audienceType === 'new_users_only' ? db.order.count({ where: { userId: input.userId } }) : Promise.resolve(0),
    ]);
    return checkCoupon(coupon, { now: new Date(), orderTotal: input.orderTotal, priorOrders, userRedemptions, totalRedemptions });
  }

  present(coupon: Coupon, totalRedemptions: number) {
    const remaining =
      coupon.totalRedemptionLimit != null ? Math.max(coupon.totalRedemptionLimit - totalRedemptions, 0) : null;
    return {
      id: coupon.id,
      code: coupon.code,
      title: coupon.title,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: toMoney(coupon.discountValue),
      maxDiscountAmount: coupon.maxDiscountAmount != null ? toMoney(coupon.maxDiscountAmount) : null,
      minOrderAmount: coupon.minOrderAmount != null ? toMoney(coupon.minOrderAmount) : null,
      maxOrderAmount: coupon.maxOrderAmount != null ? toMoney(coupon.maxOrderAmount) : null,
      startAt: coupon.startAt,
      endAt: coupon.endAt,
      isActive: coupon.isActive,
      visibility: coupon.visibility,
      audienceType: coupon.audienceType,
      totalRedemptionLimit: coupon.totalRedemptionLimit,
      perUserLimit: coupon.perUserLimit,
      autoHideAfterUse: coupon.autoHideAfterUse,
      totalRedemptions,
      remainingRedemptions: remaining,
      status: couponStatus(coupon, totalRedemptions),
    };
  }
}
