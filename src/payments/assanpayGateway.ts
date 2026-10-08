import { AppError } from '../errors';
import type { PaymentGatewayConfig } from './gatewayConfig';
import type {
  CreatePaymentInput,
  CreatedPayment,
  GatewayConnectionResult,
  PaymentGateway,
  PaymentStatusResult,
  GatewayPaymentStatus,
} from './types';

const REQUEST_TIMEOUT_MS = 15_000;

function normalizedBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function assertConfigured(config: PaymentGatewayConfig): void {
  if (config.baseUrl === '' || config.merchantId === '') {
    throw new AppError(
      'Payment gateway is not configured (API base URL or merchant ID is missing).',
      409,
      'gateway_not_configured',
      true,
    );
  }
}

function networkError(err: unknown): AppError {
  return new AppError(
    `Could not reach the payment gateway: ${err instanceof Error ? err.message : String(err)}`,
    502,
    'gateway_error',
    true,
  );
}

function mapStatus(raw: unknown): { status: GatewayPaymentStatus; providerStatus: string } {
  const providerStatus = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : 'unknown';
  const normalized = providerStatus.toLowerCase();
  if (normalized === 'pending' || normalized === 'open') {
    return { status: 'pending', providerStatus };
  }
  if (['paid', 'success', 'successful', 'succeeded', 'completed', 'complete'].includes(normalized)) {
    return { status: 'paid', providerStatus };
  }
  if (['failed', 'failure', 'error'].includes(normalized)) {
    return { status: 'failed', providerStatus };
  }
  if (['cancel', 'cancelled', 'canceled'].includes(normalized)) {
    return { status: 'cancelled', providerStatus };
  }
  if (['expire', 'expired'].includes(normalized)) {
    return { status: 'expired', providerStatus };
  }
  return { status: 'unknown', providerStatus };
}

interface AssanPayResponse {
  status?: unknown;
  message?: unknown;
  data?: {
    id?: unknown;
    transactionId?: unknown;
    completeLink?: unknown;
    orderId?: unknown;
    transactionStaus?: unknown;
    transactionStatus?: unknown;
  };
}

export class AssanPayGateway implements PaymentGateway {
  readonly key = 'assanpay';

  private readonly config: PaymentGatewayConfig;

  constructor(config: PaymentGatewayConfig) {
    this.config = config;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    assertConfigured(this.config);
    const url = `${normalizedBase(this.config.baseUrl)}/payment-request/${encodeURIComponent(
      this.config.merchantId,
    )}`;
    const body: Record<string, string> = {
      amount: (input.amountUsdCents / 100).toFixed(2),
      order_id: input.orderId,
      store_name: input.storeName,
    };
    if (input.returnUrl !== null) {
      body.link = input.returnUrl;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw networkError(err);
    }

    const payload = (await response.json().catch(() => null)) as AssanPayResponse | null;
    if (!response.ok || payload === null) {
      const detail =
        typeof payload?.message === 'string' && payload.message.trim() !== ''
          ? payload.message
          : `HTTP ${response.status}`;
      throw new AppError(
        `Payment gateway rejected the payment request: ${detail.slice(0, 200)}`,
        502,
        'gateway_error',
        true,
      );
    }

    const completeLink = payload.data?.completeLink;
    if (typeof completeLink !== 'string' || completeLink === '') {
      const detail = typeof payload.message === 'string' ? payload.message : 'missing payment link';
      throw new AppError(
        `Payment gateway returned no payment link: ${String(detail).slice(0, 200)}`,
        502,
        'gateway_error',
        true,
      );
    }

    const transactionId = payload.data?.transactionId;
    return {
      providerTransactionId: typeof transactionId === 'string' ? transactionId : null,
      checkoutUrl: completeLink,
    };
  }

  async queryStatus(orderId: string): Promise<PaymentStatusResult> {
    assertConfigured(this.config);
    const url = `${normalizedBase(
      this.config.baseUrl,
    )}/payment/all-inquiry/${encodeURIComponent(this.config.merchantId)}?transactionId=${encodeURIComponent(
      orderId,
    )}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw networkError(err);
    }

    if (response.status === 404) {
      return { status: 'unknown', providerStatus: 'Not found' };
    }

    const payload = (await response.json().catch(() => null)) as AssanPayResponse | null;
    if (!response.ok || payload === null) {
      const detail =
        typeof payload?.message === 'string' && payload.message.trim() !== ''
          ? payload.message
          : `HTTP ${response.status}`;
      throw new AppError(
        `Payment gateway status query failed: ${detail.slice(0, 200)}`,
        502,
        'gateway_error',
        true,
      );
    }

    const raw = payload.data?.transactionStaus ?? payload.data?.transactionStatus;
    return mapStatus(raw);
  }

  async testConnection(): Promise<GatewayConnectionResult> {
    try {
      const result = await this.queryStatus(`ping${Date.now().toString(36)}`);
      return { ok: true, detail: `Gateway reachable (probe status: ${result.providerStatus})` };
    } catch (err) {
      if (err instanceof AppError) {
        return { ok: false, detail: err.message };
      }
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
