import { HubsService, HubView } from './hubs.service';

const hub = (over: Partial<HubView> = {}): HubView =>
  ({
    id: 1,
    latitude: 13.0827,
    longitude: 80.2707,
    deliverablePincodes: [],
    distanceTiers: [],
    minOrderForFreeDelivery: 500,
    deliveryFeeAmount: 40,
    freeDeliveryDistanceKm: 5,
    distanceDeliveryFeeAmount: 60,
    deliveryFeeStrategy: 'amount',
    storeStartTime: '09:00',
    storeCloseTime: '22:00',
    ...over,
  }) as HubView;

// the fee/hours rules are pure, so no DB or cache is needed
const svc = new HubsService(null as any, null as any);

describe('HubsService rules', () => {
  it('flat strategy: free above the threshold', () => {
    expect(svc.calculateDeliveryFee(hub(), { subtotal: 499.99 })).toBe(40);
    expect(svc.calculateDeliveryFee(hub(), { subtotal: 500 })).toBe(0);
  });

  it('distance strategy: free inside the radius, paid outside', () => {
    const h = hub({ deliveryFeeStrategy: 'distance' });
    expect(svc.calculateDeliveryFee(h, { subtotal: 100, latitude: 13.0827, longitude: 80.2707 })).toBe(0);
    expect(svc.calculateDeliveryFee(h, { subtotal: 100, latitude: 13.2, longitude: 80.4 })).toBe(60);
  });

  it('distance strategy: uses tiers when configured', () => {
    const h = hub({
      deliveryFeeStrategy: 'distance',
      distanceTiers: [
        { upToKm: 3, fee: 20 },
        { upToKm: 10, fee: 50 },
      ],
    });
    expect(svc.calculateDeliveryFee(h, { subtotal: 100, latitude: 13.1, longitude: 80.28 })).toBe(20); // ~2.5 km
    expect(svc.calculateDeliveryFee(h, { subtotal: 100, latitude: 13.15, longitude: 80.3 })).toBe(50); // ~8 km
  });

  it('opening hours include a 10 minute grace after closing', () => {
    expect(svc.isOpenNow(hub(), 8 * 60 + 59)).toBe(false);
    expect(svc.isOpenNow(hub(), 9 * 60)).toBe(true);
    expect(svc.isOpenNow(hub(), 22 * 60 + 10)).toBe(true);
    expect(svc.isOpenNow(hub(), 22 * 60 + 11)).toBe(false);
  });
});
