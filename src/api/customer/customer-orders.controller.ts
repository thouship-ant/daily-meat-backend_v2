import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Message, Paginated } from '../../common/api-response';
import { Auth, AuthUser, CurrentUser, Public, ResponseMessage } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { DeliverySlotsService } from '../../modules/orders/delivery-slots.service';
import { OrderAddressService } from '../../modules/orders/order-address.service';
import { OrderLifecycleService } from '../../modules/orders/order-lifecycle.service';
import { OrderPlacementService } from '../../modules/orders/order-placement.service';
import { OrderQueryService } from '../../modules/orders/order-query.service';
import { presentOrder } from '../../modules/orders/order.presenter';
import { HubsService } from '../../modules/hubs/hubs.service';
import { CancelOrderDto, ChangeOrderAddressDto, PlaceOrderDto, QuoteDto, SlotsQueryDto } from './dto/customer.dto';

@ApiTags('Customer · Orders')
@Auth('CUSTOMER')
@Controller()
export class CustomerOrdersController {
  constructor(
    private readonly placement: OrderPlacementService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly queries: OrderQueryService,
    private readonly slots: DeliverySlotsService,
    private readonly orderAddress: OrderAddressService,
    private readonly hubs: HubsService,
  ) {}

  @Public()
  @Get('delivery-slots')
  @ApiOperation({ summary: 'Active delivery time windows, earliest first. With ?date= (and ?pincode=) each slot says how many places are left' })
  async deliverySlots(@Query() q: SlotsQueryDto) {
    if (!q.date) return this.slots.listActive();
    const hub = q.pincode ? await this.hubs.findForPincode(q.pincode) : null;
    return this.slots.availability(q.date, hub?.id ?? null);
  }

  @Post('orders/quote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Price a basket (delivery fee, coupon, total) without placing it' })
  quote(@CurrentUser() user: AuthUser, @Body() dto: QuoteDto) {
    return this.placement.quote(user, dto);
  }

  @Get('orders/cod-status')
  @ApiOperation({ summary: 'Can I pay by Cash on Delivery above the COD limit? (only after an online payment did not go through)' })
  codStatus(@CurrentUser('id') userId: string) {
    return this.placement.codStatus(userId);
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

  @Patch('orders/:id/address')
  @ApiOperation({ summary: 'Send an order that has not left the shop to another saved address (only after the shop asked)' })
  async changeAddress(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: ChangeOrderAddressDto) {
    await this.orderAddress.customerChange(userId, id, dto.addressId);
    return new Message('Delivery address updated.', { order: presentOrder(await this.queries.getForCustomer(userId, id)) });
  }

  @Delete('orders/:id/draft')
  @ApiOperation({ summary: 'Remove an unpaid online order from my history' })
  async deleteDraft(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.lifecycle.deleteDraft(userId, id);
    return new Message('Order removed.');
  }
}
