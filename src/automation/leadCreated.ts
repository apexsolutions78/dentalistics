import type { Logger } from '../logger';

export interface LeadCreatedEvent {
  organizationId: number;
  leadId: number;
  source: string;
}

export function triggerLeadCreated(logger: Logger, event: LeadCreatedEvent): void {
  logger.info('automation trigger: lead_created', {
    organizationId: event.organizationId,
    leadId: event.leadId,
    source: event.source,
  });
}
