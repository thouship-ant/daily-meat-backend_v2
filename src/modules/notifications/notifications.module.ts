import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TrackingModule } from '../tracking/tracking.module';
import { UsersModule } from '../users/users.module';
import { NotificationsService } from './notifications.service';
import { OrderNotificationsListener } from './order-notifications.listener';
import { PushService } from './push.service';
import { RealtimeGateway } from './realtime.gateway';

/** Push + realtime delivery. Reacts to domain events; nothing in the business modules imports this. */
@Module({
  imports: [
    UsersModule,
    TrackingModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({ secret: c.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  providers: [PushService, RealtimeGateway, NotificationsService, OrderNotificationsListener],
  exports: [NotificationsService],
})
export class NotificationsModule {}
