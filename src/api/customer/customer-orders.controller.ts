import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Message, Paginated } from '../../common/api-response';
import { Auth, AuthUser, CurrentUser, Public, ResponseMessage } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { DeliverySlotsService } from '../../modules/orders/delivery-slots.service';
import { OrderLifecycleService } from '../../modules/orders/order-lifecycle.service';
import { OrderPlacementService } from '../../modules/orders/order-placement.service';
import { OrderQueryService } from '../../modules/orders/order-query.service';
import { presentOrder } from '../../modules/orders/order.presenter';
import { CancelOrderDto, PlaceOrderDto, QuoteDto } from './dto/customer.dto';

@ApiTags('Customer · Orders')
@Auth('CUSTOMER')
@Controller()
export class CustomerOrdersController {
  constructor(
    private readonly placement: OrderPlacementService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly queries: OrderQueryService,
    private readonly slots: DeliverySlotsService,
  ) {}

  @Public()
  @Get('delivery-slots')
  @ApiOperation({ summary: 'Active delivery time windows, earliest first' })
  deliverySlots() {
    return this.slots.listActive();
  }

  @Post('orders/quote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Price a basket (delivery fee, coupon, total) without placing it' })
  quote(@CurrentUser() user: AuthUser, @Body() dto: QuoteDto) {
    return this.placement.quote(user, dto);
  }

  @Post('orders')
  @ResponseMessage('Order placed.')
  @ApiOperation({
    summary: 'Place an order',
    description:
      'Send only variant ids and quantities. Prices, delivery fee and discount are calculated by the server. ' +
      'For ONLINE payment the response contains the gateway session to open in the app.',
  })
  place(@CurrentUser() user: AuthUser, @Body() dto: PlaceOrderDto) {
    return this.placement.place(user, dto);
  }

  @Get('orders')
  @ApiOperation({ summary: 'My orders, newest first' })
  async list(@CurrentUser('id') userId: string, @Query() page: PaginationDto) {
    const { items, total } = await this.queries.listForCustomer(userId, page.skip, page.limit);
    return new Paginated(items.map((o) => presentOrder(o)), total, page.page, page.limit);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'One of my orders' })
  async get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return presentOrder(await this.queries.getForCustomer(userId, id));
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an order (until it is out for delivery); prepaid orders are refunded' })
  async cancel(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: CancelOrderDto) {
    const { order, refund } = await this.lifecycle.cancelByCustomer(userId, id, dto.reason);
    return new Message('Order cancelled.', { order: presentOrder(order), refund });
  }

  @Delete('orders/:id/draft')
  @ApiOperation({ summary: 'Remove an unpaid online order from my history' })
  async deleteDraft(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.lifecycle.deleteDraft(userId, id);
    return new Message('Order removed.');
  }
}
