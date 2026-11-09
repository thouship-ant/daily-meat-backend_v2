import { Module } from '@nestjs/common';
import { AuthModule } from '../../modules/auth/auth.module';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { CouponsModule } from '../../modules/coupons/coupons.module';
import { HubsModule } from '../../modules/hubs/hubs.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { OrdersModule } from '../../modules/orders/orders.module';
import { SupportModule } from '../../modules/support/support.module';
import { UsersModule } from '../../modules/users/users.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCatalogController } from './admin-catalog.controller';
import {
  AdminCustomersController,
  AdminDashboardController,
  AdminDriversController,
  AdminOrdersController,
} from './admin-operations.controller';
import { AdminCouponsController, AdminHubsController, AdminSlotsController, AdminTicketsController } from './admin-store.controller';

/** Admin API surface (back-office app). Mounted at /admin. */
@Module({
  imports: [AuthModule, UsersModule, OrdersModule, CatalogModule, HubsModule, CouponsModule, SupportModule, NotificationsModule],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
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
