import type { Pool, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import type { Logger } from '../logger';
import { classifyImportRows, type ImportPreview } from './patientImport';

interface ContactRow extends RowDataPacket {
  phone: string;
  email: string | null;
}

async function existingContacts(
  db: Pool,
  organizationId: number,
): Promise<{ phones: string[]; emails: string[] }> {
  const [rows] = await db.query<ContactRow[]>(
    'SELECT phone, email FROM patients WHERE organization_id = ?',
    [organizationId],
  );
  return {
    phones: rows.map((row) => row.phone),
    emails: rows.flatMap((row) => (row.email === null || row.email === '' ? [] : [row.email])),
  };
}

function readCsvBody(body: Record<string, unknown>): { csv: string; mapping: unknown } {
  return { csv: typeof body.csv === 'string' ? body.csv : '', mapping: body.mapping };
}

export async function previewPatientImport(
  db: Pool,
  organizationId: number,
  body: Record<string, unknown>,
): Promise<ImportPreview> {
  const contacts = await existingContacts(db, organizationId);
  const parsed = readCsvBody(body);
  return classifyImportRows({
    csv: parsed.csv,
    mapping: parsed.mapping,
    existingPhones: contacts.phones,
    existingEmails: contacts.emails,
  });
}

export async function commitPatientImport(
  db: Pool,
  logger: Logger,
  input: { organizationId: number; actorId: number; body: Record<string, unknown> },
): Promise<{ imported: number; skipped: number; preview: ImportPreview }> {
  const preview = await previewPatientImport(db, input.organizationId, input.body);
  const ready = preview.rows.filter((row) => row.status === 'ready');
  let imported = 0;
  let skipped = preview.rows.length - ready.length;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const row of ready) {
      if (row.firstName === null || row.lastName === null || row.phone === null) {
        skipped += 1;
        continue;
      }
      try {
        await connection.query('SAVEPOINT patient_row');
        await connection.query(
          `INSERT INTO patients
             (organization_id, first_name, last_name, phone, email, date_of_birth, notes, sms_opt_out, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [
            input.organizationId,
            row.firstName,
            row.lastName,
            row.phone,
            row.email,
            row.dateOfBirth,
            row.notes,
            input.actorId,
          ],
        );
        imported += 1;
      } catch (err) {
        await connection.query('ROLLBACK TO SAVEPOINT patient_row');
        if (err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY') {
          skipped += 1;
          continue;
        }
        throw err;
      }
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  if (imported > 0) {
    await recordAudit(db, logger, {
      organizationId: input.organizationId,
      userId: input.actorId,
      action: 'patients_imported',
      detail: `imported=${imported} skipped=${skipped}`,
    });
    logger.info('patients imported', { organizationId: input.organizationId, imported, skipped });
  }
  return { imported, skipped, preview };
}
