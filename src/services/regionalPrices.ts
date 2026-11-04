import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../errors';
import { parseAmountMinor, parseCurrency, parseRegionCode } from '../pricing/money';
import { requireString } from '../validate';

export interface RegionalPrice {
  code: string;
  label: string;
  currency: string;
  amountMinor: number;
  placeholder: boolean;
  sortOrder: number;
}

interface PriceRow extends RowDataPacket {
  region_code: string;
  label: string;
  currency: string;
  amount_minor: number;
  is_placeholder: number;
  sort_order: number;
}

function priceDto(row: PriceRow): RegionalPrice {
  return {
    code: row.region_code,
    label: row.label,
    currency: row.currency,
    amountMinor: row.amount_minor,
    placeholder: row.is_placeholder === 1,
    sortOrder: row.sort_order,
  };
}

export async function listRegionalPrices(db: Pool): Promise<RegionalPrice[]> {
  const [rows] = await db.query<PriceRow[]>(
    `SELECT region_code, label, currency, amount_minor, is_placeholder, sort_order
     FROM regional_prices ORDER BY sort_order, region_code`,
  );
  return rows.map(priceDto);
}

export async function loadRegionalPrice(db: Pool, code: string): Promise<RegionalPrice> {
  const regionCode = parseRegionCode(code);
  const [rows] = await db.query<PriceRow[]>(
    `SELECT region_code, label, currency, amount_minor, is_placeholder, sort_order
     FROM regional_prices WHERE region_code = ?`,
    [regionCode],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Region not found', 404, 'not_found', true);
  }
  return priceDto(row);
}

export async function createRegionalPrice(
  db: Pool,
  body: Record<string, unknown>,
): Promise<RegionalPrice> {
  const code = parseRegionCode(body.code);
  const label = requireString(body.label, 'label', { min: 2, max: 80 });
  const currency = parseCurrency(body.currency);
  const amountMinor = parseAmountMinor(body.amountMinor);
  const [countRows] = await db.query<RowDataPacket[]>(
    'SELECT COALESCE(MAX(sort_order), 0) AS sort_order FROM regional_prices',
  );
  const sortOrder = Number(countRows[0]?.sort_order ?? 0) + 10;
  try {
    await db.query(
      `INSERT INTO regional_prices (region_code, label, currency, amount_minor, is_placeholder, sort_order)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [code, label, currency, amountMinor, sortOrder],
    );
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY') {
      throw new AppError('That region code already exists', 409, 'duplicate_region', true);
    }
    throw err;
  }
  return loadRegionalPrice(db, code);
}

export async function updateRegionalPrice(
  db: Pool,
  code: string,
  body: Record<string, unknown>,
): Promise<RegionalPrice> {
  const current = await loadRegionalPrice(db, code);
  const label = body.label === undefined ? current.label : requireString(body.label, 'label', { min: 2, max: 80 });
  const currency = body.currency === undefined ? current.currency : parseCurrency(body.currency);
  const amountMinor = body.amountMinor === undefined ? current.amountMinor : parseAmountMinor(body.amountMinor);
  await db.query(
    `UPDATE regional_prices
     SET label = ?, currency = ?, amount_minor = ?, is_placeholder = 0
     WHERE region_code = ?`,
    [label, currency, amountMinor, current.code],
  );
  return loadRegionalPrice(db, current.code);
}

export async function deleteRegionalPrice(db: Pool, code: string): Promise<void> {
  const current = await loadRegionalPrice(db, code);
  if (current.code === 'us') {
    throw new AppError(
      'The United States price is the default. Edit the amount instead of removing it.',
      409,
      'default_region',
      true,
    );
  }
  const [result] = await db.query<ResultSetHeader>(
    'DELETE FROM regional_prices WHERE region_code = ?',
    [current.code],
  );
  if (result.affectedRows === 0) {
    throw new AppError('Region not found', 404, 'not_found', true);
  }
}
