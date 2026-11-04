import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import { parseReceiptUpload, writeReceipt, type ReceiptUpload } from '../payments/receipts';
import { parseRegionCode } from '../pricing/money';
import { requireString } from '../validate';
import { loadRegionalPrice } from './regionalPrices';

export interface ManualPaymentMethod {
  key: string;
  label: string;
  instructions: string;
  enabled: boolean;
  regionCodes: string[];
  sortOrder: number;
}

interface MethodRow extends RowDataPacket {
  method_key: string;
  label: string;
  instructions: string;
  enabled: number;
  region_codes: string;
  sort_order: number;
}

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .:_-]{2,79}$/;

function methodDto(row: MethodRow): ManualPaymentMethod {
  return {
    key: row.method_key,
    label: row.label,
    instructions: row.instructions,
    enabled: row.enabled === 1,
    regionCodes: row.region_codes === '' ? [] : row.region_codes.split(','),
    sortOrder: row.sort_order,
  };
}

export async function listManualPaymentMethods(db: Pool): Promise<ManualPaymentMethod[]> {
  const [rows] = await db.query<MethodRow[]>(
    `SELECT method_key, label, instructions, enabled, region_codes, sort_order
     FROM manual_payment_methods ORDER BY sort_order, method_key`,
  );
  return rows.map(methodDto);
}

export async function listPayableMethods(db: Pool): Promise<ManualPaymentMethod[]> {
  const methods = await listManualPaymentMethods(db);
  return methods.filter((method) => method.enabled && method.instructions.trim() !== '');
}

function parseRegionList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new ValidationError('Invalid input', ['regionCodes must be a list of at most 20 region codes']);
  }
  const codes = value.map((entry) => parseRegionCode(entry));
  return [...new Set(codes)];
}

export async function updateManualPaymentMethod(
  db: Pool,
  methodKey: string,
  body: Record<string, unknown>,
): Promise<ManualPaymentMethod> {
  const key = requireString(methodKey, 'methodKey', { min: 2, max: 32 });
  const methods = await listManualPaymentMethods(db);
  const current = methods.find((method) => method.key === key);
  if (current === undefined) {
    throw new AppError('Payment method not found', 404, 'not_found', true);
  }
  const label = body.label === undefined ? current.label : requireString(body.label, 'label', { min: 2, max: 120 });
  const instructions =
    body.instructions === undefined
      ? current.instructions
      : requireString(body.instructions, 'instructions', { min: 0, max: 4000 });
  const enabled = body.enabled === undefined ? current.enabled : body.enabled;
  if (typeof enabled !== 'boolean') {
    throw new ValidationError('Invalid input', ['enabled must be a boolean']);
  }
  const regionCodes = body.regionCodes === undefined ? current.regionCodes : parseRegionList(body.regionCodes);
  if (enabled && instructions.trim() === '') {
    throw new ValidationError('Invalid input', [
      'Write the payment instructions before enabling this method. Bank details are not stored in the app until you save them here.',
    ]);
  }
  if (enabled && regionCodes.length === 0) {
    throw new ValidationError('Invalid input', ['Choose at least one region before enabling this method.']);
  }
  await db.query(
    `UPDATE manual_payment_methods
     SET label = ?, instructions = ?, enabled = ?, region_codes = ?
     WHERE method_key = ?`,
    [label, instructions.trim(), enabled ? 1 : 0, regionCodes.join(','), key],
  );
  const updated = (await listManualPaymentMethods(db)).find((method) => method.key === key);
  if (updated === undefined) {
    throw new AppError('Payment method not found', 404, 'not_found', true);
  }
  return updated;
}

function parseReference(value: unknown): string {
  const reference = requireString(value, 'reference', { min: 3, max: 80 });
  if (!REFERENCE_PATTERN.test(reference)) {
    throw new ValidationError('Invalid input', [
      'reference must be 3-80 characters and start with a letter or number',
    ]);
  }
  return reference;
}

export interface ManualSubmission {
  orderId: string;
  status: string;
  amountMinor: number;
  currency: string;
  regionCode: string;
  methodKey: string;
  reference: string;
}

export async function submitManualPayment(
  db: Pool,
  logger: Logger,
  input: {
    organizationId: number;
    actorId: number;
    body: Record<string, unknown>;
    orderId: string;
  },
): Promise<ManualSubmission> {
  const regionCode = parseRegionCode(input.body.regionCode);
  const methodKey = requireString(input.body.methodKey, 'methodKey', { min: 2, max: 32 });
  const reference = parseReference(input.body.reference);
  const receipt = parseReceiptUpload(input.body.receipt);
  const price = await loadRegionalPrice(db, regionCode);
  const method = (await listPayableMethods(db)).find((item) => item.key === methodKey);
  if (method === undefined || !method.regionCodes.includes(regionCode)) {
    throw new AppError(
      'That payment method is not available for the selected region.',
      409,
      'method_unavailable',
      true,
    );
  }
  const [pending] = await db.query<RowDataPacket[]>(
    `SELECT id FROM payments
     WHERE organization_id = ? AND provider = 'manual' AND status = 'PENDING' LIMIT 1`,
    [input.organizationId],
  );
  if (pending[0] !== undefined) {
    throw new AppError(
      'A payment is already waiting for review. Wait for it to be confirmed or rejected before sending another.',
      409,
      'payment_pending',
      true,
    );
  }

  const amountUsdCents = price.currency === 'USD' ? price.amountMinor : 0;
  const [inserted] = await db.query<ResultSetHeader>(
    `INSERT INTO payments
       (organization_id, plan, amount_usd_cents, amount_minor, currency, region_code, status,
        provider, method_key, order_id, payer_reference)
     VALUES (?, 'full', ?, ?, ?, ?, 'PENDING', 'manual', ?, ?, ?)`,
    [
      input.organizationId,
      amountUsdCents,
      price.amountMinor,
      price.currency,
      regionCode,
      methodKey,
      input.orderId,
      reference,
    ],
  );
  const paymentId = inserted.insertId;
  if (receipt !== null) {
    try {
      await attachReceipt(db, input.organizationId, paymentId, receipt);
    } catch (err) {
      await db.query('DELETE FROM payments WHERE id = ? AND status = \'PENDING\'', [paymentId]);
      throw err;
    }
  }
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'manual_payment_submitted',
    detail: `orderId=${input.orderId} region=${regionCode} method=${methodKey} amountMinor=${price.amountMinor} ${price.currency}`,
  });
  return {
    orderId: input.orderId,
    status: 'pending',
    amountMinor: price.amountMinor,
    currency: price.currency,
    regionCode,
    methodKey,
    reference,
  };
}

async function attachReceipt(
  db: Pool,
  organizationId: number,
  paymentId: number,
  receipt: ReceiptUpload,
): Promise<void> {
  const stored = await writeReceipt(organizationId, receipt);
  await db.query(
    'UPDATE payments SET receipt_stored_name = ?, receipt_content_type = ? WHERE id = ?',
    [stored.storedName, stored.contentType, paymentId],
  );
}
