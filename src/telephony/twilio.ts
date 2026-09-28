import { ValidationError } from '../errors';
import type { CallOutcome, InboundCallEvent, SignatureInput, TelephonyAdapter } from './types';
import { verifySignature } from './signature';

const TWILIO_STATUS_MAP: Record<string, CallOutcome> = {
  completed: 'ANSWERED',
  'no-answer': 'MISSED',
  busy: 'BUSY',
  failed: 'FAILED',
  canceled: 'CANCELED',
  queued: 'IN_PROGRESS',
  ringing: 'IN_PROGRESS',
  'in-progress': 'IN_PROGRESS',
};

function asFlatParams(body: unknown): Record<string, string> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Invalid input', ['webhook body must be a form or JSON object']);
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === 'string') {
      params[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      params[key] = String(value);
    } else {
      throw new ValidationError('Invalid input', [`${key} must be a scalar value`]);
    }
  }
  return params;
}

export class TwilioTelephonyAdapter implements TelephonyAdapter {
  readonly key = 'twilio';
  readonly signatureHeader = 'x-twilio-signature';

  verifySignature(input: SignatureInput, secret: string, headerValue: string | undefined): boolean {
    return verifySignature(secret, input.fullUrl, input.params, headerValue);
  }

  parse(body: unknown): InboundCallEvent {
    const params = asFlatParams(body);
    const eventId = params.CallSid;
    if (eventId === undefined || eventId === '') {
      throw new ValidationError('Invalid input', ['CallSid is required']);
    }
    const status = params.CallStatus;
    if (status === undefined || status === '') {
      throw new ValidationError('Invalid input', ['CallStatus is required']);
    }
    const outcome = TWILIO_STATUS_MAP[status];
    if (outcome === undefined) {
      throw new ValidationError('Invalid input', [`unsupported CallStatus: ${status.slice(0, 32)}`]);
    }
    const from = params.From;
    const to = params.To;
    if (from === undefined || from === '' || to === undefined || to === '') {
      throw new ValidationError('Invalid input', ['From and To are required']);
    }
    let occurredAt = new Date();
    const rawTimestamp = params.Timestamp;
    if (rawTimestamp !== undefined && rawTimestamp !== '') {
      const epoch = Number(rawTimestamp);
      if (Number.isFinite(epoch) && epoch > 0) {
        occurredAt = new Date(epoch * 1000);
      }
    }
    return { eventId, providerStatus: status, outcome, from, to, occurredAt };
  }
}
