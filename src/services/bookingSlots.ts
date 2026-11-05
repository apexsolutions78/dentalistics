import { ValidationError } from '../errors';
import { clinicLocalDate, utcToLocal, zonedToUtc } from '../automation/time';
import { dateAddDays, fromMinutes, toMinutes } from './slots';

export interface OnlineBookingSettings {
  enabled: boolean;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  autoConfirm: boolean;
}

export const DEFAULT_ONLINE_BOOKING: OnlineBookingSettings = {
  enabled: false,
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 120,
  maxDaysAhead: 60,
  autoConfirm: false,
};

export interface TimeWindow {
  open: string;
  close: string;
}

function requireBool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError('Invalid input', [`${name} must be true or false`]);
  }
  return value;
}

function requireInt(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError('Invalid input', [
      `${name} must be a whole number from ${min} to ${max}`,
    ]);
  }
  return value;
}

export function parseOnlineBookingSettings(body: unknown): OnlineBookingSettings {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  const record = body as Record<string, unknown>;
  return {
    enabled: requireBool(record.enabled, 'enabled'),
    slotMinutes: requireInt(record.slotMinutes, 'slotMinutes', 5, 240),
    bufferMinutes: requireInt(record.bufferMinutes, 'bufferMinutes', 0, 120),
    minNoticeMinutes: requireInt(record.minNoticeMinutes, 'minNoticeMinutes', 0, 10080),
    maxDaysAhead: requireInt(record.maxDaysAhead, 'maxDaysAhead', 1, 365),
    autoConfirm: requireBool(record.autoConfirm, 'autoConfirm'),
  };
}

export function readStoredOnlineBooking(raw: string | null): OnlineBookingSettings {
  if (raw === null || raw.trim() === '') {
    return { ...DEFAULT_ONLINE_BOOKING };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_ONLINE_BOOKING };
    }
    return parseOnlineBookingSettings({ ...DEFAULT_ONLINE_BOOKING, ...parsed });
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ...DEFAULT_ONLINE_BOOKING };
    }
    return { ...DEFAULT_ONLINE_BOOKING };
  }
}

export function hhmm(value: string): string {
  return value.slice(0, 5);
}

/**
 * Clinic hours and doctor hours both apply when the clinic has saved
 * opening hours. A day the clinic marked closed stays closed. When the
 * clinic has never saved hours, the doctor's own hours are the window.
 */
export function intersectWindows(
  clinicDay: TimeWindow | null | undefined,
  doctorDay: TimeWindow | null,
  clinicHoursConfigured: boolean,
): TimeWindow | null {
  if (doctorDay === null) {
    return null;
  }
  const doctor = { open: hhmm(doctorDay.open), close: hhmm(doctorDay.close) };
  if (!clinicHoursConfigured) {
    return doctor;
  }
  if (clinicDay === null || clinicDay === undefined) {
    return null;
  }
  const clinic = { open: hhmm(clinicDay.open), close: hhmm(clinicDay.close) };
  const open = clinic.open > doctor.open ? clinic.open : doctor.open;
  const close = clinic.close < doctor.close ? clinic.close : doctor.close;
  if (toMinutes(open) >= toMinutes(close)) {
    return null;
  }
  return { open, close };
}

export function enumerateBookableStarts(
  window: TimeWindow,
  slotMinutes: number,
  bufferMinutes: number,
): string[] {
  if (slotMinutes <= 0) {
    return [];
  }
  const step = slotMinutes + Math.max(0, bufferMinutes);
  const open = toMinutes(window.open);
  const close = toMinutes(window.close);
  const slots: string[] = [];
  for (let start = open; start + slotMinutes <= close; start += step) {
    slots.push(fromMinutes(start));
  }
  return slots;
}

/**
 * A wall-clock time that does not exist (a spring-forward gap) does not
 * round-trip through UTC. A repeated fall-back hour round-trips once.
 */
export function isRealLocalTime(date: string, time: string, timeZone: string): boolean {
  try {
    const utc = zonedToUtc(date, hhmm(time), timeZone);
    if (Number.isNaN(utc.getTime())) {
      return false;
    }
    const back = utcToLocal(utc, timeZone);
    return back.date === date && back.time === hhmm(time);
  } catch {
    return false;
  }
}

export function bookingDateBounds(
  now: Date,
  timeZone: string,
  maxDaysAhead: number,
): { today: string; lastDate: string } {
  const today = clinicLocalDate(now, timeZone);
  return { today, lastDate: dateAddDays(today, maxDaysAhead) };
}

export function dateInBookingWindow(date: string, today: string, lastDate: string): boolean {
  return date >= today && date <= lastDate;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

export function listDaySlots(input: {
  date: string;
  timeZone: string;
  now: Date;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  window: TimeWindow | null;
  occupiedStartMinutes: readonly number[];
  occupiedMinutes: number;
}): string[] {
  if (input.window === null) {
    return [];
  }
  const earliest = input.now.getTime() + input.minNoticeMinutes * 60_000;
  const buffer = Math.max(0, input.bufferMinutes);
  const occupiedLength = input.occupiedMinutes + buffer;
  const slotLength = input.slotMinutes + buffer;
  return enumerateBookableStarts(input.window, input.slotMinutes, input.bufferMinutes).filter((slot) => {
    if (!isRealLocalTime(input.date, slot, input.timeZone)) {
      return false;
    }
    const instant = zonedToUtc(input.date, slot, input.timeZone);
    if (instant.getTime() < earliest) {
      return false;
    }
    const start = toMinutes(slot);
    const end = start + slotLength;
    return !input.occupiedStartMinutes.some((occupied) =>
      rangesOverlap(start, end, occupied, occupied + occupiedLength),
    );
  });
}

export function publicLogoPath(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  if (!url.startsWith('/') || url.startsWith('//') || url.includes('..') || url.includes('\\')) {
    return null;
  }
  return url;
}
