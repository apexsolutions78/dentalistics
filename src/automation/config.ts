import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadOrgSetting } from '../db/orgMeta';
import { DEFAULT_LEAD_ACK_TEMPLATE } from '../communications/template';

export const ACK_CONFIG_META_KEY = 'automation_ack_config';

export interface AckAutomationConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  sources: string[];
  template: string;
}

export const DEFAULT_ACK_CONFIG: AckAutomationConfig = {
  enabled: true,
  channel: 'SMS',
  provider: 'mock',
  sources: ['WEBSITE'],
  template: DEFAULT_LEAD_ACK_TEMPLATE,
};

export function isAckConfig(value: unknown): value is AckAutomationConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const cfg = value as Record<string, unknown>;
  return (
    typeof cfg.enabled === 'boolean' &&
    (cfg.channel === 'SMS' || cfg.channel === 'WHATSAPP') &&
    typeof cfg.provider === 'string' &&
    cfg.provider.length > 0 &&
    Array.isArray(cfg.sources) &&
    cfg.sources.every((s) => typeof s === 'string') &&
    typeof cfg.template === 'string' &&
    cfg.template.length > 0
  );
}

export async function loadAckConfig(db: Pool, organizationId?: number): Promise<AckAutomationConfig> {
  if (organizationId !== undefined) {
    const rawOrg = await loadOrgSetting(db, organizationId, ACK_CONFIG_META_KEY);
    if (typeof rawOrg === 'string' && rawOrg !== '') {
      try {
        const parsedOrg: unknown = JSON.parse(rawOrg);
        if (isAckConfig(parsedOrg)) {
          return parsedOrg;
        }
      } catch {
        // corrupt org row - fall through to deployment-global config
      }
    }
  }
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [ACK_CONFIG_META_KEY],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw !== 'string' || raw === '') {
    return { ...DEFAULT_ACK_CONFIG, sources: [...DEFAULT_ACK_CONFIG.sources] };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isAckConfig(parsed)) {
      return parsed;
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_ACK_CONFIG, sources: [...DEFAULT_ACK_CONFIG.sources] };
}
