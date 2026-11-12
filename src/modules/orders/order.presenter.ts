import { Prisma } from '@prisma/client';
import { toDateOnly } from '../../common/utils/time';
import { toMoney } from '../../common/utils/money';
import { onlinePayState } from './cod-online-payment';

/** What every order query loads, so presenters never trigger lazy loads. */
export const ORDER_INCLUDE = {
  items: { include: { product: { select: { imageUrl: true } } }, orderBy: { createdAt: 'asc' } },
  user: { select: { id: true, name: true, phone: true } },
  driver: { select: { id: true, name: true, phone: true } },
  hub: { select: { id: true, name: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

export interface PresentOptions {
  /** cost & profit - admin only */
  financials?: boolean;
  /** maps link for the driver app */
  navigation?: boolean;
}

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : toMoney(Number(v)));

export function presentOrder(o: OrderWithRelations, opts: PresentOptions = {}) {
  const formatted = [o.addressStreet, o.addressCity, o.addressPincode].filter(Boolean).join(', ');
  return {
    id: o.id,
    status: o.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deliveredAt: o.deliveredAt,
    payment: {
      method: o.paymentMethod,
      status: o.paymentStatus,
      // what the apps print: COD orders are "COD - Pending" until paid; a failed online payment is "Online - Failed"
      label: o.paymentMethod === 'COD'
        ? (o.paymentStatus === 'PAID' ? 'COD - Paid' : 'COD - Pending')
        : o.paymentStatus === 'FAILED' ? 'Online - Failed' : o.paymentStatus === 'PAID' ? 'Online - Paid' : 'Online - Pending',
      attempts: o.paymentAttempts ?? 0,
      // a COD order can still be paid online until it is out for delivery (+5 minutes)
      onlinePayAvailable: onlinePayState(o).available,
      onlinePayClosesAt: onlinePayState(o).closesAt,
    },
    amounts: {
      subtotal: num(o.subtotalAmount) ?? 0,
      discount: num(o.discountAmount) ?? 0,
      deliveryCharge: num(o.deliveryCharge) ?? 0,
      total: num(o.totalAmount) ?? 0,
      ...(opts.financials ? { totalCost: num(o.totalCost) ?? 0, totalProfit: num(o.totalProfit) ?? 0 } : {}),
    },
    coupon: o.couponId ? { id: o.couponId, code: o.couponCodeSnapshot } : null,
    schedule: {
      date: toDateOnly(o.deliveryDate),
      slotId: o.deliverySlotId,
      slotLabel: o.deliverySlotLabel,
      isScheduled: !!o.deliveryDate,
    },
    deliveryInstruction: o.deliveryInstruction,
    failureReason: o.failureReason,
    addressChangeRequestedAt: o.addressChangeRequestedAt,
    address: {
      title: o.addressTitle,
      street: o.addressStreet,
      city: o.addressCity,
      pincode: o.addressPincode,
      latitude: o.addressLatitude != null ? Number(o.addressLatitude) : null,
      longitude: o.addressLongitude != null ? Number(o.addressLongitude) : null,
      formatted,
      ...(opts.navigation && formatted
        ? {
            navigationUrl:
              o.addressLatitude != null && o.addressLongitude != null
                ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${o.addressLatitude},${o.addressLongitude}`
                : `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(formatted)}`,
          }
        : {}),
    },
    hub: o.hub ?? null,
    customer: o.user ?? null,
    driver: o.driver ?? null,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      name: i.productNameSnapshot,
      variant: i.variantNameSnapshot,
      imageUrl: i.product?.imageUrl ?? null,
      quantity: i.quantity,
      unitPrice: num(i.price) ?? 0,
      lineTotal: toMoney(Number(i.price) * i.quantity),
      instruction: i.instruction,
    })),
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
  };
}

export type OrderView = ReturnType<typeof presentOrder>;
