import { expect, test } from '@playwright/test';
import { DESK, login, OWNER } from './helpers';

test('Appendix A — the owner can open all five new screens', async ({ page }) => {
  await login(page, OWNER, '**/dashboard');

  await page.goto('/appointments/calendar');
  await expect(page.getByRole('heading', { name: 'Appointment calendar' })).toBeVisible();

  await page.goto('/automations/activity');
  await expect(page.getByRole('heading', { name: 'Automation activity' })).toBeVisible();

  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();

  await page.goto('/admin/automation-failures');
  await expect(page.getByRole('heading', { name: 'Failed automation jobs' })).toBeVisible();

  await page.goto('/admin/webhooks');
  await expect(page.getByRole('heading', { name: 'Webhook activity' })).toBeVisible();
});

test('Appendix A — receptionists get the calendar but not the admin or activity screens', async ({
  page,
}) => {
  await login(page, DESK, '**/workspace');

  for (const path of [
    '/admin/audit',
    '/admin/webhooks',
    '/admin/automation-failures',
    '/automations/activity',
  ]) {
    await page.goto(path);
    await expect(page.getByText('Access denied')).toBeVisible();
  }

  await page.goto('/appointments/calendar');
  await expect(page.getByRole('heading', { name: 'Appointment calendar' })).toBeVisible();
});
