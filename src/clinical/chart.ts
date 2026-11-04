import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import { requireChoice, requireString } from '../validate';
import { loadChartNumbering } from './numbering';
import {
  conditionCatalog,
  isPermanentFdi,
  isToothCondition,
  type ToothConditionCode,
} from './teeth';

export const TREATMENT_STATUSES = ['PLANNED', 'DONE'] as const;

const NOTES_MAX = 2000;

interface ToothRow extends RowDataPacket {
  tooth_fdi: string;
  conditions: unknown;
  notes: string | null;
  updated_at: Date;
  updated_by: number | null;
  author_email: string | null;
}

interface HistoryRow extends RowDataPacket {
  id: number;
  tooth_fdi: string;
  conditions: unknown;
  notes: string | null;
  created_at: Date;
  author_user_id: number | null;
  author_email: string | null;
}

interface PlanRow extends RowDataPacket {
  id: number;
  tooth_fdi: string;
  procedure_name: string;
  status: string;
  estimated_fee: string | number | null;
  created_at: Date;
  updated_at: Date;
  created_by: number | null;
  author_email: string | null;
}

function authorDto(id: number | null, email: string | null): { id: number; email: string } | null {
  if (id === null || email === null || email === '') {
    return null;
  }
  return { id, email };
}

export function readConditionCodes(value: unknown): ToothConditionCode[] {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const codes: ToothConditionCode[] = [];
  for (const item of parsed) {
    if (typeof item === 'string' && isToothCondition(item) && !codes.includes(item)) {
      codes.push(item);
    }
  }
  return codes.sort();
}

function parseConditions(value: unknown): ToothConditionCode[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('Invalid input', ['conditions must be an array of condition codes']);
  }
  if (value.length > conditionCatalog().length) {
    throw new ValidationError('Invalid input', ['conditions has too many entries']);
  }
  const codes: ToothConditionCode[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !isToothCondition(item)) {
      throw new ValidationError('Invalid input', [
        `conditions must be one of: ${conditionCatalog().map((entry) => entry.code).join(', ')}`,
      ]);
    }
    if (!codes.includes(item)) {
      codes.push(item);
    }
  }
  return codes.sort();
}

function parseNotes(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ValidationError('Invalid input', ['notes must be a string']);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > NOTES_MAX) {
    throw new ValidationError('Invalid input', [`notes must be at most ${NOTES_MAX} characters`]);
  }
  return trimmed;
}

export function parseEstimatedFee(value: unknown, name = 'estimatedFee'): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new ValidationError('Invalid input', [`${name} must be a number`]);
  }
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) {
    throw new ValidationError('Invalid input', [
      `${name} must be a non-negative amount with up to 2 decimal places`,
    ]);
  }
  const [whole, frac = ''] = text.split('.');
  return `${whole}.${frac.padEnd(2, '0')}`;
}

function feeDto(value: string | number | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    if (/^\d+\.\d{2}$/.test(value)) {
      return value;
    }
    if (/^\d+(\.\d+)?$/.test(value)) {
      return Number(value).toFixed(2);
    }
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  return null;
}

function sameConditions(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((code, index) => code === right[index]);
}

function requireTooth(value: unknown, name = 'tooth'): string {
  const tooth = requireString(value, name, { min: 2, max: 2 });
  if (!isPermanentFdi(tooth)) {
    throw new ValidationError('Invalid input', [
      `${name} must be a permanent FDI tooth number (11-18, 21-28, 31-38, 41-48)`,
    ]);
  }
  return tooth;
}

async function assertPatient(db: Pool | PoolConnection, organizationId: number, patientId: number): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id FROM patients WHERE id = ? AND organization_id = ?',
    [patientId, organizationId],
  );
  if (rows[0] === undefined) {
    throw new AppError('Patient not found', 404, 'not_found', true);
  }
}

function toothDto(row: ToothRow): Record<string, unknown> {
  return {
    tooth: row.tooth_fdi,
    conditions: readConditionCodes(row.conditions),
    notes: row.notes,
    updatedAt: row.updated_at,
    updatedBy: authorDto(row.updated_by, row.author_email),
  };
}

function historyDto(row: HistoryRow): Record<string, unknown> {
  return {
    id: row.id,
    tooth: row.tooth_fdi,
    conditions: readConditionCodes(row.conditions),
    notes: row.notes,
    createdAt: row.created_at,
    author: authorDto(row.author_user_id, row.author_email),
  };
}

function planDto(row: PlanRow): Record<string, unknown> {
  return {
    id: row.id,
    tooth: row.tooth_fdi,
    procedure: row.procedure_name,
    status: row.status,
    estimatedFee: feeDto(row.estimated_fee),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: authorDto(row.created_by, row.author_email),
  };
}

export async function getPatientChart(
  db: Pool,
  organizationId: number,
  patientId: number,
): Promise<Record<string, unknown>> {
  await assertPatient(db, organizationId, patientId);
  const numbering = await loadChartNumbering(db, organizationId);
  const [teeth] = await db.query<ToothRow[]>(
    `SELECT t.tooth_fdi, t.conditions, t.notes, t.updated_at, t.updated_by, u.email AS author_email
     FROM patient_teeth t
     LEFT JOIN users u ON u.id = t.updated_by
     WHERE t.organization_id = ? AND t.patient_id = ?
     ORDER BY t.tooth_fdi ASC`,
    [organizationId, patientId],
  );
  const [history] = await db.query<HistoryRow[]>(
    `SELECT h.id, h.tooth_fdi, h.conditions, h.notes, h.created_at, h.author_user_id, u.email AS author_email
     FROM patient_tooth_history h
     LEFT JOIN users u ON u.id = h.author_user_id
     WHERE h.organization_id = ? AND h.patient_id = ?
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT 100`,
    [organizationId, patientId],
  );
  const [plan] = await db.query<PlanRow[]>(
    `SELECT i.id, i.tooth_fdi, i.procedure_name, i.status, i.estimated_fee, i.created_at, i.updated_at,
            i.created_by, u.email AS author_email
     FROM treatment_plan_items i
     LEFT JOIN users u ON u.id = i.created_by
     WHERE i.organization_id = ? AND i.patient_id = ?
     ORDER BY CASE i.status WHEN 'PLANNED' THEN 0 ELSE 1 END, i.id ASC`,
    [organizationId, patientId],
  );
  return {
    numbering,
    conditions: conditionCatalog(),
    teeth: teeth.map(toothDto),
    history: history.map(historyDto),
    treatmentPlan: plan.map(planDto),
  };
}

export async function saveToothChart(
  db: Pool,
  logger: Logger,
  input: {
    organizationId: number;
    patientId: number;
    actorId: number;
    tooth: string;
    body: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  await assertPatient(db, input.organizationId, input.patientId);
  const tooth = requireTooth(input.tooth);
  if (input.body.conditions === undefined) {
    throw new ValidationError('Invalid input', ['conditions is required']);
  }
  const conditions = parseConditions(input.body.conditions);
  const notes = parseNotes(input.body.notes);
  const extra = Object.keys(input.body).filter((key) => key !== 'conditions' && key !== 'notes');
  if (extra.length > 0) {
    throw new ValidationError('Invalid input', [`unknown field: ${extra[0] ?? 'body'}`]);
  }

  const connection = await db.getConnection();
  let unchanged = false;
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.query<ToothRow[]>(
      `SELECT tooth_fdi, conditions, notes, updated_at, updated_by, NULL AS author_email
       FROM patient_teeth
       WHERE organization_id = ? AND patient_id = ? AND tooth_fdi = ?
       FOR UPDATE`,
      [input.organizationId, input.patientId, tooth],
    );
    const existing = existingRows[0];
    if (
      existing !== undefined &&
      sameConditions(readConditionCodes(existing.conditions), conditions) &&
      (existing.notes ?? null) === notes
    ) {
      unchanged = true;
    } else {
      const stored = JSON.stringify(conditions);
      await connection.query(
        `INSERT INTO patient_teeth (organization_id, patient_id, tooth_fdi, conditions, notes, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           conditions = VALUES(conditions),
           notes = VALUES(notes),
           updated_by = VALUES(updated_by)`,
        [input.organizationId, input.patientId, tooth, stored, notes, input.actorId],
      );
      await connection.query(
        `INSERT INTO patient_tooth_history
           (organization_id, patient_id, tooth_fdi, conditions, notes, author_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.organizationId, input.patientId, tooth, stored, notes, input.actorId],
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  if (!unchanged) {
    await recordAudit(db, logger, {
      organizationId: input.organizationId,
      userId: input.actorId,
      action: 'tooth_chart_updated',
      detail: `patient=${input.patientId} tooth=${tooth} conditions=${conditions.join(',') || 'none'}`.slice(0, 255),
    });
  }

  const chart = await getPatientChart(db, input.organizationId, input.patientId);
  const teeth = chart.teeth as Array<Record<string, unknown>>;
  const saved = teeth.find((item) => item.tooth === tooth) ?? {
    tooth,
    conditions,
    notes,
    updatedAt: null,
    updatedBy: null,
  };
  return { tooth: saved, unchanged };
}

async function loadPlanItem(
  db: Pool,
  organizationId: number,
  patientId: number,
  itemId: number,
): Promise<PlanRow | null> {
  const [rows] = await db.query<PlanRow[]>(
    `SELECT i.id, i.tooth_fdi, i.procedure_name, i.status, i.estimated_fee, i.created_at, i.updated_at,
            i.created_by, u.email AS author_email
     FROM treatment_plan_items i
     LEFT JOIN users u ON u.id = i.created_by
     WHERE i.id = ? AND i.organization_id = ? AND i.patient_id = ?`,
    [itemId, organizationId, patientId],
  );
  return rows[0] ?? null;
}

export async function createTreatmentPlanItem(
  db: Pool,
  logger: Logger,
  input: {
    organizationId: number;
    patientId: number;
    actorId: number;
    body: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  await assertPatient(db, input.organizationId, input.patientId);
  const allowed = ['tooth', 'procedure', 'status', 'estimatedFee'];
  for (const key of Object.keys(input.body)) {
    if (!allowed.includes(key)) {
      throw new ValidationError('Invalid input', [`unknown field: ${key}`]);
    }
  }
  const tooth = requireTooth(input.body.tooth);
  const procedure = requireString(input.body.procedure, 'procedure', { min: 1, max: 160 });
  const status =
    input.body.status === undefined
      ? 'PLANNED'
      : requireChoice(input.body.status, TREATMENT_STATUSES, 'status');
  const estimatedFee = parseEstimatedFee(input.body.estimatedFee);
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO treatment_plan_items
       (organization_id, patient_id, tooth_fdi, procedure_name, status, estimated_fee, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.organizationId, input.patientId, tooth, procedure, status, estimatedFee, input.actorId],
  );
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'treatment_plan_created',
    detail: `patient=${input.patientId} item=${result.insertId} tooth=${tooth} status=${status}`.slice(0, 255),
  });
  const row = await loadPlanItem(db, input.organizationId, input.patientId, result.insertId);
  return { item: planDto(row as PlanRow) };
}

export async function updateTreatmentPlanItem(
  db: Pool,
  logger: Logger,
  input: {
    organizationId: number;
    patientId: number;
    itemId: number;
    actorId: number;
    body: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  await assertPatient(db, input.organizationId, input.patientId);
  const existing = await loadPlanItem(db, input.organizationId, input.patientId, input.itemId);
  if (existing === null) {
    throw new AppError('Treatment plan item not found', 404, 'not_found', true);
  }
  const allowed = ['tooth', 'procedure', 'status', 'estimatedFee'];
  const provided = Object.keys(input.body);
  if (provided.length === 0) {
    throw new ValidationError('Invalid input', ['at least one field to update is required']);
  }
  for (const key of provided) {
    if (!allowed.includes(key)) {
      throw new ValidationError('Invalid input', [`unknown field: ${key}`]);
    }
  }
  const tooth = input.body.tooth === undefined ? existing.tooth_fdi : requireTooth(input.body.tooth);
  const procedure =
    input.body.procedure === undefined
      ? existing.procedure_name
      : requireString(input.body.procedure, 'procedure', { min: 1, max: 160 });
  const status =
    input.body.status === undefined
      ? existing.status
      : requireChoice(input.body.status, TREATMENT_STATUSES, 'status');
  const estimatedFee =
    input.body.estimatedFee === undefined
      ? feeDto(existing.estimated_fee)
      : parseEstimatedFee(input.body.estimatedFee);
  await db.query(
    `UPDATE treatment_plan_items
     SET tooth_fdi = ?, procedure_name = ?, status = ?, estimated_fee = ?
     WHERE id = ? AND organization_id = ? AND patient_id = ?`,
    [tooth, procedure, status, estimatedFee, input.itemId, input.organizationId, input.patientId],
  );
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'treatment_plan_updated',
    detail: `patient=${input.patientId} item=${input.itemId} tooth=${tooth} status=${status}`.slice(0, 255),
  });
  const row = await loadPlanItem(db, input.organizationId, input.patientId, input.itemId);
  return { item: planDto(row as PlanRow) };
}

export async function deleteTreatmentPlanItem(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; patientId: number; itemId: number; actorId: number },
): Promise<boolean> {
  await assertPatient(db, input.organizationId, input.patientId);
  const [result] = await db.query<ResultSetHeader>(
    'DELETE FROM treatment_plan_items WHERE id = ? AND organization_id = ? AND patient_id = ?',
    [input.itemId, input.organizationId, input.patientId],
  );
  if (result.affectedRows === 0) {
    return false;
  }
  await recordAudit(db, logger, {
    organizationId: input.organizationId,
    userId: input.actorId,
    action: 'treatment_plan_deleted',
    detail: `patient=${input.patientId} item=${input.itemId}`.slice(0, 255),
  });
  return true;
}
