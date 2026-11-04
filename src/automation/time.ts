function tzPartsIn(instant: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') {
      out[part.type] = Number(part.value);
    }
  }
  return {
    year: out.year as number,
    month: out.month as number,
    day: out.day as number,
    hour: out.hour === 24 ? 0 : (out.hour as number),
    minute: out.minute as number,
    second: out.second as number,
  };
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = tzPartsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = time.split(':').map((v) => Number(v));
  const naive = Date.UTC(y, m - 1, d, hh, mm, ss, 0);
  let guess = naive;
  for (let i = 0; i < 2; i += 1) {
    guess = naive - tzOffsetMs(new Date(guess), timeZone);
  }
  return new Date(guess);
}

export function clinicLocalTime(instant: Date, timeZone: string): string {
  const p = tzPartsIn(instant, timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function utcToLocal(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const p = tzPartsIn(instant, timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

export function clinicLocalDate(instant: Date, timeZone: string): string {
  const p = tzPartsIn(instant, timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function isWithinQuietHours(
  localTime: string,
  start: string,
  end: string,
): boolean {
  const t = localTime.slice(0, 5);
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  if (s === e) {
    return false;
  }
  if (s < e) {
    return t >= s && t < e;
  }
  return t >= s || t < e;
}

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

export interface QuietHoursDeferral {
  utcInstant: Date;
  stale: boolean;
}

function nextLocalDate(date: string): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/**
 * First moment (UTC) at which local time is outside the quiet-hours
 * window, or null when the window never closes (start === end).
 *
 * A deferral is marked stale when the appointment starts at or before
 * that moment - sending then would claim the appointment is still
 * upcoming when it has already begun - so the caller suppresses
 * instead of sending a nonsensical late message.
 */
export function quietHoursEndInstant(
  instant: Date,
  timeZone: string,
  start: string,
  end: string,
  appointmentInstant?: Date,
): QuietHoursDeferral | null {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) {
    return null;
  }
  const local = utcToLocal(instant, timeZone);
  const t = toMinutes(local.time);
  const isQuiet = s < e ? t >= s && t < e : t >= s || t < e;
  if (!isQuiet) {
    return { utcInstant: instant, stale: false };
  }
  const todayEnd = zonedToUtc(local.date, end, timeZone);
  const utcInstant =
    todayEnd.getTime() > instant.getTime()
      ? todayEnd
      : zonedToUtc(nextLocalDate(local.date), end, timeZone);
  const stale =
    appointmentInstant !== undefined &&
    appointmentInstant.getTime() <= utcInstant.getTime();
  return { utcInstant, stale };
}
