import type { Pool, RowDataPacket } from 'mysql2/promise';

export const PAYMENT_GATEWAY_META_KEY = 'payment_gateway_config';

export type PaymentGatewayProvider = 'mock' | 'assanpay';

export const PAYMENT_GATEWAY_PROVIDERS: readonly PaymentGatewayProvider[] = ['mock', 'assanpay'];

export interface PaymentGatewayConfig {
  enabled: boolean;
  provider: PaymentGatewayProvider;
  merchantId: string;
  storeName: string;
  baseUrl: string;
  returnUrlBase: string;
}

export const DEFAULT_PAYMENT_GATEWAY_CONFIG: PaymentGatewayConfig = {
  enabled: false,
  provider: 'assanpay',
  merchantId: '',
  storeName: 'Apex Dentalistics',
  baseUrl: '',
  returnUrlBase: '',
};

export function isPaymentGatewayConfig(value: unknown): value is PaymentGatewayConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const cfg = value as Record<string, unknown>;
  return (
    typeof cfg.enabled === 'boolean' &&
    (cfg.provider === 'mock' || cfg.provider === 'assanpay') &&
    typeof cfg.merchantId === 'string' &&
    typeof cfg.storeName === 'string' &&
    typeof cfg.baseUrl === 'string' &&
    typeof cfg.returnUrlBase === 'string'
  );
}

export async function loadPaymentGatewayConfig(db: Pool): Promise<PaymentGatewayConfig> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [PAYMENT_GATEWAY_META_KEY],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw !== 'string' || raw === '') {
    return { ...DEFAULT_PAYMENT_GATEWAY_CONFIG };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPaymentGatewayConfig(parsed)) {
      return parsed;
    }
  } catch {
    // corrupt row - fall through to defaults
  }
  return { ...DEFAULT_PAYMENT_GATEWAY_CONFIG };
}

export async function savePaymentGatewayConfig(
  db: Pool,
  config: PaymentGatewayConfig,
): Promise<void> {
  await db.query(
    `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
    [PAYMENT_GATEWAY_META_KEY, JSON.stringify(config)],
  );
}

export interface GatewayReadiness {
  configured: boolean;
  reasons: string[];
}

export function gatewayReadiness(config: PaymentGatewayConfig): GatewayReadiness {
  const reasons: string[] = [];
  if (config.provider === 'assanpay') {
    if (config.baseUrl === '') {
      reasons.push('API base URL is not set');
    }
    if (config.merchantId === '') {
      reasons.push('Merchant ID is not set');
    }
    if (config.returnUrlBase === '') {
      reasons.push('Return URL base is not set');
    }
  }
  if (!config.enabled) {
    reasons.push('Gateway is switched off');
  }
  return { configured: reasons.length === 0, reasons };
}
