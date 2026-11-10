import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RefreshTokenDto {
  @ApiProperty() @IsString() @IsNotEmpty() refreshToken: string;
}

export class StaffLoginDto {
  @ApiProperty({ description: 'Email or phone number', example: 'admin@dailymeat.in' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(128) password: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() oldPassword: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) newPassword: string;
}

export class PushTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' }) @IsString() @IsNotEmpty() pushToken: string;
  @ApiPropertyOptional({ description: 'Previous token of this device, to replace it' }) @IsOptional() @IsString() previousToken?: string;
  @ApiPropertyOptional({ enum: ['android', 'ios'] }) @IsOptional() @IsString() platform?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() appVersion?: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Push token of this device to unregister (other devices stay signed in for pushes)' })
  @IsOptional()
  @IsString()
  pushToken?: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 100) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(({ value }) => (value === '' ? null : trim({ value }))) @IsEmail() email?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(6, 20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() promotionalNotifications?: boolean;
}

export class ContactMessageDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) name: string;
  @ApiProperty() @Transform(trim) @IsEmail() email: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 2000) message: string;
}
