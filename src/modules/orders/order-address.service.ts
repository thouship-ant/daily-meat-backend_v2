import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Order } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { AddressUpdateRequestedEvent, DomainEvents, OrderAddressChangedEvent } from '../../common/events/domain-events';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AddressReviewService } from '../addresses/address-review.service';
import { ApprovedAddressesService } from '../addresses/approved-addresses.service';

const FINISHED = ['DELIVERED', 'CANCELLED', 'FAILED'];
// A customer can switch the address only while the order has not been given to a driver
const CUSTOMER_EDITABLE = ['PENDING', 'CONFIRMED'];

/** Review / correct the delivery address printed on an order (admin asks, customer or admin fixes it). */
@Injectable()
export class OrderAddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly review: AddressReviewService,
    private readonly approved: ApprovedAddressesService,
  ) {}

  private async load(id: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw ApiException.notFound('Order');
    return order;
  }

  private assertOpen(order: Order) {
    if (FINISHED.includes(order.status)) {
      throw ApiException.badRequest('ORDER_FINISHED', `The order is already ${order.status}.`);
    }
  }

  /** Admin: push the customer a request to correct this order's address. Unlocks "change address" for them. */
  async askCustomerToUpdate(id: string): Promise<{ sent: boolean; message: string }> {
    const order = await this.load(id);
    this.assertOpen(order);
    const issue = await this.review.review(order);
    if (!issue) return { sent: false, message: 'The address on this order looks complete.' };

    await this.prisma.order.update({ where: { id }, data: { addressChangeRequestedAt: new Date() } });
    const event: AddressUpdateRequestedEvent = {
      userId: order.userId,
      orderId: order.id,
      message: this.review.buildMessage(order, issue),
    };
    this.events.emit(DomainEvents.AddressUpdateRequested, event);
    return { sent: true, message: 'The customer has been asked to update the address.' };
  }

  /** Admin: the address on this order is fine; remember it so the check stops flagging it. */
  async approve(id: string, adminId: string): Promise<void> {
    const order = await this.load(id);
    await this.approved.approve({
      street: order.addressStreet,
      city: order.addressCity,
      pincode: order.addressPincode,
      adminId,
    });
    await this.prisma.order.update({ where: { id }, data: { addressChangeRequestedAt: null } });
  }

  /** Admin: the customer confirmed the right address by phone / chat; the admin types it into the order. */
  async adminUpdate(id: string, input: { street: string; city: string; pincode: string }): Promise<Order> {
    const order = await this.load(id);
    this.assertOpen(order);
    return this.prisma.order.update({
      where: { id },
      data: {
        addressStreet: input.street.trim().slice(0, 255),
        addressCity: input.city.trim().slice(0, 255),
        addressPincode: input.pincode.trim(),
        addressChangeRequestedAt: null,
      },
    });
  }

  /** Customer: send the order to another saved address (only after the shop asked, and before a driver has it). */
  async customerChange(userId: string, orderId: string, addressId: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw ApiException.notFound('Order');
    if (!CUSTOMER_EDITABLE.includes(order.status)) {
      throw ApiException.badRequest('ORDER_LOCKED', `The address can no longer be changed because the order is ${order.status}.`);
    }
    if (!order.addressChangeRequestedAt) {
      throw ApiException.badRequest('CHANGE_NOT_REQUESTED', 'The address can only be changed when the shop asks for it.');
    }
    const address = await this.prisma.address.findFirst({ where: { id: addressId, userId } });
    if (!address) throw ApiException.notFound('Address');
    if (!address.isDeliverable) throw ApiException.badRequest('NOT_DELIVERABLE', 'We do not deliver to that address.');

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        addressTitle: address.title,
        addressStreet: address.street,
        addressCity: address.city,
        addressPincode: address.pincode,
        addressLatitude: address.latitude,
        addressLongitude: address.longitude,
        addressChangeRequestedAt: null,
      },
    });
    const event: OrderAddressChangedEvent = {
      order: {
        id: updated.id,
        userId: updated.userId,
        driverId: updated.driverId,
        status: updated.status,
      },
    };
    this.events.emit(DomainEvents.OrderAddressChanged, event);
    return updated;
  }
}
