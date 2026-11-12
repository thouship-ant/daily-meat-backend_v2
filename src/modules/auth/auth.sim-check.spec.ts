import { AuthService } from './auth.service';
import { normalizeSimNumber, simGroupOf } from './sim-group';

const A = '+919000000001';
const B = '+919000000002';
const GROUP = simGroupOf([A, B])!;
const recent = new Date();

function make(users: any[]) {
  const usersSvc: any = { findByPhones: async (phones: string[]) => users.filter((u) => phones.includes(u.phone)) };
  return new AuthService(usersSvc, null as any, null as any, { get: () => undefined } as any, null as any);
}
const user = (phone: string, over: any = {}) => ({ phone, role: 'CUSTOMER', additionalRoles: [], isActive: true, refreshToken: 'r', simGroup: GROUP, lastActiveAt: recent, lastLoginAt: recent, ...over });

describe('sim group', () => {
  it('is the same whatever the order or format of the numbers, and needs two numbers', () => {
    expect(simGroupOf([A, B])).toBe(simGroupOf(['9000000002', '+91 90000-00001']));
    expect(simGroupOf([A])).toBeNull();
    expect(simGroupOf([A, A])).toBeNull(); // the same number twice is one number
    expect(normalizeSimNumber('abc')).toBeNull();
  });
});

describe('AuthService.simCheck', () => {
  it('says which numbers have an account', async () => {
    const r = await make([user(A, { simGroup: null, refreshToken: null })]).simCheck([A, B]);
    expect(r).toEqual([
      { phone: A, exists: true, loggedInHere: false },
      { phone: B, exists: false, loggedInHere: false },
    ]);
  });

  it('a number already signed in on this phone (another instance) is flagged', async () => {
    const r = await make([user(A)]).simCheck([A, B]);
    expect(r.find((x) => x.phone === A)!.loggedInHere).toBe(true);
    expect(r.find((x) => x.phone === B)!.loggedInHere).toBe(false);
  });

  it('not flagged after logout, on another phone, or when not used for a long time', async () => {
    expect((await make([user(A, { refreshToken: null })]).simCheck([A, B]))[0].loggedInHere).toBe(false); // logged out
    expect((await make([user(A, { simGroup: simGroupOf(['+919111111111', '+919222222222']) })]).simCheck([A, B]))[0].loggedInHere).toBe(false); // another phone
    const old = new Date(Date.now() - 30 * 86_400_000);
    expect((await make([user(A, { lastActiveAt: old, lastLoginAt: old })]).simCheck([A, B]))[0].loggedInHere).toBe(false); // abandoned
  });

  it('with one number there is no "same phone" to compare: never flagged', async () => {
    expect((await make([user(A)]).simCheck([A]))[0].loggedInHere).toBe(false);
  });
});
