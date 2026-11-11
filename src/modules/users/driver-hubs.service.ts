import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api-error';
import { istToday, toDateOnly } from '../../common/utils/time';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface DriverHubAssignmentView {
  id: string;
  hubId: number;
  hubName: string;
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string; // YYYY-MM-DD, inclusive
}

export interface DriverHubInfo {
  homeHubId: number | null;
  /** The hub the driver works for today: the temporary hub while an assignment covers today, otherwise the home hub. */
  effectiveHubId: number | null;
  activeAssignment: DriverHubAssignmentView | null;
  upcomingAssignments: DriverHubAssignmentView[];
}

const asDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which hub each driver works for. The hub is derived from today's date (India time), so when a temporary
 * assignment ends the driver is simply back at the home hub - no scheduled job has to switch them.
 */
@Injectable()
export class DriverHubsService {
  constructor(private readonly prisma: PrismaService) {}

  private view(a: { id: string; hubId: number; startDate: Date; endDate: Date; hub: { name: string } }): DriverHubAssignmentView {
    return { id: a.id, hubId: a.hubId, hubName: a.hub.name, startDate: toDateOnly(a.startDate)!, endDate: toDateOnly(a.endDate)! };
  }

  /** Prisma filter: drivers working for `hubId` on `on` (default today). */
  whereWorkingFor(hubId: number, on = istToday()): Prisma.UserWhereInput {
    const day = asDate(on);
    const covers = { startDate: { lte: day }, endDate: { gte: day } };
    return {
      OR: [
        { hubAssignments: { some: { hubId, ...covers } } },
        { hubId, hubAssignments: { none: covers } },
      ],
    };
  }

  async resolve(driverIds: string[], on = istToday()): Promise<Map<string, DriverHubInfo>> {
    const out = new Map<string, DriverHubInfo>();
    if (!driverIds.length) return out;
    const day = asDate(on);
    const [drivers, assignments] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: driverIds } }, select: { id: true, hubId: true } }),
      this.prisma.driverHubAssignment.findMany({
        where: { driverId: { in: driverIds }, endDate: { gte: day } },
        include: { hub: { select: { name: true } } },
        orderBy: { startDate: 'asc' },
      }),
    ]);
    for (const d of drivers) {
      const mine = assignments.filter((a) => a.driverId === d.id);
      const active = mine.find((a) => a.startDate <= day) ?? null;
      out.set(d.id, {
        homeHubId: d.hubId,
        effectiveHubId: active ? active.hubId : d.hubId,
        activeAssignment: active ? this.view(active) : null,
        upcomingAssignments: mine.filter((a) => a.startDate > day).map((a) => this.view(a)),
      });
    }
    return out;
  }

  async effectiveHubId(driverId: string): Promise<number | null> {
    return (await this.resolve([driverId])).get(driverId)?.effectiveHubId ?? null;
  }

  async setHomeHub(driverId: string, hubId: number | null | undefined): Promise<void> {
    const driver = await this.prisma.user.findFirst({ where: { id: driverId, role: 'DRIVER' }, select: { id: true } });
    if (!driver) throw ApiException.notFound('Driver');
    if (hubId != null) await this.requireHub(hubId);
    await this.prisma.user.update({ where: { id: driverId }, data: { hubId: hubId ?? null } });
  }

  async listAssignments(driverId: string): Promise<DriverHubAssignmentView[]> {
    const rows = await this.prisma.driverHubAssignment.findMany({
      where: { driverId },
      include: { hub: { select: { name: true } } },
      orderBy: { startDate: 'desc' },
    });
    return rows.map((r) => this.view(r));
  }

  async addAssignment(driverId: string, hubId: number, startDate: string, endDate: string): Promise<DriverHubAssignmentView> {
    const driver = await this.prisma.user.findFirst({ where: { id: driverId, role: 'DRIVER' }, select: { id: true, hubId: true } });
    if (!driver) throw ApiException.notFound('Driver');
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || Number.isNaN(asDate(startDate).getTime()) || Number.isNaN(asDate(endDate).getTime())) {
      throw ApiException.badRequest('INVALID_DATE_RANGE', 'Dates must be in YYYY-MM-DD format.');
    }
    if (endDate < startDate) throw ApiException.badRequest('INVALID_DATE_RANGE', 'The end date cannot be before the start date.');
    if (endDate < istToday()) throw ApiException.badRequest('INVALID_DATE_RANGE', 'The date range is already over.');
    await this.requireHub(hubId);
    if (driver.hubId === hubId) {
      throw ApiException.badRequest('SAME_HUB', 'That is already the driver\'s own hub. Pick a different hub for the temporary move.');
    }
    const overlap = await this.prisma.driverHubAssignment.findFirst({
      where: { driverId, startDate: { lte: asDate(endDate) }, endDate: { gte: asDate(startDate) } },
    });
    if (overlap) {
      throw ApiException.conflict(
        `This overlaps an existing temporary hub (${toDateOnly(overlap.startDate)} to ${toDateOnly(overlap.endDate)}). Remove it first.`,
      );
    }
    const row = await this.prisma.driverHubAssignment.create({
      data: { driverId, hubId, startDate: asDate(startDate), endDate: asDate(endDate) },
      include: { hub: { select: { name: true } } },
    });
    return this.view(row);
  }

  async removeAssignment(driverId: string, assignmentId: string): Promise<void> {
    const res = await this.prisma.driverHubAssignment.deleteMany({ where: { id: assignmentId, driverId } });
    if (res.count === 0) throw ApiException.notFound('Hub assignment');
  }

  private async requireHub(hubId: number) {
    const hub = await this.prisma.hub.findUnique({ where: { id: hubId }, select: { id: true } });
    if (!hub) throw ApiException.notFound('Hub');
  }
}
