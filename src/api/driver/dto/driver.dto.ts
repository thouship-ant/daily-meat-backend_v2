import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsInt, Max, Min, IsLatitude, IsLongitude, IsNotEmpty, IsNumber, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class FailDeliveryDto {
  @ApiProperty({ example: 'Customer not reachable' }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(250) reason: string;
}

export class AttendanceDto {
  @ApiProperty({ description: 'true = present today, false = not working today' }) @IsBoolean() present: boolean;
}

export class OrderLimitDto {
  @ApiProperty({ example: 10, description: 'Most orders the driver takes in one set' }) @Type(() => Number) @IsInt() @Min(1) @Max(50) orderLimit: number;
}

export class BulkOrdersDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) orderIds: string[];
}

export class LocationDto {
  @ApiProperty({ type: [String], description: 'Orders currently being carried' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  orderIds: string[];

  @ApiProperty() @Type(() => Number) @IsLatitude() latitude: number;
  @ApiProperty() @Type(() => Number) @IsLongitude() longitude: number;
  @ApiPropertyOptional({ description: 'metres/second' }) @IsOptional() @Type(() => Number) @IsNumber() speed?: number;
  @ApiPropertyOptional({ description: 'degrees' }) @IsOptional() @Type(() => Number) @IsNumber() heading?: number;
}

// ---------- onboarding ----------

export class KycDto {
  @ApiProperty({ example: '2345 6789 0123', description: 'Only the last 4 digits are kept' }) @Transform(trim) @IsString() @Matches(/^[2-9][0-9 -]{10,15}$/, { message: 'Enter the 12-digit Aadhaar number.' }) aadhaarNumber: string;
  @ApiProperty({ description: 'Name as printed on the Aadhaar card' }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @ApiPropertyOptional({ type: 'string', format: 'binary' }) front?: any;
  @ApiPropertyOptional({ type: 'string', format: 'binary' }) back?: any;
}

export class ChooseHubDto {
  @ApiProperty() @Type(() => Number) @IsInt() hubId: number;
}

export class VehicleDto {
  @ApiProperty({ example: 'Honda Activa 6G' }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) model: string;
  @ApiProperty({ example: 'TN45AB1234' }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(20) regNo: string;
  @ApiProperty({ example: 2021, description: 'Year of manufacture' }) @Type(() => Number) @IsInt() year: number;
}

// ---------- interest form (numbers that are not delivery partners yet) ----------

export class InterestStatusQueryDto {
  @ApiProperty({ example: '+919876543210' }) @Transform(trim) @Matches(/^\+91[6-9]\d{9}$/, { message: 'Enter a valid 10-digit mobile number.' }) phone: string;
}

export class DriverInterestDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 100) name: string;
  @ApiProperty({ example: '+919876543210' }) @Transform(trim) @Matches(/^\+91[6-9]\d{9}$/, { message: 'Enter a valid 10-digit mobile number.' }) phone: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail({}, { message: 'Enter a valid e-mail address.' }) @MaxLength(150) email: string;
  @ApiPropertyOptional({ description: 'The hub the person would like to work for' }) @IsOptional() @Type(() => Number) @IsInt() hubId?: number;
  @ApiProperty({ example: 'Gandhipuram' }) @Transform(trim) @IsString() @Length(2, 120) locality: string;
  @ApiProperty({ example: 'Coimbatore' }) @Transform(trim) @IsString() @Length(2, 80) city: string;
  @ApiProperty({ example: '641012' }) @Transform(trim) @Matches(/^[1-9]\d{5}$/, { message: 'Enter a valid 6-digit pincode.' }) pincode: string;
}
