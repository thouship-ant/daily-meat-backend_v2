import { Module } from '@nestjs/common';
import { HubsService } from './hubs.service';

@Module({ providers: [HubsService], exports: [HubsService] })
export class HubsModule {}
