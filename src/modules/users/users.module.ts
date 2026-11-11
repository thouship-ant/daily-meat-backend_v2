import { Module } from '@nestjs/common';
import { CustomerDirectoryService } from './customer-directory.service';
import { DriverHubsService } from './driver-hubs.service';
import { UsersService } from './users.service';

@Module({ providers: [UsersService, DriverHubsService, CustomerDirectoryService], exports: [UsersService, DriverHubsService, CustomerDirectoryService] })
export class UsersModule {}
