import type { TelephonyAdapter } from './types';
import { MockTelephonyAdapter } from './mock';
import { TwilioTelephonyAdapter } from './twilio';

const adapters = new Map<string, TelephonyAdapter>();

export function registerTelephonyAdapter(adapter: TelephonyAdapter): void {
  adapters.set(adapter.key, adapter);
}

export function getTelephonyAdapter(key: string): TelephonyAdapter | null {
  return adapters.get(key) ?? null;
}

registerTelephonyAdapter(new TwilioTelephonyAdapter());
registerTelephonyAdapter(new MockTelephonyAdapter());
