import { AssanPayGateway } from './assanpayGateway';
import type { PaymentGatewayConfig } from './gatewayConfig';
import { MockPaymentGateway } from './mockGateway';
import type { PaymentGateway } from './types';

export function createPaymentGateway(config: PaymentGatewayConfig): PaymentGateway {
  if (config.provider === 'mock') {
    return new MockPaymentGateway();
  }
  // AssanPay stays on this branch. Add a card gateway by implementing
  // PaymentGateway and selecting it from payment_gateway_config.provider.
  // The enabled flag on that config is what turns the online path on or off.
  return new AssanPayGateway(config);
}
