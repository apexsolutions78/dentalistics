import type { Pool, RowDataPacket } from 'mysql2/promise';

export const WORKSPACE_ITEM_CAP = 20;
export const WORKSPACE_TASK_CAP = 50;
export const WORKSPACE_WINDOW_DAYS = 30;
export const WORKSPACE_REPLY_BODY_LIMIT = 160;

export const WORKSPACE_DEFINITIONS: Record<string, string> = {
  dateBasis:
    '`date` is the clinic-local calendar date computed from organizations.timezone ' +
    "(IANA, Intl.DateTimeFormat 'en-CA'); invalid or missing timezone falls back to UTC. " +
    'Instant windows use UTC instants. Day-granularity anchors (appointment_date, due_date, ' +
    'no-show window) compare clinic-local dates.',
  windows:
    `missedCalls, patientReplies and noShows cover the last ${WORKSPACE_WINDOW_DAYS} days ` +
    '(30-day instant window for occurred_at/created_at; 30-day clinic-date window for ' +
    'appointment_date). upcomingAppointments covers clinic today onward (SCHEDULED or ' +
    'CONFIRMED). tasks only include appointments needing confirmation on clinic today or ' +
    'tomorrow, and recalls due on or before the clinic date. newLeads and ' +
    'recallOpportunities are uncapped backlogs (status-scoped, any age).',
  caps:
    `Each queue returns at most ${WORKSPACE_ITEM_CAP} items (tasks: ${WORKSPACE_TASK_CAP}); ` +
    '`count` is always the full uncapped number of matching rows.',
  'queues.newLeads':
    "Leads with current status 'NEW' (any age), ordered created_at ASC - waiting longest first.",
  'queues.missedCalls':
    "call_events with call_outcome IN ('MISSED','REJECTED','BUSY') (the recovery-outcome " +
    `set) and occurred_at in the last ${WORKSPACE_WINDOW_DAYS} days, ordered occurred_at DESC. ` +
    "ANSWERED calls are excluded (no action required).",
  'queues.patientReplies':
    `INBOUND messages with created_at in the last ${WORKSPACE_WINDOW_DAYS} days, ordered ` +
    `created_at DESC; body is truncated to ${WORKSPACE_REPLY_BODY_LIMIT} characters with '...'.`,
  'queues.upcomingAppointments':
    "Appointments with appointment_date >= clinic today and current status IN " +
    "('SCHEDULED','CONFIRMED'), ordered date ASC then time ASC; `needsConfirmation` is true " +
    "exactly when status = 'SCHEDULED'.",
  'queues.noShows':
    `Appointments with current status 'NO_SHOW' and appointment_date between (clinic today - ` +
    `${WORKSPACE_WINDOW_DAYS} days) and clinic today, ordered appointment_date DESC.`,
  'queues.recallOpportunities':
    "Recalls with current status 'DUE' (any due_date), ordered due_date ASC; `daysSinceDue` " +
    'is (clinic date - due_date) in whole days, signed - positive means overdue.',
  'queues.tasks':
    'The actionable union required by plan L1156, in the plan\'s own priority order (L1150-' +
    '1156): NEW leads -> missed calls (30d) -> patient replies (30d) -> appointments needing ' +
    "confirmation (status 'SCHEDULED', appointment_date in [clinic today, clinic tomorrow]) " +
    "-> no-shows (30d) -> recalls with due_date <= clinic today. Each item carries `queue`, " +
    '`type` (action-oriented slug), `id`, `label` and `at` (ISO instant when the source row ' +
    'has one, otherwise the clinic date).',
};

export interface WorkspaceQueue<TItem> {
  count: number;
  items: TItem[];
}

export interface NewLeadItem {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  source: string;
  createdAt: string;
}

export interface MissedCallItem {
  id: number;
  callerNumber: string;
  calledNumber: string;
  callOutcome: string;
  disposition: string;
  occurredAt: string;
  leadId: number | null;
  patientId: number | null;
}

export interface PatientReplyItem {
  id: number;
  channel: string;
  recipient: string;
  body: string;
  leadId: number | null;
  createdAt: string;
}

export interface UpcomingAppointmentItem {
  id: number;
  patientId: number;
  patientName: string;
  date: string;
  time: string;
  status: string;
  service: string | null;
  needsConfirmation: boolean;
}

export interface NoShowItem {
  id: number;
  patientId: number;
  patientName: string;
  date: string;
  time: string;
}

export interface RecallOpportunityItem {
  id: number;
  patientId: number;
  patientName: string;
  dueDate: string;
  daysSinceDue: number;
}

export type TaskQueue =
  | 'newLeads'
  | 'missedCalls'
  | 'patientReplies'
  | 'upcomingAppointments'
  | 'noShows'
  | 'recallOpportunities';

export interface TaskItem {
  queue: TaskQueue;
  type: string;
  id: number;
  label: string;
  at: string;
}

export interface ReceptionistWorkspace {
  date: string;
  timezone: string;
  generatedAt: string;
  queues: {
    newLeads: WorkspaceQueue<NewLeadItem>;
    missedCalls: WorkspaceQueue<MissedCallItem>;
    patientReplies: WorkspaceQueue<PatientReplyItem>;
    upcomingAppointments: WorkspaceQueue<UpcomingAppointmentItem>;
    noShows: WorkspaceQueue<NoShowItem>;
    recallOpportunities: WorkspaceQueue<RecallOpportunityItem>;
    tasks: WorkspaceQueue<TaskItem>;
  };
  definitions: Record<string, string>;
}

interface TimezoneRow extends RowDataPacket {
  timezone: string | null;
}

interface LeadRow extends RowDataPacket {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  source: string;
  created_at: Date;
}

interface CallEventRow extends RowDataPacket {
  id: number;
  caller_number: string;
  called_number: string;
  call_outcome: string;
  disposition: string;
  occurred_at: Date;
  lead_id: number | null;
  patient_id: number | null;
}

interface InboundRow extends RowDataPacket {
  id: number;
  channel: string;
  recipient: string;
  body: string;
  lead_id: number | null;
  created_at: Date;
}

interface AppointmentRow extends RowDataPacket {
  id: number;
  appointment_date: string;
  appointment_time: string;
  status: string;
  service: string | null;
  patient_id: number;
  first_name: string;
  last_name: string;
}

interface RecallRow extends RowDataPacket {
  id: number;
  due_date: string;
  patient_id: number;
  first_name: string;
  last_name: string;
}

export function clinicDate(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function instantBefore(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function truncateBody(body: string): string {
  if (body.length <= WORKSPACE_REPLY_BODY_LIMIT) {
    return body;
  }
  return `${body.slice(0, WORKSPACE_REPLY_BODY_LIMIT - 3)}...`;
}

function fullName(first: string, last: string): string {
  return `${first} ${last}`.trim();
}

function queue<TItem>(rows: TItem[]): WorkspaceQueue<TItem> {
  return { count: rows.length, items: rows.slice(0, WORKSPACE_ITEM_CAP) };
}

export async function getReceptionistWorkspace(
  db: Pool,
  input: { organizationId: number },
): Promise<ReceptionistWorkspace> {
  const now = new Date();
  const instantWindowStart = instantBefore(WORKSPACE_WINDOW_DAYS, now);

  const [timezoneResult] = await db.query<TimezoneRow[]>(
    'SELECT timezone FROM organizations WHERE id = ?',
    [input.organizationId],
  );
  const timezone = timezoneResult[0]?.timezone ?? 'UTC';
  const today = clinicDate(timezone, now);
  const tomorrow = addDays(today, 1);
  const noShowWindowStart = addDays(today, -WORKSPACE_WINDOW_DAYS);

  const [
    leadRowsResult,
    missedRowsResult,
    replyRowsResult,
    upcomingRowsResult,
    noShowRowsResult,
    recallRowsResult,
  ] = await Promise.all([
    db.query<LeadRow[]>(
      "SELECT id, first_name, last_name, phone, source, created_at FROM leads" +
        " WHERE organization_id = ? AND status = 'NEW' ORDER BY created_at ASC",
      [input.organizationId],
    ),
    db.query<CallEventRow[]>(
      "SELECT id, caller_number, called_number, call_outcome, disposition, occurred_at," +
        ' lead_id, patient_id FROM call_events WHERE organization_id = ?' +
        " AND call_outcome IN ('MISSED', 'REJECTED', 'BUSY') AND occurred_at >= ?" +
        ' ORDER BY occurred_at DESC',
      [input.organizationId, instantWindowStart],
    ),
    db.query<InboundRow[]>(
      "SELECT id, channel, recipient, body, lead_id, created_at FROM communication_messages" +
        " WHERE organization_id = ? AND direction = 'INBOUND' AND created_at >= ?" +
        ' ORDER BY created_at DESC',
      [input.organizationId, instantWindowStart],
    ),
    db.query<AppointmentRow[]>(
      'SELECT a.id, DATE_FORMAT(a.appointment_date, \'%Y-%m-%d\') AS appointment_date,' +
        " TIME_FORMAT(a.appointment_time, '%H:%i') AS appointment_time, a.status, a.service," +
        ' p.id AS patient_id, p.first_name, p.last_name FROM appointments a' +
        ' JOIN patients p ON p.id = a.patient_id WHERE a.organization_id = ?' +
        " AND a.appointment_date >= ? AND a.status IN ('SCHEDULED', 'CONFIRMED')" +
        ' ORDER BY a.appointment_date ASC, a.appointment_time ASC',
      [input.organizationId, today],
    ),
    db.query<AppointmentRow[]>(
      'SELECT a.id, DATE_FORMAT(a.appointment_date, \'%Y-%m-%d\') AS appointment_date,' +
        " TIME_FORMAT(a.appointment_time, '%H:%i') AS appointment_time, a.status, a.service," +
        ' p.id AS patient_id, p.first_name, p.last_name FROM appointments a' +
        ' JOIN patients p ON p.id = a.patient_id WHERE a.organization_id = ?' +
        " AND a.status = 'NO_SHOW' AND a.appointment_date >= ? AND a.appointment_date <= ?" +
        ' ORDER BY a.appointment_date DESC',
      [input.organizationId, noShowWindowStart, today],
    ),
    db.query<RecallRow[]>(
      "SELECT r.id, DATE_FORMAT(r.due_date, '%Y-%m-%d') AS due_date," +
        ' p.id AS patient_id, p.first_name, p.last_name FROM recalls r' +
        ' JOIN patients p ON p.id = r.patient_id WHERE r.organization_id = ?' +
        " AND r.status = 'DUE' ORDER BY r.due_date ASC",
      [input.organizationId],
    ),
  ]);

  const newLeads: NewLeadItem[] = leadRowsResult[0].map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    source: row.source,
    createdAt: isoOrNull(row.created_at) ?? '',
  }));
  const missedCalls: MissedCallItem[] = missedRowsResult[0].map((row) => ({
    id: row.id,
    callerNumber: row.caller_number,
    calledNumber: row.called_number,
    callOutcome: row.call_outcome,
    disposition: row.disposition,
    occurredAt: isoOrNull(row.occurred_at) ?? '',
    leadId: row.lead_id,
    patientId: row.patient_id,
  }));
  const patientReplies: PatientReplyItem[] = replyRowsResult[0].map((row) => ({
    id: row.id,
    channel: row.channel,
    recipient: row.recipient,
    body: truncateBody(row.body),
    leadId: row.lead_id,
    createdAt: isoOrNull(row.created_at) ?? '',
  }));
  const upcomingItems: UpcomingAppointmentItem[] = upcomingRowsResult[0].map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    patientName: fullName(row.first_name, row.last_name),
    date: row.appointment_date,
    time: row.appointment_time,
    status: row.status,
    service: row.service,
    needsConfirmation: row.status === 'SCHEDULED',
  }));
  const noShowItems: NoShowItem[] = noShowRowsResult[0].map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    patientName: fullName(row.first_name, row.last_name),
    date: row.appointment_date,
    time: row.appointment_time,
  }));
  const recallItems: RecallOpportunityItem[] = recallRowsResult[0].map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    patientName: fullName(row.first_name, row.last_name),
    dueDate: row.due_date,
    daysSinceDue: daysBetween(row.due_date, today),
  }));

  const taskAppointmentItems = upcomingItems.filter(
    (item) => item.status === 'SCHEDULED' && item.date <= tomorrow,
  );
  const taskRecallItems = recallItems.filter((item) => item.daysSinceDue >= 0);

  const tasks: TaskItem[] = [
    ...newLeads.map((item) => ({
      queue: 'newLeads' as const,
      type: 'contact-lead',
      id: item.id,
      label: `New lead: ${fullName(item.firstName, item.lastName)} (${item.phone})`,
      at: item.createdAt,
    })),
    ...missedCalls.map((item) => ({
      queue: 'missedCalls' as const,
      type: 'missed-call',
      id: item.id,
      label: `Missed call: ${item.callerNumber} ${item.callOutcome.toLowerCase()}`,
      at: item.occurredAt,
    })),
    ...patientReplies.map((item) => ({
      queue: 'patientReplies' as const,
      type: 'patient-reply',
      id: item.id,
      label: `Patient reply: ${item.channel.toLowerCase()} from ${item.recipient}`,
      at: item.createdAt,
    })),
    ...taskAppointmentItems.map((item) => ({
      queue: 'upcomingAppointments' as const,
      type: 'confirm-appointment',
      id: item.id,
      label: `Confirm appointment: ${item.date} ${item.time} ${item.patientName}`,
      at: item.date,
    })),
    ...noShowItems.map((item) => ({
      queue: 'noShows' as const,
      type: 'no-show-follow-up',
      id: item.id,
      label: `No-show follow-up: ${item.date} ${item.patientName}`,
      at: item.date,
    })),
    ...taskRecallItems.map((item) => ({
      queue: 'recallOpportunities' as const,
      type: 'recall-due',
      id: item.id,
      label: `Recall due: ${item.dueDate} ${item.patientName}`,
      at: item.dueDate,
    })),
  ];

  return {
    date: today,
    timezone,
    generatedAt: now.toISOString(),
    queues: {
      newLeads: queue(newLeads),
      missedCalls: queue(missedCalls),
      patientReplies: queue(patientReplies),
      upcomingAppointments: queue(upcomingItems),
      noShows: queue(noShowItems),
      recallOpportunities: queue(recallItems),
      tasks: {
        count: tasks.length,
        items: tasks.slice(0, WORKSPACE_TASK_CAP),
      },
    },
    definitions: WORKSPACE_DEFINITIONS,
  };
}
