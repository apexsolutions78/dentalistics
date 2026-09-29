import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadOrgSetting } from '../db/orgMeta';

export const NO_SHOW_CONFIG_META_KEY = 'noshow_config';

export interface NoShowTemplates {
  initial: string;
  followUp: string;
}

export interface NoShowConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  followUpDelayHours: number;
  templates: NoShowTemplates;
  maxAttempts: number;
}

export const DEFAULT_NO_SHOW_INITIAL_TEMPLATE =
  'Hi {{first_name}}, we missed you at {{clinic_name}} for your appointment on {{appointment_date}} at {{appointment_time}}. We hope everything is okay. Please contact the clinic to rebook at a time that suits you.';

export const DEFAULT_NO_SHOW_FOLLOW_UP_TEMPLATE =
  'Hi {{first_name}}, we wanted to follow up on your missed appointment at {{clinic_name}} on {{appointment_date}}. Would you like to book a new time? Reply to this message or contact the clinic.';

export const DEFAULT_NO_SHOW_CONFIG: NoShowConfig = {
  enabled: true,
  channel: 'SMS',
  provider: 'mock',
  followUpDelayHours: 24,
  templates: {
    initial: DEFAULT_NO_SHOW_INITIAL_TEMPLATE,
    followUp: DEFAULT_NO_SHOW_FOLLOW_UP_TEMPLATE,
  },
  maxAttempts: 3,
};

export function isNoShowConfig(value: unknown): value is NoShowConfig {
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
    typeof cfg.followUpDelayHours === 'number' &&
    Number.isInteger(cfg.followUpDelayHours) &&
    cfg.followUpDelayHours >= 1 &&
    cfg.followUpDelayHours <= 24 * 7 &&
    templates !== undefined &&
    templates !== null &&
    typeof templates === 'object' &&
    !Array.isArray(templates) &&
    typeof templates.initial === 'string' &&
    templates.initial.length > 0 &&
    typeof templates.followUp === 'string' &&
    templates.followUp.length > 0 &&
    typeof cfg.maxAttempts === 'number' &&
    Number.isInteger(cfg.maxAttempts) &&
    cfg.maxAttempts >= 1 &&
    cfg.maxAttempts <= 10
  );
}

export function cloneNoShowConfig(cfg: NoShowConfig): NoShowConfig {
  return {
    ...cfg,
    templates: { ...cfg.templates },
  };
}

export async function loadNoShowConfig(db: Pool, organizationId?: number): Promise<NoShowConfig> {
  if (organizationId !== undefined) {
    const rawOrg = await loadOrgSetting(db, organizationId, NO_SHOW_CONFIG_META_KEY);
    if (typeof rawOrg === 'string' && rawOrg !== '') {
      try {
        const parsedOrg: unknown = JSON.parse(rawOrg);
        if (isNoShowConfig(parsedOrg)) {
          return cloneNoShowConfig(parsedOrg);
        }
      } catch {
        // corrupt org row - fall through to deployment-global config
      }
    }
  }
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [NO_SHOW_CONFIG_META_KEY],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw === 'string' && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isNoShowConfig(parsed)) {
        return cloneNoShowConfig(parsed);
      }
    } catch {
      // fall through to defaults
    }
  }
  return cloneNoShowConfig(DEFAULT_NO_SHOW_CONFIG);
}
