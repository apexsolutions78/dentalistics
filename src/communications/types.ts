export type MessageChannel = 'SMS' | 'WHATSAPP';

export type MessageStatus =
  | 'PENDING'
  | 'SENT'
  | 'FAILED'
  | 'DELIVERED'
  | 'UNDELIVERED'
  | 'RECEIVED';

export type MessageDirection = 'OUTBOUND' | 'INBOUND';

export interface OutboundMessage {
  messageId: number;
  organizationId: number;
  channel: MessageChannel;
  to: string;
  body: string;
}

export interface ProviderSendResult {
  providerMessageId: string;
}

export class ProviderSendError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProviderSendError';
    this.code = code;
  }
}

export interface CommunicationProvider {
  readonly key: string;
  send(message: OutboundMessage): Promise<ProviderSendResult>;
}
