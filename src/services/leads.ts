import type { Pool, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import { appointmentsForLead } from './appointments';
import { messageDto } from './messages';
import type { MessageRow } from './messages';
import {
  normalizePhone,
  optionalEmail,
  optionalText,
  optionalUserId,
  parseDateOnly,
  parseListParams,
  requireChoice,
  requireString,
} from '../validate';

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'APPOINTMENT_BOOKED',
  'LOST',
  'CLOSED',
] as const;

export const LEAD_SOURCES = ['WEBSITE', 'MISSED_CALL', 'MANUAL', 'OTHER'] as const;

export const ACTIVE_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'APPOINTMENT_BOOKED'] as const;

const UPDATABLE_LEAD_FIELDS = [
  'status',
  'firstName',
  'lastName',
  'phone',
  'email',
  'requestedService',
  'assignedUserId',
  'notes',
] as const;

interface LeadRow extends RowDataPacket {
  id: number;
  organization_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  requested_service: string | null;
  source: string;
  status: string;
  assigned_user_id: number | null;
  assigned_user_email: string | null;
  notes: string | null;
  last_activity_at: Date;
  urgency_level: string;
  urgency_score: number;
  urgency_reasons: string | null;
  urgency_computed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ActivityRow extends RowDataPacket {
  id: number;
  action: string;
  detail: string | null;
  actor_user_id: number | null;
  actor_email: string | null;
  created_at: Date;
}

interface LeadDetailRow extends RowDataPacket {
  id: number;
  email: string | null;
}

const LEAD_SELECT = `SELECT l.id, l.organization_id, l.first_name, l.last_name, l.phone, l.email,
    l.requested_service, l.source, l.status, l.assigned_user_id, au.email AS assigned_user_email,
    l.notes, l.last_activity_at, l.urgency_level, l.urgency_score, l.urgency_reasons,
    l.urgency_computed_at, l.created_at, l.updated_at
  FROM leads l
  LEFT JOIN users au ON au.id = l.assigned_user_id`;

function parseUrgencyReasons(raw: string | null): string[] {
  if (raw === null || raw === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function leadDto(row: LeadRow): Record<string, unknown> {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    requestedService: row.requested_service,
    source: row.source,
    status: row.status,
    assignedUserId: row.assigned_user_id,
    assignedUserEmail: row.assigned_user_email,
    notes: row.notes,
    lastActivityAt: row.last_activity_at,
    urgencyLevel: row.urgency_level,
    urgencyScore: row.urgency_score,
    urgencyReasons: parseUrgencyReasons(row.urgency_reasons),
    urgencyComputedAt: row.urgency_computed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

async function assertAssignedUserInOrg(
  db: Pool,
  organizationId: number,
  assignedUserId: number | null,
): Promise<void> {
  if (assignedUserId === null) {
    return;
  }
  const [rows] = await db.query<LeadDetailRow[]>(
    'SELECT id, email FROM users WHERE id = ? AND organization_id = ?',
    [assignedUserId, organizationId],
  );
  if (rows[0] === undefined) {
    throw new ValidationError('Invalid input', ['assignedUserId must belong to this clinic']);
  }
}

async function assertNoActiveDuplicate(
  db: Pool,
  organizationId: number,
  phone: string,
  excludeLeadId: number | null,
): Promise<void> {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
  const params: unknown[] = [organizationId, phone, ...ACTIVE_STATUSES];
  let sql = `SELECT id FROM leads WHERE organization_id = ? AND phone = ? AND status IN (${placeholders})`;
  if (excludeLeadId !== null) {
    sql += ' AND id != ?';
    params.push(excludeLeadId);
  }
  const [rows] = await db.query<LeadDetailRow[]>(sql, params);
  if (rows[0] !== undefined) {
    throw new AppError(
      'An active lead with this phone number already exists for this clinic',
      409,
      'duplicate_lead',
      true,
    );
  }
}

async function writeActivity(
  db: Pool,
  logger: Logger,
  leadId: number,
  actorId: number | null,
  action: string,
  detail: string | null,
): Promise<void> {
  await db.query(
    'INSERT INTO lead_activities (lead_id, actor_user_id, action, detail) VALUES (?, ?, ?, ?)',
    [leadId, actorId, action, detail],
  );
  await db.query('UPDATE leads SET last_activity_at = UTC_TIMESTAMP() WHERE id = ?', [leadId]);
  logger.info('lead activity recorded', { leadId, action });
}

export async function recordLeadActivity(
  db: Pool,
  logger: Logger,
  leadId: number,
  actorId: number | null,
  action: string,
  detail: string | null,
): Promise<void> {
  await writeActivity(db, logger, leadId, actorId, action, detail);
}

const BOOKING_CLOSED_STATUSES = ['LOST', 'CLOSED'] as const;

export interface MarkLeadAppointmentBookedInput {
  organizationId: number;
  leadId: number;
  actorId: number;
}

export async function markLeadAppointmentBooked(
  db: Pool,
  logger: Logger,
  input: MarkLeadAppointmentBookedInput,
): Promise<boolean> {
  const [rows] = await db.query<LeadRow[]>(
    'SELECT id, status FROM leads WHERE id = ? AND organization_id = ?',
    [input.leadId, input.organizationId],
  );
  const lead = rows[0];
  if (lead === undefined) {
    return false;
  }
  if (
    lead.status === 'APPOINTMENT_BOOKED' ||
    (BOOKING_CLOSED_STATUSES as readonly string[]).includes(lead.status)
  ) {
    return false;
  }
  const previous = lead.status;
  const [result] = await db.query(
    `UPDATE leads SET status = 'APPOINTMENT_BOOKED', last_activity_at = UTC_TIMESTAMP()
     WHERE id = ? AND organization_id = ? AND status = ?`,
    [input.leadId, input.organizationId, previous],
  );
  if ((result as { affectedRows: number }).affectedRows === 0) {
    return false;
  }
  await writeActivity(
    db,
    logger,
    input.leadId,
    input.actorId,
    'status_changed',
    `status: ${previous} -> APPOINTMENT_BOOKED (appointment booked)`,
  );
  logger.info('lead marked appointment booked', {
    leadId: input.leadId,
    organizationId: input.organizationId,
    previousStatus: previous,
  });
  return true;
}

export interface CreateLeadInput {
  organizationId: number;
  actorId: number;
  body: unknown;
}

export async function createLead(db: Pool, logger: Logger, input: CreateLeadInput): Promise<Record<string, unknown>> {
  if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  const body = input.body as Record<string, unknown>;
  const firstName = requireString(body.firstName, 'firstName', { min: 1, max: 80 });
  const lastName = requireString(body.lastName, 'lastName', { min: 1, max: 80 });
  const phone = normalizePhone(body.phone);
  const email = optionalEmail(body.email);
  const requestedService = optionalText(body.requestedService, 'requestedService', 120);
  const source = requireChoice(body.source, LEAD_SOURCES, 'source');
  const status =
    body.status === undefined ? 'NEW' : requireChoice(body.status, LEAD_STATUSES, 'status');
  const notes = optionalText(body.notes, 'notes', 5000);
  const assignedUserId = optionalUserId(body.assignedUserId, 'assignedUserId');

  await assertAssignedUserInOrg(db, input.organizationId, assignedUserId);
  await assertNoActiveDuplicate(db, input.organizationId, phone, null);

  const [result] = await db.query(
    `INSERT INTO leads (organization_id, first_name, last_name, phone, email, requested_service,
       source, status, assigned_user_id, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.organizationId,
      firstName,
      lastName,
      phone,
      email,
      requestedService,
      source,
      status,
      assignedUserId,
      notes,
      input.actorId,
    ],
  );
  const leadId = (result as { insertId: number }).insertId;
  await writeActivity(db, logger, leadId, input.actorId, 'created', `source=${source} status=${status}`);

  const [rows] = await db.query<LeadRow[]>(`${LEAD_SELECT} WHERE l.id = ?`, [leadId]);
  return { lead: leadDto(rows[0] as LeadRow) };
}

const PUBLIC_FORBIDDEN_FIELDS = ['status', 'source', 'assignedUserId', 'organizationId'] as const;

export interface CreatePublicLeadInput {
  organizationId: number;
  body: unknown;
}

export async function createPublicLead(
  db: Pool,
  logger: Logger,
  input: CreatePublicLeadInput,
): Promise<number> {
  if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  const body = input.body as Record<string, unknown>;
  for (const field of PUBLIC_FORBIDDEN_FIELDS) {
    if (body[field] !== undefined) {
      throw new ValidationError('Invalid input', [`${field} is not accepted on this endpoint`]);
    }
  }
  const firstName = requireString(body.firstName, 'firstName', { min: 1, max: 80 });
  const lastName = requireString(body.lastName, 'lastName', { min: 1, max: 80 });
  const phone = normalizePhone(body.phone);
  const email = optionalEmail(body.email);
  const requestedService = optionalText(body.requestedService, 'requestedService', 120);
  const notes = optionalText(body.notes, 'notes', 5000);

  await assertNoActiveDuplicate(db, input.organizationId, phone, null);

  const [result] = await db.query(
    `INSERT INTO leads (organization_id, first_name, last_name, phone, email, requested_service,
       source, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, 'WEBSITE', 'NEW', ?)`,
    [input.organizationId, firstName, lastName, phone, email, requestedService, notes],
  );
  const leadId = (result as { insertId: number }).insertId;
  await writeActivity(db, logger, leadId, null, 'created', 'source=WEBSITE status=NEW');
  logger.info('public lead created', { organizationId: input.organizationId, leadId });
  return leadId;
}

export interface LeadListQuery {
  organizationId: number;
  query: Record<string, unknown>;
}

export async function listLeads(
  db: Pool,
  input: LeadListQuery,
): Promise<{ leads: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { limit, offset } = parseListParams(input.query);

  const where: string[] = ['l.organization_id = ?'];
  const params: unknown[] = [input.organizationId];

  const q = input.query.q;
  if (q !== undefined && q !== '') {
    if (typeof q !== 'string' || q.length > 100) {
      throw new ValidationError('Invalid input', ['q must be a string of at most 100 characters']);
    }
    const pattern = `%${escapeLike(q)}%`;
    where.push(
      `(l.first_name LIKE ? ESCAPE '\\\\' OR l.last_name LIKE ? ESCAPE '\\\\' OR l.phone LIKE ? ESCAPE '\\\\' OR l.email LIKE ? ESCAPE '\\\\')`,
    );
    params.push(pattern, pattern, pattern, pattern);
  }
  if (input.query.status !== undefined) {
    where.push('l.status = ?');
    params.push(requireChoice(input.query.status, LEAD_STATUSES, 'status'));
  }
  if (input.query.source !== undefined) {
    where.push('l.source = ?');
    params.push(requireChoice(input.query.source, LEAD_SOURCES, 'source'));
  }
  if (input.query.from !== undefined) {
    where.push('l.created_at >= ?');
    params.push(`${parseDateOnly(input.query.from, 'from')} 00:00:00`);
  }
  if (input.query.to !== undefined) {
    where.push('l.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(`${parseDateOnly(input.query.to, 'to')} 00:00:00`);
  }
  if (input.query.assignedUserId !== undefined) {
    const rawAssigned = input.query.assignedUserId;
    if (rawAssigned === '' || rawAssigned === null) {
      where.push('l.assigned_user_id IS NULL');
    } else {
      const assigned = Number(rawAssigned);
      if (!Number.isInteger(assigned) || assigned <= 0) {
        throw new ValidationError('Invalid input', ['assignedUserId must be a positive integer or null']);
      }
      where.push('l.assigned_user_id = ?');
      params.push(assigned);
    }
  }

  const whereSql = where.join(' AND ');
  const [countRows] = await db.query<LeadDetailRow[]>(
    `SELECT COUNT(*) AS id FROM leads l WHERE ${whereSql}`,
    params,
  );
  const total = countRows[0]?.id ?? 0;

  const [rows] = await db.query<LeadRow[]>(
    `${LEAD_SELECT} WHERE ${whereSql} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { leads: rows.map(leadDto), total, limit, offset };
}

async function loadLead(db: Pool, organizationId: number, leadId: number): Promise<LeadRow | null> {
  const [rows] = await db.query<LeadRow[]>(`${LEAD_SELECT} WHERE l.id = ? AND l.organization_id = ?`, [
    leadId,
    organizationId,
  ]);
  return rows[0] ?? null;
}

export async function getLeadDetail(
  db: Pool,
  organizationId: number,
  leadId: number,
): Promise<Record<string, unknown> | null> {
  const lead = await loadLead(db, organizationId, leadId);
  if (lead === null) {
    return null;
  }
  const [activities] = await db.query<ActivityRow[]>(
    `SELECT a.id, a.action, a.detail, a.actor_user_id, u.email AS actor_email, a.created_at
     FROM lead_activities a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.lead_id = ?
     ORDER BY a.created_at ASC, a.id ASC`,
    [leadId],
  );
  const appointments = await appointmentsForLead(db, leadId);
  const [communications] = await db.query<MessageRow[]>(
    'SELECT * FROM communication_messages WHERE lead_id = ? ORDER BY created_at DESC, id DESC',
    [leadId],
  );
  return {
    lead: leadDto(lead),
    notes: lead.notes,
    activity: activities.map((row) => ({
      id: row.id,
      action: row.action,
      detail: row.detail,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email,
      createdAt: row.created_at,
    })),
    communicationHistory: communications.map((row) => messageDto(row)),
    appointments,
  };
}

export interface UpdateLeadInput {
  organizationId: number;
  leadId: number;
  actorId: number;
  actorRole: string;
  body: unknown;
}

export async function updateLead(
  db: Pool,
  logger: Logger,
  input: UpdateLeadInput,
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
    if (!(UPDATABLE_LEAD_FIELDS as readonly string[]).includes(key)) {
      throw new ValidationError('Invalid input', [`unknown or not updatable field: ${key}`]);
    }
  }
  if (input.actorRole === 'receptionist') {
    const disallowed = provided.filter((key) => key !== 'status');
    if (disallowed.length > 0) {
      throw new AppError('Receptionists may only update the lead status', 403, 'forbidden', true);
    }
  }

  const existing = await loadLead(db, input.organizationId, input.leadId);
  if (existing === null) {
    throw new AppError('Lead not found', 404, 'not_found', true);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: string[] = [];
  let statusChanged = false;

  function apply(column: string, dtoName: string, value: unknown, previous: unknown): void {
    sets.push(`${column} = ?`);
    params.push(value);
    if (value !== previous) {
      changed.push(dtoName);
    }
  }

  if (body.status !== undefined) {
    const status = requireChoice(body.status, LEAD_STATUSES, 'status');
    statusChanged = status !== existing.status;
    apply('status', 'status', status, existing.status);
  }
  if (body.firstName !== undefined) {
    apply('first_name', 'firstName', requireString(body.firstName, 'firstName', { min: 1, max: 80 }), existing.first_name);
  }
  if (body.lastName !== undefined) {
    apply('last_name', 'lastName', requireString(body.lastName, 'lastName', { min: 1, max: 80 }), existing.last_name);
  }
  if (body.phone !== undefined) {
    const phone = normalizePhone(body.phone);
    await assertNoActiveDuplicate(db, input.organizationId, phone, input.leadId);
    apply('phone', 'phone', phone, existing.phone);
  }
  if (body.email !== undefined) {
    apply('email', 'email', optionalEmail(body.email), existing.email);
  }
  if (body.requestedService !== undefined) {
    apply(
      'requested_service',
      'requestedService',
      optionalText(body.requestedService, 'requestedService', 120),
      existing.requested_service,
    );
  }
  if (body.assignedUserId !== undefined) {
    const assigned = optionalUserId(body.assignedUserId, 'assignedUserId');
    await assertAssignedUserInOrg(db, input.organizationId, assigned);
    apply('assigned_user_id', 'assignedUserId', assigned, existing.assigned_user_id);
  }
  if (body.notes !== undefined) {
    apply('notes', 'notes', optionalText(body.notes, 'notes', 5000), existing.notes);
  }

  if (changed.length === 0) {
    const current = await loadLead(db, input.organizationId, input.leadId);
    return { lead: leadDto(current as LeadRow) };
  }

  sets.push('last_activity_at = UTC_TIMESTAMP()');
  await db.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`, [
    ...params,
    input.leadId,
    input.organizationId,
  ]);

  if (statusChanged) {
    await writeActivity(
      db,
      logger,
      input.leadId,
      input.actorId,
      'status_changed',
      `status: ${existing.status} -> ${String(body.status)}`,
    );
  }
  const otherChanges = changed.filter((field) => field !== 'status');
  if (otherChanges.length > 0) {
    await writeActivity(
      db,
      logger,
      input.leadId,
      input.actorId,
      'updated',
      `fields: ${otherChanges.join(', ')}`,
    );
  }

  const updated = await loadLead(db, input.organizationId, input.leadId);
  return { lead: leadDto(updated as LeadRow) };
}

export async function deleteLead(
  db: Pool,
  logger: Logger,
  organizationId: number,
  leadId: number,
  actorId: number,
): Promise<boolean> {
  const existing = await loadLead(db, organizationId, leadId);
  if (existing === null) {
    return false;
  }
  await db.query('DELETE FROM leads WHERE id = ? AND organization_id = ?', [leadId, organizationId]);
  await recordAudit(db, logger, {
    organizationId,
    userId: actorId,
    action: 'lead_deleted',
    detail: `id=${leadId}`,
  });
  return true;
}
