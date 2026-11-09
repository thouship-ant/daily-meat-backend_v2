import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';

@Module({ imports: [OrdersModule], providers: [PaymentsService], exports: [PaymentsService] })
export class PaymentsModule {}
