import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ---------- auth ----------

export class IdentifierDto {
  @ApiProperty({ description: 'Phone (E.164, e.g. +919876543210) or email', example: '+919876543210' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  identifier: string;
}

export class MultiRoleStartDto extends IdentifierDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(128) password: string;
}

export class MultiRoleResendDto {
  @ApiProperty() @IsString() @IsNotEmpty() challengeToken: string;
}

export class MultiRoleOtpDto {
  @ApiProperty() @IsString() @IsNotEmpty() challengeToken: string;
  @ApiProperty({ example: '123456' }) @IsString() @Length(4, 8) otp: string;
}

export class MultiRoleSelectDto {
  @ApiProperty() @IsString() @IsNotEmpty() selectionToken: string;
  @ApiProperty({ enum: ['SUPERADMIN', 'ADMIN', 'DRIVER', 'CUSTOMER'] }) @IsIn(['SUPERADMIN', 'ADMIN', 'DRIVER', 'CUSTOMER']) role: 'SUPERADMIN' | 'ADMIN' | 'DRIVER' | 'CUSTOMER';
}

export class SlowReportDto {
  @ApiProperty({ enum: ['app_frozen', 'no_server_answer'] }) @IsIn(['app_frozen', 'no_server_answer']) reason: 'app_frozen' | 'no_server_answer';
  @ApiProperty({ description: 'How long the phone was hanging, in seconds' }) @Type(() => Number) @IsNumber() @Min(0) @Max(86400) seconds: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) network?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) appVersion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) platform?: string;
}

export class SwitchRoleDto {
  @ApiProperty({ enum: ['SUPERADMIN', 'ADMIN', 'DRIVER', 'CUSTOMER'] }) @IsIn(['SUPERADMIN', 'ADMIN', 'DRIVER', 'CUSTOMER']) role: 'SUPERADMIN' | 'ADMIN' | 'DRIVER' | 'CUSTOMER';
}

export class SlotsQueryDto {
  @ApiPropertyOptional({ example: '2026-11-13', description: 'Delivery day: adds how many places are left per slot' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({ description: 'Delivery pincode: the hub that serves it is the one whose places are counted' })
  @IsOptional()
  @Matches(/^\d{6}$/)
  pincode?: string;
}

export class SendOtpDto extends IdentifierDto {
  @ApiPropertyOptional({ description: 'Device IMEI when the OS exposes it (Android 9 and below only)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  imei?: string | null;

  @ApiPropertyOptional({ description: 'Stable app-install device id' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;
}

export class VerifyOtpDto extends IdentifierDto {
  @ApiProperty({ example: '123456' }) @IsString() @Length(4, 8) otp: string;
  @ApiPropertyOptional({ description: 'Stable device id, used to limit accounts per device' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;
}

export class SignupLocationDto {
  @ApiProperty({ example: 'Crawford, Tamil Nadu' }) @Transform(trim) @IsString() @Length(1, 255) location: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @ApiPropertyOptional({ example: '620005', description: 'Pincode of that location (6 digits)' }) @IsOptional() @Matches(/^\d{6}$/) pincode?: string;
}

export class ChangeOrderAddressDto {
  @ApiProperty({ description: 'One of my saved addresses' }) @IsUUID() addressId: string;
}

// ---------- catalog ----------

export class ProductQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ description: 'Only products flagged popular' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  popular?: boolean;
  @ApiPropertyOptional({ description: 'Name contains' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
}

// ---------- addresses ----------

export class AddressDto {
  @ApiProperty({ example: 'Home' }) @Transform(trim) @IsString() @Length(1, 50) title: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 255) street: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) city: string;
  @ApiProperty({ example: '600001' }) @Transform(trim) @Matches(/^[6]\d{5}$/, { message: 'pincode must be a valid 6-digit pincode' }) pincode: string;
  @ApiProperty() @Type(() => Number) @IsLatitude() latitude: number;
  @ApiProperty() @Type(() => Number) @IsLongitude() longitude: number;
}

export class UpdateAddressDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 50) title?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 255) street?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 100) city?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^[6]\d{5}$/, { message: 'pincode must be a valid 6-digit pincode' }) pincode?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
}

// ---------- orders ----------

export class OrderItemDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty({ minimum: 1, maximum: 50 }) @Type(() => Number) @IsInt() @Min(1) @Max(50) quantity: number;
  @ApiPropertyOptional({ description: 'e.g. "curry cut"' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(250) instruction?: string;
}

export class OrderAddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) title?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 255) street: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) city: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(4, 20) pincode: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
}

export class PlaceOrderDto {
  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiProperty({ type: OrderAddressDto }) @ValidateNested() @Type(() => OrderAddressDto) address: OrderAddressDto;

  @ApiPropertyOptional({ enum: ['COD', 'ONLINE'], default: 'COD' }) @IsOptional() @IsIn(['COD', 'ONLINE']) paymentMethod?: 'COD' | 'ONLINE';

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) deliveryInstruction?: string;

  @ApiPropertyOptional({ example: '2026-11-10', description: 'Schedule for a future date (IST). Omit for ASAP.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'deliveryDate must be YYYY-MM-DD' })
  deliveryDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() deliverySlotId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(50) couponCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() couponId?: string;
}

export class CancelOrderDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(250) reason?: string;
}

// ---------- coupons ----------

export class ValidateCouponDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(50) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() couponId?: string;
  @ApiProperty({ description: 'Basket total incl. delivery fee, before discount' }) @Type(() => Number) @IsNumber() @Min(0) orderTotal: number;
}

export class AvailableCouponsQueryDto {
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) orderTotal: number;
}

// ---------- payments ----------

export class VerifyPaymentDto {
  @ApiProperty() @IsString() @IsNotEmpty() orderId: string;
}

// ---------- hubs ----------

export class HubQueryDto {
  @ApiPropertyOptional({ example: '600001' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(20) pincode?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
}

export class QuoteDto extends PlaceOrderDto {}

// ---------- support ----------

export class CreateTicketDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) subject: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 2000) message: string;
  @ApiPropertyOptional() @IsOptional() @IsString() orderId?: string;
}
