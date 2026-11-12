jest.mock('expo-server-sdk', () => ({ Expo: class {} })); // ESM-only package pulled in by the notifications module

import { DriverOnboardingService } from './driver-onboarding.service';
import { isValidAadhaar, isValidVehicleYear, normalizeRegNo } from './validators';

describe('validators', () => {
  it('Aadhaar: checks the length, the first digit and the Verhoeff check digit', () => {
    expect(isValidAadhaar('234123412346')).toBe(true);
    expect(isValidAadhaar('2341 2341 2346')).toBe(true); // spaces as printed on the card
    expect(isValidAadhaar('234123412347')).toBe(false); // wrong check digit
    expect(isValidAadhaar('123412341234')).toBe(false); // cannot start with 1
    expect(isValidAadhaar('2341234123')).toBe(false); // too short
  });

  it('registration numbers: upper-cased, spaces and dashes ignored', () => {
    expect(normalizeRegNo('tn 45 ab 1234')).toBe('TN45AB1234');
    expect(normalizeRegNo('TN-45-A-1234')).toBe('TN45A1234');
    expect(normalizeRegNo('1234')).toBeNull();
    expect(normalizeRegNo('TN45AB12')).toBeNull();
  });

  it('year of manufacture: 1990 up to next year', () => {
    const now = new Date('2026-11-14');
    expect(isValidVehicleYear(2021, now)).toBe(true);
    expect(isValidVehicleYear(2027, now)).toBe(true);
    expect(isValidVehicleYear(2028, now)).toBe(false);
    expect(isValidVehicleYear(1985, now)).toBe(false);
  });
});

/** In-memory single profile standing in for the table. */
function make(initial: any | null = { id: 'p1aaaaaa-0000', userId: 'd1', status: 'DRAFT', depositPaid: false, depositAmount: 0 }) {
  let row: any = initial && { hubId: null, ...initial };
  const uploads: string[] = [];
  const notices: any[] = [];
  const prisma: any = {
    driverProfile: {
      findUnique: async () => (row ? { ...row, user: { id: 'd1', name: 'Ravi', phone: '+919000000001', email: null }, hub: row.hubId ? { id: row.hubId, name: 'Trichy' } : null } : null),
      update: async ({ data }: any) => {
        const d: any = { ...data };
        if (d.hub?.connect) { d.hubId = d.hub.connect.id; delete d.hub; }
        Object.assign(row, d);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        if (row && row.depositGatewayId === where.depositGatewayId && row.depositPaid === where.depositPaid) { Object.assign(row, data); return { count: 1 }; }
        return { count: 0 };
      },
    },
    hub: { findMany: async () => [{ id: 1, name: 'Trichy' }], findFirst: async ({ where }: any) => (where.id === 1 ? { id: 1 } : null) },
    user: { findUnique: async () => ({ name: 'Ravi', phone: '+919000000001' }), update: async () => ({}), findUniqueOrThrow: async () => ({ id: 'd1', name: 'Ravi', email: null, phone: '+919000000001' }) },
    $transaction: async (ops: any[]) => Promise.all(ops),
  };
  const storage: any = { uploadPrivate: async (_f: any, folder: string) => { uploads.push(folder); return `kyc/${folder}/x.jpg`; } };
  const gateway: any = { environment: 'SANDBOX', getOrderStatus: async () => 'PAID', createOrder: async () => ({ cfOrderId: 'cf1', paymentSessionId: 'sess1' }) };
  const config: any = { get: () => undefined };
  const notifications: any = { toHubAdmins: async (_h: any, n: any) => notices.push(['hub', n]), toUser: async (_u: any, n: any) => notices.push(['user', n]) };
  const digilocker: any = { enabled: false };
  return { svc: new DriverOnboardingService(prisma, storage, gateway, config, notifications, digilocker), get row() { return row; }, uploads, notices };
}
const file: any = { mimetype: 'image/jpeg', originalname: 'a.jpg', buffer: Buffer.from('x') };

describe('DriverOnboardingService', () => {
  it('shows the deposit offer: Rs. 2000 struck out, Rs. 1500 charged, 25% off', () => {
    expect(make().svc.offer()).toMatchObject({ listPrice: 2000, price: 1500, discountPercent: 25 });
  });

  it('a driver with no profile is an old driver: nothing to do, and can take orders', async () => {
    const m = make(null);
    expect(await m.svc.state('d1')).toMatchObject({ required: false, legacy: true, status: 'APPROVED' });
    expect(await m.svc.canTakeOrders('d1')).toBe(true);
  });

  it('keeps only the last 4 Aadhaar digits, and stores the photos privately', async () => {
    const m = make();
    await m.svc.saveKyc('d1', { aadhaarNumber: '2341 2341 2346', name: 'Ravi Kumar' }, file, file);
    expect(m.row.aadhaarLast4).toBe('2346');
    expect(JSON.stringify(m.row)).not.toContain('234123412346'); // the full number is never stored
    expect(m.uploads).toEqual(['aadhaar', 'aadhaar']);
    await expect(m.svc.saveKyc('d1', { aadhaarNumber: '234123412347', name: 'Ravi' }, file, file)).rejects.toThrow(/valid 12-digit/);
  });

  it('cannot be submitted until every step is done, then goes to the admin and tells the hub', async () => {
    const m = make();
    await expect(m.svc.submit('d1')).rejects.toThrow(/Please complete/);
    await m.svc.saveKyc('d1', { aadhaarNumber: '234123412346', name: 'Ravi' }, file, file);
    await m.svc.chooseHub('d1', 1);
    await m.svc.saveSelfie('d1', file);
    await m.svc.saveVehicle('d1', { model: 'Activa', regNo: 'tn45ab1234', year: 2021 });
    expect(m.row.vehicleRegNo).toBe('TN45AB1234');
    await expect(m.svc.submit('d1')).rejects.toThrow(/deposit/); // the deposit is still unpaid

    const start = await m.svc.startDeposit('d1');
    expect(start).toMatchObject({ paid: false, amount: 1500, sessionId: 'sess1' });
    expect(await m.svc.verifyDeposit('d1')).toMatchObject({ paid: true });
    const after = await m.svc.submit('d1');
    expect(after.status).toBe('PENDING_APPROVAL');
    expect(m.notices.some(([to, n]) => to === 'hub' && /application/i.test(n.title))).toBe(true);
    // with the admin: no more changes
    await expect(m.svc.saveSelfie('d1', file)).rejects.toThrow(/admin/);
  });

  it('only an approved driver takes orders; reject sends it back with the reason, approve activates', async () => {
    const m = make({ id: 'p1aaaaaa-0000', userId: 'd1', status: 'PENDING_APPROVAL', hubId: 1 });
    expect(await m.svc.canTakeOrders('d1')).toBe(false);
    await m.svc.reject('d1', 'admin1', 'Selfie is blurry');
    expect(m.row.status).toBe('REJECTED');
    expect(m.notices.some(([to, n]) => to === 'user' && n.body === 'Selfie is blurry')).toBe(true);
    m.row.status = 'PENDING_APPROVAL';
    await m.svc.approve('d1', 'admin1');
    expect(m.row.status).toBe('APPROVED');
    expect(await m.svc.canTakeOrders('d1')).toBe(true);
  });
});
