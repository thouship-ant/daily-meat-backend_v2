import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiException } from '../../common/api-error';
import { Message, Paginated } from '../../common/api-response';
import { Auth, CurrentUser, ResponseMessage } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AddressesService } from '../../modules/addresses/addresses.service';
import { HubsService } from '../../modules/hubs/hubs.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { OrderAddressService } from '../../modules/orders/order-address.service';
import { ManualOrderService } from '../../modules/orders/manual-order.service';
import { OrderLifecycleService } from '../../modules/orders/order-lifecycle.service';
import { OrderQueryService } from '../../modules/orders/order-query.service';
import { allowedNext } from '../../modules/orders/order-status';
import { presentOrder } from '../../modules/orders/order.presenter';
import { CustomerDirectoryService, CustomerFilter } from '../../modules/users/customer-directory.service';
import { DriverHubsService } from '../../modules/users/driver-hubs.service';
import { asText, toCsv } from '../../common/utils/csv';
import { ReportsService } from '../../modules/reports/reports.service';
import { StaffService } from '../../modules/users/staff.service';
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
  SetDriverHubDto,
  CustomersQueryDto,
  ReportQueryDto,
  StaffQueryDto,
  AddNumberDto,
  UpdateStaffDto,
  CreateDriverHubAssignmentDto,
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
    private readonly hubs: HubsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Revenue, order counts, customers/drivers and the latest orders for a period' })
  async dashboard(@Query() q: DashboardQueryDto) {
    const scope = await this.hubs.customerScope(q.hubId);
    const [d, customers, drivers] = await Promise.all([
      this.queries.dashboard(q.filter, q.startDate, q.endDate, q.hubId),
      this.users.listByRole('CUSTOMER', { skip: 0, take: 1, extraWhere: scope }),
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
    return this.queries.categoryAnalytics(q.filter, q.startDate, q.endDate, q.hubId);
  }
}

@ApiTags('Admin · Staff accounts')
@Auth('SUPERADMIN')
@Controller('staff')
export class AdminStaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'Accounts that have a role (Admin, Driver or Customer), with search' })
  async list(@Query() q: StaffQueryDto) {
    const { items, total } = await this.staff.list(q.role, { skip: q.skip, take: q.limit, search: q.search });
    return new Paginated(items, total, q.page, q.limit);
  }

  @Post()
  @ApiOperation({ summary: 'Add a mobile number with one or more roles (an existing number gets the extra roles)' })
  async add(@Body() dto: AddNumberDto) {
    const r = await this.staff.addNumber(dto);
    return { ...r.user, created: r.created };
  }

  @Patch(':id')
  @ResponseMessage('Updated.')
  @ApiOperation({ summary: 'Change the name and / or mobile number (the person signs in again with the new number)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto, @CurrentUser('id') actorId: string) {
    return this.staff.updateProfile(id, dto, actorId);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset to the starting password (Admin: DAS@3781, Driver: Dvr@7939) and end their sessions' })
  async resetPassword(@Param('id', ParseUUIDPipe) id: string) {
    await this.staff.resetPassword(id);
    return new Message('Password reset.');
  }
}

@ApiTags('Admin · Reports')
@Auth('ADMIN')
@Controller('reports')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'Sales and customer-activity KPIs for a period, with a row per day (all hubs or one)' })
  report(@Query() q: ReportQueryDto) {
    return this.reports.report(q.filter, q.startDate, q.endDate, q.hubId);
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
    private readonly notifications: NotificationsService,
    private readonly driverHubs: DriverHubsService,
  ) {}

  @Post()
  @ResponseMessage('Driver created.')
  async create(@Body() dto: CreateDriverDto) {
    return toUserView(await this.users.createDriver(dto));
  }

  @Get()
  async list(@Query() q: UsersQueryDto, @CurrentUser('role') role: string) {
    const superAdmin = role === 'SUPERADMIN'; // hubs for drivers are managed by the super admin only
    // hubId = the drivers working for that hub today (own hub, or lent to it for a date range that covers today)
    const { items, total } = await this.users.listByRole('DRIVER', {
      skip: q.skip,
      take: q.limit,
      search: q.search,
      isActive: q.isActive,
      extraWhere: superAdmin && q.hubId != null ? this.driverHubs.whereWorkingFor(q.hubId) : undefined,
    });
    const [counts, hubInfo] = await Promise.all([
      this.queries.driverCounts(items.map((u) => u.id)),
      superAdmin ? this.driverHubs.resolve(items.map((u) => u.id)) : Promise.resolve(new Map()),
    ]);
    return new Paginated(
      items.map((u) => ({
        ...toUserView(u),
        ...hubInfo.get(u.id),
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
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('role') role: string) {
    const superAdmin = role === 'SUPERADMIN';
    const user = await this.users.getById(id);
    const [stats, active, counts, done] = await Promise.all([
      this.queries.driverStats(id),
      this.queries.activeForDriver(id),
      this.queries.driverCounts([id]),
      this.queries.completedForDriver(id, 0, 50),
    ]);
    const c = counts.get(id)!;
    const hubInfo = superAdmin ? (await this.driverHubs.resolve([id])).get(id) : undefined;
    return {
      ...toUserView(user),
      ...hubInfo,
      ...(superAdmin ? { hubAssignments: await this.driverHubs.listAssignments(id) } : {}),
      stats: { ...stats, activeOrdersCount: c.active, completedOrdersCount: c.completed },
      activeOrders: active.map((o) => presentOrder(o, ADMIN_VIEW)),
      completedOrders: done.items.map((o) => presentOrder(o, ADMIN_VIEW)),
    };
  }

  @Auth('SUPERADMIN')
  @Patch(':id/hub')
  @ApiOperation({ summary: "Set the hub a driver normally works for (null clears it)" })
  async setHub(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDriverHubDto) {
    await this.driverHubs.setHomeHub(id, dto.hubId);
    return { ...(await this.driverHubs.resolve([id])).get(id) };
  }

  @Auth('SUPERADMIN')
  @Get(':id/hub-assignments')
  @ApiOperation({ summary: 'Temporary hub moves of a driver (past, current and upcoming)' })
  hubAssignments(@Param('id', ParseUUIDPipe) id: string) {
    return this.driverHubs.listAssignments(id);
  }

  @Auth('SUPERADMIN')
  @Post(':id/hub-assignments')
  @ResponseMessage('Driver moved to the other hub for the dates given.')
  @ApiOperation({ summary: 'Lend a driver to another hub for a date range; they return to their own hub automatically afterwards' })
  addHubAssignment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateDriverHubAssignmentDto) {
    return this.driverHubs.addAssignment(id, dto.hubId, dto.startDate, dto.endDate);
  }

  @Auth('SUPERADMIN')
  @Delete(':id/hub-assignments/:assignmentId')
  @ApiOperation({ summary: 'Cancel a temporary hub move (the driver is back at their own hub straight away)' })
  async removeHubAssignment(@Param('id', ParseUUIDPipe) id: string, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    await this.driverHubs.removeAssignment(id, assignmentId);
    return new Message('Temporary hub move removed.');
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate / deactivate a driver (deactivation ends their sessions)' })
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    const user = await this.users.setActive(id, 'DRIVER', dto.isActive);
    if (!dto.isActive) this.notifications.forceLogoutUser(id); // signed in somewhere: cut it now
    return toUserView(user);
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
    private readonly hubs: HubsService,
    private readonly notifications: NotificationsService,
    private readonly directory: CustomerDirectoryService,
  ) {}

  private async filterOf(q: CustomersQueryDto): Promise<CustomerFilter> {
    return {
      search: q.search,
      isActive: q.isActive,
      extraWhere: await this.hubs.customerScope(q.hubId),
      createdFrom: q.createdFrom,
      createdTo: q.createdTo,
      location: q.location,
      pincodeFrom: q.pincodeFrom,
      pincodeTo: q.pincodeTo,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Customers (search, status, registered dates, address location / pincode, split by date / pincode / city)' })
  async list(@Query() q: CustomersQueryDto) {
    const { items, total, groupCounts } = await this.directory.list(await this.filterOf(q), {
      skip: q.skip,
      take: q.limit,
      groupBy: q.groupBy,
      sort: q.sort,
    });
    return new Paginated(
      items.map((u) => ({ ...toUserView(u), orderCount: u._count.orders, city: u.area.city, pincode: u.area.pincode, pincodeSource: u.area.pincodeSource, pushEnabled: !!u.pushToken?.trim() })),
      total,
      q.page,
      q.limit,
      { groupCounts },
    );
  }

  @Get('export')
  @ApiOperation({
    summary: 'CSV of the customers matching the same filters as the list (all pages), with delivery area and first-login location',
  })
  async export(@Query() q: CustomersQueryDto) {
    const rows = await this.directory.findAll(await this.filterOf(q), q.groupBy, q.sort);
    const ist = (d: Date | null) => (d ? new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : '');
    const csv = toCsv(
      [
        'Name', 'Mobile Number', 'Email', 'Status', 'Registered On (IST)', 'Last Login (IST)', 'Total Orders',
        'Delivery Address', 'City', 'Pincode', 'Pincode Source',
        'First Login Location', 'First Login Latitude', 'First Login Longitude', 'First Login Pincode',
      ],
      rows.map((u) => [
        u.name ?? 'N/A',
        asText(u.phone),
        u.email ?? '',
        u.isActive ? 'Active' : 'Inactive',
        ist(u.createdAt),
        ist(u.lastLoginAt),
        u._count.orders,
        u.area.street,
        u.area.city,
        asText(u.area.pincode),
        u.area.pincodeSource === 'ADDRESS' ? 'Delivery address' : u.area.pincodeSource === 'FIRST_LOGIN' ? 'First login location' : '',
        u.signupLocation ?? '',
        u.signupLatitude ?? '',
        u.signupLongitude ?? '',
        asText(u.signupPincode),
      ]),
    );
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="customers.csv"',
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Customer profile with recent orders' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Query() q: CustomerDetailQueryDto) {
    const user = await this.users.getById(id);
    const before = q.before ? new Date(q.before) : null;
    const [{ items, total }, activity, saved, ordersBefore, deliveredRevenue] = await Promise.all([
      this.queries.listForCustomer(id, q.skip, q.status === 'DELIVERED' ? Math.max(q.limit, 50) : q.limit, q.status),
      this.users.getActivity(id),
      this.addresses.list(id),
      before && !isNaN(before.getTime()) ? this.queries.countDeliveredBefore(id, before) : Promise.resolve(undefined),
      this.queries.deliveredRevenue(id),
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
      deliveredRevenue,
      ...(ordersBefore !== undefined ? { ordersBefore } : {}),
      addresses,
      recentOrders: items.map((o) => presentOrder(o, ADMIN_VIEW)),
    };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Block / unblock a customer' })
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    const user = await this.users.setActive(id, 'CUSTOMER', dto.isActive);
    if (!dto.isActive) this.notifications.forceLogoutUser(id); // signed in somewhere: cut it now
    return toUserView(user);
  }
}
