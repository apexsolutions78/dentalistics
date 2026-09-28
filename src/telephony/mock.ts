import { ValidationError } from '../errors';
import type { CallOutcome, InboundCallEvent, SignatureInput, TelephonyAdapter } from './types';
import { verifySignature } from './signature';

const MOCK_STATUS_MAP: Record<string, CallOutcome> = {
  answered: 'ANSWERED',
  missed: 'MISSED',
  rejected: 'REJECTED',
  busy: 'BUSY',
  failed: 'FAILED',
  canceled: 'CANCELED',
  ringing: 'IN_PROGRESS',
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

export class MockTelephonyAdapter implements TelephonyAdapter {
  readonly key = 'mock';
  readonly signatureHeader = 'x-mock-signature';

  verifySignature(input: SignatureInput, secret: string, headerValue: string | undefined): boolean {
    return verifySignature(secret, input.fullUrl, input.params, headerValue);
  }

  parse(body: unknown): InboundCallEvent {
    const params = asFlatParams(body);
    const eventId = params.eventId ?? params.CallSid;
    if (eventId === undefined || eventId === '') {
      throw new ValidationError('Invalid input', ['eventId is required']);
    }
    const status = params.status;
    if (status === undefined || status === '') {
      throw new ValidationError('Invalid input', ['status is required']);
    }
    const outcome = MOCK_STATUS_MAP[status];
    if (outcome === undefined) {
      throw new ValidationError('Invalid input', [`unsupported status: ${status.slice(0, 32)}`]);
    }
    const from = params.from;
    const to = params.to;
    if (from === undefined || from === '' || to === undefined || to === '') {
      throw new ValidationError('Invalid input', ['from and to are required']);
    }
    let occurredAt = new Date();
    const raw = params.occurredAt;
    if (raw !== undefined && raw !== '') {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        occurredAt = parsed;
      }
    }
    return { eventId, providerStatus: status, outcome, from, to, occurredAt };
  }
}
