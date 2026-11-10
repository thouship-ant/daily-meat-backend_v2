import { Body, Controller, Delete, Get, Patch, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Message } from '../../common/api-response';
import { Auth, CurrentUser } from '../../common/decorators';
import { toUserView } from '../../modules/users/user.mapper';
import { UsersService } from '../../modules/users/users.service';
import { PushTokenDto, UpdateProfileDto } from '../shared/shared.dto';
import { SignupLocationDto } from './dto/customer.dto';

@ApiTags('Customer · Profile')
@Auth('CUSTOMER')
@Controller('me')
export class CustomerProfileController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'My profile' })
  async me(@CurrentUser('id') id: string) {
    return toUserView(await this.users.getById(id));
  }

  @Patch()
  @ApiOperation({ summary: 'Update my profile (also marks it completed)' })
  async update(@CurrentUser('id') id: string, @Body() dto: UpdateProfileDto) {
    return toUserView(await this.users.updateProfile(id, dto));
  }

  @Delete()
  @ApiOperation({ summary: 'Delete my account (personal data removed, order history kept anonymised)' })
  async remove(@CurrentUser('id') id: string) {
    await this.users.anonymize(id);
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
    await this.users.setSignupLocationOnce(id, dto.location, dto.latitude, dto.longitude);
    return new Message('OK');
  }
}
