export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'APPOINTMENT_BOOKED',
  'LOST',
  'CLOSED',
] as const;

export const LEAD_SOURCES = ['WEBSITE', 'MISSED_CALL', 'MANUAL', 'OTHER'] as const;

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;

export const RECALL_STATUSES = ['DUE', 'CONTACTED', 'BOOKED', 'COMPLETED', 'CLOSED'] as const;

export const MESSAGE_STATUSES = [
  'PENDING',
  'SENT',
  'FAILED',
  'DELIVERED',
  'UNDELIVERED',
  'RECEIVED',
] as const;

export const MESSAGE_DIRECTIONS = ['OUTBOUND', 'INBOUND'] as const;

export const MESSAGE_CHANNELS = ['SMS', 'WHATSAPP'] as const;

export const JOB_STATUSES = [
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED',
  'SUPPRESSED',
  'CANCELLED',
] as const;

export const AUTOMATION_KINDS = ['reminder', 'no_show', 'recall', 'review'] as const;

export const APPOINTMENT_TRANSITIONS: Record<string, readonly string[]> = {
  SCHEDULED: ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'],
  CONFIRMED: ['CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
};

export const APPOINTMENT_TRANSITION_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirm',
  CANCELLED: 'Cancel',
  COMPLETED: 'Mark completed',
  NO_SHOW: 'Mark no-show',
  RESCHEDULED: 'Reschedule',
  REBOOKED: 'Rebook',
};

export function options(values: readonly string[]): Array<{ value: string; label: string }> {
  return values.map((value) => ({
    value,
    label: value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
  }));
}
