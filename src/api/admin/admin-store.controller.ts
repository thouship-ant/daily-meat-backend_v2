import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiException } from '../../common/api-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SellerBillsService } from '../../modules/catalog/seller-bills.service';
import { Message, Paginated } from '../../common/api-response';
import { Auth, ResponseMessage } from '../../common/decorators';
import { CouponsService } from '../../modules/coupons/coupons.service';
import { HubsService } from '../../modules/hubs/hubs.service';
import { MarketingService } from '../../modules/notifications/marketing.service';
import { DeliverySlotsService } from '../../modules/orders/delivery-slots.service';
import { SupportService } from '../../modules/support/support.service';
import {
  BroadcastDto,
  CouponDto,
  ContactStatusDto,
  CouponsQueryDto,
  CreateSellerBillDto,
  RequiredItemsQueryDto,
  HubDto,
  PauseAllHubsDto,
  ScheduledPlanDto,
  SlotDto,
  TicketsQueryDto,
  UpdateCouponDto,
  UpdateSlotDto,
  UpdateTicketDto,
} from './dto/admin.dto';

const toDate = (v?: string | null) => (v === undefined ? undefined : v === null ? null : new Date(v));

@ApiTags('Admin · Hubs')
@Auth('ADMIN')
@Controller('hubs')
export class AdminHubsController {
  constructor(private readonly hubs: HubsService) {}

  @Get()
  list() {
    return this.hubs.listAll();
  }

  @Post()
  @ResponseMessage('Hub created.')
  create(@Body() dto: HubDto) {
    return this.hubs.create(dto);
  }

  // declared before ':id' so "pause" is not parsed as an id
  @Put('pause')
  @ApiOperation({ summary: 'Pause / resume order intake on every hub' })
  async pauseAll(@Body() dto: PauseAllHubsDto) {
    const count = await this.hubs.setAllPaused(dto.paused, dto.reason);
    return new Message(dto.paused ? 'Orders paused.' : 'Orders resumed.', { hubsUpdated: count });
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.hubs.getById(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: HubDto) {
    return this.hubs.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a hub (refused if it has orders - deactivate it instead)' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.hubs.remove(id);
    return new Message('Hub deleted.');
  }
}

@ApiTags('Admin · Delivery slots')
@Auth('ADMIN')
@Controller('slots')
export class AdminSlotsController {
  constructor(private readonly slots: DeliverySlotsService) {}

  @Get()
  list() {
    return this.slots.listAll();
  }

  @Post()
  @ResponseMessage('Slot created.')
  create(@Body() dto: SlotDto) {
    return this.slots.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSlotDto) {
    return this.slots.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.slots.remove(id);
    return new Message('Slot deleted.');
  }
}

@ApiTags('Admin · Coupons')
@Auth('ADMIN')
@Controller('coupons')
export class AdminCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  async list(@Query() q: CouponsQueryDto) {
    const { items, total } = await this.coupons.adminList({ status: q.status, visibility: q.visibility, q: q.q, skip: q.skip, take: q.limit });
    return new Paginated(items, total, q.page, q.limit);
  }

  @Post()
  @ResponseMessage('Coupon created.')
  create(@Body() dto: CouponDto) {
    return this.coupons.create({ ...dto, startAt: toDate(dto.startAt) as Date | undefined, endAt: toDate(dto.endAt) as Date | undefined });
  }

  @Get(':id')
  details(@Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.adminDetails(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.update(id, { ...dto, startAt: toDate(dto.startAt), endAt: toDate(dto.endAt) });
  }
}

@ApiTags('Admin · Support')
@Auth('ADMIN')
@Controller('tickets')
export class AdminTicketsController {
  constructor(private readonly support: SupportService) {}

  @Get()
  async list(@Query() q: TicketsQueryDto) {
    const { items, total } = await this.support.adminList({ status: q.status, skip: q.skip, take: q.limit });
    return new Paginated(items, total, q.page, q.limit);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Reply to a ticket and/or change its status' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) {
    return this.support.adminUpdate(id, dto);
  }
}

@ApiTags('Admin · Marketing')
@Auth('ADMIN')
@Controller('marketing')
export class AdminMarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Post('send')
  @HttpCode(200)
  @ApiOperation({ summary: 'Promotional push to all customers, or only those with no recent order' })
  send(@Body() dto: BroadcastDto) {
    return this.marketing.broadcast(dto);
  }

  @Get('scheduled')
  async list() {
    return { plans: await this.marketing.listPlans() };
  }

  @Post('scheduled')
  @ResponseMessage('Plan saved.')
  async create(@Body() dto: ScheduledPlanDto) {
    return { plan: await this.marketing.createPlan(dto) };
  }

  @Patch('scheduled/:id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: ScheduledPlanDto) {
    return { plan: await this.marketing.updatePlan(id, dto) };
  }

  @Delete('scheduled/:id')
  @ResponseMessage('Deleted.')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.marketing.deletePlan(id);
    return { deleted: true };
  }

  @Post('scheduled/:id/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the plan message to the admins phones only' })
  test(@Param('id', ParseIntPipe) id: number) {
    return this.marketing.testPlan(id);
  }
}

@ApiTags('Admin · Contact messages')
@Auth('ADMIN')
@Controller('contact')
export class AdminContactController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Messages sent through the website contact form, newest first' })
  async list() {
    return { messages: await this.prisma.contactMessage.findMany({ orderBy: { createdAt: 'desc' } }) };
  }

  @Patch(':id/status')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ContactStatusDto) {
    const found = await this.prisma.contactMessage.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw ApiException.notFound('Contact message');
    return { message: await this.prisma.contactMessage.update({ where: { id }, data: { status: dto.status } }) };
  }

  @Delete(':id')
  @ResponseMessage('Contact message deleted.')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const found = await this.prisma.contactMessage.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw ApiException.notFound('Contact message');
    await this.prisma.contactMessage.delete({ where: { id } });
    return { deleted: true };
  }
}

@ApiTags('Admin · Supplier bills')
@Auth('ADMIN')
@Controller('seller-bills')
export class AdminSellerBillsController {
  constructor(private readonly bills: SellerBillsService) {}

  @Post()
  @ResponseMessage('Seller bill generated successfully')
  create(@Body() dto: CreateSellerBillDto) {
    return this.bills.create(dto);
  }

  @Get()
  list() {
    return this.bills.list();
  }

  @Get('required-items')
  @ApiOperation({ summary: 'Active products with the quantity the open orders still need' })
  required(@Query() q: RequiredItemsQueryDto) {
    return this.bills.requiredItems(q.date);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.bills.get(id);
  }
}
