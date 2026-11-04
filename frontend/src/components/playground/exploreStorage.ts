const EXPLORE_KEY = 'dentalistics.explore.v1';
const WELCOME_KEY = 'dentalistics.welcome.v1';

export function readExplored(storage: Storage = localStorage): string[] {
  try {
    const raw = storage.getItem(EXPLORE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function recordExplored(id: string, storage: Storage = localStorage): string[] {
  const next = readExplored(storage);
  if (!next.includes(id)) next.push(id);
  try {
    storage.setItem(EXPLORE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota failures; the in-memory count still updates for this view.
  }
  return next;
}

export function isWelcomeDismissed(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(WELCOME_KEY) === 'dismissed';
  } catch {
    return true;
  }
}

export function dismissWelcome(storage: Storage = localStorage): void {
  try {
    storage.setItem(WELCOME_KEY, 'dismissed');
  } catch {
    // If it cannot be stored, the note can show again next visit. That is safe.
  }
}

export function canAutoplay(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
