import { describe, expect, it } from 'vitest';
import { formatActivityAge, parsePublicActivity } from './publicActivity';

describe('public activity parsing', () => {
  it('formats relative ages without a clock time', () => {
    expect(formatActivityAge(0)).toBe('just now');
    expect(formatActivityAge(1)).toBe('1 min ago');
    expect(formatActivityAge(12)).toBe('12 min ago');
    expect(formatActivityAge(60)).toBe('1 hr ago');
    expect(formatActivityAge(180)).toBe('3 hr ago');
    expect(formatActivityAge(1440)).toBe('1 day ago');
  });

  it('keeps allowlisted events and drops names, contacts, and exact times', () => {
    const events = parsePublicActivity({
      events: [
        {
          kind: 'booking',
          label: 'A clinic booked a cleaning',
          minutesAgo: 4,
          phone: '+97339990011',
          email: 'priya.shah@example.com',
          clinicName: 'Smile Studio',
        },
        { kind: 'enquiry', label: 'New enquiry · Priya Shah', minutesAgo: 2 },
        { kind: 'booking', label: 'Booked · Thu 10:30', minutesAgo: 1 },
        { kind: 'enquiry', label: 'New enquiry · root canal', minutesAgo: 8 },
        { kind: 'booking', label: 'A clinic booked an x-ray', minutesAgo: 9 },
        { kind: 'enquiry', label: 'New enquiry received', minutesAgo: 12 },
        { kind: 'reply', label: 'Reply sent', minutesAgo: 0 },
        { kind: 'booking', label: 'A clinic booked a visit', minutesAgo: 3, occurredAt: '2099-06-01T12:00:00.000Z' },
        { kind: 'enquiry', label: 'New enquiry · cleaning', minutesAgo: -1 },
        { kind: 'mystery', label: 'Reply sent', minutesAgo: 1 },
      ],
    });
    expect(events).toEqual([
      { kind: 'booking', label: 'A clinic booked a cleaning', minutesAgo: 4 },
      { kind: 'enquiry', label: 'New enquiry · root canal', minutesAgo: 8 },
      { kind: 'booking', label: 'A clinic booked an x-ray', minutesAgo: 9 },
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('Priya');
    expect(serialized).not.toContain('priya.shah');
    expect(serialized).not.toContain('Smile Studio');
    expect(serialized).not.toContain('+973');
    expect(serialized).not.toContain('2099');
    expect(serialized).not.toContain('10:30');
  });

  it('returns nothing for an empty or broken payload', () => {
    expect(parsePublicActivity({ events: [] })).toEqual([]);
    expect(parsePublicActivity(null)).toEqual([]);
    expect(parsePublicActivity({ events: 'nope' })).toEqual([]);
  });
});
