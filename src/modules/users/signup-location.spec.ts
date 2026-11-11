import { UsersService } from './users.service';

function make(row: any) {
  const updates: any[] = [];
  const prisma: any = {
    user: {
      findUnique: async () => row,
      update: async (arg: any) => { updates.push(arg.data); },
    },
  };
  return { svc: new UsersService(prisma, null as any, null as any), updates };
}

describe('UsersService.setSignupLocationOnce', () => {
  it('logs the first location (name, coordinates, pincode) when none exists', async () => {
    const { svc, updates } = make({ signupLocation: null, signupLatitude: null, signupPincode: null });
    await svc.setSignupLocationOnce('u1', 'Crawford, Tamil Nadu', 10.8, 78.7, '620005');
    expect(updates).toEqual([{ signupLocation: 'Crawford, Tamil Nadu', signupPincode: '620005', signupLatitude: 10.8, signupLongitude: 78.7 }]);
  });

  it('ignores the call when the coordinates are already logged', async () => {
    const { svc, updates } = make({ signupLocation: 'Old place', signupLatitude: 11, signupPincode: '620001' });
    await svc.setSignupLocationOnce('u1', 'New place', 10.8, 78.7, '620005');
    expect(updates).toEqual([]);
  });

  it('fills in only the coordinates for a customer who has a place name but no coordinates', async () => {
    const { svc, updates } = make({ signupLocation: 'Crawford', signupLatitude: null, signupPincode: null });
    await svc.setSignupLocationOnce('u1', 'Somewhere else', 10.8, 78.7);
    expect(updates).toEqual([{ signupLatitude: 10.8, signupLongitude: 78.7 }]);
  });

  it('ignores a name-only call when a name is already stored', async () => {
    const { svc, updates } = make({ signupLocation: 'Crawford', signupLatitude: null, signupPincode: null });
    await svc.setSignupLocationOnce('u1', 'Other');
    expect(updates).toEqual([]);
  });
});
