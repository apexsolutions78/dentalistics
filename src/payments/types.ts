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

/**
 * Online checkout. AssanPay implements this. A future card gateway implements
 * the same three methods and is chosen by payment_gateway_config.provider.
 * Manual bank transfer is reviewed by the super admin and is not a gateway.
 */
export interface PaymentGateway {
  readonly key: string;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  queryStatus(orderId: string): Promise<PaymentStatusResult>;
  testConnection(): Promise<GatewayConnectionResult>;
}
