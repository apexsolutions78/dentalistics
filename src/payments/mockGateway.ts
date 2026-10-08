import type {
  CreatePaymentInput,
  CreatedPayment,
  GatewayConnectionResult,
  PaymentGateway,
  PaymentStatusResult,
} from './types';

export class MockPaymentGateway implements PaymentGateway {
  readonly key = 'mock';

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    return {
      providerTransactionId: `mock-${input.orderId}`,
      checkoutUrl: `/billing/mock/${input.orderId}`,
    };
  }

  async queryStatus(): Promise<PaymentStatusResult> {
    return { status: 'pending', providerStatus: 'Pending' };
  }

  async testConnection(): Promise<GatewayConnectionResult> {
    return { ok: true, detail: 'Mock gateway is always reachable' };
  }
}
