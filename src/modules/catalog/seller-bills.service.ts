import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface SellerBillItemInput {
  productId: string;
  productName: string;
  variantId?: string | null;
  variantName?: string | null;
  quantity: number;
}

/** Supplier ("seller") bills: what the shop needs to buy, grouped into a bill for a supplier. */
@Injectable()
export class SellerBillsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: { items: SellerBillItemInput[]; notes?: string; categoryName?: string; supplierName?: string }) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `DM${Math.floor(10000 + Math.random() * 90000)}`;
      try {
        return await this.prisma.sellerBill.create({
          data: {
            id,
            notes: input.notes,
            categoryName: input.categoryName,
            supplierName: input.supplierName,
            items: {
              create: input.items.map((i) => ({
                productId: i.productId,
                productNameSnapshot: i.productName,
                variantId: i.variantId || null,
                variantNameSnapshot: i.variantName || null,
                quantity: i.quantity,
              })),
            },
          },
          include: { items: true },
        });
      } catch (e) {
        // the 5-digit number was taken: draw another one
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw ApiException.badRequest('BILL_ID_TAKEN', 'Could not generate a bill number, please try again.');
  }

  list() {
    return this.prisma.sellerBill.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async get(id: string) {
    const bill = await this.prisma.sellerBill.findUnique({ where: { id }, include: { items: true } });
    if (!bill) throw ApiException.notFound('Bill');
    return bill;
  }

  /** Every active product / variant with the quantity the open orders (optionally of one delivery date) still need. */
  async requiredItems(date?: string) {
    const items = await this.prisma.orderItem.findMany({
      where: {
        order: {
          status: { notIn: ['DELIVERED', 'CANCELLED', 'FAILED'] },
          ...(date ? { deliveryDate: new Date(`${date}T00:00:00.000Z`) } : {}),
        },
      },
      select: { productId: true, variantId: true, quantity: true },
    });
    const required = new Map<string, number>();
    for (const i of items) {
      const key = `${i.productId}_${i.variantId ?? 'null'}`;
      required.set(key, (required.get(key) ?? 0) + i.quantity);
    }

    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      include: { category: { select: { id: true, name: true } }, variants: true },
    });
    const out: Record<string, unknown>[] = [];
    for (const p of products) {
      const base = { productId: p.id, productName: p.name, categoryId: p.category?.id ?? null, categoryName: p.category?.name ?? 'Uncategorized' };
      if (p.variants.length) {
        for (const v of p.variants) {
          if (v.isActive === false) continue;
          out.push({ ...base, variantId: v.id, variantName: v.weight, requiredQty: required.get(`${p.id}_${v.id}`) ?? 0 });
        }
      } else {
        out.push({ ...base, variantId: null, variantName: null, requiredQty: required.get(`${p.id}_null`) ?? 0 });
      }
    }
    return out;
  }
}
