import { Controller, Headers, HttpCode, Module, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { PaymentsService } from '../../modules/payments/payments.service';

/** Called by Cashfree, not by our apps: authenticated by signature, not by JWT. */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-timestamp') timestamp?: string,
    @Headers('x-webhook-signature') signature?: string,
  ) {
    await this.payments.handleWebhook(req.rawBody, timestamp, signature);
    return { received: true };
  }
}

@Module({ imports: [PaymentsModule], controllers: [PaymentsWebhookController] })
export class WebhooksApiModule {}
