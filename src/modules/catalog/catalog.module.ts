import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { SellerBillsService } from './seller-bills.service';

@Module({ providers: [CatalogService, SellerBillsService], exports: [CatalogService, SellerBillsService] })
export class CatalogModule {}
