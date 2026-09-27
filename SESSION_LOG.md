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
| 8 | Smoke script `m2-smoke.ps1` failed to verify the HTTP flow — three **script** defects, app not at fault: (a) health loop compared body+status concatenated by `curl -o - -w '%{http_code}'` against `'200'`; (b) `Stop-Process` killed only the `.cmd` shim, orphaning `node` children (a run-1 server kept serving port 3000 for hours, `uptimeSeconds:23461` exposed it); (c) PS 5.1 native-arg mangling corrupted inline JSON `-d` bodies → server logged `"Malformed JSON body"` 400 | (a) status-only capture via `-o NUL`; (b) pre/post cleanup kills port-3000 listener + any project `index.ts` node process; (c) request bodies written to temp files and sent via `--data-binary @file` | Full smoke re-run: **all 8 checks met** (see evidence table); `SERVER_NEVER_CAME_UP` path never triggered again |

### Verification evidence (commands actually run)

| Check | Command / action | Result |
|---|---|---|
| Typecheck / lint | `npm run typecheck`, `npm run lint` (after each fix round) | exit 0 both, final run green |
| Full test suite | `npm test` run 1 | FAILED: FK error in `beforeAll` (defect 7); 44 passed / 18 skipped |
| Full test suite | `npm test` run 2 (after fix) | exit 0; **62/62 tests, 8 files** — includes the 18 M2 acceptance tests executed against the live `dentalistics_test` DB (not skipped: `TEST_DB_HOST` set) |
| Migration CLI (dev DB) | `npm run migrate` | exit 0; applied `0002_auth_and_tenancy.sql`, skipped `0001` (idempotent) |
| Seed CLI | `npm run seed:admin` twice (password generated in shell, never echoed) | run 1 `created:true`; run 2 `created:false, sessionsRevoked:true`; exit 0 both |
| Server boot + health (manual) | smoke script started `tsx src/index.ts` | log evidence: `database connection verified`, `server started port 3000`, repeated `GET /health` statusCode 200 |
| Full manual HTTP smoke (after defect-8 fixes) | `m2-smoke.ps1` against live server + dev DB | **all checks met**: health body `{"status":"ok","database":"up"}`; login **200** returning correct user JSON (no hash leak); `me` **200**; logout **200**; `me` after logout **401**; `me` no cookie **401**; login wrong password **401**; health still **200**; server + orphans stopped (port 3000 verified free after) |
| Full gate | `npm run verify` | **exit 0** — lint 0, typecheck 0, tests **62/62 (8 suites)**, build 0 |
| Process hygiene | port/process scan after smoke | clean: no stray `index.ts` node processes, no listener on 3000 |

### Git state produced

| Commit | Contents |
|---|---|
| `70be8f9` | Docs: session 2 log (M2 execution record) — pushed with rev 10 `5224879` (remote was one commit behind; both went up together) |
| `6f3da25` | M2 source + tests + tooling (25 files, 1679 insertions) + docs rev 11 (`PROJECT_STATE`, audit M2 row, this session log's defect/evidence sections) |

Push integrity: both pushes exit 0 via the GCM workaround
(`GIT_TERMINAL_PROMPT=0` + `GCM_INTERACTIVE=never`; a `Cannot prompt` line on
stderr is GCM declining and falling back to the cached credential — the
`70be8f9..` / `6f3da25..` result lines confirm success); `git ls-remote`
hash matched local HEAD after each push (`MATCH=OK`).

Uncommitted at time of writing: only this file's final git-state section
(merged with the push just performed).

### Durable doc updates

- `PROJECT_STATE.md` → revision 11 (CURRENT_STATUS M2 complete + evidence,
  §5 M2 implementation block, §8 five new evidence rows, phase log note,
  changelog row).
- `M0_Project_Audit.md` → M2 row: implementation complete, report delivered,
  awaiting acceptance (M3 still gated).
- `SESSION_LOG.md` → this entry (defect 8 closed, final evidence).

### Session end state

- M2 implementation complete; **all gates green**: `npm run verify` exit 0
  (lint 0, typecheck 0, **62/62 tests / 8 suites**, build 0), migrate
  idempotent, seed CLI both paths exit 0, full manual HTTP smoke all-green,
  no stray processes.
- Committed and pushed: `70be8f9` (session log part 1) and `6f3da25`
  (M2 code + rev 11 docs); remote HEAD verified matching local.
- Next (this session): M2 STATUS REPORTING block → STOP for owner acceptance.
  M3 NOT_STARTED (gate rule).

### Decisions the owner has not yet made

1. ~~Accept (or reject) the M2 report — gate on M3.~~ **Resolved 2026-09-27:**
   owner instruction conditionally authorizing M3, after re-verification
   (below), recorded as M2 PASSED (rev 12).
2. K6 question from Session 1 unchanged: keep repo public, make it private,
   or authorize a history rewrite to purge the rotated dead password
   (needs force-push — not done).
3. Everything recorded under OPEN ISSUES in `PROJECT_STATE.md` (B2, B4, B6
   sub-items) remains unanswered.
4. PROPOSED design points surfaced at M2 acceptance: platform-admin role with
   `organization_id NULL` and global cross-org read; email-global-unique
   users; no self-signup (admins create orgs/users); password reset limited
   to self-change + admin reset until a mail channel exists.

### Post-report owner instruction and M2 re-verification (2026-09-27, same session)

Owner: *"If M2 is 100% completed, tested and confirmed PASS, defects fixed,
then start M3 otherwise fix remaining defects first."*

Re-verification executed before answering (no PASS claim on stale evidence):

1. Plan cross-check — M2 section items (authentication, clinic/organization,
   membership, roles, authorization, tenant isolation), all 7 MVP-1 bullets
   (incl. "password reset if required by architecture" → admin reset +
   self-change, documented), SECURITY items in scope at M2 (webhook/replay
   items N/A — no webhooks exist yet), MVP USERS capabilities (owner
   user-management ✓, admin org/user management ✓, receptionist exclusions ✓,
   "no elaborate admin panel" ✓). No gaps found.
2. Fresh `npm run verify` → **exit 0, 62/62 (8 suites, 0 skipped)**.
3. Fresh manual smoke → **all 8 checks green** (seed update path, health 200
   `database:"up"`, login 200 + correct user JSON, me 200, logout 200,
   3 × 401, health still 200, clean shutdown, no stray processes).
4. Falsification spot-checks: rate-limiter bucket pruning (bounded memory),
   audit writer non-blocking (cannot fail a login) — no defects found.

**Result: M2 100% complete, tested, confirmed PASS, no defects remaining →
M3 started.** Recorded in `PROJECT_STATE.md` rev 12 and audit M2 row PASSED.

---

*Append the next session below this line.*

---

## Session 3 — 2026-09-27 — Milestone 3 (Patients + Leads) implemented and tested

**Owner instructions this session:** "Continue if you have next steps" (multiple
times) → M3 implementation continued without pause; long commands prefixed with
a background note per the standing instruction.

**Starting state:** M2 PASSED (rev 12 `bbffefc`); M3 authorized. Prior portion
of the session had already written: `migrations/0003_patients_leads.sql`
(applied to dev DB), M3 validators in `src/validate.ts`, shared
`src/middleware/tenant.ts`, `src/services/leads.ts`, `src/services/patients.ts`,
`src/routes/leads.ts`, `src/routes/patients.ts` (mounted in `src/app.ts`), and
`tests/validate.test.ts`. Typecheck + lint were green; the M3 acceptance test
suite did not yet exist.

### Work executed

1. `tests/m3.integration.test.ts` written: 12 live-DB acceptance tests —
   lead CRUD, patient CRUD, lead validation 400s, list/pagination filter 400s,
   patient validation 400s, receptionist status-only 403 enforcement,
   receptionist read-vs-write patient split, cross-clinic 404 isolation
   (both directions + seeded foreign lead absent from lists), duplicate
   active lead 409 with reopen-after-CLOSED allowed, duplicate patient 409
   on create and on phone update, complete activity timeline
   (created → status_changed → updated with actors/chronology/lastActivityAt),
   assignee validation (cross-clinic 400, missing user 400, filter by
   assignee). Purge order lead_activities → leads → patients → users →
   organizations; migrations run; three logins captured once in `beforeAll`.
2. `tests/validate.test.ts` rewritten with an `expectIssue` helper asserting
   `ValidationError.issues` (see defect 11).
3. `npm run verify` gate executed: lint, typecheck, full tests, build.
4. `m3-smoke.ps1` written (HTTP smoke): bootstraps admin → clinic → owner →
   receptionist through the live API, then exercises the full M3 flow with
   explicit PASS/FAIL checks and a non-zero exit on any failure. Two
   pre-execution corrections during writing: `/api/auth/me` nests the user
   (`me.user.organizationId`), and patient cleanup needs a concrete id.
5. Docs rev 13: `PROJECT_STATE.md` (CURRENT_STATUS, §5 M3 block, eight §8
   evidence rows, phase-log note, changelog), `M0_Project_Audit.md` M3 row,
   this session entry.

### Defects found and fixed (execution, not inspection)

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 9 | First `npm test`: 7 failures / 3 files. (a) Duplicate tests got **201 not 409**: `normalizePhone` preserved the typed leading `+`, so `+973…` (stored) and `973…` (submitted without `+`) never matched — canonicalization inconsistency, not a query bug. (b) `auth.integration.test.ts` beforeAll failed FK `leads`: M2's purge deleted `users`/`organizations` while M3 tables referenced them. (c) 5 unit assertions expected failure detail in `ValidationError.message`, but detail lives in `.issues` (message is always `Invalid input`) | (a) phones now canonicalize to **digits-only** (`+` optional on input, stripped for storage); (b) purge extended to lead_activities → leads → patients → sessions → audit_logs → users → organizations; (c) `expectIssue()` helper asserts joined `.issues` | Re-run: **83/83 passed, exit 0** (10 files); `npm run verify` exit 0 |
| 10 | typecheck: regex capture `match[1]` is `string \| undefined` under strict indexing; lint/test: `ValidationError` imported from `../src/validate` but not re-exported | Replaced capture with `PHONE_PATTERN.test` + `startsWith('+') ? slice(1) : cleaned`; `export { ValidationError }` re-export added | typecheck exit 0, lint exit 0 |
| 11 | `m3-smoke.ps1` run 1: **26 FAIL**. Root cause: `seed:admin` creates a **global admin with `organization_id NULL`**, and role `admin` bypasses `assertOrgExists` — so `/me` had no `organizationId`, every org-scoped URL was malformed (404 cascade), receptionist never got created (401s), and the "foreign org 999999" check wrongly returned **200** (admin bypass, correct behavior for that role) | v2 bootstraps the intended production flow: admin login → `POST /api/admin/organizations` → admin creates clinic owner → owner login drives all M3 checks; run-unique owner/receptionist emails (fixed receptionist password for idempotent re-runs); receptionist created via the clinic member route; foreign-org 404 now checked as a real tenant | Run 2: **29/29 PASS, SMOKE_PASS, exit 0** (count corrected at addendum) |

### Verification evidence (commands actually run)

| Check | Command / action | Result |
|---|---|---|
| Typecheck / lint | after each fix round | exit 0 both, final run green |
| Full test suite | `npm test` run 1 | 7 failed / 3 files (defects 9a–9c) |
| Full test suite | `npm test` run 2 | exit 0; **83/83 tests, 10 files, 0 skipped** (M2 62 + M3 12 integration + 9 validate) |
| Full gate | `npm run verify` | **exit 0** — lint 0, typecheck 0, tests 83/83, build 0 |
| Migration CLI (dev DB) | `npm run migrate` | exit 0; applied `0003_patients_leads.sql`, skipped 0001/0002 (idempotent) |
| HTTP smoke run 1 | `m3-smoke.ps1` | 26 FAIL → root cause defect 11 (script assumption, app not at fault) |
| HTTP smoke run 2 | `m3-smoke.ps1` | **29/29 PASS, exit 0** (count corrected from 27 at addendum — PASS-line count of the saved log): health 200; admin login; org+owner created 201; owner login/me; patient 201; lead 201; list 200; status filter 200; bad filter 400; lead detail (activity=1 `created`, deferred arrays present); status→CONTACTED 200 (activity=2 `status_changed`); duplicate lead 409 `duplicate_lead`; duplicate patient 409; receptionist created 201; receptionist login 200; receptionist lead 201; receptionist notes-patch 403; receptionist patient-create 403; receptionist lead-delete 403; foreign org 404; owner deletes lead/patient/receptionist-lead 200; logout 200 → me 401; health 200; server stopped cleanly |

### Plan cross-check (M3 scope, lines ~868–888)

Patient records ✓, Lead records ✓, Lead statuses ✓ (six-value ENUM), Lead
source ✓ (four-value ENUM), Lead activity ✓ (timeline with actors),
Notes ✓ (lead + patient, max 5000), Search/filter ✓ (q/status/source/date
range/assignee + pagination), Lead detail endpoint ✓ (incl. activity timeline;
"detail screen" delivered as API payload — UI at M14/M15). Tests: CRUD ✓,
validation ✓, authorization ✓, tenant isolation ✓, duplicate handling ✓,
activity recording ✓. All plan M3 items implemented and executed; no gaps
found.

### Git state produced

| Commit | Contents |
|---|---|
| `349dd41` | M3 source (migration `0003`, services leads/patients, routes, tenant middleware, validators), tests (`m3.integration.test.ts`, `validate.test.ts`, M2 purge fix), docs rev 13 (`PROJECT_STATE.md`, `M0_Project_Audit.md`, this session entry) — pushed; remote HEAD verified == local (`MATCH=OK`) |

Push integrity: GCM workaround (`GIT_TERMINAL_PROMPT=0` +
`GCM_INTERACTIVE=never`; stderr `Cannot prompt` = GCM falling back to cached
credential); success confirmed by the `..hash` result line and
`git ls-remote origin master` == `git rev-parse HEAD` (`MATCH=OK`).

### Durable doc updates

- `PROJECT_STATE.md` → revision 13 (CURRENT_STATUS M3 complete awaiting
  acceptance, §5 M3 implementation block, eight §8 evidence rows, phase-log
  note, changelog row).
- `M0_Project_Audit.md` → M3 row: complete, report delivered, awaiting
  acceptance (explicitly NOT yet PASSED — owner decides).
- `SESSION_LOG.md` → this entry.

### Session end state

- M3 implementation complete; **all gates green**: `npm run verify` exit 0
  (lint 0, typecheck 0, **83/83 tests / 10 suites / 0 skipped**, build 0),
  migrate idempotent, HTTP smoke **29/29 PASS exit 0**, no stray processes.
- Committed and pushed: `349dd41` (M3 code + tests + docs rev 13); remote
  HEAD verified matching local (`MATCH=OK`); this follow-up hash line pushed
  as a second docs commit.
- Next (this session): M3 STATUS REPORTING block → STOP for owner acceptance.
  M4 NOT_STARTED (gate rule: no M4 until the owner accepts M3).

### Decisions the owner has not yet made

1. Accept (or reject) the M3 report — gate on M4.
2. PROPOSED M3 design points surfaced for acceptance: org-scoped routes
   `/api/organizations/:orgId/{leads,patients}`; status enum
   NEW/CONTACTED/QUALIFIED/APPOINTMENT_BOOKED/LOST/CLOSED; source enum
   WEBSITE/MISSED_CALL/MANUAL/OTHER; active-lead duplicate = 409
   `duplicate_lead` (statuses not in LOST/CLOSED), reopen allowed after
   CLOSED; patient duplicate = UNIQUE(org,phone) → 409 `duplicate_patient`;
   receptionist may create leads and change lead status only (other lead
   writes 403), patient writes owner/admin, lead DELETE owner/admin;
   phones stored digits-only (`+` optional on input); "screens" delivered as
   API payloads (UI at M14/M15); `communicationHistory`/`appointments` in
   lead detail returned empty until M4/M7.
3. K6 question unchanged: keep repo public, make it private, or authorize a
   history rewrite to purge the rotated dead password (needs force-push —
   not done).
4. Everything recorded under OPEN ISSUES in `PROJECT_STATE.md` (B2, B4, B6
   sub-items) remains unanswered.

---

### Post-report owner instruction and M3 re-verification (2026-09-27, same session)

Owner: *"If M3 is 100% completed, tested and confirmed PASS, defects fixed,
then start M4 otherwise fix remaining defects first."*

Re-verification executed before answering (no PASS claim on stale evidence):

1. **Plan cross-check** — fresh read of the plan's M3 section (Patient records,
   Lead records, statuses, source, activity, notes, Search/filter, Lead detail
   + the six test categories): implementation covers every item, but two
   **test-coverage gaps** were found and closed first:

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 12 | Plan requires Search/filter **tested**, but the free-text `q` path (leads + patients: `LIKE` with `ESCAPE` and `escapeLike`) had **zero tests** | New test: name fragment, phone fragment, miss → total 0, literal `%` → 0 and literal `_` → 0 (escaping proofs — an unescaped `%`/`_` would match everything), `q` > 100 chars → 400, repeated `q` → 400, patient `q` search | `npm test` → **84/84 passed, exit 0** |
| 13 | `assignedUserId` is accepted and org-validated on lead **create** (`leads.ts` L178/L180/L196) but was only exercised through PATCH | Create-with-assignment assertions (`assignedUserId` + `assignedUserEmail` in the 201 response), plus null-unassign → null, reassign → 200, foreign reassign → 400 | same run, 84/84 |

   **Falsification review** of `leads.ts`/`patients.ts` (search escaping,
   receptionist 403-before-404 ordering, no-op update short-circuit, count/list
   parameter reuse): no implementation defects found.
2. Fresh `npm run verify` → **exit 0, 84/84 tests (10 suites, 0 skipped)**.
3. Fresh `m3-smoke.ps1` → **exit 0, 0 failures — 29/29 PASS**.
4. **Correction (self-found):** revision 13 recorded the smoke as "27/27".
   The saved run logs contain **29** PASS lines (both runs, 0 FAIL). The
   claim "all checks green, exit 0" was correct; the count was not. Corrected
   in `PROJECT_STATE.md`, `M0_Project_Audit.md` and this log at revision 14.

**Result: M3 100% complete, tested, confirmed PASS, defects fixed (7 + 2
coverage gaps closed) → M4 started.** Recorded in `PROJECT_STATE.md`
revision 14 and the audit M3 row PASSED / M4 IN_PROGRESS.
