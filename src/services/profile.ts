import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { verifyPassword } from '../auth/password';
import type { SessionUser } from '../auth/sessions';
import { isThemeChoice } from '../theme';
import type { ThemeChoice } from '../theme';
import { recordAudit } from '../audit';
import { organizationAccess } from '../billing/entitlement';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import { normalizeEmail, normalizePhone, optionalEmail, optionalText, requireString } from '../validate';

export interface ProfileUser {
  id: number;
  email: string;
  role: SessionUser['role'];
  organizationId: number | null;
  displayName: string | null;
  phone: string | null;
  theme: ThemeChoice;
}

export interface ProfileClinic {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface ProfileView {
  user: ProfileUser;
  clinic: ProfileClinic | null;
}

interface ProfileRow extends RowDataPacket {
  id: number;
  email: string;
  role: SessionUser['role'];
  organization_id: number | null;
  display_name: string | null;
  phone: string | null;
  theme: ThemeChoice;
  password_hash: string;
  clinic_name: string | null;
  clinic_phone: string | null;
  clinic_email: string | null;
  clinic_address: string | null;
}

const USER_FIELDS = new Set(['displayName', 'phone', 'email', 'currentPassword', 'theme']);
const CLINIC_FIELDS = new Set(['name', 'phone', 'email', 'address']);

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Invalid input', [`${name} must be an object`]);
  }
  return value as Record<string, unknown>;
}

function requireTheme(value: unknown): ThemeChoice {
  if (!isThemeChoice(value)) {
    throw new ValidationError('Invalid input', ['theme must be light, dark, or system']);
  }
  return value;
}

function optionalDisplayName(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ValidationError('Invalid input', ['displayName must be a string']);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > 120) {
    throw new ValidationError('Invalid input', ['displayName must be at most 120 characters']);
  }
  return trimmed;
}

function optionalPhone(value: unknown, name: string): string | null {
  if (value === null || value === '') {
    return null;
  }
  return normalizePhone(value, name);
}

function toUser(row: ProfileRow): ProfileUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    organizationId: row.organization_id,
    displayName: row.display_name,
    phone: row.phone,
    theme: row.theme,
  };
}

function toClinic(row: ProfileRow): ProfileClinic | null {
  if (row.role !== 'owner' || row.organization_id === null || row.clinic_name === null) {
    return null;
  }
  return {
    name: row.clinic_name,
    phone: row.clinic_phone,
    email: row.clinic_email,
    address: row.clinic_address,
  };
}

async function loadProfile(db: Pool, userId: number): Promise<ProfileRow> {
  const [rows] = await db.query<ProfileRow[]>(
    `SELECT u.id, u.email, u.role, u.organization_id, u.display_name, u.phone, u.theme, u.password_hash,
            o.name AS clinic_name, o.phone AS clinic_phone, o.email AS clinic_email, o.address AS clinic_address
     FROM users u
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = ?`,
    [userId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Account not found', 404, 'not_found', true);
  }
  return row;
}

export async function getProfile(db: Pool, userId: number): Promise<ProfileView> {
  const row = await loadProfile(db, userId);
  return { user: toUser(row), clinic: toClinic(row) };
}

interface ClinicPatch {
  name?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

function parseClinic(value: unknown): ClinicPatch {
  const body = asObject(value, 'clinic');
  const keys = Object.keys(body);
  if (keys.length === 0) {
    throw new ValidationError('Invalid input', ['clinic must include at least one field']);
  }
  for (const key of keys) {
    if (!CLINIC_FIELDS.has(key)) {
      throw new ValidationError('Invalid input', [`unknown clinic field: ${key}`]);
    }
  }
  const patch: ClinicPatch = {};
  if (body.name !== undefined) {
    patch.name = requireString(body.name, 'name', { min: 1, max: 120 });
  }
  if (body.phone !== undefined) {
    patch.phone = optionalPhone(body.phone, 'phone');
  }
  if (body.email !== undefined) {
    patch.email = optionalEmail(body.email);
  }
  if (body.address !== undefined) {
    const trimmed = typeof body.address === 'string' ? body.address.trim() : body.address;
    patch.address = optionalText(trimmed, 'address', 255);
  }
  return patch;
}

export async function updateProfile(
  db: Pool,
  logger: Logger,
  actor: SessionUser,
  rawBody: unknown,
): Promise<ProfileView> {
  const body = asObject(rawBody, 'body');
  const keys = Object.keys(body);
  if (keys.length === 0) {
    throw new ValidationError('Invalid input', ['at least one field to update is required']);
  }
  for (const key of keys) {
    if (key !== 'clinic' && !USER_FIELDS.has(key)) {
      throw new ValidationError('Invalid input', [`unknown or not updatable field: ${key}`]);
    }
  }

  const current = await loadProfile(db, actor.id);
  if (body.clinic !== undefined && (actor.role !== 'owner' || actor.organizationId === null)) {
    throw new AppError('Forbidden', 403, 'forbidden', true);
  }

  const theme = body.theme === undefined ? undefined : requireTheme(body.theme);
  const displayName = body.displayName === undefined ? undefined : optionalDisplayName(body.displayName);
  const phone = body.phone === undefined ? undefined : optionalPhone(body.phone, 'phone');
  let nextEmail: string | undefined;
  if (body.email !== undefined) {
    nextEmail = normalizeEmail(body.email);
    if (nextEmail === current.email) {
      nextEmail = undefined;
    }
  }
  const clinic = body.clinic === undefined ? null : parseClinic(body.clinic);

  if (clinic !== null && actor.organizationId !== null) {
    const access = await organizationAccess(db, actor.organizationId);
    if (access !== null && access.readOnly) {
      const trial = access.phase === 'trial_expired';
      throw new AppError(
        trial
          ? 'Your free trial has ended. Clinic details stay unchanged until the clinic is activated.'
          : 'The subscription for this clinic has ended. Clinic details stay unchanged until it is renewed.',
        403,
        trial ? 'trial_expired' : 'subscription_expired',
        true,
      );
    }
  }

  if (nextEmail !== undefined) {
    const currentPassword = body.currentPassword;
    if (typeof currentPassword !== 'string' || currentPassword === '') {
      throw new ValidationError('Invalid input', ['currentPassword is required to change email']);
    }
    const passwordOk = await verifyPassword(currentPassword, current.password_hash);
    if (!passwordOk) {
      throw new AppError('Current password is incorrect', 401, 'invalid_credentials', true);
    }
    const [taken] = await db.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ? AND id <> ?',
      [nextEmail, actor.id],
    );
    if (taken.length > 0) {
      throw new AppError('An account with this email already exists', 409, 'email_taken', true);
    }
  }

  const userSets: string[] = [];
  const userParams: unknown[] = [];
  const changed: string[] = [];
  if (theme !== undefined) {
    userSets.push('theme = ?');
    userParams.push(theme);
    changed.push('theme');
  }
  if (displayName !== undefined) {
    userSets.push('display_name = ?');
    userParams.push(displayName);
    changed.push('displayName');
  }
  if (phone !== undefined) {
    userSets.push('phone = ?');
    userParams.push(phone);
    changed.push('phone');
  }
  if (nextEmail !== undefined) {
    userSets.push('email = ?');
    userParams.push(nextEmail);
    changed.push('email');
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (userSets.length > 0) {
      userParams.push(actor.id);
      try {
        await connection.query<ResultSetHeader>(
          `UPDATE users SET ${userSets.join(', ')} WHERE id = ?`,
          userParams,
        );
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY') {
          throw new AppError('An account with this email already exists', 409, 'email_taken', true);
        }
        throw err;
      }
    }
    if (clinic !== null && actor.organizationId !== null) {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (clinic.name !== undefined) {
        sets.push('name = ?');
        params.push(clinic.name);
        changed.push('clinic.name');
      }
      if (clinic.phone !== undefined) {
        sets.push('phone = ?');
        params.push(clinic.phone);
        changed.push('clinic.phone');
      }
      if (clinic.email !== undefined) {
        sets.push('email = ?');
        params.push(clinic.email);
        changed.push('clinic.email');
      }
      if (clinic.address !== undefined) {
        sets.push('address = ?');
        params.push(clinic.address);
        changed.push('clinic.address');
      }
      if (sets.length > 0) {
        params.push(actor.organizationId);
        const [result] = await connection.query<ResultSetHeader>(
          `UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`,
          params,
        );
        if (result.affectedRows === 0) {
          throw new AppError('Organization not found', 404, 'not_found', true);
        }
      }
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  if (changed.length > 0) {
    await recordAudit(db, logger, {
      organizationId: actor.organizationId,
      userId: actor.id,
      action: 'profile_updated',
      detail: `fields=${changed.join(',')}`,
    });
  }

  return getProfile(db, actor.id);
}
