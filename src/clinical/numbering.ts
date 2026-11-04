import type { Pool } from 'mysql2/promise';
import { loadOrgSetting } from '../db/orgMeta';
import { requireChoice } from '../validate';
import type { ChartNumbering } from './teeth';

export const CHART_NUMBERING_META_KEY = 'chart_numbering';

export function parseChartNumbering(value: unknown): ChartNumbering {
  return requireChoice(value, ['FDI', 'UNIVERSAL'], 'chartNumbering') as ChartNumbering;
}

export async function loadChartNumbering(db: Pool, organizationId: number): Promise<ChartNumbering> {
  const raw = await loadOrgSetting(db, organizationId, CHART_NUMBERING_META_KEY);
  if (raw === null || raw === '') {
    return 'FDI';
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === 'FDI' || parsed === 'UNIVERSAL') {
      return parsed;
    }
  } catch {
    if (raw === 'FDI' || raw === 'UNIVERSAL') {
      return raw;
    }
  }
  return 'FDI';
}

export async function saveChartNumbering(
  db: Pool,
  organizationId: number,
  numbering: ChartNumbering,
): Promise<void> {
  await db.query(
    `INSERT INTO organization_settings (organization_id, meta_key, meta_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
    [organizationId, CHART_NUMBERING_META_KEY, JSON.stringify(numbering)],
  );
}
