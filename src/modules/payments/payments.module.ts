import { Module } from '@nestjs/common';
import { DriverOnboardingModule } from '../driver-onboarding/driver-onboarding.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';

@Module({ imports: [OrdersModule, DriverOnboardingModule], providers: [PaymentsService], exports: [PaymentsService] })
export class PaymentsModule {}
