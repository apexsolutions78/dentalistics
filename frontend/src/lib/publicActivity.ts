export const PUBLIC_ACTIVITY_POLL_MS = 45_000;

const SERVICES = new Set([
  'cleaning',
  'checkup',
  'whitening',
  'filling',
  'extraction',
  'crown',
  'root canal',
  'implant',
  'consultation',
  'emergency',
  'x-ray',
  'veneer',
  'dentures',
  'braces',
]);

export type PublicActivityKind = 'enquiry' | 'reply' | 'booking';

export interface PublicActivityEvent {
  kind: PublicActivityKind;
  label: string;
  minutesAgo: number;
}

export function formatActivityAge(minutesAgo: number): string {
  if (!Number.isFinite(minutesAgo) || minutesAgo <= 0) return 'just now';
  if (minutesAgo === 1) return '1 min ago';
  if (minutesAgo < 60) return `${minutesAgo} min ago`;
  const hours = Math.floor(minutesAgo / 60);
  if (hours === 1) return '1 hr ago';
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function isServicePhrase(value: string): boolean {
  const parts = value.split(' and ');
  return parts.length > 0 && parts.length <= 2 && parts.every((part) => SERVICES.has(part));
}

function labelMatches(kind: PublicActivityKind, label: string): boolean {
  if (kind === 'reply') return label === 'Reply sent';
  if (kind === 'enquiry') {
    if (label === 'New enquiry received') return true;
    const prefix = 'New enquiry · ';
    return label.startsWith(prefix) && isServicePhrase(label.slice(prefix.length));
  }
  if (label === 'A clinic booked a visit') return true;
  const indefinite = label.startsWith('A clinic booked an ')
    ? label.slice('A clinic booked an '.length)
    : label.startsWith('A clinic booked a ')
      ? label.slice('A clinic booked a '.length)
      : null;
  return indefinite !== null && isServicePhrase(indefinite);
}

export function parsePublicActivity(payload: unknown): PublicActivityEvent[] {
  if (payload === null || typeof payload !== 'object') return [];
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  const parsed: PublicActivityEvent[] = [];
  for (const item of events) {
    if (parsed.length >= 3) break;
    if (item === null || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const kind = record.kind;
    const label = record.label;
    const minutesAgo = record.minutesAgo;
    if (kind !== 'enquiry' && kind !== 'reply' && kind !== 'booking') continue;
    if (typeof label !== 'string' || typeof minutesAgo !== 'number' || !Number.isInteger(minutesAgo)) {
      continue;
    }
    if (minutesAgo < 0 || minutesAgo > 24 * 60) continue;
    if (!labelMatches(kind, label)) continue;
    parsed.push({ kind, label, minutesAgo });
  }
  return parsed;
}

export function activityLine(event: PublicActivityEvent): string {
  return `${event.label} · ${formatActivityAge(event.minutesAgo)}`;
}
