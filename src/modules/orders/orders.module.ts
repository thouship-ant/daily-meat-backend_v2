import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { CouponsModule } from '../coupons/coupons.module';
import { HubsModule } from '../hubs/hubs.module';
import { UsersModule } from '../users/users.module';
import { DeliverySlotsService } from './delivery-slots.service';
import { ManualOrderService } from './manual-order.service';
import { OnlinePayWindowJob } from './online-pay-window.job';
import { OrderAddressService } from './order-address.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderPlacementService } from './order-placement.service';
import { OrderQueryService } from './order-query.service';

/**
 * Orders domain. It has NO dependency on notifications, controllers or any API surface:
 * it emits domain events and other modules react.
 */
@Module({
  imports: [UsersModule, HubsModule, CouponsModule, AddressesModule],
  providers: [OnlinePayWindowJob, DeliverySlotsService, OrderPlacementService, OrderLifecycleService, OrderQueryService, ManualOrderService, OrderAddressService],
  exports: [DeliverySlotsService, OrderPlacementService, OrderLifecycleService, OrderQueryService, ManualOrderService, OrderAddressService],
})
export class OrdersModule {}
