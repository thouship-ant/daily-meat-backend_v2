import { Injectable } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: { subject: string; message: string; orderId?: string }) {
    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({ where: { id: dto.orderId, userId }, select: { id: true } });
      if (!order) throw ApiException.notFound('Order');
    }
    return this.prisma.supportTicket.create({
      data: { userId, subject: dto.subject, message: dto.message, orderId: dto.orderId ?? null },
    });
  }

  async listForUser(userId: string, skip: number, take: number) {
    const where: Prisma.SupportTicketWhereInput = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { items, total };
  }

  async adminList(opts: { status?: TicketStatus; skip: number; take: number }) {
    const where: Prisma.SupportTicketWhereInput = opts.status ? { status: opts.status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        include: { user: { select: { id: true, name: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        skip: opts.skip,
        take: opts.take,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { items, total };
  }

  async adminUpdate(id: string, dto: { status?: TicketStatus; adminReply?: string }) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw ApiException.notFound('Ticket');
    return this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.adminReply !== undefined ? { adminReply: dto.adminReply, repliedAt: new Date() } : {}),
      },
    });
  }
}
