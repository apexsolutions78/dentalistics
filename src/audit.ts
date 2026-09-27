import type { Pool } from 'mysql2/promise';
import type { Logger } from './logger';

export interface AuditEntry {
  organizationId: number | null;
  userId: number | null;
  action: string;
  detail?: string;
}

export async function recordAudit(
  db: Pool,
  logger: Logger,
  entry: AuditEntry,
): Promise<void> {
  try {
    await db.query('INSERT INTO audit_logs (organization_id, user_id, action, detail) VALUES (?, ?, ?, ?)', [
      entry.organizationId,
      entry.userId,
      entry.action,
      entry.detail ?? null,
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('audit log write failed', { action: entry.action, error: message });
  }
}
