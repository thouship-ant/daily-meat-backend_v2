import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DriverOnboardingStatus, DriverProfile, Prisma } from '@prisma/client';
import { ApiException, ErrorCode } from '../../common/api-error';
import { CashfreeGateway } from '../../infrastructure/payments/cashfree.gateway';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DigiLockerService } from './digilocker.service';
import { isValidAadhaar, isValidVehicleYear, normalizeRegNo } from './validators';

export type DocumentKind = 'aadhaar_front' | 'aadhaar_back' | 'selfie';
const DEAD_GATEWAY_STATES = ['EXPIRED', 'TERMINATED', 'TERMINATION_REQUESTED'];
/** the driver may change their details only while the application is not with an admin / already approved */
const EDITABLE: DriverOnboardingStatus[] = ['DRAFT', 'REJECTED'];

type ProfileWithHub = DriverProfile & { hub?: { id: number; name: string } | null };

/**
 * New driver onboarding: Aadhaar KYC (DigiLocker when configured, otherwise photos an admin checks), the hub the driver
 * will work for, a selfie, vehicle details and the starting deposit for the T-shirt and basket; then an admin approves.
 * A driver with no profile row is from before onboarding existed and counts as approved.
 */
@Injectable()
export class DriverOnboardingService {
  private readonly logger = new Logger(DriverOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: CashfreeGateway,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly digilocker: DigiLockerService,
  ) {}

  // ---------- the deposit offer ----------

  /** Rs. 2000 struck out, Rs. 1500 charged, with the percentage off. */
  offer() {
    const listPrice = Number(this.config.get('DRIVER_DEPOSIT_LIST_PRICE') ?? 2000);
    const price = Math.min(listPrice, Number(this.config.get('DRIVER_DEPOSIT_PRICE') ?? 1500));
    const discountPercent = listPrice > 0 ? Math.round(((listPrice - price) / listPrice) * 100) : 0;
    return { listPrice, price, discountPercent, label: 'Limited offer', covers: 'T-shirt and delivery basket' };
  }

  // ---------- driver ----------

  async ensureDraft(userId: string): Promise<DriverProfile> {
    return this.prisma.driverProfile.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  private async mine(userId: string): Promise<ProfileWithHub | null> {
    return this.prisma.driverProfile.findUnique({ where: { userId }, include: { hub: { select: { id: true, name: true } } } });
  }

  private async mustEdit(userId: string): Promise<DriverProfile> {
    const p = await this.mine(userId);
    if (!p) throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Onboarding is not required for this account.');
    if (!EDITABLE.includes(p.status)) {
      throw ApiException.badRequest(
        ErrorCode.VALIDATION_FAILED,
        p.status === 'APPROVED' ? 'Your application is already approved.' : 'Your application is with the admin; it cannot be changed now.',
      );
    }
    return p;
  }

  steps(p: DriverProfile) {
    return {
      kyc: !!(p.kycVerifiedAt && p.kycMethod === 'DIGILOCKER') || !!(p.aadhaarLast4 && p.aadhaarFrontKey && p.aadhaarBackKey),
      hub: p.hubId != null,
      selfie: !!p.selfieKey,
      vehicle: !!(p.vehicleModel && p.vehicleRegNo && p.vehicleYear),
      deposit: p.depositPaid,
    };
  }

  async state(userId: string) {
    const p = await this.mine(userId);
    if (!p) return { required: false, status: 'APPROVED' as const, legacy: true };
    const hubs = await this.prisma.hub.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, select: { id: true, name: true } });
    const steps = this.steps(p);
    return {
      required: p.status !== 'APPROVED',
      legacy: false,
      status: p.status,
      steps,
      canSubmit: Object.values(steps).every(Boolean) && EDITABLE.includes(p.status),
      editable: EDITABLE.includes(p.status),
      kyc: { method: p.kycMethod, aadhaarLast4: p.aadhaarLast4, name: p.aadhaarName, verified: !!p.kycVerifiedAt },
      digilocker: { enabled: this.digilocker.enabled },
      hub: p.hub ?? null,
      hubs,
      hasSelfie: !!p.selfieKey,
      vehicle: { model: p.vehicleModel, regNo: p.vehicleRegNo, year: p.vehicleYear },
      deposit: { paid: p.depositPaid, amount: p.depositPaid ? p.depositAmount : this.offer().price, offer: this.offer() },
      rejectReason: p.status === 'REJECTED' ? p.rejectReason : null,
      submittedAt: p.submittedAt,
    };
  }

  async saveKyc(
    userId: string,
    input: { aadhaarNumber: string; name: string },
    front?: Express.Multer.File,
    back?: Express.Multer.File,
  ) {
    const p = await this.mustEdit(userId);
    if (!isValidAadhaar(input.aadhaarNumber)) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Enter a valid 12-digit Aadhaar number.');
    }
    const name = input.name.trim();
    if (name.length < 2) throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Enter your name as it is on the Aadhaar card.');
    if ((!front && !p.aadhaarFrontKey) || (!back && !p.aadhaarBackKey)) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Upload both sides of the Aadhaar card.');
    }
    const data: Prisma.DriverProfileUpdateInput = {
      // only the last 4 digits are kept: the full Aadhaar number is never stored
      aadhaarLast4: input.aadhaarNumber.replace(/\D/g, '').slice(-4),
      aadhaarName: name,
      kycMethod: 'MANUAL',
      kycVerifiedAt: null,
    };
    if (front) data.aadhaarFrontKey = await this.storage.uploadPrivate(front, 'aadhaar');
    if (back) data.aadhaarBackKey = await this.storage.uploadPrivate(back, 'aadhaar');
    await this.prisma.driverProfile.update({ where: { userId }, data });
    return this.state(userId);
  }

  async chooseHub(userId: string, hubId: number) {
    await this.mustEdit(userId);
    const hub = await this.prisma.hub.findFirst({ where: { id: hubId, isActive: true }, select: { id: true } });
    if (!hub) throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Choose one of the available cities / hubs.');
    await this.prisma.driverProfile.update({ where: { userId }, data: { hub: { connect: { id: hubId } } } });
    return this.state(userId);
  }

  async saveSelfie(userId: string, file?: Express.Multer.File) {
    await this.mustEdit(userId);
    if (!file) throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Take a selfie to continue.');
    const key = await this.storage.uploadPrivate(file, 'selfie');
    await this.prisma.driverProfile.update({ where: { userId }, data: { selfieKey: key } });
    return this.state(userId);
  }

  async saveVehicle(userId: string, dto: { model: string; regNo: string; year: number }) {
    await this.mustEdit(userId);
    const model = dto.model.trim();
    if (model.length < 2) throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Enter the vehicle model.');
    const regNo = normalizeRegNo(dto.regNo);
    if (!regNo) throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Enter a valid registration number, for example TN45AB1234.');
    if (!isValidVehicleYear(Number(dto.year))) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Enter a valid year of manufacture.');
    }
    await this.prisma.driverProfile.update({ where: { userId }, data: { vehicleModel: model, vehicleRegNo: regNo, vehicleYear: Number(dto.year) } });
    return this.state(userId);
  }

  // ---------- the starting deposit ----------

  /** Opens (or reuses) a payment session for the deposit. Returns what the app's payment sheet needs. */
  async startDeposit(userId: string) {
    const p = await this.mustEdit(userId);
    if (p.depositPaid) return { paid: true as const };
    const amount = this.offer().price;

    // an earlier session that is still open can be reused; a dead one is replaced
    if (p.depositGatewayId && p.depositSessionId && p.depositCfOrderId) {
      const status = await this.gateway.getOrderStatus(p.depositGatewayId).catch(() => 'UNKNOWN');
      if (status === 'PAID') {
        await this.markDepositPaid(p.depositGatewayId);
        return { paid: true as const };
      }
      if (status === 'ACTIVE' && p.depositAmount === amount) {
        return { paid: false as const, sessionId: p.depositSessionId, gatewayOrderId: p.depositCfOrderId, environment: this.gateway.environment, amount };
      }
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, phone: true } });
    const gatewayId = `DEP_${p.id.slice(0, 8)}_${Date.now().toString(36)}`;
    const gw = await this.gateway.createOrder({ id: gatewayId, amount }, user);
    await this.prisma.driverProfile.update({
      where: { userId },
      data: { depositAmount: amount, depositGatewayId: gatewayId, depositCfOrderId: gw.cfOrderId, depositSessionId: gw.paymentSessionId },
    });
    return { paid: false as const, sessionId: gw.paymentSessionId, gatewayOrderId: gw.cfOrderId, environment: this.gateway.environment, amount };
  }

  /** The app calls this after the payment sheet closes; the gateway, not the app, decides. */
  async verifyDeposit(userId: string) {
    const p = await this.mine(userId);
    if (!p) throw ApiException.notFound('Application');
    if (p.depositPaid) return { paid: true, status: 'PAID' };
    if (!p.depositGatewayId) return { paid: false, status: 'NOT_STARTED' };
    return this.reconcileDeposit(p.depositGatewayId);
  }

  /** Also used by the payment webhook (ids starting with DEP_). */
  async reconcileDeposit(gatewayId: string): Promise<{ paid: boolean; status: string }> {
    const status = await this.gateway.getOrderStatus(gatewayId);
    if (status === 'PAID') {
      await this.markDepositPaid(gatewayId);
      return { paid: true, status: 'PAID' };
    }
    return { paid: false, status: DEAD_GATEWAY_STATES.includes(status) ? 'FAILED' : 'PENDING' };
  }

  private async markDepositPaid(gatewayId: string): Promise<boolean> {
    const res = await this.prisma.driverProfile.updateMany({
      where: { depositGatewayId: gatewayId, depositPaid: false },
      data: { depositPaid: true, depositPaidAt: new Date() },
    });
    return res.count > 0;
  }

  isDepositGatewayId(id: string) {
    return id.startsWith('DEP_');
  }

  // ---------- submit ----------

  async submit(userId: string) {
    const p = await this.mustEdit(userId);
    const missing = Object.entries(this.steps(p)).filter(([, done]) => !done).map(([k]) => k);
    if (missing.length) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, `Please complete: ${missing.join(', ')}.`, { missing });
    }
    await this.prisma.driverProfile.update({
      where: { userId },
      data: { status: 'PENDING_APPROVAL', submittedAt: new Date(), reviewedAt: null, reviewedById: null, rejectReason: null },
    });
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, phone: true } });
    void this.notifications.toHubAdmins(p.hubId, {
      title: 'New driver application',
      body: `${user?.name || user?.phone || 'A new driver'} has completed KYC and paid the deposit. Review and approve.`,
      data: { type: 'DRIVER_APPLICATION', userId },
      event: 'driverApplication',
    });
    return this.state(userId);
  }

  // ---------- admin ----------

  async adminList(opts: { status?: DriverOnboardingStatus; hubId?: number | null; skip: number; take: number }) {
    const where: Prisma.DriverProfileWhereInput = {
      ...(opts.status ? { status: opts.status } : { status: { not: 'DRAFT' as const } }),
      ...(opts.hubId != null ? { hubId: opts.hubId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.driverProfile.findMany({
        where,
        include: { user: { select: { id: true, name: true, phone: true } }, hub: { select: { id: true, name: true } } },
        orderBy: [{ submittedAt: 'asc' }],
        skip: opts.skip,
        take: opts.take,
      }),
      this.prisma.driverProfile.count({ where }),
    ]);
    return { items: rows.map((r) => this.adminView(r)), total };
  }

  async adminDetail(userId: string) {
    const p = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { user: { select: { id: true, name: true, phone: true, email: true } }, hub: { select: { id: true, name: true } } },
    });
    if (!p) throw ApiException.notFound('Application');
    return this.adminView(p);
  }

  private adminView(p: DriverProfile & { user: { id: string; name: string | null; phone: string | null; email?: string | null }; hub: { id: number; name: string } | null }) {
    return {
      userId: p.userId,
      name: p.user.name,
      phone: p.user.phone,
      status: p.status,
      submittedAt: p.submittedAt,
      reviewedAt: p.reviewedAt,
      rejectReason: p.rejectReason,
      hub: p.hub,
      kyc: { method: p.kycMethod, aadhaarLast4: p.aadhaarLast4, nameOnCard: p.aadhaarName, verified: !!p.kycVerifiedAt },
      vehicle: { model: p.vehicleModel, regNo: p.vehicleRegNo, year: p.vehicleYear },
      deposit: { paid: p.depositPaid, amount: p.depositAmount, paidAt: p.depositPaidAt, reference: p.depositGatewayId },
      documents: { aadhaarFront: !!p.aadhaarFrontKey, aadhaarBack: !!p.aadhaarBackKey, selfie: !!p.selfieKey },
    };
  }

  /** The photo itself, read through the API (the storage has no public URL for it). */
  async document(userId: string, kind: DocumentKind) {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId } });
    const key = p && (kind === 'aadhaar_front' ? p.aadhaarFrontKey : kind === 'aadhaar_back' ? p.aadhaarBackKey : p.selfieKey);
    if (!key) throw ApiException.notFound('Document');
    return this.storage.getPrivate(key);
  }

  async approve(userId: string, adminId: string) {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!p) throw ApiException.notFound('Application');
    if (p.status !== 'PENDING_APPROVAL') {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Only an application that was submitted can be approved.');
    }
    await this.prisma.$transaction([
      this.prisma.driverProfile.update({ where: { userId }, data: { status: 'APPROVED', reviewedAt: new Date(), reviewedById: adminId, rejectReason: null } }),
      // the hub the driver chose becomes their home hub; the account can now take orders
      this.prisma.user.update({ where: { id: userId }, data: { isActive: true, ...(p.hubId != null ? { hub: { connect: { id: p.hubId } } } : {}) } }),
    ]);
    void this.notifications.toUser(userId, {
      title: 'You are approved',
      body: 'Your driver application is approved. You can start taking deliveries.',
      data: { type: 'DRIVER_APPROVED' },
      event: 'driverApproved',
    });
    return this.adminDetail(userId);
  }

  async reject(userId: string, adminId: string, reason: string) {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!p) throw ApiException.notFound('Application');
    if (p.status !== 'PENDING_APPROVAL') {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Only an application that was submitted can be rejected.');
    }
    await this.prisma.driverProfile.update({
      where: { userId },
      data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: adminId, rejectReason: reason.trim() },
    });
    void this.notifications.toUser(userId, {
      title: 'Application needs changes',
      body: reason.trim(),
      data: { type: 'DRIVER_REJECTED' },
      event: 'driverRejected',
    });
    return this.adminDetail(userId);
  }

  /** True when this driver may take orders (approved, or a driver from before onboarding existed). */
  async canTakeOrders(driverId: string): Promise<boolean> {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId: driverId }, select: { status: true } });
    return !p || p.status === 'APPROVED';
  }
}
