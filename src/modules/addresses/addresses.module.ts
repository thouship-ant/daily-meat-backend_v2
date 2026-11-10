import { Module } from '@nestjs/common';
import { HubsModule } from '../hubs/hubs.module';
import { AddressReviewService } from './address-review.service';
import { AddressesService } from './addresses.service';
import { ApprovedAddressesService } from './approved-addresses.service';

@Module({ imports: [HubsModule], providers: [AddressesService, ApprovedAddressesService, AddressReviewService],
  exports: [AddressesService, ApprovedAddressesService, AddressReviewService] })
export class AddressesModule {}
