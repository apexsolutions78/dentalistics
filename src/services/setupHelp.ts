import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import { requireString } from '../validate';

export interface SetupHelpRequest {
  id: number;
  organizationId: number;
  organizationName: string;
  requestedBy: number | null;
  note: string | null;
  status: 'open' | 'closed';
  createdAt: Date;
}

interface HelpRow extends RowDataPacket {
  id: number;
  organization_id: number;
  organization_name: string;
  requested_by: number | null;
  note: string | null;
  status: 'open' | 'closed';
  created_at: Date;
}

function helpDto(row: HelpRow): SetupHelpRequest {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    requestedBy: row.requested_by,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
  };
}

const HELP_SELECT = `SELECT r.id, r.organization_id, o.name AS organization_name, r.requested_by,
    r.note, r.status, r.created_at
  FROM setup_help_requests r
  JOIN organizations o ON o.id = r.organization_id`;

export async function requestSetupHelp(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; actorId: number; body: Record<string, unknown> },
): Promise<{ created: boolean; request: SetupHelpRequest }> {
  let note: string | null = null;
  if (input.body.note !== undefined && input.body.note !== null && input.body.note !== '') {
    note = requireString(input.body.note, 'note', { min: 1, max: 500 });
  }
  const [openRows] = await db.query<HelpRow[]>(
    `${HELP_SELECT} WHERE r.organization_id = ? AND r.status = 'open' ORDER BY r.id DESC LIMIT 1`,
    [input.organizationId],
  );
  const open = openRows[0];
  if (open !== undefined) {
    return { created: false, request: helpDto(open) };
  }
  const [inserted] = await db.query<ResultSetHeader>(
    `INSERT INTO setup_help_requests (organization_id, requested_by, note) VALUES (?, ?, ?)`,
    [input.organizationId, input.actorId, note],
  );
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'setup_help_requested',
    detail: note === null ? 'note=none' : 'note=set',
  });
  const [rows] = await db.query<HelpRow[]>(`${HELP_SELECT} WHERE r.id = ?`, [inserted.insertId]);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Setup help request disappeared after it was saved', 500, 'internal_error', false);
  }
  return { created: true, request: helpDto(row) };
}

export async function listSetupHelp(db: Pool): Promise<SetupHelpRequest[]> {
  const [rows] = await db.query<HelpRow[]>(`${HELP_SELECT} ORDER BY r.id DESC LIMIT 100`);
  return rows.map(helpDto);
}

export async function closeSetupHelp(db: Pool, requestId: number): Promise<SetupHelpRequest> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE setup_help_requests SET status = 'closed' WHERE id = ? AND status = 'open'`,
    [requestId],
  );
  if (result.affectedRows === 0) {
    const [rows] = await db.query<HelpRow[]>(`${HELP_SELECT} WHERE r.id = ?`, [requestId]);
    if (rows[0] === undefined) {
      throw new AppError('Setup help request not found', 404, 'not_found', true);
    }
  }
  const [rows] = await db.query<HelpRow[]>(`${HELP_SELECT} WHERE r.id = ?`, [requestId]);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Setup help request not found', 404, 'not_found', true);
  }
  return helpDto(row);
}

export function assertNoUnknownHelpFields(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (key !== 'note') {
      throw new ValidationError('Invalid input', [`unknown field: ${key}`]);
    }
  }
}
