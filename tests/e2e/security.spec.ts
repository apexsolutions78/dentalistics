import { expect, test } from '@playwright/test';
import { login, OWNER } from './helpers';

test('Security — CSP is served on UI pages and blocks nothing in the app', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('Content Security Policy') || text.includes('Refused to')) {
      violations.push(text);
    }
  });

  const response = await page.goto('/login');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).not.toContain('unsafe-eval');

  await expect(page.getByRole('heading', { name: 'Apex Dentalistics' })).toBeVisible();

  await login(page, OWNER, '**/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  expect(violations).toEqual([]);
});
