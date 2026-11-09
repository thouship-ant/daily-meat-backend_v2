import { Module } from '@nestjs/common';
import { CouponsModule } from '../coupons/coupons.module';
import { HubsModule } from '../hubs/hubs.module';
import { DeliverySlotsService } from './delivery-slots.service';
import { ManualOrderService } from './manual-order.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderPlacementService } from './order-placement.service';
import { OrderQueryService } from './order-query.service';

/**
 * Orders domain. It has NO dependency on notifications, controllers or any API surface:
 * it emits domain events and other modules react.
 */
@Module({
  imports: [HubsModule, CouponsModule],
  providers: [DeliverySlotsService, OrderPlacementService, OrderLifecycleService, OrderQueryService, ManualOrderService],
  exports: [DeliverySlotsService, OrderPlacementService, OrderLifecycleService, OrderQueryService, ManualOrderService],
})
export class OrdersModule {}
