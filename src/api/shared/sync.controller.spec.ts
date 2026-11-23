import { SYNC_RESOURCES, SyncController } from './sync.controller';

describe('SyncController.versions', () => {
  const make = () => {
    const queries: string[] = [];
    const prisma: any = {
      $queryRawUnsafe: async (sql: string) => {
        queries.push(sql);
        return [{ h: `hash-${queries.length}` }];
      },
    };
    const store = new Map<string, any>();
    const cache: any = {
      wrap: async (k: string, _t: number, f: () => Promise<any>) => {
        if (store.has(k)) return store.get(k);
        const v = await f();
        store.set(k, v);
        return v;
      },
    };
    return { controller: new SyncController(prisma, cache), queries };
  };

  it('gives one fingerprint per kind of master data', async () => {
    const { controller, queries } = make();
    const out = await controller.versions();
    expect(Object.keys(out).sort()).toEqual(Object.keys(SYNC_RESOURCES).sort());
    expect(queries).toHaveLength(Object.keys(SYNC_RESOURCES).length);
    expect(Object.keys(out)).toEqual(expect.arrayContaining(['slots', 'catalog', 'drivers', 'driverApplications', 'customers']));
  });

  it('asks the database once for many phones (the answer is cached for a few seconds)', async () => {
    const { controller, queries } = make();
    await controller.versions();
    await controller.versions();
    await controller.versions();
    expect(queries).toHaveLength(Object.keys(SYNC_RESOURCES).length);
  });

  it('never uses a changing "last active" column, which would make the customer / driver fingerprints change constantly', () => {
    expect(SYNC_RESOURCES.customers).not.toMatch(/updatedAt|last_active|lastActive/);
    expect(SYNC_RESOURCES.drivers).not.toMatch(/"updatedAt"|last_active|lastActive/);
  });
});
