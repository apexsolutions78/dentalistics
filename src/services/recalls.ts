import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ValidationError } from '../errors';
import { parseDateOnly, parseListParams, requireChoice } from '../validate';

export const RECALL_STATUSES = ['DUE', 'CONTACTED', 'BOOKED', 'COMPLETED', 'CLOSED'] as const;

interface RecallRow extends RowDataPacket {
  id: number;
  organization_id: number;
  patient_id: number;
  recall_type: string;
  due_date: string | Date;
  status: string;
  last_contacted_at: Date | string | null;
  rebooked_appointment_id: number | null;
  anchor_appointment_id: number | null;
  close_reason: string | null;
  opened_at: Date | string;
  closed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  patient_first_name: string;
  patient_last_name: string;
  patient_phone: string;
}

function dateString(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function timestampString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function recallDto(row: RecallRow): Record<string, unknown> {
  return {
    id: row.id,
    patientId: row.patient_id,
    patient: {
      id: row.patient_id,
      firstName: row.patient_first_name,
      lastName: row.patient_last_name,
      phone: row.patient_phone,
    },
    recallType: row.recall_type,
    dueDate: dateString(row.due_date),
    status: row.status,
    lastContactedAt: timestampString(row.last_contacted_at),
    rebookedAppointmentId: row.rebooked_appointment_id,
    anchorAppointmentId: row.anchor_appointment_id,
    closeReason: row.close_reason,
    openedAt: timestampString(row.opened_at),
    closedAt: timestampString(row.closed_at),
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface RecallListQuery {
  organizationId: number;
  query: Record<string, unknown>;
}

export async function listRecalls(
  db: Pool,
  input: RecallListQuery,
): Promise<{ recalls: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { limit, offset } = parseListParams(input.query);

  const where: string[] = ['r.organization_id = ?'];
  const params: unknown[] = [input.organizationId];

  if (input.query.status !== undefined) {
    where.push('r.status = ?');
    params.push(requireChoice(input.query.status, RECALL_STATUSES, 'status'));
  }
  if (input.query.patientId !== undefined) {
    const patientId = Number(input.query.patientId);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new ValidationError('Invalid input', ['patientId must be a positive integer']);
    }
    where.push('r.patient_id = ?');
    params.push(patientId);
  }
  const q = input.query.q;
  if (q !== undefined && q !== '') {
    if (typeof q !== 'string' || q.length > 100) {
      throw new ValidationError('Invalid input', ['q must be a string of at most 100 characters']);
    }
    const pattern = `%${escapeLike(q)}%`;
    where.push(
      `(p.first_name LIKE ? ESCAPE '\\\\' OR p.last_name LIKE ? ESCAPE '\\\\' OR p.phone LIKE ? ESCAPE '\\\\')`,
    );
    params.push(pattern, pattern, pattern);
  }
  if (input.query.dueFrom !== undefined) {
    where.push('r.due_date >= ?');
    params.push(parseDateOnly(input.query.dueFrom, 'dueFrom'));
  }
  if (input.query.dueTo !== undefined) {
    where.push('r.due_date <= ?');
    params.push(parseDateOnly(input.query.dueTo, 'dueTo'));
  }

  const whereSql = where.join(' AND ');
  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM recalls r JOIN patients p ON p.id = r.patient_id WHERE ${whereSql}`,
    params,
  );
  const total = (countRows[0] as { total: number }).total;

  const [rows] = await db.query<RecallRow[]>(
    `SELECT r.*, p.first_name AS patient_first_name, p.last_name AS patient_last_name,
            p.phone AS patient_phone
     FROM recalls r JOIN patients p ON p.id = r.patient_id
     WHERE ${whereSql}
     ORDER BY r.due_date ASC, r.id ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { recalls: rows.map(recallDto), total, limit, offset };
}
