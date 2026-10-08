import { BUSINESS_HOUR_DAYS } from '../validate';
import type { BusinessHours, BusinessHourDay } from '../validate';

export const MIN_LEAD_MINUTES = 30;

const DAY_INDEX: Record<BusinessHourDay, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export function dayKeyForDate(date: string): BusinessHourDay {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const key = BUSINESS_HOUR_DAYS.find((candidate) => DAY_INDEX[candidate] === weekday);
  return key ?? 'mon';
}

export function toMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function fromMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function enumerateSlots(
  window: { open: string; close: string } | null,
  stepMinutes: number,
): string[] {
  if (window === null || stepMinutes <= 0) {
    return [];
  }
  const open = toMinutes(window.open);
  const close = toMinutes(window.close);
  const slots: string[] = [];
  for (let start = open; start + stepMinutes <= close; start += stepMinutes) {
    slots.push(fromMinutes(start));
  }
  return slots;
}

export interface BusyInterval {
  startMinutes: number;
  lengthMinutes: number;
}

export function slotConflicts(
  slotStart: string,
  slotMinutes: number,
  busy: readonly BusyInterval[],
): boolean {
  const start = toMinutes(slotStart);
  const end = start + slotMinutes;
  return busy.some((interval) => {
    const intervalEnd = interval.startMinutes + interval.lengthMinutes;
    return start < intervalEnd && interval.startMinutes < end;
  });
}

export function dateAddDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const base = Date.UTC(year, month - 1, day);
  const shifted = new Date(base + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

export function parseWorkHours(raw: string): BusinessHours | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const out = {} as BusinessHours;
    for (const day of BUSINESS_HOUR_DAYS) {
      const entry = record[day];
      if (entry === null || entry === undefined) {
        out[day] = null;
        continue;
      }
      if (typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const pair = entry as Record<string, unknown>;
      const open = pair.open;
      const close = pair.close;
      if (typeof open !== 'string' || typeof close !== 'string') {
        return null;
      }
      out[day] = { open, close };
    }
    return out;
  } catch {
    return null;
  }
}
