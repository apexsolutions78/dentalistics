# SESSION LOG — Dentalistics

Append-only record, one entry per working session (newest at the bottom).
Entries record what was executed and verified in that session, not intentions.
Passwords and other live secrets are never written into this file.

---

## Session 1 — 2026-09-26 — Milestone 1 (Foundation) executed and delivered

**Owner instructions this session:** "What did we do so far?" → recap delivered;
"Continue if you have next steps" → execute M1; "save session log when done".

**Starting state:** M0 accepted (owner: "Please proceed", recorded as decision D3);
branch `master` had zero commits; MySQL 8.4 dev container `dentalistics-mysql`
already running; no application code existed.

### Work executed

1. `npm install` — 240 packages, exit 0. Toolchain verified by execution:
   typescript 5.9.3, eslint 10.11.0, vitest 5.0.2, tsx 4.23.15, esbuild 0.28.2.
   Note: npm allow-scripts skipped esbuild's postinstall; verified esbuild works
   anyway (binary ships via optional dependency).
2. Foundation source written: `src/config.ts` (env validation, fail-fast),
   `src/logger.ts` (JSON logs, secret redaction), `src/errors.ts` (AppError +
   Express error handler), `src/app.ts` (Express 5 factory, `GET /`,
   `GET /health`), `src/index.ts` (boot: env → DB verify → listen → graceful
   shutdown), `src/db/pool.ts` (mysql2 pool, UTC), `src/db/migrate.ts` (SQL-file
   runner + `schema_migrations`, CLI entry for `npm run migrate`).
3. Tests written: `tests/config.test.ts` (7), `tests/logger.test.ts` (5),
   `tests/app.test.ts` (10), `tests/db.integration.test.ts` (4, live DB).
4. `migrations/0001_create_app_meta.sql`, tooling configs, `.env` (local,
   git-ignored), `.env.example`, `.gitignore`, `README.md`.

### Defects found and fixed (execution, not inspection)

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 1 | ESLint `preserve-caught-error`: migration error thrown without `cause` | Attached `{ cause: err }` | lint exit 0 |
| 2 | `src/db/pool.ts` imported `'./config'` (wrong path; file is in `src/db/`) | Changed to `'../config'` | typecheck exit 0 |
| 3 | `vitest.config.ts` could not import ESM-only `vitest/config` under CJS package | Renamed to `vitest.config.mts`; updated tsconfig include + eslint file list | typecheck + tests exit 0 |
| 4 | DB migration test not idempotent across runs: probe file had a fixed name, so a second run saw it already tracked and `applied` came back empty | Unique per-run name (`randomUUID`) + cleanup of the tracking row; deleted one stale row from the test DB | `npm test` 26/26 twice |
| 5 | SECURITY: local dev MySQL root password was written into `README.md` and pushed to the **public** repo (commits `de088b9`, `c20437f`) — found by running the M1 acceptance check "No secrets are committed" | Credential rotated (old value confirmed rejected over TCP, `ER_ACCESS_DENIED_ERROR`), README changed to a placeholder, live value kept only in git-ignored `.env` | `npm run verify` exit 0, migrate exit 0, server `/health` 200 after rotation; `git grep` of HEAD clean; recorded as K6 in `PROJECT_STATE.md` rev 9 |

### Verification evidence (commands actually run)

| Check | Command / action | Result |
|---|---|---|
| Lint / typecheck / test / build | `npm run verify` (twice, plus individual runs) | exit 0 each time; 26/26 tests |
| Migration CLI | `npm run migrate` run twice | run 1 applied `0001_create_app_meta.sql`; run 2 skipped it (idempotent) |
| Server smoke | `node dist/index.js` + HTTP requests | boot verified DB then listened; `GET /health` 200 `database:"up"`; `GET /` 200; unknown route structured 404; request logs emitted |
| Env validation failure | ran `dist/index.js` from a directory without `.env` | ConfigError listing DB_HOST/DB_USER/DB_NAME/DB_PASSWORD on stderr, exit 1 |
| DB failure fail-fast | `DB_PORT=9999 node dist/index.js` | "database unreachable at startup" logged, exit 1 |
| Secrets in tree | `git grep dev_root_pw_2026 HEAD` after fix | no matches (exit 1 = clean) |
| Push integrity | `git ls-remote origin master` after each push | remote HEAD matched local HEAD (full hash) each time |

Notes on evidence:
- An attempt to test empty-`DB_HOST` rejection via an empty process env var did
  not test the code path (Windows drops empty env vars, so `.env` supplied the
  value); the missing-env path was re-tested correctly via a `.env`-less cwd.
- After rotation, in-container socket connections as `root@localhost` rejected
  every password tried while the TCP path (`root@%`, used by the app) worked.
  Root cause NOT diagnosed; all application access verified working over TCP.

### Git state produced (all pushed to `origin`)

| Commit | Contents |
|---|---|
| `de088b9` | M0 + M1: audit, governing docs, foundation scaffold (root commit, 28 files) |
| `c20437f` | Docs: M0 acceptance + M1 completion recorded (`PROJECT_STATE` rev 8, audit rows) |
| `6d6b66c` | Security: dev MySQL password removed from README |
| `bb04198` | Docs: K6 security incident/mitigation recorded (`PROJECT_STATE` rev 9) |

Push quirk observed: Git Credential Manager intermittently stalls on push
(hidden interactive prompt). Workaround used: `GCM_INTERACTIVE=never` +
`GIT_TERMINAL_PROMPT=0`. One earlier push that appeared to time out had in fact
completed server-side (confirmed by hash comparison).

### Durable doc updates

- `PROJECT_STATE.md` → revision 9 (CURRENT_STATUS, §5 ARCHITECTURE, D3, K6,
  §8 COMPLETED with test evidence, phase log, change log).
- `M0_Project_Audit.md` → M0 ACCEPTED, M1 COMPLETED, K-I1/R1 resolved,
  git-state annotation.
- `README.md` → quick start + placeholder credentials.

### Session end state

- M1 report delivered; **awaiting owner acceptance**; M2 NOT_STARTED (gate rule).
- Working tree clean at `bb04198` before this file was added.
- Uncommitted at time of writing: this session log.

### Decisions the owner has not yet made

1. Accept the M1 report (and thereby the M0-recommended stack — ASSUMED
   accepted via D3, no separate stack approval was given).
2. Repo is public: keep it public, make it private, or authorize a history
   rewrite to purge the rotated dead password (needs force-push — not done).
3. Everything recorded under OPEN ISSUES in `PROJECT_STATE.md` (B2, B4, B6
   sub-items) remains unanswered.

---

*Append the next session below this line.*

---

## Session 2 — 2026-09-26/27 — Milestone 2 (Auth + multi-tenancy) implemented and tested

**Owner instructions this session:** "What did we do so far?" → recap delivered;
"Continue if you have next steps" → M2 implementation continued; "resume" →
handoff state captured; "save session log" (this entry).

**Starting state:** M1 PASSED and reported (rev 10 commit `5224879` local);
M2 authorized by owner instruction. All M2 primitive source had been written
in the prior portion of the session but not yet wired, gated, or tested.

### Work executed

1. Body parsing centralized on `readJsonBody` (`src/http/body.ts`): local
   `readBody` removed from `routes/admin.ts` and `routes/organizations.ts`;
   unused imports pruned.
2. `src/app.ts` rewritten: `AppDeps { logger?, checkDatabase?, db?,
   secureCookies? }`; when `db` is present the app mounts `attachSession(db)`,
   `createAuthRouter` (per-app-instance login rate limiter),
   `createAdminRouter`, `createOrganizationsRouter`; with `db` absent the M1
   health-only behavior is unchanged (M1 tests untouched).
3. `src/index.ts` wired: passes `db: getPool()` and
   `secureCookies: config.nodeEnv === 'production'`.
4. Bootstrap admin CLI written: `src/db/seed-admin.ts` (reads
   `ADMIN_EMAIL`/`ADMIN_PASSWORD` from env, idempotent create-or-update,
   revokes existing sessions on reset, no secret echo, exit 0/1),
   `package.json` gained `"seed:admin"`, `.env.example` gained commented
   `ADMIN_*` entries.
5. Tests written: `tests/password.test.ts` (7), `tests/cookies.test.ts` (8),
   `tests/rateLimit.test.ts` (3), `tests/auth.integration.test.ts` (18;
   `skipIf` on missing `TEST_DB_HOST`, table purge in `beforeAll`, seeded
   Clinic A/B + admin/owner/receptionist accounts). `vitest.config.mts`
   gained `fileParallelism: false` so DB-sharing files cannot race.

### Defects found and fixed (execution, not inspection)

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 6 | typecheck: mysql2 `query<T[]>` generic constraint violated by plain row interfaces; `req.params` typed `string \| string[]`; lint `no-namespace` on the Express `declare global` augmentation | Row interfaces now `extends RowDataPacket`; `parsePathId` accepts `string \| string[] \| undefined`; switched to `declare module 'express-serve-static-core'` | typecheck exit 0, lint exit 0 |
| 7 | `npm test` failed in beforeAll with FK error `fk_users_organization`: `const [rows] = await pool.query<ResultSetHeader[]>` then `rows[0].insertId` — the tuple's first element **is** the `ResultSetHeader` for INSERTs, so the extra `[0]` indexed into an object → `undefined ?? 0` → `orgAId = 0` → FK failure. Root cause established by direct DB diagnostic (orgs/users rows present, id column auto_increment) | All 3 INSERT sites now `query<mysql.ResultSetHeader>` + `.insertId` (SELECT sites were already correct — their rows really are arrays) | `npm test` → **62/62 passed, exit 0** (8 files) |
| 8 | Smoke script `m2-smoke.ps1` health loop compared body+status concatenated by `curl -o - -w '%{http_code}'` against `'200'`, so it never matched → reported `SERVER_NEVER_CAME_UP`, exit 1. **App not at fault**: server log shows DB verified, listen on port 3000, repeated `GET /health` 200 | NOT YET FIXED — smoke incomplete | pending re-run |

### Verification evidence (commands actually run)

| Check | Command / action | Result |
|---|---|---|
| Typecheck / lint | `npm run typecheck`, `npm run lint` (after each fix round) | exit 0 both, final run green |
| Full test suite | `npm test` run 1 | FAILED: FK error in `beforeAll` (defect 7); 44 passed / 18 skipped |
| Full test suite | `npm test` run 2 (after fix) | exit 0; **62/62 tests, 8 files** — includes the 18 M2 acceptance tests executed against the live `dentalistics_test` DB (not skipped: `TEST_DB_HOST` set) |
| Migration CLI (dev DB) | `npm run migrate` | exit 0; applied `0002_auth_and_tenancy.sql`, skipped `0001` (idempotent) |
| Seed CLI | `npm run seed:admin` twice (password generated in shell, never echoed) | run 1 `created:true`; run 2 `created:false, sessionsRevoked:true`; exit 0 both |
| Server boot + health (manual) | smoke script started `tsx src/index.ts` | log evidence: `database connection verified`, `server started port 3000`, ~30 × `GET /health` statusCode 200; script then exited 1 on its own comparison bug and stopped the server |
| HTTP login → me → logout flow | smoke script steps after health | **NOT YET EXECUTED** (blocked by defect 8) |

### Git state produced

- No commits this session. Local HEAD `5224879` (rev 10); `git ls-remote origin
  master` → `45179cb` … — **rev 10 confirmed NOT pushed** (remote one commit
  behind local).
- Uncommitted working tree: modified `.env.example`, `package.json`,
  `src/app.ts`, `src/index.ts`, `vitest.config.mts`; new `migrations/0002_*`,
  `src/audit.ts`, `src/auth/`, `src/db/seed-admin.ts`, `src/http/`,
  `src/middleware/`, `src/routes/`, `src/security/`, `src/services/`,
  `src/validate.ts`, 4 new test files.

### Durable doc updates

- None this session. `PROJECT_STATE.md` rev 11, audit M2 row, and this
  session-log commit are still pending.

### Session end state

- M2 implementation complete; all automated gates green (lint 0, typecheck 0,
  tests 62/62, build not yet re-run this session).
- Manual smoke **partially done** (boot + health confirmed by execution;
  login/me/logout HTTP flow outstanding).
- Remaining before M2 report: fix smoke script → run full HTTP flow →
  `npm run verify` → docs rev 11 → commit → push (incl. pending `5224879`) →
  verify remote hash → M2 STATUS REPORTING block → STOP for acceptance.

### Decisions the owner has not yet made

1. Rev 10 (`5224879`) still unpushed; push will accompany the M2 commit
   unless the owner objects.
2. Session 1 open items unchanged: public-repo/history-rewrite question (K6),
   `PROJECT_STATE.md` OPEN ISSUES (B2, B4, B6 sub-items).
3. M2 report acceptance (pending report delivery).
