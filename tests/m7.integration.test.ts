import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbConfig } from '../src/config';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import type { Logger } from '../src/logger';
import { generateSiteKey } from '../src/security/siteKey';

const testHost = process.env.TEST_DB_HOST;

function testDbConfig(): DbConfig {
  const database = process.env.TEST_DB_NAME ?? 'dentalistics_test';
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`Unsafe TEST_DB_NAME: ${database}`);
  }
  return {
    host: testHost ?? '',
    port: Number(process.env.TEST_DB_PORT ?? '3306'),
    user: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? '',
    database,
  };
}

function cookie(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : String(raw ?? '');
  return first.split(';')[0] ?? '';
}

interface CapturedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  fields?: Record<string, unknown>;
}

function captureLogger(): Logger & { entries: CapturedLog[] } {
  const entries: CapturedLog[] = [];
  const make = (): Logger & { entries: CapturedLog[] } => ({
    entries,
    debug: (message, fields) => {
      entries.push({ level: 'debug', message, fields });
    },
    info: (message, fields) => {
      entries.push({ level: 'info', message, fields });
    },
    warn: (message, fields) => {
      entries.push({ level: 'warn', message, fields });
    },
    error: (message, fields) => {
      entries.push({ level: 'error', message, fields });
    },
    child: () => make(),
  });
  return make();
}

describe.skipIf(testHost === undefined || testHost === '')(
  'M7 acceptance: appointments',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;
    let logger: Logger & { entries: CapturedLog[] };

    let orgAId: number;
    let orgBId: number;

    const ownerAEmail = 'owner.m7A@apextest.local';
    const ownerAPassword = 'OwnerM7APassw0rd!26x';
    const recepAEmail = 'recep.m7A@apextest.local';
    const recepAPassword = 'RecepM7APassw0rd!26x';
    const ownerBEmail = 'owner.m7B@apextest.local';
    const ownerBPassword = 'OwnerM7BPassw0rd!26x';

    let ownerACookie: string;
    let recepACookie: string;
    let ownerBCookie: string;

    let patientA1Id = 0;
    let patientA2Id = 0;
    let patientB1Id = 0;
    let leadA1Id = 0;

    async function insertOrg(name: string): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name, site_key) VALUES (?, ?)',
        [name, generateSiteKey()],
      );
      return row.insertId;
    }

    async function insertUser(organizationId: number, email: string, password: string, role: string): Promise<number> {
      const hash = await hashPassword(password);
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [organizationId, email, hash, role],
      );
      return row.insertId;
    }

    async function login(email: string, password: string): Promise<string> {
      const res = await request(app).post('/api/auth/login').send({ email, password });
      expect(res.status).toBe(200);
      return cookie(res);
    }

    async function createPatient(ck: string, orgId: number, body: Record<string, unknown>): Promise<number> {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/patients`)
        .set('Cookie', ck)
        .send(body);
      expect(res.status).toBe(201);
      return res.body.patient.id as number;
    }

    function createAppt(ck: string, orgId: number, body: Record<string, unknown>): request.Test {
      return request(app)
        .post(`/api/organizations/${orgId}/appointments`)
        .set('Cookie', ck)
        .send(body);
    }

    function appointmentPath(orgId: number, appointmentId: number, action?: string): string {
      const base = `/api/organizations/${orgId}/appointments/${appointmentId}`;
      return action === undefined ? base : `${base}/${action}`;
    }

    beforeAll(async () => {
      cfg = testDbConfig();
      const admin = mysql.createPool({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
      });
      try {
        await admin.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\``);
      } finally {
        await admin.end();
      }

      const migrationResult = await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
      expect(migrationResult.applied.length + migrationResult.skipped.length).toBeGreaterThan(0);

      pool = createPool(cfg);
      await pool.query('DELETE FROM appointments');
      await pool.query('DELETE FROM communication_messages');
      await pool.query('DELETE FROM lead_activities');
      await pool.query('DELETE FROM leads');
      await pool.query('DELETE FROM patients');
      await pool.query('DELETE FROM users');
      await pool.query('DELETE FROM organizations');

      orgAId = await insertOrg('M7 Clinic A');
      orgBId = await insertOrg('M7 Clinic B');

      await insertUser(orgAId, ownerAEmail, ownerAPassword, 'owner');
      await insertUser(orgAId, recepAEmail, recepAPassword, 'receptionist');
      await insertUser(orgBId, ownerBEmail, ownerBPassword, 'owner');

      logger = captureLogger();
      app = createApp({ db: pool, logger });

      ownerACookie = await login(ownerAEmail, ownerAPassword);
      recepACookie = await login(recepAEmail, recepAPassword);
      ownerBCookie = await login(ownerBEmail, ownerBPassword);

      patientA1Id = await createPatient(ownerACookie, orgAId, {
        firstName: 'Alice',
        lastName: 'M7',
        phone: '+1 (555) 030-3001',
      });
      patientA2Id = await createPatient(ownerACookie, orgAId, {
        firstName: 'Bob',
        lastName: 'M7',
        phone: '15550303002',
      });
      patientB1Id = await createPatient(ownerBCookie, orgBId, {
        firstName: 'Carol',
        lastName: 'M7',
        phone: '15550303003',
      });

      const leadRes = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({
          firstName: 'Liam',
          lastName: 'M7',
          phone: '15550303004',
          source: 'MANUAL',
          requestedService: 'Whitening',
        });
      expect(leadRes.status).toBe(201);
      leadA1Id = leadRes.body.lead.id as number;
    }, 30_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await pool.end();
      }
    });

    it('creates an appointment with SCHEDULED status and exact date/time round-trip', async () => {
      const res = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        leadId: leadA1Id,
        date: '2026-10-05',
        time: '09:30',
        service: 'Check-up',
        provider: 'Dr. Noor',
      });
      expect(res.status).toBe(201);
      const appt = res.body.appointment;
      expect(appt.status).toBe('SCHEDULED');
      expect(appt.date).toBe('2026-10-05');
      expect(appt.time).toBe('09:30:00');
      expect(appt.patient).toMatchObject({
        id: patientA1Id,
        firstName: 'Alice',
        lastName: 'M7',
      });
      expect(appt.leadId).toBe(leadA1Id);
      expect(appt.service).toBe('Check-up');
      expect(appt.provider).toBe('Dr. Noor');
      expect(appt.previousAppointmentId).toBeNull();
      expect(appt.organizationId).toBe(orgAId);
      expect(appt.createdAt).toBeTruthy();

      const created = logger.entries.filter((e) => e.message === 'appointment created');
      expect(created[created.length - 1]?.fields).toMatchObject({
        appointmentId: appt.id,
        organizationId: orgAId,
        patientId: patientA1Id,
      });
      expect(JSON.stringify(created)).not.toContain('5550303001');
    });

    it('rejects invalid appointment input', async () => {
      const missingPatient = await createAppt(ownerACookie, orgAId, {
        date: '2026-10-05',
        time: '09:30',
      });
      expect(missingPatient.status).toBe(400);

      const badDate = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-02-30',
        time: '09:30',
      });
      expect(badDate.status).toBe(400);

      const badTime = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-05',
        time: '25:00',
      });
      expect(badTime.status).toBe(400);

      const foreignPatient = await createAppt(ownerACookie, orgAId, {
        patientId: patientB1Id,
        date: '2026-10-05',
        time: '09:30',
      });
      expect(foreignPatient.status).toBe(404);
      expect(foreignPatient.body.error.code).toBe('not_found');

      const foreignLead = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        leadId: 999999999,
        date: '2026-10-05',
        time: '09:30',
      });
      expect(foreignLead.status).toBe(404);
    });

    it('lists appointments with status, date-range and patient filters', async () => {
      const first = await createAppt(ownerACookie, orgAId, {
        patientId: patientA2Id,
        date: '2026-10-12',
        time: '11:00',
        service: 'Filling',
      });
      expect(first.status).toBe(201);
      const second = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-11-01',
        time: '08:15',
      });
      expect(second.status).toBe(201);

      const all = await request(app)
        .get(`/api/organizations/${orgAId}/appointments`)
        .set('Cookie', ownerACookie);
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(3);
      const dates = all.body.appointments.map((a: { date: string }) => a.date);
      expect([...dates].sort()).toEqual(dates);

      const scheduled = await request(app)
        .get(`/api/organizations/${orgAId}/appointments?status=SCHEDULED`)
        .set('Cookie', ownerACookie);
      expect(scheduled.status).toBe(200);
      expect(scheduled.body.appointments.length).toBe(all.body.total);

      const range = await request(app)
        .get(`/api/organizations/${orgAId}/appointments?from=2026-10-01&to=2026-10-31`)
        .set('Cookie', ownerACookie);
      expect(range.status).toBe(200);
      expect(range.body.total).toBe(2);

      const byPatient = await request(app)
        .get(`/api/organizations/${orgAId}/appointments?patientId=${patientA2Id}`)
        .set('Cookie', ownerACookie);
      expect(byPatient.status).toBe(200);
      expect(byPatient.body.total).toBe(1);
      expect(byPatient.body.appointments[0].patient.id).toBe(patientA2Id);

      const badStatus = await request(app)
        .get(`/api/organizations/${orgAId}/appointments?status=WEIRD`)
        .set('Cookie', ownerACookie);
      expect(badStatus.status).toBe(400);
    });

    it('hides appointments across clinics (tenant isolation)', async () => {
      const bRes = await createAppt(ownerBCookie, orgBId, {
        patientId: patientB1Id,
        date: '2026-10-20',
        time: '10:00',
      });
      expect(bRes.status).toBe(201);
      const bApptId = bRes.body.appointment.id as number;

      const crossGet = await request(app)
        .get(appointmentPath(orgAId, bApptId))
        .set('Cookie', ownerACookie);
      expect(crossGet.status).toBe(404);

      const crossAction = await request(app)
        .post(appointmentPath(orgAId, bApptId, 'confirm'))
        .set('Cookie', ownerACookie)
        .send({});
      expect(crossAction.status).toBe(404);

      const crossCreate = await createAppt(ownerBCookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-21',
        time: '10:00',
      });
      expect(crossCreate.status).toBe(404);

      const listB = await request(app)
        .get(`/api/organizations/${orgBId}/appointments`)
        .set('Cookie', ownerBCookie);
      expect(listB.status).toBe(200);
      expect(
        listB.body.appointments.every((a: { organizationId: number }) => a.organizationId === orgBId),
      ).toBe(true);
    });

    it('transitions SCHEDULED -> CONFIRMED (receptionist may confirm)', async () => {
      const created = await createAppt(recepACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-06',
        time: '12:00',
      });
      expect(created.status).toBe(201);
      const id = created.body.appointment.id as number;

      const res = await request(app)
        .post(appointmentPath(orgAId, id, 'confirm'))
        .set('Cookie', recepACookie)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.appointment.status).toBe('CONFIRMED');

      const changed = logger.entries.filter((e) => e.message === 'appointment status changed');
      expect(changed[changed.length - 1]?.fields).toMatchObject({
        appointmentId: id,
        from: 'SCHEDULED',
        to: 'CONFIRMED',
      });
    });

    it('transitions SCHEDULED -> CANCELLED, COMPLETED and NO_SHOW', async () => {
      const toCancel = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-07',
        time: '13:00',
      });
      const cancelRes = await request(app)
        .post(appointmentPath(orgAId, toCancel.body.appointment.id, 'cancel'))
        .set('Cookie', ownerACookie)
        .send({});
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.appointment.status).toBe('CANCELLED');

      const toComplete = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-07',
        time: '14:00',
      });
      const completeRes = await request(app)
        .post(appointmentPath(orgAId, toComplete.body.appointment.id, 'complete'))
        .set('Cookie', ownerACookie)
        .send({});
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.appointment.status).toBe('COMPLETED');

      const toNoShow = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-07',
        time: '15:00',
      });
      const noShowRes = await request(app)
        .post(appointmentPath(orgAId, toNoShow.body.appointment.id, 'no-show'))
        .set('Cookie', recepACookie)
        .send({});
      expect(noShowRes.status).toBe(200);
      expect(noShowRes.body.appointment.status).toBe('NO_SHOW');
    });

    it('transitions CONFIRMED -> CANCELLED, COMPLETED and NO_SHOW', async () => {
      const targets: Array<[string, string]> = [
        ['cancel', 'CANCELLED'],
        ['complete', 'COMPLETED'],
        ['no-show', 'NO_SHOW'],
      ];
      for (const [action, expected] of targets) {
        const created = await createAppt(ownerACookie, orgAId, {
          patientId: patientA1Id,
          date: '2026-10-08',
          time: '09:00',
        });
        expect(created.status).toBe(201);
        const id = created.body.appointment.id as number;
        const confirm = await request(app)
          .post(appointmentPath(orgAId, id, 'confirm'))
          .set('Cookie', ownerACookie)
          .send({});
        expect(confirm.status).toBe(200);
        const res = await request(app)
          .post(appointmentPath(orgAId, id, action))
          .set('Cookie', ownerACookie)
          .send({});
        expect(res.status).toBe(200);
        expect(res.body.appointment.status).toBe(expected);
      }
    });

    it('rejects every transition out of terminal statuses with 409', async () => {
      const terminalStates = ['CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'];
      const actions: Array<[string, string]> = [
        ['confirm', 'CONFIRMED'],
        ['cancel', 'CANCELLED'],
        ['complete', 'COMPLETED'],
        ['no-show', 'NO_SHOW'],
      ];
      for (const state of terminalStates) {
        const created = await createAppt(ownerACookie, orgAId, {
          patientId: patientA1Id,
          date: '2026-10-09',
          time: '10:00',
        });
        expect(created.status).toBe(201);
        const id = created.body.appointment.id as number;

        if (state === 'CANCELLED' || state === 'COMPLETED' || state === 'NO_SHOW') {
          const route = state === 'CANCELLED' ? 'cancel' : state === 'COMPLETED' ? 'complete' : 'no-show';
          const set = await request(app)
            .post(appointmentPath(orgAId, id, route))
            .set('Cookie', ownerACookie)
            .send({});
          expect(set.status).toBe(200);
        } else {
          const res = await request(app)
            .post(appointmentPath(orgAId, id, 'reschedule'))
            .set('Cookie', ownerACookie)
            .send({ date: '2026-10-25', time: '16:00' });
          expect(res.status).toBe(200);
          expect(res.body.rescheduledFrom.status).toBe('RESCHEDULED');
        }

        for (const [action] of actions) {
          const res = await request(app)
            .post(appointmentPath(orgAId, id, action))
            .set('Cookie', ownerACookie)
            .send({});
          expect(res.status).toBe(409);
          expect(res.body.error.code).toBe('invalid_status_transition');
        }
      }
    });

    it('rejects same-state transitions with 409', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-10',
        time: '11:30',
      });
      const id = created.body.appointment.id as number;

      const confirmAgain = await request(app)
        .post(appointmentPath(orgAId, id, 'confirm'))
        .set('Cookie', ownerACookie)
        .send({});
      expect(confirmAgain.status).toBe(200);

      const secondConfirm = await request(app)
        .post(appointmentPath(orgAId, id, 'confirm'))
        .set('Cookie', ownerACookie)
        .send({});
      expect(secondConfirm.status).toBe(409);

      const reconfirmScheduled = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-10',
        time: '12:30',
      });
      const noCancel = await request(app)
        .post(appointmentPath(orgAId, reconfirmScheduled.body.appointment.id, 'cancel'))
        .set('Cookie', ownerACookie)
        .send({});
      expect(noCancel.status).toBe(200);
      const secondCancel = await request(app)
        .post(appointmentPath(orgAId, reconfirmScheduled.body.appointment.id, 'cancel'))
        .set('Cookie', ownerACookie)
        .send({});
      expect(secondCancel.status).toBe(409);
    });

    it('reschedules: old appointment becomes RESCHEDULED, new one is created and linked', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        leadId: leadA1Id,
        date: '2026-10-11',
        time: '14:30',
        service: 'Root canal',
        provider: 'Dr. Noor',
      });
      const oldId = created.body.appointment.id as number;

      const res = await request(app)
        .post(appointmentPath(orgAId, oldId, 'reschedule'))
        .set('Cookie', ownerACookie)
        .send({ date: '2026-10-18', time: '16:45' });
      expect(res.status).toBe(200);
      const newAppt = res.body.appointment;
      expect(newAppt.status).toBe('SCHEDULED');
      expect(newAppt.date).toBe('2026-10-18');
      expect(newAppt.time).toBe('16:45:00');
      expect(newAppt.previousAppointmentId).toBe(oldId);
      expect(newAppt.service).toBe('Root canal');
      expect(newAppt.provider).toBe('Dr. Noor');
      expect(newAppt.patient.id).toBe(patientA1Id);
      expect(newAppt.leadId).toBe(leadA1Id);

      expect(res.body.rescheduledFrom.id).toBe(oldId);
      expect(res.body.rescheduledFrom.status).toBe('RESCHEDULED');
      expect(res.body.rescheduledFrom.date).toBe('2026-10-11');

      const rere = await request(app)
        .post(appointmentPath(orgAId, oldId, 'reschedule'))
        .set('Cookie', ownerACookie)
        .send({ date: '2026-10-19', time: '10:00' });
      expect(rere.status).toBe(409);
      expect(rere.body.error.code).toBe('invalid_status_transition');
    });

    it('refuses to reschedule cancelled, completed or no-show appointments', async () => {
      const cases: Array<[string, string]> = [
        ['cancel', 'CANCELLED'],
        ['complete', 'COMPLETED'],
        ['no-show', 'NO_SHOW'],
      ];
      for (const [action] of cases) {
        const created = await createAppt(ownerACookie, orgAId, {
          patientId: patientA1Id,
          date: '2026-10-13',
          time: '09:45',
        });
        const id = created.body.appointment.id as number;
        const set = await request(app)
          .post(appointmentPath(orgAId, id, action))
          .set('Cookie', ownerACookie)
          .send({});
        expect(set.status).toBe(200);
        const res = await request(app)
          .post(appointmentPath(orgAId, id, 'reschedule'))
          .set('Cookie', ownerACookie)
          .send({ date: '2026-10-26', time: '11:00' });
        expect(res.status).toBe(409);
      }
    });

    it('rebooks from NO_SHOW and CANCELLED, keeping the old record unchanged', async () => {
      const noShow = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-14',
        time: '10:30',
      });
      const noShowId = noShow.body.appointment.id as number;
      await request(app)
        .post(appointmentPath(orgAId, noShowId, 'no-show'))
        .set('Cookie', ownerACookie)
        .send({});

      const rebook = await request(app)
        .post(appointmentPath(orgAId, noShowId, 'rebook'))
        .set('Cookie', recepACookie)
        .send({ date: '2026-10-27', time: '10:30' });
      expect(rebook.status).toBe(200);
      expect(rebook.body.appointment.status).toBe('SCHEDULED');
      expect(rebook.body.appointment.previousAppointmentId).toBe(noShowId);
      expect(rebook.body.appointment.date).toBe('2026-10-27');
      expect(rebook.body.rebookedFrom.status).toBe('NO_SHOW');
      expect(rebook.body.rebookedFrom.id).toBe(noShowId);

      const cancelled = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-15',
        time: '10:30',
      });
      const cancelledId = cancelled.body.appointment.id as number;
      await request(app)
        .post(appointmentPath(orgAId, cancelledId, 'cancel'))
        .set('Cookie', ownerACookie)
        .send({});
      const rebookCancelled = await request(app)
        .post(appointmentPath(orgAId, cancelledId, 'rebook'))
        .set('Cookie', ownerACookie)
        .send({ date: '2026-10-28', time: '09:00' });
      expect(rebookCancelled.status).toBe(200);
      expect(rebookCancelled.body.appointment.previousAppointmentId).toBe(cancelledId);
    });

    it('refuses to rebook appointments that are not cancelled or no-show', async () => {
      const cases: Array<[string | undefined, string]> = [
        [undefined, 'SCHEDULED'],
        ['confirm', 'CONFIRMED'],
        ['complete', 'COMPLETED'],
        ['cancel', 'CANCELLED'],
      ];
      for (const [action] of cases) {
        const created = await createAppt(ownerACookie, orgAId, {
          patientId: patientA1Id,
          date: '2026-10-16',
          time: '11:15',
        });
        const id = created.body.appointment.id as number;
        if (action === 'confirm') {
          await request(app)
            .post(appointmentPath(orgAId, id, 'confirm'))
            .set('Cookie', ownerACookie)
            .send({});
        }
        if (action === 'complete') {
          await request(app)
            .post(appointmentPath(orgAId, id, 'complete'))
            .set('Cookie', ownerACookie)
            .send({});
        }
        if (action === 'cancel') {
          await request(app)
            .post(appointmentPath(orgAId, id, 'cancel'))
            .set('Cookie', ownerACookie)
            .send({});
        }
        const res = await request(app)
          .post(appointmentPath(orgAId, id, 'rebook'))
          .set('Cookie', ownerACookie)
          .send({ date: '2026-10-29', time: '12:00' });
        if (action === 'cancel') {
          expect(res.status).toBe(200);
        } else {
          expect(res.status).toBe(409);
        }
      }
    });

    it('enforces authorization: receptionist limited, owner/admin full, auth required', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-10-17',
        time: '15:30',
      });
      const id = created.body.appointment.id as number;

      const patch = await request(app)
        .patch(appointmentPath(orgAId, id))
        .set('Cookie', recepACookie)
        .send({ service: 'New service' });
      expect(patch.status).toBe(403);

      const cancel = await request(app)
        .post(appointmentPath(orgAId, id, 'cancel'))
        .set('Cookie', recepACookie)
        .send({});
      expect(cancel.status).toBe(403);

      const complete = await request(app)
        .post(appointmentPath(orgAId, id, 'complete'))
        .set('Cookie', recepACookie)
        .send({});
      expect(complete.status).toBe(403);

      const reschedule = await request(app)
        .post(appointmentPath(orgAId, id, 'reschedule'))
        .set('Cookie', recepACookie)
        .send({ date: '2026-10-30', time: '16:00' });
      expect(reschedule.status).toBe(403);

      const anon = await request(app)
        .get(`/api/organizations/${orgAId}/appointments`)
        .send();
      expect(anon.status).toBe(401);

      const ownerPatch = await request(app)
        .patch(appointmentPath(orgAId, id))
        .set('Cookie', ownerACookie)
        .send({ service: 'Cleaning', provider: 'Dr. Sage' });
      expect(ownerPatch.status).toBe(200);
      expect(ownerPatch.body.appointment.service).toBe('Cleaning');
      expect(ownerPatch.body.appointment.provider).toBe('Dr. Sage');

      const badPatch = await request(app)
        .patch(appointmentPath(orgAId, id))
        .set('Cookie', ownerACookie)
        .send({ status: 'CANCELLED' });
      expect(badPatch.status).toBe(400);

      const terminalPatch = await request(app)
        .post(appointmentPath(orgAId, id, 'cancel'))
        .set('Cookie', ownerACookie)
        .send({});
      expect(terminalPatch.status).toBe(200);
      const editTerminal = await request(app)
        .patch(appointmentPath(orgAId, id))
        .set('Cookie', ownerACookie)
        .send({ service: 'Too late' });
      expect(editTerminal.status).toBe(409);
    });

    it('stores clinic timezone, validates it and keeps appointment wall-clock intact', async () => {
      const initial = await request(app)
        .get(`/api/organizations/${orgAId}`)
        .set('Cookie', ownerACookie);
      expect(initial.status).toBe(200);
      expect(initial.body.organization.timezone).toBe('UTC');

      const updated = await request(app)
        .patch(`/api/organizations/${orgAId}`)
        .set('Cookie', ownerACookie)
        .send({ timezone: 'Asia/Bahrain' });
      expect(updated.status).toBe(200);
      expect(updated.body.organization.timezone).toBe('Asia/Bahrain');
      expect(updated.body.organization.siteKey).toBeTruthy();

      const badTz = await request(app)
        .patch(`/api/organizations/${orgAId}`)
        .set('Cookie', ownerACookie)
        .send({ timezone: 'Not/AZone' });
      expect(badTz.status).toBe(400);

      const unknownField = await request(app)
        .patch(`/api/organizations/${orgAId}`)
        .set('Cookie', ownerACookie)
        .send({ name: 'Renamed' });
      expect(unknownField.status).toBe(400);

      const receptionistTz = await request(app)
        .patch(`/api/organizations/${orgAId}`)
        .set('Cookie', recepACookie)
        .send({ timezone: 'Europe/London' });
      expect(receptionistTz.status).toBe(403);

      const wallClock = await createAppt(ownerACookie, orgAId, {
        patientId: patientA1Id,
        date: '2026-12-24',
        time: '17:45',
      });
      expect(wallClock.status).toBe(201);
      expect(wallClock.body.appointment.date).toBe('2026-12-24');
      expect(wallClock.body.appointment.time).toBe('17:45:00');

      const get = await request(app)
        .get(appointmentPath(orgAId, wallClock.body.appointment.id))
        .set('Cookie', ownerACookie);
      expect(get.status).toBe(200);
      expect(get.body.appointment.date).toBe('2026-12-24');
      expect(get.body.appointment.time).toBe('17:45:00');
    });

    it('shows linked appointments in the lead detail', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgAId}/leads/${leadA1Id}`)
        .set('Cookie', ownerACookie);
      expect(res.status).toBe(200);
      const appointments = res.body.appointments as Array<Record<string, unknown>>;
      expect(appointments.length).toBeGreaterThan(0);
      const linked = appointments.find((a) => a.leadId === leadA1Id);
      expect(linked).toBeTruthy();
      expect(linked?.status).toBeTruthy();

      const freshLead = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Nina', lastName: 'M7', phone: '15550303005', source: 'MANUAL' });
      expect(freshLead.status).toBe(201);
      const freshDetail = await request(app)
        .get(`/api/organizations/${orgAId}/leads/${freshLead.body.lead.id}`)
        .set('Cookie', ownerACookie);
      expect(freshDetail.status).toBe(200);
      expect(freshDetail.body.appointments).toEqual([]);
    });

    it('refuses to delete a patient that has appointments', async () => {
      const withAppt = await createPatient(ownerACookie, orgAId, {
        firstName: 'Delete',
        lastName: 'Guard',
        phone: '15550303006',
      });
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: withAppt,
        date: '2026-10-22',
        time: '13:30',
      });
      expect(created.status).toBe(201);

      const blocked = await request(app)
        .delete(`/api/organizations/${orgAId}/patients/${withAppt}`)
        .set('Cookie', ownerACookie);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('patient_has_appointments');

      const free = await createPatient(ownerACookie, orgAId, {
        firstName: 'Free',
        lastName: 'Patient',
        phone: '15550303007',
      });
      const deleted = await request(app)
        .delete(`/api/organizations/${orgAId}/patients/${free}`)
        .set('Cookie', ownerACookie);
      expect(deleted.status).toBe(200);
    });

    it('returns 404 for unknown appointments', async () => {
      const res = await request(app)
        .get(appointmentPath(orgAId, 999999999))
        .set('Cookie', ownerACookie);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  },
);
