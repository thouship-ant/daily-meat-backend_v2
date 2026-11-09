import { Global, Module } from '@nestjs/common';
import { CashfreeGateway } from './cashfree.gateway';

@Global()
@Module({ providers: [CashfreeGateway], exports: [CashfreeGateway] })
export class PaymentGatewayModule {}
