import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadOrgSetting } from '../db/orgMeta';

export const RECALL_CONFIG_META_KEY = 'recall_config';

export interface RecallTemplates {
  recall: string;
  followUp: string;
}

export interface RecallConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  intervalDays: number;
  followUpDelayHours: number;
  templates: RecallTemplates;
  maxAttempts: number;
}

export const DEFAULT_RECALL_TEMPLATE =
  'Hi {{first_name}}, it is time for your next visit at {{clinic_name}}. It has been {{interval_days}} days since your last appointment. Book your visit by replying to this message or calling the clinic.';

export const DEFAULT_RECALL_FOLLOW_UP_TEMPLATE =
  'Hi {{first_name}}, a gentle reminder from {{clinic_name}} that your next visit is due. Would you like to book an appointment? Reply to this message or contact the clinic.';

export const DEFAULT_RECALL_CONFIG: RecallConfig = {
  enabled: true,
  channel: 'SMS',
  provider: 'mock',
  intervalDays: 180,
  followUpDelayHours: 72,
  templates: {
    recall: DEFAULT_RECALL_TEMPLATE,
    followUp: DEFAULT_RECALL_FOLLOW_UP_TEMPLATE,
  },
  maxAttempts: 3,
};

export function isRecallConfig(value: unknown): value is RecallConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const cfg = value as Record<string, unknown>;
  const templates = cfg.templates as Record<string, unknown> | undefined;
  return (
    typeof cfg.enabled === 'boolean' &&
    (cfg.channel === 'SMS' || cfg.channel === 'WHATSAPP') &&
    typeof cfg.provider === 'string' &&
    cfg.provider.length > 0 &&
    typeof cfg.intervalDays === 'number' &&
    Number.isInteger(cfg.intervalDays) &&
    cfg.intervalDays >= 1 &&
    cfg.intervalDays <= 3650 &&
    typeof cfg.followUpDelayHours === 'number' &&
    Number.isInteger(cfg.followUpDelayHours) &&
    cfg.followUpDelayHours >= 1 &&
    cfg.followUpDelayHours <= 24 * 7 &&
    templates !== undefined &&
    templates !== null &&
    typeof templates === 'object' &&
    !Array.isArray(templates) &&
    typeof templates.recall === 'string' &&
    templates.recall.length > 0 &&
    typeof templates.followUp === 'string' &&
    templates.followUp.length > 0 &&
    typeof cfg.maxAttempts === 'number' &&
    Number.isInteger(cfg.maxAttempts) &&
    cfg.maxAttempts >= 1 &&
    cfg.maxAttempts <= 10
  );
}

export function cloneRecallConfig(cfg: RecallConfig): RecallConfig {
  return {
    ...cfg,
    templates: { ...cfg.templates },
  };
}

export async function loadRecallConfig(db: Pool, organizationId?: number): Promise<RecallConfig> {
  if (organizationId !== undefined) {
    const rawOrg = await loadOrgSetting(db, organizationId, RECALL_CONFIG_META_KEY);
    if (typeof rawOrg === 'string' && rawOrg !== '') {
      try {
        const parsedOrg: unknown = JSON.parse(rawOrg);
        if (isRecallConfig(parsedOrg)) {
          return cloneRecallConfig(parsedOrg);
        }
      } catch {
        // corrupt org row - fall through to deployment-global config
      }
    }
  }
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [RECALL_CONFIG_META_KEY],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw === 'string' && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecallConfig(parsed)) {
        return cloneRecallConfig(parsed);
      }
    } catch {
      // fall through to defaults
    }
  }
  return cloneRecallConfig(DEFAULT_RECALL_CONFIG);
}
