import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Logger } from '../logger';
import { loadLeadAutomationConfig } from './leadAutomationConfig';
import { computeUrgency } from '../services/urgency';
import type { UrgencyResult } from '../services/urgency';
import {
  expirePendingForLead,
  generateSuggestions,
} from '../services/suggestions';

export type LeadAutomationMode = 'create' | 'update';

export interface LeadAutomationEvent {
  organizationId: number;
  leadId: number;
  mode: LeadAutomationMode;
}

export interface LeadAutomationOutcome {
  urgency: UrgencyResult | null;
  suggestions: number;
  levelChanged: boolean;
}

interface AutomationLeadRow extends RowDataPacket {
  id: number;
  source: string;
  status: string;
  requested_service: string | null;
  last_activity_at: Date;
  urgency_level: string;
}

const SUGGESTABLE_LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED'];

async function loadLeadForAutomation(
  db: Pool,
  organizationId: number,
  leadId: number,
): Promise<AutomationLeadRow | null> {
  const [rows] = await db.query<AutomationLeadRow[]>(
    `SELECT id, source, status, requested_service, last_activity_at, urgency_level
     FROM leads WHERE id = ? AND organization_id = ?`,
    [leadId, organizationId],
  );
  return rows[0] ?? null;
}

async function persistUrgency(
  db: Pool,
  leadId: number,
  urgency: UrgencyResult,
  now: Date,
): Promise<void> {
  await db.query(
    `UPDATE leads
     SET urgency_level = ?, urgency_score = ?, urgency_reasons = ?, urgency_computed_at = ?
     WHERE id = ?`,
    [urgency.level, urgency.score, JSON.stringify(urgency.reasons), now, leadId],
  );
}

async function writeAutomationActivity(
  db: Pool,
  leadId: number,
  action: string,
  detail: string,
): Promise<void> {
  try {
    await db.query(
      'INSERT INTO lead_activities (lead_id, actor_user_id, action, detail) VALUES (?, NULL, ?, ?)',
      [leadId, action, detail],
    );
  } catch {
    // activity logging must never break the automation pipeline
  }
}

export async function runLeadAutomation(
  db: Pool,
  logger: Logger,
  event: LeadAutomationEvent,
): Promise<LeadAutomationOutcome> {
  try {
    const lead = await loadLeadForAutomation(db, event.organizationId, event.leadId);
    if (lead === null) {
      logger.error('lead automation skipped', { ...event, reason: 'lead_not_found' });
      return { urgency: null, suggestions: 0, levelChanged: false };
    }
    const config = await loadLeadAutomationConfig(db, event.organizationId);
    const now = new Date();
    const urgency = computeUrgency(
      {
        source: lead.source,
        status: lead.status,
        requestedService: lead.requested_service,
        lastActivityAt: lead.last_activity_at,
      },
      config,
      now,
    );
    const levelChanged = urgency.level !== lead.urgency_level;
    await persistUrgency(db, event.leadId, urgency, now);

    let suggestions = 0;
    if (event.mode === 'create') {
      await writeAutomationActivity(
        db,
        event.leadId,
        'urgency_computed',
        `level=${urgency.level} score=${urgency.score}`,
      );
      if (config.enabled) {
        suggestions = await generateSuggestions(
          db,
          logger,
          event.organizationId,
          event.leadId,
          config,
          urgency,
        );
        if (suggestions > 0) {
          await writeAutomationActivity(
            db,
            event.leadId,
            'suggestions_generated',
            `count=${suggestions} urgency=${urgency.level}`,
          );
        }
      }
    } else if (levelChanged) {
      await writeAutomationActivity(
        db,
        event.leadId,
        'urgency_changed',
        `level=${lead.urgency_level} -> ${urgency.level} score=${urgency.score}`,
      );
      if (config.enabled && SUGGESTABLE_LEAD_STATUSES.includes(lead.status)) {
        const expired = await expirePendingForLead(db, event.organizationId, event.leadId);
        suggestions = await generateSuggestions(
          db,
          logger,
          event.organizationId,
          event.leadId,
          config,
          urgency,
        );
        if (suggestions > 0) {
          await writeAutomationActivity(
            db,
            event.leadId,
            'suggestions_generated',
            `count=${suggestions} urgency=${urgency.level} (refreshed, expired ${expired})`,
          );
        }
      }
    }

    logger.info('lead automation ran', {
      ...event,
      urgency: urgency.level,
      score: urgency.score,
      suggestions,
      levelChanged,
      enabled: config.enabled,
    });
    return { urgency, suggestions, levelChanged };
  } catch (err) {
    logger.error('lead automation failed', {
      ...event,
      error: err instanceof Error ? err.message : String(err),
    });
    return { urgency: null, suggestions: 0, levelChanged: false };
  }
}

export interface RefreshLeadAutomationInput {
  organizationId: number;
  leadId: number;
}

export async function refreshLeadAutomation(
  db: Pool,
  logger: Logger,
  input: RefreshLeadAutomationInput,
): Promise<{ urgency: UrgencyResult | null; suggestions: number; enabled: boolean }> {
  try {
    const config = await loadLeadAutomationConfig(db, input.organizationId);
    if (!config.enabled) {
      return { urgency: null, suggestions: 0, enabled: false };
    }
    const lead = await loadLeadForAutomation(db, input.organizationId, input.leadId);
    if (lead === null) {
      return { urgency: null, suggestions: 0, enabled: config.enabled };
    }
    const now = new Date();
    const urgency = computeUrgency(
      {
        source: lead.source,
        status: lead.status,
        requestedService: lead.requested_service,
        lastActivityAt: lead.last_activity_at,
      },
      config,
      now,
    );
    await persistUrgency(db, input.leadId, urgency, now);
    await expirePendingForLead(db, input.organizationId, input.leadId);
    const suggestions = SUGGESTABLE_LEAD_STATUSES.includes(lead.status)
      ? await generateSuggestions(db, logger, input.organizationId, input.leadId, config, urgency)
      : 0;
    if (suggestions > 0) {
      await writeAutomationActivity(
        db,
        input.leadId,
        'suggestions_refreshed',
        `count=${suggestions} urgency=${urgency.level}`,
      );
    }
    logger.info('lead automation refreshed', {
      ...input,
      urgency: urgency.level,
      suggestions,
    });
    return { urgency, suggestions, enabled: true };
  } catch (err) {
    logger.error('lead automation refresh failed', {
      ...input,
      error: err instanceof Error ? err.message : String(err),
    });
    return { urgency: null, suggestions: 0, enabled: true };
  }
}
