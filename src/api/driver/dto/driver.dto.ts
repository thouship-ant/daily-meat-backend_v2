import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class FailDeliveryDto {
  @ApiProperty({ example: 'Customer not reachable' }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(250) reason: string;
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
