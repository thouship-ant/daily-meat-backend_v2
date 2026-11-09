import { Module } from '@nestjs/common';
import { AddressesModule } from '../../modules/addresses/addresses.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { CouponsModule } from '../../modules/coupons/coupons.module';
import { HubsModule } from '../../modules/hubs/hubs.module';
import { OrdersModule } from '../../modules/orders/orders.module';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { SupportModule } from '../../modules/support/support.module';
import { UsersModule } from '../../modules/users/users.module';
import { CustomerAddressesController } from './customer-addresses.controller';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerCatalogController } from './customer-catalog.controller';
import {
  CustomerCouponsController,
  CustomerHubsController,
  CustomerPaymentsController,
  CustomerSupportController,
} from './customer-checkout.controller';
import { CustomerOrdersController } from './customer-orders.controller';
import { CustomerProfileController } from './customer-profile.controller';

/**
 * Customer API surface (mobile app). Mounted at /customer.
 * It only composes domain modules - no business logic lives here, so it can change independently of Admin/Driver.
 */
@Module({
  imports: [AuthModule, UsersModule, CatalogModule, AddressesModule, OrdersModule, CouponsModule, PaymentsModule, HubsModule, SupportModule],
  controllers: [
    CustomerAuthController,
    CustomerProfileController,
    CustomerCatalogController,
    CustomerAddressesController,
    CustomerOrdersController,
    CustomerCouponsController,
    CustomerHubsController,
    CustomerPaymentsController,
    CustomerSupportController,
  ],
})
export class CustomerApiModule {}
