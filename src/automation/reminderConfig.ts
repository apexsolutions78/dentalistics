import type { Pool, RowDataPacket } from 'mysql2/promise';

export const REMINDER_CONFIG_META_KEY = 'reminder_config';

export interface QuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
}

export interface ReminderConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  offsetsHours: number[];
  quietHours: QuietHoursConfig;
  templates: Record<string, string>;
  maxAttempts: number;
}

export const DEFAULT_REMINDER_TEMPLATE_48H =
  'Hi {{first_name}}, this is a reminder of your appointment at {{clinic_name}} on {{appointment_date}} at {{appointment_time}}. Reply C to confirm or call us to reschedule.';

export const DEFAULT_REMINDER_TEMPLATE_24H =
  'Hi {{first_name}}, your appointment at {{clinic_name}} is tomorrow, {{appointment_date}} at {{appointment_time}}. See you soon!';

export const DEFAULT_REMINDER_TEMPLATE_2H =
  'Hi {{first_name}}, your appointment at {{clinic_name}} is in 2 hours at {{appointment_time}}. Please arrive a few minutes early.';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  channel: 'SMS',
  provider: 'mock',
  offsetsHours: [48, 24, 2],
  quietHours: { enabled: false, start: '21:00', end: '08:00' },
  templates: {
    '48': DEFAULT_REMINDER_TEMPLATE_48H,
    '24': DEFAULT_REMINDER_TEMPLATE_24H,
    '2': DEFAULT_REMINDER_TEMPLATE_2H,
  },
  maxAttempts: 3,
};

function isReminderConfig(value: unknown): value is ReminderConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const cfg = value as Record<string, unknown>;
  const quiet = cfg.quietHours as Record<string, unknown> | undefined;
  const templates = cfg.templates;
  return (
    typeof cfg.enabled === 'boolean' &&
    (cfg.channel === 'SMS' || cfg.channel === 'WHATSAPP') &&
    typeof cfg.provider === 'string' &&
    cfg.provider.length > 0 &&
    Array.isArray(cfg.offsetsHours) &&
    cfg.offsetsHours.length > 0 &&
    cfg.offsetsHours.every(
      (h) => typeof h === 'number' && Number.isInteger(h) && h >= 1 && h <= 24 * 30,
    ) &&
    quiet !== undefined &&
    quiet !== null &&
    typeof quiet === 'object' &&
    typeof quiet.enabled === 'boolean' &&
    typeof quiet.start === 'string' &&
    TIME_PATTERN.test(quiet.start) &&
    typeof quiet.end === 'string' &&
    TIME_PATTERN.test(quiet.end) &&
    templates !== null &&
    typeof templates === 'object' &&
    !Array.isArray(templates) &&
    Object.values(templates).every((t) => typeof t === 'string' && t.length > 0) &&
    typeof cfg.maxAttempts === 'number' &&
    Number.isInteger(cfg.maxAttempts) &&
    cfg.maxAttempts >= 1 &&
    cfg.maxAttempts <= 10
  );
}

export function cloneReminderConfig(cfg: ReminderConfig): ReminderConfig {
  return {
    ...cfg,
    offsetsHours: [...cfg.offsetsHours],
    quietHours: { ...cfg.quietHours },
    templates: { ...cfg.templates },
  };
}

export async function loadReminderConfig(db: Pool): Promise<ReminderConfig> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [REMINDER_CONFIG_META_KEY],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw === 'string' && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isReminderConfig(parsed)) {
        return cloneReminderConfig(parsed);
      }
    } catch {
      // fall through to defaults
    }
  }
  return cloneReminderConfig(DEFAULT_REMINDER_CONFIG);
}
