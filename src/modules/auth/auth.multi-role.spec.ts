import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

/** One number with several roles: password -> OTP -> choose the role. */
describe('AuthService multi-role sign-in', () => {
  const PHONE = '+919363803781';
  let user: any;
  let sentTo: string[];
  let service: AuthService;

  const make = (u: any) => {
    const config = { getOrThrow: () => 'test-secret', get: (k: string) => (k === 'JWT_EXPIRES_IN' ? '15m' : undefined) };
    const users: any = {
      findByIdentifier: async (id: string) => (id === PHONE ? u : null),
      findById: async (id: string) => (id === u.id ? u : null),
      update: async () => u,
      recordLogin: () => undefined,
    };
    const otp: any = {
      send: async (id: string) => void sentTo.push(id),
      verify: async (_id: string, code: string) => {
        if (code !== '123456') throw new Error('Invalid OTP.');
      },
    };
    const jwt = new JwtService({ secret: 'test-secret' });
    return new AuthService(users, otp, jwt, config as any, { emit: () => true } as any);
  };

  beforeEach(async () => {
    sentTo = [];
    user = {
      id: 'u1', name: 'Admin', phone: PHONE, email: null, role: 'ADMIN', additionalRoles: ['CUSTOMER', 'DRIVER'],
      password: await bcrypt.hash('DAS@3781', 4), isActive: true, isProfileCompleted: true, promotionalNotifications: true,
      createdAt: new Date(),
    };
    service = make(user);
  });

  it('lookup asks for password and OTP when the number has several roles', async () => {
    const r = await service.lookup(PHONE);
    expect(r.loginMethod).toBe('PASSWORD_AND_OTP');
    expect(r.roles.sort()).toEqual(['ADMIN', 'CUSTOMER', 'DRIVER']);
  });

  it('full flow: password, then OTP, then the chosen role', async () => {
    const start = await service.multiRoleStart(PHONE, 'DAS@3781');
    expect(sentTo).toEqual([PHONE]); // the OTP goes out only after the password was right
    const verified = await service.multiRoleVerifyOtp(start.challengeToken, '123456');
    expect(verified.roles.sort()).toEqual(['ADMIN', 'CUSTOMER', 'DRIVER']);
    const result = await service.multiRoleSelect(verified.selectionToken, 'DRIVER');
    expect(result.user.role).toBe('DRIVER');
    expect(result.tokens.accessToken).toBeTruthy();
  });

  it('a wrong password sends no OTP', async () => {
    await expect(service.multiRoleStart(PHONE, 'nope')).rejects.toBeTruthy();
    expect(sentTo).toEqual([]);
  });

  it('a wrong OTP gives no role choice', async () => {
    const start = await service.multiRoleStart(PHONE, 'DAS@3781');
    await expect(service.multiRoleVerifyOtp(start.challengeToken, '000000')).rejects.toBeTruthy();
  });

  it('the password step token cannot be used to pick a role (OTP skipped)', async () => {
    const start = await service.multiRoleStart(PHONE, 'DAS@3781');
    await expect(service.multiRoleSelect(start.challengeToken, 'ADMIN')).rejects.toBeTruthy();
  });

  it('a role the number does not have is refused', async () => {
    user.additionalRoles = ['CUSTOMER'];
    const start = await service.multiRoleStart(PHONE, 'DAS@3781');
    const verified = await service.multiRoleVerifyOtp(start.challengeToken, '123456');
    await expect(service.multiRoleSelect(verified.selectionToken, 'DRIVER')).rejects.toBeTruthy();
  });

  it('the single-step logins are closed for a multi-role number', async () => {
    await expect(service.loginWithPassword(PHONE, 'DAS@3781', 'ADMIN')).rejects.toMatchObject({
      response: expect.anything(),
    });
    await expect(service.sendCustomerOtp(PHONE)).rejects.toBeTruthy();
    await expect(service.verifyCustomerOtp(PHONE, '123456')).rejects.toBeTruthy();
  });

  it('a single-role admin still signs in with the password only', async () => {
    user.additionalRoles = [];
    const r = await service.loginWithPassword(PHONE, 'DAS@3781', 'ADMIN');
    expect(r.user.role).toBe('ADMIN');
  });

  it('switches a signed-in session to another role of the same account, and refuses a role it does not have', async () => {
    const r = await service.switchRole('u1', 'DRIVER');
    expect(r.user.role).toBe('DRIVER');
    expect((service as any).jwt.decode(r.tokens.accessToken).role).toBe('DRIVER');
    await expect(service.switchRole('u1', 'SUPERADMIN')).rejects.toThrow(/does not have that role/);
    user.isActive = false;
    await expect(service.switchRole('u1', 'DRIVER')).rejects.toThrow();
  });
});
