import { expect, test } from '@playwright/test';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, testDbConfig } from './db';
import { login, OWNER } from './helpers';
import { E2E_ORG_NAME } from './seed';
import { hashPassword } from '../../src/auth/password';

const ADMIN = { email: 'e2e-admin@e2e.test', password: 'AdminPass123!' };

async function orgIdOf(pool: Pool): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM organizations WHERE name = ?',
    [E2E_ORG_NAME],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`seeded org not found: ${E2E_ORG_NAME}`);
  }
  return Number(row.id);
}

test.describe('S1c trial lock', () => {
  let pool: Pool;
  let orgId: number;

  test.beforeAll(async () => {
    pool = createTestPool(testDbConfig());
    orgId = await orgIdOf(pool);
    await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)', [
      ADMIN.email,
    ]);
    await pool.query('DELETE FROM users WHERE email = ?', [ADMIN.email]);
    const hash = await hashPassword(ADMIN.password);
    await pool.query(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (NULL, ?, ?, ?)',
      [ADMIN.email, hash, 'admin'],
    );
    await pool.query(
      "UPDATE organizations SET plan = 'trial', trial_ends_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE id = ?",
      [orgId],
    );
  });

  test.afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)', [
      ADMIN.email,
    ]);
    await pool.query('DELETE FROM users WHERE email = ?', [ADMIN.email]);
    await pool.query(
      "UPDATE organizations SET plan = 'full', trial_ends_at = NULL WHERE id = ?",
      [orgId],
    );
    await pool.end();
  });

  test('expired trial shows the read-only banner and blocks writes', async ({ page }) => {
    await login(page, OWNER, '**/dashboard');
    await expect(page.getByText(/Free trial ended/)).toBeVisible();

    const read = await page.request.get(`/api/organizations/${orgId}/settings`);
    expect(read.status()).toBe(200);

    const blocked = await page.request.post(`/api/organizations/${orgId}/leads`, {
      data: {
        firstName: 'Blocked',
        lastName: 'Lead',
        phone: '+15550999991',
        source: 'MANUAL',
      },
    });
    expect(blocked.status()).toBe(403);
    const body = (await blocked.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('trial_expired');
  });

  test('platform admin activates the expired trial from the trials screen', async ({ page }) => {
    await login(page, ADMIN, '**/dashboard');
    await page.goto('/admin/trials');
    await expect(page.getByRole('heading', { name: 'Trial clinics' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: E2E_ORG_NAME });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByText(`${E2E_ORG_NAME} is now on the Full Plan.`)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: E2E_ORG_NAME })).toHaveCount(0);
  });

  test('writes work again after activation', async ({ page }) => {
    await login(page, OWNER, '**/dashboard');
    await expect(page.getByText(/Free trial ended/)).toHaveCount(0);

    const created = await page.request.post(`/api/organizations/${orgId}/leads`, {
      data: {
        firstName: 'Reactivated',
        lastName: 'Lead',
        phone: '+15550999992',
        source: 'MANUAL',
      },
    });
    expect(created.status()).toBe(201);
  });
});
