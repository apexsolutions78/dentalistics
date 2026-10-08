import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Logger } from '../logger';
import { AppError, ValidationError } from '../errors';
import {
  optionalText,
  optionalUserId,
  parseDateOnly,
  parseListParams,
  parseTimeOnly,
} from '../validate';
import { assertSlotAvailable, assertDoctorInOrg } from './doctors';

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;

export const APPOINTMENT_TRANSITIONS: Record<string, readonly string[]> = {
  SCHEDULED: ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'],
  CONFIRMED: ['CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
};

const UPDATABLE_APPOINTMENT_FIELDS = ['service', 'provider'] as const;

interface AppointmentRow extends RowDataPacket {
  id: number;
  organization_id: number;
  patient_id: number;
  lead_id: number | null;
  appointment_date: string;
  appointment_time: string;
  status: string;
  service: string | null;
  provider: string | null;
  doctor_id: number | null;
  doctor_name: string | null;
  previous_appointment_id: number | null;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
  patient_first_name: string;
  patient_last_name: string;
  patient_phone: string;
}

interface CountRow extends RowDataPacket {
  id: number;
}

const APPOINTMENT_SELECT = `SELECT a.id, a.organization_id, a.patient_id, a.lead_id,
    DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
    a.appointment_time, a.status, a.service, a.provider, a.doctor_id,
    d.name AS doctor_name,
    a.previous_appointment_id, a.created_by, a.created_at, a.updated_at,
    p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.phone AS patient_phone
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  LEFT JOIN doctors d ON d.id = a.doctor_id`;

function appointmentDto(row: AppointmentRow): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organization_id,
    patientId: row.patient_id,
    leadId: row.lead_id,
    date: row.appointment_date,
    time: row.appointment_time,
    status: row.status,
    service: row.service,
    provider: row.provider,
    doctorId: row.doctor_id,
    doctor:
      row.doctor_id === null || row.doctor_name === null
        ? null
        : { id: row.doctor_id, name: row.doctor_name },
    previousAppointmentId: row.previous_appointment_id,
    patient: {
      id: row.patient_id,
      firstName: row.patient_first_name,
      lastName: row.patient_last_name,
      phone: row.patient_phone,
    },
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadAppointmentOn(
  conn: Pool | PoolConnection,
  organizationId: number,
  appointmentId: number,
  forUpdate: boolean,
): Promise<AppointmentRow | null> {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await conn.query<AppointmentRow[]>(
    `${APPOINTMENT_SELECT} WHERE a.id = ? AND a.organization_id = ?${suffix}`,
    [appointmentId, organizationId],
  );
  return rows[0] ?? null;
}

async function loadAppointment(
  db: Pool | PoolConnection,
  organizationId: number,
  appointmentId: number,
): Promise<AppointmentRow | null> {
  return loadAppointmentOn(db, organizationId, appointmentId, false);
}

function assertPatientExists(row: RowDataPacket | undefined, organizationId: number): void {
  if (row === undefined || row.organization_id !== organizationId) {
    throw new AppError('Patient not found', 404, 'not_found', true);
  }
}

async function assertPatientInOrg(
  db: Pool,
  organizationId: number,
  patientId: number,
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id, organization_id FROM patients WHERE id = ?',
    [patientId],
  );
  assertPatientExists(rows[0], organizationId);
}

async function assertLeadInOrg(db: Pool, organizationId: number, leadId: number): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id, organization_id FROM leads WHERE id = ?',
    [leadId],
  );
  if (rows[0] === undefined || rows[0].organization_id !== organizationId) {
    throw new AppError('Lead not found', 404, 'not_found', true);
  }
}

interface CreateFields {
  patientId: number;
  leadId: number | null;
  date: string;
  time: string;
  service: string | null;
  provider: string | null;
  doctorId: number | null;
}

async function parseCreateFields(
  db: Pool,
  organizationId: number,
  body: unknown,
): Promise<CreateFields> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  const b = body as Record<string, unknown>;
  const patientId = optionalUserId(b.patientId, 'patientId');
  if (patientId === null) {
    throw new ValidationError('Invalid input', ['patientId is required']);
  }
  const leadId = optionalUserId(b.leadId, 'leadId');
  const date = parseDateOnly(b.date, 'date');
  const time = parseTimeOnly(b.time, 'time');
  const service = optionalText(b.service, 'service', 120);
  const provider = optionalText(b.provider, 'provider', 120);
  const doctorId = optionalUserId(b.doctorId, 'doctorId');
  await assertPatientInOrg(db, organizationId, patientId);
  if (leadId !== null) {
    await assertLeadInOrg(db, organizationId, leadId);
  }
  if (doctorId !== null) {
    await assertDoctorInOrg(db, organizationId, doctorId, { requireActive: true });
    await assertSlotAvailable(db, organizationId, doctorId, date, time);
  }
  return { patientId, leadId, date, time, service, provider, doctorId };
}

export interface CreateAppointmentInput {
  organizationId: number;
  actorId: number;
  body: unknown;
}

export async function createAppointment(
  db: Pool,
  logger: Logger,
  input: CreateAppointmentInput,
): Promise<Record<string, unknown>> {
  const fields = await parseCreateFields(db, input.organizationId, input.body);
  const [result] = await db.query(
    `INSERT INTO appointments
       (organization_id, patient_id, lead_id, appointment_date, appointment_time,
        status, service, provider, doctor_id, created_by)
     VALUES (?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?)`,
    [
      input.organizationId,
      fields.patientId,
      fields.leadId,
      fields.date,
      fields.time,
      fields.service,
      fields.provider,
      fields.doctorId,
      input.actorId,
    ],
  );
  const appointmentId = (result as { insertId: number }).insertId;
  logger.info('appointment created', {
    appointmentId,
    organizationId: input.organizationId,
    patientId: fields.patientId,
  });
  const created = await loadAppointment(db, input.organizationId, appointmentId);
  return { appointment: appointmentDto(created as AppointmentRow) };
}

export interface AppointmentListQuery {
  organizationId: number;
  query: Record<string, unknown>;
}

export async function listAppointments(
  db: Pool,
  input: AppointmentListQuery,
): Promise<{
  appointments: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}> {
  const { limit, offset } = parseListParams(input.query);
  const where: string[] = ['a.organization_id = ?'];
  const params: unknown[] = [input.organizationId];

  if (input.query.status !== undefined) {
    const status = input.query.status;
    if (typeof status !== 'string' || !(APPOINTMENT_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationError('Invalid input', [
        `status must be one of: ${APPOINTMENT_STATUSES.join(', ')}`,
      ]);
    }
    where.push('a.status = ?');
    params.push(status);
  }
  if (input.query.patientId !== undefined) {
    const patientId = Number(input.query.patientId);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new ValidationError('Invalid input', ['patientId must be a positive integer']);
    }
    where.push('a.patient_id = ?');
    params.push(patientId);
  }
  if (input.query.doctorId !== undefined) {
    const rawDoctor = input.query.doctorId;
    if (rawDoctor === 'none') {
      where.push('a.doctor_id IS NULL');
    } else {
      const doctorId = Number(rawDoctor);
      if (!Number.isInteger(doctorId) || doctorId <= 0) {
        throw new ValidationError('Invalid input', ['doctorId must be a positive integer or "none"']);
      }
      where.push('a.doctor_id = ?');
      params.push(doctorId);
    }
  }
  if (input.query.from !== undefined) {
    where.push('a.appointment_date >= ?');
    params.push(parseDateOnly(input.query.from, 'from'));
  }
  if (input.query.to !== undefined) {
    where.push('a.appointment_date <= ?');
    params.push(parseDateOnly(input.query.to, 'to'));
  }

  const whereSql = where.join(' AND ');
  const [countRows] = await db.query<CountRow[]>(
    `SELECT COUNT(*) AS id FROM appointments a WHERE ${whereSql}`,
    params,
  );
  const total = countRows[0]?.id ?? 0;

  const [rows] = await db.query<AppointmentRow[]>(
    `${APPOINTMENT_SELECT} WHERE ${whereSql}
     ORDER BY a.appointment_date ASC, a.appointment_time ASC, a.id ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { appointments: rows.map((row) => appointmentDto(row)), total, limit, offset };
}

export async function getAppointment(
  db: Pool,
  organizationId: number,
  appointmentId: number,
): Promise<Record<string, unknown> | null> {
  const row = await loadAppointment(db, organizationId, appointmentId);
  return row === null ? null : { appointment: appointmentDto(row) };
}

export interface UpdateAppointmentInput {
  organizationId: number;
  appointmentId: number;
  actorId: number;
  body: unknown;
}

export async function updateAppointment(
  db: Pool,
  logger: Logger,
  input: UpdateAppointmentInput,
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
    if (!(UPDATABLE_APPOINTMENT_FIELDS as readonly string[]).includes(key)) {
      throw new ValidationError('Invalid input', [`unknown or not updatable field: ${key}`]);
    }
  }

  const existing = await loadAppointment(db, input.organizationId, input.appointmentId);
  if (existing === null) {
    throw new AppError('Appointment not found', 404, 'not_found', true);
  }
  if (existing.status !== 'SCHEDULED' && existing.status !== 'CONFIRMED') {
    throw new AppError(
      'Appointments can only be edited while scheduled or confirmed',
      409,
      'invalid_status_transition',
      true,
    );
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

  if (body.service !== undefined) {
    apply('service', 'service', optionalText(body.service, 'service', 120), existing.service);
  }
  if (body.provider !== undefined) {
    apply('provider', 'provider', optionalText(body.provider, 'provider', 120), existing.provider);
  }

  if (changed.length === 0) {
    const current = await loadAppointment(db, input.organizationId, input.appointmentId);
    return { appointment: appointmentDto(current as AppointmentRow) };
  }

  await db.query(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`, [
    ...params,
    input.appointmentId,
    input.organizationId,
  ]);
  logger.info('appointment updated', {
    appointmentId: input.appointmentId,
    organizationId: input.organizationId,
    fields: changed.join(','),
  });
  const updated = await loadAppointment(db, input.organizationId, input.appointmentId);
  return { appointment: appointmentDto(updated as AppointmentRow) };
}

interface TransitionInput {
  organizationId: number;
  appointmentId: number;
  actorId: number;
}

async function transitionAppointment(
  db: Pool,
  logger: Logger,
  input: TransitionInput,
  to: string,
): Promise<Record<string, unknown>> {
  const existing = await loadAppointment(db, input.organizationId, input.appointmentId);
  if (existing === null) {
    throw new AppError('Appointment not found', 404, 'not_found', true);
  }
  const allowed = APPOINTMENT_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      `Cannot change appointment status from ${existing.status} to ${to}`,
      409,
      'invalid_status_transition',
      true,
    );
  }
  const [result] = await db.query(
    'UPDATE appointments SET status = ? WHERE id = ? AND organization_id = ? AND status = ?',
    [to, input.appointmentId, input.organizationId, existing.status],
  );
  if ((result as { affectedRows: number }).affectedRows === 0) {
    throw new AppError(
      `Cannot change appointment status from ${existing.status} to ${to}`,
      409,
      'invalid_status_transition',
      true,
    );
  }
  logger.info('appointment status changed', {
    appointmentId: input.appointmentId,
    organizationId: input.organizationId,
    from: existing.status,
    to,
    actorId: input.actorId,
  });
  const updated = await loadAppointment(db, input.organizationId, input.appointmentId);
  return { appointment: appointmentDto(updated as AppointmentRow) };
}

export function confirmAppointment(
  db: Pool,
  logger: Logger,
  input: TransitionInput,
): Promise<Record<string, unknown>> {
  return transitionAppointment(db, logger, input, 'CONFIRMED');
}

export function cancelAppointment(
  db: Pool,
  logger: Logger,
  input: TransitionInput,
): Promise<Record<string, unknown>> {
  return transitionAppointment(db, logger, input, 'CANCELLED');
}

export function completeAppointment(
  db: Pool,
  logger: Logger,
  input: TransitionInput,
): Promise<Record<string, unknown>> {
  return transitionAppointment(db, logger, input, 'COMPLETED');
}

export function noShowAppointment(
  db: Pool,
  logger: Logger,
  input: TransitionInput,
): Promise<Record<string, unknown>> {
  return transitionAppointment(db, logger, input, 'NO_SHOW');
}

interface MoveFields {
  date: string;
  time: string;
}

function parseMoveFields(body: unknown): MoveFields {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  const b = body as Record<string, unknown>;
  return {
    date: parseDateOnly(b.date, 'date'),
    time: parseTimeOnly(b.time, 'time'),
  };
}

export interface RescheduleInput {
  organizationId: number;
  appointmentId: number;
  actorId: number;
  body: unknown;
}

export async function rescheduleAppointment(
  db: Pool,
  logger: Logger,
  input: RescheduleInput,
): Promise<Record<string, unknown>> {
  const move = parseMoveFields(input.body);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const old = await loadAppointmentOn(conn, input.organizationId, input.appointmentId, true);
    if (old === null) {
      throw new AppError('Appointment not found', 404, 'not_found', true);
    }
    const allowed = APPOINTMENT_TRANSITIONS[old.status] ?? [];
    if (!allowed.includes('RESCHEDULED')) {
      throw new AppError(
        `Cannot reschedule an appointment in status ${old.status}`,
        409,
        'invalid_status_transition',
        true,
      );
    }
    if (old.doctor_id !== null) {
      await assertSlotAvailable(conn, input.organizationId, old.doctor_id, move.date, move.time, {
        excludeAppointmentId: old.id,
        requireActive: false,
      });
    }
    const [result] = await conn.query(
      `INSERT INTO appointments
         (organization_id, patient_id, lead_id, appointment_date, appointment_time,
          status, service, provider, doctor_id, previous_appointment_id, created_by)
       VALUES (?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?)`,
      [
        old.organization_id,
        old.patient_id,
        old.lead_id,
        move.date,
        move.time,
        old.service,
        old.provider,
        old.doctor_id,
        old.id,
        input.actorId,
      ],
    );
    const newId = (result as { insertId: number }).insertId;
    await conn.query(
      `UPDATE appointments SET status = 'RESCHEDULED' WHERE id = ? AND organization_id = ?`,
      [old.id, input.organizationId],
    );
    await conn.commit();

    logger.info('appointment rescheduled', {
      appointmentId: newId,
      previousAppointmentId: old.id,
      organizationId: input.organizationId,
      actorId: input.actorId,
    });
    const created = await loadAppointment(conn, input.organizationId, newId);
    const previous = await loadAppointment(conn, input.organizationId, old.id);
    return {
      appointment: appointmentDto(created as AppointmentRow),
      rescheduledFrom: appointmentDto(previous as AppointmentRow),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export interface RebookInput {
  organizationId: number;
  appointmentId: number;
  actorId: number;
  body: unknown;
}

export async function rebookAppointment(
  db: Pool,
  logger: Logger,
  input: RebookInput,
): Promise<Record<string, unknown>> {
  const move = parseMoveFields(input.body);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const old = await loadAppointmentOn(conn, input.organizationId, input.appointmentId, true);
    if (old === null) {
      throw new AppError('Appointment not found', 404, 'not_found', true);
    }
    if (old.status !== 'CANCELLED' && old.status !== 'NO_SHOW') {
      throw new AppError(
        `Cannot rebook from appointment status ${old.status}`,
        409,
        'invalid_status_transition',
        true,
      );
    }
    if (old.doctor_id !== null) {
      await assertSlotAvailable(conn, input.organizationId, old.doctor_id, move.date, move.time, {
        excludeAppointmentId: old.id,
        requireActive: false,
      });
    }
    const [result] = await conn.query(
      `INSERT INTO appointments
         (organization_id, patient_id, lead_id, appointment_date, appointment_time,
          status, service, provider, doctor_id, previous_appointment_id, created_by)
       VALUES (?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?)`,
      [
        old.organization_id,
        old.patient_id,
        old.lead_id,
        move.date,
        move.time,
        old.service,
        old.provider,
        old.doctor_id,
        old.id,
        input.actorId,
      ],
    );
    const newId = (result as { insertId: number }).insertId;
    await conn.commit();

    logger.info('appointment rebooked', {
      appointmentId: newId,
      previousAppointmentId: old.id,
      organizationId: input.organizationId,
      actorId: input.actorId,
    });
    const created = await loadAppointment(conn, input.organizationId, newId);
    const previous = await loadAppointment(conn, input.organizationId, old.id);
    return {
      appointment: appointmentDto(created as AppointmentRow),
      rebookedFrom: appointmentDto(previous as AppointmentRow),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function appointmentsForLead(
  db: Pool,
  leadId: number,
): Promise<Array<Record<string, unknown>>> {
  const [rows] = await db.query<AppointmentRow[]>(
    `${APPOINTMENT_SELECT} WHERE a.lead_id = ?
     ORDER BY a.appointment_date ASC, a.appointment_time ASC, a.id ASC`,
    [leadId],
  );
  return rows.map((row) => appointmentDto(row));
}
