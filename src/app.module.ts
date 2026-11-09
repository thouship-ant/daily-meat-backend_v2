import { Module, ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, RouterModule } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminApiModule } from './api/admin/admin-api.module';
import { CustomerApiModule } from './api/customer/customer-api.module';
import { DriverApiModule } from './api/driver/driver-api.module';
import { PublicController } from './api/shared/public.controller';
import { WebhooksApiModule } from './api/webhooks/payments-webhook.controller';
import { ApiException, ErrorCode } from './common/api-error';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { envValidationSchema } from './config/env.validation';
import { CacheModule } from './infrastructure/cache/cache.module';
import { MessagingModule } from './infrastructure/messaging/messaging.module';
import { PaymentGatewayModule } from './infrastructure/payments/payment-gateway.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

/** Flattens class-validator errors into `[{ field, messages[] }]`. */
function flatten(errors: ValidationError[], parent = ''): Array<{ field: string; messages: string[] }> {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, messages: Object.values(e.constraints) }] : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema, validationOptions: { abortEarly: false, allowUnknown: true } }),
    EventEmitterModule.forRoot({ wildcard: false, ignoreErrors: false }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),

    // infrastructure (global)
    PrismaModule,
    CacheModule,
    MessagingModule,
    StorageModule,
    PaymentGatewayModule,

    // cross-cutting domain modules that must be loaded once (strategy + event listeners)
    AuthModule,
    NotificationsModule,

    // API surfaces - thin, independent of each other
    CustomerApiModule,
    AdminApiModule,
    DriverApiModule,
    WebhooksApiModule,

    RouterModule.register([
      { path: 'customer', module: CustomerApiModule },
      { path: 'admin', module: AdminApiModule },
      { path: 'driver', module: DriverApiModule },
    ]),
  ],
  controllers: [PublicController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) =>
          ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Validation failed.', flatten(errors)),
      }),
    },
  ],
})
export class AppModule {}
