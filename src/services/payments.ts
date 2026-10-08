import crypto from 'node:crypto';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { AppError } from '../errors';
import type { Logger } from '../logger';
import type { PaymentGatewayConfig } from '../payments/gatewayConfig';
import type { PaymentGateway } from '../payments/types';
import { PLANS } from '../plans';

const FULL_PLAN = PLANS.find((plan) => plan.id === 'full');

if (FULL_PLAN === undefined) {
  throw new Error('Full plan definition is missing from PLANS');
}

export const BILLING_PRICE = {
  amountUsdCents: FULL_PLAN.priceUsdCents,
  currency: 'USD' as const,
  interval: 'month' as const,
  name: FULL_PLAN.name,
};

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';

interface PaymentRow extends RowDataPacket {
  id: number;
  organization_id: number;
  plan: 'trial' | 'full';
  amount_usd_cents: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  provider: string;
  order_id: string;
  provider_transaction_id: string | null;
  checkout_url: string | null;
  last_error: string | null;
  paid_at: Date | null;
  created_at: Date;
}

interface OrganizationRow extends RowDataPacket {
  id: number;
  name: string;
  plan: 'trial' | 'full';
  trial_ends_at: Date | null;
}

function generateOrderId(): string {
  return `D${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

function lowerStatus(status: PaymentRow['status']): PaymentStatus {
  return status.toLowerCase() as PaymentStatus;
}

function paymentDto(row: PaymentRow): Record<string, unknown> {
  return {
    orderId: row.order_id,
    status: lowerStatus(row.status),
    amountUsdCents: row.amount_usd_cents,
    currency: row.currency,
    provider: row.provider,
    checkoutUrl: row.checkout_url,
    lastError: row.last_error,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

async function loadOrganization(db: Pool, organizationId: number): Promise<OrganizationRow> {
  const [rows] = await db.query<OrganizationRow[]>(
    'SELECT id, name, plan, trial_ends_at FROM organizations WHERE id = ?',
    [organizationId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Organization not found', 404, 'not_found', true);
  }
  return row;
}

function buildReturnUrl(config: PaymentGatewayConfig, orderId: string): string | null {
  const base = config.returnUrlBase.replace(/\/+$/, '');
  if (base === '') {
    return null;
  }
  return `${base}/settings/billing?orderId=${encodeURIComponent(orderId)}`;
}

export interface BillingSummary {
  organization: { id: number; name: string; plan: 'trial' | 'full'; trialEndsAt: Date | null };
  price: typeof BILLING_PRICE;
  gateway: { enabled: boolean; provider: string; configured: boolean; reasons: string[] };
  payments: Array<Record<string, unknown>>;
}

export async function getBillingSummary(
  db: Pool,
  organizationId: number,
  config: PaymentGatewayConfig,
  readiness: { configured: boolean; reasons: string[] },
): Promise<BillingSummary> {
  const org = await loadOrganization(db, organizationId);
  const [payments] = await db.query<PaymentRow[]>(
    'SELECT * FROM payments WHERE organization_id = ? ORDER BY id DESC LIMIT 10',
    [organizationId],
  );
  return {
    organization: {
      id: org.id,
      name: org.name,
      plan: org.plan,
      trialEndsAt: org.trial_ends_at,
    },
    price: BILLING_PRICE,
    gateway: {
      enabled: config.enabled,
      provider: config.provider,
      configured: readiness.configured,
      reasons: readiness.reasons,
    },
    payments: payments.map(paymentDto),
  };
}

export interface CheckoutResult {
  orderId: string;
  checkoutUrl: string;
  amountUsdCents: number;
  currency: string;
  provider: string;
  status: PaymentStatus;
}

export async function createCheckout(
  db: Pool,
  logger: Logger,
  input: {
    organizationId: number;
    actorId: number;
    config: PaymentGatewayConfig;
    gateway: PaymentGateway;
  },
): Promise<CheckoutResult> {
  const org = await loadOrganization(db, input.organizationId);
  if (org.plan === 'full') {
    throw new AppError('This clinic is already on the Full Plan.', 409, 'already_active', true);
  }
  if (!input.config.enabled) {
    throw new AppError(
      'Online payment is not enabled. Please contact support to activate this clinic.',
      409,
      'gateway_disabled',
      true,
    );
  }

  await db.query(
    `UPDATE payments SET status = 'CANCELLED', last_error = 'superseded by a new checkout'
     WHERE organization_id = ? AND status = 'PENDING'`,
    [input.organizationId],
  );

  const orderId = generateOrderId();
  const [inserted] = await db.query<ResultSetHeader>(
    `INSERT INTO payments (organization_id, plan, amount_usd_cents, currency, status, provider, order_id)
     VALUES (?, 'full', ?, 'USD', 'PENDING', ?, ?)`,
    [input.organizationId, BILLING_PRICE.amountUsdCents, input.config.provider, orderId],
  );
  const paymentId = inserted.insertId;

  let checkoutUrl: string;
  let providerTransactionId: string | null;
  try {
    const created = await input.gateway.createPayment({
      orderId,
      amountUsdCents: BILLING_PRICE.amountUsdCents,
      storeName: input.config.storeName !== '' ? input.config.storeName : org.name,
      returnUrl: buildReturnUrl(input.config, orderId),
    });
    checkoutUrl = created.checkoutUrl;
    providerTransactionId = created.providerTransactionId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(
      "UPDATE payments SET status = 'FAILED', last_error = ? WHERE id = ? AND status = 'PENDING'",
      [message.slice(0, 500), paymentId],
    );
    logger.warn('payment checkout failed', { organizationId: input.organizationId, error: message });
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError('Payment gateway error. Please try again later.', 502, 'gateway_error', true);
  }

  await db.query(
    'UPDATE payments SET checkout_url = ?, provider_transaction_id = ? WHERE id = ?',
    [checkoutUrl, providerTransactionId, paymentId],
  );
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'payment_checkout_created',
    detail: `orderId=${orderId} amountUsdBc=${BILLING_PRICE.amountUsdCents} provider=${input.config.provider}`,
  });

  const [rows] = await db.query<PaymentRow[]>('SELECT * FROM payments WHERE id = ?', [paymentId]);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Payment record disappeared after creation', 500, 'internal_error', false);
  }
  return {
    orderId: row.order_id,
    checkoutUrl,
    amountUsdCents: row.amount_usd_cents,
    currency: row.currency,
    provider: row.provider,
    status: lowerStatus(row.status),
  };
}

async function markPaidAndActivate(
  db: Pool,
  logger: Logger,
  payment: PaymentRow,
  actorId: number | null,
): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE payments SET status = 'PAID', paid_at = UTC_TIMESTAMP(), last_error = NULL
     WHERE id = ? AND status <> 'PAID'`,
    [payment.id],
  );
  const newlyPaid = result.affectedRows > 0;

  const [orgResult] = await db.query<ResultSetHeader>(
    `UPDATE organizations SET plan = 'full', trial_ends_at = NULL
     WHERE id = ? AND plan = 'trial'`,
    [payment.organization_id],
  );

  if (newlyPaid) {
    await recordAudit(db, logger, {
      organizationId: payment.organization_id,
      userId: actorId,
      action: 'payment_completed',
      detail: `orderId=${payment.order_id} amountUsdBc=${payment.amount_usd_cents}`,
    });
  }
  if (orgResult.affectedRows > 0) {
    await recordAudit(db, logger, {
      organizationId: payment.organization_id,
      userId: actorId,
      action: 'trial_activated',
      detail: `from=trial to=full via payment orderId=${payment.order_id}`,
    });
  }
  return newlyPaid;
}

async function loadPayment(db: Pool, organizationId: number, orderId: string): Promise<PaymentRow> {
  const [rows] = await db.query<PaymentRow[]>(
    'SELECT * FROM payments WHERE order_id = ? AND organization_id = ?',
    [orderId, organizationId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Payment not found', 404, 'not_found', true);
  }
  return row;
}

export interface StatusResult {
  orderId: string;
  status: PaymentStatus;
  plan: 'trial' | 'full';
  payment: Record<string, unknown>;
}

export async function checkPaymentStatus(
  db: Pool,
  logger: Logger,
  input: {
    organizationId: number;
    orderId: string;
    actorId: number | null;
    config: PaymentGatewayConfig;
    gateway: PaymentGateway;
  },
): Promise<StatusResult> {
  let payment = await loadPayment(db, input.organizationId, input.orderId);

  if (payment.status === 'PENDING' && input.config.enabled) {
    const providerResult = await input.gateway.queryStatus(payment.order_id);
    if (providerResult.status === 'paid') {
      await markPaidAndActivate(db, logger, payment, input.actorId);
      payment = await loadPayment(db, input.organizationId, input.orderId);
    } else if (providerResult.status === 'failed' || providerResult.status === 'expired') {
      await db.query(
        "UPDATE payments SET status = ?, last_error = ? WHERE id = ? AND status = 'PENDING'",
        [providerResult.status === 'failed' ? 'FAILED' : 'EXPIRED', providerResult.providerStatus, payment.id],
      );
      payment = await loadPayment(db, input.organizationId, input.orderId);
    }
  }

  const org = await loadOrganization(db, input.organizationId);
  return {
    orderId: payment.order_id,
    status: lowerStatus(payment.status),
    plan: org.plan,
    payment: paymentDto(payment),
  };
}

export async function recordMockResult(
  db: Pool,
  logger: Logger,
  input: {
    organizationId: number;
    orderId: string;
    actorId: number;
    result: 'paid' | 'failed';
  },
): Promise<StatusResult> {
  const payment = await loadPayment(db, input.organizationId, input.orderId);
  if (payment.status === 'PENDING') {
    if (input.result === 'paid') {
      await markPaidAndActivate(db, logger, payment, input.actorId);
    } else {
      await db.query(
        "UPDATE payments SET status = 'FAILED', last_error = 'mock payment failed' WHERE id = ? AND status = 'PENDING'",
        [payment.id],
      );
    }
  }
  const fresh = await loadPayment(db, input.organizationId, input.orderId);
  const org = await loadOrganization(db, input.organizationId);
  return {
    orderId: fresh.order_id,
    status: lowerStatus(fresh.status),
    plan: org.plan,
    payment: paymentDto(fresh),
  };
}
