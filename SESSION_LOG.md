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
