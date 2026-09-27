import { describe, expect, it } from 'vitest';
import { MockProvider, MOCK_FAIL_RECIPIENT } from '../src/communications/mockProvider';
import { getProvider, registerProvider } from '../src/communications/registry';
import type { CommunicationProvider, OutboundMessage } from '../src/communications/types';
import { ProviderSendError } from '../src/communications/types';

function outbound(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    messageId: 1,
    organizationId: 1,
    channel: 'SMS',
    to: '97311112222',
    body: 'Hello',
    ...overrides,
  };
}

describe('MockProvider', () => {
  it('sends successfully and records the attempt', async () => {
    const provider = new MockProvider();
    const result = await provider.send(outbound());
    expect(provider.key).toBe('mock');
    expect(provider.attempts).toHaveLength(1);
    expect(provider.attempts[0]).toMatchObject({ messageId: 1, to: '97311112222' });
    expect(result.providerMessageId).toMatch(/^mock-1-\d+$/);
  });

  it('throws a coded ProviderSendError for configured recipients', async () => {
    const provider = new MockProvider();
    await expect(provider.send(outbound({ to: MOCK_FAIL_RECIPIENT }))).rejects.toMatchObject({
      name: 'ProviderSendError',
      code: 'mock_recipient_failure',
    });
    expect(provider.attempts).toHaveLength(1);
  });

  it('honors a custom failOn list', async () => {
    const provider = new MockProvider({ failOn: ['555000111'] });
    await expect(provider.send(outbound({ to: '555000111' }))).rejects.toBeInstanceOf(
      ProviderSendError,
    );
    const ok = await provider.send(outbound({ to: MOCK_FAIL_RECIPIENT }));
    expect(ok.providerMessageId).toMatch(/^mock-/);
  });

  it('caps recorded attempt history so long-running processes cannot grow it unbounded', async () => {
    const provider = new MockProvider();
    for (let i = 1; i <= 1005; i++) {
      await provider.send(outbound({ messageId: i }));
    }
    expect(provider.attempts).toHaveLength(1000);
    expect(provider.attempts[provider.attempts.length - 1]).toMatchObject({ messageId: 1005 });
    expect(provider.attempts[0]).toMatchObject({ messageId: 6 });
  });
});

describe('provider registry', () => {
  it('registers and resolves providers by key', async () => {
    const stub: CommunicationProvider = {
      key: 'stub-test',
      send: async () => ({ providerMessageId: 'stub-1' }),
    };
    registerProvider(stub);
    expect(getProvider('stub-test')).toBe(stub);
  });

  it('has the mock provider registered by default', () => {
    expect(getProvider('mock')).toBeInstanceOf(MockProvider);
  });

  it('throws for unknown provider keys', () => {
    expect(() => getProvider('does-not-exist')).toThrow('Unknown communication provider');
  });
});
