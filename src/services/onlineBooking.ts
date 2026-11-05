import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { organizationAccess } from '../billing/entitlement';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import type { BookingMailer } from '../mail/bookingMailer';
import { generateSiteKey } from '../security/siteKey';
import { normalizeEmail, normalizePhone, optionalText, parseBusinessHours, parseDateOnly, parseTimeOnly, requireString } from '../validate';
import type { BusinessHours } from '../validate';
import {
  dateInBookingWindow,
  bookingDateBounds,
  hhmm,
  intersectWindows,
  listDaySlots,
  parseOnlineBookingSettings,
  publicLogoPath,
  readStoredOnlineBooking,
} from './bookingSlots';
import type { OnlineBookingSettings, TimeWindow } from './bookingSlots';
import { dayKeyForDate, parseWorkHours } from './slots';

const SETTINGS_KEY = 'online_booking';
const NOT_AVAILABLE = 'Online booking is not available.';

export interface PublicDoctor {
  id: number;
  name: string;
  specialty: string | null;
}

export interface PublicBookingView {
  available: boolean;
  message?: string;
  clinic?: {
    name: string;
    phone: string | null;
    address: string | null;
    logoUrl: string | null;
    timezone: string;
  };
  booking?: {
    slotMinutes: number;
    minNoticeMinutes: number;
    maxDaysAhead: number;
    confirmation: 'pending' | 'confirmed';
  };
  doctors?: PublicDoctor[];
  today?: string;
  lastDate?: string;
}

interface OrgRow extends RowDataPacket {
  id: number;
  name: string;
  status: string;
  timezone: string;
  phone: string | null;
  address: string | null;
  logo_url: string | null;
  business_hours: string | null;
  plan: 'trial' | 'full';
  trial_ends_at: Date | null;
  paid_until: Date | null;
  site_key: string | null;
}

interface DoctorRow extends RowDataPacket {
  id: number;
  name: string;
  specialty: string | null;
  work_hours: string;
  slot_minutes: number;
}

interface BusyRow extends RowDataPacket {
  doctor_id: number | null;
  start_minutes: number;
}

interface PatientRow extends RowDataPacket {
  id: number;
  email: string | null;
}

type Sql = Pool | PoolConnection;

interface ClinicContext {
  id: number;
  name: string;
  timezone: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  businessHours: BusinessHours | null;
  clinicHoursConfigured: boolean;
  settings: OnlineBookingSettings;
  readOnly: boolean;
}

function safeClinicHours(raw: string | null): { hours: BusinessHours | null; configured: boolean } {
  if (raw === null || raw.trim() === '') {
    return { hours: null, configured: false };
  }
  try {
    return { hours: parseBusinessHours(JSON.parse(raw)), configured: true };
  } catch {
    return { hours: null, configured: true };
  }
}

async function loadSettings(db: Sql, organizationId: number): Promise<OnlineBookingSettings> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM organization_settings WHERE organization_id = ? AND meta_key = ?',
    [organizationId, SETTINGS_KEY],
  );
  const raw = rows[0]?.meta_value;
  return readStoredOnlineBooking(typeof raw === 'string' ? raw : null);
}

async function loadDoctors(db: Sql, organizationId: number): Promise<DoctorRow[]> {
  const [rows] = await db.query<DoctorRow[]>(
    `SELECT id, name, specialty, work_hours, slot_minutes
     FROM doctors
     WHERE organization_id = ? AND is_active = 1
     ORDER BY id ASC`,
    [organizationId],
  );
  return rows;
}

async function loadContext(db: Sql, org: OrgRow, now: Date): Promise<ClinicContext> {
  const access = await organizationAccess(db, org.id, now);
  const hours = safeClinicHours(org.business_hours);
  return {
    id: org.id,
    name: org.name,
    timezone: org.timezone,
    phone: org.phone,
    address: org.address,
    logoUrl: publicLogoPath(org.logo_url),
    businessHours: hours.hours,
    clinicHoursConfigured: hours.configured,
    settings: await loadSettings(db, org.id),
    readOnly: access === null || access.readOnly,
  };
}

function unavailable(name?: string): PublicBookingView {
  return {
    available: false,
    message: NOT_AVAILABLE,
    ...(name === undefined ? {} : { clinic: { name, phone: null, address: null, logoUrl: null, timezone: '' } }),
  };
}

function doctorWindow(doctor: DoctorRow, date: string, clinic: ClinicContext): TimeWindow | null {
  const hours = parseWorkHours(doctor.work_hours);
  const day = hours === null ? null : hours[dayKeyForDate(date)];
  const clinicDay =
    clinic.businessHours === null ? null : clinic.businessHours[dayKeyForDate(date)];
  return intersectWindows(clinicDay, day, clinic.clinicHoursConfigured);
}

async function occupiedByDoctor(
  db: Sql,
  organizationId: number,
  date: string,
): Promise<{ shared: number[]; byDoctor: Map<number, number[]> }> {
  const shared: number[] = [];
  const byDoctor = new Map<number, number[]>();
  const push = (doctorId: number | null, start: number): void => {
    if (doctorId === null) {
      shared.push(start);
      return;
    }
    const list = byDoctor.get(doctorId) ?? [];
    list.push(start);
    byDoctor.set(doctorId, list);
  };
  const [appointments] = await db.query<BusyRow[]>(
    `SELECT doctor_id, FLOOR(TIME_TO_SEC(appointment_time) / 60) AS start_minutes
     FROM appointments
     WHERE organization_id = ? AND appointment_date = ?
       AND status IN ('SCHEDULED', 'CONFIRMED')`,
    [organizationId, date],
  );
  for (const row of appointments) {
    push(row.doctor_id, Number(row.start_minutes));
  }
  const [suggestions] = await db.query<BusyRow[]>(
    `SELECT doctor_id, FLOOR(TIME_TO_SEC(slot_time) / 60) AS start_minutes
     FROM lead_slot_suggestions
     WHERE organization_id = ? AND slot_date = ? AND status = 'PENDING'`,
    [organizationId, date],
  );
  for (const row of suggestions) {
    push(row.doctor_id, Number(row.start_minutes));
  }
  return { shared, byDoctor };
}

function slotsForDoctor(
  clinic: ClinicContext,
  doctor: DoctorRow,
  date: string,
  now: Date,
  occupied: { shared: number[]; byDoctor: Map<number, number[]> },
): string[] {
  const window = doctorWindow(doctor, date, clinic);
  const starts = [...(occupied.byDoctor.get(doctor.id) ?? []), ...occupied.shared];
  return listDaySlots({
    date,
    timeZone: clinic.timezone,
    now,
    slotMinutes: clinic.settings.slotMinutes,
    bufferMinutes: clinic.settings.bufferMinutes,
    minNoticeMinutes: clinic.settings.minNoticeMinutes,
    window,
    occupiedStartMinutes: starts,
    occupiedMinutes: Math.max(clinic.settings.slotMinutes, doctor.slot_minutes),
  });
}

export async function findClinicBySiteKey(db: Pool, siteKey: string): Promise<OrgRow | null> {
  const key = siteKey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) {
    return null;
  }
  const [rows] = await db.query<OrgRow[]>(
    `SELECT id, name, status, timezone, phone, address, logo_url, business_hours,
            plan, trial_ends_at, paid_until, site_key
     FROM organizations WHERE site_key = ?`,
    [key],
  );
  const org = rows[0];
  if (org === undefined || org.status !== 'active') {
    return null;
  }
  return org;
}

function present(clinic: ClinicContext, doctors: DoctorRow[], now: Date): PublicBookingView {
  if (clinic.readOnly || !clinic.settings.enabled) {
    return unavailable(clinic.name);
  }
  const bounds = bookingDateBounds(now, clinic.timezone, clinic.settings.maxDaysAhead);
  return {
    available: true,
    clinic: {
      name: clinic.name,
      phone: clinic.phone,
      address: clinic.address,
      logoUrl: clinic.logoUrl,
      timezone: clinic.timezone,
    },
    booking: {
      slotMinutes: clinic.settings.slotMinutes,
      minNoticeMinutes: clinic.settings.minNoticeMinutes,
      maxDaysAhead: clinic.settings.maxDaysAhead,
      confirmation: clinic.settings.autoConfirm ? 'confirmed' : 'pending',
    },
    doctors: doctors.map((doctor) => ({
      id: doctor.id,
      name: doctor.name,
      specialty: doctor.specialty,
    })),
    today: bounds.today,
    lastDate: bounds.lastDate,
  };
}

export async function getPublicBooking(
  db: Pool,
  siteKey: string,
  now = new Date(),
): Promise<PublicBookingView | null> {
  const org = await findClinicBySiteKey(db, siteKey);
  if (org === null) {
    return null;
  }
  const clinic = await loadContext(db, org, now);
  const doctors = clinic.readOnly || !clinic.settings.enabled ? [] : await loadDoctors(db, org.id);
  return present(clinic, doctors, now);
}

export async function getPublicSlots(
  db: Pool,
  siteKey: string,
  dateRaw: unknown,
  doctorRaw: unknown,
  now = new Date(),
): Promise<{ date: string; timezone: string; slots: string[] }> {
  const org = await findClinicBySiteKey(db, siteKey);
  if (org === null) {
    throw new AppError('Booking page not found', 404, 'not_found', true);
  }
  const clinic = await loadContext(db, org, now);
  if (clinic.readOnly || !clinic.settings.enabled) {
    throw new AppError(NOT_AVAILABLE, 403, 'booking_unavailable', true);
  }
  const date = parseDateOnly(dateRaw, 'date');
  const bounds = bookingDateBounds(now, clinic.timezone, clinic.settings.maxDaysAhead);
  if (!dateInBookingWindow(date, bounds.today, bounds.lastDate)) {
    throw new ValidationError('Invalid input', ['date is outside the booking window']);
  }
  const doctors = await loadDoctors(db, org.id);
  const selected = selectDoctors(doctors, doctorRaw);
  const occupied = await occupiedByDoctor(db, org.id, date);
  const slots = new Set<string>();
  for (const doctor of selected) {
    for (const slot of slotsForDoctor(clinic, doctor, date, now, occupied)) {
      slots.add(slot);
    }
  }
  return { date, timezone: clinic.timezone, slots: [...slots].sort() };
}

function selectDoctors(doctors: DoctorRow[], doctorRaw: unknown): DoctorRow[] {
  if (doctorRaw === undefined || doctorRaw === null || doctorRaw === '' || doctorRaw === 'any') {
    return doctors;
  }
  const id = Number(doctorRaw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError('Invalid input', ['doctorId must be a doctor or omitted']);
  }
  const doctor = doctors.find((row) => row.id === id);
  if (doctor === undefined) {
    throw new AppError('That doctor is not available', 409, 'doctor_unavailable', true);
  }
  return [doctor];
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.split(/\s+/);
  const firstName = parts[0] ?? '';
  const rest = parts.slice(1).join(' ');
  const lastName = rest === '' ? '-' : rest;
  if (firstName.length > 80 || lastName.length > 80) {
    throw new ValidationError('Invalid input', ['name must be at most 80 characters in each part']);
  }
  return { firstName, lastName };
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ER_DUP_ENTRY'
  );
}

export interface OnlineBookingRequest {
  siteKey: string;
  body: Record<string, unknown>;
  now?: Date;
}

export interface OnlineBookingResult {
  accepted: true;
  appointmentId?: number;
  confirmation: 'pending' | 'confirmed';
  date?: string;
  time?: string;
  doctorName?: string;
  clinicName?: string;
  emailSent: boolean;
}

export function honeypotTripped(body: Record<string, unknown>): boolean {
  const value = body.companyWebsite;
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  return true;
}

async function findOrCreatePatient(
  conn: PoolConnection,
  organizationId: number,
  firstName: string,
  lastName: string,
  phone: string,
  email: string,
): Promise<number> {
  const [byPhone] = await conn.query<PatientRow[]>(
    'SELECT id, email FROM patients WHERE organization_id = ? AND phone = ? FOR UPDATE',
    [organizationId, phone],
  );
  const phoneMatch = byPhone[0];
  if (phoneMatch !== undefined) {
    if (phoneMatch.email === null) {
      await conn.query('UPDATE patients SET email = ? WHERE id = ? AND email IS NULL', [
        email,
        phoneMatch.id,
      ]);
    }
    return phoneMatch.id;
  }
  const [byEmail] = await conn.query<PatientRow[]>(
    `SELECT id, email FROM patients
     WHERE organization_id = ? AND email = ?
     ORDER BY id ASC LIMIT 1 FOR UPDATE`,
    [organizationId, email],
  );
  const emailMatch = byEmail[0];
  if (emailMatch !== undefined) {
    return emailMatch.id;
  }
  try {
    const [inserted] = await conn.query<ResultSetHeader>(
      `INSERT INTO patients (organization_id, first_name, last_name, phone, email, notes, created_by)
       VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
      [organizationId, firstName, lastName, phone, email],
    );
    return inserted.insertId;
  } catch (err) {
    if (!isDuplicateKey(err)) {
      throw err;
    }
    const [again] = await conn.query<PatientRow[]>(
      'SELECT id, email FROM patients WHERE organization_id = ? AND phone = ?',
      [organizationId, phone],
    );
    const row = again[0];
    if (row === undefined) {
      throw err;
    }
    return row.id;
  }
}

export async function createOnlineBooking(
  db: Pool,
  logger: Logger,
  mailer: BookingMailer,
  input: OnlineBookingRequest,
): Promise<OnlineBookingResult> {
  const now = input.now ?? new Date();
  const org = await findClinicBySiteKey(db, input.siteKey);
  if (org === null) {
    throw new AppError('Booking page not found', 404, 'not_found', true);
  }
  if (honeypotTripped(input.body)) {
    return { accepted: true, confirmation: 'pending', emailSent: false };
  }

  const body = input.body;
  const name = requireString(body.name, 'name', { min: 1, max: 160 });
  const { firstName, lastName } = splitName(name);
  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);
  const reason = requireString(body.reason, 'reason', { min: 1, max: 120 });
  const notes = optionalText(body.notes, 'notes', 2000);
  const date = parseDateOnly(body.date, 'date');
  const time = hhmm(parseTimeOnly(body.time, 'time'));
  if (body.consent !== true) {
    throw new ValidationError('Invalid input', ['consent is required']);
  }
  const doctorRaw = body.doctorId;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [lockedOrg] = await conn.query<OrgRow[]>(
      `SELECT id, name, status, timezone, phone, address, logo_url, business_hours,
              plan, trial_ends_at, paid_until, site_key
       FROM organizations WHERE id = ? FOR UPDATE`,
      [org.id],
    );
    const current = lockedOrg[0];
    if (current === undefined || current.status !== 'active') {
      throw new AppError('Booking page not found', 404, 'not_found', true);
    }
    const clinic = await loadContext(conn, current, now);
    if (clinic.readOnly || !clinic.settings.enabled) {
      throw new AppError(NOT_AVAILABLE, 403, 'booking_unavailable', true);
    }
    const bounds = bookingDateBounds(now, clinic.timezone, clinic.settings.maxDaysAhead);
    if (!dateInBookingWindow(date, bounds.today, bounds.lastDate)) {
      throw new ValidationError('Invalid input', ['date is outside the booking window']);
    }

    await conn.query(
      'SELECT id FROM doctors WHERE organization_id = ? AND is_active = 1 ORDER BY id FOR UPDATE',
      [org.id],
    );
    const doctors = await loadDoctors(conn, org.id);
    const selected = selectDoctors(doctors, doctorRaw);
    const occupied = await occupiedByDoctor(conn, org.id, date);
    const chosen = selected.find((doctor) =>
      slotsForDoctor(clinic, doctor, date, now, occupied).includes(time),
    );
    if (chosen === undefined) {
      throw new AppError('That time is no longer available', 409, 'slot_unavailable', true);
    }

    const patientId = await findOrCreatePatient(conn, org.id, firstName, lastName, phone, email);
    const leadNotes = [
      'Consent to be contacted: yes',
      `source=online booking`,
      notes === null ? null : notes,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
    const [leadInsert] = await conn.query<ResultSetHeader>(
      `INSERT INTO leads (organization_id, first_name, last_name, phone, email, requested_service,
         source, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'ONLINE_BOOKING', 'NEW', ?, NULL)`,
      [org.id, firstName, lastName, phone, email, reason, leadNotes],
    );
    const leadId = leadInsert.insertId;
    const confirmed = clinic.settings.autoConfirm;
    const status = confirmed ? 'CONFIRMED' : 'SCHEDULED';
    const [appointmentInsert] = await conn.query<ResultSetHeader>(
      `INSERT INTO appointments
         (organization_id, patient_id, lead_id, appointment_date, appointment_time,
          status, service, provider, doctor_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [org.id, patientId, leadId, date, `${time}:00`, status, reason, chosen.name, chosen.id],
    );
    const appointmentId = appointmentInsert.insertId;
    await conn.query(
      `DELETE h FROM booking_slot_holds h
       INNER JOIN appointments a ON a.id = h.appointment_id
       WHERE h.doctor_id = ? AND h.slot_date = ? AND h.slot_time = ?
         AND a.status NOT IN ('SCHEDULED', 'CONFIRMED')`,
      [chosen.id, date, `${time}:00`],
    );
    try {
      await conn.query(
        `INSERT INTO booking_slot_holds
           (organization_id, doctor_id, slot_date, slot_time, appointment_id)
         VALUES (?, ?, ?, ?, ?)`,
        [org.id, chosen.id, date, `${time}:00`, appointmentId],
      );
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new AppError('That time is no longer available', 409, 'slot_unavailable', true);
      }
      throw err;
    }
    const detail = `source=online booking; ${confirmed ? 'confirmed' : 'pending'}; ${date} ${time}`;
    await conn.query(
      'INSERT INTO lead_activities (lead_id, actor_user_id, action, detail) VALUES (?, NULL, ?, ?)',
      [leadId, 'online_booking', detail],
    );
    await conn.query('UPDATE leads SET last_activity_at = UTC_TIMESTAMP() WHERE id = ?', [leadId]);
    await conn.commit();

    await recordAudit(db, logger, {
      organizationId: org.id,
      userId: null,
      action: 'online_booking.created',
      detail: `lead=${leadId} appointment=${appointmentId} source=online booking`,
    });
    logger.info('online booking created', {
      organizationId: org.id,
      appointmentId,
      leadId,
      status,
    });

    let emailSent = false;
    try {
      const mailed = await mailer.sendBookingConfirmation({
        to: email,
        clinicName: clinic.name,
        whenLabel: `${date} ${time} (${clinic.timezone})`,
        doctorName: chosen.name,
        confirmed,
      });
      emailSent = mailed.sent;
    } catch (err) {
      logger.warn('booking confirmation email failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      accepted: true,
      appointmentId,
      confirmation: confirmed ? 'confirmed' : 'pending',
      date,
      time,
      doctorName: chosen.name,
      clinicName: clinic.name,
      emailSent,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export interface BookingSettingsView {
  enabled: boolean;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  autoConfirm: boolean;
  siteKey: string;
  path: string;
}

async function ensureSiteKey(db: Pool, organizationId: number, current: string | null): Promise<string> {
  if (current !== null && current !== '') {
    return current;
  }
  const generated = generateSiteKey();
  await db.query('UPDATE organizations SET site_key = ? WHERE id = ? AND site_key IS NULL', [
    generated,
    organizationId,
  ]);
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT site_key FROM organizations WHERE id = ?',
    [organizationId],
  );
  const key = rows[0]?.site_key;
  return typeof key === 'string' && key !== '' ? key : generated;
}

export async function getBookingSettings(db: Pool, organizationId: number): Promise<BookingSettingsView> {
  const [rows] = await db.query<OrgRow[]>(
    'SELECT id, site_key, name, status, timezone, phone, address, logo_url, business_hours, plan, trial_ends_at, paid_until FROM organizations WHERE id = ?',
    [organizationId],
  );
  const org = rows[0];
  if (org === undefined) {
    throw new AppError('Organization not found', 404, 'not_found', true);
  }
  const siteKey = await ensureSiteKey(db, organizationId, org.site_key);
  const settings = await loadSettings(db, organizationId);
  return {
    ...settings,
    siteKey,
    path: `/book/${siteKey}`,
  };
}

export async function saveBookingSettings(
  db: Pool,
  logger: Logger,
  organizationId: number,
  actorId: number,
  body: unknown,
): Promise<BookingSettingsView> {
  const settings = parseOnlineBookingSettings(body);
  const [orgs] = await db.query<RowDataPacket[]>('SELECT id FROM organizations WHERE id = ?', [
    organizationId,
  ]);
  if (orgs[0] === undefined) {
    throw new AppError('Organization not found', 404, 'not_found', true);
  }
  await db.query(
    `INSERT INTO organization_settings (organization_id, meta_key, meta_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
    [organizationId, SETTINGS_KEY, JSON.stringify(settings)],
  );
  await recordAudit(db, logger, {
    organizationId,
    userId: actorId,
    action: 'online_booking.settings',
    detail: settings.enabled ? 'enabled' : 'disabled',
  });
  return getBookingSettings(db, organizationId);
}
