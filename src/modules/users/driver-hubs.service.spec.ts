import { DriverHubsService } from './driver-hubs.service';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

function make(homeHubId: number | null, assignments: Array<{ id: string; hubId: number; start: string; end: string }>) {
  const prisma: any = {
    user: { findMany: async () => [{ id: 'd1', hubId: homeHubId }] },
    driverHubAssignment: {
      findMany: async ({ where }: any) =>
        assignments
          .filter((a) => day(a.end) >= where.endDate.gte)
          .map((a) => ({ id: a.id, driverId: 'd1', hubId: a.hubId, startDate: day(a.start), endDate: day(a.end), hub: { name: `Hub ${a.hubId}` } })),
    },
  };
  return new DriverHubsService(prisma);
}

describe('DriverHubsService.resolve', () => {
  const lent = [{ id: 'a1', hubId: 2, start: '2026-11-15', end: '2026-11-20' }];

  it('uses the home hub before the temporary move starts', async () => {
    const info = (await make(1, lent).resolve(['d1'], '2026-11-14')).get('d1')!;
    expect(info.effectiveHubId).toBe(1);
    expect(info.activeAssignment).toBeNull();
    expect(info.upcomingAssignments).toHaveLength(1);
  });

  it('uses the other hub on both the first and the last day', async () => {
    for (const on of ['2026-11-15', '2026-11-18', '2026-11-20']) {
      const info = (await make(1, lent).resolve(['d1'], on)).get('d1')!;
      expect(info.effectiveHubId).toBe(2);
      expect(info.activeAssignment?.hubName).toBe('Hub 2');
    }
  });

  it('is back at the home hub the day after the end date, with nothing to run', async () => {
    const info = (await make(1, lent).resolve(['d1'], '2026-11-21')).get('d1')!;
    expect(info.effectiveHubId).toBe(1);
    expect(info.activeAssignment).toBeNull();
  });

  it('has no hub when none is set and no move is active', async () => {
    expect((await make(null, []).resolve(['d1'], '2026-11-18')).get('d1')!.effectiveHubId).toBeNull();
  });
});
