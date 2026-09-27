import type { CommunicationProvider, OutboundMessage, ProviderSendResult } from './types';
import { ProviderSendError } from './types';

export interface MockProviderOptions {
  failOn?: string[];
}

export const MOCK_FAIL_RECIPIENT = '999999999';

export class MockProvider implements CommunicationProvider {
  readonly key = 'mock';
  readonly attempts: OutboundMessage[] = [];
  private readonly failOn: Set<string>;
  private counter = 0;

  constructor(options: MockProviderOptions = {}) {
    this.failOn = new Set(options.failOn ?? [MOCK_FAIL_RECIPIENT]);
  }

  async send(message: OutboundMessage): Promise<ProviderSendResult> {
    this.attempts.push(message);
    if (this.failOn.has(message.to)) {
      throw new ProviderSendError(
        'mock_recipient_failure',
        `mock provider rejected recipient ${message.to}`,
      );
    }
    this.counter += 1;
    return { providerMessageId: `mock-${message.messageId}-${this.counter}` };
  }
}
