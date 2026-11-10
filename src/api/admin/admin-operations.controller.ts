import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiException } from '../../common/api-error';
import { Message, Paginated } from '../../common/api-response';
import { Auth, CurrentUser, ResponseMessage } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AddressesService } from '../../modules/addresses/addresses.service';
import { OrderAddressService } from '../../modules/orders/order-address.service';
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
  CustomerDetailQueryDto,
  DashboardQueryDto,
  ManualOrderDto,
  OrderAddressDto,
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

@ApiTags('Admin · Analysis')
@Auth('ADMIN')
@Controller('analysis')
export class AdminAnalysisController {
  constructor(private readonly queries: OrderQueryService) {}

  @Get('category-wise')
  @ApiOperation({ summary: 'Gross sales, profit and distinct order counts per category for a period' })
  categoryWise(@Query() q: DashboardQueryDto) {
    return this.queries.categoryAnalytics(q.filter, q.startDate, q.endDate);
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
    private readonly orderAddress: OrderAddressService,
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

  @Post(':id/notify-address')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask the customer (push) to correct this order\'s delivery address' })
  async notifyAddress(@Param('id') id: string) {
    const result = await this.orderAddress.askCustomerToUpdate(id);
    return new Message(result.message, { sent: result.sent });
  }

  @Post(':id/approve-address')
  @HttpCode(200)
  @ApiOperation({ summary: 'The address is fine: remember it so it is not flagged again' })
  async approveAddress(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    await this.orderAddress.approve(id, adminId);
    return new Message('Address marked as correct.', { approved: true });
  }

  @Patch(':id/address')
  @ApiOperation({ summary: 'Edit the order\'s address after the customer confirmed the right one' })
  async updateAddress(@Param('id') id: string, @Body() dto: OrderAddressDto) {
    await this.orderAddress.adminUpdate(id, dto);
    return presentOrder(await this.queries.getForAdmin(id), ADMIN_VIEW);
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
    const counts = await this.queries.driverCounts(items.map((u) => u.id));
    return new Paginated(
      items.map((u) => ({
        ...toUserView(u),
        deliveries: u._count.deliveries,
        activeOrdersCount: counts.get(u.id)?.active ?? 0,
        completedOrdersCount: counts.get(u.id)?.completed ?? 0,
      })),
      total,
      q.page,
      q.limit,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Driver profile with today\'s numbers and the orders currently on the road' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.users.getById(id);
    const [stats, active, counts, done] = await Promise.all([
      this.queries.driverStats(id),
      this.queries.activeForDriver(id),
      this.queries.driverCounts([id]),
      this.queries.completedForDriver(id, 0, 50),
    ]);
    const c = counts.get(id)!;
    return {
      ...toUserView(user),
      stats: { ...stats, activeOrdersCount: c.active, completedOrdersCount: c.completed },
      activeOrders: active.map((o) => presentOrder(o, ADMIN_VIEW)),
      completedOrders: done.items.map((o) => presentOrder(o, ADMIN_VIEW)),
    };
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
    private readonly addresses: AddressesService,
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
  async get(@Param('id', ParseUUIDPipe) id: string, @Query() q: CustomerDetailQueryDto) {
    const user = await this.users.getById(id);
    const before = q.before ? new Date(q.before) : null;
    const [{ items, total }, activity, saved, ordersBefore] = await Promise.all([
      this.queries.listForCustomer(id, q.skip, q.status === 'DELIVERED' ? Math.max(q.limit, 50) : q.limit, q.status),
      this.users.getActivity(id),
      this.addresses.list(id),
      before && !isNaN(before.getTime()) ? this.queries.countDeliveredBefore(id, before) : Promise.resolve(undefined),
    ]);

    // Home 1, Home 2, Work 1 ... ; any other title is shown as "Other - <title>"; oldest first
    const counters: Record<string, number> = {};
    const addresses = [...saved]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((a) => {
        const title = a.title.trim();
        const key = title.toLowerCase();
        let label: string;
        if (key === 'home' || key === 'work') {
          counters[key] = (counters[key] ?? 0) + 1;
          label = `${key === 'home' ? 'Home' : 'Work'} ${counters[key]}`;
        } else {
          label = `Other - ${title || 'Address'}`;
        }
        return {
          id: a.id, label, street: a.street, city: a.city, pincode: a.pincode,
          latitude: a.latitude, longitude: a.longitude, isDefault: a.isDefault,
        };
      });

    return {
      ...toUserView(user),
      ...activity,
      orderCount: total,
      ...(ordersBefore !== undefined ? { ordersBefore } : {}),
      addresses,
      recentOrders: items.map((o) => presentOrder(o, ADMIN_VIEW)),
    };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Block / unblock a customer' })
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    return toUserView(await this.users.setActive(id, 'CUSTOMER', dto.isActive));
  }
}
