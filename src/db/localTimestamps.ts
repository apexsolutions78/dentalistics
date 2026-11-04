import type { Pool, RowDataPacket } from 'mysql2/promise';

/**
 * One-time correction for DATETIME values written by MySQL
 * CURRENT_TIMESTAMP / ON UPDATE CURRENT_TIMESTAMP while the session
 * time zone was the server's local zone.
 *
 * DATETIME stores a wall clock with no zone. mysql2 is configured with
 * timezone 'Z', so it reads that wall clock as UTC. On a server whose
 * session time zone was Asia/Karachi (UTC+5), a default timestamp was
 * stored five hours ahead of the real UTC instant.
 *
 * Do not run this from `npm run migrate`. The offset depends on the
 * server that wrote the rows, so applying it automatically on a UTC
 * database would corrupt correct data. The script is idempotent because
 * a successful --apply writes app_meta.timestamp_local_correction and
 * every later run, including --apply, changes nothing.
 *
 * Only columns that are populated exclusively by the session clock are
 * shifted. Columns written with UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP()),
 * or a JavaScript Date (mysql2 sends the UTC wall clock) are listed in
 * DO_NOT_SHIFT_COLUMNS and left alone. leads.last_activity_at is mixed:
 * the insert default is the session clock, but later updates use
 * UTC_TIMESTAMP(). It is shifted only while it still equals created_at,
 * which is the row that was never updated after insert.
 *
 * Run once, after the process that sets session time_zone to '+00:00'
 * has been restarted, with --before set to that restart instant in UTC.
 * Rows written after the restart are already UTC and must not be shifted.
 *
 *   npm run db:correct-timestamps -- --offset-minutes 300 --before 2026-11-04T08:00:00Z
 *   npm run db:correct-timestamps -- --offset-minutes 300 --before 2026-11-04T08:00:00Z --apply
 *
 * --offset-minutes is how far ahead of UTC the stored wall clock is.
 * Asia/Karachi is 300. Positive offsets are subtracted. Dry-run is the
 * default and does not write the marker.
 */

export const TIMESTAMP_CORRECTION_META_KEY = 'timestamp_local_correction';

export interface TimestampColumn {
  table: string;
  column: string;
}

export const LOCAL_WALL_CLOCK_COLUMNS: readonly TimestampColumn[] = [
  { table: 'app_meta', column: 'created_at' },
  { table: 'organizations', column: 'created_at' },
  { table: 'users', column: 'created_at' },
  { table: 'sessions', column: 'created_at' },
  { table: 'audit_logs', column: 'created_at' },
  { table: 'patients', column: 'created_at' },
  { table: 'patients', column: 'updated_at' },
  { table: 'leads', column: 'created_at' },
  { table: 'leads', column: 'updated_at' },
  { table: 'lead_activities', column: 'created_at' },
  { table: 'communication_messages', column: 'created_at' },
  { table: 'communication_messages', column: 'updated_at' },
  { table: 'appointments', column: 'created_at' },
  { table: 'appointments', column: 'updated_at' },
  { table: 'appointment_reminders', column: 'created_at' },
  { table: 'appointment_reminders', column: 'updated_at' },
  { table: 'no_show_cases', column: 'created_at' },
  { table: 'no_show_cases', column: 'updated_at' },
  { table: 'no_show_messages', column: 'created_at' },
  { table: 'no_show_messages', column: 'updated_at' },
  { table: 'recalls', column: 'created_at' },
  { table: 'recalls', column: 'updated_at' },
  { table: 'recall_messages', column: 'created_at' },
  { table: 'recall_messages', column: 'updated_at' },
  { table: 'review_requests', column: 'created_at' },
  { table: 'review_requests', column: 'updated_at' },
  { table: 'call_events', column: 'received_at' },
  { table: 'call_events', column: 'created_at' },
  { table: 'call_events', column: 'updated_at' },
  { table: 'organization_settings', column: 'created_at' },
  { table: 'organization_settings', column: 'updated_at' },
  { table: 'webhook_events', column: 'created_at' },
  { table: 'error_events', column: 'created_at' },
  { table: 'password_reset_tokens', column: 'created_at' },
  { table: 'doctors', column: 'created_at' },
  { table: 'doctors', column: 'updated_at' },
  { table: 'lead_slot_suggestions', column: 'created_at' },
  { table: 'lead_slot_suggestions', column: 'updated_at' },
  { table: 'payments', column: 'created_at' },
  { table: 'payments', column: 'updated_at' },
  { table: 'schema_migrations', column: 'applied_at' },
];

export const EQUAL_CREATED_AT_COLUMNS: readonly TimestampColumn[] = [
  { table: 'leads', column: 'last_activity_at' },
];

export const DO_NOT_SHIFT_COLUMNS: readonly TimestampColumn[] = [
  { table: 'users', column: 'last_login_at' },
  { table: 'sessions', column: 'expires_at' },
  { table: 'organizations', column: 'trial_ends_at' },
  { table: 'organizations', column: 'onboarding_completed_at' },
  { table: 'organizations', column: 'paid_until' },
  { table: 'organizations', column: 'subscription_lapsed_at' },
  { table: 'leads', column: 'urgency_computed_at' },
  { table: 'communication_messages', column: 'sent_at' },
  { table: 'communication_messages', column: 'delivered_at' },
  { table: 'appointment_reminders', column: 'scheduled_at' },
  { table: 'appointment_reminders', column: 'sent_at' },
  { table: 'no_show_cases', column: 'opened_at' },
  { table: 'no_show_cases', column: 'closed_at' },
  { table: 'no_show_messages', column: 'scheduled_at' },
  { table: 'no_show_messages', column: 'sent_at' },
  { table: 'recalls', column: 'last_contacted_at' },
  { table: 'recalls', column: 'opened_at' },
  { table: 'recalls', column: 'closed_at' },
  { table: 'recall_messages', column: 'scheduled_at' },
  { table: 'recall_messages', column: 'sent_at' },
  { table: 'review_requests', column: 'scheduled_at' },
  { table: 'review_requests', column: 'sent_at' },
  { table: 'call_events', column: 'occurred_at' },
  { table: 'password_reset_tokens', column: 'expires_at' },
  { table: 'password_reset_tokens', column: 'used_at' },
  { table: 'lead_slot_suggestions', column: 'decided_at' },
  { table: 'payments', column: 'paid_at' },
];

const MAX_OFFSET_MINUTES = 14 * 60;

export function columnKey(column: TimestampColumn): string {
  return `${column.table}.${column.column}`;
}

function assertIdentifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
}

export interface CorrectionOptions {
  offsetMinutes: number;
  before: Date;
  apply: boolean;
}

export interface CorrectionColumnResult {
  table: string;
  column: string;
  rows: number;
}

export interface CorrectionResult {
  status: 'dry_run' | 'applied' | 'already_applied';
  offsetMinutes: number;
  before: string;
  columns: CorrectionColumnResult[];
  marker: string | null;
}

interface CountRow extends RowDataPacket {
  n: number;
}

interface MarkerRow extends RowDataPacket {
  meta_value: string;
}

interface SchemaColumnRow extends RowDataPacket {
  table_name: string;
  column_name: string;
}

function assertOptions(options: CorrectionOptions): void {
  if (!Number.isInteger(options.offsetMinutes) || options.offsetMinutes < 1 || options.offsetMinutes > MAX_OFFSET_MINUTES) {
    throw new Error(`offsetMinutes must be an integer from 1 to ${MAX_OFFSET_MINUTES}`);
  }
  if (Number.isNaN(options.before.getTime())) {
    throw new Error('before must be a valid date');
  }
}

async function readMarker(db: Pool): Promise<string | null> {
  const [rows] = await db.query<MarkerRow[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [TIMESTAMP_CORRECTION_META_KEY],
  );
  return rows[0]?.meta_value ?? null;
}

async function countColumn(
  db: Pool,
  column: TimestampColumn,
  before: Date,
  predicateSql: string,
): Promise<number> {
  assertIdentifier(column.table);
  assertIdentifier(column.column);
  const [rows] = await db.query<CountRow[]>(
    `SELECT COUNT(*) AS n FROM \`${column.table}\` WHERE \`${column.column}\` IS NOT NULL AND ${predicateSql}`,
    [before],
  );
  return Number(rows[0]?.n ?? 0);
}

async function presentColumns(db: Pool): Promise<Set<string>> {
  const [rows] = await db.query<SchemaColumnRow[]>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE IN ('datetime', 'timestamp')`,
  );
  const present = new Set<string>();
  for (const row of rows) {
    present.add(`${row.table_name}.${row.column_name}`);
  }
  return present;
}

export async function correctLocalTimestamps(
  db: Pool,
  options: CorrectionOptions,
): Promise<CorrectionResult> {
  assertOptions(options);
  const beforeIso = options.before.toISOString();
  const marker = await readMarker(db);
  if (marker !== null) {
    return {
      status: 'already_applied',
      offsetMinutes: options.offsetMinutes,
      before: beforeIso,
      columns: [],
      marker,
    };
  }

  const present = await presentColumns(db);
  const columns: CorrectionColumnResult[] = [];

  const specials = EQUAL_CREATED_AT_COLUMNS.filter((column) => present.has(columnKey(column)));
  const generics = LOCAL_WALL_CLOCK_COLUMNS.filter((column) => present.has(columnKey(column)));

  for (const column of specials) {
    const predicate = `\`${column.column}\` = \`created_at\` AND \`created_at\` < ?`;
    const rows = await countColumn(db, column, options.before, predicate);
    columns.push({ table: column.table, column: column.column, rows });
  }
  for (const column of generics) {
    const predicate = `\`${column.column}\` < ?`;
    const rows = await countColumn(db, column, options.before, predicate);
    columns.push({ table: column.table, column: column.column, rows });
  }

  if (!options.apply) {
    return {
      status: 'dry_run',
      offsetMinutes: options.offsetMinutes,
      before: beforeIso,
      columns,
      marker: null,
    };
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [locked] = await connection.query<MarkerRow[]>(
      'SELECT meta_value FROM app_meta WHERE meta_key = ? FOR UPDATE',
      [TIMESTAMP_CORRECTION_META_KEY],
    );
    if (locked.length > 0) {
      await connection.rollback();
      return {
        status: 'already_applied',
        offsetMinutes: options.offsetMinutes,
        before: beforeIso,
        columns: [],
        marker: locked[0]?.meta_value ?? null,
      };
    }

    for (const column of specials) {
      assertIdentifier(column.table);
      assertIdentifier(column.column);
      await connection.query(
        `UPDATE \`${column.table}\`
         SET \`${column.column}\` = DATE_SUB(\`${column.column}\`, INTERVAL ${options.offsetMinutes} MINUTE)
         WHERE \`${column.column}\` = \`created_at\` AND \`created_at\` < ?`,
        [options.before],
      );
    }
    for (const column of generics) {
      assertIdentifier(column.table);
      assertIdentifier(column.column);
      await connection.query(
        `UPDATE \`${column.table}\`
         SET \`${column.column}\` = DATE_SUB(\`${column.column}\`, INTERVAL ${options.offsetMinutes} MINUTE)
         WHERE \`${column.column}\` < ?`,
        [options.before],
      );
    }

    const stored = JSON.stringify({
      offsetMinutes: options.offsetMinutes,
      before: beforeIso,
      appliedAt: new Date().toISOString(),
    });
    await connection.query(
      'INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)',
      [TIMESTAMP_CORRECTION_META_KEY, stored],
    );
    await connection.commit();
    return {
      status: 'applied',
      offsetMinutes: options.offsetMinutes,
      before: beforeIso,
      columns,
      marker: stored,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export function classifiedDatetimeColumns(): Set<string> {
  const keys = new Set<string>();
  for (const column of [...LOCAL_WALL_CLOCK_COLUMNS, ...EQUAL_CREATED_AT_COLUMNS, ...DO_NOT_SHIFT_COLUMNS]) {
    const key = columnKey(column);
    if (keys.has(key)) {
      throw new Error(`Timestamp column classified twice: ${key}`);
    }
    keys.add(key);
  }
  return keys;
}
