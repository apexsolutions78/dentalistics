import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { resolveReceiptPath } from '../payments/receipts';
import { rejectManualPayment, confirmManualPayment } from '../services/payments';
import {
  createRegionalPrice,
  deleteRegionalPrice,
  listRegionalPrices,
  updateRegionalPrice,
} from '../services/regionalPrices';
import { listManualPaymentMethods, updateManualPaymentMethod } from '../services/manualPayments';
import { closeSetupHelp, listSetupHelp } from '../services/setupHelp';
import { parsePathId, requireString } from '../validate';

export interface PlatformAdminDeps {
  db: Pool;
  logger: Logger;
}

interface ReceiptRow extends RowDataPacket {
  id: number;
  organization_id: number;
  receipt_stored_name: string | null;
  receipt_content_type: string | null;
}

export function createPlatformAdminRouter(deps: PlatformAdminDeps): Router {
  const router = Router();

  router.get('/regional-prices', async (_req: Request, res: Response) => {
    res.status(200).json({ regions: await listRegionalPrices(deps.db) });
  });

  router.post('/regional-prices', async (req: Request, res: Response) => {
    const body = readJsonBody(req);
    const region = await createRegionalPrice(deps.db, body);
    const actor = req.user as SessionUser;
    await recordAudit(deps.db, deps.logger, {
      organizationId: null,
      userId: actor.id,
      action: 'regional_price_created',
      detail: `region=${region.code} amountMinor=${region.amountMinor} ${region.currency}`,
    });
    res.status(201).json({ region });
  });

  router.patch('/regional-prices/:code', async (req: Request, res: Response) => {
    const code = requireString(req.params.code, 'code', { min: 2, max: 8 });
    const region = await updateRegionalPrice(deps.db, code, readJsonBody(req));
    const actor = req.user as SessionUser;
    await recordAudit(deps.db, deps.logger, {
      organizationId: null,
      userId: actor.id,
      action: 'regional_price_updated',
      detail: `region=${region.code} amountMinor=${region.amountMinor} ${region.currency}`,
    });
    res.status(200).json({ region });
  });

  router.delete('/regional-prices/:code', async (req: Request, res: Response) => {
    const code = requireString(req.params.code, 'code', { min: 2, max: 8 });
    await deleteRegionalPrice(deps.db, code);
    res.status(200).json({ ok: true });
  });

  router.get('/payment-methods', async (_req: Request, res: Response) => {
    res.status(200).json({ methods: await listManualPaymentMethods(deps.db) });
  });

  router.patch('/payment-methods/:methodKey', async (req: Request, res: Response) => {
    const methodKey = requireString(req.params.methodKey, 'methodKey', { min: 2, max: 32 });
    const method = await updateManualPaymentMethod(deps.db, methodKey, readJsonBody(req));
    const actor = req.user as SessionUser;
    await recordAudit(deps.db, deps.logger, {
      organizationId: null,
      userId: actor.id,
      action: 'payment_method_updated',
      detail: `method=${method.key} enabled=${method.enabled}`,
    });
    res.status(200).json({ method });
  });

  router.get('/manual-payments', async (req: Request, res: Response) => {
    const status = req.query.status === undefined ? 'pending' : String(req.query.status);
    const allowed = ['pending', 'paid', 'rejected', 'all'];
    if (!allowed.includes(status)) {
      throw new AppError('Invalid payment status filter', 400, 'validation_failed', true);
    }
    const payments = await listManualPayments(deps.db, status);
    res.status(200).json({ payments });
  });

  router.post('/manual-payments/:paymentId/confirm', async (req: Request, res: Response) => {
    const paymentId = parsePathId(req.params.paymentId);
    const actor = req.user as SessionUser;
    const payment = await confirmManualPayment(deps.db, deps.logger, paymentId, actor.id);
    res.status(200).json({ payment });
  });

  router.post('/manual-payments/:paymentId/reject', async (req: Request, res: Response) => {
    const paymentId = parsePathId(req.params.paymentId);
    const actor = req.user as SessionUser;
    const body = readJsonBody(req);
    const reason = requireString(body.reason, 'reason', { min: 2, max: 500 });
    const payment = await rejectManualPayment(deps.db, deps.logger, paymentId, actor.id, reason);
    res.status(200).json({ payment });
  });

  router.get('/manual-payments/:paymentId/receipt', async (req: Request, res: Response) => {
    const paymentId = parsePathId(req.params.paymentId);
    const [rows] = await deps.db.query<ReceiptRow[]>(
      `SELECT id, organization_id, receipt_stored_name, receipt_content_type
       FROM payments WHERE id = ? AND provider = 'manual'`,
      [paymentId],
    );
    const row = rows[0];
    if (row === undefined || row.receipt_stored_name === null) {
      throw new AppError('Receipt not found', 404, 'not_found', true);
    }
    const fullPath = resolveReceiptPath(row.organization_id, row.receipt_stored_name);
    if (!fs.existsSync(fullPath)) {
      throw new AppError('Receipt file is missing', 404, 'not_found', true);
    }
    res.setHeader('Content-Type', row.receipt_content_type ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${row.receipt_stored_name}"`);
    res.sendFile(fullPath);
  });

  router.get('/setup-help', async (_req: Request, res: Response) => {
    res.status(200).json({ requests: await listSetupHelp(deps.db) });
  });

  router.post('/setup-help/:requestId/close', async (req: Request, res: Response) => {
    const requestId = parsePathId(req.params.requestId);
    const request = await closeSetupHelp(deps.db, requestId);
    res.status(200).json({ request });
  });

  return router;
}

interface ManualListRow extends RowDataPacket {
  id: number;
  organization_id: number;
  organization_name: string;
  amount_minor: number | null;
  amount_usd_cents: number;
  currency: string;
  region_code: string | null;
  status: string;
  method_key: string | null;
  order_id: string;
  payer_reference: string | null;
  receipt_stored_name: string | null;
  rejection_reason: string | null;
  created_at: Date;
  paid_at: Date | null;
}

async function listManualPayments(db: Pool, status: string): Promise<Array<Record<string, unknown>>> {
  const params: unknown[] = [];
  let where = "p.provider = 'manual'";
  if (status !== 'all') {
    where += ' AND p.status = ?';
    params.push(status.toUpperCase());
  }
  const [rows] = await db.query<ManualListRow[]>(
    `SELECT p.id, p.organization_id, o.name AS organization_name, p.amount_minor, p.amount_usd_cents,
            p.currency, p.region_code, p.status, p.method_key, p.order_id, p.payer_reference,
            p.receipt_stored_name, p.rejection_reason, p.created_at, p.paid_at
     FROM payments p
     JOIN organizations o ON o.id = p.organization_id
     WHERE ${where}
     ORDER BY p.id DESC
     LIMIT 100`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    amountMinor: row.amount_minor,
    amountUsdCents: row.amount_usd_cents,
    currency: row.currency,
    regionCode: row.region_code,
    status: row.status.toLowerCase(),
    methodKey: row.method_key,
    orderId: row.order_id,
    reference: row.payer_reference,
    hasReceipt: row.receipt_stored_name !== null,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }));
}
