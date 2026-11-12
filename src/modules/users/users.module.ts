import { Module } from '@nestjs/common';
import { CustomerDirectoryService } from './customer-directory.service';
import { DriverHubsService } from './driver-hubs.service';
import { StaffService } from './staff.service';
import { UsersService } from './users.service';

@Module({ providers: [UsersService, DriverHubsService, CustomerDirectoryService, StaffService], exports: [UsersService, DriverHubsService, CustomerDirectoryService, StaffService] })
export class UsersModule {}
