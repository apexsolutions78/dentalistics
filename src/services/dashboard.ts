import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ValidationError } from '../errors';
import { parseDateOnly } from '../validate';

export const DASHBOARD_WINDOW_BASIS =
  'Timestamps (created_at, sent_at, delivered_at, updated_at, last_contacted_at, closed_at) ' +
  'are compared as UTC instants [from 00:00 UTC, to+1d 00:00 UTC). appointment_date and ' +
  'due_date are clinic-local calendar dates compared as an inclusive date range (no timezone ' +
  'conversion). Rates are rounded to 4 decimal places.';

const MAX_WINDOW_DATES = 366;

export const DASHBOARD_METRIC_DEFINITIONS: Record<string, string> = {
  'leads.new':
    'Count of leads with created_at inside the window (created during the period).',
  'leads.contacted':
    "Count of distinct leads having a lead_activities row with action='status_changed' and " +
      'created_at inside the window, regardless of when the lead was created (the lead ' +
      'progressed during the period).',
  'leads.converted':
    'Count of leads created inside the window that are linked to at least one appointment ' +
      '(appointments.lead_id) - conversion of the period cohort, measured at query time.',
  'leads.responseRate':
    'leadResponses divided by leads.new; null when leads.new is 0.',
  leadResponses:
    'Count of INBOUND messages with lead_id set and created_at inside the window.',
  'appointments.booked':
    'Count of appointments with created_at inside the window, all current statuses ' +
      '(booked during the period).',
  'appointments.scheduled':
    "Count of appointments with appointment_date inside the range and current status = 'SCHEDULED'. " +
      'Current status only - no status history is stored.',
  'appointments.confirmed':
    "Count of appointments with appointment_date inside the range and current status = 'CONFIRMED'. " +
      'Current status only - no confirmation-history column exists.',
  'appointments.completed':
    "Count of appointments with appointment_date inside the range and current status = 'COMPLETED'.",
  'appointments.noShows':
    "Count of appointments with appointment_date inside the range and current status = 'NO_SHOW'.",
  'appointments.rebooked':
    'Count of appointments with appointment_date inside the range and previous_appointment_id ' +
      'set (rows created by reschedule or rebook). May overlap the status buckets.',
  'recall.due':
    'Count of recalls with due_date inside the range, any current status (recall opportunities in the period).',
  'recall.contacted':
    'Count of recalls with last_contacted_at inside the window.',
  'recall.booked':
    "Count of recalls with status = 'BOOKED' and closed_at inside the window.",
  'messages.sent':
    'Count of OUTBOUND messages with sent_at inside the window (sent_at is only set on successful dispatch).',
  'messages.patientReplies':
    'Count of INBOUND messages with created_at inside the window (any conversation).',
  'delivery.delivered':
    'Count of OUTBOUND messages with delivered_at inside the window.',
  'delivery.deliveredRate': 'delivery.delivered divided by messages.sent; null when messages.sent is 0.',
  'failures.failed':
    "Count of OUTBOUND messages with status = 'FAILED' and updated_at inside the window " +
      '(approximation: no failed_at column exists; updated_at is the last state change).',
  'failures.failedRate':
    'failures.failed divided by (messages.sent + failures.failed); null when the denominator is 0.',
  'trends.daily.newLeads':
    'Per-UTC-date count of leads created that day (date bucket uses created_at).',
  'trends.daily.messagesSent':
    'Per-UTC-date count of OUTBOUND messages with sent_at that day.',
  'trends.daily.patientReplies':
    'Per-UTC-date count of INBOUND messages with created_at that day.',
};

export const DASHBOARD_PLAN_METRICS: Record<string, readonly string[]> = {
  Leads: ['leads.new', 'leads.contacted', 'leads.converted', 'leads.responseRate'],
  'Lead responses': ['leadResponses'],
  Appointments: ['appointments.booked', 'appointments.scheduled', 'appointments.completed'],
  Confirmations: ['appointments.confirmed'],
  'No-shows': ['appointments.noShows'],
  Rebookings: ['appointments.rebooked'],
  Recall: ['recall.due', 'recall.contacted', 'recall.booked'],
  Messages: ['messages.sent', 'messages.patientReplies'],
  Delivery: ['delivery.delivered', 'delivery.deliveredRate'],
  Failures: ['failures.failed', 'failures.failedRate'],
};

export interface DashboardWindow {
  from: string;
  to: string;
  basis: string;
}

export interface DashboardMetrics {
  leads: {
    new: number;
    contacted: number;
    converted: number;
    responseRate: number | null;
  };
  leadResponses: number;
  appointments: {
    booked: number;
    scheduled: number;
    confirmed: number;
    completed: number;
    noShows: number;
    rebooked: number;
  };
  recall: {
    due: number;
    contacted: number;
    booked: number;
  };
  messages: {
    sent: number;
    patientReplies: number;
  };
  delivery: {
    delivered: number;
    deliveredRate: number | null;
  };
  failures: {
    failed: number;
    failedRate: number | null;
  };
}

export interface DashboardTrendPoint {
  date: string;
  newLeads: number;
  messagesSent: number;
  patientReplies: number;
}

export interface DashboardResult {
  window: DashboardWindow;
  metrics: DashboardMetrics;
  definitions: {
    metrics: Record<string, string>;
    planMetrics: Record<string, readonly string[]>;
  };
  trends: {
    daily: DashboardTrendPoint[];
  };
}

interface CountRow extends RowDataPacket {
  n: number | string | null;
}

interface AppointmentStatsRow extends RowDataPacket {
  scheduled: unknown;
  confirmed: unknown;
  completed: unknown;
  no_shows: unknown;
  rebooked: unknown;
}

interface RecallStatsRow extends RowDataPacket {
  due: unknown;
  contacted: unknown;
  booked: unknown;
}

interface MessageStatsRow extends RowDataPacket {
  sent: unknown;
  replies: unknown;
  lead_replies: unknown;
  delivered: unknown;
  failed: unknown;
}

interface TrendRow extends RowDataPacket {
  d: string;
  n: number | string;
}

export function resolveDashboardRange(from: unknown, to: unknown): { from: string; to: string } {
  let toValue: string;
  if (to === undefined || to === null || to === '') {
    toValue = new Date().toISOString().slice(0, 10);
  } else {
    toValue = parseDateOnly(to, 'to');
  }
  let fromValue: string;
  if (from === undefined || from === null || from === '') {
    const toMs = Date.parse(`${toValue}T00:00:00Z`);
    fromValue = new Date(toMs - 29 * 86400000).toISOString().slice(0, 10);
  } else {
    fromValue = parseDateOnly(from, 'from');
  }
  if (fromValue > toValue) {
    throw new ValidationError('Invalid input', ['from must be on or before to']);
  }
  const spanDays =
    (Date.parse(`${toValue}T00:00:00Z`) - Date.parse(`${fromValue}T00:00:00Z`)) / 86400000;
  if (spanDays > MAX_WINDOW_DATES - 1) {
    throw new ValidationError('Invalid input', [
      `window must not exceed ${MAX_WINDOW_DATES} days (from .. to inclusive)`,
    ]);
  }
  return { from: fromValue, to: toValue };
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

function toCount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function listDates(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = nextDay(cursor);
  }
  return dates;
}

export async function getDashboard(
  db: Pool,
  input: { organizationId: number; from: string; to: string },
): Promise<DashboardResult> {
  const { organizationId, from, to } = input;
  const until = nextDay(to);

  const [
    leadsNewResult,
    leadsConvertedResult,
    leadsContactedResult,
    appointmentBookedResult,
    appointmentStatsResult,
    recallStatsResult,
    messageStatsResult,
    trendLeadsResult,
    trendSentResult,
    trendRepliesResult,
  ] = await Promise.all([
    db.query<CountRow[]>(
      'SELECT COUNT(*) AS n FROM leads WHERE organization_id = ? AND created_at >= ? AND created_at < ?',
      [organizationId, from, until],
    ),
    db.query<CountRow[]>(
      'SELECT COUNT(*) AS n FROM leads WHERE organization_id = ? AND created_at >= ? AND created_at < ?' +
        ' AND EXISTS (SELECT 1 FROM appointments a WHERE a.lead_id = leads.id)',
      [organizationId, from, until],
    ),
    db.query<CountRow[]>(
      "SELECT COUNT(DISTINCT la.lead_id) AS n FROM lead_activities la" +
        ' JOIN leads l ON l.id = la.lead_id WHERE l.organization_id = ?' +
        " AND la.action = 'status_changed' AND la.created_at >= ? AND la.created_at < ?",
      [organizationId, from, until],
    ),
    db.query<CountRow[]>(
      'SELECT COUNT(*) AS n FROM appointments WHERE organization_id = ? AND created_at >= ? AND created_at < ?',
      [organizationId, from, until],
    ),
    db.query<AppointmentStatsRow[]>(
      "SELECT COALESCE(SUM(status = 'SCHEDULED'), 0) AS scheduled," +
        " COALESCE(SUM(status = 'CONFIRMED'), 0) AS confirmed," +
        " COALESCE(SUM(status = 'COMPLETED'), 0) AS completed," +
        " COALESCE(SUM(status = 'NO_SHOW'), 0) AS no_shows," +
        ' COALESCE(SUM(previous_appointment_id IS NOT NULL), 0) AS rebooked' +
        ' FROM appointments WHERE organization_id = ? AND appointment_date >= ? AND appointment_date <= ?',
      [organizationId, from, to],
    ),
    db.query<RecallStatsRow[]>(
      'SELECT COALESCE(SUM(due_date >= ? AND due_date <= ?), 0) AS due,' +
        ' COALESCE(SUM(last_contacted_at >= ? AND last_contacted_at < ?), 0) AS contacted,' +
        " COALESCE(SUM(status = 'BOOKED' AND closed_at >= ? AND closed_at < ?), 0) AS booked" +
        ' FROM recalls WHERE organization_id = ?',
      [from, to, from, until, from, until, organizationId],
    ),
    db.query<MessageStatsRow[]>(
      "SELECT COALESCE(SUM(direction = 'OUTBOUND' AND sent_at >= ? AND sent_at < ?), 0) AS sent," +
        " COALESCE(SUM(direction = 'INBOUND' AND created_at >= ? AND created_at < ?), 0) AS replies," +
        " COALESCE(SUM(direction = 'INBOUND' AND lead_id IS NOT NULL AND created_at >= ? AND created_at < ?), 0) AS lead_replies," +
        " COALESCE(SUM(direction = 'OUTBOUND' AND delivered_at >= ? AND delivered_at < ?), 0) AS delivered," +
        " COALESCE(SUM(direction = 'OUTBOUND' AND status = 'FAILED' AND updated_at >= ? AND updated_at < ?), 0) AS failed" +
        ' FROM communication_messages WHERE organization_id = ?',
      [from, until, from, until, from, until, from, until, from, until, organizationId],
    ),
    db.query<TrendRow[]>(
      "SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n FROM leads WHERE organization_id = ?" +
        ' AND created_at >= ? AND created_at < ? GROUP BY DATE_FORMAT(created_at, \'%Y-%m-%d\')',
      [organizationId, from, until],
    ),
    db.query<TrendRow[]>(
      "SELECT DATE_FORMAT(sent_at, '%Y-%m-%d') AS d, COUNT(*) AS n FROM communication_messages WHERE organization_id = ?" +
        " AND direction = 'OUTBOUND' AND sent_at >= ? AND sent_at < ? GROUP BY DATE_FORMAT(sent_at, '%Y-%m-%d')",
      [organizationId, from, until],
    ),
    db.query<TrendRow[]>(
      "SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n FROM communication_messages WHERE organization_id = ?" +
        " AND direction = 'INBOUND' AND created_at >= ? AND created_at < ? GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')",
      [organizationId, from, until],
    ),
  ]);

  const leadsNew = toCount(leadsNewResult[0][0]?.n);
  const leadsConverted = toCount(leadsConvertedResult[0][0]?.n);
  const leadsContacted = toCount(leadsContactedResult[0][0]?.n);
  const appointmentsBooked = toCount(appointmentBookedResult[0][0]?.n);
  const appointmentStats = appointmentStatsResult[0][0];
  const recallStats = recallStatsResult[0][0];
  const messageStats = messageStatsResult[0][0];

  const messagesSent = toCount(messageStats?.sent);
  const messagesReplies = toCount(messageStats?.replies);
  const leadResponses = toCount(messageStats?.lead_replies);
  const messagesDelivered = toCount(messageStats?.delivered);
  const messagesFailed = toCount(messageStats?.failed);

  const trendNewLeads = new Map<string, number>();
  for (const row of trendLeadsResult[0]) {
    trendNewLeads.set(row.d, toCount(row.n));
  }
  const trendSent = new Map<string, number>();
  for (const row of trendSentResult[0]) {
    trendSent.set(row.d, toCount(row.n));
  }
  const trendReplies = new Map<string, number>();
  for (const row of trendRepliesResult[0]) {
    trendReplies.set(row.d, toCount(row.n));
  }
  const daily: DashboardTrendPoint[] = listDates(from, to).map((date) => ({
    date,
    newLeads: trendNewLeads.get(date) ?? 0,
    messagesSent: trendSent.get(date) ?? 0,
    patientReplies: trendReplies.get(date) ?? 0,
  }));

  return {
    window: { from, to, basis: DASHBOARD_WINDOW_BASIS },
    metrics: {
      leads: {
        new: leadsNew,
        contacted: leadsContacted,
        converted: leadsConverted,
        responseRate: leadsNew > 0 ? round4(leadResponses / leadsNew) : null,
      },
      leadResponses,
      appointments: {
        booked: appointmentsBooked,
        scheduled: toCount(appointmentStats?.scheduled),
        confirmed: toCount(appointmentStats?.confirmed),
        completed: toCount(appointmentStats?.completed),
        noShows: toCount(appointmentStats?.no_shows),
        rebooked: toCount(appointmentStats?.rebooked),
      },
      recall: {
        due: toCount(recallStats?.due),
        contacted: toCount(recallStats?.contacted),
        booked: toCount(recallStats?.booked),
      },
      messages: {
        sent: messagesSent,
        patientReplies: messagesReplies,
      },
      delivery: {
        delivered: messagesDelivered,
        deliveredRate: messagesSent > 0 ? round4(messagesDelivered / messagesSent) : null,
      },
      failures: {
        failed: messagesFailed,
        failedRate:
          messagesSent + messagesFailed > 0
            ? round4(messagesFailed / (messagesSent + messagesFailed))
            : null,
      },
    },
    definitions: {
      metrics: DASHBOARD_METRIC_DEFINITIONS,
      planMetrics: DASHBOARD_PLAN_METRICS,
    },
    trends: { daily },
  };
}
