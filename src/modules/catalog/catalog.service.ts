import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const CACHE_PREFIX = 'catalog:';
const CACHE_TTL = 120;

/** Only these fields of a variant are public. `costPrice` (wholesale price) must never reach customers. */
const PUBLIC_VARIANT_SELECT = {
  id: true,
  productId: true,
  weight: true,
  price: true,
  discountedPrice: true,
  inStock: true,
  isActive: true,
} satisfies Prisma.ProductVariantSelect;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // =====================================================================
  // Customer-facing reads (active only, cached, no cost prices)
  // =====================================================================

  listCategories() {
    return this.cache.wrap(`${CACHE_PREFIX}categories`, CACHE_TTL, () =>
      this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
    );
  }

  listProducts(opts: { categoryId?: string; popular?: boolean; search?: string }) {
    const key = `${CACHE_PREFIX}products:${opts.categoryId ?? '-'}:${opts.popular ? 'p' : '-'}:${opts.search ?? '-'}`;
    return this.cache.wrap(key, CACHE_TTL, () =>
      this.prisma.product.findMany({
        where: {
          isActive: true,
          category: { isActive: true },
          ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
          ...(opts.popular ? { isPopular: true } : {}),
          ...(opts.search ? { name: { contains: opts.search, mode: 'insensitive' } } : {}),
        },
        include: { variants: { where: { isActive: true }, select: PUBLIC_VARIANT_SELECT, orderBy: { price: 'asc' } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
    );
  }

  async getProduct(id: string) {
    const product = await this.cache.wrap(`${CACHE_PREFIX}product:${id}`, CACHE_TTL, () =>
      this.prisma.product.findFirst({
        where: { id, isActive: true },
        include: { variants: { where: { isActive: true }, select: PUBLIC_VARIANT_SELECT, orderBy: { price: 'asc' } } },
      }),
    );
    if (!product) throw ApiException.notFound('Product');
    return product;
  }

  /** Top 10 by units sold, among products that still have something in stock. */
  listBestSellers() {
    return this.cache.wrap(`${CACHE_PREFIX}best-sellers`, 600, async () => {
      const top = await this.prisma.orderItem.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 20,
      });
      if (!top.length) return [];
      const products = await this.prisma.product.findMany({
        where: { id: { in: top.map((t) => t.productId) }, isActive: true },
        include: { variants: { where: { isActive: true }, select: PUBLIC_VARIANT_SELECT } },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      return top
        .map((t) => byId.get(t.productId))
        .filter((p): p is NonNullable<typeof p> => !!p && p.variants.some((v) => v.inStock))
        .slice(0, 10);
    });
  }

  listBanners() {
    return this.cache.wrap(`${CACHE_PREFIX}banners`, CACHE_TTL, () =>
      this.prisma.banner.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' } }),
    );
  }

  // =====================================================================
  // Admin (everything, uncached, with cost prices)
  // =====================================================================

  adminListCategories() {
    return this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
  }

  async createCategory(data: Prisma.CategoryCreateInput) {
    const c = await this.prisma.category.create({ data });
    await this.invalidate();
    return c;
  }

  async updateCategory(id: string, data: Prisma.CategoryUpdateInput & { sortOrder?: number }) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw ApiException.notFound('Category');
    const updated = await this.prisma.$transaction(async (tx) => {
      // sort order is unique-ish: swap with whoever currently holds the requested position
      if (typeof data.sortOrder === 'number' && data.sortOrder !== category.sortOrder) {
        await tx.category.updateMany({
          where: { sortOrder: data.sortOrder, id: { not: id } },
          data: { sortOrder: category.sortOrder },
        });
      }
      return tx.category.update({ where: { id }, data });
    });
    await this.invalidate();
    return updated;
  }

  async deleteCategory(id: string) {
    const products = await this.prisma.product.count({ where: { categoryId: id } });
    if (products > 0) throw ApiException.conflict('This category still has products. Move or delete them first.');
    await this.prisma.category.delete({ where: { id } });
    await this.invalidate();
  }

  async adminListProducts(opts: { categoryId?: string; skip: number; take: number; search?: string }) {
    const where: Prisma.ProductWhereInput = {
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      ...(opts.search ? { name: { contains: opts.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: { variants: { orderBy: { price: 'asc' } }, category: { select: { id: true, name: true } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: opts.skip,
        take: opts.take,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total };
  }

  async createProduct(data: Prisma.ProductUncheckedCreateInput) {
    const category = await this.prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!category) throw ApiException.notFound('Category');
    const product = await this.prisma.$transaction(async (tx) => {
      if (typeof data.sortOrder === 'number' && data.sortOrder > 0) {
        await tx.product.updateMany({
          where: { categoryId: data.categoryId, sortOrder: data.sortOrder },
          data: { sortOrder: 0 },
        });
      }
      return tx.product.create({ data });
    });
    await this.invalidate();
    return product;
  }

  async updateProduct(id: string, data: Prisma.ProductUncheckedUpdateInput) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw ApiException.notFound('Product');
    const targetCategory = (data.categoryId as string | undefined) ?? product.categoryId;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (typeof data.sortOrder === 'number') {
        const categoryChanged = targetCategory !== product.categoryId;
        if (data.sortOrder !== product.sortOrder || categoryChanged) {
          await tx.product.updateMany({
            where: { categoryId: targetCategory, sortOrder: data.sortOrder, id: { not: id } },
            data: { sortOrder: categoryChanged ? 0 : product.sortOrder },
          });
        }
      }
      return tx.product.update({ where: { id }, data, include: { variants: true } });
    });
    await this.invalidate();
    return updated;
  }

  async deleteProduct(id: string) {
    const used = await this.prisma.orderItem.count({ where: { productId: id } });
    if (used > 0) {
      // Past orders reference it: hide instead of deleting.
      await this.prisma.product.update({ where: { id }, data: { isActive: false } });
      await this.invalidate();
      return { deleted: false, deactivated: true };
    }
    await this.prisma.product.delete({ where: { id } });
    await this.invalidate();
    return { deleted: true, deactivated: false };
  }

  async createVariant(data: Prisma.ProductVariantUncheckedCreateInput) {
    const product = await this.prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw ApiException.notFound('Product');
    const v = await this.prisma.productVariant.create({ data });
    await this.invalidate();
    return v;
  }

  async updateVariant(id: string, data: Prisma.ProductVariantUpdateInput) {
    const v = await this.prisma.productVariant.update({ where: { id }, data });
    await this.invalidate();
    return v;
  }

  async deleteVariant(id: string) {
    const used = await this.prisma.orderItem.count({ where: { variantId: id } });
    if (used > 0) {
      await this.prisma.productVariant.update({ where: { id }, data: { isActive: false } });
      await this.invalidate();
      return { deleted: false, deactivated: true };
    }
    await this.prisma.productVariant.delete({ where: { id } });
    await this.invalidate();
    return { deleted: true, deactivated: false };
  }

  adminListBanners() {
    return this.prisma.banner.findMany({ orderBy: { createdAt: 'desc' } });
  }
  async createBanner(data: Prisma.BannerCreateInput) {
    const b = await this.prisma.banner.create({ data });
    await this.invalidate();
    return b;
  }
  async updateBanner(id: string, data: Prisma.BannerUpdateInput) {
    const b = await this.prisma.banner.update({ where: { id }, data });
    await this.invalidate();
    return b;
  }
  async deleteBanner(id: string) {
    await this.prisma.banner.delete({ where: { id } });
    await this.invalidate();
  }

  private invalidate() {
    return this.cache.delByPrefix(CACHE_PREFIX);
  }
}
