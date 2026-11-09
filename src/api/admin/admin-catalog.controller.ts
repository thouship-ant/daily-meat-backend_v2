import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiException, ErrorCode } from '../../common/api-error';
import { Message, Paginated } from '../../common/api-response';
import { Auth, ResponseMessage } from '../../common/decorators';
import { StorageService, MAX_IMAGE_BYTES } from '../../infrastructure/storage/storage.service';
import { CatalogService } from '../../modules/catalog/catalog.service';
import {
  BannerDto,
  CategoryDto,
  ProductDto,
  ProductsQueryDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
  VariantDto,
} from './dto/admin.dto';

const image = () => FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } });

@ApiTags('Admin · Catalog')
@Auth('ADMIN')
@Controller('catalog')
export class AdminCatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
  ) {}

  private async upload(file: Express.Multer.File | undefined, folder: string) {
    return file ? this.storage.uploadImage(file, folder) : undefined;
  }

  // ---- categories ----

  @Get('categories')
  categories() {
    return this.catalog.adminListCategories();
  }

  @Post('categories')
  @UseInterceptors(image())
  @ApiConsumes('multipart/form-data')
  @ResponseMessage('Category created.')
  async createCategory(@Body() dto: CategoryDto, @UploadedFile() file?: Express.Multer.File) {
    const { image: _i, ...data } = dto;
    return this.catalog.createCategory({ ...data, imageUrl: await this.upload(file, 'categories') });
  }

  @Patch('categories/:id')
  @UseInterceptors(image())
  @ApiConsumes('multipart/form-data')
  async updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @UploadedFile() file?: Express.Multer.File) {
    const { image: _i, ...data } = dto;
    const imageUrl = await this.upload(file, 'categories');
    return this.catalog.updateCategory(id, { ...data, ...(imageUrl ? { imageUrl } : {}) });
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Delete a category (refused while it still has products)' })
  async deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.deleteCategory(id);
    return new Message('Category deleted.');
  }

  // ---- products ----

  @Get('products')
  @ApiOperation({ summary: 'All products incl. inactive ones and variant cost prices' })
  async products(@Query() q: ProductsQueryDto) {
    const { items, total } = await this.catalog.adminListProducts({ categoryId: q.categoryId, search: q.search, skip: q.skip, take: q.limit });
    return new Paginated(items, total, q.page, q.limit);
  }

  @Post('products')
  @UseInterceptors(image())
  @ApiConsumes('multipart/form-data')
  @ResponseMessage('Product created.')
  async createProduct(@Body() dto: ProductDto, @UploadedFile() file?: Express.Multer.File) {
    const { image: _i, ...data } = dto;
    return this.catalog.createProduct({ ...data, imageUrl: await this.upload(file, 'products') });
  }

  @Patch('products/:id')
  @UseInterceptors(image())
  @ApiConsumes('multipart/form-data')
  async updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @UploadedFile() file?: Express.Multer.File) {
    const { image: _i, ...data } = dto;
    const imageUrl = await this.upload(file, 'products');
    return this.catalog.updateProduct(id, { ...data, ...(imageUrl ? { imageUrl } : {}) });
  }

  @Delete('products/:id')
  @ApiOperation({ summary: 'Delete a product; if it appears in past orders it is deactivated instead' })
  async deleteProduct(@Param('id', ParseUUIDPipe) id: string) {
    const r = await this.catalog.deleteProduct(id);
    return new Message(r.deleted ? 'Product deleted.' : 'Product is used by past orders, so it was deactivated instead.', r);
  }

  // ---- variants ----

  @Post('variants')
  @ResponseMessage('Variant created.')
  createVariant(@Body() dto: VariantDto) {
    return this.catalog.createVariant(dto);
  }

  @Patch('variants/:id')
  updateVariant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVariantDto) {
    return this.catalog.updateVariant(id, dto);
  }

  @Delete('variants/:id')
  @ApiOperation({ summary: 'Delete a variant; if it appears in past orders it is deactivated instead' })
  async deleteVariant(@Param('id', ParseUUIDPipe) id: string) {
    const r = await this.catalog.deleteVariant(id);
    return new Message(r.deleted ? 'Variant deleted.' : 'Variant is used by past orders, so it was deactivated instead.', r);
  }

  // ---- banners ----

  @Get('banners')
  banners() {
    return this.catalog.adminListBanners();
  }

  @Post('banners')
  @UseInterceptors(image())
  @ApiConsumes('multipart/form-data')
  @ResponseMessage('Banner created.')
  async createBanner(@Body() dto: BannerDto, @UploadedFile() file?: Express.Multer.File) {
    const imageUrl = await this.upload(file, 'banners');
    if (!imageUrl) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'A banner needs an image.');
    }
    return this.catalog.createBanner({ title: dto.title, isActive: dto.isActive, imageUrl });
  }

  @Patch('banners/:id')
  @UseInterceptors(image())
  @ApiConsumes('multipart/form-data')
  async updateBanner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BannerDto, @UploadedFile() file?: Express.Multer.File) {
    const imageUrl = await this.upload(file, 'banners');
    return this.catalog.updateBanner(id, { title: dto.title, isActive: dto.isActive, ...(imageUrl ? { imageUrl } : {}) });
  }

  @Delete('banners/:id')
  async deleteBanner(@Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.deleteBanner(id);
    return new Message('Banner deleted.');
  }
}
