/** Reasons offered when a customer deletes their account (the app shows the same list). */
export const DELETION_REASONS: Record<string, string> = {
  NOT_USING: 'I no longer use the app',
  DELIVERY: 'Delivery problems',
  QUALITY: 'Product quality',
  PRICE: 'Prices are too high',
  PRIVACY: 'Privacy concerns',
  ANOTHER_APP: 'I use another app',
  OTHER: 'Other',
};

export interface DeletionSnapshot {
  name: string | null;
  phone: string | null;
  email: string | null;
  registeredAt: Date;
  orderCount: number;
  hubName: string | null;
}

/**
 * The support ticket raised when a customer deletes their account. The account is anonymised right after, so the
 * ticket text carries who it was (the hub's admins can still see it) and why they left.
 */
export function buildDeletionTicket(snapshot: DeletionSnapshot, reasonCode?: string, reasonText?: string) {
  const label = (reasonCode && DELETION_REASONS[reasonCode]) || (reasonText?.trim() ? DELETION_REASONS.OTHER : 'No reason given');
  const details = reasonText?.trim();
  const when = (d: Date) => d.toISOString().slice(0, 10);
  const lines = [
    'The customer deleted their account.',
    '',
    `Name: ${snapshot.name || '-'}`,
    `Mobile: ${snapshot.phone || '-'}`,
    `Email: ${snapshot.email || '-'}`,
    `Hub: ${snapshot.hubName || '-'}`,
    `Registered: ${when(snapshot.registeredAt)}`,
    `Orders placed: ${snapshot.orderCount}`,
    '',
    `Reason: ${label}`,
    ...(details ? [`Details: ${details}`] : []),
  ];
  return { subject: `Account deleted: ${label}`, message: lines.join('\n') };
}
