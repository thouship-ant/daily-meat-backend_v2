import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CodOnlinePaymentClosedEvent, DomainEvents } from '../../common/events/domain-events';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ONLINE_PAY_GRACE_MINUTES } from './cod-online-payment';
import { OrderLifecycleService } from './order-lifecycle.service';

const EVERY_MS = 30_000;

/**
 * Online payment of a COD order closes ONLINE_PAY_GRACE_MINUTES after it went out for delivery. The app hides the
 * option by itself (the server says `onlinePayAvailable: false`); this job tells the driver, once, to collect cash.
 */
@Injectable()
export class OnlinePayWindowJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OnlinePayWindowJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const cutoff = new Date(now.getTime() - ONLINE_PAY_GRACE_MINUTES * 60_000);
      const due = await this.prisma.order.findMany({
        where: {
          paymentMethod: 'COD',
          paymentStatus: { not: 'PAID' },
          status: 'OUT_FOR_DELIVERY',
          outForDeliveryAt: { lte: cutoff },
          payClosedNotifiedAt: null,
          driverId: { not: null },
        },
        select: { id: true },
        take: 200,
      });
      let told = 0;
      for (const { id } of due) {
        // claim it first, so only one instance / run tells the driver
        const claim = await this.prisma.order.updateMany({ where: { id, payClosedNotifiedAt: null }, data: { payClosedNotifiedAt: now } });
        if (claim.count !== 1) continue;
        const order = await this.lifecycle.load(id);
        this.events.emit(DomainEvents.CodOnlinePaymentClosed, {
          order: this.lifecycle.summarize(order),
          amount: Number(order.totalAmount),
        } satisfies CodOnlinePaymentClosedEvent);
        told++;
      }
      return told;
    } catch (e) {
      this.logger.error(`online payment window check failed: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
