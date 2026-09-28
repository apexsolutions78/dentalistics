import type { Pool, RowDataPacket } from 'mysql2/promise';

export const WHATSAPP_CONFIG_META_KEY = 'whatsapp_config';

export interface WhatsAppGraphConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
}

export interface WhatsAppConfig {
  enabled: boolean;
  verifyToken: string;
  appSecret: string;
  graph: WhatsAppGraphConfig;
}

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppConfig = {
  enabled: false,
  verifyToken: '',
  appSecret: '',
  graph: {
    accessToken: '',
    phoneNumberId: '',
    apiVersion: 'v26.0',
  },
};

function isWhatsAppConfig(value: unknown): value is WhatsAppConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const cfg = value as Record<string, unknown>;
  if (
    typeof cfg.enabled !== 'boolean' ||
    typeof cfg.verifyToken !== 'string' ||
    typeof cfg.appSecret !== 'string'
  ) {
    return false;
  }
  const graph = cfg.graph;
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    return false;
  }
  const g = graph as Record<string, unknown>;
  return (
    typeof g.accessToken === 'string' &&
    typeof g.phoneNumberId === 'string' &&
    typeof g.apiVersion === 'string'
  );
}

export async function loadWhatsAppConfig(db: Pool): Promise<WhatsAppConfig> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [WHATSAPP_CONFIG_META_KEY],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw !== 'string' || raw === '') {
    return structuredClone(DEFAULT_WHATSAPP_CONFIG);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isWhatsAppConfig(parsed)) {
      return parsed;
    }
  } catch {
    // fall through to defaults
  }
  return structuredClone(DEFAULT_WHATSAPP_CONFIG);
}
