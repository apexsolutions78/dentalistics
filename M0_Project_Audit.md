# MILESTONE 0 — PROJECT AUDIT AND DEVELOPMENT PLAN

**Status: ACCEPTED 2026-09-26** — owner instructed "Please proceed" after the M0 report (recorded as decision D3 in `PROJECT_STATE.md` §6; the same instruction authorized Milestone 1, which has since been executed — M1 now awaits its own owner acceptance).
**Audit date:** 2026-09-26. Every statement below was produced by direct tool inspection of the repository or is explicitly labelled by its source (owner-stated / cited / ASSUMED / UNKNOWN).

---

## PROJECT AUDIT

Repository: `D:\WORK\Apex Dentalistics` (git repository, branch `master`).

Complete file inventory (verified by recursive listing, `.git` internals excluded — 6 files, nothing else):

| File | Size | Role |
|---|---|---|
| `Application Prompt.txt` | 973 B | Owner's original product brief (6 starter features; Node.js + MySQL on DirectAdmin stated) |
| `CLAUDE.md` | 11,308 B | MASTER_AI_RELIABILITY_PROTOCOL v1.0 + 12 owner project rules (permanent instructions) |
| `PROJECT_STATE.md` | 33,424 B | Discovery record: confirmed facts, assumptions, open issues, decisions D1/D2 (revisions 1–6) |
| `INTEGRATION_PLAN.md` | 13,441 B | Call/SMS/WhatsApp integration staging plan (Stage 0/1/2, verification checklist) |
| `Project_Planning_Dentalistics.md` | 50,323 B | **Governing development plan** — master prompt, milestones M0–M23, MVP scope (owner, 2026-09-26) |
| `Country Wise Data/Bahrain/Bahrain_Dental_Prospects_2026.xlsx` | 9,748 B | Bahrain dental prospects spreadsheet. Role in project UNKNOWN (not read; not required for M0) |

Git state (verified at M0, 2026-09-26):

- `master`, **zero commits ever** (reflog/`git log` both fail with "does not have any commits yet"); no other branches; no stashes.
- Staged: `CLAUDE.md`, `PROJECT_STATE.md` (also modified), the xlsx. Untracked: `Application Prompt.txt`, `INTEGRATION_PLAN.md`, `Project_Planning_Dentalistics.md`.
- No `.gitignore` exists.
- **Superseded by M1 (2026-09-26):** initial commit `de088b9` pushed to `origin` with all work; `.gitignore` added — see K-I1.

Application code: **none.** Verified by pattern search for `*.js, *.ts, *.mjs, *.cjs, *.tsx, *.jsx, *.php, *.html, *.css, *.sql, *.env, *.json, *.yml, *.yaml, *.lock` — zero matches. The previously documented `App/` directory no longer exists (removed after 2026-09-03).

Development machine (verified): Node.js **v24.18.0**, npm **11.16.0**. (Server-side versions remain UNKNOWN — see Risks R3.)

---

## CURRENT ARCHITECTURE

**None.** No application, no entry points, no routes, no components, no configuration. This is a genuine greenfield start; the architecture is to be proposed below and established in Milestone 1.

---

## TECHNOLOGY STACK

| Layer | Committed in repo | Owner-stated intent | Status |
|---|---|---|---|
| Runtime | none | Node.js | CONFIRMED as owner intent; server has Node.js (owner, 2026-09-26); version UNKNOWN |
| Database | none | MySQL | CONFIRMED as owner intent; server has MySQL (owner, 2026-09-26); version UNKNOWN |
| Hosting | none | Owner's DirectAdmin server + SSH terminal | CONFIRMED owner-stated; webhook/cron/persistent-process capability UNKNOWN (open B6 sub-items) |
| Frontend / test / lint | none | not stated | UNKNOWN — chosen at M1 under the plan's Decision Rule |

`Project_Planning_Dentalistics.md` forbids assuming provider/API/country capabilities and requires verification against official documentation before any integration — this audit makes no such assumptions.

---

## DEPENDENCIES

**None.** No `package.json`, no lockfile, no `node_modules`. Every dependency is a greenfield decision for M1 (plan rule: no unnecessary dependencies).

---

## DATABASE

**None.** No schema, migrations, seeds, or SQL files. MySQL is the owner-stated target. The plan proposes the conceptual domain (`organizations`, `users`, `leads`, `patients`, `appointments`, `communication_messages`, `automation_*`, `message_templates`, `provider_integrations`, `webhook_events`, `recalls`, `audit_logs`) but explicitly forbids blindly creating those exact tables — final schema is an M1–M3 decision after stack selection, with tenant isolation designed in from the start (MVP-1 requires multi-clinic architecture).

---

## AUTHENTICATION

**None implemented.** No session handling, no user model, no roles. Requirements exist only in the plan: MVP-1 (login/logout, clinic accounts, users, roles, tenant isolation) and M2 (auth + authorization + isolation acceptance tests).

---

## CURRENT FEATURES

**Zero implemented.** Requirements are documented in three places, consistent with each other:

- Original brief (`Application Prompt.txt`): missed-call text-back, lead acknowledgement, 48h/24h/2h reminders, no-show rebooking, recall reminder, owner report.
- Discovery record (`PROJECT_STATE.md`): same six features plus review requests and dashboard; open questions B2/B4 and provider onboarding items.
- Governing plan (`Project_Planning_Dentalistics.md`): MVP-1…MVP-16 features, milestones M0–M23, 12 MVP acceptance tests, explicit out-of-scope list.

---

## CURRENT TEST COVERAGE

**None.** No test framework, no test files, no CI, no lint or type-check configuration. The plan requires all of these from M1 onward ("Test suite runs / Lint passes / Type checking passes / Build passes") — establishing the test harness is therefore part of M1 acceptance.

---

## KNOWN ISSUES

| # | Issue | Source | Status |
|---|---|---|---|
| K-I1 | Repository has **zero commits**; all work exists only as uncommitted working-tree files (3 staged, 3 untracked) | git inspection | **Resolved 2026-09-26 (M1):** initial commit `de088b9` created and pushed to `origin` (https://github.com/apexsolutions78/dentalistics.git); remote HEAD verified to match via `git ls-remote`. `.gitignore` added (excludes `.env`, `node_modules/`, `dist/`) |
| K-I2 | Inbound HTTPS webhook capability of the DirectAdmin server is UNKNOWN — gates M5 (public endpoint), M12 (missed-call), and "within seconds" text-back | `PROJECT_STATE.md` B6/K2 | Open |
| K-I3 | Cron interval / persistent-process capability UNKNOWN — gates M8 (scheduled reminders) | `PROJECT_STATE.md` B6 | Open |
| K-I4 | No Twilio, Meta/WhatsApp or any provider account exists; M12/M13 can only be MOCKED/SANDBOX until accounts + capability verification (plan: NO FAKE INTEGRATIONS) | inspection + owner statements | Open |
| K-I5 | Data-protection position (consent, retention, opt-out, applicable law — B4) unanswered; global market makes this per-country. Plan forbids claiming compliance without assessment | `PROJECT_STATE.md` B4, §1.8 | Open |
| K-I6 | `PROJECT_STATE.md` and `INTEGRATION_PLAN.md` predate the governing plan; their phase/Stage structure is superseded by the milestone system where they conflict | owner instruction 2026-09-26 | Recorded; documents retained, not deleted |
| K-I7 | Role of the Bahrain prospects xlsx unknown; irrelevant to M0–M11 | inspection | Open, non-blocking |

---

## RISKS

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Nothing is committed to git (K-I1) | Total loss of work on accidental deletion/disk failure | **Mitigated 2026-09-26:** initial commit `de088b9` pushed to `origin` (K-I1 closed) |
| R2 | 24 milestones with mandatory gates; single-contributor cadence | Schedule pressure and temptation to skip gates | Plan forbids skipping; report format enforced every milestone |
| R3 | Server capabilities (webhooks, cron, process persistence, SSL/domain) unverified | M5/M8/M12/M22 could stall late | Resolve B6 sub-items early (owner can answer without clinic involvement) |
| R4 | Provider capability variance by country (global market; only Bahrain partially researched) | M12/M13 built against wrong assumptions | Plan already mandates official-doc verification before M12/M13; checklist V1–V11 exists in `INTEGRATION_PLAN.md` |
| R5 | No provider accounts, no payer decision (Apex vs clinic) | REAL integration blocked at M12/M13 | Decide account ownership + create sandbox accounts before those milestones |
| R6 | Legal/consent requirements unanswered while patient data will be stored from M3 | Compliance exposure at deployment, not at coding | Resolve B4 before M22 (production readiness); do not claim compliance (plan rule) |
| R7 | Greenfield stack choice affects every later milestone | Costly rework if wrong | Decision Rule (reliable/simple/maintainable/secure/testable) applied at M1; owner informed of trade-offs |

---

## ASSUMPTIONS

Each must be confirmed or corrected before the milestone that depends on it:

| # | Assumption | Basis | Depended on by |
|---|---|---|---|
| AS1 | Stack = Node.js + MySQL (TypeScript proposed below) | Owner's stated intent (Application Prompt.txt; 2026-09-26 server statement) | M1 |
| AS2 | Development continues on this Windows machine, deployment to the DirectAdmin Linux server later | Observed: Node v24.18.0/npm 11.16.0 here; owner-stated server | M1, M22 |
| AS3 | Milestones M1–M23 proceed one at a time with owner acceptance between them | Plan's MILESTONE GATE SYSTEM; consistent with CLAUDE.md Rule 1 | All |
| AS4 | Email channel, if ever used, follows the same abstraction as SMS/WhatsApp | Plan lists email as "potential" | M4 |
| AS5 | The 12 MVP acceptance tests are the definition of MVP completion | Plan: MVP ACCEPTANCE TESTS | M23 |

---

## RECOMMENDED ARCHITECTURE

**PROPOSED — decision belongs to Milestone 1.** Chosen under the plan's Decision Rule (reliable, simple, maintainable, secure, testable, no fashion-driven choices) for a single-server DirectAdmin deployment:

```text
One TypeScript Node.js application (modular monolith)
├── HTTP API + authenticated web UI   (framework: Express or Fastify — evaluated at M1)
├── MySQL                             (owner-mandated; migration-managed schema)
├── Automation scheduler              (DB-backed job queue + interval worker;
│                                      requires B6 cron/process answers — K-I2/K-I3)
├── Communication abstraction         (provider interface + MOCK provider first,
│                                      per MVP channel strategy; real provider at M12/M13)
├── Webhook receivers                 (authenticated, idempotent, logged — plan §WEBHOOK REQUIREMENTS;
│                                      require server inbound-HTTPS confirmation — K-I2)
└── Observability                     (structured logs, automation/communication/webhook logs — M17)

Testing: unit + integration framework (Vitest or Jest — evaluated at M1), tenant-isolation tests from M2
Quality gates: ESLint + TypeScript compiler + production build (per plan acceptance criteria)
Security: secrets via environment only, .gitignore from first commit, RBAC + tenant isolation at M2,
          webhook signature verification + idempotency keys at M5/M12/M13
Deployment: DirectAdmin server, Node process manager — exact mechanism unknown until B6 answered
```

Why this shape: it is the smallest structure that satisfies every plan requirement (type checking, lint, tests, tenant isolation, provider abstraction, job queue, webhook security) without introducing services the single server may not support. Alternatives (separate frontend/backend services, message-broker infrastructure) would add moving parts with no current benefit — rejected under the Decision Rule.

---

## MILESTONE PLAN

Governing sequence exactly as specified in `Project_Planning_Dentalistics.md` (M0–M23). Statuses use the plan's five-value vocabulary.

| ID | Milestone | Status | Entry gate / dependency |
|---|---|---|---|
| M0 | Repository audit + development plan (this document) | **ACCEPTED 2026-09-26** — owner instructed "Please proceed" after the M0 report (treated as acceptance under the gate system; the instruction is also recorded as decision D3 in `PROJECT_STATE.md` §6) | — |
| M1 | Foundation (structure, env config, DB connection, shell, error handling, logging, test harness, lint/typecheck/build) | **PASSED 2026-09-26** — M1 report re-verified on owner instruction ("start M2 if M1 confirmed PASS"): `npm run verify` exit 0 (26/26 tests), `npm audit` 0 vulnerabilities, all 9 plan acceptance criteria PASS, security incident fixed (K6), residual `root@localhost` socket-auth quirk resolved (re-ALTER via TCP; socket login verified exit 0). Initial commit `de088b9` + fixes pushed to `origin` | M0 accepted; PROPOSED initial git commit; stack decision |
| M2 | Authentication + multi-tenancy (roles, isolation tests) | **PASSED 2026-09-27** - owner instruction ("if M2 is 100% completed, tested and confirmed PASS, defects fixed, then start M3") verified by: plan cross-check (M2/MVP-1/SECURITY/MVP USERS), `npm run verify` exit 0 (62/62 tests across 8 suites, incl. 18 live-DB acceptance tests covering all 4 plan proofs), manual HTTP smoke all-green (run twice), all M2 defects fixed + re-verified. Pushed to `origin` | M1 PASSED |
| M3 | Patients + leads | **COMPLETE 2026-09-27 — report delivered, awaiting owner acceptance** (NOT yet PASSED; owner decides): `npm run verify` exit 0 (83/83 tests, 10 suites, 0 skipped incl. 12 live-DB M3 acceptance tests), HTTP smoke 27/27 PASS exit 0 (admin→org→owner→receptionist bootstrap), defects found+fixed (phone `+` canonicalization broke duplicate detection, M2 purge FK order, ValidationError `.issues` assertions) | M2 PASSED |
| M4 | Communication abstraction + mock provider | NOT_STARTED | M3 PASSED |
| M5 | Website lead capture API (public, rate-limited, tenant-identified) | NOT_STARTED | M4 PASSED; server inbound-HTTPS posture known (K-I2) |
| M6 | Instant lead follow-up | NOT_STARTED | M5 PASSED |
| M7 | Appointments (statuses, timezone) | NOT_STARTED | M6 PASSED |
| M8 | Appointment reminders (48h/24h/2h, idempotent, quiet hours) | NOT_STARTED | M7 PASSED; scheduler capability confirmed (K-I3) |
| M9 | No-show recovery | NOT_STARTED | M8 PASSED |
| M10 | Recall automation | NOT_STARTED | M9 PASSED |
| M11 | Review requests | NOT_STARTED | M10 PASSED |
| M12 | Missed-call integration | NOT_STARTED | **Provider capability verification from official docs** + K-I2 + clinic telephony facts (B2) + provider account (K-I4) |
| M13 | WhatsApp integration | NOT_STARTED | **Meta/provider requirements verified** + account + templates (K-I4, C1) |
| M14 | Owner dashboard | NOT_STARTED | M11 PASSED (metrics sourced from M3–M11 data) |
| M15 | Receptionist workspace | NOT_STARTED | M14 PASSED |
| M16 | Settings + templates | NOT_STARTED | M15 PASSED |
| M17 | Observability | NOT_STARTED | M16 PASSED |
| M18 | Security hardening | NOT_STARTED | M17 PASSED |
| M19 | Performance + reliability | NOT_STARTED | M18 PASSED |
| M20 | End-to-end production scenarios (Tests 1–12) | NOT_STARTED | M19 PASSED |
| M21 | UX review | NOT_STARTED | M20 PASSED |
| M22 | Production readiness | NOT_STARTED | M21 PASSED; B6 server answers + B4 legal position (K-I5, R6) |
| M23 | Final acceptance (full suite) | NOT_STARTED | M22 PASSED |

Cross-references to `PROJECT_STATE.md` (discovery record, retained):

- **B5 (one clinic or many) — RESOLVED by the governing plan:** MVP-1 requires multi-clinic architecture from the start; tenant isolation is mandatory and tested at M2.
- B2 (clinic telephony), B4 (data protection), B6 sub-items (webhooks, cron, process, SSL, location) — still open; mapped to M5/M12, M22, M1/M8 gates above.
- Decisions D1 (integration staged) and D2 (WhatsApp + Twilio; global market) remain owner decisions; the plan adds the requirement that provider capabilities are verified from official documentation before M12/M13 implementation, which governs how D2 is executed.

**M0 STOP (historical).** At delivery no application code had been written, and Milestone 1 was gated on owner acceptance of this audit. That acceptance arrived 2026-09-26 ("Please proceed", decision D3 in `PROJECT_STATE.md` §6), which also authorized M1; M1 has since been executed and its own report awaits acceptance (`PROJECT_STATE.md` rev 8).
