import { Injectable } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * A ticket keeps one reply text. A ticket resolved with a reply and later closed with another one shows both
 * (oldest first, blank line between): the second no longer replaces the first. Same rule as the v1 backend.
 */
export function mergeReply(previous: string | null | undefined, reply: string): string {
  const next = String(reply ?? '').trim();
  const before = String(previous ?? '').trim();
  if (!next) return before;
  if (!before) return next;
  if (before === next || before.endsWith(`\n\n${next}`)) return before;
  return `${before}\n\n${next}`;
}

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

  /** Raised by the system (not the customer): a ticket for one hub, e.g. "account deleted". */
  createForHub(userId: string, hubId: number | null, dto: { subject: string; message: string }) {
    return this.prisma.supportTicket.create({
      data: { userId, subject: dto.subject, message: dto.message, hubId },
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

  async adminList(opts: { status?: TicketStatus; skip: number; take: number; scope?: Prisma.SupportTicketWhereInput }) {
    const where: Prisma.SupportTicketWhereInput = {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.scope ?? {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        include: { user: { select: { id: true, name: true, phone: true } }, hub: { select: { id: true, name: true } } },
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
        ...(dto.adminReply !== undefined ? { adminReply: mergeReply(ticket.adminReply, dto.adminReply), repliedAt: new Date() } : {}),
      },
    });
  }
}
