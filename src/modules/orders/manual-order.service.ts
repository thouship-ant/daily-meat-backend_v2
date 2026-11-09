import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { ApiException, ErrorCode } from '../../common/api-error';
import { toMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HubsService } from '../hubs/hubs.service';
import { DeliverySlotsService } from './delivery-slots.service';
import { PlaceOrderAddress } from './order-placement.service';

export interface ManualOrderInput {
  customerPhone: string;
  customerName: string;
  items: Array<{ variantId: string; quantity: number; unitPrice?: number; instruction?: string }>;
  address: PlaceOrderAddress;
  /** COD, or anything else for an already-paid order (cash/UPI collected by the admin) */
  paymentMethod?: string;
  deliveryCharge?: number;
  deliveryDate?: string;
  deliverySlotId?: string;
}

/** Orders taken over the phone: created by an admin for a (new or existing) customer, straight to CONFIRMED. */
@Injectable()
export class ManualOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hubs: HubsService,
    private readonly slots: DeliverySlotsService,
  ) {}

  async create(input: ManualOrderInput): Promise<{ orderId: string; customerId: string }> {
    const phone = input.customerPhone.startsWith('+91') ? input.customerPhone : `+91${input.customerPhone}`;
    const slot = input.deliverySlotId ? await this.slots.getActive(input.deliverySlotId) : null;
    const hub = (await this.hubs.findForPincode(input.address.pincode)) ?? (await this.hubs.getDefault());
    const method = (input.paymentMethod ?? 'PREPAID').toUpperCase();

    return this.prisma.$transaction(async (tx) => {
      const customer =
        (await tx.user.findUnique({ where: { phone } })) ??
        (await tx.user.create({ data: { name: input.customerName, phone, role: 'CUSTOMER' } }));
      if (customer.role !== 'CUSTOMER') {
        throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'This phone number belongs to a staff account.');
      }

      const variants = await tx.productVariant.findMany({
        where: { id: { in: input.items.map((i) => i.variantId) } },
        include: { product: { select: { name: true } } },
      });
      const byId = new Map(variants.map((v) => [v.id, v]));

      let subtotal = 0;
      let totalCost = 0;
      const lines: Prisma.OrderItemCreateWithoutOrderInput[] = [];
      for (const item of input.items) {
        const v = byId.get(item.variantId);
        if (!v) throw ApiException.badRequest(ErrorCode.ITEM_UNAVAILABLE, 'One of the items does not exist.', { variantId: item.variantId });
        // Admins may override the unit price (phone negotiations); default is the catalogue price.
        const unit = toMoney(item.unitPrice ?? (v.discountedPrice || v.price));
        const cost = toMoney(v.costPrice ?? 0);
        subtotal += unit * item.quantity;
        totalCost += cost * item.quantity;
        lines.push({
          product: { connect: { id: v.productId } },
          variant: { connect: { id: v.id } },
          productNameSnapshot: v.product.name,
          variantNameSnapshot: v.weight,
          quantity: item.quantity,
          price: unit,
          costPriceSnapshot: cost,
          instruction: item.instruction ?? null,
        });
      }
      subtotal = toMoney(subtotal);
      const deliveryCharge = toMoney(input.deliveryCharge ?? 0);
      const total = toMoney(subtotal + deliveryCharge);

      const existingAddress = await tx.address.findFirst({
        where: { userId: customer.id, street: input.address.street, city: input.address.city },
      });
      if (!existingAddress) {
        await tx.address.create({
          data: {
            userId: customer.id,
            title: input.address.title || 'Other',
            street: input.address.street,
            city: input.address.city,
            pincode: input.address.pincode,
            latitude: input.address.latitude ?? 0,
            longitude: input.address.longitude ?? 0,
            isDeliverable: true,
            isDefault: (await tx.address.count({ where: { userId: customer.id } })) === 0,
          },
        });
      }

      const orderId = `ODDM${randomInt(10000, 100000)}`;
      await tx.order.create({
        data: {
          id: orderId,
          user: { connect: { id: customer.id } },
          ...(hub ? { hub: { connect: { id: hub.id } } } : {}),
          status: 'CONFIRMED',
          subtotalAmount: subtotal,
          deliveryCharge,
          discountAmount: 0,
          totalAmount: total,
          totalCost: toMoney(totalCost),
          totalProfit: toMoney(total - deliveryCharge - totalCost),
          paymentMethod: method,
          // anything other than cash-on-delivery was settled when the order was taken
          paymentStatus: method === 'COD' ? 'PENDING' : 'PAID',
          deliveryDate: input.deliveryDate ? new Date(`${input.deliveryDate}T00:00:00.000Z`) : null,
          deliverySlotId: slot?.id ?? null,
          deliverySlotLabel: slot?.label ?? null,
          deliveryInstruction: 'Manual order by admin',
          addressTitle: input.address.title ?? null,
          addressStreet: input.address.street,
          addressCity: input.address.city,
          addressPincode: input.address.pincode,
          addressLatitude: input.address.latitude ?? null,
          addressLongitude: input.address.longitude ?? null,
          items: { create: lines },
        },
      });
      return { orderId, customerId: customer.id };
    });
  }
}
