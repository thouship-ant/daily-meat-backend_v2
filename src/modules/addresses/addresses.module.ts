import { Module } from '@nestjs/common';
import { HubsModule } from '../hubs/hubs.module';
import { AddressesService } from './addresses.service';

@Module({ imports: [HubsModule], providers: [AddressesService], exports: [AddressesService] })
export class AddressesModule {}
