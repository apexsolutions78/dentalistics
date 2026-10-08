export interface CreatePaymentInput {
  orderId: string;
  amountUsdCents: number;
  storeName: string;
  returnUrl: string | null;
}

export interface CreatedPayment {
  providerTransactionId: string | null;
  checkoutUrl: string;
}

export type GatewayPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'unknown';

export interface PaymentStatusResult {
  status: GatewayPaymentStatus;
  providerStatus: string;
}

export interface GatewayConnectionResult {
  ok: boolean;
  detail: string;
}

export interface PaymentGateway {
  readonly key: string;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  queryStatus(orderId: string): Promise<PaymentStatusResult>;
  testConnection(): Promise<GatewayConnectionResult>;
}
