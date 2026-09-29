import type { Pool, RowDataPacket } from 'mysql2/promise';

export async function loadOrgSetting(
  db: Pool,
  organizationId: number,
  metaKey: string,
): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM organization_settings WHERE organization_id = ? AND meta_key = ?',
    [organizationId, metaKey],
  );
  const value = rows[0]?.meta_value;
  return typeof value === 'string' ? value : null;
}

export interface OrgEnabledFilter {
  eligible: boolean;
  clause: string;
  params: number[];
}

export async function loadOrgEnabledFilter(
  db: Pool,
  metaKey: string,
  globalEnabled: boolean,
  columnRef: string,
): Promise<OrgEnabledFilter> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT organization_id, meta_value FROM organization_settings WHERE meta_key = ?',
    [metaKey],
  );
  const explicitlyEnabled: number[] = [];
  const explicitlyDisabled: number[] = [];
  for (const row of rows) {
    const orgId = row.organization_id;
    if (typeof orgId !== 'number') {
      continue;
    }
    let enabled: unknown = null;
    try {
      const parsed: unknown = JSON.parse(String(row.meta_value));
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        enabled = (parsed as Record<string, unknown>).enabled ?? null;
      }
    } catch {
      enabled = null;
    }
    if (enabled === true) {
      explicitlyEnabled.push(orgId);
    } else if (enabled === false) {
      explicitlyDisabled.push(orgId);
    }
  }
  if (globalEnabled) {
    if (explicitlyDisabled.length === 0) {
      return { eligible: true, clause: '', params: [] };
    }
    return {
      eligible: true,
      clause: ` AND ${columnRef} NOT IN (?)`,
      params: explicitlyDisabled,
    };
  }
  if (explicitlyEnabled.length === 0) {
    return { eligible: false, clause: '', params: [] };
  }
  return { eligible: true, clause: ` AND ${columnRef} IN (?)`, params: explicitlyEnabled };
}
