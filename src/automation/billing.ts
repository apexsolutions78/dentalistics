import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { billingGraceDays } from '../billing/subscription';
import type { Logger } from '../logger';

interface OrgIdRow extends RowDataPacket {
  id: number;
}

export interface BillingTickResult {
  lapsed: number;
  restored: number;
}

/**
 * Records the moment a paid clinic crosses from grace into the read-only
 * state. Access control does not wait for this tick: the request lock and
 * the automation gate both read paid_until directly. The tick exists so the
 * transition is auditable and idempotent (subscription_lapsed_at is set once).
 * It does not send email or SMS.
 */
export async function runBillingTick(db: Pool, logger: Logger): Promise<BillingTickResult> {
  const grace = billingGraceDays();
  const [due] = await db.query<OrgIdRow[]>(
    `SELECT id FROM organizations
     WHERE plan = 'full'
       AND paid_until IS NOT NULL
       AND subscription_lapsed_at IS NULL
       AND paid_until <= UTC_TIMESTAMP() - INTERVAL ${grace} DAY`,
  );

  let lapsed = 0;
  for (const row of due) {
    const [updated] = await db.query<ResultSetHeader>(
      `UPDATE organizations
       SET subscription_lapsed_at = UTC_TIMESTAMP()
       WHERE id = ?
         AND subscription_lapsed_at IS NULL
         AND plan = 'full'
         AND paid_until IS NOT NULL
         AND paid_until <= UTC_TIMESTAMP() - INTERVAL ${grace} DAY`,
      [row.id],
    );
    if (updated.affectedRows === 0) {
      continue;
    }
    lapsed += 1;
    await recordAudit(db, logger, {
      organizationId: row.id,
      userId: null,
      action: 'subscription_expired',
      detail: `graceDays=${grace}`,
    });
  }

  const [restored] = await db.query<ResultSetHeader>(
    `UPDATE organizations
     SET subscription_lapsed_at = NULL
     WHERE subscription_lapsed_at IS NOT NULL
       AND (
         plan <> 'full'
         OR paid_until IS NULL
         OR paid_until > UTC_TIMESTAMP() - INTERVAL ${grace} DAY
       )`,
  );

  if (lapsed > 0) {
    logger.info('billing tick lapsed clinics', { lapsed });
  }
  return { lapsed, restored: restored.affectedRows };
}
