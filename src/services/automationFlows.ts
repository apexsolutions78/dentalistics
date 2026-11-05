import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ACK_CONFIG_META_KEY, loadAckConfig } from '../automation/config';
import { LEAD_AUTOMATION_META_KEY, loadLeadAutomationConfig } from '../automation/leadAutomationConfig';
import { MISSED_CALL_CONFIG_META_KEY, loadMissedCallConfig } from '../automation/missedCall';
import { NO_SHOW_CONFIG_META_KEY, loadNoShowConfig } from '../automation/noShowConfig';
import { RECALL_CONFIG_META_KEY, loadRecallConfig } from '../automation/recallConfig';
import { REMINDER_CONFIG_META_KEY, loadReminderConfig } from '../automation/reminderConfig';
import { REVIEW_CONFIG_META_KEY, loadReviewConfig } from '../automation/reviewConfig';
import { AppError } from '../errors';
import type { SessionUser } from '../auth/sessions';

export interface AutomationFlowView {
  key: string;
  name: string;
  description: string;
  trigger: string;
  enabled: boolean;
  lastRunAt: string | null;
  runsLast30Days: number;
}

interface CountRow extends RowDataPacket {
  n: number;
  last_at: Date | null;
}

interface FlowDef {
  key: string;
  name: string;
  description: string;
  trigger: string;
  metaKey: string;
  load: (db: Pool, organizationId: number) => Promise<{ enabled: boolean }>;
  countSql: string;
}

const FLOWS: FlowDef[] = [
  {
    key: 'lead_ack',
    name: 'New enquiry acknowledgement',
    description: 'Sends the acknowledgement as soon as a new lead arrives.',
    trigger: 'A lead is created from an allowed source.',
    metaKey: ACK_CONFIG_META_KEY,
    load: loadAckConfig,
    countSql: `SELECT COUNT(*) AS n, MAX(created_at) AS last_at FROM communication_messages
      WHERE organization_id = ? AND message_type = 'lead_acknowledgement' AND created_at >= ?`,
  },
  {
    key: 'missed_call',
    name: 'Missed-call response',
    description: 'Texts back when a call is missed, rejected, or busy.',
    trigger: 'A missed, rejected, or busy call is recorded.',
    metaKey: MISSED_CALL_CONFIG_META_KEY,
    load: loadMissedCallConfig,
    countSql: `SELECT COUNT(*) AS n, MAX(created_at) AS last_at FROM communication_messages
      WHERE organization_id = ? AND message_type = 'missed_call_response' AND created_at >= ?`,
  },
  {
    key: 'reminders',
    name: 'Appointment reminders',
    description: 'Sends the reminder sequence before a visit.',
    trigger: 'A reminder is due for a scheduled appointment.',
    metaKey: REMINDER_CONFIG_META_KEY,
    load: loadReminderConfig,
    countSql: `SELECT COUNT(*) AS n, MAX(sent_at) AS last_at FROM appointment_reminders
      WHERE organization_id = ? AND status = 'SENT' AND sent_at >= ?`,
  },
  {
    key: 'no_show',
    name: 'No-show recovery',
    description: 'Starts rebooking outreach after a missed visit.',
    trigger: 'An appointment is marked as a no-show.',
    metaKey: NO_SHOW_CONFIG_META_KEY,
    load: loadNoShowConfig,
    countSql: `SELECT COUNT(*) AS n, MAX(sent_at) AS last_at FROM no_show_messages
      WHERE organization_id = ? AND status = 'SENT' AND sent_at >= ?`,
  },
  {
    key: 'recall',
    name: 'Recall',
    description: 'Opens and follows up hygiene and treatment recalls.',
    trigger: 'A completed visit is due for recall, or a follow-up is scheduled.',
    metaKey: RECALL_CONFIG_META_KEY,
    load: loadRecallConfig,
    countSql: `SELECT COUNT(*) AS n, MAX(sent_at) AS last_at FROM recall_messages
      WHERE organization_id = ? AND status = 'SENT' AND sent_at >= ?`,
  },
  {
    key: 'reviews',
    name: 'Review requests',
    description: 'Asks every eligible patient for a review once.',
    trigger: 'A completed visit becomes eligible for a review request.',
    metaKey: REVIEW_CONFIG_META_KEY,
    load: loadReviewConfig,
    countSql: `SELECT COUNT(*) AS n, MAX(sent_at) AS last_at FROM review_requests
      WHERE organization_id = ? AND status = 'SENT' AND sent_at >= ?`,
  },
  {
    key: 'lead_automation',
    name: 'Lead automation',
    description: 'Scores urgency and suggests open appointment times.',
    trigger: 'A lead is created or its status still needs a booking.',
    metaKey: LEAD_AUTOMATION_META_KEY,
    load: loadLeadAutomationConfig,
    countSql: `SELECT COUNT(*) AS n, MAX(created_at) AS last_at FROM lead_slot_suggestions
      WHERE organization_id = ? AND created_at >= ?`,
  },
];

function iso(value: Date | null): string | null {
  if (value === null) return null;
  return value.toISOString();
}

export function automationFlowKeys(): string[] {
  return FLOWS.map((flow) => flow.key);
}

export async function listAutomationFlows(db: Pool, organizationId: number): Promise<AutomationFlowView[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const views: AutomationFlowView[] = [];
  for (const flow of FLOWS) {
    const config = await flow.load(db, organizationId);
    const [rows] = await db.query<CountRow[]>(flow.countSql, [organizationId, since]);
    const row = rows[0];
    views.push({
      key: flow.key,
      name: flow.name,
      description: flow.description,
      trigger: flow.trigger,
      enabled: config.enabled,
      lastRunAt: iso(row?.last_at ?? null),
      runsLast30Days: Number(row?.n ?? 0),
    });
  }
  return views;
}

export async function setAutomationFlowEnabled(
  db: Pool,
  actor: SessionUser,
  organizationId: number,
  key: string,
  enabled: boolean,
): Promise<AutomationFlowView> {
  if (actor.role !== 'owner' || actor.organizationId !== organizationId) {
    throw new AppError('Forbidden', 403, 'forbidden', true);
  }
  const flow = FLOWS.find((item) => item.key === key);
  if (flow === undefined) {
    throw new AppError('Automation not found', 404, 'not_found', true);
  }
  const current = await flow.load(db, organizationId);
  await db.query(
    `INSERT INTO organization_settings (organization_id, meta_key, meta_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
    [organizationId, flow.metaKey, JSON.stringify({ ...current, enabled })],
  );
  const flows = await listAutomationFlows(db, organizationId);
  const updated = flows.find((item) => item.key === key);
  if (updated === undefined) {
    throw new AppError('Automation not found', 404, 'not_found', true);
  }
  return updated;
}
