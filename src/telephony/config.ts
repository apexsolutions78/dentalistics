import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadOrgSetting } from '../db/orgMeta';

export const TELEPHONY_CONFIG_META_KEY = 'telephony_config';

export interface TelephonyConfig {
  enabled: boolean;
  signingSecret: string;
}

export const DEFAULT_TELEPHONY_CONFIG: TelephonyConfig = {
  enabled: false,
  signingSecret: '',
};

export function isTelephonyConfig(value: unknown): value is TelephonyConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const cfg = value as Record<string, unknown>;
  return typeof cfg.enabled === 'boolean' && typeof cfg.signingSecret === 'string';
}

export async function loadTelephonyConfig(db: Pool, organizationId?: number): Promise<TelephonyConfig> {
  if (organizationId !== undefined) {
    const rawOrg = await loadOrgSetting(db, organizationId, TELEPHONY_CONFIG_META_KEY);
    if (typeof rawOrg === 'string' && rawOrg !== '') {
      try {
        const parsedOrg: unknown = JSON.parse(rawOrg);
        if (isTelephonyConfig(parsedOrg)) {
          return parsedOrg;
        }
      } catch {
        // corrupt org row - fall through to deployment-global config
      }
    }
  }
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [TELEPHONY_CONFIG_META_KEY],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw !== 'string' || raw === '') {
    return { ...DEFAULT_TELEPHONY_CONFIG };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isTelephonyConfig(parsed)) {
      return parsed;
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_TELEPHONY_CONFIG };
}
