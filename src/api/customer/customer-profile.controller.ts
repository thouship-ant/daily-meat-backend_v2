import { Body, Controller, Delete, Get, Logger, Patch, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Message } from '../../common/api-response';
import { Auth, CurrentUser } from '../../common/decorators';
import { toUserView } from '../../modules/users/user.mapper';
import { HubsService } from '../../modules/hubs/hubs.service';
import { buildDeletionTicket } from '../../modules/support/account-deletion-ticket';
import { SupportService } from '../../modules/support/support.service';
import { UsersService } from '../../modules/users/users.service';
import { PushTokenDto, UpdateProfileDto } from '../shared/shared.dto';
import { DeleteAccountDto, SignupLocationDto } from './dto/customer.dto';

@ApiTags('Customer · Profile')
@Auth('CUSTOMER')
@Controller('me')
export class CustomerProfileController {
  private readonly logger = new Logger(CustomerProfileController.name);

  constructor(
    private readonly users: UsersService,
    private readonly hubs: HubsService,
    private readonly support: SupportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My profile' })
  async me(@CurrentUser('id') id: string) {
    const user = await this.users.getById(id);
    // hasSignupLocation: false = the app should ask for location once and log it as the first location
    return { ...toUserView(user, 'CUSTOMER'), hasSignupLocation: this.users.hasSignupLocation(user) };
  }

  @Patch()
  @ApiOperation({ summary: 'Update my profile (also marks it completed)' })
  async update(@CurrentUser('id') id: string, @Body() dto: UpdateProfileDto) {
    return toUserView(await this.users.updateProfile(id, dto), 'CUSTOMER');
  }

  @Delete()
  @ApiOperation({ summary: 'Delete my account (personal data removed, order history kept anonymised)' })
  async remove(@CurrentUser('id') id: string, @Body() dto: DeleteAccountDto) {
    // Who they are and which hub they belong to are read BEFORE the account is anonymised: afterwards the name, phone
    // and addresses are gone. The reason and these details go to the customer's hub as a support ticket.
    const user = await this.users.getById(id);
    const [hub, orderCount] = await Promise.all([this.hubs.hubForCustomer(id).catch(() => null), this.users.countOrders(id)]);
    const ticket = buildDeletionTicket(
      { name: user.name, phone: user.phone, email: user.email, registeredAt: user.createdAt, orderCount, hubName: hub?.name ?? null },
      dto.reasonCode,
      dto.reason,
    );
    await this.users.anonymize(id);
    try {
      await this.support.createForHub(id, hub?.id ?? null, ticket); // after: anonymising removes the account's tickets
    } catch (e) {
      this.logger.error(`Could not log the deletion reason for ${id}: ${(e as Error).message}`); // never block the deletion itself
    }
    return new Message('Account deleted.');
  }

  @Put('push-token')
  @ApiOperation({ summary: 'Register this device for push notifications' })
  async pushToken(@CurrentUser('id') id: string, @Body() dto: PushTokenDto) {
    await this.users.registerPushToken(id, dto);
    return new Message('Push token saved.');
  }

  @Put('signup-location')
  @ApiOperation({ summary: 'Remember roughly where the customer first opened the app (set once)' })
  async signupLocation(@CurrentUser('id') id: string, @Body() dto: SignupLocationDto) {
    await this.users.setSignupLocationOnce(id, dto.location, dto.latitude, dto.longitude, dto.pincode);
    return new Message('OK');
  }
}
