import { expect, type Page } from '@playwright/test';

export interface E2EUser {
  email: string;
  password: string;
}

export const OWNER: E2EUser = {
  email: 'e2e-owner@e2e.test',
  password: 'OwnerPass123!',
};

export const DESK: E2EUser = {
  email: 'e2e-desk@e2e.test',
  password: 'DeskPass123!',
};

export async function login(page: Page, user: E2EUser, landing: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(landing);
}

export async function openNav(page: Page, label: string): Promise<void> {
  await page.getByRole('link', { name: label, exact: true }).click();
}

export async function bookPrefilledAppointment(
  page: Page,
  opts: { date: string; time: string; service: string },
): Promise<void> {
  const patientSelect = page.getByLabel('Patient *', { exact: true });
  await expect(patientSelect).toBeVisible();
  await patientSelect.selectOption({ index: 1 });
  await page.getByLabel('Date *', { exact: true }).fill(opts.date);
  await page.getByLabel('Time *', { exact: true }).fill(opts.time);
  await page.getByLabel('Service', { exact: true }).fill(opts.service);
  await page.getByRole('button', { name: 'Book appointment', exact: true }).click();
  await expect(page.getByText('Appointment booked.')).toBeVisible();
}
