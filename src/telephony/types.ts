export type CallOutcome =
  | 'ANSWERED'
  | 'MISSED'
  | 'REJECTED'
  | 'BUSY'
  | 'FAILED'
  | 'CANCELED'
  | 'IN_PROGRESS';

export const RECOVERY_OUTCOMES: readonly CallOutcome[] = ['MISSED', 'REJECTED', 'BUSY'];

export interface InboundCallEvent {
  eventId: string;
  providerStatus: string;
  outcome: CallOutcome;
  from: string;
  to: string;
  occurredAt: Date;
}

export interface SignatureInput {
  fullUrl: string;
  params: Record<string, string>;
}

export interface TelephonyAdapter {
  readonly key: string;
  readonly signatureHeader: string;
  verifySignature(input: SignatureInput, secret: string, headerValue: string | undefined): boolean;
  parse(body: unknown): InboundCallEvent;
}
