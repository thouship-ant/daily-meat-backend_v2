import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiException } from '../../common/api-error';
import { Message, Paginated } from '../../common/api-response';
import { Auth, CurrentUser, ResponseMessage } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ManualOrderService } from '../../modules/orders/manual-order.service';
import { OrderLifecycleService } from '../../modules/orders/order-lifecycle.service';
import { OrderQueryService } from '../../modules/orders/order-query.service';
import { allowedNext } from '../../modules/orders/order-status';
import { presentOrder } from '../../modules/orders/order.presenter';
import { UsersService } from '../../modules/users/users.service';
import { toUserView } from '../../modules/users/user.mapper';
import {
  AdminOrdersQueryDto,
  AssignDriverDto,
  CreateDriverDto,
  DashboardQueryDto,
  ManualOrderDto,
  SetActiveDto,
  UpdateOrderStatusDto,
  UsersQueryDto,
} from './dto/admin.dto';

const ADMIN_VIEW = { financials: true } as const;

@ApiTags('Admin · Dashboard')
@Auth('ADMIN')
@Controller('dashboard')
export class AdminDashboardController {
  constructor(
    private readonly queries: OrderQueryService,
    private readonly users: UsersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Revenue, order counts, customers/drivers and the latest orders for a period' })
  async dashboard(@Query() q: DashboardQueryDto) {
    const [d, customers, drivers] = await Promise.all([
      this.queries.dashboard(q.filter, q.startDate, q.endDate),
      this.users.listByRole('CUSTOMER', { skip: 0, take: 1 }),
      this.users.listByRole('DRIVER', { skip: 0, take: 1 }),
    ]);
    return {
      revenue: d.revenue,
      orders: d.orders,
      users: { customers: customers.total, drivers: drivers.total },
      recentOrders: d.recent.map((o) => presentOrder(o, ADMIN_VIEW)),
    };
  }
}

@ApiTags('Admin · Orders')
@Auth('ADMIN')
@Controller('orders')
export class AdminOrdersController {
  constructor(
    private readonly queries: OrderQueryService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly manual: ManualOrderService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Orders with filters (status, hub, driver, period, search) and pagination' })
  async list(@Query() q: AdminOrdersQueryDto) {
    const { items, total } = await this.queries.listForAdmin({ ...q, skip: q.skip, take: q.limit });
    return new Paginated(items.map((o) => presentOrder(o, ADMIN_VIEW)), total, q.page, q.limit);
  }

  @Post()
  @ResponseMessage('Order created.')
  @ApiOperation({ summary: 'Create an order on behalf of a customer (phone orders). Starts as CONFIRMED.' })
  create(@Body() dto: ManualOrderDto) {
    return this.manual.create(dto);
  }

  @Post('assign-driver')
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign (or reassign) a driver to one or more CONFIRMED orders' })
  async assign(@Body() dto: AssignDriverDto) {
    const result = await this.lifecycle.assignDriver(dto.driverId, dto.orderIds, dto.reassign);
    return new Message(`${result.assigned.length} order(s) assigned.`, result);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const order = await this.queries.getForAdmin(id);
    return { ...presentOrder(order, ADMIN_VIEW), allowedNextStatuses: allowedNext(order.status, 'ADMIN') };
  }

  @Get(':id/assignment-suggestions')
  @ApiOperation({ summary: 'Nearby open orders and free drivers for this order' })
  suggestions(@Param('id') id: string) {
    return this.queries.assignmentSuggestions(id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Move an order to another status',
    description: 'Only valid transitions are accepted (see `allowedNextStatuses` on GET /orders/:id). Assign drivers with POST /orders/assign-driver.',
  })
  async status(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    if (dto.status === 'ASSIGNED') {
      throw ApiException.badRequest('USE_ASSIGN_DRIVER', 'Use POST /admin/orders/assign-driver to assign an order to a driver.');
    }
    const { order, refund } = await this.lifecycle.transition(id, dto.status, 'ADMIN', { reason: dto.reason });
    return new Message('Order status updated.', { order: presentOrder(order, ADMIN_VIEW), refund });
  }
}

@ApiTags('Admin · Drivers')
@Auth('ADMIN')
@Controller('drivers')
export class AdminDriversController {
  constructor(
    private readonly users: UsersService,
    private readonly queries: OrderQueryService,
  ) {}

  @Post()
  @ResponseMessage('Driver created.')
  async create(@Body() dto: CreateDriverDto) {
    return toUserView(await this.users.createDriver(dto));
  }

  @Get()
  async list(@Query() q: UsersQueryDto) {
    const { items, total } = await this.users.listByRole('DRIVER', { skip: q.skip, take: q.limit, search: q.search, isActive: q.isActive });
    return new Paginated(
      items.map((u) => ({ ...toUserView(u), deliveries: u._count.deliveries })),
      total,
      q.page,
      q.limit,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Driver profile with today\'s numbers and the orders currently on the road' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.users.getById(id);
    const [stats, active] = await Promise.all([this.queries.driverStats(id), this.queries.activeForDriver(id)]);
    return { ...toUserView(user), stats, activeOrders: active.map((o) => presentOrder(o, ADMIN_VIEW)) };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate / deactivate a driver (deactivation ends their sessions)' })
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    return toUserView(await this.users.setActive(id, 'DRIVER', dto.isActive));
  }
}

@ApiTags('Admin · Customers')
@Auth('ADMIN')
@Controller('customers')
export class AdminCustomersController {
  constructor(
    private readonly users: UsersService,
    private readonly queries: OrderQueryService,
  ) {}

  @Get()
  async list(@Query() q: UsersQueryDto) {
    const { items, total } = await this.users.listByRole('CUSTOMER', { skip: q.skip, take: q.limit, search: q.search, isActive: q.isActive });
    return new Paginated(
      items.map((u) => ({ ...toUserView(u), orderCount: u._count.orders })),
      total,
      q.page,
      q.limit,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Customer profile with recent orders' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Query() page: PaginationDto) {
    const user = await this.users.getById(id);
    const { items, total } = await this.queries.listForCustomer(id, page.skip, page.limit);
    return { ...toUserView(user), orderCount: total, recentOrders: items.map((o) => presentOrder(o, ADMIN_VIEW)) };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Block / unblock a customer' })
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    return toUserView(await this.users.setActive(id, 'CUSTOMER', dto.isActive));
  }
}
