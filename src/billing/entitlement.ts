import type { Pool, RowDataPacket } from 'mysql2/promise';
import { describeBilling } from './subscription';
import type { BillingDescription, PlanId } from './subscription';

interface BillingRow extends RowDataPacket {
  plan: PlanId;
  trial_ends_at: Date | null;
  paid_until: Date | null;
}

export async function organizationAccess(
  db: Pool,
  organizationId: number,
  now = new Date(),
): Promise<BillingDescription | null> {
  const [rows] = await db.query<BillingRow[]>(
    'SELECT plan, trial_ends_at, paid_until FROM organizations WHERE id = ?',
    [organizationId],
  );
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return describeBilling({
    plan: row.plan,
    trialEndsAt: row.trial_ends_at,
    paidUntil: row.paid_until,
    now,
  });
}

export async function clinicMaySend(db: Pool, organizationId: number, now = new Date()): Promise<boolean> {
  const access = await organizationAccess(db, organizationId, now);
  return access !== null && !access.readOnly;
}
