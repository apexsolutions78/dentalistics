import { describe, expect, it } from 'vitest';
import { computeUrgency } from '../src/services/urgency';
import type { UrgencyLeadInput } from '../src/services/urgency';
import {
  DEFAULT_LEAD_AUTOMATION_CONFIG,
  type LeadAutomationConfig,
} from '../src/automation/leadAutomationConfig';

const HOUR_MS = 3_600_000;

const NOW = new Date('2026-10-01T12:00:00.000Z');

function config(overrides: Partial<LeadAutomationConfig> = {}): LeadAutomationConfig {
  return {
    ...DEFAULT_LEAD_AUTOMATION_CONFIG,
    highKeywords: [...DEFAULT_LEAD_AUTOMATION_CONFIG.highKeywords],
    highSources: [...DEFAULT_LEAD_AUTOMATION_CONFIG.highSources],
    slaDays: { ...DEFAULT_LEAD_AUTOMATION_CONFIG.slaDays },
    ...overrides,
  };
}

function lead(overrides: Partial<UrgencyLeadInput> = {}): UrgencyLeadInput {
  return {
    source: 'WEBSITE',
    status: 'NEW',
    requestedService: 'Cleaning',
    lastActivityAt: new Date(NOW.getTime() - 1 * HOUR_MS),
    ...overrides,
  };
}

describe('computeUrgency', () => {
  it('scores a fresh routine enquiry as LOW', () => {
    const result = computeUrgency(lead(), config(), NOW);
    expect(result.level).toBe('LOW');
    expect(result.score).toBe(0);
    expect(result.reasons).toContain('routine enquiry');
  });

  it('flags urgent service keywords as HIGH', () => {
    const result = computeUrgency(lead({ requestedService: 'Broken tooth' }), config(), NOW);
    expect(result.level).toBe('HIGH');
    expect(result.score).toBe(50);
    expect(result.reasons.some((reason) => reason.includes('urgent service requested'))).toBe(true);
  });

  it('matches keywords case-insensitively', () => {
    const result = computeUrgency(lead({ requestedService: 'EMERGENCY visit' }), config(), NOW);
    expect(result.level).toBe('HIGH');
  });

  it('flags high-urgency sources as HIGH', () => {
    const result = computeUrgency(lead({ source: 'MISSED_CALL' }), config(), NOW);
    expect(result.level).toBe('HIGH');
    expect(result.score).toBe(25);
    expect(result.reasons).toContain('lead source: MISSED_CALL');
  });

  it('flags untouched active leads past the stale threshold as HIGH', () => {
    const result = computeUrgency(
      lead({ lastActivityAt: new Date(NOW.getTime() - 25 * HOUR_MS) }),
      config(),
      NOW,
    );
    expect(result.level).toBe('HIGH');
    expect(result.score).toBe(25);
    expect(result.reasons.some((reason) => reason.startsWith('no activity for'))).toBe(true);
  });

  it('respects a custom stale threshold', () => {
    const result = computeUrgency(
      lead({ lastActivityAt: new Date(NOW.getTime() - 5 * HOUR_MS) }),
      config({ staleHours: 4 }),
      NOW,
    );
    expect(result.level).toBe('HIGH');
  });

  it('treats contacted but unbooked leads as MEDIUM', () => {
    const result = computeUrgency(lead({ status: 'CONTACTED' }), config(), NOW);
    expect(result.level).toBe('MEDIUM');
    expect(result.reasons).toContain('contacted but not yet booked');
  });

  it('treats qualified but unbooked leads as MEDIUM', () => {
    const result = computeUrgency(lead({ status: 'QUALIFIED' }), config(), NOW);
    expect(result.level).toBe('MEDIUM');
  });

  it('caps the score at 100 when every trigger fires', () => {
    const result = computeUrgency(
      lead({
        source: 'MISSED_CALL',
        requestedService: 'Pain and bleeding',
        lastActivityAt: new Date(NOW.getTime() - 48 * HOUR_MS),
      }),
      config(),
      NOW,
    );
    expect(result.score).toBe(100);
    expect(result.level).toBe('HIGH');
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('does not apply staleness to closed leads', () => {
    const result = computeUrgency(
      lead({ status: 'CLOSED', lastActivityAt: new Date(NOW.getTime() - 100 * HOUR_MS) }),
      config(),
      NOW,
    );
    expect(result.level).toBe('LOW');
    expect(result.reasons.some((reason) => reason.startsWith('no activity for'))).toBe(false);
  });

  it('keeps booked leads out of the stale HIGH path', () => {
    const result = computeUrgency(
      lead({ status: 'APPOINTMENT_BOOKED', lastActivityAt: new Date(NOW.getTime() - 50 * HOUR_MS) }),
      config(),
      NOW,
    );
    expect(result.level).toBe('LOW');
  });
});
