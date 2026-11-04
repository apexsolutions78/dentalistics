import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import {
  APPOINTMENT_COUNT_STATUSES,
  REPORT_BASIS,
  REPORT_CSV_HEADER,
  addAppointmentStatus,
  assertPaymentAmount,
  assertPaymentMethod,
  assertReportWindow,
  bucketKey,
  defaultBillingSettings,
  deriveInvoiceStatus,
  emptyAppointmentCounts,
  enumerateBuckets,
  formatInvoiceNumber,
  invoiceTotals,
  lineTotals,
  noShowRate,
  parseCents,
  parseCurrency,
  parseInvoiceLines,
  parseInvoicePrefix,
  parseSignedCents,
  parseTaxLabel,
  paymentMethodsFor,
  quantityToString,
  taxPercentToString,
  toCsv,
  type AppointmentCounts,
  type InvoiceStatus,
  type LineInput,
  type PatientCurrency,
  type PaymentMethod,
  REPORT_GROUPS,
  type ReportGroup,
  type TaxLabel,
  MAX_INVOICE_SEQUENCE,
} from '../billing/patientMoney';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import { optionalText, parseDateOnly, parseListParams, requireChoice, requireString } from '../validate';

type Queryable = Pool | PoolConnection;

interface SettingsRow extends RowDataPacket {
  currency: string;
  tax_label: string;
  invoice_prefix: string;
  next_number: number;
}

interface InvoiceRow extends RowDataPacket {
  id: number;
  organization_id: number;
  patient_id: number;
  number: string | null;
  status: InvoiceStatus;
  currency: string;
  tax_label: string;
  notes: string | null;
  issued_at: Date | null;
  voided_at: Date | null;
  void_reason: string | null;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  created_at: Date;
  updated_at: Date;
  paid_cents: number | string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
}

interface LineRow extends RowDataPacket {
  id: number;
  position: number;
  description: string;
  quantity: string | number;
  unit_price_cents: number;
  discount_cents: number;
  tax_percent: string | number;
  line_subtotal_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
}

interface PaymentRow extends RowDataPacket {
  id: number;
  invoice_id: number;
  patient_id: number;
  amount_cents: number;
  method: PaymentMethod;
  paid_on: Date | string;
  note: string | null;
  created_at: Date;
  invoice_number: string | null;
  first_name: string;
  last_name: string;
}

interface ExpenseRow extends RowDataPacket {
  id: number;
  category: string;
  amount_cents: number;
  currency: string;
  expense_date: Date | string;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

interface OrgRow extends RowDataPacket {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_url: string | null;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface SumRow extends RowDataPacket {
  invoiced_cents: number | string | null;
  paid_cents: number | string | null;
}

interface DatedAmountRow extends RowDataPacket {
  day: Date | string;
  amount_cents: number | string;
  currency: string;
  paid_cents?: number | string;
}

interface AppointmentCountRow extends RowDataPacket {
  day: Date | string;
  status: string;
  n: number | string;
}

export interface BillingSettingsDto {
  currency: PatientCurrency;
  taxLabel: TaxLabel;
  invoicePrefix: string;
  nextNumber: number;
  paymentMethods: readonly PaymentMethod[];
}

export interface PatientBalanceDto {
  patientId: number;
  currency: PatientCurrency;
  invoicedCents: number;
  paidCents: number;
  balanceCents: number;
}

function asNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function dayOf(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function requireObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  return body as Record<string, unknown>;
}

function isDuplicate(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY';
}

async function withTransaction<T>(db: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function mapSettings(row: SettingsRow | undefined): Omit<BillingSettingsDto, 'paymentMethods'> {
  if (row === undefined) {
    return defaultBillingSettings();
  }
  return {
    currency: row.currency as PatientCurrency,
    taxLabel: row.tax_label as TaxLabel,
    invoicePrefix: row.invoice_prefix,
    nextNumber: asNumber(row.next_number),
  };
}

function settingsDto(row: SettingsRow | undefined): BillingSettingsDto {
  const settings = mapSettings(row);
  return { ...settings, paymentMethods: paymentMethodsFor(settings.currency) };
}

async function readSettingsRow(db: Queryable, organizationId: number): Promise<SettingsRow | undefined> {
  const [rows] = await db.query<SettingsRow[]>(
    `SELECT currency, tax_label, invoice_prefix, next_number
     FROM clinic_billing_settings WHERE organization_id = ?`,
    [organizationId],
  );
  return rows[0];
}

async function lockSettings(conn: PoolConnection, organizationId: number): Promise<SettingsRow> {
  await conn.query(
    `INSERT INTO clinic_billing_settings (organization_id)
     VALUES (?)
     ON DUPLICATE KEY UPDATE organization_id = organization_id`,
    [organizationId],
  );
  const [rows] = await conn.query<SettingsRow[]>(
    `SELECT currency, tax_label, invoice_prefix, next_number
     FROM clinic_billing_settings WHERE organization_id = ? FOR UPDATE`,
    [organizationId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Billing settings could not be loaded', 500, 'internal_error');
  }
  return row;
}

const INVOICE_FROM = `FROM patient_invoices i
  JOIN patients p ON p.id = i.patient_id AND p.organization_id = i.organization_id`;

const INVOICE_SELECT = `SELECT i.id, i.organization_id, i.patient_id, i.number, i.status, i.currency,
    i.tax_label, i.notes, i.issued_at, i.voided_at, i.void_reason,
    i.subtotal_cents, i.discount_cents, i.tax_cents, i.total_cents, i.created_at, i.updated_at,
    COALESCE((SELECT SUM(pp.amount_cents) FROM patient_payments pp WHERE pp.invoice_id = i.id), 0) AS paid_cents,
    p.first_name, p.last_name, p.phone, p.email
  ${INVOICE_FROM}`;

function invoiceSummary(row: InvoiceRow): Record<string, unknown> {
  const paidCents = asNumber(row.paid_cents);
  const totalCents = asNumber(row.total_cents);
  const balanceCents = row.status === 'void' || row.status === 'draft' ? 0 : totalCents - paidCents;
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: `${row.first_name} ${row.last_name}`.trim(),
    number: row.number,
    status: deriveInvoiceStatus(row.status, totalCents, paidCents),
    currency: row.currency,
    taxLabel: row.tax_label,
    totalCents,
    paidCents,
    balanceCents,
    issuedAt: iso(row.issued_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function lineDto(row: LineRow): Record<string, unknown> {
  const quantity = typeof row.quantity === 'number' ? row.quantity.toFixed(2) : String(row.quantity);
  const tax = typeof row.tax_percent === 'number' ? row.tax_percent.toFixed(2) : String(row.tax_percent);
  return {
    id: row.id,
    position: row.position,
    description: row.description,
    quantity,
    unitPriceCents: asNumber(row.unit_price_cents),
    discountCents: asNumber(row.discount_cents),
    taxPercent: tax,
    subtotalCents: asNumber(row.line_subtotal_cents),
    taxCents: asNumber(row.line_tax_cents),
    totalCents: asNumber(row.line_total_cents),
  };
}

function paymentDto(row: PaymentRow): Record<string, unknown> {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    patientId: row.patient_id,
    patientName: `${row.first_name} ${row.last_name}`.trim(),
    amountCents: asNumber(row.amount_cents),
    method: row.method,
    paidOn: dayOf(row.paid_on),
    note: row.note,
    createdAt: iso(row.created_at),
  };
}

async function loadInvoiceRow(
  db: Queryable,
  organizationId: number,
  invoiceId: number,
  lock: boolean,
): Promise<InvoiceRow | null> {
  const [rows] = await db.query<InvoiceRow[]>(
    `${INVOICE_SELECT} WHERE i.organization_id = ? AND i.id = ?${lock ? ' FOR UPDATE' : ''}`,
    [organizationId, invoiceId],
  );
  return rows[0] ?? null;
}

async function letterhead(db: Queryable, organizationId: number): Promise<Record<string, unknown>> {
  const [rows] = await db.query<OrgRow[]>(
    'SELECT name, phone, email, address, logo_url FROM organizations WHERE id = ?',
    [organizationId],
  );
  const row = rows[0];
  return {
    name: row?.name ?? '',
    phone: row?.phone ?? null,
    email: row?.email ?? null,
    address: row?.address ?? null,
    logoUrl: row?.logo_url ?? null,
  };
}

async function invoiceDetail(
  db: Queryable,
  organizationId: number,
  row: InvoiceRow,
): Promise<Record<string, unknown>> {
  const [lines] = await db.query<LineRow[]>(
    `SELECT id, position, description, quantity, unit_price_cents, discount_cents, tax_percent,
        line_subtotal_cents, line_tax_cents, line_total_cents
     FROM patient_invoice_lines WHERE invoice_id = ? ORDER BY position ASC, id ASC`,
    [row.id],
  );
  const [payments] = await db.query<PaymentRow[]>(
    `SELECT pp.id, pp.invoice_id, pp.patient_id, pp.amount_cents, pp.method, pp.paid_on, pp.note, pp.created_at,
        i.number AS invoice_number, p.first_name, p.last_name
     FROM patient_payments pp
     JOIN patient_invoices i ON i.id = pp.invoice_id
     JOIN patients p ON p.id = pp.patient_id
     WHERE pp.invoice_id = ?
     ORDER BY pp.paid_on ASC, pp.id ASC`,
    [row.id],
  );
  const paidCents = asNumber(row.paid_cents);
  return {
    ...invoiceSummary(row),
    notes: row.notes,
    subtotalCents: asNumber(row.subtotal_cents),
    discountCents: asNumber(row.discount_cents),
    taxCents: asNumber(row.tax_cents),
    voidedAt: iso(row.voided_at),
    voidReason: row.void_reason,
    patient: {
      id: row.patient_id,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      email: row.email,
    },
    lines: lines.map(lineDto),
    payments: payments.map(paymentDto),
    letterhead: await letterhead(db, organizationId),
    paidCents,
  };
}

async function requirePatient(db: Queryable, organizationId: number, patientId: number): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id FROM patients WHERE id = ? AND organization_id = ?',
    [patientId, organizationId],
  );
  if (rows[0] === undefined) {
    throw new AppError('Patient not found', 404, 'not_found', true);
  }
}

async function insertLines(conn: PoolConnection, invoiceId: number, lines: LineInput[]): Promise<void> {
  let position = 1;
  for (const line of lines) {
    const totals = lineTotals(line);
    await conn.query(
      `INSERT INTO patient_invoice_lines (
         invoice_id, position, description, quantity, unit_price_cents, discount_cents, tax_percent,
         line_subtotal_cents, line_tax_cents, line_total_cents
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        position,
        line.description,
        quantityToString(line.quantityHundredths),
        line.unitPriceCents,
        line.discountCents,
        taxPercentToString(line.taxPercentHundredths),
        totals.grossCents,
        totals.taxCents,
        totals.totalCents,
      ],
    );
    position += 1;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function getPatientBillingSettings(
  db: Pool,
  organizationId: number,
): Promise<{ settings: BillingSettingsDto }> {
  return { settings: settingsDto(await readSettingsRow(db, organizationId)) };
}

export async function updatePatientBillingSettings(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; actorId: number; body: unknown },
): Promise<{ settings: BillingSettingsDto }> {
  const body = requireObject(input.body);
  const current = mapSettings(await readSettingsRow(db, input.organizationId));
  const next = {
    currency: body.currency === undefined ? current.currency : parseCurrency(body.currency),
    taxLabel: body.taxLabel === undefined ? current.taxLabel : parseTaxLabel(body.taxLabel),
    invoicePrefix: body.invoicePrefix === undefined ? current.invoicePrefix : parseInvoicePrefix(body.invoicePrefix),
    nextNumber: current.nextNumber,
  };
  if (body.nextNumber !== undefined) {
    if (typeof body.nextNumber !== 'number' || !Number.isInteger(body.nextNumber)) {
      throw new ValidationError('Invalid input', ['nextNumber must be an integer']);
    }
    if (body.nextNumber < 1 || body.nextNumber > MAX_INVOICE_SEQUENCE) {
      throw new ValidationError('Invalid input', [
        `nextNumber must be between 1 and ${MAX_INVOICE_SEQUENCE}`,
      ]);
    }
    next.nextNumber = body.nextNumber;
  }
  const candidate = formatInvoiceNumber(next.invoicePrefix, next.nextNumber);
  const [taken] = await db.query<RowDataPacket[]>(
    'SELECT id FROM patient_invoices WHERE organization_id = ? AND number = ? LIMIT 1',
    [input.organizationId, candidate],
  );
  if (taken[0] !== undefined) {
    throw new ValidationError('Invalid input', [
      `Invoice number ${candidate} is already used. Choose a different prefix or next number.`,
    ]);
  }
  await db.query(
    `INSERT INTO clinic_billing_settings (organization_id, currency, tax_label, invoice_prefix, next_number)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE currency = VALUES(currency), tax_label = VALUES(tax_label),
       invoice_prefix = VALUES(invoice_prefix), next_number = VALUES(next_number)`,
    [input.organizationId, next.currency, next.taxLabel, next.invoicePrefix, next.nextNumber],
  );
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'patient_billing_settings_updated',
    detail: `currency=${next.currency} taxLabel=${next.taxLabel} prefix=${next.invoicePrefix} next=${next.nextNumber}`,
  });
  return getPatientBillingSettings(db, input.organizationId);
}

export async function patientBalance(
  db: Queryable,
  organizationId: number,
  patientId: number,
  currency: PatientCurrency,
): Promise<PatientBalanceDto> {
  const [rows] = await db.query<SumRow[]>(
    `SELECT COALESCE(SUM(i.total_cents), 0) AS invoiced_cents,
        COALESCE((
          SELECT SUM(pp.amount_cents)
          FROM patient_payments pp
          JOIN patient_invoices i2 ON i2.id = pp.invoice_id
          WHERE i2.organization_id = ? AND i2.patient_id = ? AND i2.currency = ?
            AND i2.status NOT IN ('draft', 'void')
        ), 0) AS paid_cents
     FROM patient_invoices i
     WHERE i.organization_id = ? AND i.patient_id = ? AND i.currency = ?
       AND i.status NOT IN ('draft', 'void')`,
    [organizationId, patientId, currency, organizationId, patientId, currency],
  );
  const invoicedCents = asNumber(rows[0]?.invoiced_cents);
  const paidCents = asNumber(rows[0]?.paid_cents);
  return {
    patientId,
    currency,
    invoicedCents,
    paidCents,
    balanceCents: invoicedCents - paidCents,
  };
}

export async function listPatientInvoices(
  db: Pool,
  input: { organizationId: number; query: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const { limit, offset } = parseListParams(input.query);
  const where = ['i.organization_id = ?'];
  const params: Array<string | number> = [input.organizationId];
  const status = input.query.status;
  if (status !== undefined && status !== '') {
    where.push('i.status = ?');
    params.push(
      requireChoice(status, ['draft', 'issued', 'partially_paid', 'paid', 'void'], 'status'),
    );
  }
  let patientId: number | null = null;
  if (input.query.patientId !== undefined && input.query.patientId !== '') {
    const parsed = Number(input.query.patientId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ValidationError('Invalid input', ['patientId must be a positive integer']);
    }
    patientId = parsed;
    where.push('i.patient_id = ?');
    params.push(parsed);
  }
  const q = input.query.q;
  if (typeof q === 'string' && q.trim() !== '') {
    const like = `%${escapeLike(q.trim().slice(0, 80))}%`;
    where.push(
      "(i.number LIKE ? ESCAPE '\\\\' OR CONCAT(p.first_name, ' ', p.last_name) LIKE ? ESCAPE '\\\\')",
    );
    params.push(like, like);
  }
  const whereSql = where.join(' AND ');
  const [countRows] = await db.query<CountRow[]>(
    `SELECT COUNT(*) AS total ${INVOICE_FROM} WHERE ${whereSql}`,
    params,
  );
  const [rows] = await db.query<InvoiceRow[]>(
    `${INVOICE_SELECT} WHERE ${whereSql} ORDER BY i.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const settings = settingsDto(await readSettingsRow(db, input.organizationId));
  const balance =
    patientId === null ? null : await patientBalance(db, input.organizationId, patientId, settings.currency);
  return {
    invoices: rows.map(invoiceSummary),
    total: asNumber(countRows[0]?.total),
    limit,
    offset,
    balance,
  };
}

export async function getPatientInvoice(
  db: Pool,
  organizationId: number,
  invoiceId: number,
): Promise<Record<string, unknown> | null> {
  const row = await loadInvoiceRow(db, organizationId, invoiceId, false);
  if (row === null) return null;
  return { invoice: await invoiceDetail(db, organizationId, row) };
}

export async function createPatientInvoice(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; actorId: number; body: unknown },
): Promise<Record<string, unknown>> {
  const body = requireObject(input.body);
  if (typeof body.patientId !== 'number' || !Number.isInteger(body.patientId) || body.patientId <= 0) {
    throw new ValidationError('Invalid input', ['patientId must be a positive integer']);
  }
  const lines = parseInvoiceLines(body.lines);
  const totals = invoiceTotals(lines.map((line) => lineTotals(line)));
  const notes = optionalText(body.notes, 'notes', 1000);
  const settings = mapSettings(await readSettingsRow(db, input.organizationId));
  await requirePatient(db, input.organizationId, body.patientId);

  const invoiceId = await withTransaction(db, async (conn) => {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO patient_invoices (
         organization_id, patient_id, status, currency, tax_label, notes,
         subtotal_cents, discount_cents, tax_cents, total_cents, created_by
       ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.organizationId,
        body.patientId,
        settings.currency,
        settings.taxLabel,
        notes,
        totals.subtotalCents,
        totals.discountCents,
        totals.taxCents,
        totals.totalCents,
        input.actorId,
      ],
    );
    await insertLines(conn, result.insertId, lines);
    return result.insertId;
  });

  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'patient_invoice_created',
    detail: `id=${invoiceId} patient=${body.patientId}`,
  });
  const created = await getPatientInvoice(db, input.organizationId, invoiceId);
  if (created === null) {
    throw new AppError('Invoice could not be loaded', 500, 'internal_error');
  }
  return created;
}

export async function updatePatientInvoice(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; invoiceId: number; actorId: number; body: unknown },
): Promise<Record<string, unknown>> {
  const body = requireObject(input.body);
  if (body.notes === undefined && body.lines === undefined) {
    throw new ValidationError('Invalid input', ['Provide notes or lines to update']);
  }
  const lines = body.lines === undefined ? null : parseInvoiceLines(body.lines);
  const notes = body.notes === undefined ? undefined : optionalText(body.notes, 'notes', 1000);

  await withTransaction(db, async (conn) => {
    const row = await loadInvoiceRow(conn, input.organizationId, input.invoiceId, true);
    if (row === null) {
      throw new AppError('Invoice not found', 404, 'not_found', true);
    }
    if (row.status !== 'draft') {
      throw new AppError('Only a draft invoice can be edited', 409, 'invoice_not_draft', true);
    }
    if (lines !== null) {
      const totals = invoiceTotals(lines.map((line) => lineTotals(line)));
      await conn.query('DELETE FROM patient_invoice_lines WHERE invoice_id = ?', [row.id]);
      await insertLines(conn, row.id, lines);
      await conn.query(
        `UPDATE patient_invoices
         SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?, total_cents = ?, notes = ?
         WHERE id = ?`,
        [
          totals.subtotalCents,
          totals.discountCents,
          totals.taxCents,
          totals.totalCents,
          notes === undefined ? row.notes : notes,
          row.id,
        ],
      );
    } else if (notes !== undefined) {
      await conn.query('UPDATE patient_invoices SET notes = ? WHERE id = ?', [notes, row.id]);
    }
  });

  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'patient_invoice_updated',
    detail: `id=${input.invoiceId}`,
  });
  const updated = await getPatientInvoice(db, input.organizationId, input.invoiceId);
  if (updated === null) {
    throw new AppError('Invoice not found', 404, 'not_found', true);
  }
  return updated;
}

export async function issuePatientInvoice(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; invoiceId: number; actorId: number },
): Promise<Record<string, unknown>> {
  let number = '';
  await withTransaction(db, async (conn) => {
    const row = await loadInvoiceRow(conn, input.organizationId, input.invoiceId, true);
    if (row === null) {
      throw new AppError('Invoice not found', 404, 'not_found', true);
    }
    if (row.status !== 'draft') {
      throw new AppError('Only a draft invoice can be issued', 409, 'invoice_not_draft', true);
    }
    const [lineCount] = await conn.query<CountRow[]>(
      'SELECT COUNT(*) AS total FROM patient_invoice_lines WHERE invoice_id = ?',
      [row.id],
    );
    if (asNumber(lineCount[0]?.total) < 1) {
      throw new ValidationError('Invalid input', ['Add at least one line before issuing']);
    }
    const settings = await lockSettings(conn, input.organizationId);
    const sequence = asNumber(settings.next_number);
    number = formatInvoiceNumber(settings.invoice_prefix, sequence);
    const status = deriveInvoiceStatus('issued', asNumber(row.total_cents), 0);
    try {
      await conn.query(
        `UPDATE patient_invoices
         SET number = ?, status = ?, tax_label = ?, issued_at = ?
         WHERE id = ?`,
        [number, status, settings.tax_label, new Date(), row.id],
      );
    } catch (err) {
      if (isDuplicate(err)) {
        throw new AppError(
          `Invoice number ${number} is already used. Change the prefix or the next number in billing settings.`,
          409,
          'invoice_number_taken',
          true,
        );
      }
      throw err;
    }
    await conn.query(
      'UPDATE clinic_billing_settings SET next_number = ? WHERE organization_id = ?',
      [sequence + 1, input.organizationId],
    );
  });

  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'patient_invoice_issued',
    detail: `id=${input.invoiceId} number=${number}`,
  });
  const issued = await getPatientInvoice(db, input.organizationId, input.invoiceId);
  if (issued === null) {
    throw new AppError('Invoice not found', 404, 'not_found', true);
  }
  return issued;
}

export async function voidPatientInvoice(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; invoiceId: number; actorId: number; body: unknown },
): Promise<Record<string, unknown>> {
  const body = requireObject(input.body);
  const reason = optionalText(body.reason, 'reason', 255);
  await withTransaction(db, async (conn) => {
    const row = await loadInvoiceRow(conn, input.organizationId, input.invoiceId, true);
    if (row === null) {
      throw new AppError('Invoice not found', 404, 'not_found', true);
    }
    if (row.status === 'void') {
      throw new AppError('Invoice is already void', 409, 'invoice_void', true);
    }
    if (asNumber(row.paid_cents) !== 0) {
      throw new AppError(
        'Refund the payments on this invoice before voiding it',
        409,
        'invoice_has_payments',
        true,
      );
    }
    await conn.query(
      `UPDATE patient_invoices SET status = 'void', voided_at = ?, void_reason = ? WHERE id = ?`,
      [new Date(), reason, row.id],
    );
  });
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'patient_invoice_voided',
    detail: `id=${input.invoiceId}`,
  });
  const voided = await getPatientInvoice(db, input.organizationId, input.invoiceId);
  if (voided === null) {
    throw new AppError('Invoice not found', 404, 'not_found', true);
  }
  return voided;
}

async function refreshInvoiceStatus(conn: PoolConnection, row: InvoiceRow): Promise<void> {
  const [sums] = await conn.query<SumRow[]>(
    'SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents, 0 AS invoiced_cents FROM patient_payments WHERE invoice_id = ?',
    [row.id],
  );
  const paidCents = asNumber(sums[0]?.paid_cents);
  const status = deriveInvoiceStatus(row.status === 'void' ? 'void' : 'issued', asNumber(row.total_cents), paidCents);
  await conn.query('UPDATE patient_invoices SET status = ? WHERE id = ?', [status, row.id]);
}

export async function recordPatientPayment(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; invoiceId: number; actorId: number; body: unknown },
): Promise<Record<string, unknown>> {
  const body = requireObject(input.body);
  const amountCents = parseSignedCents(body.amountCents, 'amountCents');
  const paidOn = parseDateOnly(body.paidOn, 'paidOn');
  const note = optionalText(body.note, 'note', 500);
  let paymentId = 0;
  await withTransaction(db, async (conn) => {
    const row = await loadInvoiceRow(conn, input.organizationId, input.invoiceId, true);
    if (row === null) {
      throw new AppError('Invoice not found', 404, 'not_found', true);
    }
    const method = assertPaymentMethod(row.currency, typeof body.method === 'string' ? body.method : '');
    const paidCents = asNumber(row.paid_cents);
    const totalCents = asNumber(row.total_cents);
    const status = deriveInvoiceStatus(row.status, totalCents, paidCents);
    assertPaymentAmount({
      amountCents,
      paidCents,
      balanceCents: Math.max(0, totalCents - paidCents),
      status,
    });
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO patient_payments (
         organization_id, patient_id, invoice_id, amount_cents, method, paid_on, note, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.organizationId,
        row.patient_id,
        row.id,
        amountCents,
        method,
        paidOn,
        note,
        input.actorId,
      ],
    );
    paymentId = result.insertId;
    await refreshInvoiceStatus(conn, row);
  });
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'patient_payment_recorded',
    detail: `id=${paymentId} invoice=${input.invoiceId} amountCents=${amountCents}`,
  });
  const invoice = await getPatientInvoice(db, input.organizationId, input.invoiceId);
  return { paymentId, ...invoice };
}

export async function listPatientPayments(
  db: Pool,
  input: { organizationId: number; query: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const { limit, offset } = parseListParams(input.query);
  const where = ['pp.organization_id = ?'];
  const params: Array<string | number> = [input.organizationId];
  if (input.query.invoiceId !== undefined && input.query.invoiceId !== '') {
    const invoiceId = Number(input.query.invoiceId);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      throw new ValidationError('Invalid input', ['invoiceId must be a positive integer']);
    }
    where.push('pp.invoice_id = ?');
    params.push(invoiceId);
  }
  if (input.query.patientId !== undefined && input.query.patientId !== '') {
    const patientId = Number(input.query.patientId);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new ValidationError('Invalid input', ['patientId must be a positive integer']);
    }
    where.push('pp.patient_id = ?');
    params.push(patientId);
  }
  const whereSql = where.join(' AND ');
  const [countRows] = await db.query<CountRow[]>(
    `SELECT COUNT(*) AS total FROM patient_payments pp WHERE ${whereSql}`,
    params,
  );
  const [rows] = await db.query<PaymentRow[]>(
    `SELECT pp.id, pp.invoice_id, pp.patient_id, pp.amount_cents, pp.method, pp.paid_on, pp.note, pp.created_at,
        i.number AS invoice_number, p.first_name, p.last_name
     FROM patient_payments pp
     JOIN patient_invoices i ON i.id = pp.invoice_id
     JOIN patients p ON p.id = pp.patient_id
     WHERE ${whereSql}
     ORDER BY pp.paid_on DESC, pp.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return {
    payments: rows.map(paymentDto),
    total: asNumber(countRows[0]?.total),
    limit,
    offset,
  };
}

function expenseDto(row: ExpenseRow): Record<string, unknown> {
  return {
    id: row.id,
    category: row.category,
    amountCents: asNumber(row.amount_cents),
    currency: row.currency,
    expenseDate: dayOf(row.expense_date),
    note: row.note,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listClinicExpenses(
  db: Pool,
  input: { organizationId: number; query: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const { limit, offset } = parseListParams(input.query);
  const [countRows] = await db.query<CountRow[]>(
    'SELECT COUNT(*) AS total FROM clinic_expenses WHERE organization_id = ?',
    [input.organizationId],
  );
  const [rows] = await db.query<ExpenseRow[]>(
    `SELECT id, category, amount_cents, currency, expense_date, note, created_at, updated_at
     FROM clinic_expenses WHERE organization_id = ?
     ORDER BY expense_date DESC, id DESC LIMIT ? OFFSET ?`,
    [input.organizationId, limit, offset],
  );
  return {
    expenses: rows.map(expenseDto),
    total: asNumber(countRows[0]?.total),
    limit,
    offset,
  };
}

export async function createClinicExpense(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; actorId: number; body: unknown },
): Promise<Record<string, unknown>> {
  const body = requireObject(input.body);
  const category = requireString(body.category, 'category', { min: 1, max: 80 });
  const amountCents = parseCents(body.amountCents, 'amountCents', { allowZero: false });
  const expenseDate = parseDateOnly(body.expenseDate, 'expenseDate');
  const note = optionalText(body.note, 'note', 500);
  const settings = mapSettings(await readSettingsRow(db, input.organizationId));
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO clinic_expenses (organization_id, category, amount_cents, currency, expense_date, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.organizationId, category, amountCents, settings.currency, expenseDate, note, input.actorId],
  );
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'clinic_expense_created',
    detail: `id=${result.insertId} amountCents=${amountCents}`,
  });
  const [rows] = await db.query<ExpenseRow[]>(
    `SELECT id, category, amount_cents, currency, expense_date, note, created_at, updated_at
     FROM clinic_expenses WHERE id = ? AND organization_id = ?`,
    [result.insertId, input.organizationId],
  );
  return { expense: expenseDto(rows[0] as ExpenseRow) };
}

export async function updateClinicExpense(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; expenseId: number; actorId: number; body: unknown },
): Promise<Record<string, unknown>> {
  const body = requireObject(input.body);
  const [existingRows] = await db.query<ExpenseRow[]>(
    `SELECT id, category, amount_cents, currency, expense_date, note, created_at, updated_at
     FROM clinic_expenses WHERE id = ? AND organization_id = ?`,
    [input.expenseId, input.organizationId],
  );
  const existing = existingRows[0];
  if (existing === undefined) {
    throw new AppError('Expense not found', 404, 'not_found', true);
  }
  const category = body.category === undefined ? existing.category : requireString(body.category, 'category', { min: 1, max: 80 });
  const amountCents =
    body.amountCents === undefined
      ? asNumber(existing.amount_cents)
      : parseCents(body.amountCents, 'amountCents', { allowZero: false });
  const expenseDate =
    body.expenseDate === undefined ? dayOf(existing.expense_date) : parseDateOnly(body.expenseDate, 'expenseDate');
  const note = body.note === undefined ? existing.note : optionalText(body.note, 'note', 500);
  await db.query(
    `UPDATE clinic_expenses SET category = ?, amount_cents = ?, expense_date = ?, note = ?
     WHERE id = ? AND organization_id = ?`,
    [category, amountCents, expenseDate, note, input.expenseId, input.organizationId],
  );
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'clinic_expense_updated',
    detail: `id=${input.expenseId}`,
  });
  const [rows] = await db.query<ExpenseRow[]>(
    `SELECT id, category, amount_cents, currency, expense_date, note, created_at, updated_at
     FROM clinic_expenses WHERE id = ? AND organization_id = ?`,
    [input.expenseId, input.organizationId],
  );
  return { expense: expenseDto(rows[0] as ExpenseRow) };
}

export async function deleteClinicExpense(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; expenseId: number; actorId: number },
): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    'DELETE FROM clinic_expenses WHERE id = ? AND organization_id = ?',
    [input.expenseId, input.organizationId],
  );
  if (result.affectedRows === 0) return false;
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'clinic_expense_deleted',
    detail: `id=${input.expenseId}`,
  });
  return true;
}

interface MoneyBucket {
  start: string;
  revenueCents: number;
  paymentsCollectedCents: number;
  refundsCents: number;
  netCollectedCents: number;
  outstandingCents: number;
  expensesCents: number;
  profitCents: number;
  appointments: AppointmentCounts;
}

function blankBucket(start: string): MoneyBucket {
  return {
    start,
    revenueCents: 0,
    paymentsCollectedCents: 0,
    refundsCents: 0,
    netCollectedCents: 0,
    outstandingCents: 0,
    expensesCents: 0,
    profitCents: 0,
    appointments: emptyAppointmentCounts(),
  };
}

function bucketDto(bucket: MoneyBucket): Record<string, unknown> {
  return {
    start: bucket.start,
    revenueCents: bucket.revenueCents,
    paymentsCollectedCents: bucket.paymentsCollectedCents,
    refundsCents: bucket.refundsCents,
    netCollectedCents: bucket.netCollectedCents,
    outstandingCents: bucket.outstandingCents,
    expensesCents: bucket.expensesCents,
    profitCents: bucket.profitCents,
    appointments: bucket.appointments.counted,
    noShows: bucket.appointments.noShows,
    noShowRate: bucket.appointments.noShowRate,
    appointmentCounts: {
      SCHEDULED: bucket.appointments.SCHEDULED,
      CONFIRMED: bucket.appointments.CONFIRMED,
      COMPLETED: bucket.appointments.COMPLETED,
      NO_SHOW: bucket.appointments.NO_SHOW,
      CANCELLED: bucket.appointments.CANCELLED,
      RESCHEDULED: bucket.appointments.RESCHEDULED,
    },
  };
}

export interface PatientBillingReport {
  window: { from: string; to: string; groupBy: ReportGroup };
  currency: PatientCurrency;
  basis: string;
  summary: Record<string, unknown>;
  buckets: Record<string, unknown>[];
  excluded: Array<{ currency: string; revenueCents: number; paymentsCollectedCents: number; refundsCents: number; expensesCents: number }>;
  definitions: { basis: string };
}

async function buildReport(
  db: Pool,
  organizationId: number,
  from: string,
  to: string,
  groupBy: ReportGroup,
): Promise<{ report: PatientBillingReport; buckets: MoneyBucket[] }> {
  assertReportWindow(from, to);
  const settings = settingsDto(await readSettingsRow(db, organizationId));
  const currency = settings.currency;
  const keys = enumerateBuckets(from, to, groupBy);
  const buckets = new Map<string, MoneyBucket>(keys.map((key) => [key, blankBucket(key)]));
  const excluded = new Map<string, { currency: string; revenueCents: number; paymentsCollectedCents: number; refundsCents: number; expensesCents: number }>();

  const touchExcluded = (code: string) => {
    const existing = excluded.get(code);
    if (existing !== undefined) return existing;
    const created = { currency: code, revenueCents: 0, paymentsCollectedCents: 0, refundsCents: 0, expensesCents: 0 };
    excluded.set(code, created);
    return created;
  };

  const [revenueRows] = await db.query<DatedAmountRow[]>(
    `SELECT DATE(i.issued_at) AS day, i.total_cents AS amount_cents, i.currency,
        COALESCE((SELECT SUM(pp.amount_cents) FROM patient_payments pp WHERE pp.invoice_id = i.id), 0) AS paid_cents
     FROM patient_invoices i
     WHERE i.organization_id = ?
       AND i.status NOT IN ('draft', 'void')
       AND i.issued_at IS NOT NULL
       AND DATE(i.issued_at) BETWEEN ? AND ?`,
    [organizationId, from, to],
  );
  for (const row of revenueRows) {
    const amount = asNumber(row.amount_cents);
    const paid = asNumber(row.paid_cents);
    if (row.currency !== currency) {
      touchExcluded(row.currency).revenueCents += amount;
      continue;
    }
    const bucket = buckets.get(bucketKey(dayOf(row.day), groupBy));
    if (bucket === undefined) continue;
    bucket.revenueCents += amount;
    bucket.outstandingCents += Math.max(0, amount - paid);
  }

  const [paymentRows] = await db.query<DatedAmountRow[]>(
    `SELECT pp.paid_on AS day, pp.amount_cents, i.currency
     FROM patient_payments pp
     JOIN patient_invoices i ON i.id = pp.invoice_id
     WHERE pp.organization_id = ? AND pp.paid_on BETWEEN ? AND ?`,
    [organizationId, from, to],
  );
  for (const row of paymentRows) {
    const amount = asNumber(row.amount_cents);
    if (row.currency !== currency) {
      const slot = touchExcluded(row.currency);
      if (amount >= 0) slot.paymentsCollectedCents += amount;
      else slot.refundsCents += -amount;
      continue;
    }
    const bucket = buckets.get(bucketKey(dayOf(row.day), groupBy));
    if (bucket === undefined) continue;
    if (amount >= 0) bucket.paymentsCollectedCents += amount;
    else bucket.refundsCents += -amount;
  }

  const [expenseRows] = await db.query<DatedAmountRow[]>(
    `SELECT expense_date AS day, amount_cents, currency
     FROM clinic_expenses
     WHERE organization_id = ? AND expense_date BETWEEN ? AND ?`,
    [organizationId, from, to],
  );
  for (const row of expenseRows) {
    const amount = asNumber(row.amount_cents);
    if (row.currency !== currency) {
      touchExcluded(row.currency).expensesCents += amount;
      continue;
    }
    const bucket = buckets.get(bucketKey(dayOf(row.day), groupBy));
    if (bucket === undefined) continue;
    bucket.expensesCents += amount;
  }

  const [appointmentRows] = await db.query<AppointmentCountRow[]>(
    `SELECT appointment_date AS day, status, COUNT(*) AS n
     FROM appointments
     WHERE organization_id = ? AND appointment_date BETWEEN ? AND ?
     GROUP BY appointment_date, status`,
    [organizationId, from, to],
  );
  for (const row of appointmentRows) {
    const bucket = buckets.get(bucketKey(dayOf(row.day), groupBy));
    if (bucket === undefined) continue;
    addAppointmentStatus(bucket.appointments, row.status, asNumber(row.n));
  }

  const ordered = [...buckets.values()];
  for (const bucket of ordered) {
    bucket.netCollectedCents = bucket.paymentsCollectedCents - bucket.refundsCents;
    bucket.profitCents = bucket.revenueCents - bucket.expensesCents;
  }

  const summaryCounts = emptyAppointmentCounts();
  for (const bucket of ordered) {
    for (const status of APPOINTMENT_COUNT_STATUSES) {
      addAppointmentStatus(summaryCounts, status, bucket.appointments[status]);
    }
  }
  summaryCounts.noShowRate = noShowRate(summaryCounts.noShows, summaryCounts.counted);

  const [outstandingRows] = await db.query<SumRow[]>(
    `SELECT COALESCE(SUM(i.total_cents), 0) AS invoiced_cents,
        COALESCE((
          SELECT SUM(pp.amount_cents)
          FROM patient_payments pp
          JOIN patient_invoices i2 ON i2.id = pp.invoice_id
          WHERE i2.organization_id = ? AND i2.currency = ? AND i2.status NOT IN ('draft', 'void')
        ), 0) AS paid_cents
     FROM patient_invoices i
     WHERE i.organization_id = ? AND i.currency = ? AND i.status NOT IN ('draft', 'void')`,
    [organizationId, currency, organizationId, currency],
  );
  const openInvoiced = asNumber(outstandingRows[0]?.invoiced_cents);
  const openPaid = asNumber(outstandingRows[0]?.paid_cents);

  const summary = ordered.reduce(
    (sum, bucket) => ({
      revenueCents: sum.revenueCents + bucket.revenueCents,
      paymentsCollectedCents: sum.paymentsCollectedCents + bucket.paymentsCollectedCents,
      refundsCents: sum.refundsCents + bucket.refundsCents,
      netCollectedCents: sum.netCollectedCents + bucket.netCollectedCents,
      expensesCents: sum.expensesCents + bucket.expensesCents,
      profitCents: sum.profitCents + bucket.profitCents,
    }),
    {
      revenueCents: 0,
      paymentsCollectedCents: 0,
      refundsCents: 0,
      netCollectedCents: 0,
      expensesCents: 0,
      profitCents: 0,
    },
  );

  const report: PatientBillingReport = {
    window: { from, to, groupBy },
    currency,
    basis: REPORT_BASIS,
    summary: {
      ...summary,
      outstandingCents: openInvoiced - openPaid,
      appointments: summaryCounts.counted,
      noShows: summaryCounts.noShows,
      noShowRate: summaryCounts.noShowRate,
      appointmentCounts: {
        SCHEDULED: summaryCounts.SCHEDULED,
        CONFIRMED: summaryCounts.CONFIRMED,
        COMPLETED: summaryCounts.COMPLETED,
        NO_SHOW: summaryCounts.NO_SHOW,
        CANCELLED: summaryCounts.CANCELLED,
        RESCHEDULED: summaryCounts.RESCHEDULED,
      },
    },
    buckets: ordered.map(bucketDto),
    excluded: [...excluded.values()],
    definitions: { basis: REPORT_BASIS },
  };
  return { report, buckets: ordered };
}

function parseReportQuery(query: Record<string, unknown>): { from: string; to: string; groupBy: ReportGroup } {
  const from = parseDateOnly(query.from, 'from');
  const to = parseDateOnly(query.to, 'to');
  const groupBy = requireChoice(
    query.groupBy === undefined ? 'day' : query.groupBy,
    REPORT_GROUPS,
    'groupBy',
  ) as ReportGroup;
  assertReportWindow(from, to);
  return { from, to, groupBy };
}

export async function getPatientBillingReport(
  db: Pool,
  organizationId: number,
  query: Record<string, unknown>,
): Promise<PatientBillingReport> {
  const window = parseReportQuery(query);
  const built = await buildReport(db, organizationId, window.from, window.to, window.groupBy);
  return built.report;
}

export async function patientBillingReportCsv(
  db: Pool,
  organizationId: number,
  query: Record<string, unknown>,
): Promise<string> {
  const window = parseReportQuery(query);
  const built = await buildReport(db, organizationId, window.from, window.to, window.groupBy);
  const rows: Array<Array<string | number | null>> = [[...REPORT_CSV_HEADER]];
  for (const bucket of built.buckets) {
    rows.push([
      bucket.start,
      bucket.revenueCents,
      bucket.paymentsCollectedCents,
      bucket.refundsCents,
      bucket.netCollectedCents,
      bucket.outstandingCents,
      bucket.expensesCents,
      bucket.profitCents,
      bucket.appointments.SCHEDULED,
      bucket.appointments.CONFIRMED,
      bucket.appointments.COMPLETED,
      bucket.appointments.NO_SHOW,
      bucket.appointments.CANCELLED,
      bucket.appointments.RESCHEDULED,
      bucket.appointments.noShowRate,
    ]);
  }
  return toCsv(rows);
}
