export function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const match = /^(\d{2}:\d{2})/.exec(String(value));
  return match !== null && match[1] !== undefined ? match[1] : String(value);
}

export function formatRate(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 1000) / 10}%`;
}

export function fullName(first: string, last: string): string {
  return `${first} ${last}`.trim();
}

export function dayKey(value: string): string {
  return String(value).slice(0, 10);
}

export function formatDay(key: string): string {
  const parsed = new Date(`${key}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((parsed.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === 1) return 'Tomorrow';
  return parsed.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}
