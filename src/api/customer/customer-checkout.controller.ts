import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, CurrentUser, Public } from '../../common/decorators';
import { CouponsService } from '../../modules/coupons/coupons.service';
import { HubsService } from '../../modules/hubs/hubs.service';
import { PaymentsService } from '../../modules/payments/payments.service';
import { SupportService } from '../../modules/support/support.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Paginated } from '../../common/api-response';
import { AvailableCouponsQueryDto, CreateTicketDto, HubQueryDto, ValidateCouponDto, VerifyPaymentDto } from './dto/customer.dto';

@ApiTags('Customer · Coupons')
@Auth('CUSTOMER')
@Controller('coupons')
export class CustomerCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get('available')
  @ApiOperation({ summary: 'Public coupons that currently apply to my basket' })
  available(@CurrentUser('id') userId: string, @Query() q: AvailableCouponsQueryDto) {
    return this.coupons.availableFor(userId, q.orderTotal);
  }

  @Post('validate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check a coupon code against my basket total' })
  async validate(@CurrentUser('id') userId: string, @Body() dto: ValidateCouponDto) {
    const result = await this.coupons.check({ userId, orderTotal: dto.orderTotal, code: dto.code, couponId: dto.couponId });
    // Hidden coupons only apply when you know the code, public ones always; unknown code -> not found
    if (!result) return { valid: false, reason: 'NOT_FOUND', message: 'Coupon not found.' };
    if (!result.valid) return { valid: false, reason: result.reason, message: result.message };
    return {
      valid: true,
      message: 'Coupon applied successfully.',
      coupon: this.coupons.present(result.coupon!, 0),
      discountAmount: result.discountAmount,
      payableTotal: result.payableTotal,
    };
  }
}

@ApiTags('Customer · Store')
@Public()
@Controller('hubs')
export class CustomerHubsController {
  constructor(private readonly hubs: HubsService) {}

  @Get('resolve')
  @ApiOperation({
    summary: 'Which hub serves this pincode, and its fee/opening rules',
    description: 'Returns `serviceable: false` (with the default hub for display) when no hub delivers to the pincode.',
  })
  async resolve(@Query() q: HubQueryDto) {
    const hub = q.hubId ? await this.hubs.getById(q.hubId) : q.pincode ? await this.hubs.findForPincode(q.pincode) : await this.hubs.getDefault();
    const shown = hub ?? (await this.hubs.getDefault());
    if (!shown) return { serviceable: false, hub: null };
    return {
      serviceable: !!hub,
      hub: {
        id: shown.id,
        name: shown.name,
        latitude: shown.latitude,
        longitude: shown.longitude,
        ordersPaused: shown.ordersPaused,
        pauseReason: shown.ordersPaused ? shown.pauseReason : null,
        storeStartTime: shown.storeStartTime,
        storeCloseTime: shown.storeCloseTime,
        deliveryFeeStrategy: shown.deliveryFeeStrategy,
        deliveryFeeAmount: shown.deliveryFeeAmount,
        minOrderForFreeDelivery: shown.minOrderForFreeDelivery,
        freeDeliveryDistanceKm: shown.freeDeliveryDistanceKm,
        distanceDeliveryFeeAmount: shown.distanceDeliveryFeeAmount,
        distanceTiers: shown.distanceTiers,
        deliverablePincodes: shown.deliverablePincodes,
      },
    };
  }
}

@ApiTags('Customer · Payments')
@Auth('CUSTOMER')
@Controller('payments')
export class CustomerPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('orders/:id/pay-online')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Pay an already placed Cash on Delivery order online',
    description: 'Open until the order is out for delivery (+5 minutes). Returns the gateway session to open in the app.',
  })
  payOnline(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.payments.startCodOnlinePayment(userId, id);
  }

  @Post('orders/:id/payment-failed')
  @HttpCode(200)
  @ApiOperation({
    summary: 'The payment sheet failed or was closed without paying',
    description:
      'Does NOT cancel the order. Up to the COD limit it carries on as Cash on Delivery (outcome COD, payment "COD - Pending"); ' +
      'above it the order is FAILED until paid online (outcome FAILED). `retriesLeft` counts the online retries still offered (3 in total).',
  })
  paymentFailed(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.payments.reportFailedForCustomer(userId, id);
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm an online payment after the payment sheet closes',
    description: 'The server asks the gateway for the real status. `PENDING` means the customer may still pay.',
  })
  verify(@CurrentUser('id') userId: string, @Body() dto: VerifyPaymentDto) {
    return this.payments.verifyForCustomer(userId, dto.orderId);
  }
}

@ApiTags('Customer · Support')
@Auth('CUSTOMER')
@Controller('support/tickets')
export class CustomerSupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @ApiOperation({ summary: 'Raise a support ticket' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateTicketDto) {
    return this.support.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My tickets' })
  async list(@CurrentUser('id') userId: string, @Query() page: PaginationDto) {
    const { items, total } = await this.support.listForUser(userId, page.skip, page.limit);
    return new Paginated(items, total, page.page, page.limit);
  }
}
