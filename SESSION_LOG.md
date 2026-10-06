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

---

## Session 9 - M8 PASSED recorded; M9 (No-show recovery) implemented

**M8 acceptance recorded first (rev 24):** fresh plan cross-check, fresh
verify 159/159, fresh smoke 49/49, falsification review (no new defects)
-> M8 **PASSED**, docs rev 24, commit `679f4f9` "M8 PASSED (rev 24 docs);
M9 started" pushed, MATCH=OK.

**M9 scope anchors (owner conditional instruction accepted):** plan M9
section (L1010-1031), section 5 No-show reactivation (L183-198, 7 steps),
MVP-8 (L2013-2047: NO_SHOW -> immediate message -> wait configured period
-> follow-up -> stop when rebooked; predefined logic, configurable timing
and templates, no workflow builder), TEST 8 (L2644-2655), MVP-14 message
templates (no-show message + no-show follow-up).

**Work executed (M9):**

- `migrations/0010_no_show_recovery.sql` - `no_show_cases` (UNIQUE
  appointment_id = duplicate-event idempotency, OPEN/REBOOKED/CLOSED,
  rebooked_appointment_id self-FK SET NULL, close_reason/opened/closed)
  + `no_show_messages` (UNIQUE (case_id, phase), PENDING/SENDING/SENT/
  FAILED/SUPPRESSED/CANCELLED, attempts/last_error/suppression_reason).
  Applied to dev DB (exit 0).
- `src/automation/noShowConfig.ts` - app_meta `noshow_config`, defaults
  (enabled, SMS, mock, followUpDelayHours 24, MVP-14 template texts,
  maxAttempts 3), shape guard, corrupt/missing -> defaults, clone/load.
- `src/automation/noShow.ts` - `startNoShowRecovery` (config gate, status
  NO_SHOW required, INSERT IGNORE case -> idempotent `already_started`,
  INITIAL due now + FOLLOW_UP due now+delay, compensating delete on row
  failure, INITIAL processed synchronously for immediate message);
  `closeNoShowCase` (only OPEN closes; reason `rebooked` -> REBOOKED else
  CLOSED; guarded update idempotent; cancels that case's live messages);
  `runNoShowTick` (enabled gate, stale SENDING reclaim >10min, **lazy
  rebook detection** - OPEN case + patient has SCHEDULED/CONFIRMED
  appointment dated >= today -> REBOOKED with that id, due follow-ups
  with optimistic claim + case-still-OPEN + appointment-still-NO_SHOW +
  opt-out checks, `noshow:<id>` idempotent sends, backoff 60s*2^(n-1),
  permanent stop at maxAttempts 3).
- Route wiring (`src/routes/appointments.ts`, never-throw wrappers):
  no-show endpoint starts recovery after reminder cancellation; rebook
  endpoint closes it as REBOOKED; new `POST .../noshow/close` manual
  closure (assertCanManageMembers, optional `reason` default
  `staff_closed`, no OPEN case -> 404).
- `src/index.ts` - the single `REMINDER_TICK_MS` interval now runs both
  `runReminderTick` and `runNoShowTick` (separate catch logs).

**Tests:** `tests/m9.integration.test.ts` - 14 live-DB tests: recovery
start (case + immediate INITIAL with rendered body + follow-up at +24h +
M8 reminder-cancel cross-check); follow-up exactly once after delay;
no-response keeps case open with no extra messages; rebook endpoint
closes REBOOKED and stops automation; lazy detection when staff book via
plain create; manual closure stops automation + repeat 404; duplicate
no-show events (route 409 + service `already_started`, single case and
message); cancellation starts nothing + closed cases stay closed; opt-out
suppresses both phases with no outbound messages; disabled config skips
entirely; corrupt config falls back to defaults; custom delay + missing
variables ({{booking_link}}/{{clinic_phone}} render empty, no brace
residue); failed sends back off and stop at maxAttempts; unknown ids
never throw.

**Defects/iterations (test-side only, no new product defects):** (1)
phase-order assertion assumed alphabetical sort - MySQL ENUM ORDER BY uses
ordinal position (INITIAL first); (2) global tick counters drained prior
tests' due follow-ups (ticks at +25h are always past earlier +24h
follow-ups) - switched to case-scoped assertions; (3) fixture appointment
was past-dated so all reminder offsets were already past (M8 past-offset
skip rule) - no rows to assert cancel against - moved to a future date.
During full verify, M8's global `countMessages()==0` assertion failed
because the new no-show wiring legitimately sends during M8's own no-show
tests - root cause isolated by running m8 alone and inspecting the 2 test
DB messages (both `no_show_message` type) - M8 assertion changed to a
before/after snapshot, preserving the test's intent ("tick sends
nothing"). M8 suite re-passed.

**Gates (all green):** migrate 0010 applied exit 0; typecheck exit 0;
lint exit 0; M9 isolation 14/14; full `npm run verify` **exit 0 -
173/173 tests (18 suites, 0 skipped)** + build 0 (log
`%TEMP%\opencode\m9-verify2.log`); smoke extended with an SQL helper +
10 M9 checks (create patient/appointment, no-show, duplicate 409, case
OPEN, INITIAL SENT, FOLLOW_UP PENDING, manual closure 200, CLOSED,
repeat 404) -> **59/59 PASS, 0 FAIL, SMOKE_PASS, exit 0** (log
`%TEMP%\opencode\m9-smoke1.log`).

**Design decisions reported (PROPOSED until owner approves):** quiet
hours not applied to M9 messages (plan does not require them for M9);
lazy rebook detection uses date >= today at day granularity (not exact
instant) and treats any active future booking - including one that
predates the no-show - as "patient will be seen" and stops automation
(conservative anti-spam choice); config is global per deployment (same
as M6/M8); if the start-after-transition step fails it is logged, not
retried (same class as M8 partial-schedule failures; duplicate no-show
re-POST is blocked by 409 so a manual recovery path would be needed).

**Status: M9 implementation complete - report delivered, STOPPED awaiting
owner acceptance. M10 (Recall automation) does not begin until the owner
accepts the M9 report.**

---

### Session 9 addendum - M9 open items resolved per owner instruction (same session)

**Owner instruction:** "Resolve M9 unresolved issues as proposed."

**Recorded as (docs-only, no code change, rev 26):**

- **D4** - (a) quiet hours NOT applied to M9 no-show messages (M8
  reminders keep quiet hours; plan L594 automation-considerations list
  acknowledged); (b) lazy rebook detection semantics approved as built
  (day granularity `appointment_date >= today` at UTC-date basis; any
  active future booking - including one predating the no-show - closes
  REBOOKED and stops automation, conservative anti-spam choice).
- **D5** - K-I3 handling adopted from the M8 report: confirm DirectAdmin
  process persistence BEFORE production (mapped to M22); status remains
  UNKNOWN until verified; in-process scheduler (`REMINDER_TICK_MS`
  driving reminder + no-show ticks) accepted for plan milestones;
  delivery stops if the process stops.
- **D6** - integration pattern: server-side proxy adopted; CORS stays
  unimplemented by design (adopting the M5 report's proposal);
  browser-direct third-party embedding reopens it only if requested.

**Not resolvable by proposal (reported honestly, unchanged):** K-I2
(inbound HTTPS posture - requires server/owner answer; M12 gate), K-I4
(provider accounts - requires owner-created accounts; M12/M13), B4/K-I5
(consent/retention/position - requires owner legal answer; M22). Audit
rows annotated accordingly.

**Durable doc updates:** `PROJECT_STATE.md` rev 26 (CURRENT_STATUS,
phase note, DECISIONS D4-D6, changelog row 26); `M0_Project_Audit.md`
K-I2/K-I3/K-I4/K-I5 rows; this entry.

**Status:** M9 still awaiting owner acceptance; M10 gate unchanged.
Docs-only change - no code touched; M9 gates stand as reported
(verify 173/173, smoke 59/59).

---

## Session 10 - M9 PASSED recorded; M10 (Recall automation) started

**Owner instruction:** pending M9 issues assessed for deferral - "Whatever
is still pending can it be done at a later stage without creating an ocean
of mistakes or challenges or work. If yes then proceed to the next milestone
if no, resolve the pending issues first."

**Deferral assessment (answer: YES, safe):** K-I3 -> M22 (already mapped by
D5; one deployment check), K-I2 -> M12 (M10 is outbound-only), B4 -> M22
(owner legal answer; M10 reuses the M8 smsOptOut suppression), K-I4 ->
M12/M13 (provider-pluggable layer; M10 ships MockProvider like M6/M8/M9),
CORS already resolved by D6. No code depends on these answers; no rework
cascade. Reported to owner.

**Effect:** M9 **PASSED** per owner conditional instruction; M10 (Recall
automation) started. Docs rev 27 (PROJECT_STATE CURRENT_STATUS/phase note/
changelog row 27; audit M9 PASSED + M10 IN_PROGRESS; this entry).

### Plan scope (fresh read)

- S5 M10 (L1035-1046): recall eligibility, recall date, recall status,
  reminder sequence, rebooking, closure; test date calculations and
  duplicate prevention.
- MVP-9 (L2051-2088): fields patient / recall type / due date / status /
  last contacted / appointment if rebooked; statuses DUE, CONTACTED,
  BOOKED, COMPLETED, CLOSED; workflow overdue -> recall message ->
  follow-up -> patient books -> recall closes; no complex clinical recall
  logic.
- S6 (L201-228): hygiene / routine check-up / treatment follow-up + other
  configurable categories; response -> appointment -> recall closed.
- TEST 9 (L2659-2671): create overdue patient -> recall created ->
  message -> follow-up -> patient books -> recall closes.
- MVP-14 (L2231): "Recall message" template listed; follow-up template
  not listed - PROPOSED to add one (report).
- Plan data model mentions a ` recalls ` table (L2476) with the
  instruction to inspect the existing application first.
- M16 owns recall settings UI; M14 owns recall dashboard metrics - M10
  ships app_meta config like M6/M8/M9 (no HTTP config endpoint).

### Implementation record (rev 28)

- Migration `0011_recall.sql` applied to dev DB (exit 0, idempotent):
  `recalls` (DUE/CONTACTED/BOOKED/COMPLETED/CLOSED lifecycle,
  UNIQUE anchor_appointment_id for duplicate-cycle idempotency,
  rebooked/anchor appointment FKs SET NULL) + `recall_messages`
  (UNIQUE (recall_id, phase), idx (status, scheduled_at)).
- `src/automation/recallConfig.ts` - app_meta `recall_config`:
  enabled / channel / provider / intervalDays (default 180,
  guard 1-3650) / followUpDelayHours (default 72, guard 1-168) /
  templates initial+followUp / maxAttempts 3; shape guard, corrupt
  JSON -> `DEFAULT_RECALL_CONFIG`; no HTTP endpoint (M16 owns UI).
- `src/automation/recall.ts` - `createRecallForCompletedAppointment`
  (config gate; COMPLETED required; open-recall check ->
  `already_exists`; INSERT IGNORE on anchor; INITIAL due_date
  00:00 UTC + FOLLOW_UP +delay; synchronous send when already
  overdue; compensating delete), `closeRecall` (DUE/CONTACTED
  only; statusForReason booked/rebooked->BOOKED,
  visit_completed/completed->COMPLETED, else CLOSED; cancels live
  messages), `closeRecallsForPatientOnBooking` (eager,
  SCHEDULED/CONFIRMED only), `closeRecallOnVisitCompleted` (flip
  BOOKED->COMPLETED + close open as visit_completed),
  `runRecallTick` (stale SENDING reclaim >600s, lazy booking
  close `appointment_date >= today`, due drain with
  attempts < maxAttempts + optimistic claim, batch 100),
  `markContacted`; backoff `60s * 2^(n-1)`; idempotency
  `recall:<id>`; messageTypes recall_message/recall_follow_up;
  opt-out -> SUPPRESSED `communication_not_permitted`; variables
  first_name/clinic_name/due_date/interval_days/recall_type
  (organizations has no phone column -> no clinic_phone).
- Routes (`src/routes/appointments.ts`, never-throw wrappers):
  completion closes the prior cycle then creates the next;
  booking create/reschedule/rebook eager-close;
  new `POST /api/organizations/:orgId/recalls/:recallId/close`
  (assertCanManageMembers; optional reason, default
  `staff_closed`; nothing open -> 404; cross-org -> 404 via
  org guard). `src/index.ts`: third job under the same
  `REMINDER_TICK_MS` interval (own catch log).
- Tests: `tests/m10.integration.test.ts` - 13 live-DB tests;
  **13/13 on the first run (0 test-iteration defects)**.

### Plan cross-check (acceptance self-check)

- §5 M10 line items all mapped to executed tests: eligibility
  (COMPLETED visit + config gate + no open cycle - tests 8, 3),
  recall date (appointment date + intervalDays, due at 00:00 UTC
  - tests 1, 2), recall status (all 5 states + transitions -
  tests 1-8), reminder sequence (INITIAL at due, FOLLOW_UP
  +delay, backoff, stop at maxAttempts - tests 1, 2, 12),
  rebooking (eager route close + lazy out-of-band booking close -
  tests 4, 5), closure (manual staff close + visit-completion
  close - tests 6, 7), date calculations + duplicate prevention
  (tests 2, 3; anchor UNIQUE + service idempotency).
- MVP-9 fields: patient, recall type, due date, status, last
  contacted, appointment if rebooked - all present in the table;
  the 5 statuses are exactly those named; workflow
  overdue -> message -> follow-up -> books -> closes covered
  end-to-end by TEST 9 (test 1); no complex clinical logic
  (single default 'hygiene' type; recall-type taxonomy remains
  M16 settings scope).
- TEST 9 (L2659) executed with synthetic overdue dates - the
  plan explicitly notes test date calculations, so no real-clock
  dependency.
- §6 categories (hygiene / routine check-up / treatment
  follow-up / other): PROPOSED to expose as configurable types
  at M16; M10 stores a free `recall_type` column defaulting to
  'hygiene' (open - see decisions below).

### Falsification review

Attempted to break the claims, results:

- Disabled config bypass: config gate covers create AND tick -
  verified by test 8 (0 rows, no-op tick).
- Duplicate cycle while one is open: service `already_exists`
  and repeat-complete 409 both verified (tests 1, 3); anchor
  UNIQUE is the database-level backstop.
- Manual close abuse: only DUE/CONTACTED closable; repeat 404;
  cross-org 404 (test 6). BOOKED recalls are intentionally not
  manually closable (mirrors M9 OPEN-only close) - recorded as
  PROPOSED semantics.
- Opt-out leak: both phases SUPPRESSED, zero messages (test 11).
- Backoff runaway: attempts capped at 3, tick stops processing
  the row (test 12).
- Corrupt config: falls back to defaults (test 9).
- **No new defects found.**

### Defects

- **None new in M10** (next defect number remains 26). All
  rounds green on first execution: M10 suite 13/13 first run,
  verify 186/186 first run, smoke 72/72 first run.

### Git state produced

| Commit | Contents |
|---|---|
| (hash appended after push) | M10 source (0011 migration, `src/automation/{recallConfig,recall}.ts`, appointments route wiring + recall close endpoint, index third tick), `tests/m10.integration.test.ts`, docs rev 28 (PROJECT_STATE, audit M10 row, this entry) |

### Durable doc updates

- `PROJECT_STATE.md` -> revision 28 (CURRENT_STATUS, M10
  implementation entry, evidence rows x4, phase note, changelog
  row 28).
- `M0_Project_Audit.md` -> M10 row implementation-complete
  awaiting acceptance; M9 row scheduler note amended (recall
  tick added).
- `SESSION_LOG.md` -> this entry.

### Session end state

- M10 implementation complete; gates green: verify exit 0
  (186/186, 19 suites, 0 skipped), lint 0, typecheck 0, build 0,
  migrate idempotent (0011), extended smoke 72/72 PASS.
- Next: M10 status report -> STOP for owner acceptance.
  M11 (Review requests) NOT_STARTED (gate: M10 PASSED).

### Decisions the owner has not yet made

1. Accept (or reject) the M10 report - gate on M11.
2. PROPOSED M10 design points: intervalDays default 180 /
   followUpDelayHours default 72; due date driven by the latest
   completed visit (completion closes the prior cycle, then
   opens the next); single 'hygiene' recall type until M16
   settings; FOLLOW_UP template added beyond MVP-14's single
   "Recall message" line; no HTTP read endpoints for recalls
   (dashboard view belongs to M14/M15); no `clinic_phone`
   variable (no phone column on organizations); BOOKED recalls
   not manually closable.
3. K-I3 unchanged (D5): confirm DirectAdmin process persistence
   before production (M22) - three automation ticks now ride
   the in-process scheduler.

---

## Session 11 - M10 PASSED recorded; M11 (Review requests) started

**Owner instruction:** "proceed to M11" - accepts the M10 report.

**Effect:** M10 **PASSED** per owner conditional instruction (gates at
pass unchanged from rev 28: verify 186/186 (19 suites), migrate 0011
applied, extended smoke 72/72 PASS). Docs rev 29 (PROJECT_STATE
CURRENT_STATUS/phase note/changelog row 29; audit M10 PASSED + M11
IN_PROGRESS; this entry). **M11 (Review requests) started.**

### Plan scope (fresh read)

- S5 M11 (L1050-1061): implement configurable review requests; test
  eligibility, duplicate prevention, timing, opt-out/communication
  preferences, clinic-specific review URL, audit history.
- S7 REVIEW REQUESTS (L232-242): after an eligible appointment -
  (1) determine whether a review request should be sent, (2) respect
  communication/consent rules, (3) send the configured request,
  (4) record the request, (5) prevent duplicate review requests
  within the configured period; the review destination should be
  configurable per clinic.
- MVP-15 (L2250-2264): appointment completed -> wait configured
  period -> send review request; the clinic can configure its
  review URL; the system must prevent repeated review requests
  within the configured period.
- MVP-14 (L2233): "Review request" template listed among the
  template set; standard variables (first_name, clinic_name,
  appointment_date, appointment_time, booking_link, clinic_phone);
  template engine must safely handle missing variables.
- TEST 10 (L2675-2685): complete eligible appointment -> review
  request; second execution must not create a duplicate request
  inside the configured suppression period.
- Scenario A (L1261): appointment completed -> review request.
- M16 (L1171) owns "Review settings" (UI) - M11 ships backend
  config like M6/M8/M9/M10 (no settings UI).
- MVP DATABASE DOMAIN (L2463-2478) has no explicit
  `review_requests` table - established pattern (inspect existing
  first) is a workflow table + communication_messages linkage, as
  for reminders/noshow/recalls.
- S8 dashboard metrics (L252-266) list no review metric - M14
  unaffected.

### Design choices (PROPOSED, to be reported)

- `organizations.review_url` (nullable, org PATCH, owner/admin) as
  the per-clinic destination - mirrors the `timezone` column
  precedent; M16 adds the settings UI.
- `review_config` app_meta: enabled / channel / provider /
  delayHours (wait period, default 24 - PROPOSED) /
  suppressionPeriodDays (duplicate-prevention window, default 180 -
  PROPOSED) / template / maxAttempts 3; shape-guarded with corrupt
  fallback to `DEFAULT_REVIEW_CONFIG`.
- `review_requests` table: UNIQUE (appointment_id) idempotency;
  statuses PENDING/SENDING/SENT/FAILED/SUPPRESSED/CANCELLED; the
  row itself is the "record the request" / audit history (created/
  scheduled/sent timestamps, message_id link, suppression reason).
- Eligibility: appointment COMPLETED + config enabled +
  review_url present; smsOptOut -> SUPPRESSED
  `communication_not_permitted` (row still recorded - consent
  audit); missing review_url -> no row (config not ready).
- Suppression (TEST 10 second execution): per patient - any
  active/sent row within suppressionPeriodDays -> new row
  SUPPRESSED `within_suppression_period`, zero messages; plus
  UNIQUE (appointment_id) for same-appointment re-execution.
- Quiet hours NOT applied to review sends (D4 precedent for M9
  messages; no owner instruction for M11) - PROPOSED to owner;
  only existing quiet-hours config is scoped to reminders.
- Fourth job under `REMINDER_TICK_MS` (in-process scheduler grows
  to reminder + no-show + recall + review ticks) - K-I3 impact
  unchanged (D5, M22).

### Implementation record (rev 30)

- Migration `0012_review_requests.sql` applied to dev DB (exit 0,
  idempotent: 1 applied, 11 skipped): `organizations.review_url`
  VARCHAR(512) NULL + `review_requests` (UNIQUE appointment_id,
  PENDING/SENDING/SENT/FAILED/SUPPRESSED/CANCELLED, scheduled/sent/
  message link/attempts/last_error/suppression_reason/review_url
  snapshot, org/patient/appointment FKs).
- `src/automation/reviewConfig.ts` - app_meta `review_config`:
  enabled / channel / provider / delayHours (default 24, guard
  0-720 - 0 sends synchronously) / suppressionPeriodDays (default
  180, guard 1-3650) / template / maxAttempts 3; shape guard,
  corrupt JSON -> `DEFAULT_REVIEW_CONFIG`; no HTTP endpoint (M16
  owns Review settings UI).
- `src/automation/reviewRequests.ts` -
  `createReviewRequestForCompletedAppointment` (config gate;
  COMPLETED required; per-appointment `already_exists` idempotency;
  no review_url -> `review_url_missing` skip, no row; patient
  suppression window -> row SUPPRESSED `within_suppression_period`
  recorded with zero messages; PENDING with `scheduled_at =
  now + delayHours`; synchronous process when due),
  `processReviewRequest` (optimistic claim; context re-checks:
  inactive/closed/opt-out/url-missing -> CANCELLED or SUPPRESSED;
  send via `sendTemplateMessage` idempotency `review:<id>`,
  messageType `review_request`, variables
  first_name/clinic_name/review_url from the row snapshot; retry
  via existing `sendMessage`; FAILED -> backoff
  `60s * 2^(n-1)`), `runReviewRequestTick` (stale SENDING reclaim
  >600s, due drain PENDING/FAILED<maxAttempts, batch 100).
- `src/validate.ts`: `parseReviewUrl` (absolute http/https,
  <=512, null/empty clears, else 400).
- `src/routes/organizations.ts`: PATCH `/:orgId` accepts
  `timezone` and/or `reviewUrl` (dynamic SET; owner/admin -
  receptionist 403, foreign/unknown org 404); GET returns
  `reviewUrl`.
- `src/routes/appointments.ts`: completion ->
  `safeCreateReviewRequest` (never-throw) after recall wiring.
  `src/index.ts`: fourth job under `REMINDER_TICK_MS` (own catch).
- Tests: `tests/m11.integration.test.ts` - 10 live-DB tests;
  **10/10 on the first run (0 test-iteration defects)**.

### Plan cross-check (acceptance self-check)

- S5 M11 test list all mapped: eligibility (COMPLETED + config +
  review_url - tests 1, 5, 7; non-completed refusal test 1),
  duplicate prevention (UNIQUE appointment + patient window +
  post-window allowance - tests 1, 3), timing (delayHours window
  + not-due/due ticks - test 2), opt-out/communication
  preferences (suppress + resume - test 4), clinic-specific
  review URL (roundtrip, validation, roles, tenant, missing -
  test 7), audit history (row lifecycle fields - tests 1, 8, 9).
- S7 numbered duties: (1) eligibility check in create, (2)
  consent via smsOptOut, (3) configured request sent through the
  provider abstraction with the clinic's template, (4) request
  recorded in `review_requests` (+ message row), (5) duplicates
  prevented within the configured period
  (`suppressionPeriodDays`); destination configurable per clinic
  (`organizations.review_url` via PATCH).
- MVP-15: completed -> wait `delayHours` -> send; clinic
  configures review URL; repeated requests suppressed inside the
  window - covered by tests 2, 3, 7.
- MVP-14 "Review request" template: default template with
  `{{review_url}}` + standard variables; missing variables render
  empty (asserted no `{{` residue - test 1; template.test.ts
  engine coverage from M6).
- TEST 10 executed in tests 1 + 3 (complete -> request; second
  execution / second visit no duplicate inside suppression
  period).
- Interpretations recorded as PROPOSED: audit history = the
  `review_requests` row lifecycle (workflow-table precedent; the
  `audit_logs` table stays staff/auth-only); quiet hours not
  applied (D4 precedent for M9 messages; no M11 instruction);
  default delayHours 24 / suppressionPeriodDays 180 / default
  template text.

### Falsification review

Attempted to break the claims, results:

- Double execution on one appointment: pre-check + UNIQUE catch
  -> `already_exists`, single row (test 1).
- Patient double-visit inside window: second row SUPPRESSED with
  zero messages, recorded not silently dropped (test 3); after
  window expiry the request goes out again (test 3, backdated).
- Opt-out bypass: SUPPRESSED at process time, zero messages;
  resume on opt-in (test 4).
- URL manipulation: non-URL/ftp/overlong rejected 400 before
  storage; cleared URL -> no row; cleared AFTER a row exists ->
  lazy `review_url_missing` suppression at process time (code
  path; create-time path tested).
- Role/tenant bypass: receptionist 403, foreign org 404, unknown
  org 404 (test 7).
- Config bypass: disabled gate covers create AND tick (test 5);
  corrupt config falls back (test 6).
- Backoff runaway: attempts capped at 3, tick stops touching the
  row; retries reuse the same message (count stays 1) (test 9).
- Concurrent claim: optimistic `WHERE status = ? AND attempts = ?`
  guard (same as M8-M10; single in-process scheduler).
- **No new defects found.**

### Defects

- **None new in M11** (next defect number remains 26). All
  rounds green on first execution: M11 suite 10/10 first run,
  verify 196/196 first run, smoke 85/85 first run.

### Git state produced

| Commit | Contents |
|---|---|
| (hash appended after push) | M11 source (0012 migration, `src/automation/{reviewConfig,reviewRequests}.ts`, `parseReviewUrl`, organizations reviewUrl PATCH/GET, appointments completion wiring, index fourth tick), `tests/m11.integration.test.ts`, docs rev 30 (PROJECT_STATE, audit M11 row, this entry) |

### Durable doc updates

- `PROJECT_STATE.md` -> revision 30 (CURRENT_STATUS + K-I3
  4-tick note, M11 implementation entry, evidence rows x4, phase
  note, changelog row 30).
- `M0_Project_Audit.md` -> M11 row implementation-complete
  awaiting acceptance.
- `SESSION_LOG.md` -> this entry.

### Session end state

- M11 implementation complete; gates green: verify exit 0
  (196/196, 20 suites, 0 skipped), lint 0, typecheck 0, build 0,
  migrate idempotent (0012), extended smoke 85/85 PASS.
- Next: M11 status report -> STOP for owner acceptance.
  M12 (Missed-call integration) NOT_STARTED (gate: M11 PASSED;
  plan L1065-1087 additionally requires verified provider
  capabilities first).

### Decisions the owner has not yet made

1. Accept (or reject) the M11 report - gate on M12.
2. PROPOSED M11 design points: delayHours default 24 /
   suppressionPeriodDays default 180; default review-request
   template text; `organizations.review_url` as the per-clinic
   destination (PATCH endpoint now, settings UI at M16);
   audit history interpreted as the `review_requests` row
   lifecycle; BOOKED-style semantics n/a; no recall-style manual
   close endpoint (rows are terminal by lifecycle); quiet hours
   NOT applied to review sends - say the word to add them
   (reminder_config.quietHours exists as the only configured
   window).
3. K-I3 unchanged (D5): confirm DirectAdmin process persistence
   before production (M22) - four automation ticks now ride the
   in-process scheduler.

## Session 12 - M12 Missed-call Integration (design + implementation)

**Owner instruction:** "Proceed to M12" (2026-09-28), accepting the M11
report implicitly; the M11 gate rule satisfied.

**Plan anchors:** S5 M12 (L1065-1099: "Only begin after provider
capabilities have been verified", "Research current official provider
documentation before selecting implementation", flow
Incoming call -> Call event -> Missed call -> Webhook -> Verification ->
Idempotency -> Lead -> Automation -> Message, "Do not assume Bahrain
supports every telephony/SMS feature", 9 test scenarios); S3 missed-call
recovery flow (L109-137, incl. notify clinic + track response as
product-level flow); Scenario B (L1264); MVP-14 missed-call response
template (L2219); MVP-16 mentions missed-call staff notifications
(separate MVP, NOT in M12 scope); TEST 11/12 are milestone-wide
(tenant/roles - covered per-suite).

**Provider capability research (executed 2026-09-28, official docs):**

1. Twilio Call resource (twilio.com/docs/voice/api/call-resource,
   dateModified 2026-06-22, fetched today): call status enum
   queued/ringing/in-progress/completed/busy/failed/no-answer/canceled;
   `no-answer` = "no answer or the call was rejected"; `completed` =
   answered and ended normally; StatusCallback events
   initiated/ringing/answered/completed, default completed, POST
   form-encoded to a configured URL.
2. Twilio webhook security (twilio.com/docs/usage/webhooks/
   webhooks-security, dateModified 2026-08-13): every request signed
   with `X-Twilio-Signature` = HMAC-SHA1 keyed by the account auth
   token over (full webhook URL + form parameters sorted by name,
   each name+value concatenated, no delimiter), base64. No
   timestamp/nonce in the construction -> replay protection must come
   from payload idempotency (Twilio docs tell integrators to
   deduplicate on identifiers such as CallSid - third-party
   verification of the same, webhook.co docs checked 2026-07-22).
3. Vonage Voice API (developer.vonage.com, fetched today) as an
   independent cross-check: explicit event statuses
   started/ringing/answered/completed/busy/cancelled/failed/
   rejected/timeout/unanswered; `rejected` is a first-class event
   (rejected before connection; detail invalid_number/restricted/
   declined/throttled); event webhooks + signed callbacks (JWT) +
   fallback URL. Confirms (a) missed-call events ARE delivered by
   webhook, (b) "rejected" exists as a real provider status
   somewhere in the market, (c) verification schemes differ per
   provider (HMAC vs JWT).
4. Bahrain-specific, Twilio official pages (fetched today):
   SMS guidelines BH: "Two-way SMS supported: **No**"; voice
   guidelines BH: domestic reachability rows N/A, international
   outbound Yes. => For a Bahrain clinic number, Twilio does NOT
   offer two-way SMS and domestic voice is not a supported
   configuration. NOT VERIFIED: equivalent capabilities of local
   carriers (STC/Batelco/Zain) - no official public API docs
   consumed. Consequence: M12 implements the provider-agnostic
   webhook pipeline + a Twilio-compatible adapter (statuses and
   HMAC scheme as documented) and a mock adapter for tests/dev;
   real Bahrain telephony vendor selection stays an OPEN decision
   (owner) and is recorded as such. No capability claims beyond the
   cited docs are made.

**Design (PROPOSED until the M12 report is accepted):**

- Migration `0013_call_events.sql`: `call_events` - org FK CASCADE,
  provider_key + provider_event_id (UNIQUE idempotency), raw +
  canonical status/outcome (VARCHAR: provider status space may
  evolve), caller/called numbers, occurred_at/received_at, status
  RECORDED|PROCESSED|PARTIAL, disposition, lead/patient/message FKs
  SET NULL, last_error, raw_payload TEXT.
- `src/telephony/`: `types.ts` (CallOutcome
  ANSWERED|MISSED|REJECTED|BUSY|FAILED|CANCELED|IN_PROGRESS,
  InboundCallEvent, TelephonyAdapter interface: key, signatureHeader,
  verifySignature, parse), `signature.ts` (Twilio-documented
  HMAC-SHA1 URL+sorted-params, base64), `twilio.ts` (form-encoded
  params, CallSid/CallStatus/From/To/Timestamp, status map:
  completed->ANSWERED, no-answer->MISSED (docs: rejected collapses
  here), busy->BUSY, failed->FAILED, canceled->CANCELED,
  queued/ringing/in-progress->IN_PROGRESS), `mock.ts` (JSON or form,
  same HMAC scheme, header x-mock-signature, statuses incl.
  `rejected`->REJECTED per Vonage-verified semantics), `registry.ts`
  (mirrors communications registry, registers both at load).
- Endpoint `POST /api/webhooks/telephony/:provider/:organizationId`
  (public, IP rate-limited): resolve adapter + active org ->
  telephony_config (app_meta {enabled, signingSecret}) gate 403 ->
  signature verify 401 -> parse 400 -> ingest. Always 200 after
  verification (downstream failure never 5xx's the provider).
- Idempotency: UNIQUE (provider_key, provider_event_id); duplicate ->
  200 {status:'duplicate'} no reprocessing (required because HMAC
  scheme has no replay window - cited above).
- Recovery outcomes MISSED/REJECTED/BUSY (PROPOSED: busy/rejected
  count as unreached calls): resolve in order active lead by phone
  (record `call_missed` activity, no new lead) -> else existing
  patient (link event, NO lead - they are already a patient) ->
  else create lead source=MISSED_CALL status=NEW
  (first_name='Unknown', last_name=caller phone, notes with call
  info - names unknown from caller ID). ANSWERED/IN_PROGRESS/
  CANCELED/FAILED recorded only.
- Automation: dedicated `missed_call_config` app_meta
  {enabled, channel, provider, template} (default template MVP-14
  `missed_call_response`); NOT the generic lead ack (its default
  sources ['WEBSITE'] already excludes MISSED_CALL -> no double
  send); idempotency `missedcall:<provider>:<eventId>`;
  messageType `missed_call_response`; smsOptOut on patient ->
  message suppressed (consent), event still recorded. No new
  scheduler tick - synchronous ingest (K-I3 untouched).
- Retry for provider outage: authenticated
  `POST /api/organizations/:orgId/call-events/:callEventId/retry`
  (owner/admin; receptionist 403) resends a FAILED response through
  the existing sendMessage path.
- Config keys stored in global app_meta like every prior automation
  config (PROPOSED - per-org settings UI belongs to M16; note the
  signing secret is therefore deployment-global, acceptable only
  while the MVP runs single-clinic-per-deployment - flagged for M16).
- Rate limit: new TELEPHONY_WEBHOOK_LIMIT constants (PROPOSED
  120/min/IP).
- Tests will sign with a fixed Host header
  (`x-mock-signature`/`x-twilio-signature` over
  `http://webhook.test<originalUrl>` + sorted params, computed with
  node crypto independently of src code).

**Out of M12 scope (recorded):** clinic staff notifications
(MVP-16, no milestone assigned yet), track-response/read endpoints
for call events, per-org secret UI (M16), real Bahrain provider
contract (owner decision + M22 deployment), inbound SMS replies for
Bahrain (Twilio two-way SMS = No, verified above; M13 owns
WhatsApp).

### Implementation record (M12 build, executed 2026-09-28)

- Migration: `migrations/0013_call_events.sql` - `call_events`
  (org FK CASCADE; UNIQUE (provider_key, provider_event_id);
  provider_status/call_outcome; caller/called numbers;
  occurred_at/received_at; status RECORDED/PROCESSED/PARTIAL;
  disposition; lead/patient/message FKs SET NULL; last_error;
  raw_payload). Applied to dev DB (1 applied, 12 skipped).
- Provider module `src/telephony/`: `types.ts` (CallOutcome +
  RECOVERY_OUTCOMES MISSED/REJECTED/BUSY; TelephonyAdapter),
  `signature.ts` (documented scheme - HMAC-SHA1 over URL + params
  sorted by name, base64, `timingSafeEqual`, empty secret ->
  invalid), `twilio.ts` (`x-twilio-signature`;
  CallSid/CallStatus/From/To/Timestamp; completed->ANSWERED,
  no-answer->MISSED, busy->BUSY, failed->FAILED,
  canceled->CANCELED, queued/ringing/in-progress->IN_PROGRESS),
  `mock.ts` (`x-mock-signature`; answered/missed/rejected/busy/
  failed/canceled/ringing), `registry.ts` (both adapters
  auto-registered), `config.ts` (app_meta `telephony_config`
  {enabled default false, signingSecret}, shape-guarded, corrupt
  -> defaults).
- Ingest `src/services/callEvents.ts`: insert + ER_DUP_ENTRY ->
  idempotent `duplicate` with re-drive when status RECORDED;
  recovery (PROPOSED order): active-lead-by-phone -> lead_updated
  + `call_missed` activity (no new lead) -> existing patient ->
  patient_contacted link, NO lead -> else new lead
  MISSED_CALL/NEW, first_name Unknown, last_name caller phone;
  smsOptOut -> consent_suppressed; automation disabled ->
  automation_disabled; ANSWERED/IN_PROGRESS/CANCELED/FAILED
  recorded only, never recovered. Provider outage -> disposition
  captured + PARTIAL event (message row FAILED), never a 5xx to
  the provider.
- Webhook route `src/routes/webhooks.ts` (public):
  POST /api/webhooks/telephony/:provider/:orgId - IP limiter
  (TELEPHONY_WEBHOOK_IP_LIMIT 200/60s) -> 404 unknown_provider ->
  404 org -> 403 telephony_disabled -> 401 invalid_signature ->
  400 parse -> 200 {status} after verification
  (recorded|processed|partial|duplicate).
- Retry `src/routes/callEvents.ts` (authenticated):
  POST /api/organizations/:orgId/call-events/:callEventId/retry
  - requireAuth + assertCanManageMembers (receptionist 403,
  cross-org 404); no message -> 409; sent -> status PROCESSED,
  last_error NULL.
- Automation `src/automation/missedCall.ts`: `missed_call_config`
  (default template MVP-14 `missed_call_response` via
  MISSED_CALL_TEMPLATE_NAME in template.ts); send idempotency
  `missedcall:<provider>:<eventId>`; retry actions
  sent/failed/duplicate/not_found/error.
- Supporting: `leads.ts` `recordLeadActivity` exported;
  `rateLimit.ts` telephony constants; `app.ts`
  urlencoded(100kb) (form-encoded providers) + router mounts.
  **No new scheduler tick** - K-I3 unchanged (4 ticks:
  reminder, no-show, recall, review-request).
- Tests: `tests/m12.integration.test.ts` - 12 live-DB tests;
  **12/12 on the second run (1 test iteration)**.

### Plan cross-check (acceptance self-check)

- S5 M12 9 scenarios all mapped: answered call recorded (tests
  1, 7 - answered webhook 200, event RECORDED, no recovery);
  missed call + response (test 2 - lead created, SENT message,
  rendered body); rejected -> REJECTED outcome (test 3);
  duplicate webhook -> exactly one event/message, response
  `duplicate` (test 4); invalid webhook -> 401/400/404/403 with
  zero rows created (test 5); provider outage -> PARTIAL +
  FAILED message + authenticated retry after outage clears
  (test 8); unknown caller -> new MISSED_CALL lead (test 2);
  existing patient -> patient_contacted, NO lead (test 6);
  existing lead -> `lead_updated` + `call_missed` activity on
  that lead (test 7). Extras: Twilio form-encoded statuses
  (test 9), tenant binding + receptionist 403 + cross-org 404
  (test 10), `automation_disabled` (test 11), retry without
  message 409 (test 12).
- S3 flow (call event -> webhook -> verification -> idempotency
  -> lead -> automation -> message) executed in tests 2, 4, 6, 7.
- MVP-14 missed-call response template: default
  `missed_call_response`, rendered without `{{` residue
  (test 2).
- Scenario B (missed-call text-back) = tests 1-3, 6-8.
- TEST 11/12 (milestone-wide tenant/roles) covered per-suite
  (test 10 webhook org binding + retry role/tenant checks).
- Plan gate "research current official provider documentation"
  satisfied: research record above (Twilio Call resource +
  webhook security, Vonage statuses, Bahrain pages), fetched
  2026-09-28, cited.
- PROPOSED interpretations recorded: recovery outcomes
  MISSED/REJECTED/BUSY only (busy/rejected = unreached calls);
  lead naming Unknown + caller phone; signing secret in global
  app_meta (per-org UI at M16); NO generic lead-ack for
  MISSED_CALL (its default sources ['WEBSITE'] excludes the
  channel - no double send); webhook always 200 after
  verification (outages become events, not 5xx); disposition
  policy (failure keeps PARTIAL + last_error until retry);
  quiet hours NOT applied (D4 precedent).

### Falsification review

Attempted to break the claims, results:

- Replay/duplicate webhook: UNIQUE (provider, eventId) ->
  `duplicate`, one row, one message; recovery re-driven only
  from RECORDED (test 4). Required because the documented HMAC
  scheme has no replay window (research record).
- Signature bypass: wrong signature 401; empty signing secret
  401 (test 5); `timingSafeEqual` in signature.ts; unknown
  provider answered with 404 before signature handling, no row
  created.
- Tenant escape: webhook bound to :orgId (unknown org 404,
  zero rows); retry requires auth + org membership (receptionist
  403, foreign org 404 - test 10).
- Recovery abuse: answered events never create leads (test 7);
  patient caller links the patient with NO lead (test 6);
  smsOptOut suppresses the response (consent_suppressed) while
  the event is still recorded (test 6); disabled config ->
  automation_disabled, no message (test 11).
- Provider outage: 200 + PARTIAL + FAILED message, never a 5xx;
  owner retry after the outage clears sends and flips PROCESSED;
  later retries are no-op duplicates (test 8).
- Concurrency: ER_DUP_ENTRY insert guard + optimistic re-drive
  under the same single-process assumption as M8-M10 (no new
  scheduler).
- No new product defects found.

### Defects

- **Candidate defect 26 (M3 scope, observed while authoring M12
  tests, NOT fixed):** `createPatient` validates `smsOptOut` on
  create but omits it from the INSERT - create-time opt-out is
  silently dropped (PATCH works). Owner decision required before
  touching M3 code; the M12 test works around it via PATCH.
  (26 provisional: M11 produced no defects.)
- Smoke-script fixes x2 (tooling, not product): PS 5.1
  `New-Object HMACSHA1(byte[])` unrolls the byte array into
  constructor arguments -> replaced with `[HMACSHA1]::new()`;
  config-seed JSON line re-quoted as a single-quoted PS string.
- Environment incident: Docker Desktop engine died mid-session
  (mysql container exit 137, connection refused) - engine +
  `dentalistics-mysql` restarted and the DB re-verified before
  the final smoke run. Not an application defect.

### Gate results

- migrate: 0013 applied to dev DB (1 applied, 12 skipped), exit 0.
- M12 suite isolation: **12/12** (2nd run; 1 test iteration).
- `npm run verify`: exit 0 - lint 0, typecheck 0, **208/208
  tests (21 suites, 0 skipped)**, build 0.
- Extended smoke: **97/97 PASS, 0 FAIL, SMOKE_PASS, exit 0**
  (97 `Check` calls verified; 12 new M12 checks).

### Git state produced

| Commit | Contents |
|---|---|
| (hash appended after push) | M12 source (0013 migration, `src/telephony/*`, `src/automation/missedCall.ts`, `src/services/callEvents.ts`, webhook + retry routes, template/leads/rateLimit/app wiring), `tests/m12.integration.test.ts`, docs rev 31 (PROJECT_STATE, audit M11/M12/K-I2/K-I4 rows, this entry) |

### Durable doc updates

- `PROJECT_STATE.md` -> revision 31 (CURRENT_STATUS: M11 PASSED
  + M12 implementation complete awaiting acceptance; M12
  implementation entry; evidence rows x4; phase note; changelog
  row 31).
- `M0_Project_Audit.md` -> M11 PASSED, M12
  implementation-complete awaiting acceptance, K-I2/K-I4 status
  cells updated.
- `SESSION_LOG.md` -> this entry.

### Session end state

- M12 implementation complete; gates green: verify exit 0
  (208/208, 21 suites, 0 skipped), lint 0, typecheck 0, build 0,
  migrate idempotent (0013), extended smoke 97/97 PASS.
- Next: M12 status report -> STOP for owner acceptance.
  M13 NOT_STARTED (gate: M12 PASSED).

### Decisions the owner has not yet made

1. Accept (or reject) the M12 report - gate on M13.
2. PROPOSED M12 design points: recovery outcomes
   MISSED/REJECTED/BUSY only; lead naming Unknown + caller
   phone; telephony signing secret in global app_meta (per-org
   UI at M16); no generic lead-ack for MISSED_CALL; webhook
   always returns 200 after verification; disposition policy
   (PARTIAL + last_error until retry); quiet hours NOT applied
   (D4 precedent - say the word to add them); webhook rate
   limit implemented at 200/min/IP vs the 120/min design note.
3. Candidate defect 26 (M3 createPatient drops smsOptOut) -
   authorize a fix or defer.
4. K-I2: public HTTPS/DNS still not provisioned (PROPOSED
   re-gate M22); K-I4: real provider accounts not opened
   (fact-gate at M13); Bahrain local-carrier capabilities
   NOT_VERIFIED (Twilio two-way SMS = No is verified).

## Session 13 - M13 WhatsApp Integration (research + implementation)

**Owner instruction:** "save session log, commit, push and proceed to
M13" (2026-09-28), accepting the M12 report implicitly; the M12 gate
rule satisfied. Session log save/commit/push confirmed first:
`2ead319` (M12 source + rev 31 docs) was already pushed with
MATCH=OK and a clean tree before this session began.

**Plan anchors:** L1104-1118 MILESTONE 13 - WHATSAPP INTEGRATION:
"Only implement after current official WhatsApp/Meta/provider
requirements have been verified" (research gate); test list -
template messaging, delivery, incoming response, webhook
verification, duplicate webhook, opt-out, provider failure,
conversation state (8 items). S3 L141-152: architecture abstracts
providers behind internal interfaces (`WhatsAppProvider` is one of
the conceptual interfaces; "exact implementation must be determined
after inspecting the project and verifying provider documentation").
Provider rules L2298-2325: Mock Provider must be available during
development; real provider must be explicitly tested for
production; do NOT assume WhatsApp capability without verification.
MVP-4: mock provider allowed during development, real provider only
after capabilities verified. MVP-10: communication history shows
INBOUND patient replies (direction/channel/type/status/timestamp).
MVP-14 template engine + defaults already exist. TEST 12 (role
authorization) is milestone-wide and maps to M13 per the audit
pattern (M11->TEST 10, M12->TEST 11).

**Research record (to be executed before any M13 code - plan gate):**

Fetch current official Meta/WhatsApp documentation and cite it here:
webhook setup (GET verification challenge + POST signature scheme,
header name, hashing algorithm, secret source), inbound message
payload shape (message id format, text body, sender), delivery
status payloads (sent/delivered/read/failed), template messaging
rules (pre-approved templates, session/window constraints,
opt-in/opt-out policy), error/failure reporting. Capability claims
will be labelled CONFIRMED (cited) / NOT VERIFIED exactly as in
Session 12.

**Current state inspected (CONFIRMED by file read 2026-09-28):**

- `MessageChannel` is already `'SMS' | 'WHATSAPP'` (M4;
  `communications/types.ts`, migration 0004 ENUM) - channel plumbing
  exists end-to-end (createMessage/listMessages/automations).
- `CommunicationProvider` interface = `{key, send()}` only
  (communications/types.ts:35) - no webhook/verify/parse surface;
  `communications/registry.ts` holds the mock SMS provider (key
  `mock`, failOn-recipients defect-15 cap).
- `handleInboundMessage` exists at `services/messages.ts:267`
  (RECEIVED row, direction INBOUND, messageType `patient_reply`,
  auto-links active lead by phone, idempotent on
  org+idempotency_key) but **no HTTP transport calls it** (grep:
  no route references) - M6 carried "inbound webhook transport" to
  a later gate; M12 shipped telephony webhooks only.
- `applyProviderStatus` (messages.ts:367) accepts DELIVERED/
  UNDELIVERED transitions (SENT-only, 409 otherwise) but **no route
  feeds it** either.
- No WhatsApp provider implementation exists (src tree surveyed).
- Opt-out: automations suppress via patient `smsOptOut` regardless
  of channel (M8 precedent); inbound-STOP parsing is NOT specified
  anywhere in the plan (will not be invented).

**Scope mapping (PROPOSED - to be validated against research):**

1. `whatsapp_config` in global app_meta (enabled default false,
   verify token, app secret, phone number id / provider selection;
   shape-guarded; secrets deployment-global like telephony_config,
   flagged for M16 per-org UI).
2. Public webhook endpoints (one org path as in M12):
   GET verification challenge (hub.mode/hub.verify_token/hub.challenge
   style - final names per research), POST signed inbound + status
   events: signature verification (algorithm/header per research,
   timing-safe, empty secret => invalid), 404 unknown org, 403
   disabled, 401 bad signature, 200 after verification (outages ->
   200 + logged, never 5xx - M12 disposition precedent).
3. Provider: `whatsapp` adapter implementing the documented send
   path (real HTTP only when configured; mock adapter for
   development/tests via the existing registry) - NO FAKE
   INTEGRATIONS: no live calls possible without accounts (K-I4).
4. Inbound: route -> handleInboundMessage (existing, idempotent on
   provider message id -> duplicate webhook test).
5. Delivery: status events -> applyProviderStatus (existing
   guards).
6. Opt-out: smsOptOut suppresses WhatsApp sends (existing rule,
   asserted for WHATSAPP channel in tests).
7. Provider failure: mock failOn -> FAILED + coded provider_error
   (existing mechanism, asserted on the WhatsApp path).
8. Conversation state: interpretation to be settled after research
   (candidates: (a) Meta conversation/window phase driving whether
   template vs free-form is allowed - WhatsApp-specific; (b)
   inbound reply recorded + linked so staff can "see whether the
   patient replied" per MVP UX L2738). Will be decided + recorded
   as PROPOSED with rationale; not silently invented.
9. TEST 12 role authorization: add/mapping role tests for any new
   authenticated endpoints; webhook endpoints are public by design.

**Stop condition:** M13 report -> STOP; M14 gated on owner
acceptance of M13.

### Provider capability research (executed 2026-09-28, official docs - plan gate "Only implement after current official WhatsApp/Meta/provider requirements have been verified")

All sources fetched today from Meta/WhatsApp official documentation:

1. **Create a webhook endpoint** (developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint): GET verification handshake =
   `?hub.mode=subscribe&hub.challenge=<str>&hub.verify_token=<str>` -
   compare `hub.verify_token` to the string stored on our server
   (mismatch = invalid). POST events arrive as JSON with header
   `X-Hub-Signature-256: sha256=<hash>` where `<hash>` = **HMAC-SHA256**
   of the payload using the **app secret** as key; validate by
   recomputing and comparing everything after `sha256=`; mismatch =
   invalid payload.
2. **messages webhook reference**
   (developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages,
   updated 2025-10-22): incoming messages =
   `object: whatsapp_business_account` -> `entry[].changes[].value`
   with `contacts[]` (`wa_id`, `profile.name`) + `messages[]`
   (`from`, `id` = `wamid...`, `timestamp`, `type`, `text.body`),
   `field: "messages"`. Outgoing statuses in `value.statuses[]`
   (`id` = wamid of our sent message, `status` one of
   `sent|delivered|read|failed`, `timestamp`, `recipient_id`,
   optional `conversation`, `pricing`, `errors[]` - sample error
   code 131050). One outgoing message can produce up to three
   status webhooks (sent, delivered, read).
3. **Status messages webhook reference** (same docs tree, updated
   2026-05-21): same shape re-confirmed; `conversation` object
   omitted on v24.0+ except free entry point windows.
4. **Webhooks overview** (developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks,
   updated 2026-06-26; documentation/.../webhooks/overview): webhooks
   carry incoming messages + outgoing statuses; **Meta retries
   deliveries -> duplicate webhook notifications are expected**
   (documented) -> idempotency mandatory. mTLS is an optional
   additional layer; app-level HMAC remains required.
5. **Service messages** (developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages,
   updated 2026-05-21): free-form (service) messages may be sent
   **only inside the 24-hour customer service window** that starts
   when the user messages/calls the business and resets on each new
   user message. When the window closes, **only pre-approved
   template messages** may be sent. Send acceptance response != 
   delivery; delivery/read arrive via status webhooks. Default
   message TTL 30 days (if no `delivered` status before TTL, assume
   dropped). Opt-in required before messaging.
6. **Template fundamentals**
   (developers.facebook.com/docs/whatsapp/message-templates/guidelines):
   template messages are WABA assets requiring pre-approval
   (review up to 24h) and are "the only type of message that can be
   sent outside of a customer service window"; messaging limits,
   template pacing/pausing apply to template sends.
7. **Opt-in** (developers.facebook.com/docs/whatsapp/overview/getting-opt-in,
   updated 2026-06-16) + **WhatsApp Business Messaging Policy**
   (whatsapp.com/legal/business-policy): opt-in required; businesses
   "must respect all requests ... to block, discontinue, or
   otherwise opt out" and must provide clear opt-out instructions.
   (Block Users API: messaging a blocked user returns an error -
   developers.facebook.com/documentation/business-messaging/whatsapp/block-users.)
8. **Message API** (developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api):
   `POST https://graph.facebook.com/{Version}/{Phone-Number-ID}/messages`;
   official examples on current pages use `v26.0`/`v25.0`.

NOT VERIFIED (stated): live end-to-end behavior of any of the above
(no Meta app/WABA account exists - K-I4; plan forbids fake
integrations); exact per-scenario error codes beyond the documented
samples; whether local/alternative WhatsApp providers match this
scheme (not researched - Meta Cloud API is the documented target).

### Design decisions (PROPOSED - M13 build)

1. **No migration.** `communication_messages` already carries
   channel ENUM('SMS','WHATSAPP'), status lifecycle (incl.
   DELIVERED/UNDELIVERED/RECEIVED), direction, template, provider
   fields (M4), and `handleInboundMessage`/`applyProviderStatus`
   already exist (M6) - M13 adds the missing HTTP transport,
   provider, config and window state. Conversation window is
   **derived, not stored**.
2. Config `whatsapp_config` in global app_meta (like
   `telephony_config`): `enabled` default false, `verifyToken`,
   `appSecret`, `graph { accessToken, phoneNumberId, apiVersion
   default "v26.0" }`; shape-guarded, corrupt -> defaults; secrets
   deployment-global (M16 per-org UI flagged).
3. Endpoints: `GET|POST /api/webhooks/whatsapp/:orgId` in
   `src/routes/whatsappWebhook.ts` (M12 webhooks.ts untouched);
   dedicated IP limiter constants `WHATSAPP_WEBHOOK_IP_LIMIT`
   (200/60s, same posture as telephony).
4. Raw-body HMAC: global `express.json` gains a `verify` hook that
   stashes the raw Buffer on the request (`rawBody`) before parse;
   signature computed over those exact bytes with `timingSafeEqual`
   after the `sha256=` prefix; missing header / empty configured
   appSecret / mismatch -> 401.
5. GET handshake: unknown org 404; `hub.verify_token` equals
   configured non-empty `verifyToken` -> 200 `text/plain` challenge
   echo, else 403. `enabled` is NOT required for GET (handshake
   precedes activation) - asserted in tests.
6. POST pipeline (M12 precedent: always 200 after verification,
   never 5xx): limiter -> org 404 -> `enabled` false 403 -> bad
   signature 401 -> non-JSON body 400 -> process -> 200
   `{status: ok|duplicate|ignored}`. Processing errors after
   signature are logged, counted, never 5xx.
7. Inbound `type: text` -> existing `handleInboundMessage`
   (channel WHATSAPP, messageType `patient_reply`, status
   RECEIVED, active-lead auto-link by phone), idempotency key
   `whatsapp:<wamid>` (unique per org -> duplicate webhook =
   one row, `{status:"duplicate"}`). Non-text types ->
   `ignored` (counted; media/interactive = post-MVP).
8. Statuses -> our enum (PROPOSED mapping): `delivered`/`read`
   -> DELIVERED (from SENT only; already-DELIVERED or other
   states -> `ignored`, making repeats idempotent - no 409),
   `failed` -> UNDELIVERED (from SENT), `sent` -> ignored (row is
   already SENT at dispatch time), unknown status -> ignored
   (forward compatible). Correlation by
   `(organization_id, provider_message_id)` = wamid; unknown
   wamid -> `ignored`.
9. `WhatsAppProvider` (key `whatsapp`, `src/communications/whatsappProvider.ts`):
   lazy credential loader (registered in `createApp` with the
   request db pool); missing config -> `ProviderSendError
   ('whatsapp_not_configured')` with NO network call; configured ->
   documented `POST /{version}/{phone_number_id}/messages`
   `type: "text"`; non-2xx -> `ProviderSendError('whatsapp_api_error')`;
   success -> `messages[0].id` (wamid) as providerMessageId.
   **Known limitation (PROPOSED):** free-form text is policy-valid
   only inside the customer-service window (cited above);
   business-initiated automation sends outside it require
   pre-approved Meta templates - mapping internal MVP-14 template
   names to Meta template assets needs the owner's WABA account
   (K-I4) and is deferred to the production/provider gate (M22
   report). Mock provider remains the development path per plan.
10. **Conversation state interpretation (PROPOSED):** the plan's
    "Conversation state" test item = the official 24-hour customer
    service window state: derived from the newest INBOUND
    `channel='WHATSAPP'` message per recipient (`created_at` =
    arrival time; window = last inbound + 24h, resets on each new
    inbound per docs). Surface: authenticated
    `GET /api/organizations/:orgId/conversation-state?phone=`
    -> `{phone, lastInboundAt, windowExpiresAt, windowOpen}`
    (all staff roles may read; 401 unauth, 400 bad phone, 404
    unknown/foreign org). Alternative interpretation (inbound reply
    simply visible per MVP-10) is covered by the inbound test
    anyway. Endpoint also gives TEST 12 (role authorization)
    surface: receptionist/owner/admin 200, foreign-org 404,
    unauth 401.
11. Opt-out: no code change - existing `smsOptOut` suppression is
    channel-agnostic; asserted on the WHATSAPP path in tests.
12. Provider failure: existing `sendMessage` FAILED +
    `provider_error` capture asserted on the WHATSAPP path via
    mock `failOn`; plus the `whatsapp_not_configured` guard test.
13. No new scheduler tick (synchronous webhooks only; K-I3
    unchanged at 4 ticks).

### Session 13 - M13 implementation record (2026-09-28, same session)

**Instruction executed:** owner "save session log, commit, push and proceed to M13"
(= M12 accepted at `4a79181`; rev 32 recorded). M13 research + design recorded
above; implementation, gates and docs rev 33 completed in the same session.

**Implementation (CONFIRMED - tool inspection + executed tests):**
- No migration: 0004/0006 already provide channel ENUM('SMS','WHATSAPP'),
  status incl. RECEIVED, direction, template, provider columns
  (migrate applied 0 / skipped 13, idempotent x2).
- New: `src/communications/whatsappConfig.ts` (app_meta `whatsapp_config`,
  shape-guarded, corrupt -> defaults), `whatsappSignature.ts` (raw-body
  HMAC-SHA256 `sha256=<hex>`, timing-safe compare), `whatsappPayload.ts`
  (entry/changes/value parser), `whatsappProvider.ts` (key `whatsapp`),
  `src/routes/whatsappWebhook.ts` (GET|POST `/api/webhooks/whatsapp/:orgId`),
  `src/routes/conversationState.ts` (GET
  `/api/organizations/:orgId/conversation-state?phone=`),
  `tests/m13.integration.test.ts` (8 tests).
- Modified: `src/app.ts` (express.json `verify` hook -> rawBody Buffer;
  WhatsAppProvider registered with config loader when `deps.db` present;
  router mounts with dedicated limiters), `src/security/rateLimit.ts`
  (`WHATSAPP_WEBHOOK_IP_LIMIT` 200 / `WHATSAPP_WEBHOOK_RATE_WINDOW_MS` 60000).
- All 13 PROPOSED decisions above implemented as written; none changed.

**Plan cross-check (test list L1108-1117 + TEST 12):**
- Template messaging -> "sends a WhatsApp template message and records the
  provider contract" (stubbed fetch: URL `graph.facebook.com/v26.0/424242/
  messages`, Bearer auth, messaging_product/type/to/text.body; row: channel
  WHATSAPP, OUTBOUND, SENT, template `greeting_v1`, provider_key `whatsapp`,
  provider_message_id = `messages[0].id`, sent_at set) + automation path
  (missed-call channel=WHATSAPP -> SENT, message_type missed_call_response).
- Delivery -> "applies delivery statuses from webhook events with idempotent
  handling": delivered -> DELIVERED + delivered_at; failed -> UNDELIVERED
  (delivered_at null); sent -> ignored (stays SENT); read -> DELIVERED;
  duplicate delivered -> applied 0 / ignored 1 (no 409); unknown wamid ->
  ignored.
- Incoming response -> "stores an incoming WhatsApp reply and links the active
  lead": 200, inbound.created 1; row RECEIVED / patient_reply / WHATSAPP /
  INBOUND / recipient normalized; active lead auto-linked (lead_id); non-text
  (type image) -> ignored, no row.
- Webhook verification -> "verifies webhook setup and rejects invalid
  signatures": GET 200 text/plain challenge; wrong token 403; missing
  challenge 400; unknown org 404; POST valid 200; garbage sig 401;
  wrong-secret sig 401; missing header 401; empty configured appSecret 401;
  malformed payload 400; disabled 403; unknown org 404.
- Duplicate webhook -> "ignores duplicate inbound webhooks without
  reprocessing": second POST inbound.created 0 / duplicate 1; DB count for
  `whatsapp:<wamid>` = 1.
- Opt-out -> "suppresses outbound WhatsApp automation for opted-out patients":
  patient smsOptOut + missed-call automation channel=WHATSAPP ->
  consent_suppressed, zero message rows; opted-in patient -> channel WHATSAPP
  SENT (config restored to SMS after).
- Provider failure -> "records provider failure for unconfigured WhatsApp and
  provider errors": `getProvider('whatsapp')` unconfigured -> FAILED,
  provider_error contains `whatsapp_not_configured` (no network call);
  mock failOn on WHATSAPP -> FAILED, `mock_recipient_failure`; stubbed fetch
  503 -> FAILED, `whatsapp_api_error`.
- Conversation state -> "returns WhatsApp conversation state with role
  authorization": open window + windowExpiresAt - lastInboundAt = 24h;
  backdated 25h -> windowOpen false, expiresAt < now; no history -> nulls +
  false; 401 unauth, 400 bad phone, 404 unknown org, 404 foreign member;
  200 owner + receptionist + administrator.
- TEST 12 -> same surfaces cover Owner/Receptionist/Administrator appropriate
  reads and unauthorized actions (401 unauth, 404 cross-org, webhook 401/403).
- MVP-4 fields (recipient, provider, providerMessageId, status, template,
  timestamp/sent_at, lead) asserted in template + delivery tests; MVP-10
  INBOUND patient_reply handled by existing service via the new webhook.

**Gates executed (2026-09-28):**
- `npm run verify` -> exit 0: lint 0, typecheck 0, **216/216 tests, 22
  suites, 0 skipped**, build 0 (new file: m13.integration.test.ts 8/8).
- `npm run migrate` run twice -> applied 0, skipped 13, exit 0 both
  (no M13 migration - expected).
- Extended smoke (`m3-smoke.ps1`, +18 M13 checks: config seeded, handshake
  200/challenge/403/404, inbound 200/RECEIVED/WHATSAPP/duplicate 1, outbound
  seeded, delivery 200/DELIVERED, bad sig 401, disabled 403, conversation
  state 200/open/401/400) -> **115/115 PASS, 0 FAIL, SMOKE_PASS, exit 0**
  (log: `%TEMP%\opencode\m13-smoke-run1.log`).

**Falsification review:**
1. "GET handshake might require enabled" - no; design + docs: GET validates
   only org + verify_token. Disabled tested on POST (403). Documented.
2. "Duplicate status webhook might 409" - pre-check SENT-only returns
   `ignored` (tested: applied 0, ignored 1, status unchanged).
3. "Signature might be computed over re-serialized JSON" - tests POST the
   exact raw bytes they sign; smoke signs the exact file bytes curl sends;
   raw body captured via express.json `verify` hook; empty rawBody -> invalid.
4. "Conversation-window interpretation might be wrong" - PROPOSED,
   source-cited (24h customer service window), derived from newest inbound
   WHATSAPP message; alternative (MVP-10 visibility) covered by inbound test
   anyway. Awaiting owner confirmation at acceptance.
5. "Provider tests might touch the network" - WhatsAppProvider tests use
   stubbed fetch (success + 503); not_configured path is no-network by
   design. Live Meta behavior remains NOT VERIFIED (no account, K-I4).
- No new defects found. Candidate defect 26 (M3 `createPatient` drops
  `smsOptOut` in INSERT) remains open - M3 scope, owner decision pending.

**Defects:** none new in M13. Candidate 26 still open (not fixed).

**Git:** working-tree changes = 6 new src files + 1 new test + `app.ts` +
`rateLimit.ts` + `PROJECT_STATE.md` (rev 33) + `M0_Project_Audit.md` +
`SESSION_LOG.md` (this entry). Commit + push + MATCH check recorded in the
M13 report.

**Status:** M13 implementation complete; report delivered; awaiting owner
acceptance. M14 must not begin until the owner accepts the M13 report.

**Session end** - 2026-09-28.

### Session 14 - start (2026-09-28)

**Owner instruction:** "save session log, commit, push and proceed to M14" -
recorded as M13 acceptance (M13 PASSED; commit `180766f` verified pushed with
MATCH=OK immediately before this instruction).

**M14 scope (plan anchors, CONFIRMED by file read):**
- M14 section L1121-1140: "Implement the owner dashboard"; required metrics:
  Leads, Lead responses, Appointments, Confirmations, No-shows, Rebookings,
  Recall, Messages, Delivery, Failures; "Every metric must have a documented
  definition"; "Verify dashboard calculations against database fixtures".
- Section 8 (L246-272): 13 initial metrics (new leads, leads contacted, lead
  response rate, appointments booked, confirmations, no-shows, rebooked,
  recall opportunities, recall appointments, messages sent/delivered/failed,
  patient replies); trends over time where possible; avoid vanity metrics;
  every metric clearly defined.
- MVP-12 (L2155-2190): grouped metrics - Leads: new / contacted / converted
  to appointments; Appointments: scheduled / confirmed / completed / no-show /
  rebooked; Communication: sent / delivered / failed / patient replies;
  Recall: patients due / contacted / booked; no dozens of metrics; explicit
  calculation definitions.
- MVP USERS (L1675-1710): Clinic Owner "View dashboard"; Receptionist list has
  no dashboard entry; System Administrator manages integrations/logs.
- MVP UX acceptance (L2744): owner opens the dashboard and understands the
  current situation without reading technical logs (qualitative).
- Test structure: the plan's TEST list ends at TEST 12 - there is NO TEST 13.
  M14 verification = the plan's own fixture-verification requirement +
  section 7 / MVP-12 / section 8 mappings. L1233 "Dashboard calculations"
  belongs to M19 (performance); L1312 "Dashboard" to M21 (UX review).

**Interpretation (PROPOSED - owner may reject at acceptance):** M14 delivers
the dashboard METRICS API (metrics + documented definitions + fixture-verified
calculations), consistent with the M3-M13 precedent of delivering plan screens
as API payloads. No frontend exists anywhere in the repository (`App/` never
existed; plan L378 "Identify frontend architecture" found none), and
introducing a frontend framework is a stack decision reserved for the owner
(carried; M15 receptionist interface and M21 UX review depend on it).

**Current state (CONFIRMED by inspection):** no dashboard code exists;
`src/services/` has leads / appointments / recalls / noShow / reviewRequests /
callEvents / messages / patients with the data needed for all 10 metrics;
routes mount at `/api/organizations` with `requireAuth` + tenant middleware;
reads currently allowed for all clinic members (dashboard will use owner/admin
per MVP USERS - PROPOSED).

**Session 14 plan:** docs rev 34 (M13 PASSED, M14 IN_PROGRESS) -> commit +
push -> M14 design + implementation + tests -> gates -> docs rev 35 ->
commit + push -> Rule-10 report -> STOP (M15 gated on M14 acceptance).

### Session 14 - design decisions (PROPOSED - M14 build)

1. **Scope interpretation (PROPOSED):** M14 = dashboard METRICS API
   (metrics + documented definitions + fixture-verified calculations); no
   frontend. Basis: M3-M13 precedent (plan screens delivered as API payloads),
   repository has no frontend architecture, plan L378 instruction unresolved.
   Owner may reject at acceptance; M15/M21 depend on the stack decision.
2. **Endpoint:** `GET /api/organizations/:orgId/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD`.
   Both optional: default `to` = today (UTC), `from` = `to` - 29 days
   (30-day window). Validation (ValidationError -> 400): both must parse as
   dates, `from <= to`, span <= 366 days.
3. **Authorization (PROPOSED strict reading of MVP USERS):** `requireAuth` +
   `assertCanManageMembers` - Owner 200, platform Administrator 200,
   Receptionist 403 (dashboard is not in the receptionist capability list),
   foreign-org member 404, unauthenticated 401.
4. **Response shape:** `{window, metrics, definitions, trends}` where
   `window` = {from, to, basis}, `definitions` = {metrics: {key -> text},
   planMetrics: {plan metric name -> [keys]}} always returned (plan: "Every
   metric must have a documented definition"), `trends.daily` = per-UTC-date
   zero-filled buckets {date, newLeads, messagesSent, patientReplies} for the
   whole window (span cap keeps bucket count <= 367).
5. **Time basis (documented in window.basis):** timestamp columns compared as
   UTC instants `[from 00:00 UTC, to+1d 00:00 UTC)`; `appointment_date` and
   `due_date` (DATE, clinic-local wall values) compared as an inclusive date
   range (M7 no-conversion precedent).
6. **Metric definitions (exact, PROPOSED):**
   - leads.new: leads with created_at in window.
   - leads.contacted: DISTINCT leads having a lead_activities row
     action='status_changed' with created_at in window (any lead creation
     date - "progressed during the period").
   - leads.converted: leads CREATED in window that have >= 1 linked
     appointment (appointments.lead_id set) - cohort conversion.
   - leads.responseRate: leadResponses / leads.new (4-dp; null when new = 0).
   - leadResponses: INBOUND messages with lead_id NOT NULL, created_at in
     window.
   - appointments.booked: appointments with created_at in window (all
     statuses) - section 8 "Appointments booked".
   - appointments.scheduled/confirmed/completed/noShows: appointment_date in
     range AND current status = SCHEDULED/CONFIRMED/COMPLETED/NO_SHOW
     (point-in-time current status; no status history exists - documented
     limitation).
   - appointments.rebooked: appointment_date in range AND
     previous_appointment_id NOT NULL (new rows linked by reschedule or
     rebook; may overlap status buckets - documented).
   - recall.due: recalls with due_date in range (any current status).
   - recall.contacted: recalls with last_contacted_at in window.
   - recall.booked: recalls status='BOOKED' with closed_at in window.
   - messages.sent: OUTBOUND messages with sent_at in window (sent_at is set
     only on successful dispatch).
   - messages.patientReplies: INBOUND messages with created_at in window.
   - delivery.delivered: OUTBOUND messages with delivered_at in window.
   - delivery.deliveredRate: delivered / sent (4-dp; null when sent = 0).
   - failures.failed: OUTBOUND messages status='FAILED' with updated_at in
     window (approximation - no failed_at column exists; documented).
   - failures.failedRate: failed / (sent + failed) (4-dp; null when 0).
7. **Plan-metric mapping (documented in definitions.planMetrics):** Leads ->
   leads.*; Lead responses -> leadResponses; Appointments ->
   appointments.booked/scheduled/completed; Confirmations ->
   appointments.confirmed; No-shows -> appointments.noShows; Rebookings ->
   appointments.rebooked; Recall -> recall.*; Messages -> messages.*;
   Delivery -> delivery.*; Failures -> failures.*.
8. **Trends:** daily series for newLeads / messagesSent / patientReplies
   only (section 8 "where possible"; three core series - avoids the plan's
   "vanity metrics" and "dozens of metrics" warnings).
9. **Queries:** one small filtered query per metric group + 3 grouped trend
   queries (~10 per call); acceptable at MVP scale (M19 performance gate).
   All counts coerced with Number() (SUM may return DECIMAL strings).
10. **Structure:** no migration (all source tables exist); `src/services/
    dashboard.ts` (DASHBOARD_METRIC_DEFINITIONS + getDashboard),
    `src/routes/dashboard.ts` (mounted at `/api/organizations`), no new
    scheduler tick; `tests/m14.integration.test.ts` = the plan's fixture
    verification; smoke extended with M14 checks; docs rev 35 at completion.

### Session 14 - M14 implementation, gates, completion

**Delivered (PROPOSED interpretation confirmed by passing gates, owner acceptance pending):**

- `src/services/dashboard.ts`:
  - `resolveDashboardRange(from, to)` - optional params; default `to` = today UTC,
    `from` = `to` - 29 days (30-day window); `parseDateOnly` validation (400 on
    malformed/impossible dates), `from <= to` (400), window capped at 366 dates (400).
  - `DASHBOARD_METRIC_DEFINITIONS` - a documented definition for every metric key
    (21 metric leaves + 3 trend keys) and `DASHBOARD_PLAN_METRICS` mapping the plan's
    10 metric names (Leads, Lead responses, Appointments, Confirmations, No-shows,
    Rebookings, Recall, Messages, Delivery, Failures) to their value keys; both always
    returned in the `definitions` object (plan: "Every metric must have a documented
    definition").
  - `getDashboard` - ~10 org-scoped SQL queries in one `Promise.all` (leads new /
    converted / contacted, appointments booked, appointment status+rebooked by date,
    recall due/contacted/booked, message sent/replies/lead-replies/delivered/failed,
    3 grouped trend series); rates rounded to 4 dp with null on zero denominators;
    zero-filled daily trends for the whole window (DATE_FORMAT '%Y-%m-%d' buckets).
  - Metric definitions exactly as recorded in the Session 14 design block above
    (timestamp columns = UTC instant windows; appointment_date/due_date = inclusive
    date ranges; `leads.contacted` anchored on status_changed activities regardless of
    lead creation date; `leads.converted` = leads created in window with >= 1 linked
    appointment; failures = OUTBOUND FAILED by updated_at, documented approximation;
    rebooked may overlap status buckets, documented).
- `src/routes/dashboard.ts` + `src/app.ts` mount: GET
  `/api/organizations/:orgId/dashboard?from&to` behind `requireAuth` +
  `assertCanManageMembers` (Owner 200, platform Administrator 200, Receptionist 403
  per MVP USERS capability list, foreign-org member 404, unauthenticated 401).
- `tests/m14.integration.test.ts` - **12 tests, all fixture-verified per plan
  ("Verify dashboard calculations against database fixtures")**: exact in-window
  metrics (all 20 values + 3 rates) against hand-built fixtures with in-window AND
  out-of-window rows (past period + future period both excluded correctly), zero
  window, daily-trend sums equal window totals + per-date assertions, definitions
  coverage for every leaf + all 10 plan names mapped, default 30-day window,
  admin/receptionist/foreign/unauth roles, 4 validation 400s, org scoping.
- Smoke: +11 M14 checks inserted before cleanup -> **126 total** (role checks,
  validation checks, default-window echo, API-vs-SQL cross-check for leads.new and
  messages.sent, definitions presence, trend length).

**Gate results (actual, executed):**
- `npm run verify` = lint 0 + typecheck 0 + test **228/228 passed, 23 suites,
  0 failed, 0 skipped** + build 0; exit 0.
- `npm run migrate` x2: applied 0 / skipped 13, exit 0 both runs (no M14
  migration - all source tables pre-date M14).
- Extended smoke: **126/126 PASS, 0 FAIL, SMOKE_PASS, exit 0** (log
  `m14-smoke-run2.log`; run 1 failed on 2 checks - see smoke-script fix below).

**Falsification review (results):**
- UTC window basis CHALLENGED and CONFIRMED: DB `@@system_time_zone = UTC`,
  `@@time_zone = SYSTEM`, `NOW() = UTC_TIMESTAMP()`; app pool sets `timezone: 'Z'`;
  DATETIME columns are wall-clock (no tz conversion on compare) - the documented
  `window.basis` "UTC instants" claim is evidence-backed, not assumed.
- Fixture tests caught a real product bug during development: trend queries used
  SQL `DATE()`, whose DATE-typed results mysql2 returns as JS Date objects -> all
  daily map lookups missed -> trends all zero while metric totals were correct.
  **Defect 27** (in-new-code, found by fixture tests before commit): fixed with
  `DATE_FORMAT(..., '%Y-%m-%d')` (string keys); re-ran suite green.
- Smoke run 1 exposed a **smoke-script fix** (PS 5.1 only, script not product):
  in an expandable
  string `"$m14DashUrl?from=abc"`, PowerShell parses `m14DashUrl?from` as ONE
  variable name -> URL became `=abc` -> curl 000. Fixed with braced
  `"${m14DashUrl}?from=..."`; run 2 = SMOKE_PASS (precedent: row 31 smoke-script
  fixes, unnumbered).
- Test-iteration fixes (not defects): past-window failedRate expectation (0 not
  null when sent>0), future-window date-sign arithmetic in the test itself,
  lexicographic sort order of plan-metric names ('Rebookings' < 'Recall').
- Route conflicts, tenant scoping, authz precedence (403 before 400 on bad range),
  SQL parametrization, definitions completeness: all covered by passing tests;
  no further issues found.

**Plan cross-check:** M14 plan L1121-1140 (10 metrics each documented + fixture
verification) -> covered (definitions map + fixture test); section 8 L246-272 (13
initial metrics, trends where possible, no vanity metrics, defined calculations) ->
all 13 present (new leads, leads contacted, lead response rate, appointments booked,
confirmations, no-shows, rebookings, recall due/contacted/booked, messages sent,
delivery rate, failure rate) + 3 core trend series + definitions map; MVP-12 groups
(leads new/contacted/converted; appointments scheduled/confirmed/completed/no-show/
rebooked; communication sent/delivered/failed/patient replies; recall due/contacted/
booked) -> all present; MVP USERS (Owner dashboard) -> owner/admin read, receptionist
403 (PROPOSED strict reading - receptionist capability list has no dashboard); MVP UX
L2744 qualitative -> untestable programmatically, relies on definitions being
returned with the payload; no TEST 13 exists (test list ends at TEST 12) -> fixture
test + section 7 / MVP-12 / section 8 mapping govern.

**Unresolved / carried:** frontend stack decision UNKNOWN (plan L378; M15/M21
depend on it - owner decision required); defect 26 candidate (M3 `createPatient`
drops `smsOptOut`) unchanged, owner decision pending; K-I2 UNKNOWN (re-gate M22);
K-I4 open (re-gate M22); K-I3 UNKNOWN (D5 -> M22); B4 -> M22. No migration, no
scheduler changes, no new config keys in M14.

**Status:** report delivered; M14 awaiting owner acceptance; M15 does not begin
until the owner accepts the M14 report.

### Session 15 - M14 accepted (PASSED), M15 start

**Owner conditional instruction (2026-09-28):** "save session log, commit, push
current progress and then proceed to M15" -> **M14 (Owner Dashboard) PASSED**
(proposal of record accepted: metrics API only, no frontend; fixture verification
as the plan's verification; receptionist-403 owner/admin read). Gates at pass
unchanged from completion: verify 228/228 (23 suites, 0 skipped), no M14
migration (applied 0 / skipped 13 idempotent), extended smoke 126/126 PASS.
Docs: rev 36. M15 begins under the standing gate rule (owner instructed).

**M15 scope research (plan anchors read - CONFIRMED text):**
- Plan L1144-1160 (MILESTONE 15 - RECEPTIONIST WORKSPACE): "Design a
  workflow-oriented receptionist interface. Prioritize: New leads, Missed calls,
  Patient replies, Upcoming appointments, No-shows, Recall opportunities, Tasks
  requiring action. The interface should minimize clicks. Test usability
  manually." No numbered TEST item exists for M15 (test list ends at TEST 12 +
  MVP UX acceptance).
- Plan L311-321 (Receptionist needs): new leads, missed calls, patient replies,
  appointments requiring action, follow-ups, simple patient history, clear next
  actions.
- Plan L1689-1701 (MVP USERS Receptionist): view leads, add leads manually, view
  patient/contact information, update lead status, view appointments, confirm
  appointments, mark no-shows, rebook patients, view patient communication
  history - all already implemented as APIs (M3/M5/M7/M12/M13), none delivered
  as UI.
- Plan L276-295 (UX requirements: clean, professional, fast, simple, low
  cognitive load, accessible, consistent, easy to learn without training,
  design around actual clinic workflows), L2727-2744 (MVP UX acceptance: 10
  receptionist tasks straightforward), L311-321.
- Plan L378 (technical principles): "Identify frontend architecture" - **no
  frontend exists anywhere in the repository (CONFIRMED by inspection across
  M0-M14)**; backend = Express + TypeScript + MySQL + vitest.
- Plan L1302-1324 (M21 UX REVIEW) explicitly includes "Receptionist workflow"
  in its audit list - deep UX audit is the M21 gate, not M15.

**M15 delivery-mode question (frontend architecture decision, owner-reserved per
accepted rev 33/35 docs):** M15 asks for an interface + manual usability testing
while the repository has no frontend architecture. The decision is put to the
owner before UI code is written (options recorded in the report/question): (a)
workspace API + defer visual UI/usability to the owner's future UI phase / M21;
(b) minimal server-served static HTML workspace (no framework; clickable;
manually testable; keeps stack decision open); (c) owner specifies a frontend
stack now and a real frontend is scaffolded. Under every option the same
underlying piece is needed first: a single workspace aggregation endpoint
returning the 7 prioritized queues (one request = "minimize clicks" at the data
level). Design decisions for M15 are recorded after the owner answers.

### Session 15 - design decisions (M15 workspace API)

**Owner decision (2026-09-28, question answered):** deliver M15 as
**workspace API only** - the visual UI and the plan's "test usability manually"
step are deferred to the owner's future UI phase / M21 UX review (M14
precedent). Frontend architecture (plan L378) stays UNKNOWN. CONFIRMED.

PROPOSED details recorded before code:

1. **Endpoint:** `GET /api/organizations/:orgId/receptionist/workspace` -
   returns the plan's 7 prioritized queues in ONE payload (single request =
   "minimize clicks" at the data level): new leads, missed calls, patient
   replies, upcoming appointments, no-shows, recall opportunities, tasks
   requiring action. No query params (today-oriented operational view).
2. **Authorization:** `requireAuth` + `assertOrgExists` (ANY authenticated
   member of the org - the workspace is FOR the receptionist per MVP USERS
   L1689-1701; owner and platform Administrator also 200; foreign-org member
   404; unauthenticated 401). Differs from M14's owner-only dashboard -
   PROPOSED reading of MVP USERS.
3. **Date basis:** `date` and all day-granularity anchors use the CLINIC-local
   calendar date (`organizations.timezone`, IANA, computed with
   `Intl.DateTimeFormat('en-CA', {timeZone})`; corrupt/invalid timezone falls
   back to UTC). Instant windows use UTC instants. `date` and `timezone` are
   echoed in the response. (Improvement over D4's UTC-date basis because the
   clinic timezone column exists since M7; documented in definitions.)
4. **Queue scopes (each documented in `definitions`):**
   - `newLeads`: leads with status 'NEW' (any age), ordered created_at ASC
     (waiting longest first).
   - `missedCalls`: call_events with call_outcome IN
     ('MISSED','REJECTED','BUSY') - the RECOVERY_OUTCOMES set - with
     occurred_at in the last 30 days, ordered occurred_at DESC. ANSWERED calls
     excluded (no action needed).
   - `patientReplies`: INBOUND messages with created_at in the last 30 days,
     ordered created_at DESC; item `body` truncated to 160 chars + '...'.
   - `upcomingAppointments`: appointments with appointment_date >= clinic
     today AND status IN ('SCHEDULED','CONFIRMED'), ordered date ASC, time
     ASC; item flag `needsConfirmation` = (status === 'SCHEDULED').
   - `noShows`: appointments with status 'NO_SHOW' AND appointment_date in
     [clinic today - 30 days, clinic today], ordered appointment_date DESC.
   - `recallOpportunities`: recalls with status 'DUE' (any due_date), ordered
     due_date ASC; item `daysSinceDue` = (clinic date - due_date) in days,
     signed (positive = overdue).
   - `tasks` (documented derivation, plan L1156 "Tasks requiring action"):
     the union of actionable subsets in the plan's own priority order - NEW
     leads; missed calls (30d); patient replies (30d); appointments
     needing confirmation (status 'SCHEDULED', appointment_date in [today,
     tomorrow]); no-shows (30d); recalls status 'DUE' with due_date <= clinic
     today. Each item = {queue, type, id, label, at}. Ordered: leads block,
     missed block, replies block, appointment block, no-show block, recall
     block (plan L1150-1156 order), within each block using the queue's own
     ordering.
5. **Caps (documented):** 20 items per queue, 50 items for tasks; `count` is
   always the full uncapped count. Item lists are sliced in JS after small
   org-scoped SQL fetches (MVP scale; M19 is the performance gate).
6. **Queries:** 7 total per request (org timezone; NEW leads; missed-call
   events; INBOUND messages; upcoming appointments w/ patient join; no-shows
   w/ patient join; DUE recalls w/ patient join) - assembled in JS.
7. **Response shape:** `{date, timezone, generatedAt, queues: {newLeads,
   missedCalls, patientReplies, upcomingAppointments, noShows,
   recallOpportunities, tasks}, definitions}` where each queue = {count,
   items} and `definitions` is a flat Record<string,string> covering every
   queue scope + dateBasis + windows + caps (M14-style documented
   calculations; MVP-12 "explicit calculation definitions").
8. **Structure:** no migration; `src/services/workspace.ts`,
   `src/routes/workspace.ts` (mounted at `/api/organizations`), app.ts mount;
   `tests/m15.integration.test.ts` fixture-verifies every queue (counts,
   ordering, in/out-of-window exclusions, task composition, caps, truncation,
   timezone echo, roles 200/404/401, definitions); smoke extended with M15
   checks; no scheduler/config changes.

### Session 15 - M15 implementation, gates, completion

**Delivered (owner decision D7 - workspace API only; owner acceptance pending):**

- `src/services/workspace.ts`:
  - `getReceptionistWorkspace(db, orgId)` - 7 org-scoped queries per request;
    returns `{date, timezone, generatedAt, queues{...}, definitions}` with the
    plan's 7 priority queues in one payload (single request = "minimize clicks"
    at the data level).
  - Caps `WORKSPACE_ITEM_CAP` 20 / `WORKSPACE_TASK_CAP` 50 items in the payload
    with the FULL uncapped `count` beside them; caps documented in `definitions`.
  - Date basis: clinic-local calendar date via
    `Intl.DateTimeFormat('en-CA', {timeZone})`, invalid/missing timezone falls
    back to UTC; instant windows (30 days) are UTC instants; `date`/`timezone`
    echoed in the response (design decision 3 above, as built).
  - Queue scopes exactly as designed: newLeads (status NEW any age, created_at
    ASC); missedCalls (RECOVERY_OUTCOMES MISSED/REJECTED/BUSY, 30d, occurred_at
    DESC; ANSWERED excluded); patientReplies (INBOUND 30d DESC, body truncated
    to 160 chars + `...`); upcomingAppointments (appointment_date >= clinic
    today, SCHEDULED|CONFIRMED, date/time ASC, `needsConfirmation` = SCHEDULED);
    noShows (NO_SHOW, date in [today-30, today], DESC); recallOpportunities
    (DUE, due_date ASC, signed `daysSinceDue`); tasks = documented union in
    plan priority order - leads -> missed -> replies -> SCHEDULED appointments
    with date in [today, tomorrow] -> no-shows -> recalls due_date <= today,
    each item `{queue, type, id, label, at}`.
  - `DATE_FORMAT`/`TIME_FORMAT` string keys throughout (M14 defect-27 pattern
    applied proactively - no JS Date keys anywhere); `WORKSPACE_DEFINITIONS`
    flat record: dateBasis + windows + caps + 7 queue keys (10 keys total).
- `src/routes/workspace.ts` + `src/app.ts` mount: GET
  `/api/organizations/:orgId/receptionist/workspace` behind `requireAuth` +
  `assertOrgExists` (receptionist/owner/admin 200; foreign-org member 404;
  unauthenticated 401). All-member read - contrasts M14's owner/admin-only
  dashboard, matching MVP USERS capability split (receptionist has no dashboard
  capability but owns all 7 workspace queues; PROPOSED reading recorded in the
  design block).
- `tests/m15.integration.test.ts` - **9 tests, fixture-verified**: 7-queue
  counts + ordered ids + in/out-of-scope exclusions (30-day boundaries, past /
  future / wrong-status appointments, non-NEW leads, non-recovery call outcomes,
  CLOSED recalls); 160-char truncation proof; task union exact queue+type
  sequence (10 items) with labels; caps 20/50 against count 55; definitions
  exact keys + equality with the source constant; date/timezone echo UTC +
  Pacific/Kiritimati + invalid timezone `Not/AZone` -> UTC date fallback;
  roles (receptionist 200, owner 200, admin 200, foreign 404, unauth 401).
- Smoke: +8 M15 checks inserted before cleanup -> **134 total** (receptionist
  200, owner 200, unauth 401, foreign 404, API-vs-SQL cross-check for newLeads
  and upcomingAppointments, definitions key present, tasks present).

**Gate results (actual, executed):**
- `npm run verify` = lint 0 + typecheck 0 + test **237/237 passed, 24 suites,
  0 failed, 0 skipped** + build 0; exit 0.
- `npm run migrate` x2: applied 0 / skipped 13, exit 0 both runs (no M15
  migration - all source tables pre-date M15).
- Extended smoke: **134/134 PASS, 0 FAIL, SMOKE_PASS, exit 0** (log
  `m15-smoke-run1.log`; passed on the first run).

**Falsification review (results):**
- Plan "test usability manually" CHALLENGED as not executable under D7 (no UI
  exists) - resolved by the owner's delivery decision: manual usability of the
  interface moves to the owner's UI phase / M21; API-level usability exercised
  as the receptionist via smoke (session cookie, one request) and the fixture
  suite.
- Two documented-but-untested claims found and closed with executed tests:
  (a) task horizon boundary - a SCHEDULED appointment TODAY is included
  (fixture A8; task count 9 -> 10, sequence assertions updated, passed);
  (b) definitions claim "invalid or missing timezone falls back to UTC" - org C
  created with `Not/AZone`, response `date` asserted equal to the UTC date -
  passed (also proves no SQL-level constraint on `organizations.timezone`).
- First iteration hit TS2339 x6: mysql2 `db.query<T>()` returns a tuple -
  `.map` must run on `[0]`, not the deconstructed tuple (test-iteration fix,
  no product defect); one test-scope error (`ws` vs `wsA`) fixed. Re-ran lint
  0 / tsc 0 / suite 9/9.
- PS 5.1 expandable-string trap avoided during the tuple fix: replacement used
  `"$n[0].map("` - PowerShell keeps `$n` as the whole variable and `[0]` as
  literal text (verified by grep: all six sites are `xxx[0].map(`).
- Route conflicts (two-segment literal paths vs other routers), SQL
  parametrization, caps arithmetic, queue ordering, tenant scoping, definitions
  completeness: all covered by passing tests; no further issues found.

**Plan cross-check:** L1144-1160 (workflow-oriented receptionist interface;
7 priority queues exactly as listed; minimize clicks -> one-request
aggregation; test usability manually -> deferred per D7); L311-321
receptionist needs (all capabilities already API-implemented M3/M5/M7/M12/M13);
MVP USERS receptionist L1689-1701 -> all-member workspace read (PROPOSED
reading; receptionist 200 asserted); MVP UX acceptance L2727-2744 + UX
requirements L276-295 -> deferred to the owner's UI phase / M21 per D7; no
TEST 15 exists (test list ends at TEST 12) -> fixture verification governs;
M21 L1302-1324 owns the "Receptionist workflow" audit (L1322).

**Unresolved / carried:** frontend stack decision UNKNOWN (plan L378; D7 keeps
the stack decision with the owner; M21 UX review owns usability); defect 26
candidate (M3 `createPatient` drops `smsOptOut`) unchanged, owner decision
pending; K-I2 UNKNOWN (re-gate M22); K-I4 open (re-gate M22); K-I3 UNKNOWN
(D5 -> M22); B4 -> M22. No migration, no scheduler changes (4 ticks unchanged),
no new config keys in M15.

**Docs:** rev 37 - PROJECT_STATE (L9 revision 37; L5 M15 PASSED + M16
NOT_STARTED + stopping rule; new D7 decision row; phase note rev 37; changelog
row 37) and `M0_Project_Audit.md` M15 row IN_PROGRESS -> PASSED with gate
numbers; this completion entry.

**Status:** report delivered; M15 awaiting owner acceptance; M16 does not begin
until the owner accepts the M15 report.

### Session 16 - M15 accepted (PASSED), M16 start

**Owner conditional instruction (2026-09-28):** "save session log, commit, push
current progress and then proceed to M16" -> **M15 (Receptionist Workspace)
PASSED** (proposal of record accepted: D7 workspace API only; one aggregation
endpoint covering the plan's 7 priority queues; fixture verification as the
plan's verification; all-member read with receptionist 200). Gates at pass
unchanged from completion: verify 237/237 (24 suites, 0 skipped), no M15
migration (applied 0 / skipped 13 idempotent), extended smoke 134/134 PASS.

**M16 research notes (plan + codebase, before design):**

- Plan M16 = MILESTONE 16 — SETTINGS AND AUTOMATION CONFIGURATION (L1164-1178):
  message templates, reminder timing, recall settings, review settings, clinic
  hours, timezone, communication settings, provider configuration, user
  permissions; test directive L1178: "Test that configuration changes affect
  automation correctly."
- MVP-13 Basic Clinic Settings (L2194-2209): clinic name, logo, phone, email,
  address, timezone, business hours, communication settings, review URL,
  default message templates - "Do not build a large configuration system."
- MVP-14 Message Templates (L2213-2246): 9 named templates (lead ack,
  missed-call response, 48h/24h/2h reminders, no-show message, no-show
  follow-up, recall message, review request) with variables first_name,
  clinic_name, appointment_date, appointment_time, booking_link, clinic_phone;
  engine must safely handle missing variables (M6 `renderTemplate` already
  does - CONFIRMED by prior tests).
- MVP-14 variable availability (CONFIRMED): first_name / clinic_name /
  appointment_date / appointment_time are already supplied by M6/M8 senders;
  clinic_phone has NO source (M10 noted `organizations` has no phone column);
  booking_link has NO source (patient self-service booking is out of scope
  per plan) -> both need a design decision (org phone field exists in MVP-13;
  booking_link likely documented as safe-missing).
- No TEST 16 exists (test list ends TEST 12) -> the L1178 test directive +
  prior milestone deferrals govern verification.
- Schema inspected (CONFIRMED): `organizations` = id/name/status/created_at +
  site_key (0005) + timezone (0007) + review_url (0012). **Absent:** logo,
  phone, email, address, business hours - MVP-13 profile fields need a
  migration (0014).
- Codebase inspected (CONFIRMED): all automation configs are DEPLOYMENT-GLOBAL
  `app_meta` JSON (ack M6, reminder M8, noshow M9, recall M10, review M11,
  telephony M12, whatsapp M13) with shape guards + corrupt fallbacks; prior
  reports flagged "per-org settings UI" repeatedly for M16 (M8 note: config is
  global per deployment not per clinic - PROPOSED per-org settings at M16).
- User permissions: three-role model (owner/receptionist/admin) + member
  management + authz assertions already exist (M2/M3/M7+); M16 scope for this
  item to be decided at design (expose vs. already-done).

**Session 16 plan:** docs rev 38 (M15 PASSED, M16 IN_PROGRESS) -> commit +
push -> M16 design decisions recorded (storage scope for per-org settings,
endpoints, validation, role matrix, migration) -> implementation -> gates
(verify/migrate/smoke incl. configuration-changes-affect-automation tests) ->
docs rev 39 -> commit + push -> Rule 10 report -> stop (M17 gated on owner
acceptance of the M16 report).

**Owner decisions (2026-09-28, two questions answered before M16 design):**

1. **M16 delivery = "M16 API now, UI immediately after"** - finish the M16
   backend first (settings + templates API, migration, automation-effect
   tests), then run a frontend phase (app shell + Settings/Templates UI per
   `FrontEnd_Planning.md` §18/§41) as the next milestone BEFORE M17.
   Sequence becomes: M16 (API) -> owner acceptance -> **F1 frontend phase** ->
   M17. D7 is unchanged for M14/M15 (already accepted API-only); the frontend
   track is no longer fully open - it is scheduled. Recorded as **D8**.
2. **`FrontEnd_Planning.md` adopted as the governing frontend companion
   document** - committed to the repository, recorded in PROJECT_STATE as an
   owner-issued companion to `Project_Planning_Dentalistics.md`; I follow it
   whenever frontend work starts (§41 milestone mapping, §42 acceptance
   criteria, §49 definition of done, §1 screen inventory).

Implications for M16 design (noted, to be resolved in the design block):

- M16 stays backend-only (like M14/M15), but its API must serve the imminent
  F1 Settings UI: settings GET/PATCH surfaces, template management, and a
  template preview that reuses the server-side `renderTemplate` (FrontEnd §38:
  do not duplicate business logic in the frontend; §19: safe template preview).
- FrontEnd §18/§39: secrets (provider credentials, signing secrets, tokens)
  must never be readable through any API - write-only set, redacted read.
- FrontEnd §18 settings categories (Clinic, Users, Communication, Templates,
  Appointments, Recall, Reviews, Automation) bound the M16 endpoint grouping.

### Session 16 - design decisions (PROPOSED - M16 build)

All decisions below are PROPOSED design points of record (M14 precedent):
built as described, tested, reported for owner acceptance with the M16 report.

1. **Scope = backend only (D8).** Settings + templates API, migration 0014,
   automation-effect tests (plan L1178). No UI in M16; F1 (next phase) builds
   the Settings/Templates screens per `FrontEnd_Planning.md`.
2. **Per-org config storage with deployment fallback (resolves the standing
   M8/M10/M11/M12/M13 "per-org settings at M16" flag).** New table
   `organization_settings` (organization_id FK, meta_key, meta_value TEXT,
   UNIQUE(org, key), ON DELETE CASCADE). Precedence at load:
   **org row -> global `app_meta` row -> built-in defaults**; a corrupt org
   row falls through to the global row (then defaults), never to defaults
   first. Existing global rows keep working unchanged (all current tests
   exercise the fallback path). Org-scoped configs: reminder, noshow, recall,
   review, ack, missed_call, telephony, whatsapp.
3. **Loader signature:** `loadXConfig(db, orgId?)` - with orgId tries the org
   row first (shape-guarded, same validators as today); without orgId behaves
   exactly as before. Every current call site has org context available
   (verified by grep: triggers carry organizationId; ticks' rows carry
   organization_id; webhooks take :orgId). Ticks group due rows by
   organization_id and resolve config once per org per run (Map cache).
   Existing tests untouched (global fallback preserves behavior).
   **Tick-boundary semantics (determined from runReminderTick inspection):**
   `maxAttempts` stays DEPLOYMENT-GLOBAL (not in the plan's M16 list - only
   timing/settings are; it is the SQL fetch bound `attempts < ?` and cannot
   be per-org in one query) - documented in definitions. Ticks no longer
   early-return on the global `enabled` flag: the fetch keeps the global
   bound, and each row is gated by its ORG's effective config - org disabled
   => rows are skipped and stay PENDING (a pause that resumes on re-enable,
   matching today's global-disabled outcome where rows are left untouched).
   Creation paths (schedule/start/create) gate on the org's config fully, so
   a disabled org gets no new rows.
4. **Clinic profile fields (MVP-13).** Migration 0014 adds to `organizations`:
   `phone` VARCHAR(32), `email` VARCHAR(254), `address` VARCHAR(255),
   `logo_url` VARCHAR(512), `business_hours` TEXT (all NULL default).
   Validation: phone via existing `normalizePhone` (canonical digits -
   consistency with M3; PROPOSED), email via `optionalEmail`, address
   optionalText(200), logoUrl = absolute http/https <=512 (same rule as
   reviewUrl; no binary upload endpoint - hosting/storage UNKNOWN, MVP-13
   says "Logo if appropriate"), businessHours = `parseBusinessHours`: object
   with exactly the 7 day keys mon..sun, each null (closed) or
   {open:'HH:MM', close:'HH:MM'} with open < close.
5. **Endpoint set (grouped per FrontEnd §18 categories):**
   - `GET /api/organizations/:orgId/settings` -> one-shot load for F1:
     `{clinic, automations, providers, templates, definitions}`.
   - `PATCH .../settings/clinic` -> name, phone, email, address, logoUrl,
     businessHours, timezone, reviewUrl (timezone/reviewUrl also remain on
     the legacy `PATCH /:orgId` - M7/M11 compatibility untouched).
   - `PATCH .../settings/automations/:key` where key in
     reminder|noShow|recall|review|leadAck|missedCall -> body = partial config
     merged onto the EFFECTIVE config (org ?? global ?? defaults), then
     full-shape validated (the existing `is*Config` guards), then written as
     a complete JSON org row (self-contained rows; no merge at load time).
   - `PATCH .../settings/providers/:key` where key in telephony|whatsapp ->
     same merge/validate/upsert.
   - `PATCH .../settings/templates/:templateName` with `{body}` ->
     locates the owning automation config, replaces the template string,
     revalidates the full config, upserts the org row.
   - `POST .../settings/templates/preview` with `{body, variables?}` ->
     server-side render (reuses `renderTemplate`; FrontEnd §38: no business
     logic duplicated client-side) with sample variables (first_name 'Sarah',
     clinic_name = org.name, appointment_date '14 October',
     appointment_time '15:00', clinic_phone = org.phone ?? '',
     booking_link '') merged under caller-provided `variables`; returns
     `{rendered, unknownVariables}` (FrontEnd §19: identify invalid
     variables). New helper `listTemplateVariables(text)` in template.ts.
   All settings routes: `requireAuth` + `assertCanManageMembers`
   (owner/admin 200; **receptionist 403** - MVP USERS gives receptionist no
   configure capability; foreign-org 404; unauth 401).
6. **Secrets are write-only (FrontEnd §18/§39).** Providers GET returns
   `{enabled, configured: {signingSecret|verifyToken|appSecret|accessToken:
   boolean}, ...non-secret fields}` and `source`; secret VALUES are never in
   any response (tested by substring assertion), PATCH accepts string to set
   / null to clear. Logger already redacts secret-like keys (M1).
7. **Templates surface (MVP-14).** Expose 10 named slots (MVP-14's 9 +
   recall follow-up): lead_acknowledgement, missed_call_response,
   appointment_reminder_48h|24h|2h, no_show_message, no_show_follow_up,
   recall_message, recall_follow_up, review_request - each mapped to its
   existing config path (ack.template, missedCall.template,
   reminder.templates['48'|'24'|'2'], noShow.templates.initial|followUp,
   recall.templates.initial|followUp, review.template). GET templates =
   effective bodies; PATCH validates name in set + non-empty <=2000 chars.
   Templates stay embedded in their automation configs (no new template
   table) - the settings API is the editing surface. Senders unchanged in
   how they obtain text (config.templates), so all M8-M11 custom-template
   tests keep passing.
8. **Template variables.** Supported set documented in `definitions`:
   first_name, clinic_name, appointment_date, appointment_time,
   clinic_phone (NEW source: organizations.phone), booking_link (NO source
   exists - patient self-service booking out of scope; renders empty,
   documented). clinic_phone wired into sender variable maps where clinic_name
   is produced (extend the same SELECT/payload with the org phone);
   tested at least on the reminder send path + preview.
9. **User permissions = existing role model (MVP-13 "no large configuration
   system").** No new ACL system: owner/admin manage users via existing
   member endpoints; settings authz = assertCanManageMembers; role matrix
   documented in settings `definitions` for F1 navigation (backend stays
   authoritative per FrontEnd §5/§39).
10. **Effect test (plan L1178)** - fixtures must prove configuration changes
    change automation: (a) PATCH reminder offsets [5] -> schedule creates
    exactly offset-5 rows; (b) PATCH reminder enabled:false -> no rows;
    (c) PATCH template body -> rendered message contains new text; (d) org A
    PATCH does not affect org B (isolation via fallback precedence);
    (e) PATCH noShow delay -> follow-up row scheduled at new delay;
    (f) corrupt org config row -> automation still runs on global/default
    (loader fall-through), settings GET stays 200 with source reported.
11. **Audit + logging.** Settings writes: `logger.info` (field keys only) +
    `recordAudit(action:'settings_updated', detail: field keys - never
    values of secrets)`.
12. **No migration of existing data.** app_meta rows stay global (they
    become the deployment-default layer); organization_settings starts empty
    (source='deployment'/'default' visible in GET until an org PATCH).

Route-conflict note: settings paths are two+ segments under
`/api/organizations` (`/:orgId/settings/...`) - no existing router matches
them (verified: `GET/PATCH /:orgId` are single-segment; leads/patients/
appointments use literal second segments).

### Session 16 - M16 implementation complete (gates green; report delivered, acceptance PENDING)

**What was completed (all 12 design decisions built as recorded, PROPOSED for
acceptance with the M16 report):**

- **Migration 0014** `migrations/0014_org_settings_and_profile.sql`:
  `organizations` gains phone / email / address / logo_url / business_hours
  (all NULL default); new `organization_settings` (organization_id FK,
  meta_key, meta_value TEXT, UNIQUE(org, meta_key), ON DELETE CASCADE).
  Applied to dev DB (run 1: applied 1; run 2: applied 0 / skipped 14).
- **`src/db/orgMeta.ts`**: `loadOrgSetting` + `loadOrgEnabledFilter`
  (global-disabled fast path preserved via IN/NOT IN org list; corrupt org
  rows inherit the global state).
- **8 config loaders** converted to `loadXConfig(db, organizationId?)` with
  org -> app_meta -> default precedence and shape-guarded corrupt fall-through
  (reminderConfig, noShowConfig, recallConfig, reviewConfig, automation
  config, missedCall, telephony/config, whatsappConfig). All 8 `is*Config`
  guards exported. Call sites converted (triggers, webhooks, ticks, app.ts
  WhatsApp factory `(organizationId) => loadWhatsAppConfig(db, organizationId)`,
  whatsappProvider credentials loader now takes organizationId).
- **All 4 ticks** (reminders, noShow, recall, review) converted: global config
  stays the fetch bound only; `loadOrgEnabledFilter` gates due/open-row
  queries; per-row `orgCfgCache` Map resolves effective config once per org
  per run; each row gated by its ORG's config (disabled -> skipped, stays
  PENDING). `maxAttempts` remains deployment-global (decision 3). Trigger
  code reordered so context is read before config (reason priorities
  preserved).
- **clinic_phone wired** into lead ack, missed-call (input + callEvents
  provider path), reminder, recall, review and no-show sender variable maps
  (interface + SELECT + variables in each; found missing by m16 test 4).
- **`src/services/settings.ts`** (settings service): `getSettings` (clinic,
  automations, providers redacted, templates, definitions incl. role matrix +
  supported template variables), `patchClinic` (name/phone/email/address/
  logoUrl/businessHours/timezone/reviewUrl with parseBusinessHours,
  normalizePhone, optionalEmail, parseReviewUrl, parseTimezone),
  `patchAutomation` (6 keys, partial merge onto effective config, full-shape
  revalidate, complete org row upsert), `patchProvider` (telephony/whatsapp;
  secrets write-only, GET exposes only `configured` booleans + non-secret
  graph fields), `patchTemplate` (10 slots, unknown name 400, path guard),
  `previewTemplate` (server-side renderTemplate; samples incl. org.name and
  org.phone; caller variables outside SUPPORTED -> 400; template variables
  outside SUPPORTED reported in `unknownVariables`), `auditSettingsUpdate`
  (logger.info + recordAudit `settings_updated`, field keys never secret
  values).
- **`src/routes/settings.ts`**: `createSettingsRouter` - GET /:orgId/settings,
  PATCH clinic | automations/:key | providers/:key | templates/:templateName,
  POST templates/preview; all `{ settings }` wrapper (preview returns object
  directly); `requireAuth` + `assertCanManageMembers` (owner/admin 200,
  receptionist 403, foreign 404, unauth 401); mounted in app.ts after
  workspace (no route conflicts - verified segment shapes).
- **Helpers**: `parseBusinessHours` (+BUSINESS_HOUR_DAYS/BusinessHours/
  BUSINESS_TIME_PATTERN) in validate.ts; `listTemplateVariables` in
  template.ts.
- **Tests**: `tests/m16.integration.test.ts` 10 tests = plan L1178 effect set
  (authz matrix; clinic profile incl. phone normalization + businessHours
  400s; reminder offsets [5] scheduling + disabled pause + creation gate;
  patched template rendered on the send path; org A/B isolation; no-show
  delay from org config; corrupt org row fall-through; validation + partial
  merge semantics; provider secrets write-only/redacted incl. audit detail
  scrub; preview samples + unknownVariables) plus unit tests appended to
  validate.test.ts (parseBusinessHours) and template.test.ts
  (listTemplateVariables).

**Gates executed (2026-09-29):**

- `npm run verify` exit 0: eslint 0, tsc 0, vitest **256/256 (25 suites, 0
  skipped)**, build 0.
- `npm run migrate` x2: run 1 applied `0014` (applied 1 / skipped 13); run 2
  applied 0 / skipped 14 (idempotent).
- Extended smoke **153/153 PASS, SMOKE_PASS, exit 0** (19 new M16 checks;
  log `%TEMP%\opencode\m16-smoke-run2.log`). Smoke run 1 had 1 FAIL: the
  audit-row check expected exactly 1 row while the block deliberately PATCHes
  twice (status + body) -> corrected the CHECK to presence semantics (IF
  COUNT>=1); run 2 clean. `Write-JsonFile` gained `-Depth 8` (PS 5.1 default
  depth 2 would truncate nested businessHours) - existing flat call sites
  unaffected.

**Test iterations (defects fixed during the build):**

- m16 test 4 initially failed: `clinic_phone` was empty on the reminder send
  path -> reminders/recall/reviewRequests lacked the variable -> wired (3
  files x interface/SELECT/variables) -> 10/10.
- tsc `noUncheckedIndexedAccess` on `rows[0].message_id` in test 4 -> optional
  access. eslint unused `runNoShowTick` import removed.
- Earlier iterations (before the final run): phone-normalization expectation,
  schedule gate added to `scheduleRemindersForAppointment`, corrupt-row test
  had to INSERT (upsert semantics), DEFAULT_REVIEW_CONFIG.maxAttempts for
  round-trip.

**Design amendments / notes (vs the design block above):**

1. Recall template slot maps to `templates.recall` (code truth of the recall
   config shape); the design block's `recall.templates.initial` was a typo -
   code follows the existing config shape, no product change.
2. `scheduleRemindersForAppointment` historically had NO enabled gate (only
   the tick gated). Per decision 3 ("creation paths gate on the org's config
   fully") the org-config gate was added -> appointments created while
   reminder-disabled now get NO rows (previously rows were created and left
   PENDING, resuming on re-enable). Recorded as new behavior; full suite
   re-run green (256/256) - no existing test relied on the old behavior.
3. PATCH semantics as recorded in decision 5: an org PATCH snapshots the
   effective config into a self-contained org row; later deployment-level
   changes to that section no longer flow to that org (by design).

**Falsification / plan cross-check executed:**

- `resolveJson` returns `structuredClone` on all 3 paths (org/deployment/
  default) and `mergeSection` clones - PATCH mutation cannot corrupt shared
  module defaults (checked because patchTemplate mutates in place).
- GET redaction after a secret write is covered by the same `getSettings`
  serializer returned from every PATCH (settings.ts return path) and asserted
  by substring in m16 test 9 + smoke.
- Plan cross-check: MILESTONE 16 L1164-1178 all 9 bullets + L1178 test
  directive, MVP-13 L2194-2209 (all 10 profile items, "no large config
  system"), MVP-14 L2213-2246 (9 named templates - 10 slots exposed, superset
  incl. recall follow-up; 6 variables; safe missing vars M6), MVP USERS
  (owner/admin configure, receptionist none -> 403, admin passes
  assertCanManageMembers) - all mapped.
- Effect coverage: (a) offsets [5] -> exactly offset-5 rows; (b) disabled ->
  no rows; (c) template PATCH -> new text on send path; (d) org A does not
  affect org B; (e) no-show delay honored; (f) corrupt row -> global/default
  + source reported. Recall/review creation org-gates use the identical
  pattern (code inspection; regression green) but are not fixture-tested
  individually - stated as coverage boundary.

**Files created:** migrations/0014_org_settings_and_profile.sql, src/db/
orgMeta.ts, src/services/settings.ts, src/routes/settings.ts, tests/m16.
integration.test.ts.
**Files modified:** 8 config loaders, automation (leadCreated, reminders,
noShow, recall, reviewRequests, missedCall/callEvents), whatsappProvider,
app.ts, validate.ts, template.ts, tests/validate.test.ts,
tests/template.test.ts, tests/m16.integration.test.ts (iterations).

**Unresolved / carried:** booking_link has no source (renders empty,
documented, design 8); candidate defect 26 (M3 createPatient drops smsOptOut)
untouched per instruction; K-I2 / K-I4 / B4 unchanged (M22 re-gates); no UI
in M16 (D8) - F1 builds Settings/Templates UI next.

**Assumptions:** none beyond design decisions 1-12 (all PROPOSED, reported
for acceptance with this report).

**Recommended next phase:** F1 (application shell + Settings/Templates UI per
`FrontEnd_Planning.md`), gated on owner acceptance of the M16 report (D8).
### Session 17 - M16 accepted (PASSED), F1 start + design proposal (PROPOSED - awaiting owner approval)

**Owner conditional instruction (2026-09-29):** "if not done already, save
session log, commit, push current progress and then proceed to next phase as
proposed" -> session log was already saved, committed and pushed (rev 40,
`c65a117`, MATCH=OK verified before the instruction); the instruction
constitutes **acceptance of the M16 report -> M16 PASSED** (gates at pass
unchanged from rev 40: verify 256/256 (25 suites, 0 skipped), migrate 0014
applied then 0/14 idempotent, extended smoke 153/153). Next phase as proposed
= **F1** (D8 sequence).

**D9 - F1 frontend stack (owner answer to the F1 stack question, 2026-09-29):**
React 19 + Vite + TypeScript; separate `frontend/` (or `client/`) workspace;
backend unchanged (Node 24, TypeScript, Express 5, MySQL, tsc-only backend
build, Vitest); React Router for the documented route structure; React
Testing Library + Vitest for frontend tests; dev = Vite proxy `/api` ->
Express; prod = `npm run build` in frontend, Express serves generated `dist`
same-origin + SPA fallback; no separate frontend hosting, SSR, Next.js,
Tailwind, Redux, or unnecessary UI frameworks unless explicitly justified;
lean dependency surface; CSS modules or simple maintainable CSS (project
specifies no styling system); preserve repo conventions, inspect backend
first, modify backend behavior only to serve the production frontend + SPA
fallback; clear build/deploy process for DirectAdmin Node.js hosting, listen
on `process.env.PORT` (already implemented - config.ts L94 default 3000),
production env vars; **before implementation provide: proposed folder
structure, package changes, Vite configuration, Express static-serving and
SPA-fallback plan, test plan, DirectAdmin deployment steps; wait for approval
before broad changes.**

**Backend inspection facts (CONFIRMED, for the proposal):**

- `src/index.ts`: listens on `config.port` (`loadEnv()` -> `PORT`, default
  3000); `secureCookies: nodeEnv === 'production'` -> production login
  requires HTTPS (K-I2 remains UNKNOWN, M22 re-gate).
- `src/config.ts` env keys: `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DB_HOST`,
  `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `MIGRATIONS_DIR` (optional).
- `tsconfig.build.json`: `include: ["src/**/*.ts"]`, `rootDir: src` ->
  frontend files are invisible to the backend build; root `tsconfig.json`
  include list likewise backend-only.
- `eslint.config.mjs`: flat config, no file-scoped frontend handling; root
  `vitest.config.mts`: `environment: 'node'`, include `tests/**` only.
- No frontend exists anywhere (re-confirmed): no HTML/JSX/CSS assets, no
  bundler, frontend deps absent from package.json (deps: dotenv, express,
  mysql2 only).
- Express 5 (wildcard syntax differs from v4 - SPA fallback must use pathless
  middleware, not `'*'`).

**F1 design proposal (PROPOSED - the six items the owner required; approval
requested before any implementation):**

**1. Proposed folder structure**

```text
frontend/                        new workspace (never touched by backend tsc/eslint/vitest)
  package.json                   own deps + scripts (see item 2)
  vite.config.ts                 react plugin, dev proxy, build outDir=dist, vitest section (item 3)
  tsconfig.json                  strict, jsx: react-jsx, moduleResolution: bundler, noEmit
  eslint.config.mjs              typescript-eslint + js recommended + react-hooks
  index.html                     Vite entry, mounts #root
  src/
    main.tsx                     createRoot + BrowserRouter
    app/
      router.tsx                 route table (FrontEnd section 3 paths)
      shell/AppShell.tsx         Header + Sidebar + <Outlet/>  (B1)
      shell/Sidebar.tsx          nav: Dashboard, Leads, Patients, Appointments,
                                 Automations, Communic., Recall, Settings (5; disabled
                                 links for screens F1 does not build yet -> "planned")
      shell/Header.tsx           page area + AccountMenu (B2)
      shell/AccountMenu.tsx      current user + POST /api/auth/logout
    lib/
      api.ts                     fetch wrapper: same-origin credentials, JSON in/out,
                                 ApiError {status, code, issues}, 401 -> session state
      useAsync.ts                loading/error/success state hook (sections 24-27)
      auth.tsx                   session context via GET /api/auth/me
    components/                  PageHeader, FormField, ConfirmDialog, StatusBadge,
                                 DataTable, EmptyState, ErrorState, LoadingState,
                                 Toast (section 37 list, only what F1 screens need)
    pages/
      LoginPage.tsx              A1
      NotFoundPage.tsx           M1; UnauthorizedPage.tsx M2
      settings/
        SettingsOverviewPage.tsx K1
        ClinicSettingsPage.tsx   K2   (GET/PATCH /api/organizations/:id/settings/clinic)
        UsersRolesPage.tsx       K3   (existing member APIs - proposed in F1, see scope)
        CommunicationSettingsPage.tsx K4 (automations channel/provider surfaces)
        TemplatesPage.tsx        K5   (template slots from GET settings)
        TemplateEditorPage.tsx   K6   (PATCH template + POST .../templates/preview)
        AppointmentSettingsPage.tsx K7 (reminder section)
        RecallSettingsPage.tsx   K8
        ReviewSettingsPage.tsx   K9
        AutomationSettingsPage.tsx K10 (lead ack, no-show, missed call, WhatsApp/telephony)
    styles/tokens.css            section 7 design system as CSS variables
    styles/global.css            resets + layout
    test/setup.ts                jest-dom matchers
  src/**/*.test.tsx              frontend tests (own vitest config, jsdom)
```

F1 scope = shell (B1/B2) + A1 login + K1-K10 settings screens + minimum
system states (M1/M2/M6/M7 as needed) - exactly the section 41 `M16 ->
Settings / Templates` mapping plus what a shell requires to exist (login,
navigation, logout). Dashboard/Leads/etc. links appear as planned/disabled
until their milestones (honest empty navigation beats fake screens - section
47 no-placeholder rule). K3 (Users) is a Settings screen with existing APIs -
proposed in F1, flagged below as a scope question.

**2. Package changes (PROPOSED)**

`frontend/package.json` (new):

- dependencies: `react@19`, `react-dom@19`, `react-router-dom@7`
- devDependencies: `vite`, `@vitejs/plugin-react`, `typescript`,
  `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`,
  `@testing-library/user-event`, `eslint`, `@eslint/js`,
  `typescript-eslint`, `eslint-plugin-react-hooks`
- scripts: `dev` (vite), `build` (`tsc -b && vite build`), `test`
  (`vitest run`), `lint` (`eslint .`)

Root `package.json` (script-only additions; no new root dependencies):

- `dev:frontend` = `npm --prefix frontend run dev`
- `build:frontend` = `npm --prefix frontend run build`
- `test:frontend` = `npm --prefix frontend run test`
- `verify:frontend` = lint + test + build in the frontend workspace
- `verify` stays backend-only (owner: keep backend unchanged); the F1 gate
  runs `verify` + `verify:frontend` + migrate x2 + smoke (PROPOSED - the
  owner may instead ask to fold frontend checks into `verify` later).

Root `eslint.config.mjs`: add `frontend/**` to ignores (root `eslint .`
remains backend-scoped; frontend lints with its own flat config).

**3. Vite configuration (PROPOSED, `frontend/vite.config.ts`)**

- `@vitejs/plugin-react`
- `server.port` 5173, `strictPort: true`,
  `server.proxy`: `'/api'` and `'/health'` -> `process.env.VITE_API_PROXY ??
  'http://localhost:3000'` (same-origin behavior identical to production)
- `build.outDir: 'dist'`, `build.sourcemap: true`
- vitest section merged in the same file: `environment: 'jsdom'`,
  `setupFiles: ['./src/test/setup.ts']`, include `src/**/*.test.tsx`

**4. Express static-serving and SPA-fallback plan (PROPOSED - the only
backend change)**

In `src/app.ts` (added after all existing routers):

- UI dist dir = `process.env.UI_DIST_DIR` override, default
  `path.join(__dirname, '..', 'frontend', 'dist')` (correct for both tsx
  `src/` and compiled `dist/` layouts).
- If `index.html` exists there: `express.static(uiDist, { index: false })`
  (express 5; GET/HEAD only), then a pathless fallback middleware: requests
  to `/api...` or `/health` -> `next()` (JSON 404s unchanged); other GET/HEAD
  -> `sendFile(index.html)`; other methods -> `next()`.
- If dist is absent: log one warning ("frontend build not found; UI not
  served") and skip both registrations - dev UI runs via Vite; API behavior
  byte-identical.
- No other backend behavior changes (owner constraint). Express 5 has no
  `'*'` wildcard - the pathless middleware avoids the v4/v5 path-syntax trap.

Backend tests added (supertest): GET `/` -> 200 text/html with a fixture dir
via `UI_DIST_DIR`; GET `/api/nope` -> still 404 JSON; GET `/settings` ->
fallback HTML (non-API GET). Existing 256 tests must stay green (fallback
registered after routers, `/api` excluded).

**5. Test plan (PROPOSED)**

- Frontend unit/component (vitest + jsdom + RTL, frontend workspace):
  components (FormField, StatusBadge, Empty/Loading/Error states,
  ConfirmDialog); `lib/api.ts` error mapping incl. 401 handling; router
  access (receptionist vs owner per section 2.1); settings screens with
  mocked fetch: clinic load -> PATCH -> success, template list, template
  editor PATCH + preview rendering `unknownVariables`, automation partial
  patches, 400 validation -> field errors, receptionist 403 -> denied state.
- Per-screen section 6 gate: loading/empty/error/success/authorization
  covered by tests + manual checks; responsive (section 29) and
  accessibility (section 30) checked manually per screen and recorded.
- Backend: unchanged 256 + 3 static/SPA tests (item 4).
- Section 44 E2E scenarios (lead/no-show/etc.) deferred to M20 - they need
  screens F1 does not build (recorded, not skipped silently).
- Section 45 UX review gate: manual pass over completed F1 screens, findings
  reported with the F1 report.
- Frontend E2E tooling (Playwright etc.) NOT proposed now - extra
  heavyweight dependency; revisit at M20 (lean-deps constraint).

**6. DirectAdmin deployment steps (PROPOSED)**

1. Code on the server via SSH/git pull (owner B6: DirectAdmin + Node.js +
   MySQL + SSH confirmed).
2. Install Node.js >= 20 (engines; D9 says Node 24 line). Exact DirectAdmin
   Node provisioning mechanism (Appie/Passenger/systemd/custom) = UNKNOWN ->
   confirmed at deployment time (K-I3, M22 re-gate).
3. `npm ci` (root) and `npm ci --prefix frontend`.
4. Production `.env`: `NODE_ENV=production`, `PORT` (DirectAdmin-assigned),
   `LOG_LEVEL`, `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`, optional
   `MIGRATIONS_DIR`, optional `UI_DIST_DIR`. `.env` never committed (K6).
5. `npm run migrate`; `npm run seed:admin` on first run.
6. Build: `npm run build` (backend `dist/`) + `npm run build:frontend`
   (`frontend/dist/`).
7. Start `node dist/index.js` under the DirectAdmin-managed process runner
   (mechanism UNKNOWN until confirmed - K-I3); app listens on
   `process.env.PORT` (already implemented).
8. HTTPS in front of the Node port is REQUIRED in production (secure cookies:
   `index.ts` sets `secureCookies` when `NODE_ENV=production`, otherwise
   browsers will not store login cookies). HTTPS/DNS provisioning = K-I2
   (UNKNOWN, deployment-side, M22 re-gate). Same-origin serving preserves D6
   (no CORS surface).
9. Update flow: git pull -> `npm ci` (if lockfiles changed) -> migrate ->
   build backend + frontend -> restart process.

**Scope questions folded into the approval request (PROPOSED defaults):**

- K3 Users screen: included in F1 (it is a Settings screen with existing
  APIs). Default: include; say "settings only" to exclude.
- Sidebar entries for unbuilt screens: shown as disabled "planned" items.
  Default: include disabled (navigation matches section 5 today).
- `verify`: kept backend-only; F1 gate runs `verify` + `verify:frontend`.
  Default: as stated; ask if you want a single combined `verify`.

**Status:** F1 IN_PROGRESS (design only); NO implementation files created.
Awaiting owner approval of items 1-6 (and the three scope defaults) before
any code.

---

## Session 18 - F1 implementation complete (gates green; report delivered, acceptance PENDING)

**Date:** 2026-09-29. **Trigger:** owner instruction "proceed" after the
Session 17 proposal. F1 scope per D8/D9 and ``FrontEnd_Planning.md`` section
41 (M16 -> Settings/Templates): application shell + A1 login + settings
screens K1-K10 + minimum system states.

### Inputs applied (owner-approved, unchanged)

D9 stack: React 19 + Vite + TypeScript in a separate ``frontend/`` workspace;
backend unchanged except static serving + SPA fallback; Vite dev proxy
``/api`` -> Express; prod = ``npm run build`` in frontend, Express serves
``dist`` same-origin; no SSR/Next/Tailwind/Redux/UI frameworks; lean deps;
CSS modules or simple CSS. Scope defaults folded into the approval: K3 users
screen included; unbuilt screens = disabled "planned" sidebar items;
``verify`` stays backend-only with ``verify:frontend`` separate.

### What was built

1. **Backend UI serving (only backend change):**
   - ``src/app.ts``: new ``AppDeps.uiDistDir?: string | null`` (null =
     serving disabled for deterministic tests; default ``frontend/dist``
     resolved from the compiled file location; ``UI_DIST_DIR`` overrides).
     Root route serves the built ``index.html`` when present, else the JSON
     descriptor + warn log. Pathless static + SPA-fallback middleware after
     API routes and before ``notFoundHandler``: skips ``/api*``, ``/health``
     and non-GET/HEAD; static miss falls through to ``index.html`` (Express
     5 has no ``*`` wildcard).
   - ``tests/app.test.ts``: three ``createApp`` calls pass
     ``uiDistDir: null`` (root/404/x-powered-by assertions stay stable).
   - New ``tests/uiServing.test.ts`` (8 tests) + ``tests/fixtures/ui/``
     (index.html + asset).
2. **Root wiring:** ``package.json`` adds ``dev:frontend``,
   ``build:frontend``, ``test:frontend``, ``verify:frontend`` (``verify``
   untouched - backend-only per the accepted default);
   ``eslint.config.mjs`` ignores ``frontend/**``.
3. **``frontend/`` workspace (47 files):**
   - Installed (``npm ls`` confirmed): react 19.3.0, react-dom 19.3.0,
     react-router-dom 7.18.4; vite 7.3.6, @vitejs/plugin-react 5.2.0,
     typescript 5.9.3, vitest 5.0.2, jsdom 26.1.0,
     @testing-library/react 16.3.3, eslint 10.11.0, typescript-eslint
     8.71.0, eslint-plugin-react-hooks 7.1.1 - 242 packages, 0
     vulnerabilities.
   - Core: ``lib/api.ts`` (fetch wrapper, same-origin credentials,
     ApiError{status,code,issues}, network-error mapping), ``lib/auth.tsx``
     (AuthProvider: /api/auth/me session, login/logout, canManageSettings),
     ``lib/settings.ts`` (useSettings/useMembers/previewTemplate typed to
     the M16 endpoints), ``lib/types.ts``, ``lib/useAsync.ts`` (useSubmit),
     ``test/fixtures.ts`` + ``test/setup.ts``.
   - Shell: ``main.tsx``; ``app/router.tsx`` (section 2.1 route table);
     guards (RequireAuth; RequireSettingsRole owner/admin - mirrors backend
     ``assertCanManageMembers``, which 403s receptionists on ALL settings);
     AppShell/Sidebar/AccountMenu (unbuilt screens shown as disabled
     "Planned Mxx" items).
   - Pages: Login (A1), Landing (owner/admin -> /settings; receptionist ->
     honest "workspace screens not available yet" state), NotFound (M1),
     Unauthorized, and settings K1-K10:
     K1 overview (category cards + automation status badges); K2 clinic
     (name/phone/email/timezone/address/logo + 7-day business hours, client
     open<close check, all 7 day keys always sent per parseBusinessHours);
     K3 users (member table, add user with owner/receptionist roles per
     CLINIC_ROLES, disable with ConfirmDialog, self-disable hidden, role
     matrix line); K4 communication (telephony + WhatsApp cards, write-only
     secrets: blank input = keep, explicit Clear = null, Connected/CNot
     configured badges from ``configured`` booleans); K5 templates list (10
     slots); K6 template editor (variable chips insert-at-cursor, Preview ->
     rendered + unknownVariables as invalid chips, Save validates via
     preview first and requires an explicit "Save anyway" confirm when
     unknown variables exist); K7 appointments/reminders (channel/provider,
     comma-separated offsets validated 1-720 h, quiet-hours times,
     maxAttempts read-only + template links); K8 recall (intervalDays
     1-3650, followUpDelayHours 1-168); K9 reviews (destination URL through
     clinic PATCH + review automation with delay/suppression); K10
     automation (leadAck incl. sources, missedCall, noShow incl. delay +
     template links).
   - Design: ``styles/tokens.css`` + ``styles/global.css`` implementing
     FrontEnd section 7 tokens (the D9 "simple CSS" option; no CSS modules,
     no UI framework).
   - Lint-driven rework: eslint-plugin-react-hooks 7
     ``set-state-in-effect`` rejected synchronous form-init effects - all
     settings forms now derive state during render
     (``draft ?? toForm(settings)``); the template editor keeps per-template
     keyed draft/preview state (no effects); auth session check uses
     promise callbacks.

### Gates (executed 2026-09-29)

- ``npm run verify`` (backend): **PASS - 264/264 tests, 26 suites, 0
  skipped, exit 0** (256 pre-F1 + 8 new uiServing tests; tsc + eslint + build
  in the same run).
- ``npm run verify:frontend``: **PASS - exit 0** (eslint 0, tsc 0, vitest
  **20/20** in 5 files, ``vite build`` OK: index-BfyuOxqz.js 312.97 kB /
  index-DMhPgOpa.css 11.02 kB).
- ``npm run migrate`` twice: **PASS** - run 1 applied 0 / skipped 14; run 2
  applied 0 / skipped 14 (idempotent; no F1 migration).
- Extended smoke (``m3-smoke.ps1``): **SMOKE_PASS** (0 failures; script
  unchanged from the M16 153-check baseline - no root-path assertions exist,
  so SPA serving does not affect it).
- SPA-serving E2E against the REAL server + REAL ``frontend/dist``
  (``spa-serve-check.ps1``, port 3999): **7/7 PASS** - root = index.html,
  ``/settings/clinic`` deep link = index.html, template deep link =
  index.html, static CSS asset served, unknown ``/api/*`` stays JSON 404,
  POST to a page path = 404 (not swallowed by fallback), ``/health`` = 200.

### Verification notes

- Type/lint/test executed both piecemeal during development and through the
  official gate scripts (``verify``, ``verify:frontend``) at the end.
- The SPA E2E check is a meaningfully different path from the unit fixtures:
  it boots ``tsx src/index.ts`` with no ``uiDistDir`` override, proving the
  default ``frontend/dist`` resolution end to end.
- Encoding incident + repair: a PowerShell ``Get-Content -Raw`` round-trip
  briefly re-encoded three files as ANSI; a full-source mojibake scan found
  exactly 3 affected files (Communication/Recall/Templates pages);
  em-dash / en-dash / ellipsis mojibake sequences were repaired and byte-
  verified (U+2014/U+2013/U+2026 restored); re-scan clean.
  ``.gitignore``/other files were display-only artifacts, not corrupted.

### Assumptions (ASSUMED - confirm at acceptance)

- Receptionist landing page shows an honest "workspace screens not available
  yet" state (their queues arrive with M15-UI/M21); F1 builds no
  receptionist product UI.
- Settings role gate = owner/admin only. The FrontEnd section 2.1 table's
  "Receptionist: Limited" row is superseded by backend
  ``assertCanManageMembers`` (403 for receptionists on ALL settings);
  frontend gate mirrors the backend rather than the doc table - recorded,
  not silently diverged.
- Template save with unknown variables = explicit confirm dialog (not a
  hard block); reading of section 19 "do not silently save broken
  templates".

### Open items

- FrontEnd section 45 manual UX review: **NOT executed** in this
  environment (no browser tooling) - reported as open for owner
  acceptance; section 44 E2E scenarios deferred to M20 per the approved
  proposal (they need screens F1 does not build).
- K-I2 (HTTPS for production secure cookies), K-I3 (process persistence /
  DirectAdmin Node provisioning), K-I4 (provider accounts) unchanged -
  M22 re-gate. DirectAdmin deployment steps recorded in Session 17 item 6.
- No DB changes; settings APIs already shipped in M16.

**Status:** F1 implementation complete; all gates above green; report
delivered; **awaiting owner acceptance**. M17-M23 NOT_STARTED. Stopping
rule: M17 does not begin until the owner accepts the F1 report (D8
sequence).

## Session 19 - F1 accepted (PASSED), M17 (Observability) start + design fork

**Date:** 2026-09-29. **Trigger:** owner question - "can the pending issues wait
at a later stage without creating an ocean of mistakes/challenges/work? If
yes then proceed to the next phase".

**Triage answer delivered (evidence-based): YES, all pending items deferrable
to their mapped milestones without compounding risk:**

- FrontEnd section 45 UX review is an **M21 gate by the governing doc's own
  text** ("Before M21 can be marked PASSED, perform a dedicated UX review") -
  my Session 18 framing of it as an F1 open item was overly strict;
  corrected. M21 in the backend plan = UX Review - same slot.
- Section 44 E2E scenarios = M20 (deferral already part of the approved F1
  proposal).
- K-I2 (HTTPS), K-I3 (process persistence), K-I4 (provider accounts) = M22
  Production Readiness; deployment-side facts that cannot be verified from
  this environment, and no production traffic exists (nothing to protect or
  migrate yet).
- Candidate defect #26 (M3 createPatient drops smsOptOut) = M18 Security
  Hardening: one-line INSERT fix + test; not deployed, so no bad patient
  data is accumulating; already tracked in M0_Project_Audit.
- Historical SESSION_LOG U+FFFD damage (~lines 1-505, pre-existing): cosmetic,
  no functional consumers, new content clean - optional editorial pass later,
  untouched without instruction.
- ASSUMED UX choices (receptionist landing state, settings gate = mirror of
  backend 403, save-with-unknown-variables confirm): small localized UI
  decisions, naturally re-examined at the M21 UX review; settings gate in
  particular mirrors CONFIRMED backend behavior.
- Why no compounding: nothing is deployed (no bad data/user habits), every
  deferral is additive review/test/deployment work rather than rework of
  architecture, each item has a dedicated future milestone so it cannot fall
  through, and M17-M19 build on stable APIs unaffected by any pending item.

**Owner conditional instruction executed:** F1 recorded **PASSED 2026-09-29**
(PROJECT_STATE rev 43; M0_Project_Audit F1 row PASSED, M17 row IN_PROGRESS).

**M17 (Observability and admin tools) started** - plan L1182-1195: automation
logs, communication logs, webhook logs, error logs, audit logs, failed jobs,
retry mechanism, operational diagnostics; "sensitive information must not be
unnecessarily exposed".

**Design fork put to the owner BEFORE building (PROPOSED):** FrontEnd section
41 maps M17 -> "Operational/automation UI", while D7/D8 precedents were
backend-first with UI deferred. Options: (a) backend-first (RECOMMENDED):
deliver all 8 plan bullets as backend services/APIs + tests now, operational
UI as a follow-up frontend slice once the APIs settle - same shape as D7/D8
which the owner chose twice; (b) build the operational UI in this same phase
(shell + router already exist from F1, screens would consume the new
endpoints). No code written yet pending this answer.

**Status:** F1 PASSED; M17 IN_PROGRESS (design); M18-M23 NOT_STARTED.

### Session 19 - M17 implementation complete (gates green; report delivered, acceptance PENDING)

**2026-09-29. D10 recorded (owner answered the delivery fork via the question
tool):** M17 = **backend-first** - all 8 plan bullets delivered as backend
services/APIs + tests now; the operational/automation UI (FrontEnd section 41
"Operational/automation UI") deferred to a later frontend slice, same shape as
the D7/D8 precedents the owner chose twice.

**Delivery:**
- migration `0015_observability.sql`: `webhook_events` (organization_id FK
  CASCADE NULL, source, request_method, http_status, outcome, provider_key,
  remote_ip, detail) + `error_events` (organization_id FK NULL, scope,
  request_method, request_path, http_status, error_code, error_name,
  error_message).
- `src/services/observability.ts`: automation logs = UNION over the 4 job
  tables (appointment_reminders / no_show_messages / recall_messages /
  review_requests - all share status/attempts/last_error/scheduled_at/
  sent_at/message_id/created_at) with kind + status filters and a subquery
  total; failed jobs = same 4 tables UNION communication_messages (DISPATCHABLE
  = PENDING/FAILED) via FAILED_JOB_KINDS incl. 'message'; retry = jobs
  requeue (status PENDING, scheduled_at=UTC_TIMESTAMP(), last_error=NULL,
  attempts preserved - PENDING rows bypass the attempts cap in the tick
  claim query) / message resets PENDING + sendMessage(getProvider(
  provider_key)) mirroring retryMissedCallResponse (failure -> 500
  retry_failed; 404 not_found; 409 not_failed/no_provider/unknown_provider;
  400 unknown kind); diagnostics = db ping (SELECT 1), 5 status count groups
  (Promise.all), recent-24h counts, scheduler tick-state passthrough;
  recordWebhookEvent/recordErrorEvent never-throw with field truncation;
  communication logs re-export `listMessages` (its own filter validation;
  route pre-validation dropped as redundant).
- `src/routes/observability.ts`: 8 org-scoped endpoints (automation-logs,
  communication-logs, webhook-logs, error-logs, audit-logs, failed-jobs,
  POST failed-jobs/:kind/:id/retry, diagnostics); requireAuth +
  assertCanManageMembers (401 / 403 receptionist / 404 foreign-org);
  parseListParams (limit 1-100 default 50) / parsePathId; mounted under
  /api/organizations after the settings router.
- `src/routes/admin.ts`: + global GET /api/admin/observability/error-logs
  and /audit-logs behind requireRole('admin') (owner -> 403).
- error path: `src/errors.ts` errorHandler gains optional recordError,
  awaited with try/catch, recorded ONLY for status >= 500 (4xx excluded as
  normal validation noise - PROPOSED), storing req.path with the query
  string stripped (verification tokens/keys live in query) and no stack
  traces; wired in `src/app.ts` conditionally when deps.db is defined.
- webhook recording: every terminal branch of `src/routes/webhooks.ts`
  (rate_limited 429, unknown_provider 404, org_not_found/org_inactive 404,
  disabled 403, invalid_signature 401, invalid_challenge/invalid_verify_
  token/invalid_payload 400, challenge_verified/processed/duplicate 200 with
  detail status/disposition/inbound/statuses) and the whatsapp equivalent
  (org checks wrapped try/catch to record org_not_found with NULL org for
  FK safety, then rethrow) calls recordWebhookEvent with metadata + outcome
  only - no payloads, no headers, no query strings stored.
- scheduler instrumentation: new `src/tickState.ts` (in-memory tick
  start/success/failure per TickName + last interval ms) + `src/index.ts`
  track() wrapper around all 4 ticks, preserving the original error-log
  labels ('reminder tick failed', 'no-show tick failed', ...).
- sensitive-data posture: owner/admin read gate on every endpoint; error
  logs query-stripped; webhook logs metadata only; diagnostics exposes
  counts/health, not message content; communication logs expose the
  clinic's own message bodies to owner/admin only (PROPOSED necessary for
  operational diagnosis).

**Tests:** `tests/m17.integration.test.ts` 14 tests (authz matrix 401/403/
404/admin; automation-logs union + kind/status filters + total; telephony +
whatsapp webhook recording incl. org-not-found NULL-org case; webhook-logs
exact-key shape proving no payload fields; communication-logs; audit-logs
action filter; error-logs org scoping + 4xx NOT recorded; failed-jobs union +
org scope; reminder retry preserves attempts (2 -> PENDING, second retry 409);
message retry through the mock provider (attempts 2 -> 3, SENT, provider_error
NULL); retry error cases 404/409 x3/400; diagnostics structure; admin global
endpoints + owner 403): 12/14 first run, then **14/14** after two test-
expectation corrections (the union legitimately includes the seeded recall
FAILED row -> total 4; webhook event keys include `detail`). Test-iteration
fixes only - no product defects found (noUncheckedIndexedAccess row casts).

**Gates (all executed, all green):**
- `npm run verify` exit 0: **278/278 tests, 27 suites, 0 skipped** (264 prior
  + 14 m17; eslint 0, tsc 0, build OK).
- `npm run verify:frontend` exit 0: untouched by M17 (eslint 0, tsc 0,
  vitest 20/20, vite build OK).
- `npm run migrate` x2: run 1 applied `0015_observability.sql` (applied 1 /
  skipped 14), run 2 applied 0 / skipped 15 (idempotent), both exit 0.
- extended smoke `%TEMP%\opencode\m3-smoke.ps1`: **SMOKE_PASS**, exit 0
  (+20 M17 checks -> 173 total: 8 read endpoints with owner/receptionist/
  unauth matrix, diagnostics db + 4 scheduler ticks, webhook_events and
  error_events table existence, unknown-provider webhook -> 404 + row
  recorded, forced-FAILED reminder -> retry -> REQUEUED end-to-end, admin
  global endpoints).

**PROPOSED/ASSUMED interpretations recorded for acceptance:** automation logs
= UNION over the 4 job tables (plan states "automation logs" generically);
communication logs = the message-list export (dead route revived); webhook
logs = metadata only (no payloads); error logs = status >= 500 only; tick
state in-memory per process (K-I3 single-process assumption); org-not-found
webhook events recorded with organization_id NULL (missing vs inactive not
distinguished); operational UI deferred per D10.

**Status:** F1 PASSED; M17 implementation complete - report delivered,
awaiting owner acceptance; M18-M23 NOT_STARTED.

## Session 20 - M17 accepted (PASSED), M18 (Security hardening) start

**2026-09-29. Owner instruction:** "Proceed" - M17 (Observability and admin
tools) recorded **PASSED 2026-09-29** (PROJECT_STATE rev 45; M0_Project_Audit
M17 row PASSED, M18 row IN_PROGRESS). Gates at pass unchanged from the rev 44
report: `npm run verify` exit 0 (**278/278, 27 suites, 0 skipped**),
`npm run verify:frontend` exit 0 (20/20, untouched), migrate x2 (`0015`
applied then 0/15 idempotent), extended smoke **SMOKE_PASS** (+20 M17 checks
-> 173 total). D10 backend-first interpretation accepted with the pass
(operational UI deferred to a later frontend slice).

**M18 (Security hardening) started** - plan L1199-1222: "Perform a dedicated
security review" across 17 checklist areas: authentication, authorization,
tenant isolation, API security, webhooks, input validation, injection, XSS,
CSRF where relevant, rate limiting, secrets, logs, file uploads if any,
dependency vulnerabilities, session handling, error exposure - "Fix discovered
issues before proceeding."

**Planned method (PROPOSED):** area-by-area code inspection against the
checklist with executable checks where they exist (`npm audit`, existing test
suites, targeted probes); every finding recorded with CONFIRMED/PROPOSED
label, severity, and file references; fixes land with regression tests, then
full gates (verify + migrate + extended smoke) before the M18 report.

**Carried into M18:**
- Candidate **defect #26** (reported at M12, mapped to M18 at the F1 triage):
  M3 `createPatient` validates `smsOptOut` but drops it from the INSERT -
  1-line fix + regression test.
- File uploads: none exist anywhere in the codebase (CONFIRMED by inspection
  across M0-M17) - checklist item recorded not-applicable rather than silently
  skipped.
- K-I2 (HTTPS in production) and K-I3 (process persistence) remain
  deployment-side UNKNOWNs mapped to M22 - not verifiable from the repo now;
  session/cookie security code is still reviewed in M18 (secure/httponly/
  sameSite flags, expiry), only the live HTTPS enforcement is M22.

**Status:** M0-M17 + F1 PASSED; M18 IN_PROGRESS; M19-M23 NOT_STARTED.

### Session 20 - M18 implementation complete (security review + 4 fixes; gates green; report delivered, acceptance PENDING)

**2026-09-30. Dedicated security review executed** per plan L1199-1222 across
all 17 checklist areas. Method: code inspection + executable checks
(`npm audit` root and frontend, targeted greps/reads of every route,
service, middleware and config module, existing integration suites).
Four issues discovered and fixed; everything else passed.

**Per-area verdicts (CONFIRMED by inspection unless noted):**

1. **Authentication - OK.** scrypt N=16384/r=8/p=1, 32-byte salt, 64-byte
   key, timingSafeEqual comparison, dummy-hash timing equalization for
   unknown emails (`src/auth/password.ts`); min 12-char passwords; login
   rate limited 10/min per ip+email; generic 401 invalid_credentials;
   disabled account and disabled organization blocked with audit records.
2. **Authorization - OK.** `router.use(requireAuth)` on all 14 org-scoped
   routers (verified per file); per-route membership asserts verified
   route-by-route: appointments 12/12, leads 5/5, patients 5/5, settings
   authorize() 6/6, organizations 5/5, observability context() 8/8,
   dashboard/workspace/conversation-state/call-events 1/1 each;
   admin router `use(requireAuth, requireRole('admin'))` covers all 6
   admin endpoints; role behavior covered by m3/m14/m15/m16/m17 suites.
3. **Tenant isolation - OK.** every tenant query constrains
   organization_id (spot-checked patients/leads/appointments/
   observability/webhooks incl. UPDATE/DELETE statements); foreign org
   resolves to 404 before any 403 (assertOrgExists ordering);
   cross-tenant tests exist in m3/m14/m15/m17.
4. **API security - OK after fix F3.** 100kb json + urlencoded body
   limits; malformed JSON -> 400; list params bounded (limit 1-100,
   offset >= 0); x-powered-by disabled; baseline security headers added.
5. **Webhooks - OK after fix F4, replay limitation documented.**
   telephony: per-IP 200/min, fails closed when signing secret empty,
   timing-safe HMAC-SHA1 over full URL + sorted params (length check then
   timingSafeEqual); whatsapp: per-IP 200/min on GET and POST, fails
   closed on empty app secret, timing-safe HMAC-SHA256 over raw body;
   idempotency at rest (call_events UNIQUE provider_event_id, whatsapp
   wamid dedupe). Replay: both signature schemes lack timestamps - a
   captured valid request can be re-delivered; mitigated by idempotent
   processing (duplicates return duplicate, no side effects). ASSUMED
   acceptable for provider-style webhooks; not fixable without provider
   nonce/timestamp support (NOT_VERIFIED whether adapters expose one).
6. **Input validation - OK.** central helpers in validate.ts (strings,
   phones, emails, dates, times, timezones, URLs, business hours, choices,
   pagination); per-route enum filters; JSON object guards; arrays and
   unknown update fields rejected (UPDATABLE_* allowlists).
7. **Injection - OK, no issues found.** all SQL parameterized; WHERE
   fragments are literal strings with `?` placeholders (17 where.push
   sites verified); ORDER BY fully static; UPDATE column names pass
   UPDATABLE_* allowlists and apply() is called with string literals only;
   LIKE search uses escapeLike + ESCAPE clause; orgMeta columnRef callers
   pass literal 'organization_id'.
8. **XSS - OK, no issues found.** no data-driven HTML responses
   (backend); frontend has zero dangerouslySetInnerHTML/innerHTML/
   document.write/eval hits (grep across frontend/src); React auto-escaping;
   no dynamic href sinks.
9. **CSRF - accepted design (no token).** cookie is HttpOnly +
   SameSite=Lax; state changes only via JSON POST/PATCH/DELETE; no CORS
   middleware (D6 same-origin proxy); cross-site POSTs carry no Lax cookie
   and fail the JSON content-type parse. Recorded, not "silently skipped".
10. **Rate limiting - OK.** login 10/min (ip+email), public leads 30/min
    per IP + 120/min per site key, telephony and whatsapp webhooks 200/min
    per IP; authenticated API endpoints are session-gated and unlimited;
    password change is unlimited but requires an active session plus the
    current password (LOW, accepted - recorded).
11. **Secrets - OK after fix F1.** .env gitignored (.env.example holds
    placeholders only), README clean since the K6 remediation, settings
    secrets write-only + redacted since M16, logger redacts secret-looking
    keys at any depth, diagnostics/observability expose no secrets.
    Discovery: request/error logs recorded full originalUrl, so the
    whatsapp `hub.verify_token` query parameter was written to logs,
    contradicting README L56 ("Secrets are never logged").
12. **Logs - OK after fix F1.** structured JSON with key redaction on
    fields and bindings; request log = method + redacted path + status +
    duration (no bodies, cookies or headers); stack traces server-log
    only; error_events stores path without query string.
13. **File uploads - N/A (CONFIRMED).** no multer/busboy/multipart/
    upload code anywhere in the repo; checklist item recorded
    not-applicable rather than skipped.
14. **Dependency vulnerabilities - OK.** `npm audit` root: 0
    vulnerabilities (exit 0); `npm audit` frontend: 0 vulnerabilities
    (exit 0), run 2026-09-29/30.
15. **Session handling - OK.** 32-byte random tokens stored as SHA-256
    hashes, 12h fixed TTL enforced at lookup (expired rows deleted),
    disabled users rejected, logout revokes the session, password change
    revokes all of the user's sessions, cookie HttpOnly + SameSite=Lax +
    Path=/ + Secure when NODE_ENV=production. No idle timeout (fixed TTL
    design, recorded). Live HTTPS enforcement remains K-I2/M22.
16. **Error exposure - OK.** 500 responses are the generic
    "Internal server error" (AppError.expose defaults false >= 500);
    validation issues only on 400; ProviderSendError extends plain Error
    so any escape becomes a generic 500; provider_error text is stored in
    communication_messages and shown to owner/admin in communication logs
    (accepted: operational diagnosis value, no credentials included).
17. **XSS/CSRF cross-check** covered by 8/9 above.

**Issues discovered and fixed (all four with regression coverage):**

- **F1 (MEDIUM) - secret query values in logs.** app.ts request logger and
  errors.ts error logger recorded `req.originalUrl` verbatim; the whatsapp
  handshake carries `hub.verify_token` in the query string. FIX:
  new `redactUrl()` in `src/logger.ts` (redacts values for secret-looking
  keys using the same SECRET_KEY_PATTERN as field redaction, keeps other
  params) applied at both log sites; 6 unit tests added
  (`tests/logger.test.ts`).
- **F2 (MEDIUM) - candidate defect #26.** `createPatient` accepted the
  request body but dropped `smsOptOut` from the INSERT (updatePatient had
  validated it since M3; create did neither). FIX: boolean validation
  (mirrors updatePatient, 400 on non-boolean) + `sms_opt_out` column in
  the INSERT; regression test in `tests/m3.integration.test.ts` asserting
  API GET, direct DB row, default false and the 400 type error.
- **F3 (LOW) - missing security headers.** FIX: middleware after
  `x-powered-by` disable sets X-Content-Type-Options: nosniff,
  X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin
  on every response; test in `tests/app.test.ts` + 3 smoke checks.
- **F4 (LOW) - whatsapp verify token compared with `!==`.** FIX:
  `timingSafeEqualStrings()` in `src/communications/whatsappSignature.ts`
  (length check then timingSafeEqual), used in the GET handshake;
  behavior identical for equal/unequal strings, existing m13 handshake
  tests and smoke checks cover the outcome paths.

**Gates (all executed 2026-09-30, all green):**
- `npm run verify` exit 0: **286/286 tests, 27 suites, 0 skipped**
  (278 prior + 8 new: 6 redactUrl, 1 security headers, 1 defect-26).
- `npm run verify:frontend` exit 0 (frontend untouched by M18).
- `npm run migrate` x2: applied 0 / skipped 15 (no M18 migration needed),
  both exit 0.
- extended smoke: **SMOKE_PASS**, exit 0 (+3 M18 header checks -> 176
  total checks).

**Carried forward (recorded, not blocking):** K-I2 HTTPS and K-I3 process
persistence = M22; telephony/whatsapp replay tolerance = inherent scheme
limitation (idempotency mitigates); password-change and authenticated API
not rate-limited (accepted); CSP header not added (needs frontend E2E
verification - PROPOSED, revisit at M20/M21); SameSite=Lax accepted as the
CSRF control.

**Status:** M0-M17 + F1 PASSED; M18 implementation complete - report
delivered, awaiting owner acceptance; M19-M23 NOT_STARTED.

## Session 21 - M18 accepted (PASSED), M19 (Performance and reliability) start

**2026-09-30. Owner instruction:** "Proceed" - M18 (Security hardening)
recorded **PASSED 2026-09-30** (PROJECT_STATE rev 47; M0_Project_Audit M18
row PASSED, M19 row IN_PROGRESS). Gates at pass unchanged from the rev 46
report: `npm run verify` exit 0 (**286/286, 27 suites, 0 skipped**),
`npm run verify:frontend` exit 0 (untouched), migrate x2 (0/15 idempotent),
extended smoke **SMOKE_PASS** (176 checks). All 4 M18 fixes accepted with
the pass; defect #26 CLOSED.

**M19 (Performance and reliability) started** - plan L1226-1242: test
database queries, large lead lists, large appointment lists, dashboard
calculations, background jobs, automation execution, webhook processing,
concurrent events, retry behavior; "Identify obvious bottlenecks. Do not
prematurely optimize without evidence." FrontEnd section 41 maps M19 ->
"Performance review" - a review deliverable, no UI screens, so no delivery
fork (unlike M17); backend test + measurement work follows the D7/D8/D10
precedent.

**Planned method (PROPOSED):** a performance/reliability integration suite
that seeds realistic volumes (thousands of leads/appointments/messages)
into the test database, measures endpoint and tick execution with explicit
time budgets chosen to be generous (correctness-oriented, not
benchmark-grade), exercises concurrency (parallel webhook posts, concurrent
tick claims) and retry behavior end-to-end; record measured numbers in
SESSION_LOG; only change code where a measurement shows an obvious
bottleneck (e.g. N+1 query patterns, unbounded scans) - per plan, no
premature optimization.

**Status:** M0-M18 + F1 PASSED; M19 IN_PROGRESS; M20-M23 NOT_STARTED.

**M19 testing complete (2026-09-30).** Method executed as planned: new
``tests/m19.integration.test.ts`` (9 tests; suite count 27 -> 28) seeds
realistic volumes into the test DB - 5,000 leads, 1,000 patients,
2,900 appointments (2,000 mixed-status for lists/dashboard + 900
SCHEDULED tick backlog), 2,000 messages (1,200 SENT / 400 PENDING /
400 FAILED), 900 appointment_reminders (700 PENDING due + 100 FAILED
due + 100 SENT), 500 webhook_events, 200 error_events, 500 audit rows -
and measures each plan-area item with generous correctness-oriented
budgets (lists 3,000ms; dashboard 5,000ms; ticks 120,000/150,000ms;
webhook burst 15,000ms).

**Measured (final passing run, 2026-09-30, this machine):**
- Large lead lists (5,000 rows): first page 614ms, deep offset 98ms,
  search 183ms, status filter 127ms.
- Large appointment lists (2,900 rows): 12-26ms across list, deep
  offset, status and date-range filters.
- Dashboard, 80-day window over 5k leads / 2.9k appointments / 2k
  messages: 93ms; four metrics (leads.new, appointments.scheduled,
  appointments.completed, messages.sent) cross-checked against
  independent SQL computed in the test - exact match on all four.
- Observability lists (900 / 2,000 / 500 / 200 / 500 / 500 rows):
  12-29ms each, totals exact vs seed (audit-logs expected value taken
  from live SQL because login writes an audit row: seed 500 + 1).
- Background jobs / automation execution: initial reminder tick
  processed 800 due rows in 48,211ms (~16.6 sends/s); second pass
  9ms no-op (idempotent). Send path is ~13 sequential queries per
  reminder (per-row by design) - no N+1 anomaly, no unbounded scan
  and no cross-product; clinic-scale volume is dozens of messages
  per day, far below the 800-row batch tested -> NO optimization
  performed, per plan ("do not prematurely optimize without
  evidence").
- Concurrent ticks (2 x runReminderTick over 900 re-armed rows):
  40,150ms; optimistic claim (status+attempts WHERE) held - exactly
  900 MockProvider send calls, 900 new message rows, 900/900 SENT
  with attempts=1 (observed range across runs 40-73s; budget
  150,000ms).
- Concurrent retry behavior (after fix): 8 parallel retries of one
  FAILED message - exactly 1x200 + 7x409 in 123ms, provider invoked
  exactly once, attempts incremented once; 8 parallel retries of one
  FAILED reminder - exactly 1x200 + 7x409 in 78ms, row requeued
  once (attempts preserved).
- Webhook processing: 30 parallel signed telephony posts (20 unique
  eventIds + 10 duplicates of one) - 270ms total, avg 9ms/request,
  all 200, call_events deduped to exactly 20 rows (ER_DUP_ENTRY
  idempotency held under concurrency).

**Defect found and fixed (evidence-driven):** retryFailedJob
(src/services/observability.ts) guarded its requeue UPDATEs with
"AND status = 'FAILED'" but discarded the affectedRows result and
checked status only in a preceding SELECT - a TOCTOU race. Pre-fix
under 8 concurrent retries: message path returned 200 on 7-8 of 8
requests (each winner could reach sendMessage -> double-send), job
path returned 200 on 8 of 8. Fix: both paths now check affectedRows
and throw 409 not_failed when the conditional UPDATE matched nothing
(losing contenders); single-threaded behavior unchanged (first
attempt affects 1 row). Regression coverage: the two concurrent-
retry tests assert exactly 1x200 + 7x409, one provider call, one
attempts increment.

**Gates (all executed 2026-09-30, all green):**
- npm run verify exit 0: **295/295 tests, 28 suites, 0 skipped**
  (286 prior + 9 new M19).
- npm run verify:frontend exit 0 (frontend untouched by M19).
- npm run migrate x2: applied 0 / skipped 15 (no M19 migration
  needed), both exit 0.
- extended smoke: **SMOKE_PASS**, exit 0 (176 checks; M19 adds no
  endpoints, script unchanged).

**Bottleneck conclusion (plan requirement):** none actionable at the
measured scale; the only reliability defect exposed was the retry
concurrency race above. Tick throughput is recorded as evidence only
(K-I3 single-process scheduler unchanged; budgets are
correctness-oriented, not benchmark-grade).

**Status:** M0-M18 + F1 PASSED; M19 testing complete - report
delivered, awaiting owner acceptance; M20-M23 NOT_STARTED.

## Session 22 - M19 accepted (PASSED), M20 (End-to-end production scenarios) start

**2026-09-30. Owner instruction:** "Proceed" - M19 (Performance and
reliability) recorded **PASSED 2026-09-30** (PROJECT_STATE rev 49;
M0_Project_Audit M19 row PASSED, M20 row IN_PROGRESS). Gates at pass
unchanged from the rev 48 report: `npm run verify` exit 0
(**295/295, 28 suites, 0 skipped**), `npm run verify:frontend` exit 0
(untouched), migrate x2 (0/15 idempotent), extended smoke
**SMOKE_PASS** (176 checks). The retry concurrency fix in
`retryFailedJob` accepted with the pass; no optimization performed
(none warranted by the measurements).

**M20 (End-to-end production scenarios) started** - plan L1246-1298:
realistic scenarios A (new lead), B (missed call), C (no-show),
D (recall); "Every scenario must be tested end-to-end." Backend
scenario tests only - no delivery fork (D7/D8/D10 precedent;
FrontEnd section 41 does not gate M20).

**Planned method (PROPOSED):** one integration test per scenario in
`tests/m20.integration.test.ts`, each walking the full chain through
the real API / signed webhook / service / tick paths with assertions
at every arrow (lead rows, message rows + MockProvider calls,
appointment + reminder rows, review/recall state), reusing the
established harness (supertest + MockProvider + captured logger).
Evidence recorded per step; fix only if a scenario step fails.

**Status:** M0-M19 + F1 PASSED; M20 IN_PROGRESS; M21-M23 NOT_STARTED.

**M20 testing complete 2026-09-30 - report delivered, awaiting owner
acceptance.**

- **Method:** new suite `tests/m20.integration.test.ts` - 4 tests, one per
  scenario (A/B/C/D), each walking the full chain through real API / signed
  webhook / service / tick paths with per-step assertions (DB rows +
  MockProvider attempt counts per recipient); backend-only, no UI delivery
  fork (D7/D8/D10 precedent).
- **Scenario A:** website lead -> acknowledgement `lead_acknowledgement`
  SENT (key `ack:lead:N`, provider attempt 1) -> workspace `newLeads`
  queue contains lead -> signed WhatsApp reply `patient_reply` RECEIVED
  linked to lead (sends nothing) -> patient + appointment booked (reminder
  sequence offsets 48/24/2h PENDING) -> reminder tick sends 3/3 (attempts
  4) -> `/complete` -> review request PENDING scheduled +24h + recall DUE
  (due = visit+180d, INITIAL/FOLLOW_UP PENDING future) -> review forced
  due -> review tick sends 1 (`review_request`, request SENT, attempts 5).
- **Scenario B:** signed telephony missed webhook -> `lead_created`
  (source MISSED_CALL, NEW) + `missed_call_response` SENT (key
  `missedcall:mock:EVENT`) -> signed WhatsApp reply linked to lead ->
  patient + appointment booked (3 reminders) - no extra sends.
- **Scenario C:** `/no-show` -> case OPEN + INITIAL `no_show_message`
  SENT (FOLLOW_UP PENDING +24h) + reminders cancelled -> `/rebook` ->
  new appointment SCHEDULED (previous_appointment_id set) + case
  REBOOKED/closed -> follow-up forced due -> no-show tick sends 0
  (workflow stops; no `no_show_follow_up` message exists).
- **Scenario D:** past visit (190d ago) completed -> recall created 10d
  overdue with INITIAL `recall_message` SENT immediately (CONTACTED) ->
  recall tick sends `recall_follow_up` (2nd attempt) -> patient books
  future visit -> recall BOOKED + closed_at + rebooked_appointment_id ->
  recall tick again sends 0 (workflow stops; 0 PENDING recall_messages).
- **Test-side defect found and fixed:** forcing due rows with
  `SET scheduled_at = new Date()` (params carry ms) raced MySQL
  DATETIME(0) fractional-second handling (INSERT rounds >=.5s UP, the
  tick's due comparison effectively truncates) -> due queries missed the
  forced rows ~50% of the time per force point (seen as tick
  processed=0 in full-suite runs, green standalone). Fixed at all 3
  force points by forcing with server-side `UTC_TIMESTAMP()` (pattern
  already used by M19; floor-monotonic, deterministic). No product code
  changed. Post-fix: m20 re-run 3x consecutively 4/4 green.
- **Gates (2026-09-30):** `npm run verify` exit 0 -
  **299/299 (29 suites, 0 skipped)** (295 + 4 new);
  `npm run verify:frontend` exit 0 (untouched); `npm run migrate` x2
  applied 0 / skipped 15 (15 migrations, latest 0015_observability.sql);
  extended smoke **SMOKE_PASS** (176 checks, no endpoint changes).

**Status:** M0-M19 + F1 PASSED; M20 testing complete (report delivered,
awaiting owner acceptance); M21-M23 NOT_STARTED.

## Session 23 - M20 accepted; M21 UX review started

**2026-09-30 - owner instruction:** "if not done already, save session
log, commit, push current progress and then proceed to next phase as
proposed" - recorded as M20 acceptance (precedent: prior "Proceed"
instructions accepted M17/M18/M19).

- Save/commit/push already done before this instruction: docs rev 50 +
  `tests/m20.integration.test.ts` at `74fe4c2`, MATCH=OK, tree clean.
- **M21 scope (plan L1302-1324):** dedicated UX audit covering
  navigation, information hierarchy, forms, tables, dashboard, empty
  states, loading states, error states, mobile responsiveness,
  accessibility, typography, consistency, confirmation flows,
  destructive actions, receptionist workflow; "Fix UX problems before
  final production validation" (i.e. before M22).
- Method (PROPOSED): systematic code-level audit of frontend/ (React
  19 + Vite + TS, D9) routes/components against the 15 areas ->
  findings labelled CONFIRMED (observed in code) / ASSUMED -> fix
  confirmed findings with smallest appropriate changes -> regression
  gates (npm run verify, verify:frontend). No new feature scope
  (STRICT MVP BOUNDARY).

**Status:** M0-M20 + F1 PASSED; M21 IN_PROGRESS; M22-M23 NOT_STARTED.

## Session 24 - M21 UX review complete (gates green, awaiting acceptance)

**2026-09-30 - M21 execution** (method accepted at Session 23: code-level
audit of frontend/ -> findings labelled CONFIRMED/ASSUMED -> fix confirmed
findings -> regression gates; no new feature scope, STRICT MVP BOUNDARY
FrontEnd 46; backend-only UI delivery unchanged per D7/D8/D10).

- Audit: two parallel explore-agent reviews of `frontend/` (44 files)
  against plan L1302-1324's 15 areas + `FrontEnd_Planning.md` 45
  (Login/Settings/Templates workflows reviewed in place; Dashboard,
  Workspace, Lead, Patient, Appointment, No-show, Recall, Communication
  and Automation screens do not exist as UI - deferred to the owner's
  future UI phase by D7/D8/D10 - recorded as not-reviewable for M21).
- Findings re-verified in source before fixing (2 blocking contract
  defects confirmed by direct read, not agent trust):
  - **F-01** `TemplateEditorPage` save sent `{ content }`; backend
    `readTemplateBody` (src/services/settings.ts) accepts only `body` ->
    template save could not persist (CONFIRMED).
  - **F-02** `saveWhatsApp` sent top-level `accessToken`; backend
    `sanitizeNullableStrings` -> `mergeSection` throws on unknown field ->
    any WhatsApp save with a typed token would fail (CONFIRMED).
  - **F-07** disable-user existed (`DELETE`), no re-enable path anywhere
    (CONFIRMED) - disable was irreversible in the delivered product.
- Fixes executed (all gated):
  1. F-01 -> `{ body: content }`; locked by new
     `frontend/src/pages/settings/TemplateEditorPage.test.tsx` (2 tests:
     save payload + preview payload both `{ body }`).
  2. F-02 -> token nested under `graph.accessToken`; secrets stay
     write-only; Clear secrets disabled when already staged + visible
     notice "Secrets will be cleared on save."; locked by new
     `CommunicationSettingsPage.test.tsx` (2 tests: graph nesting, notice).
  3. F-07 -> `POST /api/organizations/:orgId/users/:userId/enable`
     (assertCanManageMembers, org check -> 404, audit `user_enabled`);
     `tests/auth.integration.test.ts` +2 assertions (cross-org enable 404;
     disable -> enable -> login 200).
  4. F-03/F-04 (FrontEnd 47 forbidden placeholder UI): Sidebar "Planned
     M19/M20/M21" block (wrong milestone IDs) and LandingPage roadmap copy
     removed; receptionist/Landing now honest - "No screens for your
     account yet" + nav empty-state (D7 deferral surfaced, not hidden).
  5. F-06: Unauthorized circular link -> "Home".
  6. Headings: 14 settings card titles div -> h2; 404/401 titles -> h1
     (EmptyState `heading` prop); dialog title -> h2; ErrorState
     `retryLabel` (TemplateEditor "Back to templates").
  7. Contrast (computed WCAG ratios, node calculation): `--badge-warn-text`
     #8a6d1d -> #7f641a (4.43 -> 5.07:1 on #fdf3d7); new
     `--color-border-control` #868c96 (3.38:1 white / 3.13:1 bg, was 1.36:1)
     on inputs/selects/textareas/secondary buttons.
  8. Responsive: sidebar nav horizontal scroll row <=820px (B1); business
     hours rows stack <=820px (B3); Clinic users table wrapped in focusable
     labelled `.table-scroll` region + `scope=col` (B2); automation badges
     state On/Off in text (B4 color-only).
  9. A11y: FormField `group-label` (label-clone no longer orphaned),
     aria-describedby/aria-invalid, error `role="alert"`; ConfirmDialog
     focuses Cancel, Escape ignored while busy; `:focus-visible` outlines;
     `prefers-reduced-motion` disables spinner.
  10. Copy/cleanup: `Source: default` jargon -> `sourceLabel()` (Clinic
      setting / Server-wide setting / Default setting) at 6 badge sites +
      variable tooltip; password hint -> "12-200 characters"; role-matrix
      jargon line removed; enable button + "You can re-enable the account
      later."; header "Practice management" -> "Home"; unused SessionError
      removed; duplicate top-level router `*` route removed; login email
      `autoFocus`; member messages moved into Clinic users card.
- Deferred / PROPOSED (NOT fixed, awaiting owner): F-05 receptionist has no
  delivered screens (D7/D8/D10), F-09 forgot-password (FrontEnd A1),
  F-11 no 401 auto-redirect, F-40 receptionist settings-access matrix
  doc-vs-code, B6 unsaved-changes guard, password show/hide toggle,
  per-route document.title, client error boundary, full dialog focus trap,
  B5 error-placement refactors, template-list status labels, login
  noValidate. Assumed rendering-dependent findings (visual hierarchy,
  mobile feel) remain ASSUMED - code-level review only, no browser session.
- Gates (all executed 2026-09-30, after fixes):
  - `npm run verify:frontend` exit 0 (eslint 0; vitest **24/24**, 7 files;
    tsc + vite build OK).
  - `npm run verify` exit 0 (eslint 0; tsc 0; vitest **299/299**, 29
    suites, 0 skipped; build OK).
  - `npm run migrate` x2: applied 0 / skipped 15 both runs (idempotent).
  - extended smoke `m3-smoke.ps1`: **SMOKE_PASS** (176 checks; the new
    enable endpoint is covered by integration tests, not by smoke).
- Docs rev 52: PROJECT_STATE L5 M21 review-complete/awaiting-acceptance,
  L9 rev 52, blockquote + row 52; M0_Project_Audit M21 row ->
  REVIEW COMPLETE (gates + fix/deferred lists).

**Status:** M0-M20 + F1 PASSED; M21 review complete (awaiting acceptance);
M22-M23 NOT_STARTED.

## Session 25 - M21 accepted PASSED; M22 production readiness started

**2026-09-30 - owner instruction:** "if not done already, save session
log, commit, push current progress and then proceed to next phase as
proposed" - save/commit/push already done before this instruction
(docs rev 52 + M21 fixes + 4 new tests at `cc6c6dd`, MATCH=OK, tree
clean). Recorded as M21 acceptance (precedent: prior instructions
accepted M17/M18/M19/M20).

- **M21 PASSED 2026-09-30** - gates at pass: verify 299/299 (29 suites,
  0 skipped), verify:frontend exit 0 (eslint 0, vitest 24/24, build OK),
  migrate x2 0/15 idempotent, extended smoke SMOKE_PASS 176 checks.
  Deferred/PROPOSED M21 findings stay open as recorded in Session 24.
- **M22 scope (plan L1328-1348):** verify 16 areas - environment
  configuration, database migrations, backups strategy, logging,
  monitoring, error tracking, security, deployment, rollback strategy,
  provider configuration, webhook URLs, cron/background workers,
  email/SMS/WhatsApp configuration, rate limits, documentation - then
  perform final production build and tests.
- Method (PROPOSED): repo-level verification of each area -> per-area
  CONFIRMED/ASSUMED/UNKNOWN verdicts -> fix in-repo gaps (docs, scripts,
  config) -> final production build + full regression gates.
- Entry-gate items that cannot be verified from this workstation are
  flagged, not claimed: **B4** legal/consent position (owner answer,
  K-I5/R6); **B6** remaining DirectAdmin server answers (K-I2 inbound
  HTTPS/DNS, K-I3 process persistence - owner/server side, UNKNOWN);
  **K-I4** provider accounts (owner side). Rule 11: no deployment or
  destructive/irreversible action without explicit owner instruction.

**Status:** M0-M21 + F1 PASSED; M22 IN_PROGRESS; M23 NOT_STARTED.

## Session 26 - M22 production readiness verified (gates green, awaiting acceptance)

**2026-10-01 - M22 execution** (plan L1328-1348; method as recorded at
Session 25: repo-level verification of the 16 areas -> per-area verdicts
-> fix in-repo gaps -> final production build + full regression gates).

Per-area verdicts (evidence = direct file reads this session):

1. **Environment configuration - CONFIRMED.** `src/config.ts` fail-fast
   `ConfigError` (required DB_HOST/DB_USER/DB_PASSWORD/DB_NAME, enum
   NODE_ENV/LOG_LEVEL, port range checks); `.env.example` documents all
   vars; `.gitignore` excludes `.env*` (keeps `.env.example`); no secrets
   in tracked files (M18).
2. **Database migrations - CONFIRMED.** 15 migrations, explicit
   `npm run migrate` (server does not auto-migrate), applied/skipped
   tracking, idempotent (x2 runs 0/15 every gate), no DROP/TRUNCATE/
   DELETE FROM anywhere in migrations/.
3. **Backups strategy - MISSING in-repo.** No backup/restore scripts or
   docs (grep clean). Owner question "Backup and recovery expectations"
   (PROJECT_STATE 4.2) still unanswered. Fixed: honest status + suggested
   approach documented in README; execution = owner/server side.
4. **Logging - CONFIRMED.** `src/logger.ts`: structured JSON lines,
   levels, secret-key redaction + `redactUrl()` (M18), stdout only (no
   rotation - process-manager side, recorded).
5. **Monitoring - CONFIRMED (in-app).** `GET /health` 200/503 with DB
   status + uptime; `/api/organizations/:orgId/observability/*` (automation/
   communication/webhook/error/audit logs, failed jobs, diagnostics with
   DB up + scheduler ticks) behind requireAuth; `/api/admin/observability/*`
   behind requireRole('admin'). No external uptime/log integration (owner).
6. **Error tracking - CONFIRMED.** error_events table (0015), express
   `errorHandler`/`notFoundHandler`, failed-job records + requeue API;
   no process-level uncaughtException/unhandledRejection handlers (Node
   default = exit; recorded as known limitation).
7. **Security - CONFIRMED** (re-verified, M18 baseline): headers
   (nosniff/XFO DENY/Referrer-Policy), scrypt + timingSafeEqual passwords,
   HttpOnly/SameSite=Lax/Secure-in-production cookies, logout revocation,
   tenant isolation, no CORS (D6 by design). CSP remains PROPOSED (M18).
8. **Deployment - PARTIAL.** `npm run build` -> `dist/`, `npm start`;
   frontend `vite build` served by Express (`frontend/dist`, UI_DIST_DIR
   override); engines node>=20; graceful shutdown; DB check at boot;
   admin seed script. No CI/Docker/process-manager configs (owner side).
   Fixed: production deployment outline added to README.
9. **Rollback strategy - MISSING in-repo.** No rollback scripts/docs;
   migrations are forward-only (no down migrations). Fixed: factual
   rollback posture documented in README (app = redeploy previous build;
   DB = restore backup); detailed runbook = owner decision.
10. **Provider configuration - CONFIRMED.** Registered communication
    providers: `mock` (default) + real `WhatsAppProvider` (Meta Graph,
    registered at app bootstrap when credentials present); telephony
    adapters: Twilio + mock; per-org secrets write-only in Settings (API
    never returns them); channel (SMS/WHATSAPP) and provider switchable
    per-org via settings API (`mergeSection` allows base-config keys).
11. **Webhook URLs - CONFIRMED.** `POST /api/webhooks/telephony/:provider/
    :orgId` (adapter signature header verified against signing secret),
    `GET`+`POST /api/webhooks/whatsapp/:orgId` (verify-token handshake,
    X-Hub-Signature-256 raw-body check); both 200/min/IP rate-limited,
    idempotent. Fixed: exact paths + provider-side setup documented in
    README.
12. **Cron/background workers - CONFIRMED (single instance).** One
    in-process scheduler (`src/index.ts`): reminder/no-show/recall/review
    ticks every `REMINDER_TICK_MS` (default 60s), unref'd, tick state
    observable via diagnostics; SIGINT/SIGTERM graceful shutdown; failed-job
    requeue is manual only (observability API - no auto-retry scheduler,
    recorded). K-I3 (process persistence on server) remains UNKNOWN;
    single-instance constraint documented in README (multi-instance would
    double-run jobs).
13. **Email/SMS/WhatsApp configuration - CONFIRMED with gap noted.**
    Channel enum is SMS/WHATSAPP (no email channel implemented). Real SMS
    transport is NOT implemented (mock provider only for SMS); WhatsApp is
    the real outbound channel (Graph API, org credentials); Twilio exists
    as telephony adapter (missed-call webhooks). Real SMS provider +
    provider accounts = K-I4 owner side.
14. **Rate limits - CONFIRMED** (`src/security/rateLimit.ts`, in-memory
    fixed window): login 10/min, public lead 30/min/IP + 120/min/key,
    webhooks 200/min/IP. **Gap found + fixed:** `trust proxy` was never
    configured, so behind a reverse proxy every limiter would key on the
    proxy address (all users sharing one 10/min login bucket); added
    `TRUST_PROXY` env -> `app.set('trust proxy')` (config.ts/app.ts/
    index.ts) + 3 config tests. Authenticated APIs remain unlimited
    (accepted at M18).
15. **Documentation - PARTIAL -> improved.** README covered dev setup/
    commands/env/health only; added: frontend + seed commands, new env
    vars, production deployment outline, webhook configuration, monitoring
    endpoints, backups/rollback status. Project docs (plan, PROJECT_STATE,
    SESSION_LOG, audit) unchanged. External runbooks = owner side.
16. **Final production build and tests - EXECUTED.**
    - `npm run verify` exit 0: eslint 0, tsc 0, vitest **302/302**
      (29 suites, 0 skipped; +3 TRUST_PROXY tests), `tsc -p
      tsconfig.build.json` (production backend build) OK.
    - `npm run verify:frontend` exit 0: eslint 0, vitest **24/24**,
      `tsc -b && vite build` OK (production frontend bundle built).
    - `npm run migrate` x2: applied 0 / skipped 15 (idempotent).
    - extended smoke `m3-smoke.ps1`: **SMOKE_PASS** (176 checks).

Files changed this milestone: `src/config.ts` (TRUST_PROXY parsing),
`src/app.ts` (AppDeps.trustProxy + app.set), `src/index.ts` (wire),
`tests/config.test.ts` (+3 tests), `.env.example` (+TRUST_PROXY,
UI_DIST_DIR, REMINDER_TICK_MS), `README.md` (commands, env, webhooks,
monitoring, backups/rollback, production deployment).

Rule 11: no deployment, no destructive/irreversible action performed.
Owner-side UNKNOWNs flagged, not claimed: B4 legal position (K-I5/R6),
B6 server answers (K-I2 HTTPS/DNS, K-I3 process persistence), K-I4
provider accounts, backups execution, external monitoring.

**Status:** M0-M21 + F1 PASSED; M22 verification complete (awaiting
acceptance); M23 NOT_STARTED.

## Session 27 - M22 accepted PASSED; M23 final acceptance started

**2026-10-01 - owner instruction:** "proceed next" - recorded as M22
acceptance (precedent: prior instructions accepted M17-M21; session log,
commit and push already done at `1f603bf`, MATCH=OK, tree clean).

- **M22 PASSED 2026-10-01** - gates at pass: verify 302/302 (29 suites,
  0 skipped), verify:frontend exit 0 (24/24), migrate x2 0/15 idempotent,
  extended smoke SMOKE_PASS 176 checks. Owner-side items stay flagged
  (B4/K-I5, B6/K-I2/K-I3, K-I4, backups, external monitoring).
- **M23 scope (plan L1352-1374):** run the entire test suite - unit,
  integration, E2E, security, type checking, lint, build, database
  migration tests, webhook, automation, tenant isolation - then execute
  the complete end-to-end scenarios; only declare the project complete if
  all defined acceptance criteria pass.
- Method (PROPOSED): full regression gates (`npm run verify`,
  `npm run verify:frontend`, `npm run migrate` x2) + explicit re-run of
  `tests/m20.integration.test.ts` (complete scenarios A-D) + extended
  smoke. Acceptance criteria = M0-M22 all PASSED + all gates green.
  Owner-side UNKNOWNs remain deployment-side and are not claimed;
  Rule 11 - no deployment without explicit instruction.

**Status:** M0-M22 + F1 PASSED; M23 IN_PROGRESS.

## Session 28 - M23 final acceptance suite green (awaiting owner declaration)

**2026-10-01 - M23 execution** (plan L1352-1374; method as recorded at
Session 27). Checklist -> execution -> results:

- **Unit + integration + security + webhook + automation + tenant
  isolation + type checking + lint + build** (entire suite):
  `npm run verify` exit 0 - eslint 0, tsc 0, vitest **302/302**
  (29 suites, 0 skipped), `tsc -p tsconfig.build.json` production build OK.
- **Frontend suite:** `npm run verify:frontend` exit 0 - eslint 0,
  vitest **24/24** (7 files), `tsc -b && vite build` production bundle OK.
- **Database migration tests:** `npm run migrate` x2 - applied 0 /
  skipped 15 both runs (idempotent).
- **Complete end-to-end scenarios:** explicit re-run
  `npx vitest run tests/m20.integration.test.ts` - **4/4 passed**
  (A website lead chain, B missed-call chain, C no-show chain,
  D recall chain, each end-to-end).
- **Extended smoke** (`m3-smoke.ps1`): **SMOKE_PASS** (176 checks -
  auth, tenancy, public lead, appointments, no-show, recall, review,
  webhooks with signatures, dashboard, workspace, settings, observability,
  security headers, logout invalidation, health).

Acceptance criteria check (plan L1374 "Only declare the project complete
if all defined acceptance criteria pass"):
- M0-M22 + F1 all PASSED: CONFIRMED (PROJECT_STATE L5, M0_Project_Audit
  milestone table).
- All defined gates green at M23: CONFIRMED (results above).
- Owner-side items remain open and are NOT claimed as verified: B4
  legal/consent position (K-I5/R6), K-I2 inbound HTTPS/DNS, K-I3
  process persistence, K-I4 provider accounts, automated backups,
  external monitoring. These are deployment-side and were never in the
  repo's verifiable scope (recorded since M0/M22).
- Rule 11: no deployment performed.

0 defects found during M23 (0 fixes needed; no code changed this
milestone - verification only). Docs rev 56 records the results.

**Status:** M0-M22 + F1 PASSED; M23 final suite green - report delivered,
awaiting owner final acceptance (project completion is the owner's
declaration).

## Session 29 - M23 accepted PASSED; PROJECT DECLARED COMPLETE

**2026-10-01 - owner instruction:** "proceed next" - recorded as M23
acceptance and the owner's project-completion declaration (precedent:
each prior "proceed" instruction accepted the milestone under review;
M23 is the final milestone, plan L1352-1374; session log, commit and
push already done at `6d02e47`, MATCH=OK, tree clean).

- **M23 PASSED 2026-10-01** - gates at pass: entire suite verify
  **302/302** (29 suites, 0 skipped; unit, integration, E2E, security,
  webhook, automation, tenant isolation + typecheck + lint + production
  build), verify:frontend exit 0 (**24/24** + vite build), migrate x2
  0/15, complete E2E scenarios A-D **4/4**, extended smoke
  **SMOKE_PASS** (176 checks).
- **Plan L1374 satisfied:** "Only declare the project complete if all
  defined acceptance criteria pass" - all milestones M0-M23 + F1 are
  PASSED (M0_Project_Audit milestone table), every gate green, 0 open
  blocking defects. PROJECT DECLARED COMPLETE by the owner.
- Final repository state: 29 backend/shared test suites (302 tests) +
  7 frontend test files (24 tests) = 326 tests total, all green;
  migrations 0001-0015; frontend production bundle built; docs at
  revision 57.
- Known limitations carried into completion (flagged, never claimed -
  deployment-side, mostly owner answers): B4 legal/consent position
  (K-I5/R6 - compliance must not be claimed), K-I2 inbound HTTPS/DNS,
  K-I3 process persistence (single-instance scheduler), K-I4 provider
  accounts (no live traffic until added), automated backups, external
  monitoring, real SMS transport (mock default; WhatsApp is the real
  channel), deferred UX/UI items (D7/D8/D10 screens, FrontEnd A1
  forgot-password, M21 PROPOSED list).
- Rule 11: no deployment performed; deployment requires an explicit
  owner instruction and should follow README "Production deployment
  (outline)" + M22 owner-side checklist.

**Status:** PROJECT COMPLETE - M0-M23 + F1 all PASSED (owner
declaration 2026-10-01). Remaining work is owner-side: deployment,
provider accounts, legal position, backups, monitoring.

## Session 30 - F2 complete (member-facing UIs, password reset, test depth); all gates green

**2026-10-01 - owner directive:** "everything in the product should be
built and tested" - F2 executed after PROJECT DECLARED COMPLETE (rev 57,
`206ddbc`): all remaining member-facing UIs per FrontEnd_Planning 8-17,
plus test-depth gaps (coverage tooling, browser E2E per Section 44).
Deployment/owner-only items remain out of scope (Rule 11).

- **Backend F2:** recalls service+routes (`src/services/recalls.ts`, `src/routes/recalls.ts`), messages filters + exported `messageDto`,
  communications GET member-visible, leads `communicationHistory`,
  observability `subjectId` positive-int filter;
  `tests/f2.integration.test.ts` **31/31**.
- **Password reset (FrontEnd A1):** migration `0016_password_reset_tokens` (sha256 tokens, 30-min TTL, RESET_TOKEN_TTL_MINUTES),
  `src/auth/passwordReset.ts`, `src/mail/passwordResetMailer.ts`
  (injectable; mock transport in tests; SMTP_* env; nodemailer 10.0.13 +
  types, 0 audit vulns), routes: POST `/api/auth/forgot-password`
  (generic 200 + warn logs; 5/15min ip|email) and POST
  `/api/auth/reset-password` (requirePassword 12-200 checked BEFORE the
  limiter; 400 invalid_reset_token; 429 rate_limited 10/ip; revokes
  sessions), `.env.example` RESET_BASE_URL + SMTP_*;
  `tests/passwordReset.integration.test.ts` **10/10**. Known limitation (documented, accepted): token-validation timing side-channel bounded by
  rate limits.
- **Frontend F2:** 11 member-facing screens (workspace, dashboard, leads,
  patients, appointments, communications, recall, automations + supporting
  list/detail views) + ForgotPasswordPage/ResetPasswordPage, router public
  routes + login reset-flash, shell guards/Sidebar/AppShell/Landing wiring;
  shared `useApi.ts`/`format.ts`/`constants.ts`,
  `CommunicationTimeline`, `Pager`; tests: `screens.test.tsx` **11/11** (renderPage wraps `<Routes>` for useParams; queryByText for absence
  asserts), `authPages.test.tsx` **8/8** (fetch-args asserts via tuple
  cast), `routeAccess.test.tsx` 9/9; frontend total **47/47** (9 files).
- **Coverage tooling:** `@vitest/coverage-v8` root + frontend,
  `test:coverage` scripts, v8 provider + json-summary reporters in
  `vitest.config.mts` + `frontend/vite.config.ts`. Recorded (measurement, NOT a gate): backend **85.43% stmts / 74.64% branches /
  91.28% funcs / 85.58% lines**; frontend **38.62% stmts / 34.96%
  branches / 33.53% funcs / 41.07% lines** (frontend low by design -
  flows covered by Playwright instead).
- **Playwright E2E (Section 44):** `@playwright/test` 1.63 + chromium (Chrome 153); `playwright.config.ts` (webServer `tests/e2e/serve.ts`
  on port 3799 with TEST_DB_* + REMINDER_TICK_MS=0 + LOG_LEVEL=warn,
  globalSetup, workers 1, locale en-US); `tests/e2e/`: serve.ts creates
  the DB + runs migrations itself - CONFIRMED by reading the Playwright
  runner: webServer plugin setup runs BEFORE globalSetup; globalSetup (asserts frontend/dist exists, migrates, seeds), seed.ts (E2E org + 2
  users + fixtures; org-scoped cleanup; em dashes preserved - file was
  once corrupted and fully rewritten), db/dates/helpers,
  `scenarios.spec.ts` **5/5** (lead, missed call, confirm+reschedule,
  no-show+rebook with DB assertions, recall); script `test:e2e`
  (root package.json); `.gitignore` test-results/ + playwright-report/.
- **Defects/incidents this session:** (1) PowerShell file corruption -
  `Get-Content -Raw` + `-replace` + `Set-Content -Encoding UTF8`
  decoded UTF-8 source as ANSI (mangled em dashes, emptied a file) ->
  rule: never rewrite UTF-8 sources via PS text cmdlets; use Write/Edit
  tools + byte-scan verify. (2) Root tsconfig includes tests/** - e2e
  files need `import('../../src/index.js')` (.js extension, TS2835
  under node16); no-console error avoided in playwright.config.ts.
  (3) webServer-before-globalSetup ordering -> serve.ts self-bootstraps
  DB. (4) authPages fetch-args narrowing fixed with tuple cast
  `(call as unknown as [RequestInfo | URL, RequestInit?])[1]`.
- **Full gates (all green):** backend `npm run verify` **343/343** (31 suites, 0 skipped; lint+tsc+vitest+build), `verify:frontend`
  **47/47** (9 files) + eslint 0 + tsc 0 + vite build OK,
  `npm run migrate` x2 (0016 applied then 0/16 idempotent), m20 re-run
  **4/4**, extended smoke `m3-smoke.ps1` **SMOKE_PASS**, Playwright
  **5/5** (33.0s).
- Docs at revision 58; AGENTS.md observed untracked in the repo (owner to decide - left out of the F2 commit).

**Status:** F2 implementation complete - gates green, report delivered,
awaiting owner acceptance. PROJECT remains COMPLETE (M0-M23 + F1 PASSED).


## Session 31 - F2 accepted PASSED

**2026-10-01 - owner instruction:** "proceed" - recorded as F2 acceptance
(precedent: each prior "proceed" instruction accepted the milestone under
review; F2 report delivered at rev 58, commit `eeba730`, MATCH=OK).

- **F2 PASSED 2026-10-01** - gates at pass (executed and observed green
  before the report): backend `npm run verify` **343/343** (31 suites,
  0 skipped; lint + tsc + vitest + build), `verify:frontend` **47/47**
  (9 files) + eslint 0 + tsc 0 + vite build OK, `npm run migrate` x2
  (0016 applied then 0/16 idempotent), m20 scenarios re-run **4/4**
  (analysis of the executed run), extended smoke `m3-smoke.ps1`
  **SMOKE_PASS**, Playwright E2E **5/5** (33.0s).
- Scope accepted: recalls/messages/communications backend, forgot/reset
  password flow (migration 0016, SMTP via env with injectable mailer,
  mock-transport tests), 11 member-facing screens + Forgot/Reset pages
  wired into shell/guards/router, coverage tooling (backend 85.43% stmts
  / frontend 38.62% stmts - measurement, not a gate), Playwright +
  Chromium harness (`tests/e2e`, 5 scenarios per FrontEnd Section 44).
- Owner-side items unchanged (flagged, never claimed): SMTP_* credentials
  (reset email inert until supplied), deployment (Rule 11), provider
  accounts (K-I4), legal position (K-I5/R6), HTTPS/DNS (K-I2), process
  persistence (K-I3), automated backups, external monitoring.
- PROPOSED backlog awaiting an explicit next-phase instruction (Rule 1 -
  no new development phase without owner instruction): M21 deferred UX
  polish items (F-11 401 auto-redirect, unsaved-changes guard, password
  show/hide, per-route document.title, error boundary, full dialog focus
  trap, template-list status labels, login noValidate), CSP header (M18
  PROPOSED - now testable via Playwright), FrontEnd Appendix A screens
  absent from the router (CONFIRMED by inspection: /admin/webhooks,
  /admin/automation-failures, /admin/audit deferred per D10;
  /appointments/calendar; /automations/activity), F-40
  settings-access matrix doc-vs-code check. Also still untracked:
  `AGENTS.md` (owner to decide whether to track it).

**Status:** F2 PASSED 2026-10-01 (owner acceptance). PROJECT remains
COMPLETE - M0-M23 + F1 + F2 all PASSED. No new phase started; awaiting
owner instruction for next work (Rule 1).

## Session 32 - post-completion backlog (Options 1-4) executed; deployment instructed

**2026-10-01/02 - owner instructions (recorded across this working
session):** "all 5 one by one" (execute the rev 59 PROPOSED backlog one
item at a time); "I don't really understand the technical glitches...
make correction to the best of logical application to all and whatever
the issues are" (scope authorization for the F-40 doc-vs-code
corrections); "Continue if you have next steps" (recap delivered, then
continuation - this session); closing instruction: "Lets commit and push
then we will start deployment on DirectAdmin with Node.js, MySql and
Server based SSH Terminal" (Rule 11 owner instruction - deployment start
approved; commit/push happen first, deployment NOT started in this
entry).

- **Option 1/5 M21 deferred UX polish - commit `1c23b0e`
  (2026-10-01):** session-expired 401 flow, unsaved-changes guards,
  dialog focus trap, error boundary, per-route document.title, login
  validation, template status badges. Gate: verify:frontend **67/67**
  (15 files).
- **Option 2/5 CSP header (M18 carry-over) - commit `a735aec`
  (2026-10-01):** Content-Security-Policy on all responses (style-src
  'unsafe-inline' for React inline styles), +1 app test, +1 Playwright
  security spec. Gates: verify **344/344**, E2E **6/6**.
- **Option 3/5 FrontEnd Appendix A routes - commit `dc50060`
  (2026-10-02):** /admin/webhooks, /admin/automation-failures,
  /admin/audit (Result column derived from reason/status),
  /automations/activity (owner|admin), /appointments/calendar (all
  members; month grid + day panel); settings "Operational screens"
  section, header links, calendar CSS; 3 new test files, routeAccess
  additions, tests/e2e/appendixAScreens.spec.ts. Gates:
  verify:frontend **87/87**, verify **344/344**, E2E **8/8**.
- **Option 4/5 F-40 settings-access matrix check - commit `3ed1134`
  (2026-10-02):** full doc-vs-code audit of route guards vs
  FrontEnd_Planning 2.1; new capability layer
  frontend/src/lib/capabilities.ts (32 capabilities + lock test) +
  RequireCapability route guard; canManageSettings deleted; Add-patient
  button gated by patients.create (backend truth: owner|admin); lead
  notes confirmed manager-only (backend services/leads.ts status-only
  rule for receptionist - the doc's receptionist column was wrong; code
  was right for settings/automations); FrontEnd_Planning 2.1
  receptionist column corrected (settings/automations Limited/Yes ->
  No; patients/:id/edit + appointments/:id/reschedule -> No), footnotes
  for 10 non-routed appendix rows, 2.2/2.3 resolution notes. Gates:
  verify:frontend **92/92** (19 files), verify **344/344** (31 suites),
  E2E **8/8**.
- **Option 5:** reframed by the owner's closing instruction -
  deployment on DirectAdmin (Node.js + MySQL, server SSH terminal)
  replaces the owner-side placeholder. Not started in this entry.
- **Environment incident:** Docker engine down at session start (backend
  tests ECONNREFUSED 127.0.0.1:3306) -> Docker Desktop started,
  dentalistics-mysql container started, port 3306 verified, full gates
  re-run green (verify 344/344, E2E 8/8).
- **Docs (this entry):** PROJECT_STATE rev 60; M0_Project_Audit F2-row
  backlog clause updated (items now executed). Still untracked:
  AGENTS.md (owner to decide whether to track it).

**Status:** Options 1-4 complete and committed (4 commits ahead of
origin before this docs commit). PROJECT remains COMPLETE - M0-M23 +
F1 + F2 all PASSED, backlog Options 1-4 done. Next (same session):
push all commits with MATCH=OK, then DirectAdmin deployment prep per
owner instruction.

## Session 33 - production deployment executed; null-org loading root cause + fix; SaaS direction recorded

**2026-10-03 - owner instructions (recorded across this session):**
deployment answers supplied in an interview (commands are executed by
the owner in the DirectAdmin server SSH terminal, blocks prepared by
Codex with pasted output returned); domain
`https://dentalistics.apexsol.pk`; GitHub repo public; "save session
log when done"; defect decision "Fix now (Recommended)" for the
no-clinic infinite-loading issue; product-direction statement: "The
main concept of this application was to sell it to dental clinics
globally... an onboarding process where a dental clinic's owner would
subscribe to monthly plans and signup after payment... the Onboarding
process asks details regarding the clinic intelligently and smartly...
the name of the clinic and login and everything should be according to
the client's profile"; "Continue if you have next steps, or stop and
ask for clarification if you are unsure how to proceed".

**Deployment EXECUTED (owner ran the prepared blocks; results observed
in chat):** server user `apexsolp` on `dwh1`, app root
`/home/apexsolp/domains/dentalistics.apexsol.pk/app`; Node **22.23.2**
installed to `~/local/node22` (server lacks `xz`; .tar.gz route; PATH
exported in `~/.bashrc`); `npm ci` at root **and** in `frontend/`
(separate package - `cd frontend && npm ci` is mandatory); `.env`
created (11 keys, chmod 600; NODE_ENV=production, PORT=3000,
TRUST_PROXY=1, RESET_BASE_URL=https://dentalistics.apexsol.pk, DB
`apexsolp_dental`@127.0.0.1, SMTP_* intentionally unset - values never
written into this file); backend build + `frontend` `tsc -b && vite
build` green; `migrate` **16/16 applied (22 tables, matches dev)**;
`seed:admin` complete (admin email
`admin@dentalistics.apexsol.pk`, organizationId null); DA Node app
created - absolute startup paths errored, **relative form
`domains/dentalistics.apexsol.pk/app` + `dist/index.js` CONFIRMED
working**; webserver is **LiteSpeed** (not nginx).

**Production verification (CONFIRMED from this machine over HTTPS):**
`/health` 200 `{"status":"ok","database":"up"}`; admin login POST 200;
`/login` serves the SPA (hashed assets 200: 422 KB JS + CSS); security
headers (nosniff, X-Frame-Options DENY, Referrer-Policy, full CSP)
present on responses via LiteSpeed passthrough. NOT VERIFIED: bare `/`
(earlier served the LiteSpeed placeholder - owner was told to
`mv public_html/index.html public_html/index.html.disabled`; outcome
never confirmed in chat).

**Defect reported: clinic screens stuck on "Loading…" - root cause
CONFIRMED by code (not a server issue):** `useApi.ts:32` returns
without fetching when `path === null`, and `useApi.ts:50` keeps status
`loading` for a null path; every org-scoped page builds
`path = orgId === null ? null : '/api/organizations/...'`
(DashboardPage:55, LeadsPage:54, AuditLogPage:38 and ~15 pages), while
the platform admin logs in with `organizationId: null` (backend
`auth.ts:92` emits `?? null`) -> permanent spinner by construction.
Secondary CONFIRMED finding: the frontend contains **zero `/api/admin`
references** - no UI exists to create a clinic; clinic creation exists
only in the admin API (`POST /api/admin/organizations` `{name}`;
`POST /api/admin/organizations/:orgId/users`
`{email,password,role}`).

**Fix executed per owner instruction "Fix now" - commit `aadd21b`:**
`RequireClinic` guard (frontend/src/app/guards.tsx) renders "No clinic
linked to this account" (EmptyState) instead of the shell contents when
`user.organizationId` is null; router wraps all AppShell children with
it; `SessionUser.organizationId` corrected to `number | null` in
frontend/src/lib/types.ts (latent type hole vs backend runtime -
TemplateEditorPage preview added a null guard); +2 tests in
routeAccess.test.tsx (dashboard + settings null-org). **Gates actually
executed: verify 344/344 (31 suites), verify:frontend lint + 94/94
(19 files, +2) + vite build, both exit 0.** Fix NOT yet on the server
(owner must `git pull` + `npm run build:frontend` + DA app restart).

**Product direction recorded (owner-stated intent CONFIRMED; all
implementation requirements UNKNOWN):** the application is to be sold
globally to dental clinics as a subscription SaaS - the clinic owner
subscribes to a monthly plan, signs up after payment, then a smart,
progressive onboarding collects clinic details; clinic name, login and
content derive from that profile. NO code started (Rule 1 - a new
phase requires explicit owner instruction). Prepared questions for the
owner: payment provider/methods, plan tiers + prices + currency,
exact payment-to-signup order, onboarding questionnaire scope, and
whether the current admin-created-clinic flow stays as an internal
fallback.

**Open items:** (1) clinic bootstrap values (clinic name / owner email
/ owner password) requested twice - the question tool did not carry the
owner's custom text (returned labels only), awaiting a plain-text
reply; (2) placeholder `public_html/index.html` rename unconfirmed;
(3) onboarding requirements pending answers; (4) `AGENTS.md` untracked
(owner to decide); (5) carried owner-side items unchanged: SMTP_*
(reset mail inert), K-I4 provider accounts, Force HTTPS/HSTS unconfirmed
(HTTPS+DNS themselves CONFIRMED live), K-I3 process persistence across
reboot NOT VERIFIED (the DA app process is running now), backups,
external monitoring, B4 legal position.

**Status:** fix `aadd21b` committed; this docs entry committed next;
push with MATCH=OK follows. Deployment live and loginable; the no-clinic
message reaches production only after the owner's frontend rebuild.
Next: owner redeploys frontend, supplies clinic bootstrap values,
answers onboarding questions.

**[Update 2026-10-03 - deployment converged]:** server rebuild
succeeded with memory caps (`GOMAXPROCS=1 GOMEMLIMIT=256MiB
NODE_OPTIONS=--max-old-space-size=768`; vite built in 5.67s; the prior
esbuild crash's fatal-error header was never captured, so OOM remains
ASSUMED, though the GC-thrash goroutine dump + success-under-caps are
consistent with it); DA app restarted (/health 200, uptimeSeconds 1).
**CONFIRMED from here:** `/login` serves `index-DPjn0nuz.js` -
hash-identical to the locally verified build - and the served bundle
contains "No clinic linked to this account" -> **RequireClinic fix LIVE
in production** (unit-tested + bundle-verified; a real-browser
admin-session walkthrough is still NOT VERIFIED). Root `/` now serves
the SPA (395 B, `id="root"`) -> placeholder rename resolved. Open:
clinic bootstrap values (3), PROPOSED `sourcemap: false` for production
builds (build memory + public source exposure), SaaS onboarding
requirements. Note for any future server build: export the three caps
before `npm run build` in `frontend/`.


## Session 34 - SaaS phase opened (plans decided, payment deferred); S1a+b signup + plans backend

**2026-10-03 - owner instructions (recorded verbatim):** Payoneer
receiving-bank details were supplied in chat (Citibank US account,
beneficiary Ali Akber) with "You can work away with everything else.
We will do that payment gateway process in the end"; plan decisions:
"Free Plan for 7 days trial / Full plan $20 per month". Security note:
the Payoneer account values exist only in the chat transcript and are
deliberately NOT written into any repository file (public GitHub repo);
payment-gateway work is DEFERRED to the end by owner instruction.

**Phase S1 opened (Rule 1 satisfied - explicit owner instruction to
build everything except the payment gateway).** Product decisions
CONFIRMED: two public plans - Free Plan = **7-day trial, $0**; Full Plan
= **$20/month, USD**; payment deferred. Phase decomposition PROPOSED by
Codex and started without further questioning (owner pre-authorized
"everything else"): S1a schema + plan constants, S1b public signup API,
S1c trial enforcement middleware (BLOCKED on A3 below), S1d public
marketing/pricing + signup UI, S1e onboarding wizard (reuses the
existing org-settings API from migration 0014), S1f trial banner/expiry
UI, S1g minimal platform-admin screen (trial list + "Mark Full"
activation, exempt from RequireClinic).

**ASSUMPTIONS recorded (Rule 4 - must be confirmed or deleted before
being relied on):** A1 trial = full feature set for 7 days (no feature
gating yet); A2 signup starts the trial immediately - pay-first cannot
be enforced before the payment gateway exists; A3 post-trial day-8
behavior = PROPOSED read-only lock + manual admin activation (NOT
confirmed - owner has not answered); A4 prices in USD; A5 the existing
admin-created-clinic flow stays as an internal fallback.

**Work completed this session (all gates green):**

1. **sourcemap:false executed** (PROPOSED at rev 62, owner pre-authorized
   "work away with everything else") - `frontend/vite.config.ts` now
   emits no `.map` files: removes the dominant build-memory chunk AND
   stops publishing full source of a commercial product (the public
   GitHub repo already exposes it; this stops the built artifact from
   doubling the exposure). Build output confirms no `map:` line. Commit
   `bfb00e1`.
2. **S1a schema:** `migrations/0017_org_plans_and_trial.sql` adds
   `plan ENUM('trial','full') DEFAULT 'full'` + `trial_ends_at DATETIME
   NULL` to `organizations`; existing production rows default to `full`
   (no retroactive trials). `src/plans.ts` exports TRIAL_DAYS=7 and the
   PLANS array (id/priceUsdCents/interval/trialDays/name).
3. **S1b endpoints:** `GET /api/public/plans` (no auth, returns PLANS);
   `POST /api/auth/signup` {clinicName, email, password} -> validates
   (normalizeEmail/requirePassword 12-200/requireString 2-120), signup
   rate limit `${ip}|signup` reusing the existing login limiter
   (10/min), duplicate-email 409 `email_taken`, inserts organization
   (plan='trial', trial_ends_at=now+7d computed server-side via
   DATE_ADD(UTC_TIMESTAMP())) + owner user, audits
   `organization_created` + `signup_success`, creates session, returns
   201 with user + organization + Set-Cookie (auto-login). ER_DUP_ENTRY
   race on email caught -> same 409.
4. **Test:** `tests/signup.integration.test.ts` (4 tests: plans shape
   exact per owner pricing; signup 201 + /me works + trial_ends_at
   within 7d +/-1h asserted via SQL TIMESTAMPDIFF (timezone-safe) +
   audit row; duplicate 409; validation 400s).

**Gates actually executed (exit 0 each):** backend `npm run verify`
= lint + typecheck + **348/348 tests (32 files, +4)** + build;
`npm run verify:frontend` = eslint + **94/94 (19 files)** + `tsc -b &&
vite build` (index-DPjn0nuz.js, no sourcemap emitted); `npm run migrate`
applied 0017 to the dev DB then re-run **0/17 idempotent**; Playwright
E2E **8/8** (1.0m). Commits: `bfb00e1` (sourcemap), `b7c1e96` (S1a+b).

**Not done / blocked:** S1c trial enforcement (needs A3 answer); S1d-g
UI work not started; NOTHING deployed this session (Rule 11 - a
server `git pull` + migrate 0017 + rebuild + restart requires explicit
owner instruction); the previously-asked clinic bootstrap values are
now largely SUPERSEDED by self-serve signup (owner may discard them).

**Open questions for the owner:** (1) A3 - what happens on day 8 when
the trial expires: PROPOSED read-only lock with admin "activate"
button, or something else? (2) A1 - should Free differ from Full in
features now, or gate later? (3) confirm USD for billing display.
(4) when to deploy this increment to production.

## Session 35 - S1d+e: public marketing, signup UI, onboarding wizard complete

**2026-10-03 - owner instruction:** "yes" (continue with S1d public
pricing/signup page + S1e onboarding wizard, per the Session 34
recommendation).

**S1d - public marketing + self-serve signup UI (CONFIRMED shipped in
code, commit `92816bf`):** `/` for anonymous visitors now renders a
marketing page (`MarketingPage.tsx`) - hero, two pricing cards fetched
live from `GET /api/public/plans` (Free Plan $0 with the 7-day-trial
headline; Full Plan $20/month), Sign in / Start free trial CTAs; an
authenticated `/` keeps its previous behavior (capability-based redirect
to dashboard or workspace). New `/signup` (`SignupPage.tsx`) collects
clinic name + email + password, client-validates, calls the new
AuthProvider `signup()`, then lands the fresh owner session on
`/onboarding`. Router restructured: the AppShell subtree is now wrapped
by a pathless `RequireAuth` under the `/` route with the index route
outside it (named routes, URLs, session-expiry and no-clinic behavior
unchanged - covered by the existing routeAccess tests).

**S1e - smart onboarding wizard (CONFIRMED shipped):** migration
**0018** adds `organizations.onboarding_completed_at DATETIME NULL` and
backfills all existing rows to `UTC_TIMESTAMP()` (so no existing clinic
- including production - is forced into the wizard); signups start with
NULL. `POST /api/organizations/:orgId/onboarding/complete` (owner/admin
only via assertCanManageMembers, audit `onboarding_completed`, updates
only when still NULL - a second call is a no-op 200). `/api/auth/login`,
`/me` and `/signup` now return `organization` `{id, name, plan,
trialEndsAt, onboardingCompletedAt}` so the client knows the state.
Frontend: `RequireOnboarding` guard (redirects to `/onboarding` while
the session organization exists and `onboardingCompletedAt` is null;
organizations absent from the response - test fixtures, platform admin
via RequireClinic - are not redirected); `OnboardingPage` = 3 steps:
(1) clinic profile (name/phone/email/address, prefilled from
`GET /settings/clinic`, saved with the existing
`PATCH .../settings/clinic`), (2) business hours (7-day editor,
Mon-Fri 09:00-17:00 defaults, same validation rules as the settings
page), (3) review + Finish -> complete endpoint -> `refreshSession()` ->
`/dashboard`. A `finished` flag prevents the page's own
"already-complete -> leave" redirect from racing the finish navigation
(this race was caught by the test suite, not assumed away).

**Tests actually executed (all exit 0):** backend `npm run verify` =
**355/355** (33 files, +7 in `tests/onboarding.integration.test.ts`,
signup test extended for the new response shape), lint/typecheck/build;
`npm run verify:frontend` = eslint + **104/104** (21 files, +10: 2
marketing, 3 signup, 2 onboarding, 3 routeAccess) + `tsc -b` + vite
build; Playwright E2E **8/8** (59.8s) against the real API with the
updated seed (seeded org now created with `onboarding_completed_at` set
so e2e stays out of the wizard). Migration 0018 applied to the dev DB
(then idempotent); the test DB applies it via each suite's runMigrations.

**Test-side fixes made along the way (no product defects):**
makeDashboard fixture in routeAccess lacked `trends` (DashboardPage
reads `data.trends.daily` - the resulting crash was timing-flaky and
surfaced only under the new parallel load); two tuple-typing/lint issues
in the new tests. The marketing "Sign in" assertion needed getAllByRole
(header + footer both link to /login).

**Not done / NOT VERIFIED:** nothing deployed (Rule 11 - production
needs owner-run `git pull`, migrate 0018, frontend rebuild, restart);
the signup->onboarding flow end-to-end in a real browser (each side is
tested and the response shapes are asserted on both ends, but the joined
browser flow was not executed); S1c trial-enforcement middleware still
BLOCKED on A3 (day-8 behavior); S1f trial banner UI and S1g
platform-admin trial list/activation not started; receptionist in an
un-onboarded clinic would hit a 403 on the profile step (assertCanManageMembers)
- realistic flows start from the owner signup.

**Open questions for the owner (carried + new):** (1) A3 - day-8 trial
behavior (PROPOSED read-only lock + admin activate); (2) A1 - feature
gating between plans; (3) confirm USD display; (4) when to deploy this
increment; (5) optional e2e signup-flow coverage (PROPOSED).

## Session 36 - A3/A4 answered: trial = 8 days, all features; marketing feature list added

**Owner answers recorded verbatim:** A3 - "8 days trial to use all
features in the app built so far with no restrictions"; A4 - "Free is
for 8 days only. Full Feature is full access to all with monthly
subscriptions."; plus instruction - "You can list all the features by
going through the planning and designing."

**Changes (all gates green, nothing deployed):**

- Trial constant 7 -> 8 days: `src/plans.ts` TRIAL_DAYS=8 (the signup
  SQL binds the constant, so `trial_ends_at` = now+8d automatically);
  Free headline -> "8-day free trial with every feature"; Full headline
  -> "Full access to every feature, $20 per month".
- Tests updated for 8 days: `tests/signup.integration.test.ts`
  (trialDays 8, 8*86400 window assertions, test title),
  `frontend/src/test/fixtures.ts` makePlans, `publicPages.test.tsx`
  headline assertions.
- Marketing feature list per the owner instruction: FEATURES array (12
  cards) + "Everything your clinic needs" section between hero and
  pricing in `MarketingPage.tsx`, CSS block in `frontend/src/styles/global.css`,
  +1 test ("lists the planned product features"). Every card is sourced
  from `Project_Planning_Dentalistics.md` (CORE PRODUCT FEATURES 1-8 +
  MVP-1..16) and `FrontEnd_Planning.md` (Sections 5/9/15/18) - no
  invented claims.

**Assumption states after this session:** A1 CONFIRMED (trial = all
features, no restrictions - owner verbatim; no gating to implement
during the trial); trial length + A4 CONFIRMED (8 days; Free ends day
8; Full = full access, monthly subscription); A3 day-9 enforcement
mechanism still UNKNOWN - the owner described the trial terms, not the
post-trial behavior, so the PROPOSED read-only lock + admin activate
remains unapproved and must not be implemented without an explicit
answer.

**Tests actually executed (all exit 0):** backend `npm run verify` =
**355/355** (33 files) + tsc build; `npm run verify:frontend` = eslint +
**105/105** (21 files, +1 feature-list test) + `tsc -b` + vite build;
Playwright E2E **8/8** (36.1s).

**Process note:** `tests/signup.integration.test.ts` was updated with
one PowerShell string-replace round-trip (a deviation from the
no-Get-Content/Set-Content rule); verified immediately after - the file
is pure ASCII (0 non-ASCII bytes) and `git diff` shows only the
intended 4 lines, so no corruption occurred; all other edits used the
edit tool.

**Not done / NOT VERIFIED:** nothing deployed (Rule 11 - server pull +
migrate 0018 + frontend rebuild + restart awaits explicit owner
instruction); day-9 enforcement (S1c) still blocked on the A3 mechanism
question; S1f trial banner UI and S1g platform-admin trial
list/activation not started; the joined browser signup->onboarding flow
still not executed.

**Open questions for the owner:** (1) day-9 trial expiry behavior -
what exactly happens after the 8 days (PROPOSED read-only lock + admin
activate) - the ONE blocking question for S1c; (2) when to deploy this
increment; (3) confirm USD display for the $20 monthly subscription.

## Session 37 - S1c + S1g: day-9 read-only lock and platform-admin activation

**Owner answer recorded verbatim:** "Yes, 9th day - read ony lock with
an 'activate' button" - approving the PROPOSED read-only lock + admin
activate from Session 36. A3 is now CONFIRMED; the remaining design
reads: activation is performed by the platform administrator (role
`admin`, the account approved in the proposal the owner answered "Yes"
to), not by the locked clinic itself - a clinic-side activate button
would bypass billing, so the Activate button lives on the platform-admin
trials screen, and the clinic sees a read-only banner telling it to
contact the administrator.

**Backend (CONFIRMED by tests):**

- `src/middleware/trialLock.ts` - `createTrialLock(db)` mounted in
  `src/app.ts` right after `attachSession`. For non-safe methods with a
  session bound to an organization (platform admins exempt), one SQL
  check (`plan='trial' AND trial_ends_at <= UTC_TIMESTAMP()` - compared
  in SQL, same clock as the signup INSERT, no client timezone involved)
  -> `403 {code: 'trial_expired', message: 'Your free trial has ended.
  This clinic is now read-only until it is activated.'}`. Exempt
  prefixes: `/api/auth` (login/logout/password reset must work while
  locked), `/api/public` (anonymous lead forms), `/api/webhooks`.
  GET/HEAD/OPTIONS pass through -> reads stay available (read-only).
- `src/routes/admin.ts` (behind the existing `requireRole('admin')`):
  `GET /api/admin/trials` lists plan='trial' orgs
  `{id,name,status,trialEndsAt}`; `POST /api/admin/organizations/:orgId/activate`
  sets `plan='full', trial_ends_at=NULL`, audits `trial_activated`
  once per actual transition (repeat calls return `activated:false`
  without a second audit row), 404 for unknown orgs.

**Frontend (CONFIRMED by tests):**

- `lib/trial.ts` `trialLocked(organization)` (client-side display only -
  the server is authoritative); `TrialLockBanner` rendered in the
  AppShell grid (new `banner` row, desktop + mobile) shows "Free trial
  ended <date>. This clinic is now read-only. The platform administrator
  can activate full access." for expired trial orgs.
- `RequireOnboarding` no longer forces an expired-trial clinic into the
  wizard (its writes would 403); it stays on the dashboard read-only.
- New `RequirePlatformAdmin` guard + sibling route branch under AppShell
  (`/admin/trials`, plus its own NotFound) so the platform admin
  (organizationId null) can reach a screen without passing RequireClinic.
- Capability `admin.trials.view` exists ONLY for role `admin`
  (`capabilities.test.ts` updated: owner set unchanged at 32, admin set
  = owner set + trials); sidebar shows a "Trials" link when granted.
- `pages/admin/TrialsPage.tsx` - list with Active until/Expired badges,
  Activate button per row, success + failure banners, empty state.

**Tests actually executed (all exit 0):**

- backend `npm run verify` = **362/362** (34 files, +7 in new
  `tests/trialLock.integration.test.ts`: active write, expired
  read-vs-write, login/logout still work while locked, trials list
  admin-only, activate + single audit + lift, non-admin refused,
  full-plan never locked) + lint + typecheck + build.
- `npm run verify:frontend` = eslint + **115/115** (21 files, +10:
  4 TrialsPage, 6 routeAccess incl. banner/active-banner/onboarding-lock
  and trials access matrix; capabilities test updated for the new
  platform-admin capability) + `tsc -b` + vite build.
- Playwright E2E **11/11** (31.6s) - new `tests/e2e/trialLock.spec.ts`
  runs the whole money path against the real API: expire via SQL ->
  owner sees the banner + GET 200 + POST 403 trial_expired -> platform
  admin signs in, opens /admin/trials, clicks Activate -> success
  banner, row gone -> owner POST 201. Spec restores org/admin state in
  afterAll.

**Not done / NOT VERIFIED:** nothing deployed (Rule 11); S1f
trial-days-remaining banner during an ACTIVE trial not started (the
owner has not asked for it); payment gateway still deferred; the
read-only UX is banner + server 403s (forms are not individually
greyed out); USD display still ASSUMED; a trial org that never
finishes onboarding before day 9 lands on the dashboard read-only
(tested, PROPOSED acceptable).

**Open questions for the owner:** (1) when to deploy this increment to
`dentalistics.apexsol.pk`; (2) confirm USD display for the $20 monthly
subscription; (3) optional S1f "X days left" banner - PROPOSED, awaiting
instruction (Rule 1).

---

## Session 38 - Lead workflow: booking marks the lead booked, Convert-to-patient, lead acknowledgement sources

**Owner instruction this session:** "yes" - approving the three PROPOSED
lead-workflow fixes put forward at the end of the previous session:
(a) booking an appointment moves the lead to `APPOINTMENT_BOOKED`,
(b) a "Convert to patient" button on the lead detail page,
(c) broadening which lead sources receive the acknowledgement message.

**Implementation (CONFIRMED by tests):**

- `src/services/leads.ts` - new exported
  `markLeadAppointmentBooked(db, logger, { leadId, organizationId,
  appointmentId, actorUserId })`. Statuses `LOST`/`CLOSED` are skipped
  (already-decided leads are not reopened by a booking); the write is a
  guarded UPDATE (`AND status <> 'APPOINTMENT_BOOKED'`) so re-booking
  does not double-write, and it appends a `status_changed` activity
  (`NEW -> APPOINTMENT_BOOKED (appointment booked)`). Lives in the leads
  service because `leads.ts` already imports `appointmentsForLead` from
  `appointments.ts` - calling it from `appointments.ts` would have
  created a require cycle, so the route layer does the call.
- `src/routes/appointments.ts` - `POST /:orgId/appointments` calls
  `safeMarkLeadBooked(...)` (never-throw, logged, same pattern as the
  existing `safeCloseRecallOnBooking`) after reminder scheduling, using
  the `leadId` the client sent.
- `src/automation/config.ts` - `DEFAULT_ACK_CONFIG.sources` changed from
  `['WEBSITE']` to `['WEBSITE', 'MANUAL', 'OTHER']`.
- `frontend/src/pages/leads/LeadDetailPage.tsx` - "Convert to patient"
  link (capability `patients.create`) to
  `/patients?new=1&leadId=..&firstName=..&lastName=..&phone=..&email=..`
  plus a "Next steps:" hint under the booking action.
- `frontend/src/pages/patients/PatientsPage.tsx` - reads the query
  params, opens the Add-patient form prefilled, and flashes
  "Patient added. Open the lead to book the appointment." when a
  `leadId` param was supplied (mirrors the AppointmentsPage `?new=1`
  pattern).

**Decisions taken (PROPOSED -> applied, subject to owner correction):**

- **MISSED_CALL is NOT in the default acknowledgement sources.**
  `src/automation/missedCall.ts` already sends its own
  `missed_call_response`, so including MISSED_CALL in the generic lead
  ack would double-text a missed caller. Clinics can still add it under
  Settings -> Automation (the UI already accepts a comma-separated
  source list).
- **`LOST`/`CLOSED` leads are not reopened by a booking.** Reported as
  a deliberate choice rather than a limitation.
- `tests/m6.integration.test.ts` - the source-filter test was
  **rewritten, not weakened**: it now asserts that a MANUAL staff-created
  lead gets exactly 1 acknowledgement and a new MISSED_CALL lead gets 0
  (with `source_not_configured` in the skip log). This is a deliberate
  behavior change from "website leads only", disclosed under Rule 8.

**Defect found and fixed during testing (root cause, not symptom):**

The PatientsPage test failed - the prefilled form never opened. Cause:
`useState(() => canCreate && searchParams.get('new') === '1')` ran on
the first render, while the AuthProvider had not yet resolved the
session user, so `canCreate` was `false` and the state latched closed.
This would also have broken a hard refresh on the direct link, not just
the test. Fix: `adding` is initialized from the URL alone, the render
guard became `{adding && canCreate ? ...}`, and the render-phase sync
dropped the `canCreate` condition. Receptionists still cannot see the
form (the section and its button are both capability-gated).

**Tests actually executed (all exit 0):**

- `npm run verify` = lint 0 + typecheck 0 + **366/366 tests (35 files)**
  + production build 0.
- `npm run verify:frontend` = eslint 0 + **119/119 tests (21 files, +4 in
  `screens.test.tsx`)** + `tsc -b` + vite build 0.
- Isolated re-runs against the live MySQL container:
  `tests/leadBooking.integration.test.ts` **4/4** (NEW lead ->
  `APPOINTMENT_BOOKED` + one `status_changed` row; re-booking does not
  duplicate the activity; LOST/CLOSED untouched; no lead attached ->
  no lead touched), `tests/m6.integration.test.ts` **11/11** (rewritten
  source-filter test passes against the real DB).
- Environment: Docker Desktop was not running at session start -
  started it and `docker start dentalistics-mysql` (healthy) before the
  DB suites; `TEST_DB_HOST=127.0.0.1` used for the isolated runs.

**Not done / NOT VERIFIED:** nothing deployed (Rule 11); no
reconciliation/merge of duplicate leads; no automated browser E2E for
the new two-step convert-and-book path (covered by component tests, not
Playwright); no API response for "what happened to the lead" beyond the
lead-detail activity row. (Originally nothing was committed either -
that changed later in this session, see "Saved and pushed" below.)

**Owner statement recorded after the report (verbatim, recorded as
decision D11 in PROJECT_STATE §6):** "What the reall intention on the
first place was to get everything automated but if in case there is
something that cannot be adjusted then the manual process of a
particular task comes in. When that particular task is completed, the
automated process takes over again and keeps working." - i.e. the
governing acceptance test for every task is: automate it; if it cannot
be automated, expose a manual path; once the manual action finishes,
automation must resume unattended. No code change was made in response
(yet); the statement is recorded, the existing pause->manual->resume
hooks were re-inspected as evidence (appointments route wiring, config
re-read per tick, retry endpoints, lazy backstops), and a full D11
conformance audit is PROPOSED awaiting instruction (Rule 1).

**Open questions for the owner:** (1) accept MISSED_CALL staying out of
the default ack sources, or add it and accept two texts? (2) confirm
the LOST/CLOSED not-reopened choice; (3) run the D11
automation-conformance audit (automate / manual-fallback / auto-resume
walk-through of every flow)?

**Saved and pushed (this session, end state):**

- Docs commit `a739f65` - "docs: Session 38 / rev 67-68 - lead workflow
  increment and D11 automation intent" (SESSION_LOG.md +
  PROJECT_STATE.md).
- Code commit `867ceb0` - "Lead workflow: booking marks lead
  APPOINTMENT_BOOKED, Convert-to-patient button, broader lead
  acknowledgement sources" (8 files: `src/automation/config.ts`,
  `src/routes/appointments.ts`, `src/services/leads.ts`,
  `LeadDetailPage.tsx`, `PatientsPage.tsx`, `screens.test.tsx`,
  `tests/m6.integration.test.ts`, new `tests/leadBooking.integration.test.ts`).
  Owner instruction verbatim: "if they are 100% working then go ahead
  and push them too" - so the code was re-verified with a fresh full
  run before committing: `npm run verify` = lint 0 + typecheck 0 +
  **366/366 tests (35 files, live MySQL)** + build 0, and
  `npm run verify:frontend` = eslint 0 + **119/119 tests (21 files)** +
  `tsc -b` + vite build 0. MATCH=OK after push (local = remote
  `867ceb0`).
- Not staged: `AGENTS.md` (pre-existing untracked file, unrelated to
  this increment).

**What is left (durable, for the next session):**

1. Deploy `867ceb0`/`a739f65` to `dentalistics.apexsol.pk` - NOT done,
   needs explicit owner instruction (Rule 11).
2. D11 conformance audit - PROPOSED, not started (Rule 1): walk every
   automation end-to-end against "automate -> manual fallback ->
   auto-resume".
3. Owner decisions outstanding: MISSED_CALL excluded from default ack
   sources; `LOST`/`CLOSED` not reopened by a booking; USD display for
   the $20 plan; S1f active-trial "days left" banner (Rule 1).
4. Known gaps in this increment: no Playwright E2E for the
   convert-then-book path; no duplicate-lead merge/reconciliation; lead
   activity shows the status change but no dedicated "conversion"
   API response.
5. Deferred by owner/plan: payment gateway (S1), S1f banner, and the
   broader backlog recorded in earlier sessions.
