import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadOrgSetting } from '../db/orgMeta';
import { DEFAULT_APPOINTMENT_CONFIRMATION_TEMPLATE } from '../communications/template';

export const LEAD_AUTOMATION_META_KEY = 'lead_automation_config';

export interface LeadAutomationSlaDays {
  high: number;
  medium: number;
  low: number;
}

export interface LeadAutomationConfig {
  enabled: boolean;
  highKeywords: string[];
  highSources: string[];
  staleHours: number;
  slotsCount: number;
  lookaheadDays: number;
  slaDays: LeadAutomationSlaDays;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  template: string;
}

export const DEFAULT_LEAD_AUTOMATION_CONFIG: LeadAutomationConfig = {
  enabled: true,
  highKeywords: ['emergency', 'pain', 'broken', 'bleeding'],
  highSources: ['MISSED_CALL'],
  staleHours: 24,
  slotsCount: 3,
  lookaheadDays: 7,
  slaDays: { high: 2, medium: 5, low: 7 },
  channel: 'SMS',
  provider: 'mock',
  template: DEFAULT_APPOINTMENT_CONFIRMATION_TEMPLATE,
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

export function isLeadAutomationConfig(value: unknown): value is LeadAutomationConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const cfg = value as Record<string, unknown>;
  const sla = cfg.slaDays;
  if (sla === null || typeof sla !== 'object' || Array.isArray(sla)) {
    return false;
  }
  const slaRecord = sla as Record<string, unknown>;
  return (
    typeof cfg.enabled === 'boolean' &&
    isStringArray(cfg.highKeywords) &&
    isStringArray(cfg.highSources) &&
    typeof cfg.staleHours === 'number' &&
    Number.isFinite(cfg.staleHours) &&
    cfg.staleHours >= 1 &&
    typeof cfg.slotsCount === 'number' &&
    Number.isInteger(cfg.slotsCount) &&
    cfg.slotsCount >= 1 &&
    cfg.slotsCount <= 10 &&
    typeof cfg.lookaheadDays === 'number' &&
    Number.isInteger(cfg.lookaheadDays) &&
    cfg.lookaheadDays >= 1 &&
    cfg.lookaheadDays <= 30 &&
    typeof slaRecord.high === 'number' &&
    Number.isInteger(slaRecord.high) &&
    (slaRecord.high as number) >= 1 &&
    (slaRecord.high as number) <= 30 &&
    typeof slaRecord.medium === 'number' &&
    Number.isInteger(slaRecord.medium) &&
    (slaRecord.medium as number) >= 1 &&
    (slaRecord.medium as number) <= 30 &&
    typeof slaRecord.low === 'number' &&
    Number.isInteger(slaRecord.low) &&
    (slaRecord.low as number) >= 1 &&
    (slaRecord.low as number) <= 30 &&
    (cfg.channel === 'SMS' || cfg.channel === 'WHATSAPP') &&
    typeof cfg.provider === 'string' &&
    cfg.provider.length > 0 &&
    typeof cfg.template === 'string' &&
    cfg.template.length > 0
  );
}

export async function loadLeadAutomationConfig(
  db: Pool,
  organizationId?: number,
): Promise<LeadAutomationConfig> {
  if (organizationId !== undefined) {
    const rawOrg = await loadOrgSetting(db, organizationId, LEAD_AUTOMATION_META_KEY);
    if (typeof rawOrg === 'string' && rawOrg !== '') {
      try {
        const parsedOrg: unknown = JSON.parse(rawOrg);
        if (isLeadAutomationConfig(parsedOrg)) {
          return parsedOrg;
        }
      } catch {
        // corrupt org row - fall through to deployment-global config
      }
    }
  }
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [LEAD_AUTOMATION_META_KEY],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw === 'string' && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isLeadAutomationConfig(parsed)) {
        return parsed;
      }
    } catch {
      // fall through to defaults
    }
  }
  return {
    ...DEFAULT_LEAD_AUTOMATION_CONFIG,
    highKeywords: [...DEFAULT_LEAD_AUTOMATION_CONFIG.highKeywords],
    highSources: [...DEFAULT_LEAD_AUTOMATION_CONFIG.highSources],
    slaDays: { ...DEFAULT_LEAD_AUTOMATION_CONFIG.slaDays },
  };
}
