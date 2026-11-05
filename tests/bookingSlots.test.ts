import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors';
import {
  bookingDateBounds,
  dateInBookingWindow,
  intersectWindows,
  isRealLocalTime,
  listDaySlots,
  parseOnlineBookingSettings,
  readStoredOnlineBooking,
} from '../src/services/bookingSlots';

const OPEN = { open: '09:00', close: '17:00' };

describe('online booking slots', () => {
  it('intersects clinic hours with doctor hours and treats a closed clinic day as closed', () => {
    expect(intersectWindows({ open: '10:00', close: '16:00' }, OPEN, true)).toEqual({
      open: '10:00',
      close: '16:00',
    });
    expect(intersectWindows({ open: '08:00', close: '12:00' }, { open: '11:00', close: '15:00' }, true)).toEqual({
      open: '11:00',
      close: '12:00',
    });
    expect(intersectWindows(null, OPEN, true)).toBeNull();
    expect(intersectWindows(null, OPEN, false)).toEqual({ open: '09:00', close: '17:00' });
    expect(intersectWindows(OPEN, null, true)).toBeNull();
    expect(intersectWindows({ open: '12:00', close: '13:00' }, { open: '09:00', close: '12:00' }, true)).toBeNull();
  });

  it('keeps a buffer after each visit and drops a taken start', () => {
    const slots = listDaySlots({
      date: '2026-07-16',
      timeZone: 'UTC',
      now: new Date('2026-07-01T00:00:00Z'),
      slotMinutes: 30,
      bufferMinutes: 10,
      minNoticeMinutes: 0,
      window: { open: '09:00', close: '12:00' },
      occupiedStartMinutes: [9 * 60],
      occupiedMinutes: 30,
    });
    expect(slots).toEqual(['09:40', '10:20', '11:00']);
  });

  it('applies minimum notice in the clinic timezone, including a summer offset', () => {
    const winter = listDaySlots({
      date: '2026-01-15',
      timeZone: 'America/New_York',
      now: new Date('2026-01-15T14:30:00Z'),
      slotMinutes: 30,
      bufferMinutes: 0,
      minNoticeMinutes: 60,
      window: { open: '09:00', close: '12:00' },
      occupiedStartMinutes: [],
      occupiedMinutes: 30,
    });
    const summer = listDaySlots({
      date: '2026-07-15',
      timeZone: 'America/New_York',
      now: new Date('2026-07-15T13:30:00Z'),
      slotMinutes: 30,
      bufferMinutes: 0,
      minNoticeMinutes: 60,
      window: { open: '09:00', close: '12:00' },
      occupiedStartMinutes: [],
      occupiedMinutes: 30,
    });
    expect(winter).toEqual(['10:30', '11:00', '11:30']);
    expect(summer).toEqual(['10:30', '11:00', '11:30']);
  });

  it('omits the spring-forward gap and lists the repeated fall-back hour once', () => {
    expect(isRealLocalTime('2026-03-08', '02:30', 'America/New_York')).toBe(false);
    expect(isRealLocalTime('2026-03-08', '03:00', 'America/New_York')).toBe(true);
    const spring = listDaySlots({
      date: '2026-03-08',
      timeZone: 'America/New_York',
      now: new Date('2026-03-01T00:00:00Z'),
      slotMinutes: 30,
      bufferMinutes: 0,
      minNoticeMinutes: 0,
      window: { open: '01:00', close: '04:00' },
      occupiedStartMinutes: [],
      occupiedMinutes: 30,
    });
    expect(spring).toEqual(['01:00', '01:30', '03:00', '03:30']);

    const fall = listDaySlots({
      date: '2026-11-01',
      timeZone: 'America/New_York',
      now: new Date('2026-10-01T00:00:00Z'),
      slotMinutes: 30,
      bufferMinutes: 0,
      minNoticeMinutes: 0,
      window: { open: '01:00', close: '03:00' },
      occupiedStartMinutes: [],
      occupiedMinutes: 30,
    });
    expect(fall).toEqual(['01:00', '01:30', '02:00', '02:30']);
    expect(new Set(fall).size).toBe(fall.length);
  });

  it('limits the calendar to the clinic local today plus the saved number of days', () => {
    const now = new Date('2026-11-05T23:30:00Z');
    const auckland = bookingDateBounds(now, 'Pacific/Auckland', 60);
    const newYork = bookingDateBounds(now, 'America/New_York', 60);
    expect(auckland.today).toBe('2026-11-06');
    expect(auckland.lastDate).toBe('2027-01-05');
    expect(newYork.today).toBe('2026-11-05');
    expect(newYork.lastDate).toBe('2027-01-04');
    expect(dateInBookingWindow('2027-01-04', newYork.today, newYork.lastDate)).toBe(true);
    expect(dateInBookingWindow('2027-01-05', newYork.today, newYork.lastDate)).toBe(false);
    expect(dateInBookingWindow('2026-11-04', newYork.today, newYork.lastDate)).toBe(false);
  });

  it('rejects booking settings outside the allowed ranges and falls back when stored JSON is bad', () => {
    expect(parseOnlineBookingSettings({
      enabled: true,
      slotMinutes: 20,
      bufferMinutes: 5,
      minNoticeMinutes: 90,
      maxDaysAhead: 14,
      autoConfirm: true,
    })).toMatchObject({ enabled: true, slotMinutes: 20, autoConfirm: true });
    expect(() => parseOnlineBookingSettings({
      enabled: true,
      slotMinutes: 4,
      bufferMinutes: 0,
      minNoticeMinutes: 120,
      maxDaysAhead: 60,
      autoConfirm: false,
    })).toThrow(ValidationError);
    expect(readStoredOnlineBooking('{')).toMatchObject({ enabled: false, minNoticeMinutes: 120, maxDaysAhead: 60 });
    expect(readStoredOnlineBooking(null)).toMatchObject({ enabled: false });
  });
});
