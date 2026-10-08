import type { LeadAutomationConfig } from '../automation/leadAutomationConfig';

export type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface UrgencyLeadInput {
  source: string;
  status: string;
  requestedService: string | null;
  lastActivityAt: Date;
}

export interface UrgencyResult {
  level: UrgencyLevel;
  score: number;
  reasons: string[];
}

export const URGENCY_LEVELS: readonly UrgencyLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

const KEYWORD_WEIGHT = 50;
const SOURCE_WEIGHT = 25;
const STALE_WEIGHT = 25;
const MAX_SCORE = 100;

const ACTIVE_FOR_URGENCY = ['NEW', 'CONTACTED', 'QUALIFIED'];

export function computeUrgency(
  lead: UrgencyLeadInput,
  config: LeadAutomationConfig,
  now: Date,
): UrgencyResult {
  const reasons: string[] = [];
  let score = 0;

  const service = (lead.requestedService ?? '').toLowerCase();
  const keywordHit = config.highKeywords.find((keyword) => service.includes(keyword.toLowerCase()));
  if (keywordHit !== undefined) {
    score += KEYWORD_WEIGHT;
    reasons.push(`urgent service requested: "${keywordHit}"`);
  }

  if (config.highSources.includes(lead.source)) {
    score += SOURCE_WEIGHT;
    reasons.push(`lead source: ${lead.source}`);
  }

  let stale = false;
  if (ACTIVE_FOR_URGENCY.includes(lead.status)) {
    const ageHours = (now.getTime() - lead.lastActivityAt.getTime()) / 3_600_000;
    if (ageHours >= config.staleHours) {
      stale = true;
      score += STALE_WEIGHT;
      reasons.push(`no activity for ${Math.floor(ageHours)}h (threshold ${config.staleHours}h)`);
    }
  }

  score = Math.min(MAX_SCORE, score);

  let level: UrgencyLevel;
  if (keywordHit !== undefined || config.highSources.includes(lead.source) || stale) {
    level = 'HIGH';
  } else if (lead.status === 'CONTACTED' || lead.status === 'QUALIFIED') {
    level = 'MEDIUM';
    reasons.push('contacted but not yet booked');
  } else {
    level = 'LOW';
    reasons.push('routine enquiry');
  }

  if (reasons.length === 0) {
    reasons.push(`level ${level}`);
  }

  return { level, score, reasons };
}
