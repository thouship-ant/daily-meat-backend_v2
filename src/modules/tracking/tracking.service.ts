import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiException } from '../../common/api-error';
import { DomainEvents, DriverArrivedEvent, DriverLocationEvent } from '../../common/events/domain-events';
import { distanceKm } from '../../common/utils/geo';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface LocationFix {
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
}
export interface StoredLocation extends LocationFix {
  timestamp: string;
}

const LOCATION_TTL = 30 * 60; // last known position is useful for 30 min
const ARRIVED_TTL = 6 * 60 * 60;

/** Live delivery tracking: keeps the last known driver position per order and detects arrival. */
@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  async lastLocation(orderId: string): Promise<StoredLocation | null> {
    return this.cache.get<StoredLocation>(`track:loc:${orderId}`);
  }

  /** The driver's phone reports a position for the orders it is carrying. Only the driver's own orders count. */
  async report(driverId: string, orderIds: string[], fix: LocationFix): Promise<{ accepted: string[] }> {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds }, driverId, status: { in: ['ASSIGNED', 'PICKED', 'OUT_FOR_DELIVERY'] } },
      select: { id: true, userId: true, status: true, addressLatitude: true, addressLongitude: true },
    });
    if (!orders.length) throw ApiException.notFound('Active order');

    const stored: StoredLocation = { ...fix, timestamp: new Date().toISOString() };
    await Promise.all(orders.map((o) => this.cache.set(`track:loc:${o.id}`, stored, LOCATION_TTL)));

    this.events.emit(DomainEvents.DriverLocationUpdated, {
      driverId,
      orderIds: orders.map((o) => o.id),
      ...fix,
    } satisfies DriverLocationEvent);

    // arrival detection
    const radiusM = Number(this.config.get('ARRIVAL_RADIUS_METERS') ?? 150);
    for (const o of orders) {
      if (o.status !== 'OUT_FOR_DELIVERY' || o.addressLatitude == null || o.addressLongitude == null) continue;
      const meters = distanceKm(fix.latitude, fix.longitude, Number(o.addressLatitude), Number(o.addressLongitude)) * 1000;
      if (meters <= radiusM) await this.announceArrival(o.id, o.userId);
    }
    return { accepted: orders.map((o) => o.id) };
  }

  /** Driver taps "I have arrived". */
  async arrived(driverId: string, orderId: string): Promise<{ notified: boolean }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, driverId, status: 'OUT_FOR_DELIVERY' },
      select: { id: true, userId: true },
    });
    if (!order) throw ApiException.notFound('Order out for delivery');
    return { notified: await this.announceArrival(order.id, order.userId) };
  }

  /** At most one "arrived" notification per order. */
  private async announceArrival(orderId: string, userId: string): Promise<boolean> {
    const key = `track:arrived:${orderId}`;
    if (await this.cache.get(key)) return false;
    await this.cache.set(key, 1, ARRIVED_TTL);
    this.events.emit(DomainEvents.DriverArrived, { orderId, userId } satisfies DriverArrivedEvent);
    return true;
  }
}
