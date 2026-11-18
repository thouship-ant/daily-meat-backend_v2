import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface InboxNotice {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  event?: string;
}

/** Kept for this long; older rows are deleted when a person opens their inbox */
const KEEP_DAYS = 60;

/**
 * The notification inbox behind the bell: every notice sent to a person is saved for them here and stays unread until
 * they open it. Saving never fails the business operation that sent the notice.
 */
@Injectable()
export class NotificationInboxService {
  private readonly logger = new Logger(NotificationInboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Save one notice for each person */
  async record(userIds: string[], notice: InboxNotice): Promise<void> {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length) return;
    try {
      await this.prisma.userNotification.createMany({
        data: ids.map((userId) => ({
          userId,
          title: notice.title.slice(0, 200),
          body: notice.body.slice(0, 1000),
          data: (notice.data ?? {}) as Prisma.InputJsonValue,
          kind: notice.event?.slice(0, 60) ?? null,
        })),
      });
    } catch (e) {
      this.logger.error(`record failed: ${(e as Error).message}`);
    }
  }

  async list(userId: string, opts: { skip: number; take: number; unreadOnly?: boolean }) {
    await this.prisma.userNotification.deleteMany({ where: { userId, createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
    const where: Prisma.UserNotificationWhereInput = { userId, ...(opts.unreadOnly ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
      this.prisma.userNotification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: opts.skip, take: opts.take }),
      this.prisma.userNotification.count({ where }),
      this.unreadCount(userId),
    ]);
    return { items, total, unread };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.userNotification.count({ where: { userId, readAt: null } });
  }

  /** Only the owner can read their own notification */
  async markRead(userId: string, id: string): Promise<void> {
    const row = await this.prisma.userNotification.findFirst({ where: { id, userId }, select: { id: true } });
    if (!row) throw ApiException.notFound('Notification');
    await this.prisma.userNotification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string): Promise<number> {
    const r = await this.prisma.userNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return r.count;
  }
}
