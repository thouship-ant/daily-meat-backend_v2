import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Message, Paginated } from '../../common/api-response';
import { Auth, CurrentUser, Public, ResponseMessage } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { MAX_IMAGE_BYTES } from '../../infrastructure/storage/storage.service';
import { AuthModule } from '../../modules/auth/auth.module';
import { DigiLockerService } from '../../modules/driver-onboarding/digilocker.service';
import { DriverOnboardingModule } from '../../modules/driver-onboarding/driver-onboarding.module';
import { DriverOnboardingService } from '../../modules/driver-onboarding/driver-onboarding.service';
import { AuthService } from '../../modules/auth/auth.service';
import { OrderLifecycleService } from '../../modules/orders/order-lifecycle.service';
import { OrderQueryService } from '../../modules/orders/order-query.service';
import { OrdersModule } from '../../modules/orders/orders.module';
import { presentOrder } from '../../modules/orders/order.presenter';
import { TrackingModule } from '../../modules/tracking/tracking.module';
import { TrackingService } from '../../modules/tracking/tracking.service';
import { toUserView } from '../../modules/users/user.mapper';
import { UsersModule } from '../../modules/users/users.module';
import { UsersService } from '../../modules/users/users.service';
import { ChangePasswordDto, LogoutDto, PushTokenDto, RefreshTokenDto, StaffLoginDto } from '../shared/shared.dto';
import { BulkOrdersDto, ChooseHubDto, FailDeliveryDto, KycDto, LocationDto, VehicleDto } from './dto/driver.dto';

const DRIVER_VIEW = { navigation: true } as const; // drivers get map links, never cost/profit

@ApiTags('Driver · Auth')
@Controller('auth')
export class DriverAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ResponseMessage('Signed in.')
  @ApiOperation({ summary: 'Driver sign-in with phone/email and password' })
  login(@Body() dto: StaffLoginDto) {
    return this.auth.loginWithPassword(dto.identifier, dto.password, 'DRIVER');
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('token/refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Auth('DRIVER')
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser('id') id: string, @Body() dto: LogoutDto) {
    await this.auth.logout(id, dto.pushToken);
    return new Message('Signed out.');
  }

  @Auth('DRIVER')
  @Get('me')
  @ApiOperation({ summary: 'My profile' })
  async me(@CurrentUser('id') id: string) {
    return toUserView(await this.users.getById(id), 'DRIVER');
  }

  @Auth('DRIVER')
  @Put('password')
  @ApiOperation({ summary: 'Change my password' })
  async password(@CurrentUser('id') id: string, @Body() dto: ChangePasswordDto) {
    await this.users.changePassword(id, dto.oldPassword, dto.newPassword);
    return new Message('Password changed.');
  }

  @Auth('DRIVER')
  @Put('push-token')
  async pushToken(@CurrentUser('id') id: string, @Body() dto: PushTokenDto) {
    await this.users.registerPushToken(id, dto);
    return new Message('Push token saved.');
  }
}

@ApiTags('Driver · Onboarding')
@Auth('DRIVER')
@Controller('onboarding')
export class DriverOnboardingController {
  constructor(
    private readonly onboarding: DriverOnboardingService,
    private readonly digilocker: DigiLockerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Where I am in the onboarding (steps, saved details, deposit offer, hubs). `required: false` = nothing to do.' })
  state(@CurrentUser('id') id: string) {
    return this.onboarding.state(id);
  }

  @Put('kyc')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }], { limits: { fileSize: MAX_IMAGE_BYTES } }))
  @ApiOperation({ summary: 'Aadhaar KYC: number (only the last 4 digits are kept), name on the card, front and back photos' })
  kyc(@CurrentUser('id') id: string, @Body() dto: KycDto, @UploadedFiles() files: { front?: Express.Multer.File[]; back?: Express.Multer.File[] }) {
    return this.onboarding.saveKyc(id, { aadhaarNumber: dto.aadhaarNumber, name: dto.name }, files?.front?.[0], files?.back?.[0]);
  }

  @Post('digilocker/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start DigiLocker verification (off until DigiLocker credentials are configured)' })
  digilockerStart(@CurrentUser('id') id: string) {
    return this.digilocker.start(id);
  }

  @Put('hub')
  @ApiOperation({ summary: 'Choose the city / hub I will work for' })
  hub(@CurrentUser('id') id: string, @Body() dto: ChooseHubDto) {
    return this.onboarding.chooseHub(id, dto.hubId);
  }

  @Post('selfie')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  selfie(@CurrentUser('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.onboarding.saveSelfie(id, file);
  }

  @Put('vehicle')
  @ApiOperation({ summary: 'Vehicle model, registration number and year of manufacture' })
  vehicle(@CurrentUser('id') id: string, @Body() dto: VehicleDto) {
    return this.onboarding.saveVehicle(id, dto);
  }

  @Post('deposit/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Starting deposit for the T-shirt and basket: opens the payment session' })
  depositStart(@CurrentUser('id') id: string) {
    return this.onboarding.startDeposit(id);
  }

  @Post('deposit/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'After the payment sheet closes: the server asks the gateway whether the deposit was paid' })
  depositVerify(@CurrentUser('id') id: string) {
    return this.onboarding.verifyDeposit(id);
  }

  @Post('submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the application to the admin (every step must be done and the deposit paid)' })
  submit(@CurrentUser('id') id: string) {
    return this.onboarding.submit(id);
  }
}

@ApiTags('Driver · Deliveries')
@Auth('DRIVER')
@Controller()
export class DriverOrdersController {
  constructor(
    private readonly queries: OrderQueryService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly tracking: TrackingService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Today counts and a 7-day delivered graph' })
  dashboard(@CurrentUser('id') driverId: string) {
    return this.queries.driverStats(driverId);
  }

  @Get('orders/active')
  @ApiOperation({ summary: 'Orders assigned to me that are not finished yet (oldest first)' })
  async active(@CurrentUser('id') driverId: string) {
    return (await this.queries.activeForDriver(driverId)).map((o) => presentOrder(o, DRIVER_VIEW));
  }

  @Get('orders/completed')
  @ApiOperation({ summary: 'My delivered / failed orders' })
  async completed(@CurrentUser('id') driverId: string, @Query() page: PaginationDto) {
    const { items, total } = await this.queries.completedForDriver(driverId, page.skip, page.limit);
    return new Paginated(items.map((o) => presentOrder(o, DRIVER_VIEW)), total, page.page, page.limit);
  }

  // NOTE: the two bulk routes must be declared before ':id' routes.
  @Post('orders/bulk/pick')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark several assigned orders as picked up' })
  bulkPick(@CurrentUser('id') driverId: string, @Body() dto: BulkOrdersDto) {
    return this.bulk(driverId, dto.orderIds, 'PICKED');
  }

  @Post('orders/bulk/out-for-delivery')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark several picked orders as out for delivery' })
  bulkOut(@CurrentUser('id') driverId: string, @Body() dto: BulkOrdersDto) {
    return this.bulk(driverId, dto.orderIds, 'OUT_FOR_DELIVERY');
  }

  @Get('orders/:id')
  async one(@CurrentUser('id') driverId: string, @Param('id') id: string) {
    return presentOrder(await this.queries.getForDriver(driverId, id), DRIVER_VIEW);
  }

  @Post('orders/:id/pick')
  @HttpCode(200)
  @ApiOperation({ summary: 'ASSIGNED -> PICKED' })
  async pick(@CurrentUser('id') driverId: string, @Param('id') id: string) {
    return this.step(driverId, id, 'PICKED');
  }

  @Post('orders/:id/out-for-delivery')
  @HttpCode(200)
  @ApiOperation({ summary: 'PICKED -> OUT_FOR_DELIVERY (customer is notified)' })
  async out(@CurrentUser('id') driverId: string, @Param('id') id: string) {
    return this.step(driverId, id, 'OUT_FOR_DELIVERY');
  }

  @Post('orders/:id/deliver')
  @HttpCode(200)
  @ApiOperation({ summary: 'OUT_FOR_DELIVERY -> DELIVERED (COD is marked paid)' })
  async deliver(@CurrentUser('id') driverId: string, @Param('id') id: string) {
    return this.step(driverId, id, 'DELIVERED');
  }

  @Post('orders/:id/fail')
  @HttpCode(200)
  @ApiOperation({ summary: 'OUT_FOR_DELIVERY -> FAILED with a reason' })
  async fail(@CurrentUser('id') driverId: string, @Param('id') id: string, @Body() dto: FailDeliveryDto) {
    return this.step(driverId, id, 'FAILED', dto.reason);
  }

  @Post('orders/:id/arrived')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tell the customer I have arrived (sent once per order)' })
  arrived(@CurrentUser('id') driverId: string, @Param('id') id: string) {
    return this.tracking.arrived(driverId, id);
  }

  @Post('location')
  @HttpCode(200)
  @ApiOperation({ summary: 'Report my position for the orders I am carrying' })
  location(@CurrentUser('id') driverId: string, @Body() dto: LocationDto) {
    const { orderIds, ...fix } = dto;
    return this.tracking.report(driverId, orderIds, fix);
  }

  private async step(driverId: string, orderId: string, to: 'PICKED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED', reason?: string) {
    const { order } = await this.lifecycle.transition(orderId, to, 'DRIVER', { driverId, reason });
    return presentOrder(order, DRIVER_VIEW);
  }

  /** Applies one transition to many orders; reports which succeeded instead of failing the whole batch. */
  private async bulk(driverId: string, orderIds: string[], to: 'PICKED' | 'OUT_FOR_DELIVERY') {
    const updated: string[] = [];
    const skipped: Array<{ orderId: string; reason: string }> = [];
    for (const id of [...new Set(orderIds)]) {
      try {
        await this.lifecycle.transition(id, to, 'DRIVER', { driverId });
        updated.push(id);
      } catch (e) {
        skipped.push({ orderId: id, reason: (e as Error).message });
      }
    }
    return new Message(`${updated.length} order(s) updated.`, { updated, skipped });
  }
}

@Module({
  imports: [AuthModule, UsersModule, OrdersModule, TrackingModule, DriverOnboardingModule],
  controllers: [DriverAuthController, DriverOnboardingController, DriverOrdersController],
})
export class DriverApiModule {}
