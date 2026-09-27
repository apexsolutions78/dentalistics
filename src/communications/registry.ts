import type { CommunicationProvider } from './types';
import { MockProvider } from './mockProvider';

const providers = new Map<string, CommunicationProvider>();

export function registerProvider(provider: CommunicationProvider): void {
  providers.set(provider.key, provider);
}

export function getProvider(key: string): CommunicationProvider {
  const provider = providers.get(key);
  if (provider === undefined) {
    throw new Error(`Unknown communication provider: ${key}`);
  }
  return provider;
}

registerProvider(new MockProvider());
