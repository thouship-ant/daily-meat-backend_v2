import { buildDeletionTicket } from './account-deletion-ticket';

const snap = { name: 'Ravi', phone: '+919000000001', email: null, registeredAt: new Date('2026-01-05T10:00:00Z'), orderCount: 14, hubName: 'Tiruchirappalli - Daily Meat Hub' };

describe('buildDeletionTicket', () => {
  it('names the customer, the hub and the reason, so the hub admins know who left and why', () => {
    const t = buildDeletionTicket(snap, 'DELIVERY', 'Always late');
    expect(t.subject).toBe('Account deleted: Delivery problems');
    expect(t.message).toContain('Name: Ravi');
    expect(t.message).toContain('Mobile: +919000000001');
    expect(t.message).toContain('Hub: Tiruchirappalli - Daily Meat Hub');
    expect(t.message).toContain('Orders placed: 14');
    expect(t.message).toContain('Reason: Delivery problems');
    expect(t.message).toContain('Details: Always late');
  });

  it('works for older app builds that send no reason, and for "Other" with only free text', () => {
    expect(buildDeletionTicket(snap).subject).toBe('Account deleted: No reason given');
    const other = buildDeletionTicket(snap, undefined, 'Moving abroad');
    expect(other.subject).toBe('Account deleted: Other');
    expect(other.message).toContain('Details: Moving abroad');
  });
});
