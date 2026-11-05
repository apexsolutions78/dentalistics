import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';

export const TIMELINE_TYPES = [
  'message',
  'call',
  'lead',
  'appointment',
  'reminder',
  'recall',
  'invoice',
  'payment',
  'refund',
  'chart',
  'review',
  'note',
] as const;

export type TimelineType = (typeof TIMELINE_TYPES)[number];

const BILLING_TYPES = new Set<TimelineType>(['invoice', 'payment', 'refund']);

export interface TimelineItem {
  id: string;
  type: TimelineType;
  at: string;
  title: string;
  detail: string | null;
  href: string | null;
}

interface PatientRow extends RowDataPacket {
  id: number;
  phone: string;
}

function canSeeBilling(role: SessionUser['role']): boolean {
  return role === 'owner' || role === 'admin' || role === 'receptionist';
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function item(
  type: TimelineType,
  rawId: number,
  at: Date | string | null,
  title: string,
  detail: string | null,
  href: string | null,
): TimelineItem | null {
  const when = iso(at);
  if (when === null) return null;
  return { id: `${type}:${rawId}`, type, at: when, title, detail, href };
}

export function parseTimelineQuery(query: Record<string, unknown>): {
  types: TimelineType[] | null;
  limit: number;
  offset: number;
} {
  const rawTypes = typeof query.type === 'string' ? query.type : '';
  let types: TimelineType[] | null = null;
  if (rawTypes.trim() !== '') {
    const picked = rawTypes.split(',').map((part) => part.trim());
    const allowed = new Set<string>(TIMELINE_TYPES);
    for (const part of picked) {
      if (!allowed.has(part)) {
        throw new AppError('Invalid timeline filter', 400, 'validation_failed', true);
      }
    }
    types = picked as TimelineType[];
  }
  const limitRaw = Number(query.limit ?? 25);
  const offsetRaw = Number(query.offset ?? 0);
  const limit = Number.isInteger(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 25;
  const offset = Number.isInteger(offsetRaw) ? Math.max(0, offsetRaw) : 0;
  return { types, limit, offset };
}

export async function listPatientTimeline(
  db: Pool,
  input: {
    organizationId: number;
    patientId: number;
    role: SessionUser['role'];
    query: Record<string, unknown>;
  },
): Promise<{ items: TimelineItem[]; total: number; limit: number; offset: number }> {
  const { types, limit, offset } = parseTimelineQuery(input.query);
  const [patients] = await db.query<PatientRow[]>(
    'SELECT id, phone FROM patients WHERE organization_id = ? AND id = ?',
    [input.organizationId, input.patientId],
  );
  const patient = patients[0];
  if (patient === undefined) {
    throw new AppError('Patient not found', 404, 'not_found', true);
  }
  const includeBilling = canSeeBilling(input.role);
  const wanted = (type: TimelineType): boolean =>
    (types === null || types.includes(type)) && (includeBilling || !BILLING_TYPES.has(type));

  const collected: TimelineItem[] = [];
  const org = input.organizationId;
  const pid = patient.id;

  if (wanted('appointment')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, status, service, appointment_date, appointment_time, created_at
       FROM appointments WHERE organization_id = ? AND patient_id = ?
       ORDER BY created_at DESC LIMIT 100`,
      [org, pid],
    );
    for (const row of rows) {
      const entry = item(
        'appointment',
        Number(row.id),
        row.created_at as Date,
        `Appointment ${String(row.status).toLowerCase().replaceAll('_', ' ')}`,
        [row.service, row.appointment_date, String(row.appointment_time).slice(0, 5)]
          .filter(Boolean)
          .join(' · ') || null,
        `/appointments/${row.id}`,
      );
      if (entry) collected.push(entry);
    }
  }

  if (wanted('message')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, direction, channel, status, message_type, created_at
       FROM communication_messages
       WHERE organization_id = ? AND recipient = ?
       ORDER BY created_at DESC LIMIT 100`,
      [org, patient.phone],
    );
    for (const row of rows) {
      const entry = item(
        'message',
        Number(row.id),
        row.created_at as Date,
        `${row.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} ${row.channel} ${String(row.status).toLowerCase()}`,
        row.message_type === null ? null : String(row.message_type),
        `/communications?recipient=${encodeURIComponent(patient.phone)}`,
      );
      if (entry) collected.push(entry);
    }
  }

  if (wanted('call')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, call_outcome, caller_number, occurred_at, lead_id
       FROM call_events WHERE organization_id = ? AND patient_id = ?
       ORDER BY occurred_at DESC LIMIT 100`,
      [org, pid],
    );
    for (const row of rows) {
      const entry = item(
        'call',
        Number(row.id),
        row.occurred_at as Date,
        `Call ${String(row.call_outcome).toLowerCase()}`,
        row.caller_number === null ? null : String(row.caller_number),
        row.lead_id === null ? null : `/leads/${row.lead_id}`,
      );
      if (entry) collected.push(entry);
    }
  }

  if (wanted('lead') || wanted('note')) {
    const [leads] = await db.query<RowDataPacket[]>(
      `SELECT id, source, status, created_at FROM leads
       WHERE organization_id = ? AND phone = ?
       ORDER BY created_at DESC LIMIT 50`,
      [org, patient.phone],
    );
    const leadIds = leads.map((row) => Number(row.id));
    if (wanted('lead')) {
      for (const row of leads) {
        const entry = item(
          'lead',
          Number(row.id),
          row.created_at as Date,
          `Lead ${String(row.status).toLowerCase().replaceAll('_', ' ')}`,
          String(row.source),
          `/leads/${row.id}`,
        );
        if (entry) collected.push(entry);
      }
    }
    if (wanted('note') && leadIds.length > 0) {
      const [notes] = await db.query<RowDataPacket[]>(
        `SELECT id, lead_id, action, detail, created_at FROM lead_activities
         WHERE lead_id IN (${leadIds.map(() => '?').join(',')})
         ORDER BY created_at DESC LIMIT 100`,
        leadIds,
      );
      for (const row of notes) {
        const entry = item(
          'note',
          Number(row.id),
          row.created_at as Date,
          `Note · ${String(row.action).replaceAll('_', ' ')}`,
          row.detail === null ? null : String(row.detail),
          `/leads/${row.lead_id}`,
        );
        if (entry) collected.push(entry);
      }
    }
  }

  if (wanted('appointment')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, status, opened_at, appointment_id FROM no_show_cases
       WHERE organization_id = ? AND patient_id = ?
       ORDER BY opened_at DESC LIMIT 50`,
      [org, pid],
    );
    for (const row of rows) {
      const entry = item(
        'appointment',
        Number(row.id) + 2_000_000_000,
        row.opened_at as Date,
        `No-show recovery ${String(row.status).toLowerCase()}`,
        null,
        `/appointments/${row.appointment_id}`,
      );
      if (entry) collected.push(entry);
    }
  }

  if (wanted('reminder')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT r.id, r.status, r.offset_hours, r.sent_at, r.scheduled_at, r.appointment_id
       FROM appointment_reminders r
       JOIN appointments a ON a.id = r.appointment_id
       WHERE r.organization_id = ? AND a.patient_id = ?
       ORDER BY COALESCE(r.sent_at, r.scheduled_at) DESC LIMIT 100`,
      [org, pid],
    );
    for (const row of rows) {
      const entry = item(
        'reminder',
        Number(row.id),
        (row.sent_at as Date | null) ?? (row.scheduled_at as Date),
        `Reminder ${String(row.status).toLowerCase()}`,
        `${row.offset_hours}h before the visit`,
        `/appointments/${row.appointment_id}`,
      );
      if (entry) collected.push(entry);
    }
  }

  if (wanted('recall')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, recall_type, status, due_date, opened_at
       FROM recalls WHERE organization_id = ? AND patient_id = ?
       ORDER BY opened_at DESC LIMIT 100`,
      [org, pid],
    );
    for (const row of rows) {
      const entry = item(
        'recall',
        Number(row.id),
        row.opened_at as Date,
        `Recall ${String(row.status).toLowerCase()}`,
        `${row.recall_type} · due ${row.due_date}`,
        '/recall',
      );
      if (entry) collected.push(entry);
    }
  }

  if (wanted('invoice')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, number, status, total_cents, currency, created_at
       FROM patient_invoices WHERE organization_id = ? AND patient_id = ?
       ORDER BY created_at DESC LIMIT 100`,
      [org, pid],
    );
    for (const row of rows) {
      const entry = item(
        'invoice',
        Number(row.id),
        row.created_at as Date,
        `Invoice ${row.number ?? row.id} ${row.status}`,
        `${(Number(row.total_cents) / 100).toFixed(2)} ${row.currency}`,
        `/patient-billing/invoices/${row.id}`,
      );
      if (entry) collected.push(entry);
    }
  }

  if (wanted('payment') || wanted('refund')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, amount_cents, method, paid_on, created_at, invoice_id
       FROM patient_payments WHERE organization_id = ? AND patient_id = ?
       ORDER BY created_at DESC LIMIT 100`,
      [org, pid],
    );
    for (const row of rows) {
      const cents = Number(row.amount_cents);
      const type: TimelineType = cents < 0 ? 'refund' : 'payment';
      if (!wanted(type)) continue;
      const entry = item(
        type,
        Number(row.id),
        row.created_at as Date,
        cents < 0 ? 'Refund' : 'Payment',
        `${(Math.abs(cents) / 100).toFixed(2)} · ${row.method} · ${row.paid_on}`,
        `/patient-billing/invoices/${row.invoice_id}`,
      );
      if (entry) collected.push(entry);
    }
  }

  if (wanted('chart')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, tooth_fdi, notes, created_at
       FROM patient_tooth_history WHERE organization_id = ? AND patient_id = ?
       ORDER BY created_at DESC LIMIT 100`,
      [org, pid],
    );
    for (const row of rows) {
      const entry = item(
        'chart',
        Number(row.id),
        row.created_at as Date,
        `Chart update · tooth ${row.tooth_fdi}`,
        row.notes === null ? null : String(row.notes),
        `/patients/${pid}`,
      );
      if (entry) collected.push(entry);
    }
  }

  if (wanted('review')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, status, sent_at, scheduled_at, suppression_reason
       FROM review_requests WHERE organization_id = ? AND patient_id = ?
       ORDER BY COALESCE(sent_at, scheduled_at) DESC LIMIT 100`,
      [org, pid],
    );
    for (const row of rows) {
      const entry = item(
        'review',
        Number(row.id),
        (row.sent_at as Date | null) ?? (row.scheduled_at as Date),
        `Review request ${String(row.status).toLowerCase()}`,
        row.suppression_reason === null ? null : String(row.suppression_reason),
        null,
      );
      if (entry) collected.push(entry);
    }
  }

  if (wanted('note')) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, action, detail, created_at FROM audit_logs
       WHERE organization_id = ? AND (detail LIKE ? OR detail LIKE ?)
       ORDER BY id DESC LIMIT 50`,
      [org, `%patientId=${pid}%`, `%patient=${pid}%`],
    );
    for (const row of rows) {
      const entry = item(
        'note',
        Number(row.id) + 1_000_000_000,
        row.created_at as Date,
        `Audit · ${String(row.action).replaceAll('_', ' ')}`,
        row.detail === null ? null : String(row.detail),
        null,
      );
      if (entry) collected.push(entry);
    }
  }

  collected.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    items: collected.slice(offset, offset + limit),
    total: collected.length,
    limit,
    offset,
  };
}
