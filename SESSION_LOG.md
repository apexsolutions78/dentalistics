# SESSION LOG â€” Dentalistics

Append-only record, one entry per working session (newest at the bottom).
Entries record what was executed and verified in that session, not intentions.
Passwords and other live secrets are never written into this file.

---

## Session 1 â€” 2026-09-26 â€” Milestone 1 (Foundation) executed and delivered

**Owner instructions this session:** "What did we do so far?" â†’ recap delivered;
"Continue if you have next steps" â†’ execute M1; "save session log when done".

**Starting state:** M0 accepted (owner: "Please proceed", recorded as decision D3);
branch `master` had zero commits; MySQL 8.4 dev container `dentalistics-mysql`
already running; no application code existed.

### Work executed

1. `npm install` â€” 240 packages, exit 0. Toolchain verified by execution:
   typescript 5.9.3, eslint 10.11.0, vitest 5.0.2, tsx 4.23.15, esbuild 0.28.2.
   Note: npm allow-scripts skipped esbuild's postinstall; verified esbuild works
   anyway (binary ships via optional dependency).
2. Foundation source written: `src/config.ts` (env validation, fail-fast),
   `src/logger.ts` (JSON logs, secret redaction), `src/errors.ts` (AppError +
   Express error handler), `src/app.ts` (Express 5 factory, `GET /`,
   `GET /health`), `src/index.ts` (boot: env â†’ DB verify â†’ listen â†’ graceful
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
| 5 | SECURITY: local dev MySQL root password was written into `README.md` and pushed to the **public** repo (commits `de088b9`, `c20437f`) â€” found by running the M1 acceptance check "No secrets are committed" | Credential rotated (old value confirmed rejected over TCP, `ER_ACCESS_DENIED_ERROR`), README changed to a placeholder, live value kept only in git-ignored `.env` | `npm run verify` exit 0, migrate exit 0, server `/health` 200 after rotation; `git grep` of HEAD clean; recorded as K6 in `PROJECT_STATE.md` rev 9 |

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

- `PROJECT_STATE.md` â†’ revision 9 (CURRENT_STATUS, Â§5 ARCHITECTURE, D3, K6,
  Â§8 COMPLETED with test evidence, phase log, change log).
- `M0_Project_Audit.md` â†’ M0 ACCEPTED, M1 COMPLETED, K-I1/R1 resolved,
  git-state annotation.
- `README.md` â†’ quick start + placeholder credentials.

### Session end state

- M1 report delivered; **awaiting owner acceptance**; M2 NOT_STARTED (gate rule).
- Working tree clean at `bb04198` before this file was added.
- Uncommitted at time of writing: this session log.

### Decisions the owner has not yet made

1. Accept the M1 report (and thereby the M0-recommended stack â€” ASSUMED
   accepted via D3, no separate stack approval was given).
2. Repo is public: keep it public, make it private, or authorize a history
   rewrite to purge the rotated dead password (needs force-push â€” not done).
3. Everything recorded under OPEN ISSUES in `PROJECT_STATE.md` (B2, B4, B6
   sub-items) remains unanswered.

---

*Append the next session below this line.*

---

## Session 2 â€” 2026-09-26/27 â€” Milestone 2 (Auth + multi-tenancy) implemented and tested

**Owner instructions this session:** "What did we do so far?" â†’ recap delivered;
"Continue if you have next steps" â†’ M2 implementation continued; "resume" â†’
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
| 7 | `npm test` failed in beforeAll with FK error `fk_users_organization`: `const [rows] = await pool.query<ResultSetHeader[]>` then `rows[0].insertId` â€” the tuple's first element **is** the `ResultSetHeader` for INSERTs, so the extra `[0]` indexed into an object â†’ `undefined ?? 0` â†’ `orgAId = 0` â†’ FK failure. Root cause established by direct DB diagnostic (orgs/users rows present, id column auto_increment) | All 3 INSERT sites now `query<mysql.ResultSetHeader>` + `.insertId` (SELECT sites were already correct â€” their rows really are arrays) | `npm test` â†’ **62/62 passed, exit 0** (8 files) |
| 8 | Smoke script `m2-smoke.ps1` failed to verify the HTTP flow â€” three **script** defects, app not at fault: (a) health loop compared body+status concatenated by `curl -o - -w '%{http_code}'` against `'200'`; (b) `Stop-Process` killed only the `.cmd` shim, orphaning `node` children (a run-1 server kept serving port 3000 for hours, `uptimeSeconds:23461` exposed it); (c) PS 5.1 native-arg mangling corrupted inline JSON `-d` bodies â†’ server logged `"Malformed JSON body"` 400 | (a) status-only capture via `-o NUL`; (b) pre/post cleanup kills port-3000 listener + any project `index.ts` node process; (c) request bodies written to temp files and sent via `--data-binary @file` | Full smoke re-run: **all 8 checks met** (see evidence table); `SERVER_NEVER_CAME_UP` path never triggered again |

### Verification evidence (commands actually run)

| Check | Command / action | Result |
|---|---|---|
| Typecheck / lint | `npm run typecheck`, `npm run lint` (after each fix round) | exit 0 both, final run green |
| Full test suite | `npm test` run 1 | FAILED: FK error in `beforeAll` (defect 7); 44 passed / 18 skipped |
| Full test suite | `npm test` run 2 (after fix) | exit 0; **62/62 tests, 8 files** â€” includes the 18 M2 acceptance tests executed against the live `dentalistics_test` DB (not skipped: `TEST_DB_HOST` set) |
| Migration CLI (dev DB) | `npm run migrate` | exit 0; applied `0002_auth_and_tenancy.sql`, skipped `0001` (idempotent) |
| Seed CLI | `npm run seed:admin` twice (password generated in shell, never echoed) | run 1 `created:true`; run 2 `created:false, sessionsRevoked:true`; exit 0 both |
| Server boot + health (manual) | smoke script started `tsx src/index.ts` | log evidence: `database connection verified`, `server started port 3000`, repeated `GET /health` statusCode 200 |
| Full manual HTTP smoke (after defect-8 fixes) | `m2-smoke.ps1` against live server + dev DB | **all checks met**: health body `{"status":"ok","database":"up"}`; login **200** returning correct user JSON (no hash leak); `me` **200**; logout **200**; `me` after logout **401**; `me` no cookie **401**; login wrong password **401**; health still **200**; server + orphans stopped (port 3000 verified free after) |
| Full gate | `npm run verify` | **exit 0** â€” lint 0, typecheck 0, tests **62/62 (8 suites)**, build 0 |
| Process hygiene | port/process scan after smoke | clean: no stray `index.ts` node processes, no listener on 3000 |

### Git state produced

| Commit | Contents |
|---|---|
| `70be8f9` | Docs: session 2 log (M2 execution record) â€” pushed with rev 10 `5224879` (remote was one commit behind; both went up together) |
| `6f3da25` | M2 source + tests + tooling (25 files, 1679 insertions) + docs rev 11 (`PROJECT_STATE`, audit M2 row, this session log's defect/evidence sections) |

Push integrity: both pushes exit 0 via the GCM workaround
(`GIT_TERMINAL_PROMPT=0` + `GCM_INTERACTIVE=never`; a `Cannot prompt` line on
stderr is GCM declining and falling back to the cached credential â€” the
`70be8f9..` / `6f3da25..` result lines confirm success); `git ls-remote`
hash matched local HEAD after each push (`MATCH=OK`).

Uncommitted at time of writing: only this file's final git-state section
(merged with the push just performed).

### Durable doc updates

- `PROJECT_STATE.md` â†’ revision 11 (CURRENT_STATUS M2 complete + evidence,
  Â§5 M2 implementation block, Â§8 five new evidence rows, phase log note,
  changelog row).
- `M0_Project_Audit.md` â†’ M2 row: implementation complete, report delivered,
  awaiting acceptance (M3 still gated).
- `SESSION_LOG.md` â†’ this entry (defect 8 closed, final evidence).

### Session end state

- M2 implementation complete; **all gates green**: `npm run verify` exit 0
  (lint 0, typecheck 0, **62/62 tests / 8 suites**, build 0), migrate
  idempotent, seed CLI both paths exit 0, full manual HTTP smoke all-green,
  no stray processes.
- Committed and pushed: `70be8f9` (session log part 1) and `6f3da25`
  (M2 code + rev 11 docs); remote HEAD verified matching local.
- Next (this session): M2 STATUS REPORTING block â†’ STOP for owner acceptance.
  M3 NOT_STARTED (gate rule).

### Decisions the owner has not yet made

1. ~~Accept (or reject) the M2 report â€” gate on M3.~~ **Resolved 2026-09-27:**
   owner instruction conditionally authorizing M3, after re-verification
   (below), recorded as M2 PASSED (rev 12).
2. K6 question from Session 1 unchanged: keep repo public, make it private,
   or authorize a history rewrite to purge the rotated dead password
   (needs force-push â€” not done).
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

1. Plan cross-check â€” M2 section items (authentication, clinic/organization,
   membership, roles, authorization, tenant isolation), all 7 MVP-1 bullets
   (incl. "password reset if required by architecture" â†’ admin reset +
   self-change, documented), SECURITY items in scope at M2 (webhook/replay
   items N/A â€” no webhooks exist yet), MVP USERS capabilities (owner
   user-management âœ“, admin org/user management âœ“, receptionist exclusions âœ“,
   "no elaborate admin panel" âœ“). No gaps found.
2. Fresh `npm run verify` â†’ **exit 0, 62/62 (8 suites, 0 skipped)**.
3. Fresh manual smoke â†’ **all 8 checks green** (seed update path, health 200
   `database:"up"`, login 200 + correct user JSON, me 200, logout 200,
   3 Ã— 401, health still 200, clean shutdown, no stray processes).
4. Falsification spot-checks: rate-limiter bucket pruning (bounded memory),
   audit writer non-blocking (cannot fail a login) â€” no defects found.

**Result: M2 100% complete, tested, confirmed PASS, no defects remaining â†’
M3 started.** Recorded in `PROJECT_STATE.md` rev 12 and audit M2 row PASSED.

---

*Append the next session below this line.*

---

## Session 3 â€” 2026-09-27 â€” Milestone 3 (Patients + Leads) implemented and tested

**Owner instructions this session:** "Continue if you have next steps" (multiple
times) â†’ M3 implementation continued without pause; long commands prefixed with
a background note per the standing instruction.

**Starting state:** M2 PASSED (rev 12 `bbffefc`); M3 authorized. Prior portion
of the session had already written: `migrations/0003_patients_leads.sql`
(applied to dev DB), M3 validators in `src/validate.ts`, shared
`src/middleware/tenant.ts`, `src/services/leads.ts`, `src/services/patients.ts`,
`src/routes/leads.ts`, `src/routes/patients.ts` (mounted in `src/app.ts`), and
`tests/validate.test.ts`. Typecheck + lint were green; the M3 acceptance test
suite did not yet exist.

### Work executed

1. `tests/m3.integration.test.ts` written: 12 live-DB acceptance tests â€”
   lead CRUD, patient CRUD, lead validation 400s, list/pagination filter 400s,
   patient validation 400s, receptionist status-only 403 enforcement,
   receptionist read-vs-write patient split, cross-clinic 404 isolation
   (both directions + seeded foreign lead absent from lists), duplicate
   active lead 409 with reopen-after-CLOSED allowed, duplicate patient 409
   on create and on phone update, complete activity timeline
   (created â†’ status_changed â†’ updated with actors/chronology/lastActivityAt),
   assignee validation (cross-clinic 400, missing user 400, filter by
   assignee). Purge order lead_activities â†’ leads â†’ patients â†’ users â†’
   organizations; migrations run; three logins captured once in `beforeAll`.
2. `tests/validate.test.ts` rewritten with an `expectIssue` helper asserting
   `ValidationError.issues` (see defect 11).
3. `npm run verify` gate executed: lint, typecheck, full tests, build.
4. `m3-smoke.ps1` written (HTTP smoke): bootstraps admin â†’ clinic â†’ owner â†’
   receptionist through the live API, then exercises the full M3 flow with
   explicit PASS/FAIL checks and a non-zero exit on any failure. Two
   pre-execution corrections during writing: `/api/auth/me` nests the user
   (`me.user.organizationId`), and patient cleanup needs a concrete id.
5. Docs rev 13: `PROJECT_STATE.md` (CURRENT_STATUS, Â§5 M3 block, eight Â§8
   evidence rows, phase-log note, changelog), `M0_Project_Audit.md` M3 row,
   this session entry.

### Defects found and fixed (execution, not inspection)

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 9 | First `npm test`: 7 failures / 3 files. (a) Duplicate tests got **201 not 409**: `normalizePhone` preserved the typed leading `+`, so `+973â€¦` (stored) and `973â€¦` (submitted without `+`) never matched â€” canonicalization inconsistency, not a query bug. (b) `auth.integration.test.ts` beforeAll failed FK `leads`: M2's purge deleted `users`/`organizations` while M3 tables referenced them. (c) 5 unit assertions expected failure detail in `ValidationError.message`, but detail lives in `.issues` (message is always `Invalid input`) | (a) phones now canonicalize to **digits-only** (`+` optional on input, stripped for storage); (b) purge extended to lead_activities â†’ leads â†’ patients â†’ sessions â†’ audit_logs â†’ users â†’ organizations; (c) `expectIssue()` helper asserts joined `.issues` | Re-run: **83/83 passed, exit 0** (10 files); `npm run verify` exit 0 |
| 10 | typecheck: regex capture `match[1]` is `string \| undefined` under strict indexing; lint/test: `ValidationError` imported from `../src/validate` but not re-exported | Replaced capture with `PHONE_PATTERN.test` + `startsWith('+') ? slice(1) : cleaned`; `export { ValidationError }` re-export added | typecheck exit 0, lint exit 0 |
| 11 | `m3-smoke.ps1` run 1: **26 FAIL**. Root cause: `seed:admin` creates a **global admin with `organization_id NULL`**, and role `admin` bypasses `assertOrgExists` â€” so `/me` had no `organizationId`, every org-scoped URL was malformed (404 cascade), receptionist never got created (401s), and the "foreign org 999999" check wrongly returned **200** (admin bypass, correct behavior for that role) | v2 bootstraps the intended production flow: admin login â†’ `POST /api/admin/organizations` â†’ admin creates clinic owner â†’ owner login drives all M3 checks; run-unique owner/receptionist emails (fixed receptionist password for idempotent re-runs); receptionist created via the clinic member route; foreign-org 404 now checked as a real tenant | Run 2: **29/29 PASS, SMOKE_PASS, exit 0** (count corrected at addendum) |

### Verification evidence (commands actually run)

| Check | Command / action | Result |
|---|---|---|
| Typecheck / lint | after each fix round | exit 0 both, final run green |
| Full test suite | `npm test` run 1 | 7 failed / 3 files (defects 9aâ€“9c) |
| Full test suite | `npm test` run 2 | exit 0; **83/83 tests, 10 files, 0 skipped** (M2 62 + M3 12 integration + 9 validate) |
| Full gate | `npm run verify` | **exit 0** â€” lint 0, typecheck 0, tests 83/83, build 0 |
| Migration CLI (dev DB) | `npm run migrate` | exit 0; applied `0003_patients_leads.sql`, skipped 0001/0002 (idempotent) |
| HTTP smoke run 1 | `m3-smoke.ps1` | 26 FAIL â†’ root cause defect 11 (script assumption, app not at fault) |
| HTTP smoke run 2 | `m3-smoke.ps1` | **29/29 PASS, exit 0** (count corrected from 27 at addendum â€” PASS-line count of the saved log): health 200; admin login; org+owner created 201; owner login/me; patient 201; lead 201; list 200; status filter 200; bad filter 400; lead detail (activity=1 `created`, deferred arrays present); statusâ†’CONTACTED 200 (activity=2 `status_changed`); duplicate lead 409 `duplicate_lead`; duplicate patient 409; receptionist created 201; receptionist login 200; receptionist lead 201; receptionist notes-patch 403; receptionist patient-create 403; receptionist lead-delete 403; foreign org 404; owner deletes lead/patient/receptionist-lead 200; logout 200 â†’ me 401; health 200; server stopped cleanly |

### Plan cross-check (M3 scope, lines ~868â€“888)

Patient records âœ“, Lead records âœ“, Lead statuses âœ“ (six-value ENUM), Lead
source âœ“ (four-value ENUM), Lead activity âœ“ (timeline with actors),
Notes âœ“ (lead + patient, max 5000), Search/filter âœ“ (q/status/source/date
range/assignee + pagination), Lead detail endpoint âœ“ (incl. activity timeline;
"detail screen" delivered as API payload â€” UI at M14/M15). Tests: CRUD âœ“,
validation âœ“, authorization âœ“, tenant isolation âœ“, duplicate handling âœ“,
activity recording âœ“. All plan M3 items implemented and executed; no gaps
found.

### Git state produced

| Commit | Contents |
|---|---|
| `349dd41` | M3 source (migration `0003`, services leads/patients, routes, tenant middleware, validators), tests (`m3.integration.test.ts`, `validate.test.ts`, M2 purge fix), docs rev 13 (`PROJECT_STATE.md`, `M0_Project_Audit.md`, this session entry) â€” pushed; remote HEAD verified == local (`MATCH=OK`) |

Push integrity: GCM workaround (`GIT_TERMINAL_PROMPT=0` +
`GCM_INTERACTIVE=never`; stderr `Cannot prompt` = GCM falling back to cached
credential); success confirmed by the `..hash` result line and
`git ls-remote origin master` == `git rev-parse HEAD` (`MATCH=OK`).

### Durable doc updates

- `PROJECT_STATE.md` â†’ revision 13 (CURRENT_STATUS M3 complete awaiting
  acceptance, Â§5 M3 implementation block, eight Â§8 evidence rows, phase-log
  note, changelog row).
- `M0_Project_Audit.md` â†’ M3 row: complete, report delivered, awaiting
  acceptance (explicitly NOT yet PASSED â€” owner decides).
- `SESSION_LOG.md` â†’ this entry.

### Session end state

- M3 implementation complete; **all gates green**: `npm run verify` exit 0
  (lint 0, typecheck 0, **83/83 tests / 10 suites / 0 skipped**, build 0),
  migrate idempotent, HTTP smoke **29/29 PASS exit 0**, no stray processes.
- Committed and pushed: `349dd41` (M3 code + tests + docs rev 13); remote
  HEAD verified matching local (`MATCH=OK`); this follow-up hash line pushed
  as a second docs commit.
- Next (this session): M3 STATUS REPORTING block â†’ STOP for owner acceptance.
  M4 NOT_STARTED (gate rule: no M4 until the owner accepts M3).

### Decisions the owner has not yet made

1. Accept (or reject) the M3 report â€” gate on M4.
2. PROPOSED M3 design points surfaced for acceptance: org-scoped routes
   `/api/organizations/:orgId/{leads,patients}`; status enum
   NEW/CONTACTED/QUALIFIED/APPOINTMENT_BOOKED/LOST/CLOSED; source enum
   WEBSITE/MISSED_CALL/MANUAL/OTHER; active-lead duplicate = 409
   `duplicate_lead` (statuses not in LOST/CLOSED), reopen allowed after
   CLOSED; patient duplicate = UNIQUE(org,phone) â†’ 409 `duplicate_patient`;
   receptionist may create leads and change lead status only (other lead
   writes 403), patient writes owner/admin, lead DELETE owner/admin;
   phones stored digits-only (`+` optional on input); "screens" delivered as
   API payloads (UI at M14/M15); `communicationHistory`/`appointments` in
   lead detail returned empty until M4/M7.
3. K6 question unchanged: keep repo public, make it private, or authorize a
   history rewrite to purge the rotated dead password (needs force-push â€”
   not done).
4. Everything recorded under OPEN ISSUES in `PROJECT_STATE.md` (B2, B4, B6
   sub-items) remains unanswered.

---

### Post-report owner instruction and M3 re-verification (2026-09-27, same session)

Owner: *"If M3 is 100% completed, tested and confirmed PASS, defects fixed,
then start M4 otherwise fix remaining defects first."*

Re-verification executed before answering (no PASS claim on stale evidence):

1. **Plan cross-check** â€” fresh read of the plan's M3 section (Patient records,
   Lead records, statuses, source, activity, notes, Search/filter, Lead detail
   + the six test categories): implementation covers every item, but two
   **test-coverage gaps** were found and closed first:

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 12 | Plan requires Search/filter **tested**, but the free-text `q` path (leads + patients: `LIKE` with `ESCAPE` and `escapeLike`) had **zero tests** | New test: name fragment, phone fragment, miss â†’ total 0, literal `%` â†’ 0 and literal `_` â†’ 0 (escaping proofs â€” an unescaped `%`/`_` would match everything), `q` > 100 chars â†’ 400, repeated `q` â†’ 400, patient `q` search | `npm test` â†’ **84/84 passed, exit 0** |
| 13 | `assignedUserId` is accepted and org-validated on lead **create** (`leads.ts` L178/L180/L196) but was only exercised through PATCH | Create-with-assignment assertions (`assignedUserId` + `assignedUserEmail` in the 201 response), plus null-unassign â†’ null, reassign â†’ 200, foreign reassign â†’ 400 | same run, 84/84 |

   **Falsification review** of `leads.ts`/`patients.ts` (search escaping,
   receptionist 403-before-404 ordering, no-op update short-circuit, count/list
   parameter reuse): no implementation defects found.
2. Fresh `npm run verify` â†’ **exit 0, 84/84 tests (10 suites, 0 skipped)**.
3. Fresh `m3-smoke.ps1` â†’ **exit 0, 0 failures â€” 29/29 PASS**.
4. **Correction (self-found):** revision 13 recorded the smoke as "27/27".
   The saved run logs contain **29** PASS lines (both runs, 0 FAIL). The
   claim "all checks green, exit 0" was correct; the count was not. Corrected
   in `PROJECT_STATE.md`, `M0_Project_Audit.md` and this log at revision 14.

**Result: M3 100% complete, tested, confirmed PASS, defects fixed (7 + 2
coverage gaps closed) â†’ M4 started.** Recorded in `PROJECT_STATE.md`
revision 14 and the audit M3 row PASSED / M4 IN_PROGRESS.

---

## Session 4 â€” 2026-09-27 â€” Milestone 4 (Communication abstraction) implemented and tested

**Owner instruction this session:** "If M3 is 100% completed, tested and
confirmed PASS, defects fixed, then start M4 otherwise fix remaining defects
first."

**M3 gate outcome:** PASS confirmed after re-verification (see Session 3
addendum): coverage gaps closed (defects 12â€“13), fresh verify 84/84, fresh
smoke 29/29 PASS, rev-13 smoke-count miscount corrected. M3 recorded PASSED
(rev 14, commit `d1c551a` pushed, `MATCH=OK`). M4 then started.

### Work executed (M4)

1. **Plan M4 read** â€” "Implement the internal communication architecture. Do
   not immediately depend on a single real provider throughout the system.
   Create provider abstractions and a mock/test provider." Test list: message
   creation, sending, failure handling, delivery status, provider errors,
   idempotency, logging.
2. **Schema** `migrations/0004_communication.sql` â€” `communication_messages`
   (channel SMS/WHATSAPP, recipient, body, status PENDING/SENT/FAILED/
   DELIVERED/UNDELIVERED, provider key/message-id/error, **UNIQUE(org,
   idempotency_key)**, attempts, sent_at/delivered_at, org FK). Applied to
   dev DB (applied 0004, skipped 0001â€“0003, exit 0).
3. **Provider abstraction** `src/communications/`:
   - `types.ts` â€” `CommunicationProvider { key, send(OutboundMessage) }`,
     `ProviderSendResult`, coded `ProviderSendError`.
   - `mockProvider.ts` â€” `MockProvider`: records every attempt, returns
     `mock-<messageId>-<n>` ids, throws coded `mock_recipient_failure` for
     `failOn` recipients (default magic recipient `999999999`).
   - `registry.ts` â€” register/get by key, mock pre-registered, unknown key
     throws.
4. **Message service** `src/services/messages.ts` â€” `createMessage`
   (validates + inserts PENDING, ER_DUP_ENTRY on (org,key) â†’ returns
   existing with `created:false`), `sendMessage` (PENDING/FAILED dispatch â†’
   SENT/FAILED, provider metadata + coded error stored, repeat send on
   SENT â†’ `skipped` without touching the provider), `applyProviderStatus`
   (SENTâ†’DELIVERED/UNDELIVERED only, else 409 `invalid_status_transition`),
   `listMessages`/`getMessage` (org-scoped, status/channel filters,
   pagination). No HTTP routes and no config change (both PROPOSED â€”
   consumers and a second provider arrive later).
5. **Tests** â€” `tests/m4.integration.test.ts` (9 live-DB acceptance tests
   covering all 7 plan categories) + `tests/provider.test.ts` (6 no-DB unit
   tests). Auth/M3 test purges extended to delete `communication_messages`
   before organizations (FK order-independence across suite files).

### Defects found and fixed

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 14 | lint: `ValidationError` imported but unused in `messages.ts` (validators throw it internally) | import pruned | lint exit 0 |

No test failures: first full run after the lint fix was **99/99, exit 0**.

### Verification evidence (commands actually run)

| Check | Command / action | Result |
|---|---|---|
| Migration (dev DB) | `npm run migrate` | exit 0; applied `0004_communication.sql`, skipped 0001â€“0003 (idempotent) |
| Typecheck / lint | after each round | exit 0, final green |
| Full test suite | `npm test` run 1 | **99/99 passed, 12 files, 0 skipped, exit 0** (M3 84 + M4 9 DB + 6 unit) |
| Full gate | `npm run verify` | **exit 0** â€” lint 0, typecheck 0, tests 99/99, build 0 |
| M3 smoke regression | `m3-smoke.ps1` after M4 | **29/29 PASS, SMOKE_PASS, exit 0** (app unaffected) |

### Plan cross-check (M4 scope)

All items implemented and tested: internal communication architecture âœ“;
no dependence on a single real provider (interface + registry + mock) âœ“;
provider abstractions âœ“; mock/test provider âœ“; message creation âœ“, sending âœ“,
failure handling âœ“ (failed status + coded error + retry), delivery status âœ“
(DELIVERED/UNDELIVERED transitions + guards), provider errors âœ“ (coded and
generic paths), idempotency âœ“ (create de-dup + no-double-dispatch send),
logging âœ“ (lifecycle entries asserted). No gaps found.

### Git state produced

| Commit | Contents |
|---|---|
| `8da659e` | M4 source (migration, communications layer, message service), tests (m4 integration + provider unit, purge-order fixes), docs rev 15 (`PROJECT_STATE.md`, audit M4 row, this session entry) |

### Durable doc updates

- `PROJECT_STATE.md` â†’ revision 15 (CURRENT_STATUS M4 complete awaiting
  acceptance, Â§5 M4 block, five Â§8 evidence rows, phase-log note, changelog).
- `M0_Project_Audit.md` â†’ M4 row: complete, report delivered, awaiting
  acceptance.
- `SESSION_LOG.md` â†’ this entry.

### Session end state

- M4 implementation complete; **all gates green**: `npm run verify` exit 0
  (99/99 tests, 12 suites, 0 skipped), migrate idempotent, M3 smoke
  regression 29/29 PASS, no stray processes.
- Committed and pushed: rev 15; remote HEAD verified matching local.
- Next: M4 STATUS REPORTING block â†’ STOP for owner acceptance.
  M5 NOT_STARTED (gate rule).

### Decisions the owner has not yet made

1. Accept (or reject) the M4 report â€” gate on M5.
2. PROPOSED M4 design points: no HTTP message API at M4 (internal layer;
   routes/authz when a consumer needs them); no provider-selection config
   yet (provider injected; config when a second provider exists); status
   lifecycle PENDINGâ†’SENT/FAILED, SENTâ†’DELIVERED/UNDELIVERED only
   (409 otherwise); mock failure recipient `999999999` (test seam, mock
   provider only); channels SMS/WHATSAPP only (no email â€” no mail channel);
   body limit 1â€“4096 chars; per-org idempotency keys.
3. K6 question unchanged (public-repo history rewrite decision).
4. OPEN ISSUES (B2, B4, B6 sub-items) unchanged.

---

### Session 4 addendum — M4 acceptance re-verification (same session)

**Owner instruction:** "If M4 is 100% completed, tested and confirmed PASS,
defects fixed, then start M5 otherwise fix remaining defects first."

**Re-verification performed (fresh, per M2/M3 precedent):**

1. **Fresh plan cross-check** — M4 section re-read: abstraction ✓, no single
   real-provider dependence ✓, provider abstractions + mock/test provider ✓,
   all 7 test categories present ✓. No gaps.
2. **Falsification review** of `mockProvider.ts`, `messages.ts`, `registry.ts`
   — found **defect 15**: shared registry `MockProvider.attempts` array grew
   unbounded (memory growth in a long-running process using the mock).
   → Fixed: cap at 1000 recorded attempts (shift oldest) + dedicated test
   (`provider.test.ts`, 1005 sends → exactly 1000 kept, oldest dropped).
   Concurrent double-`sendMessage` TOCTOU also identified → ASSUMED
   acceptable for M4 (sequential idempotency tested; atomic dispatch claim
   requires a queue claim state — revisit at M8).
3. **Fresh gates:** `npm run verify` exit 0 — lint 0, typecheck 0,
   **100/100 tests (12 suites, 0 skipped)**, build 0 (log
   `%TEMP%\opencode\m4-verify-r2.log`).
4. **Fresh smoke:** `m3-smoke.ps1` → **29/29 PASS, 0 FAIL, SMOKE_PASS,
   exit 0** (log `%TEMP%\opencode\m4-smoke-r2.log`).

**Result: M4 recorded PASSED (rev 16).** M5 (Website lead capture) started
per owner instruction. K-I2 (inbound-HTTPS posture) remains UNKNOWN —
flagged in the report as a deployment blocker for M5's public API only;
local development and tests unaffected.

---

## Session 5 — 2026-09-27 — Milestone 5 (Website lead capture) implemented and tested

**Owner instruction this session:** "If M4 is 100% completed, tested and
confirmed PASS, defects fixed, then start M5 otherwise fix remaining defects
first."

**M4 gate outcome:** PASS confirmed after re-verification (falsification
defect 15: unbounded MockProvider attempts → capped + test; fresh verify
100/100; fresh smoke 29/29). M4 recorded PASSED (rev 16, commit `2ba0d53`
pushed, `MATCH=OK`). M5 then started.

### Plan scope (fresh read)

M5: "Implement a secure mechanism for external websites to create leads"
(Website → Lead API → Validation → Lead → Automation). Test list: valid
lead, invalid lead, spam/rate limiting, duplicate requests, **authentication
where applicable, tenant identification, automation trigger**.

### Work executed (M5)

1. **Migration** `0005_public_site_key.sql` — `organizations.site_key`
   CHAR(64) nullable + unique; backfills existing orgs with
   `SHA2(CONCAT(UUID(),UUID()),256)`. Applied to dev DB (applied 0005,
   skipped 0001–0004, exit 0).
2. **Tenant identification + API authentication (PROPOSED design):** per-org
   random 64-hex site key (`src/security/siteKey.ts`, `randomBytes(32)`),
   sent as `X-Site-Key` header on `POST /api/public/leads`. Missing key,
   unknown key, and disabled-clinic key all return the **same** 401
   `invalid_site_key` (no existence oracle). Key retrievable by the clinic
   owner via `GET /api/organizations/:orgId` (lazy generation if absent,
   race-safe conditional UPDATE + re-read).
3. **Rate limiting (spam):** existing `createRateLimiter` reused — per-IP
   30/min and per-site-key 120/min (60s window, constants in
   `rateLimit.ts`); checked before any DB work; 429 `rate_limited` with
   scoped warn logs (`scope: ip|key`); limits overridable via
   `createApp({ publicLeadRate })` for tests.
4. **Public lead service** `createPublicLead` in `services/leads.ts`:
   validates firstName/lastName/phone(+)/email/requestedService/notes;
   **rejects spoof fields** `status`, `source`, `assignedUserId`,
   `organizationId` (400); forces source=WEBSITE, status=NEW, no assignee,
   `created_by` NULL (column is NULL-able — confirmed in migration 0003);
   reuses the M3 active-duplicate rule (409 `duplicate_lead`, per-org);
   writes a `created` lead activity with NULL actor (column NULL-able —
   confirmed); logs ids only (no phone/email); fires the automation trigger.
5. **Automation trigger** `src/automation/leadCreated.ts` —
   `triggerLeadCreated(logger, {organizationId, leadId, source})` logs
   `automation trigger: lead_created`. M5 delivers the trigger point;
   M6 delivers the actual follow-up behavior (log asserted in tests, phone
   absence asserted too).
6. **Route** `src/routes/public.ts` mounted at `/api/public` (no session
   auth — key-based; express.json 100kb limit applies globally). Response:
   201 `{ leadId }` only — no internal fields exposed.
7. **Tests** `tests/m5.integration.test.ts` — 9 live-DB acceptance tests
   covering all 7 plan categories (valid creation + canonical phone, trigger
   firing + no-sensitive-data logging, NULL-actor activity, invalid/spoof
   rejection, 401 matrix, duplicate 409 + per-tenant scoping, per-key then
   per-IP rate limiting with scoped warn assertions, owner key retrieval +
   lazy generation stability + cross-tenant 404).
8. **Smoke** extended: `m3-smoke.ps1` helpers gained an optional site-key
   header; M5 section added (no-key 401, wrong-key 401, valid 201, duplicate
   409, spoof 400, tenant list shows source=WEBSITE, cleanup delete).

### Defects found and fixed

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 16 | m5 test TS errors under `noUncheckedIndexedAccess` (11×) | optional chaining / explicit undefined-typed casts | typecheck exit 0 |
| 17 | m5 rate test: `orgRateId` inserted with an inline `generateSiteKey()` instead of `keyRate` → all requests 401 before dup logic (test bug, app correct) | insertOrg uses `keyRate` | verify 109/109 |

### Verification evidence (commands actually run)

| Check | Command / action | Result |
|---|---|---|
| Typecheck / lint (source) | `npm run typecheck`, `npm run lint` after source write | exit 0, exit 0 |
| Full gate round 1 | `npm run verify` | exit 2 — 11 TS errors in m5 test (defect 16) |
| Full gate round 2 | `npm run verify` | exit 1 — 1/109 test failed: rate test 401s (defect 17); lint+typecheck green |
| Full gate round 3 | `npm run verify` | **exit 0 — 109/109 tests, 13 files, 0 skipped** (log `%TEMP%\opencode\m5-verify3.log`) |
| Migration (dev DB) | `npm run migrate` | exit 0; applied `0005_public_site_key.sql`, skipped 0001–0004 |
| HTTP smoke (extended) | `m3-smoke.ps1` | **35/35 PASS, 0 FAIL, SMOKE_PASS, exit 0** (29 prior + 6 new M5 checks; log `%TEMP%\opencode\m5-smoke.log`) |

### Plan cross-check (M5 scope)

All items implemented and tested: secure external-lead mechanism ✓, valid/
invalid lead ✓, spam/rate limiting ✓ (per-IP + per-key 429), duplicate
requests ✓ (409 + per-tenant scope), authentication where applicable ✓
(site key; session N/A for public endpoint — stated), tenant identification
✓ (key → org, cross-tenant 404), automation trigger ✓ (fired + logged +
asserted; behavior at M6). No gaps found.

### Known limitations / open items (reported, not blockers for acceptance)

- **CORS not implemented** — plan does not mention it; browser-direct form
  integration from a third-party site would need CORS config; server-side
  proxy integration works today. Integration pattern = owner decision.
- **K-I2 (inbound HTTPS posture) still UNKNOWN** — blocks production
  deployment of the public API, not local dev/testing.
- Concurrent double-submit duplicate TOCTOU (same class as M3 lead create;
  no unique phone constraint by design).
- Rate limiter is in-process (per-instance); multi-instance deployment needs
  a shared limiter (deployment-phase concern, M22).
- No `audit_logs` row for public lead creation (consistent with M3 staff
  lead creation — activity row + logs are the trail; PROPOSED acceptable).

### Git state produced

| Commit | Contents |
|---|---|
| (hash appended after push) | M5 source (0005 migration, siteKey, public route, public lead service, automation trigger, rate-limit constants, app/org wiring), m5 tests, smoke extension lives in `%TEMP%\opencode\m3-smoke.ps1` (outside repo, as before), docs rev 17 |

### Durable doc updates

- `PROJECT_STATE.md` → revision 17 (CURRENT_STATUS M5 complete awaiting
  acceptance, §5 M5 block, §8 evidence rows, phase note, changelog).
- `M0_Project_Audit.md` → M5 row: complete, awaiting acceptance; K-I2 noted
  as deployment blocker only.
- `SESSION_LOG.md` → this entry.

### Session end state

- M5 implementation complete; gates green: verify exit 0 (109/109, 13
  suites, 0 skipped), migrate idempotent, extended smoke 35/35 PASS.
- Next: M5 STATUS REPORTING block → STOP for owner acceptance.
  M6 NOT_STARTED (gate rule).

### Decisions the owner has not yet made

1. Accept (or reject) the M5 report — gate on M6.
2. PROPOSED M5 design points: site-key tenant identification via
   `X-Site-Key`; uniform 401 for invalid keys; limits 30/min per IP and
   120/min per key; spoof-field rejection; duplicate = 409 (M3-consistent);
   201 `{leadId}` response; automation trigger = log-only until M6; siteKey
   exposed on owner org GET.
3. Integration pattern for real websites: server-side proxy (works now) vs
   browser-direct (needs CORS — not in plan).
4. K6 and K-I2 questions unchanged; OPEN ISSUES (B2, B4, B6 sub-items)
   unchanged.

---

### Session 5 addendum — M5 acceptance re-verification (same session)

**Owner instruction:** "If M5 is 100% completed, tested and confirmed PASS,
all defects fixed, then start M6 otherwise fix remaining defects first."

**Re-verification performed (fresh, per established precedent):**

1. **Fresh plan cross-check** — M5 section re-read: all 7 test categories
   (valid/invalid lead, spam-rate limiting, duplicate requests,
   authentication, tenant identification, automation trigger) map to
   executed tests. No gaps.
2. **Falsification review** of `public.ts`, `createPublicLead`,
   `organizations.ts` lazy key generation, rate-limit wiring — no new
   defects. Noted (not defects): SQL site-key lookup is not constant-time
   (timing attack impractical over network — noted only); per-IP 30/min
   shared-NAT throttle consideration (accepted PROPOSED constant);
   receptionist can read siteKey via org GET (no escalation — staff can
   already create leads); automation trigger intentionally fires for
   public leads only (M6 must decide staff/missed-call trigger scope).
3. **Fresh gates:** `npm run verify` exit 0 — **109/109 tests (13 suites,
   0 skipped)** (log `%TEMP%\opencode\m5-verify-r2.log`).
4. **Fresh extended smoke:** **35/35 PASS, 0 FAIL, SMOKE_PASS, exit 0**
   (log `%TEMP%\opencode\m5-smoke-r2.log`).

**Result: M5 recorded PASSED (rev 18).** M6 (Instant lead follow-up)
started per owner instruction.

---

## Session 6 — 2026-09-27 — Milestone 6 (Instant lead follow-up) implemented and tested

**Owner instruction this session:** "If M5 is 100% completed, tested and
confirmed PASS, all defects fixed, then start M6 otherwise fix remaining
defects first."

**M5 gate outcome:** PASS confirmed after re-verification (fresh plan
cross-check, falsification review — no new defects, fresh verify 109/109,
fresh extended smoke 35/35). M5 recorded PASSED (rev 18, commit `38a896b`
pushed, `MATCH=OK`). M6 then started.

### Plan scope (fresh read)

M6: "New Lead → Automation → Immediate acknowledgement → Communication
record." Test list: correct template, correct recipient, correct clinic,
duplicate prevention, provider failure, retry behavior, patient response
handling. Supporting plan sections read: §2 Instant Lead Acknowledgement
(8-step flow, "automation must be configurable rather than hard-coded"),
COMMUNICATION ARCHITECTURE (sendTemplateMessage/handleInboundMessage,
record fields incl. template + related lead + direction), MVP-4 (website
leads, template-based, mock provider allowed, exact example text),
MVP-14 (variables, safe missing-variable handling), MVP acceptance
TEST 1/2 (one ack, no duplicate), history example (OUTBOUND/INBOUND).

### Work executed (M6)

1. **Migration** `0006_communication_lead_link.sql` — `communication_messages`
   gains `direction`, `message_type`, `template`, `lead_id` (FK → leads
   ON DELETE SET NULL + index), status enum gains `RECEIVED`. Applied to
   dev DB (applied 0006, skipped 0001–0005, exit 0).
2. **Template engine** `src/communications/template.ts` — `renderTemplate`
   (missing/null → empty, no brace residue), `LEAD_ACK_TEMPLATE_NAME`,
   MVP-4 default template verbatim. 5 unit tests in
   `tests/template.test.ts` (no DB).
3. **messages.ts extensions** — optional direction/messageType/template/
   leadId/status on `createMessage` (lead org-validated; dynamic column
   list so omitted status keeps DB default); `sendTemplateMessage`
   (render → idempotent create `ack:lead:<leadId>` → dispatch;
   repeat → `created:false`, no second dispatch); `handleInboundMessage`
   (INBOUND/`patient_reply`/`RECEIVED`, auto-links most recent active lead
   by phone org-scoped, optional explicit leadId validated, idempotency
   key required). New DTO fields (direction/messageType/template/leadId).
4. **Automation config** `src/automation/config.ts` — `loadAckConfig`
   from `app_meta` key `automation_ack_config` (JSON); defaults
   `{enabled:true, channel:SMS, provider:mock, sources:[WEBSITE],
   template:<MVP-4>}`; missing/corrupt/invalid-shape → defaults.
5. **Trigger + retry** `src/automation/leadCreated.ts` — full rewrite:
   `triggerLeadCreated` logs `automation trigger: lead_created`
   (DB-sourced source — keeps M5 field contract), config gates
   (disabled/source filter), renders with `first_name` + `clinic_name`,
   sends via config provider, **never throws** (whole body try/catch →
   `error` action) so lead creation can always complete;
   `retryLeadAcknowledgement` (FAILED **and** PENDING rows only —
   explicit call; no scheduled retry until M8).
6. **Wiring (cycle-free layering)** — trigger moved out of
   `services/leads.ts` (M5 in-service call removed) to the route layer:
   public `POST /api/public/leads` and staff
   `POST /api/organizations/:id/leads` both `await` it after insert —
   ALL new leads trigger automation; config `sources` filter decides
   (default acknowledges WEBSITE only, per MVP-4's "when a website lead
   is created"). `ACTIVE_STATUSES` exported from leads.ts for inbound
   auto-linking (no import cycle: routes → automation → messages/leads).
   Lead-detail `communicationHistory` intentionally left `[]` (M3
   deferred state untouched — display wiring is M16+; M6 tests assert
   message rows via the service).
7. **Tests** — `tests/m6.integration.test.ts` (10 live-DB covering all
   7 plan categories) + `tests/template.test.ts` (5 unit). Smoke
   extended earlier at M5; M6 adds no HTTP surface (messages remain
   internal per M4 decision) → smoke run as regression.

### Defects found and fixed

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 18 | First verification round: mysql2 `QueryResult` generic errors in `leadCreated.ts` (3 queries) + 14× `noUncheckedIndexedAccess` errors in m6 test | `RowDataPacket`-extending row interfaces; explicit undefined-typed cast + length assertion | typecheck/lint exit 0; verify 124/124 |
| 19 | Falsification: `retryLeadAcknowledgement` skipped PENDING rows (crash window between message INSERT and dispatch) while labeling them `ack_duplicate` — interrupted acks could never be retried | retry now accepts FAILED **and** PENDING; dedicated interrupted-PENDING test added | verify **125/125 exit 0**; smoke re-run 35/35 |

### Verification evidence (commands actually run)

| Check | Command / action | Result |
|---|---|---|
| Typecheck (post-source) | `npm run typecheck` round 1 | exit 2 — mysql2 generics → fixed |
| Lint | `npm run lint` after fixes | exit 0 |
| Full gate round 1 | `npm run verify` | exit 2 — 14 TS errors in m6 test (defect 18) |
| Full gate round 2 | `npm run verify` | **exit 0 — 124/124 tests, 15 files** |
| Full gate round 3 | `npm run verify` (after defect 19 fix + test) | **exit 0 — 125/125 tests, 15 files, 0 skipped** (log `%TEMP%\opencode\m6-verify3.log`) |
| Migration (dev DB) | `npm run migrate` | exit 0; applied `0006_communication_lead_link.sql`, skipped 0001–0005 |
| HTTP smoke ×2 | `m3-smoke.ps1` before and after defect-19 fix | **35/35 PASS, 0 FAIL, SMOKE_PASS, exit 0** both runs (logs `m6-smoke.log`, `m6-smoke2.log`) |

### Plan cross-check (M6 scope)

All items implemented and tested: immediate acknowledgement ✓ (mock
provider per MVP-4), correct template ✓ / recipient ✓ / clinic ✓
(asserted incl. cross-clinic isolation), duplicate prevention ✓
(idempotent ack key + direct double-trigger + MVP TEST 2 duplicate
submission), provider failure ✓ (FAILED row + coded error, lead
unaffected), retry behavior ✓ (fail→fail→success + interrupted-PENDING
path), patient response handling ✓ (INBOUND/RECEIVED auto-linked,
webhook-key dedup, orphan case), delivery status ✓ (SENT→DELIVERED),
communication record fields ✓ (provider/type/template/lead/status/
timestamps), configurable automation ✓ (app_meta JSON with safe
fallbacks). No gaps found.

### Known limitations / open items (reported, not acceptance blockers)

- Staff notification (§2 step 8) not implemented — not in M6 test list
  (M16+ decision).
- Scheduled retry/queue → M8; inbound webhook transport → M12 (K-I2
  inbound-HTTPS still UNKNOWN); template management UI/API → M16.
- Lead-detail `communicationHistory` remains `[]` (M3 deferred state —
  display integration M16+; message rows fully retrievable via service).
- Trigger awaited in request path (mock is instant; real-provider latency
  → move to queue at M8).
- `app_meta.meta_value` VARCHAR(255): default config JSON fits (~190
  chars, insert executed in tests); longer custom templates need a schema
  change at M16 (noted, not blocking).

### Git state produced

| Commit | Contents |
|---|---|
| (hash appended after push) | M6 source (0006 migration, template engine, config, trigger/retry, message extensions, route wiring), tests (m6 integration + template unit), docs rev 19 |

### Durable doc updates

- `PROJECT_STATE.md` → revision 19 (CURRENT_STATUS M6 complete awaiting
  acceptance, §5 M6 block, §8 evidence rows, phase note, changelog).
- `M0_Project_Audit.md` → M6 row: complete, awaiting acceptance.
- `SESSION_LOG.md` → this entry.

### Session end state

- M6 implementation complete; gates green: verify exit 0 (125/125, 15
  suites, 0 skipped), migrate idempotent, smoke 35/35 PASS ×2.
- Next: M6 STATUS REPORTING block → STOP for owner acceptance.
  M7 NOT_STARTED (gate rule).

### Decisions the owner has not yet made

1. Accept (or reject) the M6 report — gate on M7.
2. PROPOSED M6 design points: trigger at route layer for ALL new leads
   with `sources` config filter (default `['WEBSITE']` per MVP-4);
   ack config in `app_meta` JSON (read-only now; settings API at M16);
   provider from config (mock until providers verified); explicit retry
   (no scheduler until M8); inbound idempotency key required (webhook
   layer supplies at M12); staff notification deferred; lead-detail
   history display deferred.
3. K6, K-I2, CORS questions unchanged; OPEN ISSUES (B2, B4, B6
   sub-items) unchanged.

---

### Session 6 addendum — M6 acceptance re-verification (same session)

**Owner instruction:** "If M6 is 100% completed, tested and confirmed PASS,
all defects fixed, then start M7 otherwise fix remaining defects first.
Docker is running."

**Re-verification performed (fresh, per established precedent):**

1. **Fresh plan cross-check** — M6 section re-read: flow + all 7 test
   categories (correct template/recipient/clinic, duplicate prevention,
   provider failure, retry behavior, patient response handling) map to
   executed tests. No gaps.
2. **Falsification review** of trigger/retry, `sendTemplateMessage`,
   `handleInboundMessage`, config loader, route wiring — no new defects.
   Re-checked: never-throws trigger, duplicate no-dispatch, PENDING retry,
   org-scoped inbound link, RECEIVED not dispatchable, delivery status
   only from SENT, config shape validation, id-only logging, lead-deleted
   mid-trigger → caught error action.
3. **Fresh gates:** `npm run verify` exit 0 — **125/125 tests (15 suites,
   0 skipped)** (log `%TEMP%\opencode\m6-verify-r2.log`).
4. **Fresh smoke:** **35/35 PASS, 0 FAIL, SMOKE_PASS, exit 0**
   (log `%TEMP%\opencode\m6-smoke-r3.log`).

**Result: M6 recorded PASSED (rev 20).** M7 (Appointments) started per
owner instruction (Docker confirmed running by owner).

---

## Session 7 — 2026-09-27 — Milestone 7 (Appointments) implemented and tested

**Owner instruction this session:** "If M6 is 100% completed, tested and
confirmed PASS, all defects fixed, then start M7 otherwise fix remaining
defects first. Docker is running."

**M6 gate outcome:** PASS confirmed after re-verification (fresh plan
cross-check, falsification review — no new defects, fresh verify 125/125,
fresh smoke 35/35). M6 recorded PASSED (rev 20, commit `e088d67` pushed,
`MATCH=OK`). M7 then started.

### Plan scope (fresh read)

M7: "Appointment records, Statuses, Confirmation, Cancellation,
Rescheduling, No-show, Rebooking, Clinic timezone. Test all state
transitions." Supporting sections read: MVP-6 (fields + 6 statuses +
Create/View/Edit/Confirm/Cancel/Mark completed/Mark no-show/Rebook),
MVP AUTOMATION REQUIREMENTS (cancellation/rescheduling awareness,
timezone awareness), TIME AND DATE HANDLING (canonical storage tz,
explicit clinic tz, never assume server tz), MVP UX ACCEPTANCE (tasks
7–10), receptionist/owner role lists, scenarios A/C, TEST 6/7 (cancel/
reschedule stop old workflows), §9 (patient self-service booking out of
scope; rebooking link in scope), B1 (appointments originate in this
system — CONFIRMED).

### Work executed (M7)

1. **Migration** `0007_appointments.sql` — `organizations.timezone`
   VARCHAR(64) NOT NULL DEFAULT 'UTC'; `appointments` (org/patient FK,
   optional lead FK SET NULL, DATE + TIME clinic-local wall clock,
   6-status ENUM, service/provider, `previous_appointment_id` self-FK
   SET NULL, created_by, indexes). Applied to dev DB (applied 0007,
   skipped 0001–0006, exit 0).
2. **Validators** — `parseTimeOnly` (HH:MM[/SS]), `parseTimezone`
   (IANA via `Intl.DateTimeFormat` try/catch).
3. **Service** `src/services/appointments.ts` — create (patient org-
   validated, optional linked lead), list (status/patientId/from/to
   filters, date ASC ordering), get, edit (service/provider while
   SCHEDULED/CONFIRMED only), `APPOINTMENT_TRANSITIONS` map with 409
   `invalid_status_transition` + optimistic `AND status = ?` guard,
   reschedule (transaction + `FOR UPDATE`: old → RESCHEDULED, new
   SCHEDULED linked), rebook (linked new from CANCELLED/NO_SHOW,
   old unchanged), `appointmentsForLead` for lead detail. DTO joins
   patient summary; date via `DATE_FORMAT` (wall-clock safe).
4. **Routes** `src/routes/appointments.ts` (mounted in app.ts):
   route-level authz — receptionist: create/view/confirm/no-show/
   rebook (strict plan reading); owner/admin additionally: cancel/
   complete/edit/reschedule; cross-clinic 404; unauth 401.
5. **Clinic timezone** — organizations GET now returns `timezone`;
   owner/admin-only `PATCH /api/organizations/:orgId` (timezone only,
   unknown fields → 400; lazy siteKey logic extracted to shared
   `loadOrganization`).
6. **Integrations** — lead detail returns real `appointments` array
   (M3 promise; empty array for unlinked — M3 assertion untouched);
   `deletePatient` guarded with 409 `patient_has_appointments`;
   test purges extended (appointments deleted before FK parents in
   auth/m3/m5/m6 suites).
7. **Tests** — `tests/m7.integration.test.ts` (18 live-DB tests).

### Defects found and fixed

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 20 | Typecheck: `PoolConnection` not assignable to `Pool` (reschedule/rebook post-commit loads) | param typed `Pool \| PoolConnection` | typecheck exit 0 |
| 21 | Verify round 1: beforeAll lead creation 400 — staff `POST /leads` requires `source` (**test bug**) | test sends `source: 'MANUAL'` | verify round 2 |
| 22 | Verify round 2: 2 wrong test assertions (`rescheduledFrom` status expected SCHEDULED instead of RESCHEDULED; same missing `source` in second lead) (**test bugs**) | assertions corrected | verify round 3: **143/143** |
| 23 | Falsification: status transition read-then-write race (two concurrent ops could both pass the check) | guarded `UPDATE ... AND status = ?` + affectedRows → 409 | verify round 4: **143/143 exit 0** |

### Verification evidence (commands actually run)

| Check | Result |
|---|---|
| `npm run typecheck` round 1 | exit 2 — defect 20 → fixed |
| `npm run typecheck` final | **exit 0** |
| `npm run lint` | **exit 0** |
| `npm run verify` rounds 1–2 | exit 1 — defects 21, 22 (test bugs) |
| `npm run verify` round 3 | exit 0 — 143/143 (16 suites) |
| Falsification review | defect 23 → guard added |
| `npm run verify` round 4 (final) | **exit 0 — 143/143 tests, 16 suites, 0 skipped** (log `m7-verify4.log`) |
| `npm run migrate` (dev DB) | **exit 0** — applied `0007_appointments.sql`, skipped 0001–0006 |
| HTTP smoke (M7 section added) | **47/47 PASS, 0 FAIL, SMOKE_PASS, exit 0** (log `m7-smoke1.log`) |

### Plan cross-check (M7 scope)

Records ✓, statuses ✓ (6), confirmation ✓, cancellation ✓,
rescheduling ✓ (TEST 7 semantics: old record → RESCHEDULED stops old
workflows; new linked), no-show ✓, rebooking ✓ (from NO_SHOW/CANCELLED,
linked), clinic timezone ✓ (IANA-validated, explicit, default UTC),
"test all state transitions" ✓ (full matrix incl. terminal immunity,
same-state 409s, race guard, authz matrix, tenant isolation). No gaps
found.

### Known limitations / open items (reported, not acceptance blockers)

- **K-I3 contradiction to resolve before M8:** M8 gate row says
  "scheduler capability confirmed (K-I3)" but K-I3 row = Open (cron/
  persistent-process capability UNKNOWN on DirectAdmin). Owner decision
  or investigation needed before M8 starts.
- M8 must implement reminder automation reading these statuses;
  M9 adds no-show workflow messaging; quiet hours are M8.
- No appointment DELETE endpoint (records preserved by design —
  PROPOSED); patient deletion blocked while appointments exist (409).
- Receptionist permission set follows the plan's literal role list
  (no cancel/complete/edit/reschedule for receptionist) — PROPOSED,
  widenable on owner instruction.
- Timezone default 'UTC' for pre-existing orgs — PROPOSED, owner sets
  per clinic (no UI until M16).
- Lead status is not auto-changed to APPOINTMENT_BOOKED when an
  appointment is created (plan silent — not done; PROPOSED to decide).

### Git state produced

| Commit | Contents |
|---|---|
| (hash appended after push) | M7 source (0007 migration, appointments service/routes, timezone endpoint, validators, integrations), `tests/m7.integration.test.ts`, purge extensions, docs rev 21 |

### Durable doc updates

- `PROJECT_STATE.md` → revision 21 (CURRENT_STATUS, §5 M7 block, §8
  evidence rows, phase note, changelog row 21).
- `M0_Project_Audit.md` → M7 row complete/awaiting acceptance.
- `SESSION_LOG.md` → this entry.

### Session end state

- M7 implementation complete; gates green: verify exit 0 (143/143,
  16 suites, 0 skipped), typecheck 0, lint 0, migrate idempotent,
  smoke 47/47 PASS.
- Next: M7 STATUS REPORTING block → STOP for owner acceptance.
  M8 NOT_STARTED (gate).

### Decisions the owner has not yet made

1. Accept (or reject) the M7 report — gate on M8.
2. PROPOSED M7 design points: receptionist permission set (strict plan
   reading), timezone default UTC, no appointment DELETE, patient
   delete guard 409, no auto lead-status change on booking.
3. K-I3 answer (scheduler capability) required before M8 per gate.
4. K6, K-I2, CORS questions unchanged; OPEN ISSUES (B2, B4, B6
   sub-items) unchanged.

---

### Session 7 addendum — M7 acceptance re-verification (same session)

**Owner instruction:** "If M7 is 100% completed, tested and confirmed PASS,
all defects fixed, then start M8 otherwise fix remaining defects first."

**Re-verification performed (fresh):**

1. Fresh plan cross-check — M7 section re-read: all 8 items (records,
   statuses, confirmation, cancellation, rescheduling, no-show, rebooking,
   clinic timezone) + "test all state transitions" map to executed tests.
   No gaps.
2. Falsification review — no new defects (transition guard, transactional
   reschedule/rebook, DATE_FORMAT wall-clock, timezone validation, authz
   matrix, tenant isolation, delete-guard backstop via FK).
3. Fresh `npm run verify` exit 0 — **143/143 tests (16 suites, 0 skipped)**
   (log `%TEMP%\opencode\m7-verify-r2.log`).
4. Fresh smoke **47/47 PASS, 0 FAIL, SMOKE_PASS, exit 0**
   (log `%TEMP%\opencode\m7-smoke-r2.log`).

**Result: M7 recorded PASSED (rev 22).** The audit's M8 gate text was
corrected: it previously read "scheduler capability confirmed (K-I3)"
while K-I3 was Open — it now records K-I3 as still UNKNOWN with the
in-process-scheduler design. M8 (Appointment reminders) started per owner
instruction.

---

## Session 8 - 2026-09-27 - Milestone 8 (Appointment reminders) implemented and tested

**Owner instruction this session:** "If M7 is 100% completed, tested and
confirmed PASS, all defects fixed, then start M8 otherwise fix remaining
defects first."

**M7 gate outcome:** PASS confirmed (rev 22, commit `d744edf` pushed,
`MATCH=OK`). The audit's M8 gate row had been corrected in rev 22 to stop
claiming K-I3 confirmation; K-I3 remains Open. M8 then started on the
in-process-scheduler design (no external-cron dependency).

### Plan scope (fresh read)

M8: appointment reminders at 48h / 24h / 2h, idempotent, quiet hours.
Supporting sections re-read: plan line ~156 (starter package item 3),
automation TRIGGER/WAIT model, TIME AND DATE HANDLING (clinic timezone),
MVP-7 must-not-send list (cancelled / completed / rescheduled-old / not-
permitted / already sent), MVP AUTOMATION REQUIREMENTS, MVP-14 reminder
templates (L2213), TEST 5/6/7 (reminder stops on cancel/reschedule),
section 4.2 messaging questions (quiet hours, consent - B4), D2 (mock
until provider accounts exist - K-I4).

### Work executed (M8)

1. **Migration** `0008_reminders.sql` - `patients.sms_opt_out`
   TINYINT(1) NOT NULL DEFAULT 0; `appointment_reminders` (org FK,
   appointment FK CASCADE, message FK SET NULL, offset_hours,
   scheduled_at DATETIME stored UTC, status ENUM PENDING/SENDING/SENT/
   FAILED/SUPPRESSED/CANCELLED, message_id/attempts/last_error/
   suppression_reason/sent_at, UNIQUE (appointment_id, offset_hours),
   idx (status, scheduled_at)). Applied to dev DB.
2. **Migration** `0009_app_meta_value_size.sql` - `app_meta.meta_value`
   VARCHAR(255) -> TEXT (defect 24, below). Applied to dev DB.
3. **`src/automation/time.ts`** - `zonedToUtc` (2-pass DST-safe clinic
   wall-clock -> UTC), `clinicLocalTime` (Intl), `isWithinQuietHours`
   (normal + overnight-wrap windows; equal start/end never quiet).
4. **`src/automation/reminderConfig.ts`** - `app_meta` key
   `reminder_config`: enabled, channel, provider, offsetsHours
   [48,24,2], quietHours (21:00-08:00, default disabled), templates
   for 48/24/2h (PROPOSED default texts following MVP-14 wording),
   maxAttempts 3. Shape-guarded; missing/corrupt JSON -> defaults
   (mirror of M6 automation config). No HTTP endpoint.
5. **`src/automation/reminders.ts`** - `scheduleRemindersForAppointment`
   (instant = zonedToUtc(date,time,org tz) - offset; past offsets
   skipped; ER_DUP_ENTRY -> idempotent skip), `cancelRemindersFor-
   Appointment` (PENDING/FAILED/SENDING -> CANCELLED + reason),
   `runReminderTick` (config gate; stale-SENDING reclaim >10 min;
   due query PENDING or FAILED-attempts<max; optimistic claim
   `WHERE status = ? AND attempts = ?`; lazy appointment-status
   backstop -> CANCELLED `appointment_inactive`; sms_opt_out ->
   SUPPRESSED `communication_not_permitted`; quiet hours ->
   SUPPRESSED `quiet_hours`; send via `sendTemplateMessage` with
   idempotency `reminder:<id>`, messageType `appointment_reminder`,
   template name `appointment_reminder_<h>h`, variables first_name/
   clinic_name/appointment_date/appointment_time, or `sendMessage`
   retry when message_id exists; FAILED -> backoff 60s*2^(n-1),
   permanent stop at maxAttempts; returns counters).
6. **Route wiring** `src/routes/appointments.ts` - never-throw
   wrappers (M6 pattern): create/reschedule(new)/rebook -> schedule;
   cancel -> `appointment_cancelled`, complete -> `appointment_completed`,
   no-show -> `appointment_no_show`, reschedule(old) ->
   `appointment_rescheduled`; confirm/edit -> nothing.
7. **Patient preference** `src/services/patients.ts` - `smsOptOut`
   boolean on GET/PATCH (owner/admin only; boolean-validated; default
   false; DTO normalizes driver TINYINT/boolean).
8. **Scheduler** `src/index.ts` - in-process tick loop
   (`REMINDER_TICK_MS`, default 60000, 0 disables, `unref()`, cleared
   on shutdown; startup log for scheduled/disabled). No external cron.
9. **Tests** `tests/m8.integration.test.ts` - 16 live-DB tests.
10. **Smoke** - M8 section (2 checks: smsOptOut PATCH true/false with
    GET round-trip assertions) appended before the cleanup marker.

### Defects found and fixed

| # | Defect | Fix | Re-verification |
|---|---|---|---|
| 24 | Pre-gate inspection: `app_meta.meta_value` is VARCHAR(255) but the default reminder config JSON is 614 chars - config writes would fail at runtime | new migration `0009_app_meta_value_size.sql` (TEXT) | `npm run migrate` exit 0 (0009 applied); verify |
| 25 | Typecheck round 1 exit 2: `zonedToUtc` destructured `.split().map(Number)` results are `number \| undefined` under `noUncheckedIndexedAccess` | destructure with defaults (`[y = 0, m = 1, d = 1]`, `[hh = 0, mm = 0, ss = 0]`) | typecheck exit 0 |

Test-iteration fixes (test bugs, app code not at fault - re-execution
verified): (a) "skips offsets" fixture appointment placed at +36h left a
24h row that fell due at the quiet test's synthetic `now+2h` tick,
inflating the send counter -> fixture moved to +6h with date/time both
derived from the same instant; (b) quiet-hours test aborted on an
assertion before `resetReminderConfig`, leaking the enabled quiet window
into later tests -> wrapped in try/finally; (c) failure-recovery test
created its retry appointment on a healthy recipient while the default
mock only fails magic recipient `999999999` -> recovery appointment
moved to the failing recipient, then provider swapped to `failOn: []`
mid-test (restored in finally + afterAll).

### Verification evidence (commands actually run)

| Check | Result |
|---|---|
| `npm run typecheck` round 1 | exit 2 - defect 25 -> fixed |
| `npm run typecheck` final | **exit 0** |
| `npm run lint` | **exit 0** |
| `npm run migrate` (dev DB) | **exit 0** - applied `0008_reminders.sql`, then `0009_app_meta_value_size.sql` (skipped 0001-0007; idempotent) |
| M8 suite isolation round 1 | 11/15 - 3 test bugs (a)(b)(c) above |
| M8 suite isolation round 2 | **15/15** |
| `npm run verify` round 1 | **exit 0 - 158/158 tests (17 suites)** |
| Falsification review | 1 untested code path (lazy `appointment_inactive` backstop) -> test 16 added |
| `npm run verify` final | **exit 0 - 159/159 tests, 17 suites, 0 skipped** (log `m8-verify2.log`) |
| HTTP smoke (M8 section added) | **49/49 PASS, 0 FAIL, SMOKE_PASS, exit 0** (log `m8-smoke.log`; counts verified: 49 `Check` calls = 49 PASS lines) |

### Plan cross-check (M8 scope)

Reminder timing (48h/24h/2h) via clinic timezone with DST-safe
conversion - exact-instant tests (UTC, NY winter, NY summer, Bahrain) -
cancellation stops reminders (eager + lazy backstop; TEST 6 semantics) -
rescheduling stops old + schedules new (TEST 7) - idempotent
(unique key + `reminder:<id>` message key; no resend after SENT) -
failed messages (backoff, max attempts, recovery) - quiet hours
(suppressed in window, delivered outside; default off) - patient
communication preferences (smsOptOut set/read/validated, suppressed
when opted out, resumes when cleared) - MVP-7 must-not-send (cancelled
/ completed / no-show / rescheduled-old / not-permitted / already-sent
all covered; inactive status also caught lazily). No gaps found.
Consent capture at booking remains B4 (default false - PROPOSED).

### Known limitations / open items (reported, not acceptance blockers)

- **K-I3 still UNKNOWN:** M8 ships an in-process scheduler
  (`REMINDER_TICK_MS`, default 60s). Whether the DirectAdmin server
  keeps the Node process alive across restarts/reboots is unverified -
  if it does not, reminders stop when the process stops. Carried to
  the M8 report for the owner to answer (B6 sub-item).
- Quiet hours semantics = suppress during window (literal plan
  reading); defer-to-after-window alternative PROPOSED. Default off -
  owner sets per clinic (no UI until M16).
- Near-bookings: offsets already in the past at creation are skipped
  (fewer reminders inside 48h) - PROPOSED, matches "48h/24h/2h before"
  literally; compressed-schedule alternative (4.2) open.
- Template texts are PROPOSED defaults following MVP-14 wording;
  wording/language approval still owner's (4.2; C1 if WhatsApp).
- `smsOptOut` defaults false; consent capture/booking form consent is
  B4 (data protection) - not implemented.
- No HTTP endpoint to view reminders (PROPOSED: M14 dashboard).
- Partial scheduling failure (DB error mid-loop) logs and does not
  retry - PROPOSED acceptable; not covered by a test.
- Real provider sends still impossible (K-I4: no Twilio/Meta
  accounts); all sends in tests/smoke go through MockProvider.

### Git state produced

| Commit | Contents |
|---|---|
| (hash appended after push) | M8 source (0008+0009 migrations, `src/automation/{time,reminderConfig,reminders}.ts`, appointments route wiring, patients smsOptOut, index tick), `tests/m8.integration.test.ts`, docs rev 23 (PROJECT_STATE, audit M8+K-I3 rows, this entry) |

### Durable doc updates

- `PROJECT_STATE.md` -> revision 23 (CURRENT_STATUS, §5 M8 block, §8
  evidence rows, phase note, changelog row 23).
- `M0_Project_Audit.md` -> M8 row COMPLETE awaiting acceptance; K-I3
  row annotated (M8 shipped in-process scheduler; persistence Open).
- `SESSION_LOG.md` -> this entry.

### Session end state

- M8 implementation complete; gates green: verify exit 0 (159/159,
  17 suites, 0 skipped), typecheck 0, lint 0, build 0, migrate
  idempotent (0008+0009), smoke 49/49 PASS.
- Next: M8 STATUS REPORTING block -> STOP for owner acceptance.
  M9 NOT_STARTED (gate).

### Decisions the owner has not yet made

1. Accept (or reject) the M8 report - gate on M9.
2. PROPOSED M8 design points: default template texts (MVP-14 wording),
   quiet hours default-off + suppression semantics, past-offset
   skipping for near-bookings, smsOptOut default false / consent
   capture (B4), no reminder HTTP view (defer to M14), partial-
   schedule-error logging without retry.
3. K-I3 answer: can the DirectAdmin server keep a Node process alive
   (systemd/nohup/supervisor)? Until answered, reminder delivery
   depends on the process staying up - PROPOSED to confirm before
   production.
4. K6 (history rewrite), K-I2 (inbound HTTPS), CORS pattern, and
   OPEN ISSUES B2/B4/B6 unchanged.

---

### Session 8 addendum - M8 acceptance re-verification (same session)

**Owner instruction:** "If M8 is 100% completed, tested and confirmed PASS,
all defects fixed, then start M9 otherwise fix remaining defects first."

**Re-verification performed (fresh):**

1. Fresh plan cross-check - M8 section (L985-1007) re-read with section 4
   (L156-179), MVP-7 (L2001-2009) and TEST 5/6/7 (L2597-2640): all 8
   test items (correct timing, timezone, cancellation, rescheduling,
   duplicate prevention, failed messages, quiet hours, patient
   communication preferences) map to executed tests; MVP-7's five
   must-not-send rules + "automation must be idempotent" all covered;
   TEST 5 (each reminder exactly once), TEST 6 (no future reminders
   after cancel), TEST 7 (old sequence cancelled, new created, no
   duplicates) covered; sequence is config-driven (offsetsHours in
   reminder_config), not hard-coded - section 4's "avoid hard-coding"
   satisfied. No gaps.
2. Falsification review - schedule/tick/wiring/config/claim/reclaim/
   backoff paths attacked: no new defects. Two notes recorded (not
   defects): reminder config is global per deployment (single app_meta
   key - all clinics share offsets/quiet window/templates; same pattern
   as M6; PROPOSED per-org settings at M16); concurrent-tick
   double-send is guarded by the optimistic SQL claim only (untested
   directly; single in-process scheduler shipped).
3. Fresh `npm run verify` exit 0 - **159/159 tests (17 suites, 0
   skipped)** (log `%TEMP%\opencode\m8-verify-r3.log`).
4. Fresh smoke **49/49 PASS, 0 FAIL, SMOKE_PASS, exit 0**
   (log `%TEMP%\opencode\m8-smoke-r2.log`).

**Result: M8 recorded PASSED (rev 24, commit appended after push).**
M9 (No-show recovery) started per owner instruction: plan section 5
(L183-198), MVP-8 (L2013-2047) and TEST 8 (L2644-2655) are the scope
anchors for the next work block.
