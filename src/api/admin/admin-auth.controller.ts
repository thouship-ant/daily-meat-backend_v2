import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Message } from '../../common/api-response';
import { Auth, CurrentUser, Public, ResponseMessage } from '../../common/decorators';
import { AuthService } from '../../modules/auth/auth.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { toUserView } from '../../modules/users/user.mapper';
import { UsersService } from '../../modules/users/users.service';
import { ChangePasswordDto, LogoutDto, PushTokenDto, RefreshTokenDto, StaffLoginDto } from '../shared/shared.dto';

@ApiTags('Admin · Auth')
@Controller('auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ResponseMessage('Signed in.')
  @ApiOperation({ summary: 'Admin sign-in with email/phone and password' })
  login(@Body() dto: StaffLoginDto) {
    return this.auth.loginWithPassword(dto.identifier, dto.password, 'ADMIN');
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('token/refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Auth('ADMIN')
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser('id') id: string, @Body() dto: LogoutDto) {
    await this.auth.logout(id, dto.pushToken);
    return new Message('Signed out.');
  }

  @Auth('ADMIN')
  @Get('me')
  async me(@CurrentUser('id') id: string) {
    return toUserView(await this.users.getById(id));
  }

  @Auth('ADMIN')
  @Put('password')
  @ApiOperation({ summary: 'Change my password' })
  async password(@CurrentUser('id') id: string, @Body() dto: ChangePasswordDto) {
    await this.users.changePassword(id, dto.oldPassword, dto.newPassword);
    return new Message('Password changed.');
  }

  @Auth('ADMIN')
  @Put('push-token')
  async pushToken(@CurrentUser('id') id: string, @Body() dto: PushTokenDto) {
    await this.users.registerPushToken(id, dto);
    return new Message('Push token saved.');
  }

  @Auth('ADMIN')
  @Post('sessions/logout-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign every admin out of every device (including this one)' })
  async logoutAll() {
    const count = await this.users.endSessionsForRole('ADMIN');
    this.notifications.forceLogoutAdmins();
    return new Message(`Logged out ${count} admin account(s) from all devices.`);
  }
}
