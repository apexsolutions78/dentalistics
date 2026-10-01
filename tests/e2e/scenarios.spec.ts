import { expect, test, type Page } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { createTestPool, testDbConfig } from './db';
import { dateOnly } from './dates';
import {
  bookPrefilledAppointment,
  DESK,
  login,
  openNav,
  OWNER,
} from './helpers';
import { P2_PHONE, P4_PHONE, P5_PHONE } from './seed';

async function openAppointmentByPatient(page: Page, patientName: string): Promise<void> {
  const row = page.getByRole('row').filter({ hasText: patientName });
  await row.getByRole('link', { name: 'Open', exact: true }).click();
  await page.waitForURL(/\/appointments\/\d+/);
}

test('Scenario 1 — New Lead', async ({ page }) => {
  await login(page, OWNER, '**/dashboard');

  await openNav(page, 'Leads');
  const row = page.getByRole('row').filter({ hasText: 'Luna Leadson' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('MANUAL');

  await row.getByRole('link', { name: 'Luna Leadson', exact: true }).click();
  await expect(page.getByText('Lead from MANUAL')).toBeVisible();

  await expect(
    page.getByRole('heading', { name: 'Contact information' }),
  ).toBeVisible();
  await expect(page.getByText('+15550710001')).toBeVisible();

  const timeline = page.locator('section.card').filter({ hasText: 'Communication timeline' });
  await expect(timeline.getByText('Thanks for reaching out to Apex Dental!')).toBeVisible();
  await expect(timeline.getByText('Great — I will book now.')).toBeVisible();

  await page.getByRole('link', { name: 'Book appointment', exact: true }).click();
  await page.waitForURL('**/appointments?**');
  await bookPrefilledAppointment(page, {
    date: dateOnly(5),
    time: '09:45',
    service: 'Whitening consult',
  });

  await openNav(page, 'Leads');
  await page
    .getByRole('row')
    .filter({ hasText: 'Luna Leadson' })
    .getByRole('link', { name: 'Luna Leadson', exact: true })
    .click();
  const appointmentsCard = page.locator('section.card').filter({ hasText: 'Appointments' });
  await expect(appointmentsCard.getByText('Whitening consult')).toBeVisible();
});

test('Scenario 2 — Missed Call', async ({ page }) => {
  await login(page, DESK, '**/workspace');

  const missed = page.locator('section.card').filter({ hasText: 'Missed calls' });
  await expect(missed.getByText(P2_PHONE)).toBeVisible();
  await missed.getByRole('link', { name: 'Open lead', exact: true }).click();
  await page.waitForURL(/\/leads\/\d+/);

  const timeline = page.locator('section.card').filter({ hasText: 'Communication timeline' });
  await expect(timeline.getByText('We missed your call — how can we help?')).toBeVisible();
  await expect(timeline.getByText('Clinic sent (automated)').first()).toBeVisible();
  await expect(timeline.getByText('Thanks, please book me in.')).toBeVisible();

  await page.getByRole('link', { name: 'Book appointment', exact: true }).click();
  await page.waitForURL('**/appointments?**');
  await bookPrefilledAppointment(page, {
    date: dateOnly(6),
    time: '16:20',
    service: 'Emergency check',
  });
});

test('Scenario 3 — Appointment confirm and reschedule', async ({ page }) => {
  await login(page, OWNER, '**/dashboard');

  await openNav(page, 'Appointments');
  await openAppointmentByPatient(page, 'Cara Confirm');
  await expect(page.getByText('SCHEDULED').first()).toBeVisible();

  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Appointment confirmed.')).toBeVisible();
  await expect(page.getByText('CONFIRMED').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);

  const automation = page.locator('section.card').filter({ hasText: 'Automation status' });
  await expect(automation.getByText('reminder', { exact: true })).toBeVisible();
  await expect(automation.getByText('PENDING', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const move = page
    .locator('section.card')
    .filter({ has: page.getByRole('heading', { name: 'Reschedule', exact: true }) });
  await move.getByLabel('New date').fill(dateOnly(9));
  await move.getByLabel('New time').fill('14:30');
  await move.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await expect(page.getByText('Appointment rescheduled.')).toBeVisible();
  await expect(page.getByText('RESCHEDULED').first()).toBeVisible();

  await openNav(page, 'Appointments');
  const oldRow = page.getByRole('row').filter({ hasText: 'Cara Confirm' }).filter({ hasText: 'RESCHEDULED' });
  await expect(oldRow).toBeVisible();
  const newRow = page
    .getByRole('row')
    .filter({ hasText: 'Cara Confirm' })
    .filter({ hasText: '14:30' });
  await expect(newRow).toContainText('SCHEDULED');
  await newRow.getByRole('link', { name: 'Open', exact: true }).click();
  await page.waitForURL(/\/appointments\/\d+/);
  await expect(page.getByText('14:30').first()).toBeVisible();
  await expect(page.getByText('Previous appointment')).toBeVisible();
});

test('Scenario 4 — No-show and recovery', async ({ page }) => {
  await login(page, OWNER, '**/dashboard');

  await openNav(page, 'Appointments');
  await openAppointmentByPatient(page, 'Nina Noshow');

  await page.getByRole('button', { name: 'Mark no-show', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Mark no-show', exact: true }).click();
  await expect(page.getByText('Appointment marked as no-show.')).toBeVisible();
  await expect(page.getByText('NO_SHOW').first()).toBeVisible();

  await openNav(page, 'Workspace');
  const noShows = page.locator('section.card').filter({ hasText: 'No-shows' });
  await expect(noShows.getByText('Nina Noshow')).toBeVisible();
  await noShows.getByRole('link', { name: 'Rebook', exact: true }).click();
  await page.waitForURL(/\/appointments\/\d+/);

  await page.getByRole('button', { name: 'Rebook', exact: true }).click();
  const move = page
    .locator('section.card')
    .filter({ has: page.getByRole('heading', { name: 'Rebook', exact: true }) });
  await move.getByLabel('New date').fill(dateOnly(7));
  await move.getByLabel('New time').fill('15:15');
  await move.getByRole('button', { name: 'Rebook', exact: true }).click();
  await expect(page.getByText('Appointment rebooked.')).toBeVisible();

  await openNav(page, 'Appointments');
  const newRow = page
    .getByRole('row')
    .filter({ hasText: 'Nina Noshow' })
    .filter({ hasText: '15:15' });
  await expect(newRow).toContainText('SCHEDULED');
  await newRow.getByRole('link', { name: 'Open', exact: true }).click();
  await page.waitForURL(/\/appointments\/\d+/);
  await expect(page.getByText('15:15').first()).toBeVisible();
  await expect(page.getByText('Previous appointment')).toBeVisible();

  const pool = createTestPool(testDbConfig());
  try {
    const [noShowRows] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.status FROM appointments a
        JOIN patients p ON p.id = a.patient_id
       WHERE p.phone = ? AND a.status = 'NO_SHOW'`,
      [P4_PHONE],
    );
    expect(noShowRows.length).toBe(1);
    const oldId = Number(noShowRows[0]?.id);

    const [caseRows] = await pool.query<RowDataPacket[]>(
      'SELECT status, close_reason, rebooked_appointment_id FROM no_show_cases WHERE appointment_id = ?',
      [oldId],
    );
    expect(caseRows.length).toBe(1);
    expect(caseRows[0]?.status).toBe('REBOOKED');
    expect(caseRows[0]?.close_reason).toBe('rebooked');

    const [rebookRows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM appointments WHERE previous_appointment_id = ? AND status = \'SCHEDULED\'',
      [oldId],
    );
    expect(rebookRows.length).toBe(1);
    expect(Number(caseRows[0]?.rebooked_appointment_id)).toBe(Number(rebookRows[0]?.id));
  } finally {
    await pool.end();
  }
});

test('Scenario 5 — Recall', async ({ page }) => {
  await login(page, OWNER, '**/dashboard');

  await openNav(page, 'Recall');
  const dueRow = page.getByRole('row').filter({ hasText: 'Rosa Recall' });
  await expect(dueRow).toContainText('DUE');

  await dueRow.getByRole('link', { name: 'Rosa Recall', exact: true }).click();
  const recallCard = page.locator('section.card').filter({ hasText: 'Recall status' });
  await expect(recallCard).toContainText('DUE');
  await expect(
    page.getByRole('heading', { name: 'Communication history' }),
  ).toBeVisible();

  await openNav(page, 'Recall');
  await page
    .getByRole('row')
    .filter({ hasText: 'Rosa Recall' })
    .getByRole('link', { name: 'Contact', exact: true })
    .click();
  await page.waitForURL('**/communications?**');
  const views = page.getByRole('button', { name: 'View', exact: true });
  await expect(views).toHaveCount(2);
  const outboundBody = page.getByText('Time for your cleaning — book now.');
  const inboundBody = page.getByText('Yes, next week works.');
  await views.first().click();
  await expect(outboundBody.or(inboundBody)).toBeVisible();
  const outboundShownFirst = await outboundBody.isVisible();
  await expect(views).toHaveCount(1);
  await views.click();
  if (outboundShownFirst) {
    await expect(inboundBody).toBeVisible();
  } else {
    await expect(outboundBody).toBeVisible();
  }

  await openNav(page, 'Recall');
  await page
    .getByRole('row')
    .filter({ hasText: 'Rosa Recall' })
    .getByRole('link', { name: 'Book', exact: true })
    .click();
  await page.waitForURL('**/appointments?**');
  await bookPrefilledAppointment(page, {
    date: dateOnly(14),
    time: '09:30',
    service: 'Hygiene visit',
  });

  await openNav(page, 'Recall');
  const bookedRow = page.getByRole('row').filter({ hasText: 'Rosa Recall' });
  await expect(bookedRow).toContainText('BOOKED');

  const pool = createTestPool(testDbConfig());
  try {
    const [recallRows] = await pool.query<RowDataPacket[]>(
      `SELECT r.status FROM recalls r
        JOIN patients p ON p.id = r.patient_id
       WHERE p.phone = ?`,
      [P5_PHONE],
    );
    expect(recallRows.length).toBe(1);
    expect(recallRows[0]?.status).toBe('BOOKED');
  } finally {
    await pool.end();
  }
});
