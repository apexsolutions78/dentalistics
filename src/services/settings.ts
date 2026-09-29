import type { Pool, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { loadOrgSetting } from '../db/orgMeta';
import { listTemplateVariables, renderTemplate } from '../communications/template';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import {
  BUSINESS_HOUR_DAYS,
  normalizePhone,
  optionalEmail,
  optionalText,
  parseBusinessHours,
  parseReviewUrl,
  parseTimezone,
  requireString,
} from '../validate';
import {
  ACK_CONFIG_META_KEY,
  DEFAULT_ACK_CONFIG,
  isAckConfig,
} from '../automation/config';
import {
  MISSED_CALL_CONFIG_META_KEY,
  DEFAULT_MISSED_CALL_CONFIG,
  isMissedCallConfig,
} from '../automation/missedCall';
import {
  REMINDER_CONFIG_META_KEY,
  DEFAULT_REMINDER_CONFIG,
  isReminderConfig,
} from '../automation/reminderConfig';
import {
  NO_SHOW_CONFIG_META_KEY,
  DEFAULT_NO_SHOW_CONFIG,
  isNoShowConfig,
} from '../automation/noShowConfig';
import {
  RECALL_CONFIG_META_KEY,
  DEFAULT_RECALL_CONFIG,
  isRecallConfig,
} from '../automation/recallConfig';
import {
  REVIEW_CONFIG_META_KEY,
  DEFAULT_REVIEW_CONFIG,
  isReviewConfig,
} from '../automation/reviewConfig';
import {
  TELEPHONY_CONFIG_META_KEY,
  DEFAULT_TELEPHONY_CONFIG,
  isTelephonyConfig,
} from '../telephony/config';
import {
  WHATSAPP_CONFIG_META_KEY,
  DEFAULT_WHATSAPP_CONFIG,
  isWhatsAppConfig,
} from '../communications/whatsappConfig';

export type ConfigSource = 'org' | 'deployment' | 'default';

export type AutomationSectionKey =
  | 'reminder'
  | 'noShow'
  | 'recall'
  | 'review'
  | 'leadAck'
  | 'missedCall';

export type ProviderSectionKey = 'telephony' | 'whatsapp';

export const AUTOMATION_SECTION_KEYS: readonly AutomationSectionKey[] = [
  'reminder',
  'noShow',
  'recall',
  'review',
  'leadAck',
  'missedCall',
];

export const PROVIDER_SECTION_KEYS: readonly ProviderSectionKey[] = ['telephony', 'whatsapp'];

export const SUPPORTED_TEMPLATE_VARIABLES = [
  'first_name',
  'clinic_name',
  'appointment_date',
  'appointment_time',
  'clinic_phone',
  'booking_link',
] as const;

interface TemplateSlot {
  section: AutomationSectionKey;
  path: readonly string[];
}

export const TEMPLATE_SLOTS: Record<string, TemplateSlot> = {
  lead_acknowledgement: { section: 'leadAck', path: ['template'] },
  missed_call_response: { section: 'missedCall', path: ['template'] },
  appointment_reminder_48h: { section: 'reminder', path: ['templates', '48'] },
  appointment_reminder_24h: { section: 'reminder', path: ['templates', '24'] },
  appointment_reminder_2h: { section: 'reminder', path: ['templates', '2'] },
  no_show_message: { section: 'noShow', path: ['templates', 'initial'] },
  no_show_follow_up: { section: 'noShow', path: ['templates', 'followUp'] },
  recall_message: { section: 'recall', path: ['templates', 'recall'] },
  recall_follow_up: { section: 'recall', path: ['templates', 'followUp'] },
  review_request: { section: 'review', path: ['template'] },
};

interface OrganizationSettingsRow extends RowDataPacket {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_url: string | null;
  business_hours: string | null;
  timezone: string;
  review_url: string | null;
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Invalid input', [`${name} must be a JSON object`]);
  }
  return value as Record<string, unknown>;
}

async function resolveJson<T>(
  db: Pool,
  organizationId: number | undefined,
  metaKey: string,
  guard: (value: unknown) => value is T,
  defaults: T,
): Promise<{ config: T; source: ConfigSource }> {
  if (organizationId !== undefined) {
    const rawOrg = await loadOrgSetting(db, organizationId, metaKey);
    if (typeof rawOrg === 'string' && rawOrg !== '') {
      try {
        const parsed: unknown = JSON.parse(rawOrg);
        if (guard(parsed)) {
          return { config: structuredClone(parsed), source: 'org' };
        }
      } catch {
        // corrupt org row - fall through to deployment layer
      }
    }
  }
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [metaKey],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw === 'string' && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (guard(parsed)) {
        return { config: structuredClone(parsed), source: 'deployment' };
      }
    } catch {
      // corrupt deployment row - fall through to defaults
    }
  }
  return { config: structuredClone(defaults), source: 'default' };
}

function mergeSection<T>(
  base: T,
  rawPatch: unknown,
  options: { nested: readonly string[]; deploymentGlobal: readonly string[] },
): T {
  const patch = asObject(rawPatch, 'body');
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  const baseRecord = base as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(baseRecord, key)) {
      throw new ValidationError('Invalid input', [`unknown or not updatable field: ${key}`]);
    }
    if (options.deploymentGlobal.includes(key)) {
      continue;
    }
    if (options.nested.includes(key)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new ValidationError('Invalid input', [`${key} must be an object`]);
      }
      const nestedBase = baseRecord[key];
      if (nestedBase === null || typeof nestedBase !== 'object' || Array.isArray(nestedBase)) {
        throw new ValidationError('Invalid input', [`${key} is not configurable`]);
      }
      const nestedOut = out[key] as Record<string, unknown>;
      for (const [nestedKey, nestedValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (!Object.prototype.hasOwnProperty.call(nestedBase, nestedKey)) {
          throw new ValidationError('Invalid input', [
            `unknown or not updatable field: ${key}.${nestedKey}`,
          ]);
        }
        nestedOut[nestedKey] = nestedValue;
      }
    } else {
      out[key] = value;
    }
  }
  return out as unknown as T;
}

function sanitizeNullableStrings(
  rawPatch: unknown,
  paths: readonly string[],
): Record<string, unknown> {
  const patch = asObject(rawPatch, 'body');
  const out: Record<string, unknown> = { ...patch };
  for (const path of paths) {
    const parts = path.split('.');
    if (parts.length === 1) {
      const key = parts[0] ?? '';
      if (out[key] === null) {
        out[key] = '';
      }
      const value = out[key];
      if (typeof value === 'string' && value.length > 1000) {
        throw new ValidationError('Invalid input', [
          `${path} must be at most 1000 characters`,
        ]);
      }
      continue;
    }
    const rootKey = parts[0] ?? '';
    const childKey = parts[1] ?? '';
    const nested = out[rootKey];
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
      continue;
    }
    const nestedOut = { ...(nested as Record<string, unknown>) };
    if (nestedOut[childKey] === null) {
      nestedOut[childKey] = '';
    }
    const value = nestedOut[childKey];
    if (typeof value === 'string' && value.length > 1000) {
      throw new ValidationError('Invalid input', [`${path} must be at most 1000 characters`]);
    }
    out[rootKey] = nestedOut;
  }
  return out;
}

async function upsertOrgConfig(
  db: Pool,
  organizationId: number,
  metaKey: string,
  value: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO organization_settings (organization_id, meta_key, meta_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
    [organizationId, metaKey, JSON.stringify(value)],
  );
}

function parseStoredBusinessHours(raw: string | null): ReturnType<typeof parseBusinessHours> {
  if (typeof raw !== 'string' || raw === '') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parseBusinessHours(parsed);
  } catch {
    return null;
  }
}

function buildDefinitions(): Record<string, unknown> {
  return {
    automationKeys: [...AUTOMATION_SECTION_KEYS],
    providerKeys: [...PROVIDER_SECTION_KEYS],
    deploymentGlobal: {
      automations: ['maxAttempts'],
      note: 'maxAttempts is the deployment-global attempt cap used by automation ticks; organization updates keep the deployment value',
    },
    templateNames: Object.keys(TEMPLATE_SLOTS),
    templateVariables: SUPPORTED_TEMPLATE_VARIABLES.map((name) => ({
      name,
      source:
        name === 'clinic_phone'
          ? 'organization.phone'
          : name === 'clinic_name'
            ? 'organization.name'
            : name === 'booking_link'
              ? null
              : 'automation context',
    })),
    roleMatrix: {
      owner: ['clinic settings', 'templates', 'users'],
      admin: ['organizations', 'users', 'integrations'],
      receptionist: [],
    },
    businessHourDays: [...BUSINESS_HOUR_DAYS],
    clinicFields: [
      'name',
      'phone',
      'email',
      'address',
      'logoUrl',
      'businessHours',
      'timezone',
      'reviewUrl',
    ],
  };
}

export async function getSettings(db: Pool, organizationId: number): Promise<Record<string, unknown>> {
  const [orgRows, reminder, noShow, recall, review, leadAck, missedCall, telephony, whatsapp] =
    await Promise.all([
      db.query<OrganizationSettingsRow[]>(
        `SELECT name, phone, email, address, logo_url, business_hours, timezone, review_url
         FROM organizations WHERE id = ?`,
        [organizationId],
      ).then(([rows]) => rows),
      resolveJson(db, organizationId, REMINDER_CONFIG_META_KEY, isReminderConfig, DEFAULT_REMINDER_CONFIG),
      resolveJson(db, organizationId, NO_SHOW_CONFIG_META_KEY, isNoShowConfig, DEFAULT_NO_SHOW_CONFIG),
      resolveJson(db, organizationId, RECALL_CONFIG_META_KEY, isRecallConfig, DEFAULT_RECALL_CONFIG),
      resolveJson(db, organizationId, REVIEW_CONFIG_META_KEY, isReviewConfig, DEFAULT_REVIEW_CONFIG),
      resolveJson(db, organizationId, ACK_CONFIG_META_KEY, isAckConfig, DEFAULT_ACK_CONFIG),
      resolveJson(
        db,
        organizationId,
        MISSED_CALL_CONFIG_META_KEY,
        isMissedCallConfig,
        DEFAULT_MISSED_CALL_CONFIG,
      ),
      resolveJson(
        db,
        organizationId,
        TELEPHONY_CONFIG_META_KEY,
        isTelephonyConfig,
        DEFAULT_TELEPHONY_CONFIG,
      ),
      resolveJson(
        db,
        organizationId,
        WHATSAPP_CONFIG_META_KEY,
        isWhatsAppConfig,
        DEFAULT_WHATSAPP_CONFIG,
      ),
    ]);
  const org = orgRows[0];
  if (org === undefined) {
    throw new AppError('Organization not found', 404, 'not_found', true);
  }

  const reminderTemplates = reminder.config.templates;
  const noShowTemplates = noShow.config.templates;
  const recallTemplates = recall.config.templates;

  return {
    clinic: {
      name: org.name,
      phone: org.phone,
      email: org.email,
      address: org.address,
      logoUrl: org.logo_url,
      businessHours: parseStoredBusinessHours(org.business_hours),
      timezone: org.timezone,
      reviewUrl: org.review_url,
    },
    automations: {
      reminder: { config: reminder.config, source: reminder.source },
      noShow: { config: noShow.config, source: noShow.source },
      recall: { config: recall.config, source: recall.source },
      review: { config: review.config, source: review.source },
      leadAck: { config: leadAck.config, source: leadAck.source },
      missedCall: { config: missedCall.config, source: missedCall.source },
    },
    providers: {
      telephony: {
        enabled: telephony.config.enabled,
        configured: { signingSecret: telephony.config.signingSecret !== '' },
        source: telephony.source,
      },
      whatsapp: {
        enabled: whatsapp.config.enabled,
        configured: {
          verifyToken: whatsapp.config.verifyToken !== '',
          appSecret: whatsapp.config.appSecret !== '',
          accessToken: whatsapp.config.graph.accessToken !== '',
        },
        graph: {
          phoneNumberId: whatsapp.config.graph.phoneNumberId,
          apiVersion: whatsapp.config.graph.apiVersion,
        },
        source: whatsapp.source,
      },
    },
    templates: {
      lead_acknowledgement: leadAck.config.template,
      missed_call_response: missedCall.config.template,
      appointment_reminder_48h: reminderTemplates['48'] ?? '',
      appointment_reminder_24h: reminderTemplates['24'] ?? '',
      appointment_reminder_2h: reminderTemplates['2'] ?? '',
      no_show_message: noShowTemplates.initial,
      no_show_follow_up: noShowTemplates.followUp,
      recall_message: recallTemplates.recall,
      recall_follow_up: recallTemplates.followUp,
      review_request: review.config.template,
    },
    definitions: buildDefinitions(),
  };
}

async function auditSettingsUpdate(
  db: Pool,
  logger: Logger,
  organizationId: number,
  userId: number,
  section: string,
  fields: readonly string[],
): Promise<void> {
  const detail = `section=${section} fields=${fields.join(',')}`;
  logger.info('settings updated', { organizationId, section, fields: [...fields] });
  await recordAudit(db, logger, {
    organizationId,
    userId,
    action: 'settings_updated',
    detail,
  });
}

export async function patchClinic(
  db: Pool,
  logger: Logger,
  organizationId: number,
  userId: number,
  rawBody: unknown,
): Promise<Record<string, unknown>> {
  const body = asObject(rawBody, 'body');
  const provided = Object.keys(body);
  if (provided.length === 0) {
    throw new ValidationError('Invalid input', ['at least one field to update is required']);
  }
  const allowed = [
    'name',
    'phone',
    'email',
    'address',
    'logoUrl',
    'businessHours',
    'timezone',
    'reviewUrl',
  ];
  for (const key of provided) {
    if (!allowed.includes(key)) {
      throw new ValidationError('Invalid input', [`unknown or not updatable field: ${key}`]);
    }
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    params.push(requireString(body.name, 'name', { min: 1, max: 120 }));
  }
  if (body.phone !== undefined) {
    sets.push('phone = ?');
    params.push(
      body.phone === null || body.phone === '' ? null : normalizePhone(body.phone, 'phone'),
    );
  }
  if (body.email !== undefined) {
    sets.push('email = ?');
    params.push(optionalEmail(body.email));
  }
  if (body.address !== undefined) {
    sets.push('address = ?');
    params.push(optionalText(body.address, 'address', 200));
  }
  if (body.logoUrl !== undefined) {
    sets.push('logo_url = ?');
    params.push(parseReviewUrl(body.logoUrl, 'logoUrl'));
  }
  if (body.businessHours !== undefined) {
    sets.push('business_hours = ?');
    params.push(
      body.businessHours === null || body.businessHours === ''
        ? null
        : JSON.stringify(parseBusinessHours(body.businessHours)),
    );
  }
  if (body.timezone !== undefined) {
    sets.push('timezone = ?');
    params.push(parseTimezone(body.timezone));
  }
  if (body.reviewUrl !== undefined) {
    sets.push('review_url = ?');
    params.push(parseReviewUrl(body.reviewUrl, 'reviewUrl'));
  }
  params.push(organizationId);
  const [result] = await db.query(
    `UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`,
    params,
  );
  if ((result as { affectedRows: number }).affectedRows === 0) {
    throw new AppError('Organization not found', 404, 'not_found', true);
  }
  await auditSettingsUpdate(db, logger, organizationId, userId, 'clinic', provided);
  return getSettings(db, organizationId);
}

function invalidSection(key: string): never {
  throw new ValidationError('Invalid input', [`unknown configuration key: ${key}`]);
}

function assertValid(
  valid: boolean,
  key: string,
): void {
  if (!valid) {
    throw new ValidationError('Invalid input', [
      `invalid ${key} configuration after applying changes`,
    ]);
  }
}

export async function patchAutomation(
  db: Pool,
  logger: Logger,
  organizationId: number,
  userId: number,
  key: string,
  rawBody: unknown,
): Promise<Record<string, unknown>> {
  const fields = Object.keys(asObject(rawBody, 'body'));
  switch (key) {
    case 'reminder': {
      const base = await resolveJson(
        db,
        organizationId,
        REMINDER_CONFIG_META_KEY,
        isReminderConfig,
        DEFAULT_REMINDER_CONFIG,
      );
      const global = await resolveJson(
        db,
        undefined,
        REMINDER_CONFIG_META_KEY,
        isReminderConfig,
        DEFAULT_REMINDER_CONFIG,
      );
      const merged = mergeSection(base.config, rawBody, {
        nested: ['templates', 'quietHours'],
        deploymentGlobal: ['maxAttempts'],
      });
      merged.maxAttempts = global.config.maxAttempts;
      assertValid(isReminderConfig(merged), key);
      await upsertOrgConfig(db, organizationId, REMINDER_CONFIG_META_KEY, merged);
      break;
    }
    case 'noShow': {
      const base = await resolveJson(
        db,
        organizationId,
        NO_SHOW_CONFIG_META_KEY,
        isNoShowConfig,
        DEFAULT_NO_SHOW_CONFIG,
      );
      const global = await resolveJson(
        db,
        undefined,
        NO_SHOW_CONFIG_META_KEY,
        isNoShowConfig,
        DEFAULT_NO_SHOW_CONFIG,
      );
      const merged = mergeSection(base.config, rawBody, {
        nested: ['templates'],
        deploymentGlobal: ['maxAttempts'],
      });
      merged.maxAttempts = global.config.maxAttempts;
      assertValid(isNoShowConfig(merged), key);
      await upsertOrgConfig(db, organizationId, NO_SHOW_CONFIG_META_KEY, merged);
      break;
    }
    case 'recall': {
      const base = await resolveJson(
        db,
        organizationId,
        RECALL_CONFIG_META_KEY,
        isRecallConfig,
        DEFAULT_RECALL_CONFIG,
      );
      const global = await resolveJson(
        db,
        undefined,
        RECALL_CONFIG_META_KEY,
        isRecallConfig,
        DEFAULT_RECALL_CONFIG,
      );
      const merged = mergeSection(base.config, rawBody, {
        nested: ['templates'],
        deploymentGlobal: ['maxAttempts'],
      });
      merged.maxAttempts = global.config.maxAttempts;
      assertValid(isRecallConfig(merged), key);
      await upsertOrgConfig(db, organizationId, RECALL_CONFIG_META_KEY, merged);
      break;
    }
    case 'review': {
      const base = await resolveJson(
        db,
        organizationId,
        REVIEW_CONFIG_META_KEY,
        isReviewConfig,
        DEFAULT_REVIEW_CONFIG,
      );
      const global = await resolveJson(
        db,
        undefined,
        REVIEW_CONFIG_META_KEY,
        isReviewConfig,
        DEFAULT_REVIEW_CONFIG,
      );
      const merged = mergeSection(base.config, rawBody, {
        nested: [],
        deploymentGlobal: ['maxAttempts'],
      });
      merged.maxAttempts = global.config.maxAttempts;
      assertValid(isReviewConfig(merged), key);
      await upsertOrgConfig(db, organizationId, REVIEW_CONFIG_META_KEY, merged);
      break;
    }
    case 'leadAck': {
      const base = await resolveJson(
        db,
        organizationId,
        ACK_CONFIG_META_KEY,
        isAckConfig,
        DEFAULT_ACK_CONFIG,
      );
      const merged = mergeSection(base.config, rawBody, {
        nested: [],
        deploymentGlobal: [],
      });
      assertValid(isAckConfig(merged), key);
      await upsertOrgConfig(db, organizationId, ACK_CONFIG_META_KEY, merged);
      break;
    }
    case 'missedCall': {
      const base = await resolveJson(
        db,
        organizationId,
        MISSED_CALL_CONFIG_META_KEY,
        isMissedCallConfig,
        DEFAULT_MISSED_CALL_CONFIG,
      );
      const merged = mergeSection(base.config, rawBody, {
        nested: [],
        deploymentGlobal: [],
      });
      assertValid(isMissedCallConfig(merged), key);
      await upsertOrgConfig(db, organizationId, MISSED_CALL_CONFIG_META_KEY, merged);
      break;
    }
    default:
      invalidSection(key);
  }
  await auditSettingsUpdate(db, logger, organizationId, userId, `automations:${key}`, fields);
  return getSettings(db, organizationId);
}

export async function patchProvider(
  db: Pool,
  logger: Logger,
  organizationId: number,
  userId: number,
  key: string,
  rawBody: unknown,
): Promise<Record<string, unknown>> {
  const fields = Object.keys(asObject(rawBody, 'body'));
  switch (key) {
    case 'telephony': {
      const base = await resolveJson(
        db,
        organizationId,
        TELEPHONY_CONFIG_META_KEY,
        isTelephonyConfig,
        DEFAULT_TELEPHONY_CONFIG,
      );
      const patch = sanitizeNullableStrings(rawBody, ['signingSecret']);
      const merged = mergeSection(base.config, patch, {
        nested: [],
        deploymentGlobal: [],
      });
      assertValid(isTelephonyConfig(merged), key);
      await upsertOrgConfig(db, organizationId, TELEPHONY_CONFIG_META_KEY, merged);
      break;
    }
    case 'whatsapp': {
      const base = await resolveJson(
        db,
        organizationId,
        WHATSAPP_CONFIG_META_KEY,
        isWhatsAppConfig,
        DEFAULT_WHATSAPP_CONFIG,
      );
      const patch = sanitizeNullableStrings(rawBody, [
        'verifyToken',
        'appSecret',
        'graph.accessToken',
        'graph.phoneNumberId',
        'graph.apiVersion',
      ]);
      const merged = mergeSection(base.config, patch, {
        nested: ['graph'],
        deploymentGlobal: [],
      });
      assertValid(isWhatsAppConfig(merged), key);
      await upsertOrgConfig(db, organizationId, WHATSAPP_CONFIG_META_KEY, merged);
      break;
    }
    default:
      invalidSection(key);
  }
  await auditSettingsUpdate(db, logger, organizationId, userId, `providers:${key}`, fields);
  return getSettings(db, organizationId);
}

function readTemplateBody(rawBody: unknown): unknown {
  const body = asObject(rawBody, 'body');
  const provided = Object.keys(body);
  for (const key of provided) {
    if (key !== 'body') {
      throw new ValidationError('Invalid input', [`unknown or not updatable field: ${key}`]);
    }
  }
  if (body.body === undefined) {
    throw new ValidationError('Invalid input', ['body is required']);
  }
  return body.body;
}

async function loadSectionConfig(
  db: Pool,
  organizationId: number,
  section: AutomationSectionKey,
): Promise<{ metaKey: string; config: Record<string, unknown> }> {
  switch (section) {
    case 'reminder': {
      const resolved = await resolveJson(
        db,
        organizationId,
        REMINDER_CONFIG_META_KEY,
        isReminderConfig,
        DEFAULT_REMINDER_CONFIG,
      );
      return {
        metaKey: REMINDER_CONFIG_META_KEY,
        config: resolved.config as unknown as Record<string, unknown>,
      };
    }
    case 'noShow': {
      const resolved = await resolveJson(
        db,
        organizationId,
        NO_SHOW_CONFIG_META_KEY,
        isNoShowConfig,
        DEFAULT_NO_SHOW_CONFIG,
      );
      return {
        metaKey: NO_SHOW_CONFIG_META_KEY,
        config: resolved.config as unknown as Record<string, unknown>,
      };
    }
    case 'recall': {
      const resolved = await resolveJson(
        db,
        organizationId,
        RECALL_CONFIG_META_KEY,
        isRecallConfig,
        DEFAULT_RECALL_CONFIG,
      );
      return {
        metaKey: RECALL_CONFIG_META_KEY,
        config: resolved.config as unknown as Record<string, unknown>,
      };
    }
    case 'review': {
      const resolved = await resolveJson(
        db,
        organizationId,
        REVIEW_CONFIG_META_KEY,
        isReviewConfig,
        DEFAULT_REVIEW_CONFIG,
      );
      return {
        metaKey: REVIEW_CONFIG_META_KEY,
        config: resolved.config as unknown as Record<string, unknown>,
      };
    }
    case 'leadAck': {
      const resolved = await resolveJson(
        db,
        organizationId,
        ACK_CONFIG_META_KEY,
        isAckConfig,
        DEFAULT_ACK_CONFIG,
      );
      return {
        metaKey: ACK_CONFIG_META_KEY,
        config: resolved.config as unknown as Record<string, unknown>,
      };
    }
    case 'missedCall': {
      const resolved = await resolveJson(
        db,
        organizationId,
        MISSED_CALL_CONFIG_META_KEY,
        isMissedCallConfig,
        DEFAULT_MISSED_CALL_CONFIG,
      );
      return {
        metaKey: MISSED_CALL_CONFIG_META_KEY,
        config: resolved.config as unknown as Record<string, unknown>,
      };
    }
  }
}

function assertSectionValid(
  section: AutomationSectionKey,
  config: Record<string, unknown>,
): void {
  let valid = false;
  switch (section) {
    case 'reminder':
      valid = isReminderConfig(config);
      break;
    case 'noShow':
      valid = isNoShowConfig(config);
      break;
    case 'recall':
      valid = isRecallConfig(config);
      break;
    case 'review':
      valid = isReviewConfig(config);
      break;
    case 'leadAck':
      valid = isAckConfig(config);
      break;
    case 'missedCall':
      valid = isMissedCallConfig(config);
      break;
  }
  assertValid(valid, section);
}

export async function patchTemplate(
  db: Pool,
  logger: Logger,
  organizationId: number,
  userId: number,
  templateName: string,
  rawBody: unknown,
): Promise<Record<string, unknown>> {
  const slot = Object.prototype.hasOwnProperty.call(TEMPLATE_SLOTS, templateName)
    ? TEMPLATE_SLOTS[templateName]
    : undefined;
  if (slot === undefined) {
    throw new ValidationError('Invalid input', [`unknown template: ${templateName}`]);
  }
  const body = readTemplateBody(rawBody);
  const text = requireString(body, 'body', { min: 1, max: 2000 });
  const section = slot.section;
  const resolved = await loadSectionConfig(db, organizationId, section);
  const config = resolved.config;
  let container: Record<string, unknown> = config;
  for (let i = 0; i < slot.path.length - 1; i += 1) {
    const key = slot.path[i] ?? '';
    const nested = container[key];
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
      throw new ValidationError('Invalid input', [`template path is not configurable: ${templateName}`]);
    }
    container = nested as Record<string, unknown>;
  }
  const leafKey = slot.path[slot.path.length - 1] ?? '';
  container[leafKey] = text;
  assertSectionValid(section, config);
  await upsertOrgConfig(db, organizationId, resolved.metaKey, config);
  await auditSettingsUpdate(db, logger, organizationId, userId, 'templates', [templateName]);
  return getSettings(db, organizationId);
}

export async function previewTemplate(
  db: Pool,
  organizationId: number,
  rawBody: unknown,
): Promise<{ rendered: string; unknownVariables: string[] }> {
  const body = asObject(rawBody, 'body');
  const provided = Object.keys(body);
  for (const key of provided) {
    if (key !== 'body' && key !== 'variables') {
      throw new ValidationError('Invalid input', [`unknown field: ${key}`]);
    }
  }
  if (body.body === undefined) {
    throw new ValidationError('Invalid input', ['body is required']);
  }
  const text = requireString(body.body, 'body', { min: 0, max: 2000 });
  const callerVariables: Record<string, string> = {};
  if (body.variables !== undefined) {
    const variables = asObject(body.variables, 'variables');
    for (const [name, value] of Object.entries(variables)) {
      if (!(SUPPORTED_TEMPLATE_VARIABLES as readonly string[]).includes(name)) {
        throw new ValidationError('Invalid input', [
          `variables.${name} is not a supported template variable`,
        ]);
      }
      if (typeof value !== 'string') {
        throw new ValidationError('Invalid input', [`variables.${name} must be a string`]);
      }
      callerVariables[name] = value;
    }
  }
  const [orgRows] = await db.query<OrganizationSettingsRow[]>(
    'SELECT name, phone FROM organizations WHERE id = ?',
    [organizationId],
  );
  const org = orgRows[0];
  if (org === undefined) {
    throw new AppError('Organization not found', 404, 'not_found', true);
  }
  const samples: Record<string, string> = {
    first_name: 'Sarah',
    clinic_name: org.name,
    appointment_date: '14 October',
    appointment_time: '15:00',
    clinic_phone: org.phone ?? '',
    booking_link: '',
  };
  const rendered = renderTemplate(text, { ...samples, ...callerVariables });
  const unknownVariables = listTemplateVariables(text).filter(
    (name) => !(SUPPORTED_TEMPLATE_VARIABLES as readonly string[]).includes(name),
  );
  return { rendered, unknownVariables };
}
