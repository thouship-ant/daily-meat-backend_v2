import { Injectable } from '@nestjs/common';
import { Hub, Prisma } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { toMoney } from '../../common/utils/money';
import { distanceKm } from '../../common/utils/geo';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { PrismaService, Tx } from '../../infrastructure/prisma/prisma.service';

export interface DistanceTier {
  upToKm: number;
  fee: number;
}

/** A hub with its JSON-in-TEXT columns decoded. */
export interface HubView extends Omit<Hub, 'deliverablePincodes' | 'distanceTiers'> {
  deliverablePincodes: string[];
  distanceTiers: DistanceTier[];
}

export interface DeliveryFeeInput {
  subtotal: number;
  /** customer location; needed for the distance strategy */
  latitude?: number | null;
  longitude?: number | null;
}

const HUBS_CACHE_KEY = 'hubs:active';

/**
 * Hubs (a row of `shop_settings`): service area by pincode, opening hours, pause switch and delivery fee rules.
 * The delivery fee is calculated HERE (server side) - v1 trusted whatever fee the client sent.
 */
@Injectable()
export class HubsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // ---------- decoding ----------

  decode(hub: Hub): HubView {
    return {
      ...hub,
      deliverablePincodes: parseJson<string[]>(hub.deliverablePincodes, []).map(String),
      distanceTiers: normalizeTiers(parseJson<unknown[]>(hub.distanceTiers, [])),
    };
  }

  // ---------- lookups ----------

  async listActive(tx?: Tx): Promise<HubView[]> {
    if (tx) return (await tx.hub.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } })).map((h) => this.decode(h));
    return this.cache.wrap(HUBS_CACHE_KEY, 60, async () =>
      (await this.prisma.hub.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } })).map((h) => this.decode(h)),
    );
  }

  async listAll(): Promise<HubView[]> {
    return (await this.prisma.hub.findMany({ orderBy: { id: 'asc' } })).map((h) => this.decode(h));
  }

  async getById(id: number): Promise<HubView> {
    const hub = await this.prisma.hub.findUnique({ where: { id } });
    if (!hub) throw ApiException.notFound('Hub');
    return this.decode(hub);
  }

  /**
   * Customers of a hub = the customers whose pincode is one of the hub's deliverable pincodes: the pincode of a
   * saved delivery address, or - for a customer with no saved address yet - the pincode of the location where they
   * first opened the app. Worked out when asked, so a pincode added to the hub later brings its customers along
   * (and takes them away from the hub it moved from) with nothing to copy.
   * undefined when no hub is asked for (= all hubs). A hub with no pincodes has no customers.
   */
  async customerScope(hubId?: number | null): Promise<Prisma.UserWhereInput | undefined> {
    if (hubId == null) return undefined;
    const hub = await this.getById(hubId);
    const pins = hub.deliverablePincodes;
    if (!pins.length) return { id: { in: [] } };
    return {
      OR: [
        { addresses: { some: { pincode: { in: pins } } } },
        { addresses: { none: {} }, signupPincode: { in: pins } },
      ],
    };
  }

  /**
   * The hub a customer belongs to: the hub of their latest order, else the hub serving their saved address, else the
   * one serving the pincode they first opened the app in, else the default hub. Null only when there is no hub.
   */
  async hubForCustomer(userId: string): Promise<HubView | null> {
    const last = await this.prisma.order.findFirst({ where: { userId, hubId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { hubId: true } });
    if (last?.hubId) {
      const hub = await this.prisma.hub.findUnique({ where: { id: last.hubId } });
      if (hub) return this.decode(hub);
    }
    const address = await this.prisma.address.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { pincode: true } });
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { signupPincode: true } });
    for (const pin of [address?.pincode, user?.signupPincode]) {
      if (pin) {
        const hub = await this.findForPincode(pin);
        if (hub) return hub;
      }
    }
    return this.getDefault();
  }

  /** First active hub: used when nothing says which hub is meant (guests). */
  async getDefault(): Promise<HubView | null> {
    const active = await this.listActive();
    if (active[0]) return active[0];
    const any = await this.prisma.hub.findFirst({ orderBy: { id: 'asc' } });
    return any ? this.decode(any) : null;
  }

  /**
   * The active hub delivering to a pincode. A hub with an empty pincode list delivers everywhere, but is only
   * used when no other hub lists the pincode explicitly.
   */
  async findForPincode(pincode: string | null | undefined, tx?: Tx): Promise<HubView | null> {
    const pin = String(pincode ?? '').trim();
    const hubs = await this.listActive(tx);
    if (pin) {
      const listed = hubs.find((h) => h.deliverablePincodes.includes(pin));
      if (listed) return listed;
    }
    return hubs.find((h) => h.deliverablePincodes.length === 0) ?? null;
  }

  // ---------- rules ----------

  /** Is the store open right now (IST)? `closeGraceMinutes` allows last-minute orders after closing time. */
  isOpenNow(hub: HubView, minutesNow: number, closeGraceMinutes = 10): boolean {
    const open = toMinutes(hub.storeStartTime);
    const close = toMinutes(hub.storeCloseTime);
    if (open === null || close === null) return true;
    return minutesNow >= open && minutesNow <= close + closeGraceMinutes;
  }

  calculateDeliveryFee(hub: HubView, input: DeliveryFeeInput): number {
    const subtotal = toMoney(input.subtotal);

    if (hub.deliveryFeeStrategy === 'distance') {
      if (input.latitude == null || input.longitude == null) return toMoney(hub.distanceDeliveryFeeAmount);
      const km = distanceKm(input.latitude, input.longitude, hub.latitude, hub.longitude);
      if (hub.distanceTiers.length) {
        const tier = [...hub.distanceTiers].sort((a, b) => a.upToKm - b.upToKm).find((t) => km <= t.upToKm);
        if (tier) return toMoney(tier.fee);
        return toMoney(hub.distanceTiers[hub.distanceTiers.length - 1].fee);
      }
      return km <= hub.freeDeliveryDistanceKm ? 0 : toMoney(hub.distanceDeliveryFeeAmount);
    }

    // default: flat fee, free above a basket threshold
    return subtotal >= hub.minOrderForFreeDelivery ? 0 : toMoney(hub.deliveryFeeAmount);
  }

  // ---------- admin writes ----------

  async create(data: HubWriteInput): Promise<HubView> {
    await this.assertNoPincodeConflict(null, data.deliverablePincodes);
    const hub = await this.prisma.hub.create({ data: this.encode(data) as Prisma.HubCreateInput });
    await this.invalidate();
    return this.decode(hub);
  }

  async update(id: number, data: HubWriteInput): Promise<HubView> {
    await this.getById(id);
    if (data.deliverablePincodes) await this.assertNoPincodeConflict(id, data.deliverablePincodes);
    const hub = await this.prisma.hub.update({ where: { id }, data: this.encode(data) });
    await this.invalidate();
    return this.decode(hub);
  }

  async remove(id: number): Promise<void> {
    const orders = await this.prisma.order.count({ where: { hubId: id } });
    if (orders > 0) {
      throw ApiException.conflict('This hub has orders. Deactivate it instead of deleting it.');
    }
    await this.prisma.hub.delete({ where: { id } });
    await this.invalidate();
  }

  async setAllPaused(paused: boolean, reason?: string): Promise<number> {
    const { count } = await this.prisma.hub.updateMany({
      data: { ordersPaused: paused, ...(reason !== undefined ? { pauseReason: reason } : {}) },
    });
    await this.invalidate();
    return count;
  }

  private invalidate() {
    return this.cache.del(HUBS_CACHE_KEY);
  }

  /** A pincode may belong to only one active hub. */
  private async assertNoPincodeConflict(hubId: number | null, pincodes?: string[]) {
    if (!pincodes?.length) return;
    const clean = cleanPincodes(pincodes);
    const others = await this.prisma.hub.findMany({ where: { isActive: true, ...(hubId ? { id: { not: hubId } } : {}) } });
    const conflicts: string[] = [];
    for (const o of others) {
      const taken = clean.filter((p) => parseJson<string[]>(o.deliverablePincodes, []).map(String).includes(p));
      if (taken.length) conflicts.push(`${taken.join(', ')} (already served by "${o.name}")`);
    }
    if (conflicts.length) throw ApiException.conflict(`Pincode conflict: ${conflicts.join('; ')}`);
  }

  private encode(data: HubWriteInput): Prisma.HubUpdateInput {
    const { deliverablePincodes, distanceTiers, ...rest } = data;
    return {
      ...rest,
      ...(deliverablePincodes ? { deliverablePincodes: JSON.stringify(cleanPincodes(deliverablePincodes)) } : {}),
      ...(distanceTiers ? { distanceTiers: JSON.stringify(distanceTiers) } : {}),
    };
  }
}

export interface HubWriteInput {
  name?: string;
  isActive?: boolean;
  latitude?: number;
  longitude?: number;
  deliveryRadiusKm?: number;
  deliverablePincodes?: string[];
  distanceTiers?: DistanceTier[];
  minOrderForFreeDelivery?: number;
  deliveryFeeAmount?: number;
  freeDeliveryDistanceKm?: number;
  distanceDeliveryFeeAmount?: number;
  deliveryFeeStrategy?: string;
  storeStartTime?: string;
  storeCloseTime?: string;
  ordersPaused?: boolean;
  pauseReason?: string;
}

// ---------- helpers ----------

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const cleanPincodes = (list: unknown[]) => [...new Set((list ?? []).map((p) => String(p).trim()).filter(Boolean))];

function toMinutes(hhmm?: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** v1 stored tiers with loose keys; accept the common spellings and normalise. */
function normalizeTiers(raw: unknown[]): DistanceTier[] {
  return raw
    .map((t: any) => ({
      upToKm: Number(t?.upToKm ?? t?.up_to_km ?? t?.max_km ?? t?.maxKm ?? t?.distance_km ?? t?.km),
      fee: Number(t?.fee ?? t?.amount ?? t?.charge ?? t?.price),
    }))
    .filter((t) => Number.isFinite(t.upToKm) && Number.isFinite(t.fee));
}
