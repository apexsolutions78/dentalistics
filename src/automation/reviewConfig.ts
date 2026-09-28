import type { Pool, RowDataPacket } from 'mysql2/promise';

export const REVIEW_CONFIG_META_KEY = 'review_config';

export interface ReviewConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  delayHours: number;
  suppressionPeriodDays: number;
  template: string;
  maxAttempts: number;
}

export const DEFAULT_REVIEW_TEMPLATE =
  'Hi {{first_name}}, thank you for visiting {{clinic_name}}! We would love to hear about your experience. Share your feedback here: {{review_url}}';

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  enabled: true,
  channel: 'SMS',
  provider: 'mock',
  delayHours: 24,
  suppressionPeriodDays: 180,
  template: DEFAULT_REVIEW_TEMPLATE,
  maxAttempts: 3,
};

function isReviewConfig(value: unknown): value is ReviewConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const cfg = value as Record<string, unknown>;
  return (
    typeof cfg.enabled === 'boolean' &&
    (cfg.channel === 'SMS' || cfg.channel === 'WHATSAPP') &&
    typeof cfg.provider === 'string' &&
    cfg.provider.length > 0 &&
    typeof cfg.delayHours === 'number' &&
    Number.isInteger(cfg.delayHours) &&
    cfg.delayHours >= 0 &&
    cfg.delayHours <= 720 &&
    typeof cfg.suppressionPeriodDays === 'number' &&
    Number.isInteger(cfg.suppressionPeriodDays) &&
    cfg.suppressionPeriodDays >= 1 &&
    cfg.suppressionPeriodDays <= 3650 &&
    typeof cfg.template === 'string' &&
    cfg.template.length > 0 &&
    typeof cfg.maxAttempts === 'number' &&
    Number.isInteger(cfg.maxAttempts) &&
    cfg.maxAttempts >= 1 &&
    cfg.maxAttempts <= 10
  );
}

export function cloneReviewConfig(cfg: ReviewConfig): ReviewConfig {
  return { ...cfg };
}

export async function loadReviewConfig(db: Pool): Promise<ReviewConfig> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [REVIEW_CONFIG_META_KEY],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw === 'string' && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isReviewConfig(parsed)) {
        return cloneReviewConfig(parsed);
      }
    } catch {
      // fall through to defaults
    }
  }
  return cloneReviewConfig(DEFAULT_REVIEW_CONFIG);
}
