import { AssanPayGateway } from './assanpayGateway';
import type { PaymentGatewayConfig } from './gatewayConfig';
import { MockPaymentGateway } from './mockGateway';
import type { PaymentGateway } from './types';

export function createPaymentGateway(config: PaymentGatewayConfig): PaymentGateway {
  if (config.provider === 'mock') {
    return new MockPaymentGateway();
  }
  return new AssanPayGateway(config);
}
