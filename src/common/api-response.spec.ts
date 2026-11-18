import { Paginated } from './api-response';

describe('Paginated', () => {
  it('carries the unread number in meta (notification inbox) so the response wrapper keeps the list as the data', () => {
    const p = new Paginated([{ id: 1 }], 1, 1, 30, { unread: 6 });
    expect(p).toBeInstanceOf(Paginated);
    expect(p.items).toEqual([{ id: 1 }]);
    expect(p.meta).toMatchObject({ page: 1, limit: 30, total: 1, unread: 6 });
  });
});
