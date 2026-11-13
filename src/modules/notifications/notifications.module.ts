import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { HubsModule } from '../hubs/hubs.module';
import { TrackingModule } from '../tracking/tracking.module';
import { UsersModule } from '../users/users.module';
import { MarketingService } from './marketing.service';
import { NotificationsService } from './notifications.service';
import { OrderNotificationsListener } from './order-notifications.listener';
import { PromoRemindersService } from './promo-reminders.service';
import { PushService } from './push.service';
import { RealtimeGateway } from './realtime.gateway';

/** Push + realtime delivery. Reacts to domain events; nothing in the business modules imports this. */
@Module({
  imports: [
    UsersModule,
    HubsModule,
    TrackingModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({ secret: c.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  providers: [PushService, RealtimeGateway, NotificationsService, OrderNotificationsListener, MarketingService, PromoRemindersService],
  exports: [NotificationsService, MarketingService, PromoRemindersService],
})
export class NotificationsModule {}
