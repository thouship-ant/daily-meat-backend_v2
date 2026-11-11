import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, TicketStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

// ---------- orders ----------

export class AdminOrdersQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: OrderStatus }) @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @ApiPropertyOptional({ description: 'Several statuses at once, comma separated (e.g. ASSIGNED,PICKED,OUT_FOR_DELIVERY). Used instead of `status`.', example: 'ASSIGNED,PICKED,OUT_FOR_DELIVERY' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value))
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(OrderStatus, { each: true })
  statuses?: OrderStatus[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() driverId?: string;
  @ApiPropertyOptional({ enum: ['today', 'week', 'month', 'custom'] }) @IsOptional() @IsIn(['today', 'week', 'month', 'custom']) period?: string;
  @ApiPropertyOptional({ example: '2026-11-01' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @ApiPropertyOptional({ example: '2026-11-08' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string;
  @ApiPropertyOptional({ description: 'Order id, customer name or phone' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus }) @IsEnum(OrderStatus) status: OrderStatus;
  @ApiPropertyOptional({ description: 'Required for FAILED; shown to the customer for CANCELLED' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  reason?: string;
}

export class AssignDriverDto {
  @ApiProperty() @IsUUID() driverId: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) orderIds: string[];
  @ApiPropertyOptional({ description: 'Also take over orders already assigned to another driver' }) @IsOptional() @IsBoolean() reassign?: boolean;
}

class ManualItemDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(100) quantity: number;
  @ApiPropertyOptional({ description: 'Override the catalogue unit price' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) unitPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) instruction?: string;
}

class ManualAddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) title?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 255) street: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) city: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(4, 20) pincode: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
}

export class ManualOrderDto {
  @ApiProperty({ example: '9876543210' }) @Transform(trim) @IsString() @Length(8, 15) customerPhone: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) customerName: string;
  @ApiProperty({ type: [ManualItemDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ManualItemDto) items: ManualItemDto[];
  @ApiProperty({ type: ManualAddressDto }) @ValidateNested() @Type(() => ManualAddressDto) address: ManualAddressDto;
  @ApiPropertyOptional({ example: 'COD', description: 'COD, or e.g. CASH / UPI / PREPAID for already-paid' }) @IsOptional() @IsString() @MaxLength(20) paymentMethod?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) deliveryCharge?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) deliveryDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deliverySlotId?: string;
}

export class DashboardQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'week', 'month', 'custom', 'all'], default: 'all' }) @IsOptional() @IsIn(['today', 'week', 'month', 'custom', 'all']) filter?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string;
  @ApiPropertyOptional({ description: 'Only this hub (omit for all hubs)' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
}

export class ReportQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'week', 'month', 'custom'], default: 'week' }) @IsOptional() @IsIn(['today', 'week', 'month', 'custom']) filter?: string;
  @ApiPropertyOptional({ example: '2026-11-01' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @ApiPropertyOptional({ example: '2026-11-12', description: 'At most 92 days from startDate' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string;
  @ApiPropertyOptional({ description: 'Only this hub (omit for all hubs)' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
}

/** Just the hub filter (super admin lists: contact messages, supplier bills, marketing plans ...) */
export class HubFilterDto {
  @ApiPropertyOptional({ description: 'Only this hub (omit for all hubs)' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
}

export class ContactStatusDto {
  @ApiProperty({ enum: ['UNREAD', 'READ', 'REPLIED'] }) @IsIn(['UNREAD', 'READ', 'REPLIED']) status: 'UNREAD' | 'READ' | 'REPLIED';
}

export class SellerBillItemDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 255) productName: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() variantName?: string | null;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) quantity: number;
}

export class CreateSellerBillDto {
  @ApiProperty({ type: [SellerBillItemDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SellerBillItemDto) items: SellerBillItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierName?: string;
  @ApiPropertyOptional({ description: 'The hub this bill is for' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
}

export class RequiredItemsQueryDto {
  @ApiPropertyOptional({ example: '2026-11-11' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @ApiPropertyOptional({ description: 'Only the orders of this hub' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
}

// ---------- marketing ----------

export class BroadcastDto {
  @ApiPropertyOptional({ enum: ['ALL', 'INACTIVE'] }) @IsOptional() @IsIn(['ALL', 'INACTIVE']) target?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) inactiveDays?: number;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) title: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 500) body: string;
  @ApiPropertyOptional({ description: 'Only the customers of this hub (omit for all hubs)' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
}

export class ScheduledPlanDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 100) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 100) title?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 500) body?: string;
  @ApiPropertyOptional({ enum: ['ALL', 'INACTIVE'] }) @IsOptional() @IsIn(['ALL', 'INACTIVE']) audience?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) inactiveDays?: number | null;
  @ApiPropertyOptional({ example: '2026-11-10' }) @IsOptional() @IsString() startDate?: string;
  @ApiPropertyOptional({ example: '2026-11-12' }) @IsOptional() @IsString() endDate?: string;
  @ApiPropertyOptional({ example: '10:00' }) @IsOptional() @IsString() windowStart?: string;
  @ApiPropertyOptional({ example: '11:00' }) @IsOptional() @IsString() windowEnd?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Only the customers of this hub (omit for all hubs)' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number | null;
}

// ---------- people ----------

export class CreateDriverDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) name: string;
  @ApiProperty({ example: '+919876543210' }) @Transform(trim) @IsString() @Length(8, 20) phone: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) password: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsEmail() email?: string;
}

export class SetDriverHubDto {
  @ApiPropertyOptional({ description: 'The hub the driver normally works for; null/omitted = no hub' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hubId?: number | null;
}

export class CreateDriverHubAssignmentDto {
  @ApiProperty({ description: 'The hub the driver is lent to' }) @Type(() => Number) @IsInt() hubId: number;
  @ApiProperty({ example: '2026-11-15', description: 'First day (inclusive), YYYY-MM-DD' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate: string;
  @ApiProperty({ example: '2026-11-20', description: 'Last day (inclusive); the driver is back at their own hub the day after' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate: string;
}

export class SetActiveDto {
  @ApiProperty() @IsBoolean() isActive: boolean;
}

export class OrderAddressDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 255) street: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 255) city: string;
  @ApiProperty({ example: '620001' }) @Transform(trim) @IsString() @Matches(/^[6]\d{5}$/, { message: 'Please enter a valid 6-digit pincode.' }) pincode: string;
}

export class CustomerDetailQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'ISO date: also return ordersBefore = delivered orders placed before this moment' })
  @IsOptional() @IsString() before?: string;
  @ApiPropertyOptional({ enum: ['DELIVERED'], description: 'List only delivered orders' })
  @IsOptional() @IsIn(['DELIVERED']) status?: 'DELIVERED';
}

/** Customer list / export filters (see CustomerDirectoryService). */
export class CustomersQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Name, phone or email contains' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) search?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Only the customers of this hub (omit for all hubs)' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
  @ApiPropertyOptional({ example: '2026-11-01', description: 'Registered on or after (India time)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) createdFrom?: string;
  @ApiPropertyOptional({ example: '2026-11-30', description: 'Registered on or before (India time)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) createdTo?: string;
  @ApiPropertyOptional({ description: 'Street / city text of the delivery address (first-login location when there is no address)' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) location?: string;
  @ApiPropertyOptional({ example: '620001', description: 'Pincode range start: delivery address pincode, or first-login location pincode when there is no address' }) @IsOptional() @Matches(/^\d{6}$/) pincodeFrom?: string;
  @ApiPropertyOptional({ example: '620010' }) @IsOptional() @Matches(/^\d{6}$/) pincodeTo?: string;
  @ApiPropertyOptional({ enum: ['date', 'pincode', 'city'] }) @IsOptional() @IsIn(['date', 'pincode', 'city']) groupBy?: 'date' | 'pincode' | 'city';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) sort?: 'asc' | 'desc';
}

export class UsersQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Name, phone or email contains' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) search?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Only the customers of this hub (omit for all hubs)' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
}

// ---------- catalog ----------

export class CategoryDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) name: string;
  @ApiPropertyOptional({ type: 'string', format: 'binary' }) image?: any;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 100) name?: string;
  @ApiPropertyOptional({ type: 'string', format: 'binary' }) image?: any;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class ProductDto {
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) storageInstructions?: string;
  @ApiPropertyOptional({ type: 'string', format: 'binary' }) image?: any;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isPopular?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class UpdateProductDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) storageInstructions?: string;
  @ApiPropertyOptional({ type: 'string', format: 'binary' }) image?: any;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isPopular?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class ProductsQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
}

export class VariantDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '500g' }) @Transform(trim) @IsString() @Length(1, 50) weight: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) price: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discountedPrice?: number;
  @ApiPropertyOptional({ description: 'Wholesale price, admin only' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) costPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inStock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateVariantDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 50) weight?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discountedPrice?: number | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) costPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inStock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BannerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) title?: string;
  @ApiPropertyOptional({ type: 'string', format: 'binary' }) image?: any;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
}

// ---------- store ----------

class DistanceTierDto {
  @ApiProperty() @IsNumber() @Min(0) upToKm: number;
  @ApiProperty() @IsNumber() @Min(0) fee: number;
}

export class HubDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) deliveryRadiusKm?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) deliverablePincodes?: string[];
  @ApiPropertyOptional({ type: [DistanceTierDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DistanceTierDto) distanceTiers?: DistanceTierDto[];
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minOrderForFreeDelivery?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) deliveryFeeAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) freeDeliveryDistanceKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) distanceDeliveryFeeAmount?: number;
  @ApiPropertyOptional({ enum: ['amount', 'distance'] }) @IsOptional() @IsIn(['amount', 'distance']) deliveryFeeStrategy?: string;
  @ApiPropertyOptional({ example: '09:00' }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) storeStartTime?: string;
  @ApiPropertyOptional({ example: '22:00' }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) storeCloseTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() ordersPaused?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) pauseReason?: string;
}

export class PauseAllHubsDto {
  @ApiProperty() @IsBoolean() paused: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class SlotDto {
  @ApiProperty({ example: '09:00' }) @IsString() @IsNotEmpty() @MaxLength(20) startTime: string;
  @ApiProperty({ example: '11:00' }) @IsString() @IsNotEmpty() @MaxLength(20) endTime: string;
  @ApiProperty({ example: 'Morning: 9 AM - 11 AM' }) @IsString() @IsNotEmpty() @MaxLength(100) label: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Orders one hub takes for this slot per day; empty = no limit' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) maxOrders?: number | null;
}

export class UpdateSlotDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) startTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) endTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Orders one hub takes for this slot per day; null = no limit' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) maxOrders?: number | null;
}

export class CouponDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 50) code: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ enum: ['flat', 'percent'] }) @IsIn(['flat', 'percent']) discountType: 'flat' | 'percent';
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) discountValue: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxDiscountAmount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minOrderAmount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxOrderAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ enum: ['public', 'hidden'] }) @IsOptional() @IsIn(['public', 'hidden']) visibility?: 'public' | 'hidden';
  @ApiPropertyOptional({ enum: ['all_users', 'new_users_only'] }) @IsOptional() @IsIn(['all_users', 'new_users_only']) audienceType?: 'all_users' | 'new_users_only';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) totalRedemptionLimit?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) perUserLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoHideAfterUse?: boolean;
}

export class UpdateCouponDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 50) code?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: ['flat', 'percent'] }) @IsOptional() @IsIn(['flat', 'percent']) discountType?: 'flat' | 'percent';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discountValue?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxDiscountAmount?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minOrderAmount?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxOrderAmount?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() startAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() endAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ enum: ['public', 'hidden'] }) @IsOptional() @IsIn(['public', 'hidden']) visibility?: 'public' | 'hidden';
  @ApiPropertyOptional({ enum: ['all_users', 'new_users_only'] }) @IsOptional() @IsIn(['all_users', 'new_users_only']) audienceType?: 'all_users' | 'new_users_only';
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) totalRedemptionLimit?: number | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) perUserLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoHideAfterUse?: boolean;
}

export class CouponsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['active', 'inactive'] }) @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
  @ApiPropertyOptional({ enum: ['public', 'hidden'] }) @IsOptional() @IsIn(['public', 'hidden']) visibility?: 'public' | 'hidden';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
}

export class TicketsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TicketStatus }) @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @ApiPropertyOptional({ description: 'Only tickets of this hub (omit for all hubs)' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
}

export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: TicketStatus }) @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) adminReply?: string;
}
