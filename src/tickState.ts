export interface TickRecord {
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

export type TickName = 'reminder' | 'no_show' | 'recall' | 'review_request';

const ticks = new Map<TickName, TickRecord>();
let intervalMs: number | null = null;

function emptyRecord(): TickRecord {
  return {
    lastStartedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
  };
}

export function recordTickInterval(configuredMs: number | null): void {
  intervalMs = configuredMs;
}

export function recordTickStarted(name: TickName): void {
  const record = ticks.get(name) ?? emptyRecord();
  record.lastStartedAt = new Date().toISOString();
  ticks.set(name, record);
}

export function recordTickSucceeded(name: TickName): void {
  const record = ticks.get(name) ?? emptyRecord();
  record.lastSuccessAt = new Date().toISOString();
  ticks.set(name, record);
}

export function recordTickFailed(name: TickName, error: unknown): void {
  const record = ticks.get(name) ?? emptyRecord();
  record.lastErrorAt = new Date().toISOString();
  record.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  ticks.set(name, record);
}

export function tickSnapshot(): Record<TickName, TickRecord> {
  const snapshot = {} as Record<TickName, TickRecord>;
  for (const name of ['reminder', 'no_show', 'recall', 'review_request'] as TickName[]) {
    const record = ticks.get(name) ?? emptyRecord();
    snapshot[name] = { ...record };
  }
  return snapshot;
}

export function tickIntervalMs(): number | null {
  return intervalMs;
}
