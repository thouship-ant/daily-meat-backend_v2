import { Module } from '@nestjs/common';
import { HubsModule } from '../hubs/hubs.module';
import { ReportsService } from './reports.service';

@Module({ imports: [HubsModule], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
