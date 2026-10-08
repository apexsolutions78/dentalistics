import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers } from '../middleware/tenant';
import { gatewayReadiness, loadPaymentGatewayConfig } from '../payments/gatewayConfig';
import { createPaymentGateway } from '../payments/registry';
import {
  checkPaymentStatus,
  createCheckout,
  getBillingSummary,
  recordMockResult,
} from '../services/payments';
import { parsePathId } from '../validate';

export interface BillingRouterDeps {
  db: Pool;
  logger: Logger;
}

const ORDER_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

function parseOrderId(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !ORDER_ID_PATTERN.test(value)) {
    throw new AppError('Invalid payment order id', 400, 'validation_failed', true);
  }
  return value;
}

export function createBillingRouter(deps: BillingRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/billing', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertCanManageMembers(req.user as SessionUser, organizationId);
    const config = await loadPaymentGatewayConfig(deps.db);
    const summary = await getBillingSummary(
      deps.db,
      organizationId,
      config,
      gatewayReadiness(config),
    );
    res.status(200).json(summary);
  });

  router.post('/:orgId/billing/checkout', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const config = await loadPaymentGatewayConfig(deps.db);
    const payment = await createCheckout(deps.db, deps.logger, {
      organizationId,
      actorId: actor.id,
      config,
      gateway: createPaymentGateway(config),
    });
    res.status(201).json({ payment });
  });

  router.get('/:orgId/billing/payments/:orderId/status', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const orderId = parseOrderId(req.params.orderId);
    const config = await loadPaymentGatewayConfig(deps.db);
    const result = await checkPaymentStatus(deps.db, deps.logger, {
      organizationId,
      orderId,
      actorId: actor.id,
      config,
      gateway: createPaymentGateway(config),
    });
    res.status(200).json(result);
  });

  router.post('/:orgId/billing/payments/:orderId/mock-complete', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const orderId = parseOrderId(req.params.orderId);
    const config = await loadPaymentGatewayConfig(deps.db);
    if (config.provider !== 'mock') {
      throw new AppError('Mock payment completion is not available for this gateway', 409, 'mock_disabled', true);
    }
    const body = readJsonBody(req);
    const rawResult = body.result ?? 'paid';
    if (rawResult !== 'paid' && rawResult !== 'failed') {
      throw new AppError('Invalid mock result', 400, 'validation_failed', true);
    }
    const result = await recordMockResult(deps.db, deps.logger, {
      organizationId,
      orderId,
      actorId: actor.id,
      result: rawResult,
    });
    res.status(200).json(result);
  });

  return router;
}
