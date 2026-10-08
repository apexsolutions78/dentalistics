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

describe.skipIf(testHost === undefined || testHost === '')(
  'M3 acceptance: patients and leads',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;
    let orgAId: number;
    let orgBId: number;
    let recvAId: number;
    let ownerBId: number;
    let orgBLeadId: number;
    let ownerACookie: string;
    let recvACookie: string;
    let ownerBCookie: string;

    const ownerAEmail = 'owner.a@apextest.local';
    const ownerAPassword = 'OwnerAPassw0rd!26x';
    const recvAEmail = 'receptionist.a@apextest.local';
    const recvAPassword = 'ReceptionAPassw0rd!26x';
    const ownerBEmail = 'owner.b@apextest.local';
    const ownerBPassword = 'OwnerBPassw0rd!26x';

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

      const [orgARow] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        ['M3 Clinic A'],
      );
      orgAId = orgARow.insertId;
      const [orgBRow] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        ['M3 Clinic B'],
      );
      orgBId = orgBRow.insertId;

      async function insertUser(
        email: string,
        password: string,
        role: string,
        organizationId: number | null,
      ): Promise<number> {
        const hash = await hashPassword(password);
        const [row] = await pool.query<mysql.ResultSetHeader>(
          'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
          [organizationId, email, hash, role],
        );
        return row.insertId;
      }

      await insertUser(ownerAEmail, ownerAPassword, 'owner', orgAId);
      recvAId = await insertUser(recvAEmail, recvAPassword, 'receptionist', orgAId);
      ownerBId = await insertUser(ownerBEmail, ownerBPassword, 'owner', orgBId);

      const [orgBLeadRow] = await pool.query<mysql.ResultSetHeader>(
        `INSERT INTO leads (organization_id, first_name, last_name, phone, source, status)
         VALUES (?, 'Foreign', 'Lead', '9739999999', 'MANUAL', 'NEW')`,
        [orgBId],
      );
      orgBLeadId = orgBLeadRow.insertId;

      app = createApp({ db: pool });

      const loginA = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerAEmail, password: ownerAPassword });
      ownerACookie = cookie(loginA);
      const loginR = await request(app)
        .post('/api/auth/login')
        .send({ email: recvAEmail, password: recvAPassword });
      recvACookie = cookie(loginR);
      const loginB = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerBEmail, password: ownerBPassword });
      ownerBCookie = cookie(loginB);
      expect(loginA.status).toBe(200);
      expect(loginR.status).toBe(200);
      expect(loginB.status).toBe(200);
    }, 30_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await pool.end();
      }
    });

    it('lead CRUD: create, list, detail, update, delete', async () => {
      const created = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({
          firstName: 'Ahmed',
          lastName: 'Ali',
          phone: '+973 1111 0001',
          email: 'ahmed@example.com',
          requestedService: 'Dental Implant',
          source: 'WEBSITE',
          notes: 'Initial enquiry',
        });
      expect(created.status).toBe(201);
      expect(created.body.lead.status).toBe('NEW');
      expect(created.body.lead.phone).toBe('97311110001');
      const leadId: number = created.body.lead.id;

      const list = await request(app)
        .get(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie);
      expect(list.status).toBe(200);
      expect(list.body.total).toBeGreaterThanOrEqual(1);
      const listedIds = (list.body.leads as Array<{ id: number }>).map((l) => l.id);
      expect(listedIds).toContain(leadId);
      expect(list.text).not.toContain('password');

      const detail = await request(app)
        .get(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie);
      expect(detail.status).toBe(200);
      expect(detail.body.lead.email).toBe('ahmed@example.com');
      expect(detail.body.lead.assignedUserEmail).toBeNull();
      expect(detail.body.communicationHistory).toHaveLength(1);
      expect(detail.body.communicationHistory[0].direction).toBe('OUTBOUND');
      expect(detail.body.communicationHistory[0].leadId).toBe(leadId);
      expect(detail.body.communicationHistory[0].body).toContain('thank you for contacting');
      expect(detail.body.appointments).toEqual([]);
      expect(detail.body.activity).toHaveLength(2);
      expect(detail.body.activity[0].action).toBe('created');
      expect(detail.body.activity[0].actorEmail).toBe(ownerAEmail);
      expect(detail.body.activity[1].action).toBe('urgency_computed');
      expect(detail.body.activity[1].actorEmail).toBeNull();

      const updated = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie)
        .send({ status: 'CONTACTED', requestedService: 'Implant consultation' });
      expect(updated.status).toBe(200);
      expect(updated.body.lead.status).toBe('CONTACTED');
      expect(updated.body.lead.requestedService).toBe('Implant consultation');

      const assigned = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie)
        .send({ assignedUserId: recvAId });
      expect(assigned.status).toBe(200);
      expect(assigned.body.lead.assignedUserId).toBe(recvAId);
      expect(assigned.body.lead.assignedUserEmail).toBe(recvAEmail);

      const removed = await request(app)
        .delete(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie);
      expect(removed.status).toBe(200);

      const afterDelete = await request(app)
        .get(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie);
      expect(afterDelete.status).toBe(404);
    }, 25_000);

    it('patient CRUD: create, list, detail, update, delete', async () => {
      const created = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({
          firstName: 'Sara',
          lastName: 'Khalil',
          phone: '+97322220002',
          email: 'sara@example.com',
          notes: 'Existing patient',
        });
      expect(created.status).toBe(201);
      expect(created.body.patient.phone).toBe('97322220002');
      const patientId: number = created.body.patient.id;

      const list = await request(app)
        .get(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie);
      expect(list.status).toBe(200);
      expect(list.body.total).toBeGreaterThanOrEqual(1);
      expect((list.body.patients as Array<{ id: number }>).map((p) => p.id)).toContain(patientId);

      const detail = await request(app)
        .get(`/api/organizations/${orgAId}/patients/${patientId}`)
        .set('Cookie', ownerACookie);
      expect(detail.status).toBe(200);
      expect(detail.body.patient.lastName).toBe('Khalil');

      const updated = await request(app)
        .patch(`/api/organizations/${orgAId}/patients/${patientId}`)
        .set('Cookie', ownerACookie)
        .send({ notes: 'Updated notes', email: 'sara2@example.com' });
      expect(updated.status).toBe(200);
      expect(updated.body.patient.notes).toBe('Updated notes');
      expect(updated.body.patient.email).toBe('sara2@example.com');

      const removed = await request(app)
        .delete(`/api/organizations/${orgAId}/patients/${patientId}`)
        .set('Cookie', ownerACookie);
      expect(removed.status).toBe(200);

      const afterDelete = await request(app)
        .get(`/api/organizations/${orgAId}/patients/${patientId}`)
        .set('Cookie', ownerACookie);
      expect(afterDelete.status).toBe(404);
    }, 25_000);

    it('persists smsOptOut on patient create and validates its type (defect 26)', async () => {
      const optedOut = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({
          firstName: 'Opt',
          lastName: 'Out',
          phone: '+97322220013',
          smsOptOut: true,
        });
      expect(optedOut.status).toBe(201);
      expect(optedOut.body.patient.smsOptOut).toBe(true);
      const optedOutId: number = optedOut.body.patient.id;

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT sms_opt_out FROM patients WHERE id = ? AND organization_id = ?',
        [optedOutId, orgAId],
      );
      expect((rows[0] as mysql.RowDataPacket).sms_opt_out).toBe(1);

      const detail = await request(app)
        .get(`/api/organizations/${orgAId}/patients/${optedOutId}`)
        .set('Cookie', ownerACookie);
      expect(detail.status).toBe(200);
      expect(detail.body.patient.smsOptOut).toBe(true);

      const defaulted = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'No', lastName: 'Flag', phone: '+97322220014' });
      expect(defaulted.status).toBe(201);
      expect(defaulted.body.patient.smsOptOut).toBe(false);

      const invalid = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Bad', lastName: 'Flag', phone: '+97322220015', smsOptOut: 'yes' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('validation_failed');
    }, 25_000);

    it('rejects invalid lead input with 400 validation errors', async () => {
      const base = {
        firstName: 'Test',
        lastName: 'Person',
        phone: '+97311110003',
        source: 'MANUAL',
      };
      const missingPhone = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ ...base, phone: undefined });
      expect(missingPhone.status).toBe(400);
      expect(missingPhone.body.error.code).toBe('validation_failed');

      const badPhone = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ ...base, phone: 'not-a-phone' });
      expect(badPhone.status).toBe(400);

      const badSource = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ ...base, source: 'Pigeon' });
      expect(badSource.status).toBe(400);

      const badStatus = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ ...base, status: 'DONE' });
      expect(badStatus.status).toBe(400);

      const badEmail = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ ...base, email: 'nope' });
      expect(badEmail.status).toBe(400);

      const emptyName = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ ...base, firstName: '   ' });
      expect(emptyName.status).toBe(400);
    }, 25_000);

    it('rejects invalid list filters and pagination', async () => {
      const badStatus = await request(app)
        .get(`/api/organizations/${orgAId}/leads?status=DONE`)
        .set('Cookie', ownerACookie);
      expect(badStatus.status).toBe(400);

      const badDate = await request(app)
        .get(`/api/organizations/${orgAId}/leads?from=2026-02-30`)
        .set('Cookie', ownerACookie);
      expect(badDate.status).toBe(400);

      const badLimit = await request(app)
        .get(`/api/organizations/${orgAId}/leads?limit=0`)
        .set('Cookie', ownerACookie);
      expect(badLimit.status).toBe(400);

      const badOffset = await request(app)
        .get(`/api/organizations/${orgAId}/patients?offset=-5`)
        .set('Cookie', ownerACookie);
      expect(badOffset.status).toBe(400);
    });

    it('searches leads and patients by free-text q with LIKE escaping', async () => {
      const lead = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Zanzibar', lastName: 'Qsearch', phone: '+97311110010', source: 'MANUAL' });
      expect(lead.status).toBe(201);
      const leadId: number = lead.body.lead.id;

      const patient = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Finder', lastName: 'Queriable', phone: '+97322220010' });
      expect(patient.status).toBe(201);
      const patientId: number = patient.body.patient.id;

      const byName = await request(app)
        .get(`/api/organizations/${orgAId}/leads?q=Zanzibar`)
        .set('Cookie', ownerACookie);
      expect(byName.status).toBe(200);
      expect(byName.body.total).toBe(1);
      expect((byName.body.leads as Array<{ id: number }>).map((l) => l.id)).toContain(leadId);

      const byPhone = await request(app)
        .get(`/api/organizations/${orgAId}/leads?q=0010`)
        .set('Cookie', ownerACookie);
      expect(byPhone.status).toBe(200);
      expect((byPhone.body.leads as Array<{ id: number }>).map((l) => l.id)).toContain(leadId);

      const byMissing = await request(app)
        .get(`/api/organizations/${orgAId}/leads?q=NoSuchLeadAnywhere`)
        .set('Cookie', ownerACookie);
      expect(byMissing.status).toBe(200);
      expect(byMissing.body.total).toBe(0);

      const byPercent = await request(app)
        .get(`/api/organizations/${orgAId}/leads?q=%25`)
        .set('Cookie', ownerACookie);
      expect(byPercent.status).toBe(200);
      expect(byPercent.body.total).toBe(0);

      const byUnderscore = await request(app)
        .get(`/api/organizations/${orgAId}/patients?q=_`)
        .set('Cookie', ownerACookie);
      expect(byUnderscore.status).toBe(200);
      expect(byUnderscore.body.total).toBe(0);

      const patientByName = await request(app)
        .get(`/api/organizations/${orgAId}/patients?q=Finder`)
        .set('Cookie', ownerACookie);
      expect(patientByName.status).toBe(200);
      expect((patientByName.body.patients as Array<{ id: number }>).map((p) => p.id)).toContain(
        patientId,
      );

      const longQ = await request(app)
        .get(`/api/organizations/${orgAId}/leads?q=${'a'.repeat(101)}`)
        .set('Cookie', ownerACookie);
      expect(longQ.status).toBe(400);

      const repeatedQ = await request(app)
        .get(`/api/organizations/${orgAId}/leads?q=one&q=two`)
        .set('Cookie', ownerACookie);
      expect(repeatedQ.status).toBe(400);
    }, 25_000);

    it('rejects invalid patient input with 400 validation errors', async () => {
      const badPhone = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'A', lastName: 'B', phone: '12' });
      expect(badPhone.status).toBe(400);

      const noName = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({ lastName: 'B', phone: '+97333330003' });
      expect(noName.status).toBe(400);

      const unknownField = await request(app)
        .patch(`/api/organizations/${orgAId}/patients/1`)
        .set('Cookie', ownerACookie)
        .send({ ssn: 'x' });
      expect(unknownField.status).toBe(400);
    });

    it('receptionist may add leads and change status but not edit other fields or delete', async () => {
      const created = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', recvACookie)
        .send({
          firstName: 'Reception',
          lastName: 'Created',
          phone: '+97311110004',
          source: 'MISSED_CALL',
        });
      expect(created.status).toBe(201);
      const leadId: number = created.body.lead.id;

      const statusChange = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', recvACookie)
        .send({ status: 'CONTACTED' });
      expect(statusChange.status).toBe(200);
      expect(statusChange.body.lead.status).toBe('CONTACTED');

      const notesChange = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', recvACookie)
        .send({ notes: 'not allowed' });
      expect(notesChange.status).toBe(403);
      expect(notesChange.body.error.code).toBe('forbidden');

      const deleteAttempt = await request(app)
        .delete(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', recvACookie);
      expect(deleteAttempt.status).toBe(403);

      const detail = await request(app)
        .get(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', recvACookie);
      expect(detail.status).toBe(200);
    }, 25_000);

    it('receptionist may read patients but not create, update or delete them', async () => {
      const created = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Read', lastName: 'Only', phone: '+97322220004' });
      expect(created.status).toBe(201);
      const patientId: number = created.body.patient.id;

      const list = await request(app)
        .get(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', recvACookie);
      expect(list.status).toBe(200);

      const detail = await request(app)
        .get(`/api/organizations/${orgAId}/patients/${patientId}`)
        .set('Cookie', recvACookie);
      expect(detail.status).toBe(200);

      const createAttempt = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', recvACookie)
        .send({ firstName: 'No', lastName: 'Way', phone: '+97322220005' });
      expect(createAttempt.status).toBe(403);

      const updateAttempt = await request(app)
        .patch(`/api/organizations/${orgAId}/patients/${patientId}`)
        .set('Cookie', recvACookie)
        .send({ notes: 'nope' });
      expect(updateAttempt.status).toBe(403);

      const deleteAttempt = await request(app)
        .delete(`/api/organizations/${orgAId}/patients/${patientId}`)
        .set('Cookie', recvACookie);
      expect(deleteAttempt.status).toBe(403);
    }, 25_000);

    it('prevents cross-clinic access to leads and patients (tenant isolation)', async () => {
      const foreignLeads = await request(app)
        .get(`/api/organizations/${orgBId}/leads`)
        .set('Cookie', ownerACookie);
      expect(foreignLeads.status).toBe(404);

      const foreignLeadDetail = await request(app)
        .get(`/api/organizations/${orgAId}/leads/${orgBLeadId}`)
        .set('Cookie', ownerBCookie);
      expect(foreignLeadDetail.status).toBe(404);

      const foreignLeadCreate = await request(app)
        .post(`/api/organizations/${orgBId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'X', lastName: 'Y', phone: '+97311110005', source: 'MANUAL' });
      expect(foreignLeadCreate.status).toBe(404);

      const foreignLeadPatch = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${orgBLeadId}`)
        .set('Cookie', ownerBCookie)
        .send({ status: 'LOST' });
      expect(foreignLeadPatch.status).toBe(404);

      const foreignPatients = await request(app)
        .get(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerBCookie);
      expect(foreignPatients.status).toBe(404);

      const foreignPatientPatch = await request(app)
        .patch(`/api/organizations/${orgAId}/patients/1`)
        .set('Cookie', ownerBCookie)
        .send({ notes: 'cross' });
      expect(foreignPatientPatch.status).toBe(404);

      const ownList = await request(app)
        .get(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie);
      const ownIds = (ownList.body.leads as Array<{ id: number }>).map((l) => l.id);
      expect(ownIds).not.toContain(orgBLeadId);
      const phones = (ownList.body.leads as Array<{ phone: string }>).map((l) => l.phone);
      expect(phones).not.toContain('9739999999');
    }, 25_000);

    it('rejects duplicate active leads but allows a new lead after close', async () => {
      const first = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Dup', lastName: 'One', phone: '+97311110006', source: 'MANUAL' });
      expect(first.status).toBe(201);
      const firstId: number = first.body.lead.id;

      const duplicate = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Dup', lastName: 'Two', phone: '97311110006', source: 'WEBSITE' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('duplicate_lead');

      const closed = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${firstId}`)
        .set('Cookie', ownerACookie)
        .send({ status: 'CLOSED' });
      expect(closed.status).toBe(200);

      const afterClose = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Dup', lastName: 'Again', phone: '+973 1111 0006', source: 'WEBSITE' });
      expect(afterClose.status).toBe(201);
    }, 25_000);

    it('rejects duplicate patients on create and on phone update', async () => {
      const first = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Dup', lastName: 'Patient', phone: '+97322220006' });
      expect(first.status).toBe(201);
      const firstId: number = first.body.patient.id;

      const duplicate = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Other', lastName: 'Person', phone: '97322220006' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('duplicate_patient');

      const second = await request(app)
        .post(`/api/organizations/${orgAId}/patients`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Move', lastName: 'Along', phone: '+97322220007' });
      expect(second.status).toBe(201);
      const secondId: number = second.body.patient.id;

      const movePhone = await request(app)
        .patch(`/api/organizations/${orgAId}/patients/${secondId}`)
        .set('Cookie', ownerACookie)
        .send({ phone: '+973 2222 0006' });
      expect(movePhone.status).toBe(409);

      const selfPhone = await request(app)
        .patch(`/api/organizations/${orgAId}/patients/${firstId}`)
        .set('Cookie', ownerACookie)
        .send({ phone: '+97322220006' });
      expect(selfPhone.status).toBe(200);
    }, 25_000);

    it('records a complete lead activity timeline with actors and bumps last activity', async () => {
      const created = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({ firstName: 'Timeline', lastName: 'Test', phone: '+97311110007', source: 'MANUAL' });
      expect(created.status).toBe(201);
      const leadId: number = created.body.lead.id;
      const createdAt = new Date(created.body.lead.createdAt).getTime();

      await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', recvACookie)
        .send({ status: 'CONTACTED' });
      await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie)
        .send({ notes: 'Called the patient' });

      const detail = await request(app)
        .get(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie);
      expect(detail.status).toBe(200);
      const activity = detail.body.activity as Array<{
        action: string;
        detail: string | null;
        actorEmail: string | null;
        createdAt: string;
      }>;
      expect(activity).toHaveLength(5);
      expect(activity[0]?.action).toBe('created');
      expect(activity[0]?.actorEmail).toBe(ownerAEmail);
      expect(activity[1]?.action).toBe('urgency_computed');
      expect(activity[1]?.actorEmail).toBeNull();
      expect(activity[2]?.action).toBe('status_changed');
      expect(activity[2]?.detail).toBe('status: NEW -> CONTACTED');
      expect(activity[2]?.actorEmail).toBe(recvAEmail);
      expect(activity[3]?.action).toBe('urgency_changed');
      expect(activity[3]?.actorEmail).toBeNull();
      expect(activity[4]?.action).toBe('updated');
      expect(activity[4]?.detail).toBe('fields: notes');
      expect(activity[4]?.actorEmail).toBe(ownerAEmail);

      const times = activity.map((a) => new Date(a.createdAt).getTime());
      expect(times[1]).toBeGreaterThanOrEqual(times[0] ?? 0);
      expect(times[2]).toBeGreaterThanOrEqual(times[1] ?? 0);
      expect(times[3]).toBeGreaterThanOrEqual(times[2] ?? 0);
      expect(times[4]).toBeGreaterThanOrEqual(times[3] ?? 0);
      expect(new Date(detail.body.lead.lastActivityAt).getTime()).toBeGreaterThanOrEqual(createdAt);
      expect(detail.body.lead.status).toBe('CONTACTED');
    }, 25_000);

    it('validates assignment targets belong to the clinic and filters by assignee', async () => {
      const created = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerACookie)
        .send({
          firstName: 'Assign',
          lastName: 'Check',
          phone: '+97311110008',
          source: 'OTHER',
          assignedUserId: recvAId,
        });
      expect(created.status).toBe(201);
      expect(created.body.lead.assignedUserId).toBe(recvAId);
      expect(created.body.lead.assignedUserEmail).toBe(recvAEmail);
      const leadId: number = created.body.lead.id;

      const foreignAssign = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie)
        .send({ assignedUserId: ownerBId });
      expect(foreignAssign.status).toBe(400);

      const unassignable = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie)
        .send({ assignedUserId: 999999999 });
      expect(unassignable.status).toBe(400);

      const assign = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie)
        .send({ assignedUserId: recvAId });
      expect(assign.status).toBe(200);
      expect(assign.body.lead.assignedUserId).toBe(recvAId);

      const unassign = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie)
        .send({ assignedUserId: null });
      expect(unassign.status).toBe(200);
      expect(unassign.body.lead.assignedUserId).toBeNull();

      const reassign = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie)
        .send({ assignedUserId: recvAId });
      expect(reassign.status).toBe(200);
      expect(reassign.body.lead.assignedUserId).toBe(recvAId);

      const foreignAgain = await request(app)
        .patch(`/api/organizations/${orgAId}/leads/${leadId}`)
        .set('Cookie', ownerACookie)
        .send({ assignedUserId: ownerBId });
      expect(foreignAgain.status).toBe(400);

      const filtered = await request(app)
        .get(`/api/organizations/${orgAId}/leads?assignedUserId=${recvAId}`)
        .set('Cookie', ownerACookie);
      expect(filtered.status).toBe(200);
      expect((filtered.body.leads as Array<{ id: number }>).map((l) => l.id)).toContain(leadId);

      const unassignedList = await request(app)
        .get(`/api/organizations/${orgAId}/leads?assignedUserId=`)
        .set('Cookie', ownerACookie);
      expect(unassignedList.status).toBe(200);
    }, 25_000);
  },
);
