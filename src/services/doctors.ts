import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { clinicLocalDate, clinicLocalTime } from '../automation/time';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import {
  normalizeEmail,
  normalizePhone,
  parseBusinessHours,
  requireString,
} from '../validate';
import type { BusinessHours } from '../validate';
import {
  MIN_LEAD_MINUTES,
  dayKeyForDate,
  enumerateSlots,
  parseWorkHours,
  slotConflicts,
  toMinutes,
} from './slots';
import type { BusyInterval } from './slots';

export const DEFAULT_DOCTOR_HOURS: BusinessHours = {
  mon: { open: '09:00', close: '17:00' },
  tue: { open: '09:00', close: '17:00' },
  wed: { open: '09:00', close: '17:00' },
  thu: { open: '09:00', close: '17:00' },
  fri: { open: '09:00', close: '17:00' },
  sat: null,
  sun: null,
};

interface DoctorRow extends RowDataPacket {
  id: number;
  organization_id: number;
  name: string;
  specialty: string | null;
  phone: string | null;
  email: string | null;
  work_hours: string;
  slot_minutes: number;
  is_active: number;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
}

interface BusyRow extends RowDataPacket {
  d: string;
  start_minutes: number;
}

const DOCTOR_SELECT = `SELECT id, organization_id, name, specialty, phone, email, work_hours,
    slot_minutes, is_active, created_by, created_at, updated_at
  FROM doctors`;

function doctorDto(row: DoctorRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    phone: row.phone,
    email: row.email,
    workHours: parseWorkHours(row.work_hours),
    slotMinutes: row.slot_minutes,
    isActive: row.is_active === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function optionalPhone(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return normalizePhone(value, name);
}

function parseSlotMinutes(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 30;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 480) {
    throw new ValidationError('Invalid input', [
      'slotMinutes must be an integer between 5 and 480',
    ]);
  }
  return parsed;
}

function parseIsActive(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new ValidationError('Invalid input', ['isActive must be a boolean']);
  }
  return value;
}

export async function listDoctors(
  db: Pool,
  organizationId: number,
): Promise<Array<Record<string, unknown>>> {
  const [rows] = await db.query<DoctorRow[]>(
    `${DOCTOR_SELECT} WHERE organization_id = ? ORDER BY is_active DESC, name ASC, id ASC`,
    [organizationId],
  );
  return rows.map(doctorDto);
}

export async function getDoctor(
  db: Pool,
  organizationId: number,
  doctorId: number,
): Promise<Record<string, unknown> | null> {
  const [rows] = await db.query<DoctorRow[]>(
    `${DOCTOR_SELECT} WHERE id = ? AND organization_id = ?`,
    [doctorId, organizationId],
  );
  const row = rows[0];
  return row === undefined ? null : doctorDto(row);
}

async function loadDoctorRow(
  db: Pool | PoolConnection,
  organizationId: number,
  doctorId: number,
): Promise<DoctorRow | null> {
  const [rows] = await db.query<DoctorRow[]>(
    `${DOCTOR_SELECT} WHERE id = ? AND organization_id = ?`,
    [doctorId, organizationId],
  );
  return rows[0] ?? null;
}

export async function assertDoctorInOrg(
  db: Pool | PoolConnection,
  organizationId: number,
  doctorId: number,
  options: { requireActive?: boolean } = {},
): Promise<DoctorRow> {
  const row = await loadDoctorRow(db, organizationId, doctorId);
  if (row === null) {
    throw new AppError('Doctor not found', 404, 'not_found', true);
  }
  if (options.requireActive === true && row.is_active !== 1) {
    throw new AppError('Doctor is no longer active', 409, 'doctor_inactive', true);
  }
  return row;
}

interface DoctorFields {
  name: string;
  specialty: string | null;
  phone: string | null;
  email: string | null;
  workHours: BusinessHours;
  slotMinutes: number;
  isActive: boolean;
}

async function parseDoctorFields(
  body: unknown,
  fallback: Partial<DoctorFields> = {},
): Promise<DoctorFields> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  const b = body as Record<string, unknown>;
  const name =
    b.name === undefined && fallback.name !== undefined
      ? fallback.name
      : requireString(b.name, 'name', { min: 1, max: 120 });
  let workHours: BusinessHours;
  if (b.workHours === undefined && fallback.workHours !== undefined) {
    workHours = fallback.workHours;
  } else if (b.workHours === undefined || b.workHours === null || b.workHours === '') {
    workHours = fallback.workHours ?? DEFAULT_DOCTOR_HOURS;
  } else {
    workHours = parseBusinessHours(b.workHours) as BusinessHours;
  }
  const specialty =
    b.specialty === undefined && fallback.specialty !== undefined
      ? fallback.specialty
      : b.specialty === undefined || b.specialty === null || b.specialty === ''
        ? null
        : requireString(b.specialty, 'specialty', { min: 1, max: 120 });
  const phone =
    b.phone === undefined && fallback.phone !== undefined
      ? fallback.phone
      : optionalPhone(b.phone, 'phone');
  const email =
    b.email === undefined && fallback.email !== undefined
      ? fallback.email
      : b.email === undefined || b.email === null || b.email === ''
        ? null
        : normalizeEmail(b.email);
  const slotMinutes =
    b.slotMinutes === undefined && fallback.slotMinutes !== undefined
      ? fallback.slotMinutes
      : parseSlotMinutes(b.slotMinutes);
  const isActive = parseIsActive(b.isActive, fallback.isActive ?? true);
  return { name, specialty, phone, email, workHours, slotMinutes, isActive };
}

export interface CreateDoctorInput {
  organizationId: number;
  actorId: number;
  body: unknown;
}

export async function createDoctor(
  db: Pool,
  logger: Logger,
  input: CreateDoctorInput,
): Promise<Record<string, unknown>> {
  const fields = await parseDoctorFields(input.body);
  const [result] = await db.query(
    `INSERT INTO doctors (organization_id, name, specialty, phone, email, work_hours,
       slot_minutes, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.organizationId,
      fields.name,
      fields.specialty,
      fields.phone,
      fields.email,
      JSON.stringify(fields.workHours),
      fields.slotMinutes,
      fields.isActive ? 1 : 0,
      input.actorId,
    ],
  );
  const doctorId = (result as { insertId: number }).insertId;
  logger.info('doctor created', { doctorId, organizationId: input.organizationId });
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'doctor_created',
    detail: `id=${doctorId} name=${fields.name}`,
  });
  const created = await getDoctor(db, input.organizationId, doctorId);
  return { doctor: created };
}

export interface UpdateDoctorInput {
  organizationId: number;
  doctorId: number;
  actorId: number;
  body: unknown;
}

export async function updateDoctor(
  db: Pool,
  logger: Logger,
  input: UpdateDoctorInput,
): Promise<Record<string, unknown>> {
  if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  const provided = Object.keys(input.body as Record<string, unknown>);
  if (provided.length === 0) {
    throw new ValidationError('Invalid input', ['at least one field to update is required']);
  }
  const allowed = ['name', 'specialty', 'phone', 'email', 'workHours', 'slotMinutes', 'isActive'];
  for (const key of provided) {
    if (!allowed.includes(key)) {
      throw new ValidationError('Invalid input', [`unknown or not updatable field: ${key}`]);
    }
  }
  const existing = await loadDoctorRow(db, input.organizationId, input.doctorId);
  if (existing === null) {
    throw new AppError('Doctor not found', 404, 'not_found', true);
  }
  const fields = await parseDoctorFields(input.body, {
    name: existing.name,
    specialty: existing.specialty,
    phone: existing.phone,
    email: existing.email,
    workHours: parseWorkHours(existing.work_hours) ?? DEFAULT_DOCTOR_HOURS,
    slotMinutes: existing.slot_minutes,
    isActive: existing.is_active === 1,
  });
  await db.query(
    `UPDATE doctors SET name = ?, specialty = ?, phone = ?, email = ?, work_hours = ?,
       slot_minutes = ?, is_active = ? WHERE id = ? AND organization_id = ?`,
    [
      fields.name,
      fields.specialty,
      fields.phone,
      fields.email,
      JSON.stringify(fields.workHours),
      fields.slotMinutes,
      fields.isActive ? 1 : 0,
      input.doctorId,
      input.organizationId,
    ],
  );
  logger.info('doctor updated', {
    doctorId: input.doctorId,
    organizationId: input.organizationId,
    fields: provided.join(','),
  });
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'doctor_updated',
    detail: `id=${input.doctorId} fields=${provided.join(',')}`,
  });
  const updated = await getDoctor(db, input.organizationId, input.doctorId);
  return { doctor: updated };
}

export async function deactivateDoctor(
  db: Pool,
  logger: Logger,
  organizationId: number,
  doctorId: number,
  actorId: number,
): Promise<Record<string, unknown>> {
  const existing = await loadDoctorRow(db, organizationId, doctorId);
  if (existing === null) {
    throw new AppError('Doctor not found', 404, 'not_found', true);
  }
  if (existing.is_active === 1) {
    await db.query('UPDATE doctors SET is_active = 0 WHERE id = ? AND organization_id = ?', [
      doctorId,
      organizationId,
    ]);
    logger.info('doctor deactivated', { doctorId, organizationId });
    await recordAudit(db, logger, {
      organizationId,
      userId: actorId,
      action: 'doctor_deactivated',
      detail: `id=${doctorId} name=${existing.name}`,
    });
  }
  const updated = await getDoctor(db, organizationId, doctorId);
  return { doctor: updated };
}

export async function loadOrgTimezone(db: Pool, organizationId: number): Promise<string> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT timezone FROM organizations WHERE id = ?',
    [organizationId],
  );
  return (rows[0]?.timezone as string | undefined) ?? 'UTC';
}

export async function loadBusyIntervals(
  db: Pool | PoolConnection,
  organizationId: number,
  doctorId: number,
  fromDate: string,
  toDate: string,
  slotMinutes: number,
): Promise<Map<string, BusyInterval[]>> {
  const busy = new Map<string, BusyInterval[]>();
  const push = (date: string, startMinutes: number, lengthMinutes: number): void => {
    const list = busy.get(date) ?? [];
    list.push({ startMinutes, lengthMinutes });
    busy.set(date, list);
  };
  const [appointmentRows] = await db.query<BusyRow[]>(
    `SELECT DATE_FORMAT(appointment_date, '%Y-%m-%d') AS d,
       FLOOR(TIME_TO_SEC(appointment_time) / 60) AS start_minutes
     FROM appointments
     WHERE organization_id = ? AND appointment_date BETWEEN ? AND ?
       AND status IN ('SCHEDULED', 'CONFIRMED')
       AND (doctor_id = ? OR doctor_id IS NULL)`,
    [organizationId, fromDate, toDate, doctorId],
  );
  for (const row of appointmentRows) {
    push(row.d, row.start_minutes, slotMinutes);
  }
  const [suggestionRows] = await db.query<BusyRow[]>(
    `SELECT DATE_FORMAT(slot_date, '%Y-%m-%d') AS d,
       FLOOR(TIME_TO_SEC(slot_time) / 60) AS start_minutes
     FROM lead_slot_suggestions
     WHERE organization_id = ? AND doctor_id = ? AND status = 'PENDING'
       AND slot_date BETWEEN ? AND ?`,
    [organizationId, doctorId, fromDate, toDate],
  );
  for (const row of suggestionRows) {
    push(row.d, row.start_minutes, slotMinutes);
  }
  return busy;
}

export interface DoctorAvailability {
  date: string;
  slotMinutes: number;
  slots: string[];
  withinHours: boolean;
}

export async function getDoctorAvailability(
  db: Pool,
  organizationId: number,
  doctorId: number,
  date: string,
): Promise<DoctorAvailability> {
  const doctor = await assertDoctorInOrg(db, organizationId, doctorId);
  const timezone = await loadOrgTimezone(db, organizationId);
  const now = new Date();
  const localDate = clinicLocalDate(now, timezone);
  const hours = parseWorkHours(doctor.work_hours);
  const window = hours === null ? null : hours[dayKeyForDate(date)];
  if (window === null || doctor.is_active !== 1) {
    return { date, slotMinutes: doctor.slot_minutes, slots: [], withinHours: false };
  }
  const allSlots = enumerateSlots(window, doctor.slot_minutes);
  const busy = await loadBusyIntervals(
    db,
    organizationId,
    doctorId,
    date,
    date,
    doctor.slot_minutes,
  );
  const busyForDate = busy.get(date) ?? [];
  let cutoff = 0;
  if (date === localDate) {
    cutoff = toMinutes(clinicLocalTime(now, timezone)) + MIN_LEAD_MINUTES;
  } else if (date < localDate) {
    return { date, slotMinutes: doctor.slot_minutes, slots: [], withinHours: false };
  }
  const slots = allSlots.filter((slot) => {
    if (toMinutes(slot) < cutoff) {
      return false;
    }
    return !slotConflicts(slot, doctor.slot_minutes, busyForDate);
  });
  return { date, slotMinutes: doctor.slot_minutes, slots, withinHours: true };
}

export interface SlotAvailabilityCheck {
  excludeAppointmentId?: number;
  excludeSuggestionId?: number;
  requireActive?: boolean;
}

export async function assertSlotAvailable(
  db: Pool | PoolConnection,
  organizationId: number,
  doctorId: number,
  date: string,
  time: string,
  options: SlotAvailabilityCheck = {},
): Promise<void> {
  const doctor = await assertDoctorInOrg(db, organizationId, doctorId, {
    requireActive: options.requireActive !== false,
  });
  const hours = parseWorkHours(doctor.work_hours);
  const window = hours === null ? null : hours[dayKeyForDate(date)];
  if (window === null) {
    throw new AppError(
      'The selected doctor is not working on that day',
      409,
      'slot_unavailable',
      true,
    );
  }
  const start = toMinutes(time);
  const end = start + doctor.slot_minutes;
  if (start < toMinutes(window.open) || end > toMinutes(window.close)) {
    throw new AppError(
      'The selected time is outside the doctor working hours',
      409,
      'slot_unavailable',
      true,
    );
  }
  const exclude = options.excludeAppointmentId;
  const excludeSql = exclude === undefined ? '' : ' AND id != ?';
  const params: unknown[] = [organizationId, date, date];
  if (exclude !== undefined) {
    params.push(exclude);
  }
  const [appointmentRows] = await db.query<BusyRow[]>(
    `SELECT DATE_FORMAT(appointment_date, '%Y-%m-%d') AS d,
       FLOOR(TIME_TO_SEC(appointment_time) / 60) AS start_minutes
     FROM appointments
     WHERE organization_id = ? AND appointment_date BETWEEN ? AND ?
       AND status IN ('SCHEDULED', 'CONFIRMED')
       AND (doctor_id = ? OR doctor_id IS NULL)${excludeSql}`,
    [...params, doctorId],
  );
  const busyForDate = appointmentRows
    .filter((row) => row.d === date)
    .map((row) => ({ startMinutes: row.start_minutes, lengthMinutes: doctor.slot_minutes }));
  if (slotConflicts(time, doctor.slot_minutes, busyForDate)) {
    throw new AppError('That slot is already booked', 409, 'slot_unavailable', true);
  }
  const [suggestionRows] = await db.query<BusyRow[]>(
    `SELECT DATE_FORMAT(slot_date, '%Y-%m-%d') AS d,
       FLOOR(TIME_TO_SEC(slot_time) / 60) AS start_minutes
     FROM lead_slot_suggestions
     WHERE organization_id = ? AND doctor_id = ? AND status = 'PENDING'
      AND slot_date = ?${options.excludeSuggestionId === undefined ? '' : ' AND id != ?'}`,
    options.excludeSuggestionId === undefined
      ? [organizationId, doctorId, date]
      : [organizationId, doctorId, date, options.excludeSuggestionId],
  );
  const suggestionBusy = suggestionRows.map((row) => ({
    startMinutes: row.start_minutes,
    lengthMinutes: doctor.slot_minutes,
  }));
  if (slotConflicts(time, doctor.slot_minutes, suggestionBusy)) {
    throw new AppError('That slot is already reserved by another suggestion', 409, 'slot_unavailable', true);
  }
}
