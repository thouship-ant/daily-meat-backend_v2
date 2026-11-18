import { NotificationInboxService } from './notification-inbox.service';

function make(found: any = { id: 'n1' }) {
  const createMany = jest.fn().mockResolvedValue({ count: 2 });
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const findMany = jest.fn().mockResolvedValue([{ id: 'n1' }]);
  const count = jest.fn().mockResolvedValue(4);
  const findFirst = jest.fn().mockResolvedValue(found);
  const prisma: any = { userNotification: { createMany, updateMany, deleteMany, findMany, count, findFirst } };
  return { svc: new NotificationInboxService(prisma), createMany, updateMany, deleteMany, findMany, count, findFirst };
}

describe('NotificationInboxService', () => {
  it('saves one row per person, without duplicates', async () => {
    const { svc, createMany } = make();
    await svc.record(['a', 'b', 'a'], { title: 'T', body: 'B', event: 'adminNewOrder', data: { route: 'admin_order' } });
    const rows = createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.userId)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ title: 'T', body: 'B', kind: 'adminNewOrder', data: { route: 'admin_order' } });
  });

  it('never fails the caller when saving fails', async () => {
    const { svc, createMany } = make();
    createMany.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.record(['a'], { title: 'T', body: 'B' })).resolves.toBeUndefined();
  });

  it('saves nothing for nobody', async () => {
    const { svc, createMany } = make();
    await svc.record([], { title: 'T', body: 'B' });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('lists only my notifications, newest first, with the unread number, and cleans old ones', async () => {
    const { svc, findMany, deleteMany, count } = make();
    const r = await svc.list('me', { skip: 0, take: 20 });
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'me' }, orderBy: { createdAt: 'desc' } });
    expect(deleteMany.mock.calls[0][0].where.userId).toBe('me');
    expect(r.unread).toBe(4);
    expect(count).toHaveBeenCalledWith({ where: { userId: 'me', readAt: null } });
  });

  it('the unread filter only returns unread rows', async () => {
    const { svc, findMany } = make();
    await svc.list('me', { skip: 0, take: 20, unreadOnly: true });
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: 'me', readAt: null });
  });

  it('marks one as read for its owner only, once', async () => {
    const { svc, updateMany } = make();
    await svc.markRead('me', 'n1');
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'n1', userId: 'me', readAt: null });
  });

  it("refuses to read someone else's notification", async () => {
    const { svc, updateMany } = make(null);
    await expect(svc.markRead('me', 'other')).rejects.toBeTruthy();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('marks everything read', async () => {
    const { svc, updateMany } = make();
    expect(await svc.markAllRead('me')).toBe(1);
    expect(updateMany.mock.calls[0][0].where).toEqual({ userId: 'me', readAt: null });
  });
});
