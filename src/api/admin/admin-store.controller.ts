import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Message, Paginated } from '../../common/api-response';
import { Auth, ResponseMessage } from '../../common/decorators';
import { CouponsService } from '../../modules/coupons/coupons.service';
import { HubsService } from '../../modules/hubs/hubs.service';
import { DeliverySlotsService } from '../../modules/orders/delivery-slots.service';
import { SupportService } from '../../modules/support/support.service';
import {
  CouponDto,
  CouponsQueryDto,
  HubDto,
  PauseAllHubsDto,
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
