import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsLatitude, IsLongitude, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

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
