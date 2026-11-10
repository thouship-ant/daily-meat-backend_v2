import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

// Same normalisation as the app (daily-meat-application/src/utils/approvedAddresses.ts): keep in sync
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\u0B80-\u0BFF]+/g, ' ').trim();
export const addressKey = (street: unknown, city: unknown, pincode: unknown) =>
  `${norm(street)}|${norm(city)}|${String(pincode ?? '').replace(/\D/g, '')}`;

/** Addresses an admin confirmed are correct although the automatic address check flags them. */
@Injectable()
export class ApprovedAddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async isApproved(street: string, city: string, pincode: string): Promise<boolean> {
    try {
      const found = await this.prisma.approvedAddress.findUnique({
        where: { addressKey: addressKey(street, city, pincode) },
        select: { id: true },
      });
      return !!found;
    } catch {
      return false; // table missing (migration not run yet): fall back to the normal check
    }
  }

  async approve(input: { street: string; city: string; pincode: string; adminId?: string | null }): Promise<void> {
    const key = addressKey(input.street, input.city, input.pincode);
    await this.prisma.approvedAddress.upsert({
      where: { addressKey: key },
      update: {},
      create: {
        addressKey: key,
        street: input.street,
        city: input.city,
        pincode: String(input.pincode ?? ''),
        approvedBy: input.adminId ?? null,
      },
    });
  }

  async listKeys(): Promise<string[]> {
    try {
      return (await this.prisma.approvedAddress.findMany({ select: { addressKey: true } })).map((r) => r.addressKey);
    } catch {
      return [];
    }
  }
}
