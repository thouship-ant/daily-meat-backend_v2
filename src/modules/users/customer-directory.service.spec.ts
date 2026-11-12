import { CustomerDirectoryService } from './customer-directory.service';

const user = (over: any) => ({
  id: 'u', name: 'X', phone: '+919000000001', email: null, isActive: true, createdAt: new Date('2026-11-10T10:00:00Z'),
  signupLocation: null, signupPincode: null, signupLatitude: null, signupLongitude: null, _count: { orders: 0 }, addresses: [], ...over,
});
const addr = (over: any) => ({ title: 'Home', street: '60 Wireless Road', city: 'Tiruchirappalli', pincode: '620005', createdAt: new Date('2026-11-01'), ...over });

function make(users: any[]) {
  const prisma: any = { user: { findMany: async () => users, count: async () => users.length } };
  return new CustomerDirectoryService(prisma);
}

describe('CustomerDirectoryService', () => {
  it('uses the delivery address pincode when the customer has one', async () => {
    const [row] = await make([user({ addresses: [addr({})], signupPincode: '600001', signupLocation: 'Chennai' })]).findAll({});
    expect(row.area).toMatchObject({ pincode: '620005', pincodeSource: 'ADDRESS', city: 'Tiruchirappalli' });
  });

  it('falls back to the first-login location pincode when there is no address', async () => {
    const [row] = await make([user({ signupPincode: '620005', signupLocation: 'Crawford, Tamil Nadu' })]).findAll({});
    expect(row.area).toMatchObject({ pincode: '620005', pincodeSource: 'FIRST_LOGIN', city: 'Crawford' });
  });

  it('prefers the Home address, and the address that matched the pincode filter', async () => {
    const u = user({ addresses: [addr({ title: 'Work', pincode: '620010' }), addr({ title: 'Home', pincode: '620005', createdAt: new Date('2026-11-02') })] });
    expect((await make([u]).findAll({}))[0].area.pincode).toBe('620005');
    expect((await make([u]).findAll({ pincodeFrom: '620010', pincodeTo: '620010' }))[0].area.pincode).toBe('620010');
  });

  it('matches a pincode range on the address OR (no address) the first-login pincode', () => {
    const where: any = make([]).buildWhere({ pincodeFrom: '620005', pincodeTo: '620005' });
    const or = where.AND.find((c: any) => c.OR && c.OR[0]?.addresses?.some);
    expect(or.OR[0].addresses.some.pincode).toEqual({ gte: '620005', lte: '620005' });
    expect(or.OR[1]).toMatchObject({ addresses: { none: {} }, signupPincode: { gte: '620005', lte: '620005' } });
  });

  it('sorts by pincode with customers without an area last', async () => {
    const rows = await make([
      user({ id: 'a' }),
      user({ id: 'b', addresses: [addr({ pincode: '620010' })] }),
      user({ id: 'c', addresses: [addr({ pincode: '620001' })] }),
    ]).findAll({}, 'pincode', 'asc');
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('lists only the deleted accounts when asked, and leaves them out of every other list', () => {
    const normal: any = make([]).buildWhere({});
    expect(JSON.stringify(normal)).toContain('"not":{"startsWith":"del_"}');
    const deleted: any = make([]).buildWhere({ deleted: true, isActive: true });
    const text = JSON.stringify(deleted);
    expect(text).toContain('"phone":{"startsWith":"del_"}');
    expect(text).not.toContain('"isActive"'); // a deleted account is always inactive: that filter is ignored
  });
});
