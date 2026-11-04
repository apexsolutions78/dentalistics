import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth, requireCapability } from '../middleware/auth';
import { assertOrgExists } from '../middleware/tenant';
import {
  createClinicExpense,
  createPatientInvoice,
  deleteClinicExpense,
  getPatientBillingReport,
  getPatientBillingSettings,
  getPatientInvoice,
  issuePatientInvoice,
  listClinicExpenses,
  listPatientInvoices,
  listPatientPayments,
  patientBillingReportCsv,
  recordPatientPayment,
  updateClinicExpense,
  updatePatientBillingSettings,
  updatePatientInvoice,
  voidPatientInvoice,
} from '../services/patientBilling';
import { parsePathId } from '../validate';

export interface PatientBillingRouterDeps {
  db: Pool;
  logger: Logger;
}

function orgIdOf(req: Request): number {
  return parsePathId(req.params.orgId);
}

function actorOf(req: Request, organizationId: number): SessionUser {
  const actor = req.user as SessionUser;
  assertOrgExists(actor, organizationId);
  return actor;
}

export function createPatientBillingRouter(deps: PatientBillingRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/:orgId/patient-billing/settings',
    requireCapability('patientBilling.view'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      actorOf(req, organizationId);
      res.status(200).json(await getPatientBillingSettings(deps.db, organizationId));
    },
  );

  router.patch(
    '/:orgId/patient-billing/settings',
    requireCapability('patientBilling.manage'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      const actor = actorOf(req, organizationId);
      const settings = await updatePatientBillingSettings(deps.db, deps.logger, {
        organizationId,
        actorId: actor.id,
        body: readJsonBody(req),
      });
      res.status(200).json(settings);
    },
  );

  router.get(
    '/:orgId/patient-billing/invoices',
    requireCapability('patientBilling.view'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      actorOf(req, organizationId);
      const result = await listPatientInvoices(deps.db, {
        organizationId,
        query: req.query as unknown as Record<string, unknown>,
      });
      res.status(200).json(result);
    },
  );

  router.post(
    '/:orgId/patient-billing/invoices',
    requireCapability('patientBilling.manage'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      const actor = actorOf(req, organizationId);
      const created = await createPatientInvoice(deps.db, deps.logger, {
        organizationId,
        actorId: actor.id,
        body: readJsonBody(req),
      });
      res.status(201).json(created);
    },
  );

  router.get(
    '/:orgId/patient-billing/invoices/:invoiceId',
    requireCapability('patientBilling.view'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      actorOf(req, organizationId);
      const invoice = await getPatientInvoice(deps.db, organizationId, parsePathId(req.params.invoiceId));
      if (invoice === null) {
        throw new AppError('Invoice not found', 404, 'not_found', true);
      }
      res.status(200).json(invoice);
    },
  );

  router.patch(
    '/:orgId/patient-billing/invoices/:invoiceId',
    requireCapability('patientBilling.manage'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      const actor = actorOf(req, organizationId);
      const updated = await updatePatientInvoice(deps.db, deps.logger, {
        organizationId,
        invoiceId: parsePathId(req.params.invoiceId),
        actorId: actor.id,
        body: readJsonBody(req),
      });
      res.status(200).json(updated);
    },
  );

  router.post(
    '/:orgId/patient-billing/invoices/:invoiceId/issue',
    requireCapability('patientBilling.manage'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      const actor = actorOf(req, organizationId);
      const issued = await issuePatientInvoice(deps.db, deps.logger, {
        organizationId,
        invoiceId: parsePathId(req.params.invoiceId),
        actorId: actor.id,
      });
      res.status(200).json(issued);
    },
  );

  router.post(
    '/:orgId/patient-billing/invoices/:invoiceId/void',
    requireCapability('patientBilling.manage'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      const actor = actorOf(req, organizationId);
      const voided = await voidPatientInvoice(deps.db, deps.logger, {
        organizationId,
        invoiceId: parsePathId(req.params.invoiceId),
        actorId: actor.id,
        body: readJsonBody(req),
      });
      res.status(200).json(voided);
    },
  );

  router.post(
    '/:orgId/patient-billing/invoices/:invoiceId/payments',
    requireCapability('patientBilling.manage'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      const actor = actorOf(req, organizationId);
      const recorded = await recordPatientPayment(deps.db, deps.logger, {
        organizationId,
        invoiceId: parsePathId(req.params.invoiceId),
        actorId: actor.id,
        body: readJsonBody(req),
      });
      res.status(201).json(recorded);
    },
  );

  router.get(
    '/:orgId/patient-billing/payments',
    requireCapability('patientBilling.view'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      actorOf(req, organizationId);
      const result = await listPatientPayments(deps.db, {
        organizationId,
        query: req.query as unknown as Record<string, unknown>,
      });
      res.status(200).json(result);
    },
  );

  router.get(
    '/:orgId/patient-billing/expenses',
    requireCapability('patientBilling.manage'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      actorOf(req, organizationId);
      const result = await listClinicExpenses(deps.db, {
        organizationId,
        query: req.query as unknown as Record<string, unknown>,
      });
      res.status(200).json(result);
    },
  );

  router.post(
    '/:orgId/patient-billing/expenses',
    requireCapability('patientBilling.manage'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      const actor = actorOf(req, organizationId);
      const created = await createClinicExpense(deps.db, deps.logger, {
        organizationId,
        actorId: actor.id,
        body: readJsonBody(req),
      });
      res.status(201).json(created);
    },
  );

  router.patch(
    '/:orgId/patient-billing/expenses/:expenseId',
    requireCapability('patientBilling.manage'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      const actor = actorOf(req, organizationId);
      const updated = await updateClinicExpense(deps.db, deps.logger, {
        organizationId,
        expenseId: parsePathId(req.params.expenseId),
        actorId: actor.id,
        body: readJsonBody(req),
      });
      res.status(200).json(updated);
    },
  );

  router.delete(
    '/:orgId/patient-billing/expenses/:expenseId',
    requireCapability('patientBilling.manage'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      const actor = actorOf(req, organizationId);
      const deleted = await deleteClinicExpense(deps.db, deps.logger, {
        organizationId,
        expenseId: parsePathId(req.params.expenseId),
        actorId: actor.id,
      });
      if (!deleted) {
        throw new AppError('Expense not found', 404, 'not_found', true);
      }
      res.status(200).json({ ok: true });
    },
  );

  router.get(
    '/:orgId/patient-billing/reports',
    requireCapability('patientBilling.reports'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      actorOf(req, organizationId);
      const report = await getPatientBillingReport(
        deps.db,
        organizationId,
        req.query as unknown as Record<string, unknown>,
      );
      res.status(200).json(report);
    },
  );

  router.get(
    '/:orgId/patient-billing/reports.csv',
    requireCapability('patientBilling.reports'),
    async (req: Request, res: Response) => {
      const organizationId = orgIdOf(req);
      actorOf(req, organizationId);
      const csv = await patientBillingReportCsv(
        deps.db,
        organizationId,
        req.query as unknown as Record<string, unknown>,
      );
      const from = typeof req.query.from === 'string' ? req.query.from : 'from';
      const to = typeof req.query.to === 'string' ? req.query.to : 'to';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="patient-billing-${from}-${to}.csv"`,
      );
      res.status(200).send(csv);
    },
  );

  return router;
}
