import type { Pool, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import {
  normalizePhone,
  optionalEmail,
  optionalText,
  parseListParams,
  requireString,
} from '../validate';

const UPDATABLE_PATIENT_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'email',
  'notes',
  'smsOptOut',
] as const;

interface PatientRow extends RowDataPacket {
  id: number;
  organization_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  sms_opt_out: number | boolean;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
}

interface IdRow extends RowDataPacket {
  id: number;
}

const PATIENT_SELECT = `SELECT id, organization_id, first_name, last_name, phone, email,
    notes, sms_opt_out, created_by, created_at, updated_at
  FROM patients`;

function patientDto(row: PatientRow): Record<string, unknown> {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    smsOptOut: row.sms_opt_out === true || row.sms_opt_out === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

async function translatePhoneDuplicate(err: unknown, phone: string): Promise<void> {
  if (err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY') {
    throw new AppError(
      `A patient with phone number ${phone} already exists for this clinic`,
      409,
      'duplicate_patient',
      true,
    );
  }
}

export interface CreatePatientInput {
  organizationId: number;
  actorId: number;
  body: unknown;
}

export async function createPatient(
  db: Pool,
  logger: Logger,
  input: CreatePatientInput,
): Promise<Record<string, unknown>> {
  if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  const body = input.body as Record<string, unknown>;
  const firstName = requireString(body.firstName, 'firstName', { min: 1, max: 80 });
  const lastName = requireString(body.lastName, 'lastName', { min: 1, max: 80 });
  const phone = normalizePhone(body.phone);
  const email = optionalEmail(body.email);
  const notes = optionalText(body.notes, 'notes', 5000);
  if (body.smsOptOut !== undefined && typeof body.smsOptOut !== 'boolean') {
    throw new ValidationError('Invalid input', ['smsOptOut must be a boolean']);
  }
  const smsOptOut = body.smsOptOut === true ? 1 : 0;

  let result;
  try {
    [result] = await db.query(
      `INSERT INTO patients (organization_id, first_name, last_name, phone, email, notes, sms_opt_out, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.organizationId, firstName, lastName, phone, email, notes, smsOptOut, input.actorId],
    );
  } catch (err) {
    await translatePhoneDuplicate(err, phone);
    throw err;
  }
  const patientId = (result as { insertId: number }).insertId;
  logger.info('patient created', { patientId, organizationId: input.organizationId });

  const [rows] = await db.query<PatientRow[]>(`${PATIENT_SELECT} WHERE id = ?`, [patientId]);
  return { patient: patientDto(rows[0] as PatientRow) };
}

export interface PatientListQuery {
  organizationId: number;
  query: Record<string, unknown>;
}

export async function listPatients(
  db: Pool,
  input: PatientListQuery,
): Promise<{ patients: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { limit, offset } = parseListParams(input.query);
  const where: string[] = ['organization_id = ?'];
  const params: unknown[] = [input.organizationId];

  const q = input.query.q;
  if (q !== undefined && q !== '') {
    if (typeof q !== 'string' || q.length > 100) {
      throw new ValidationError('Invalid input', ['q must be a string of at most 100 characters']);
    }
    const pattern = `%${escapeLike(q)}%`;
    where.push(
      `(first_name LIKE ? ESCAPE '\\\\' OR last_name LIKE ? ESCAPE '\\\\' OR phone LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\')`,
    );
    params.push(pattern, pattern, pattern, pattern);
  }

  const whereSql = where.join(' AND ');
  const [countRows] = await db.query<IdRow[]>(`SELECT COUNT(*) AS id FROM patients WHERE ${whereSql}`, params);
  const total = countRows[0]?.id ?? 0;

  const [rows] = await db.query<PatientRow[]>(
    `${PATIENT_SELECT} WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { patients: rows.map(patientDto), total, limit, offset };
}

async function loadPatient(db: Pool, organizationId: number, patientId: number): Promise<PatientRow | null> {
  const [rows] = await db.query<PatientRow[]>(`${PATIENT_SELECT} WHERE id = ? AND organization_id = ?`, [
    patientId,
    organizationId,
  ]);
  return rows[0] ?? null;
}

export async function getPatient(
  db: Pool,
  organizationId: number,
  patientId: number,
): Promise<Record<string, unknown> | null> {
  const row = await loadPatient(db, organizationId, patientId);
  return row === null ? null : { patient: patientDto(row) };
}

export interface UpdatePatientInput {
  organizationId: number;
  patientId: number;
  body: unknown;
}

export async function updatePatient(
  db: Pool,
  logger: Logger,
  input: UpdatePatientInput,
): Promise<Record<string, unknown>> {
  if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  const body = input.body as Record<string, unknown>;
  const provided = Object.keys(body);
  if (provided.length === 0) {
    throw new ValidationError('Invalid input', ['at least one field to update is required']);
  }
  for (const key of provided) {
    if (!(UPDATABLE_PATIENT_FIELDS as readonly string[]).includes(key)) {
      throw new ValidationError('Invalid input', [`unknown or not updatable field: ${key}`]);
    }
  }

  const existing = await loadPatient(db, input.organizationId, input.patientId);
  if (existing === null) {
    throw new AppError('Patient not found', 404, 'not_found', true);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: string[] = [];

  function apply(column: string, dtoName: string, value: unknown, previous: unknown): void {
    sets.push(`${column} = ?`);
    params.push(value);
    if (value !== previous) {
      changed.push(dtoName);
    }
  }

  if (body.firstName !== undefined) {
    apply('first_name', 'firstName', requireString(body.firstName, 'firstName', { min: 1, max: 80 }), existing.first_name);
  }
  if (body.lastName !== undefined) {
    apply('last_name', 'lastName', requireString(body.lastName, 'lastName', { min: 1, max: 80 }), existing.last_name);
  }
  if (body.phone !== undefined) {
    apply('phone', 'phone', normalizePhone(body.phone), existing.phone);
  }
  if (body.email !== undefined) {
    apply('email', 'email', optionalEmail(body.email), existing.email);
  }
  if (body.notes !== undefined) {
    apply('notes', 'notes', optionalText(body.notes, 'notes', 5000), existing.notes);
  }
  if (body.smsOptOut !== undefined) {
    if (typeof body.smsOptOut !== 'boolean') {
      throw new ValidationError('Invalid input', ['smsOptOut must be a boolean']);
    }
    const previous = existing.sms_opt_out === true || existing.sms_opt_out === 1 ? 1 : 0;
    apply('sms_opt_out', 'smsOptOut', body.smsOptOut ? 1 : 0, previous);
  }

  if (changed.length === 0) {
    const current = await loadPatient(db, input.organizationId, input.patientId);
    return { patient: patientDto(current as PatientRow) };
  }

  try {
    await db.query(`UPDATE patients SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`, [
      ...params,
      input.patientId,
      input.organizationId,
    ]);
  } catch (err) {
    const phone = body.phone !== undefined ? normalizePhone(body.phone) : existing.phone;
    await translatePhoneDuplicate(err, phone);
    throw err;
  }
  logger.info('patient updated', { patientId: input.patientId, fields: changed.join(',') });

  const updated = await loadPatient(db, input.organizationId, input.patientId);
  return { patient: patientDto(updated as PatientRow) };
}

export async function deletePatient(
  db: Pool,
  logger: Logger,
  organizationId: number,
  patientId: number,
  actorId: number,
): Promise<boolean> {
  const existing = await loadPatient(db, organizationId, patientId);
  if (existing === null) {
    return false;
  }
  const [appointmentRows] = await db.query<IdRow[]>(
    'SELECT id FROM appointments WHERE patient_id = ? LIMIT 1',
    [patientId],
  );
  if (appointmentRows[0] !== undefined) {
    throw new AppError(
      'Patient has appointments and cannot be deleted',
      409,
      'patient_has_appointments',
      true,
    );
  }
  await db.query('DELETE FROM patients WHERE id = ? AND organization_id = ?', [patientId, organizationId]);
  await recordAudit(db, logger, {
    organizationId,
    userId: actorId,
    action: 'patient_deleted',
    detail: `id=${patientId}`,
  });
  return true;
}
