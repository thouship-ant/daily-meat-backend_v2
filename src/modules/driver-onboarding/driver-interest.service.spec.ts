// the real notifications service pulls in an ES-module-only push library that Jest cannot load
jest.mock('../notifications/notifications.service', () => ({ NotificationsService: class {} }));

import { DriverInterestService } from './driver-interest.service';

const input = { name: 'Ravi', phone: '+919876543210', email: 'ravi@example.com', hubId: 1, locality: 'Gandhipuram', city: 'Coimbatore', pincode: '641012' };

function make(opts: { user?: any; hub?: any } = {}) {
  const upsert = jest.fn().mockResolvedValue({});
  const count = jest.fn().mockResolvedValue(3);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const toHubAdmins = jest.fn().mockResolvedValue(undefined);
  const prisma: any = {
    user: { findFirst: jest.fn().mockResolvedValue(opts.user ?? null) },
    hub: { findFirst: jest.fn().mockResolvedValue('hub' in opts ? opts.hub : { id: 1 }) },
    driverInterest: { upsert, count, updateMany },
  };
  const hubs: any = {
    listActive: jest.fn().mockResolvedValue([
      { id: 1, name: 'Tiruchirappalli Hub', latitude: 10.75, longitude: 78.7, deliverablePincodes: ['620001', '620002'], deliveryRadiusKm: 10, storeStartTime: '06:00 AM', storeCloseTime: '01:00 PM', deliveryFeeAmount: 70 },
    ]),
  };
  const notifications: any = { toHubAdmins };
  return { service: new DriverInterestService(prisma, hubs, notifications), upsert, count, updateMany, toHubAdmins };
}

describe('DriverInterestService', () => {
  it('lists hubs with their service area and hours, but nothing private', async () => {
    expect(await make().service.hubChoices()).toEqual([
      { id: 1, name: 'Tiruchirappalli Hub', pincodes: ['620001', '620002'], deliveryRadiusKm: 10, storeStartTime: '06:00 AM', storeCloseTime: '01:00 PM' },
    ]);
  });

  it('saves a request, one per mobile number', async () => {
    const { service, upsert } = make();
    await service.submit(input);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].where).toEqual({ phone: input.phone });
    expect(upsert.mock.calls[0][0].create).toMatchObject({ phone: input.phone, hubId: 1, pincode: '641012' });
  });

  it('refuses a number that is already a delivery partner', async () => {
    const { service, upsert } = make({ user: { role: 'CUSTOMER', additionalRoles: ['DRIVER'] } });
    await expect(service.submit(input)).rejects.toBeTruthy();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a hub that does not exist or is inactive', async () => {
    const { service, upsert } = make({ hub: null });
    await expect(service.submit(input)).rejects.toBeTruthy();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('works without a hub', async () => {
    const { service, upsert } = make();
    await service.submit({ ...input, hubId: undefined });
    expect(upsert.mock.calls[0][0].create.hubId).toBeNull();
  });

  it('asking again makes the request unread and not contacted again', async () => {
    const { service, upsert } = make();
    await service.submit(input);
    expect(upsert.mock.calls[0][0].update).toMatchObject({ seenAt: null, notifiedAt: null });
  });

  it('tells the hub admins about a new request', async () => {
    const { service, toHubAdmins } = make();
    await service.submit(input);
    expect(toHubAdmins).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ title: 'New delivery partner interest', data: expect.objectContaining({ route: 'driver_applications' }) }),
    );
  });

  it('counts only unread requests, for one hub when asked', async () => {
    const { service, count } = make();
    expect(await service.unreadCount(1)).toBe(3);
    expect(count).toHaveBeenCalledWith({ where: { seenAt: null, hubId: 1 } });
    await service.unreadCount();
    expect(count).toHaveBeenLastCalledWith({ where: { seenAt: null } });
  });

  it('marks a request as read only the first time it is opened', async () => {
    const { service, updateMany } = make();
    await service.markSeen('abc');
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'abc', seenAt: null });
  });

  it('says whether a mobile number already registered its interest', async () => {
    const { service, count } = make();
    count.mockResolvedValueOnce(1);
    expect(await service.isRegistered(input.phone)).toBe(true);
    expect(count).toHaveBeenCalledWith({ where: { phone: input.phone } });
    count.mockResolvedValueOnce(0);
    expect(await service.isRegistered('+919111111111')).toBe(false);
  });
});
