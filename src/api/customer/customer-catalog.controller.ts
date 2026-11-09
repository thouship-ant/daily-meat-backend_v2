import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { CatalogService } from '../../modules/catalog/catalog.service';
import { ProductQueryDto } from './dto/customer.dto';

/** Browsing needs no login. Responses contain only customer-safe fields (no cost prices). */
@ApiTags('Customer · Catalog')
@Public()
@Controller('catalog')
export class CustomerCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Active categories' })
  categories() {
    return this.catalog.listCategories();
  }

  @Get('products')
  @ApiOperation({ summary: 'Active products with their available variants' })
  products(@Query() q: ProductQueryDto) {
    return this.catalog.listProducts(q);
  }

  @Get('products/best-sellers')
  @ApiOperation({ summary: 'Top selling products that are in stock' })
  bestSellers() {
    return this.catalog.listBestSellers();
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'One product' })
  product(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getProduct(id);
  }

  @Get('banners')
  @ApiOperation({ summary: 'Home screen banners' })
  banners() {
    return this.catalog.listBanners();
  }
}
