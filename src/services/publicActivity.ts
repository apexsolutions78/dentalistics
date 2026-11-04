import type { Pool, RowDataPacket } from 'mysql2/promise';

/**
 * Public, unauthenticated activity for the sign-in page.
 * Events are aggregated across clinics and reduced to a kind,
 * an allowlisted service word, and an age in minutes.
 * Do not add names, phones, emails, message text, clinic names,
 * organization ids, or exact timestamps to the response or the cache.
 */

export const PUBLIC_ACTIVITY_TTL_MS = 45_000;
export const PUBLIC_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_ACTIVITY_LIMIT = 3;
const PER_SOURCE_LIMIT = 5;
const FUTURE_SKEW_MS = 2 * 60_000;

export const PUBLIC_ACTIVITY_KINDS = ['enquiry', 'reply', 'booking'] as const;
export type PublicActivityKind = (typeof PUBLIC_ACTIVITY_KINDS)[number];

export interface PublicActivityEvent {
  kind: PublicActivityKind;
  label: string;
  minutesAgo: number;
}

export interface PublicActivityResponse {
  events: PublicActivityEvent[];
}

interface RawActivity {
  kind: string;
  service: string | null;
  occurredAt: Date;
}

interface StoredEvent {
  kind: PublicActivityKind;
  service: string | null;
  occurredAtMs: number;
}

interface TimeRow extends RowDataPacket {
  service: string | null;
  occurred_at: Date | string | null;
}

const CANONICAL = new Map<string, string>([
  ['cleaning', 'cleaning'],
  ['cleanings', 'cleaning'],
  ['hygiene', 'cleaning'],
  ['scale', 'cleaning'],
  ['scaling', 'cleaning'],
  ['polish', 'cleaning'],
  ['prophylaxis', 'cleaning'],
  ['checkup', 'checkup'],
  ['checkups', 'checkup'],
  ['exam', 'checkup'],
  ['examination', 'checkup'],
  ['whitening', 'whitening'],
  ['bleaching', 'whitening'],
  ['filling', 'filling'],
  ['fillings', 'filling'],
  ['extraction', 'extraction'],
  ['extractions', 'extraction'],
  ['crown', 'crown'],
  ['crowns', 'crown'],
  ['implant', 'implant'],
  ['implants', 'implant'],
  ['consultation', 'consultation'],
  ['consult', 'consultation'],
  ['emergency', 'emergency'],
  ['veneer', 'veneer'],
  ['veneers', 'veneer'],
  ['denture', 'dentures'],
  ['dentures', 'dentures'],
  ['braces', 'braces'],
  ['orthodontics', 'braces'],
  ['aligner', 'braces'],
  ['aligners', 'braces'],
  ['xray', 'x-ray'],
  ['rootcanal', 'root canal'],
]);

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'for',
  'of',
  'with',
  'to',
  'visit',
  'appointment',
  'dental',
  'dentistry',
  'tooth',
  'teeth',
  'routine',
  'general',
  'new',
  'patient',
  'patients',
  'adult',
  'child',
  'deep',
]);

export const PUBLIC_ACTIVITY_SQL = {
  leads: `
  SELECT l.requested_service AS service, l.created_at AS occurred_at
  FROM leads l FORCE INDEX (idx_leads_created)
  INNER JOIN organizations o ON o.id = l.organization_id
  WHERE l.created_at >= ?
    AND l.created_at <= ?
    AND o.name NOT LIKE 'ZZ TEST%'
  ORDER BY l.created_at DESC
  LIMIT ?
`,
  appointments: `
  SELECT a.service AS service, a.created_at AS occurred_at
  FROM appointments a FORCE INDEX (idx_appointments_created)
  INNER JOIN organizations o ON o.id = a.organization_id
  WHERE a.created_at >= ?
    AND a.created_at <= ?
    AND o.name NOT LIKE 'ZZ TEST%'
  ORDER BY a.created_at DESC
  LIMIT ?
`,
  replies: `
  SELECT m.sent_at AS occurred_at
  FROM communication_messages m FORCE INDEX (idx_comm_messages_outbound_sent)
  INNER JOIN organizations o ON o.id = m.organization_id
  WHERE m.direction = 'OUTBOUND'
    AND m.status IN ('SENT', 'DELIVERED')
    AND m.sent_at >= ?
    AND m.sent_at <= ?
    AND o.name NOT LIKE 'ZZ TEST%'
  ORDER BY m.sent_at DESC
  LIMIT ?
`,
} as const;

export function genericService(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > 80) return null;

  let text = trimmed.toLowerCase();
  text = text.replace(/-/g, ' ');
  text = text.replace(/[^a-z0-9\s]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/\broot canal\b/g, 'rootcanal');
  text = text.replace(/\bx ray\b/g, 'xray');
  text = text.replace(/\bcheck up\b/g, 'checkup');

  const tokens = text.split(' ').filter((token) => token !== '' && !STOP_WORDS.has(token));
  if (tokens.length === 0 || tokens.length > 2) return null;

  const labels: string[] = [];
  for (const token of tokens) {
    if (!/^[a-z]+$/.test(token)) return null;
    const canonical = CANONICAL.get(token);
    if (canonical === undefined) return null;
    if (!labels.includes(canonical)) labels.push(canonical);
  }
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0] ?? null;
  return `${labels[0]} and ${labels[1]}`;
}

export function activityLabel(kind: PublicActivityKind, service: string | null): string {
  if (kind === 'reply') return 'Reply sent';
  if (kind === 'enquiry') {
    return service === null ? 'New enquiry received' : `New enquiry · ${service}`;
  }
  if (service === null) return 'A clinic booked a visit';
  const article = /^(?:[aeiou]|x-)/.test(service) ? 'an' : 'a';
  return `A clinic booked ${article} ${service}`;
}

export function activityMinutesAgo(occurredAtMs: number, nowMs: number): number {
  const delta = Math.max(0, nowMs - occurredAtMs);
  return Math.floor(delta / 60_000);
}

function normalizeKind(kind: string): PublicActivityKind | null {
  if (kind === 'enquiry' || kind === 'reply' || kind === 'booking') return kind;
  return null;
}

function occurredAtMs(value: Date | string | null | undefined): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string' && value !== '') {
    const ms = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function rowsOf(
  kind: PublicActivityKind,
  rows: TimeRow[],
  serviceFromRow: boolean,
): RawActivity[] {
  const events: RawActivity[] = [];
  for (const row of rows) {
    const ms = occurredAtMs(row.occurred_at);
    if (ms === null) continue;
    events.push({
      kind,
      service: serviceFromRow && typeof row.service === 'string' ? row.service : null,
      occurredAt: new Date(ms),
    });
  }
  return events;
}

export async function loadRecentActivity(db: Pool, since: Date, until: Date): Promise<RawActivity[]> {
  const params: [Date, Date, number] = [since, until, PER_SOURCE_LIMIT];
  const [leads] = await db.query<TimeRow[]>(PUBLIC_ACTIVITY_SQL.leads, params);
  const [appointments] = await db.query<TimeRow[]>(PUBLIC_ACTIVITY_SQL.appointments, params);
  const [replies] = await db.query<TimeRow[]>(PUBLIC_ACTIVITY_SQL.replies, params);
  return [
    ...rowsOf('enquiry', leads, true),
    ...rowsOf('booking', appointments, true),
    ...rowsOf('reply', replies, false),
  ];
}

export interface PublicActivityReader {
  read(): Promise<PublicActivityResponse>;
}

export function createPublicActivityReader(options: {
  load: (since: Date, until: Date) => Promise<RawActivity[]>;
  now?: () => number;
  ttlMs?: number;
  limit?: number;
  windowMs?: number;
}): PublicActivityReader {
  const now = options.now ?? ((): number => Date.now());
  const ttlMs = options.ttlMs ?? PUBLIC_ACTIVITY_TTL_MS;
  const limit = options.limit ?? PUBLIC_ACTIVITY_LIMIT;
  const windowMs = options.windowMs ?? PUBLIC_ACTIVITY_WINDOW_MS;
  let cache: { at: number; items: StoredEvent[] } | null = null;
  let pending: Promise<StoredEvent[]> | null = null;

  function toEvents(items: StoredEvent[], at: number): PublicActivityEvent[] {
    return items.map((item) => ({
      kind: item.kind,
      label: activityLabel(item.kind, item.service),
      minutesAgo: activityMinutesAgo(item.occurredAtMs, at),
    }));
  }

  async function loadFresh(at: number): Promise<StoredEvent[]> {
    const rows = await options.load(new Date(at - windowMs), new Date(at + FUTURE_SKEW_MS));
    const items: StoredEvent[] = [];
    for (const row of rows) {
      const kind = normalizeKind(row.kind);
      if (kind === null) continue;
      const atMs = row.occurredAt instanceof Date ? row.occurredAt.getTime() : Number.NaN;
      if (!Number.isFinite(atMs) || atMs > at + FUTURE_SKEW_MS || atMs < at - windowMs) continue;
      items.push({
        kind,
        service: kind === 'reply' ? null : genericService(row.service),
        occurredAtMs: atMs,
      });
    }
    items.sort((a, b) => b.occurredAtMs - a.occurredAtMs || a.kind.localeCompare(b.kind));
    return items.slice(0, limit);
  }

  return {
    async read(): Promise<PublicActivityResponse> {
      const at = now();
      if (cache !== null && at - cache.at < ttlMs) {
        return { events: toEvents(cache.items, at) };
      }
      if (pending === null) {
        const startedAt = at;
        pending = loadFresh(startedAt).finally(() => {
          pending = null;
        });
      }
      const items = await pending;
      cache = { at: now(), items };
      return { events: toEvents(items, now()) };
    },
  };
}

export function createDbPublicActivityReader(
  db: Pool,
  options: { now?: () => number; ttlMs?: number } = {},
): PublicActivityReader {
  return createPublicActivityReader({
    load: (since, until) => loadRecentActivity(db, since, until),
    now: options.now,
    ttlMs: options.ttlMs,
  });
}
