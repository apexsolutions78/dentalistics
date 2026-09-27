import type { Pool, RowDataPacket } from 'mysql2/promise';
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

function isAckConfig(value: unknown): value is AckAutomationConfig {
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

export async function loadAckConfig(db: Pool): Promise<AckAutomationConfig> {
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
