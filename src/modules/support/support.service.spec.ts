import { mergeReply, SupportService } from './support.service';

describe('support ticket replies', () => {
  const resolved = 'Hi Iliyaz, your issue is resolved.';
  const closed = 'Hi Iliyaz, thank you for contacting Daily Meat. We are closing it.';

  it('keeps both replies when a resolved ticket is closed with another reply, oldest first', () => {
    expect(mergeReply(null, resolved)).toBe(resolved);
    expect(mergeReply(resolved, closed)).toBe(`${resolved}\n\n${closed}`);
  });

  it('does not repeat the same message', () => {
    expect(mergeReply(`${resolved}\n\n${closed}`, closed)).toBe(`${resolved}\n\n${closed}`);
    expect(mergeReply(resolved, resolved)).toBe(resolved);
  });

  it('ignores an empty reply and surrounding spaces', () => {
    expect(mergeReply(resolved, '')).toBe(resolved);
    expect(mergeReply(undefined, '  hello  ')).toBe('hello');
  });

  it('a third reply (resolve, close, reopen, close) keeps all of them', () => {
    expect(mergeReply(mergeReply(resolved, closed), 'One more note.')).toBe(`${resolved}\n\n${closed}\n\nOne more note.`);
  });

  describe('SupportService.adminUpdate', () => {
    const make = (existing: { adminReply: string | null; status: string }) => {
      const updates: any[] = [];
      const prisma: any = {
        supportTicket: {
          findUnique: async () => ({ id: 't1', ...existing }),
          update: async (args: any) => {
            updates.push(args);
            return { id: 't1', ...existing, ...args.data };
          },
        },
      };
      return { service: new SupportService(prisma), updates };
    };

    it('closing a resolved ticket with a reply stores both replies', async () => {
      const { service, updates } = make({ adminReply: resolved, status: 'RESOLVED' });
      await service.adminUpdate('t1', { status: 'CLOSED' as any, adminReply: closed });
      expect(updates[0].data.adminReply).toBe(`${resolved}\n\n${closed}`);
      expect(updates[0].data.status).toBe('CLOSED');
    });

    it('a status change without a reply keeps the stored reply untouched (reopen to In Progress)', async () => {
      const { service, updates } = make({ adminReply: closed, status: 'CLOSED' });
      await service.adminUpdate('t1', { status: 'IN_PROGRESS' as any });
      expect(updates[0].data).toEqual({ status: 'IN_PROGRESS' });
    });
  });
});
