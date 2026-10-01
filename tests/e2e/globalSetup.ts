import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from 'mysql2/promise';
import { runMigrations } from '../../src/db/migrate';
import { createTestPool, testDbConfig } from './db';
import { seedE2E } from './seed';

export default async function globalSetup(): Promise<void> {
  const distIndex = path.resolve(process.cwd(), 'frontend', 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error(
      'frontend/dist/index.html not found. Run "npm run build:frontend" before the E2E suite.',
    );
  }

  const cfg = testDbConfig();
  const admin = createPool({
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

  const migration = await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
  console.log(
    `[e2e setup] migrations applied=${migration.applied.length} skipped=${migration.skipped.length}`,
  );

  const pool = createTestPool(cfg);
  try {
    const ids = await seedE2E(pool);
    console.log(
      `[e2e setup] seeded org=${ids.orgId} leads=${ids.lead1Id},${ids.lead2Id} ` +
        `appts=${ids.appt3Id},${ids.appt4Id} recall=${ids.recall5Id}`,
    );
  } finally {
    await pool.end();
  }
}
