import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Message } from '../../common/api-response';
import { Auth, CurrentUser, Public, ResponseMessage } from '../../common/decorators';
import { AuthService } from '../../modules/auth/auth.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { LogoutDto, RefreshTokenDto } from '../shared/shared.dto';
import { IdentifierDto, MultiRoleOtpDto, MultiRoleResendDto, MultiRoleSelectDto, MultiRoleStartDto, SendOtpDto, SlowReportDto, SwitchRoleDto, VerifyOtpDto } from './dto/customer.dto';

@ApiTags('Customer · Auth')
@Controller('auth')
export class CustomerAuthController {
  constructor(private readonly auth: AuthService, private readonly notifications: NotificationsService) {}

  @Public()
  @Post('lookup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Does this phone/email have an account, and which login method applies?' })
  lookup(@Body() dto: IdentifierDto) {
    return this.auth.lookup(dto.identifier);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/send')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a one-time password by SMS (phone) or email' })
  async sendOtp(@Body() dto: SendOtpDto) {
    await this.auth.sendCustomerOtp(dto.identifier);
    return new Message('OTP sent.');
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  @ResponseMessage('Signed in.')
  @ApiOperation({ summary: 'Verify the OTP. Creates the account on first sign-in and returns tokens.' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyCustomerOtp(dto.identifier, dto.otp, dto.deviceId);
  }

  // ---- a number with several roles: password -> OTP -> choose the role ----

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('multi-role/password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Step 1 for a number with several roles: check the password, then send the OTP' })
  multiRolePassword(@Body() dto: MultiRoleStartDto) {
    return this.auth.multiRoleStart(dto.identifier, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('multi-role/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the OTP again during the multi-role sign-in' })
  async multiRoleResend(@Body() dto: MultiRoleResendDto) {
    await this.auth.multiRoleResend(dto.challengeToken);
    return new Message('OTP sent.');
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('multi-role/otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Step 2: check the OTP. Returns the roles to choose from and a selection token' })
  multiRoleOtp(@Body() dto: MultiRoleOtpDto) {
    return this.auth.multiRoleVerifyOtp(dto.challengeToken, dto.otp);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('multi-role/select')
  @HttpCode(200)
  @ResponseMessage('Signed in.')
  @ApiOperation({ summary: 'Step 3: sign in as the chosen role' })
  multiRoleSelect(@Body() dto: MultiRoleSelectDto) {
    return this.auth.multiRoleSelect(dto.selectionToken, dto.role);
  }

  @Auth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('slow-report')
  @HttpCode(200)
  @ApiOperation({ summary: 'Any signed-in user: this phone was hanging. Tells the super admins (at most once per 30 minutes per person)' })
  slowReport(@CurrentUser('id') userId: string, @Body() dto: SlowReportDto) {
    return this.notifications.reportSlowDevice(userId, dto);
  }

  @Auth()
  @Post('switch-role')
  @HttpCode(200)
  @ResponseMessage('Role switched.')
  @ApiOperation({ summary: 'Signed in with several roles: switch this session to another role (new tokens, no sign-out)' })
  switchRole(@CurrentUser('id') userId: string, @Body() dto: SwitchRoleDto) {
    return this.auth.switchRole(userId, dto.role);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('token/refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair (the old refresh token is revoked)' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Auth('CUSTOMER')
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign out; optionally unregister this device for push' })
  async logout(@CurrentUser('id') userId: string, @Body() dto: LogoutDto) {
    await this.auth.logout(userId, dto.pushToken);
    return new Message('Signed out.');
  }
}
