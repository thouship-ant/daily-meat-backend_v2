import { Module } from '@nestjs/common';
import { AddressesModule } from '../../modules/addresses/addresses.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { CouponsModule } from '../../modules/coupons/coupons.module';
import { HubsModule } from '../../modules/hubs/hubs.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { OrdersModule } from '../../modules/orders/orders.module';
import { ReportsModule } from '../../modules/reports/reports.module';
import { SupportModule } from '../../modules/support/support.module';
import { UsersModule } from '../../modules/users/users.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCatalogController } from './admin-catalog.controller';
import {
  AdminAnalysisController,
  AdminCustomersController,
  AdminDashboardController,
  AdminDriversController,
  AdminOrdersController,
  AdminReportsController,
} from './admin-operations.controller';
import { AdminContactController, AdminCouponsController, AdminHubsController, AdminMarketingController, AdminSellerBillsController, AdminSlotsController, AdminTicketsController } from './admin-store.controller';

/** Admin API surface (back-office app). Mounted at /admin. */
@Module({
  imports: [AddressesModule, AuthModule, UsersModule, OrdersModule, CatalogModule, HubsModule, ReportsModule, CouponsModule, SupportModule, NotificationsModule],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
    AdminAnalysisController,
    AdminReportsController,
    AdminMarketingController,
    AdminContactController,
    AdminSellerBillsController,
    AdminOrdersController,
    AdminDriversController,
    AdminCustomersController,
    AdminCatalogController,
    AdminHubsController,
    AdminSlotsController,
    AdminCouponsController,
    AdminTicketsController,
  ],
})
export class AdminApiModule {}
