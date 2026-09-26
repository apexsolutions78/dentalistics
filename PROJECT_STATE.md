# PROJECT_STATE.md — Dental Clinic Automation

**GOAL:** Build a narrow automation system for dental clinics covering lead capture, missed-call text-back, appointment reminders, no-show reactivation, review requests, recall nudges, and an owner dashboard.

**CURRENT_STATUS:** `Project_Planning_Dentalistics.md` (owner, 2026-09-26) is the **governing development plan** — milestones M0–M23 with a gate system; it supersedes this document's phase/Stage structure where they conflict (issues recorded in `M0_Project_Audit.md`). Milestone 0 **ACCEPTED** (owner: "Please proceed", 2026-09-26; recorded as D3, §6). Milestone 1 (Foundation) **COMPLETED 2026-09-26 — awaiting owner acceptance**: Express 5 + mysql2 scaffold, fail-fast env validation, JSON logging with secret redaction, structured error handling, `GET /health` with DB check, SQL migration runner, Vitest/ESLint/tsc gates — `npm run verify` executed exit 0 (26/26 tests passed, including 4 live-DB integration tests against a local MySQL 8.4 Docker container); server smoke-tested (boot with DB verification, `/health` 200, `/` 200, unknown route 404, missing-env and unreachable-DB startup failures exit 1). Initial commit `de088b9` pushed to `origin` (https://github.com/apexsolutions78/dentalistics.git), remote HEAD verified with `git ls-remote`. No provider accounts exist. Prior discovery remains valid: B1/B6 partially answered, decisions D1 (integration staged), D2 (WhatsApp + Twilio; global subscription market) and D3 recorded in §6.

**Governing protocol:** `CLAUDE.md` — MASTER_AI_RELIABILITY_PROTOCOL v1.0. This document is structured to its `<PROJECT_STATE>` durable-state categories.

**Last updated:** 2026-09-26 (revision 9)

---

## Evidence legend

Per **Project Rule 4** in `CLAUDE.md`, every material claim below carries one of five status labels.

| Label | Meaning |
|---|---|
| **CONFIRMED** | Stated by the project owner, observed directly by tool inspection, or supported by a cited authoritative source |
| **ASSUMED** | Inferred or plausible but not confirmed; the basis is stated. Must be confirmed or deleted before it is relied on |
| **PROPOSED** | An option or suggestion put forward by Claude, awaiting the owner's decision. Never a requirement until approved |
| **UNKNOWN** | Information is absent |
| **NOT VERIFIED** | Claim stated from model memory, not yet checked against an authoritative source |

Where an earlier revision of this document used the protocol's finer internal taxonomy, the mapping is: FACT → CONFIRMED; INFERENCE, ASSUMPTION, ESTIMATE and PREDICTION → ASSUMED; NOT_VERIFIED → NOT VERIFIED.

Rules for this document:

- Nothing becomes CONFIRMED unless the project owner states it, a tool observes it, or an authoritative source supports it.
- No requirement is invented (Project Rule 3). Absence of information is recorded as absence.
- Where an external claim drives design or cost, it must be cited or labelled NOT VERIFIED.
- This document is updated whenever durable facts, decisions, completed work or known issues change (Project Rule 12).

---

## 1. CONFIRMED_FACTS

### 1.1 Product concept — FACT (owner-stated)

A narrow automation system for dental clinics. Not a full practice management system. It automates patient communication and follow-up around events where clinics lose revenue.

Scope areas named by the owner:

1. New lead capture and instant follow-up
2. Missed-call text-back
3. Appointment reminders
4. No-show reactivation
5. Review requests
6. Recall nudges
7. A simple owner dashboard

### 1.2 Initial starter package — FACT (owner-stated)

| # | Capability | Owner's stated requirement |
|---|---|---|
| 1 | Missed-call text-back | Send a text within seconds of a missed call |
| 2 | New lead acknowledgement | Auto-respond to website form submissions |
| 3 | Appointment reminders | Sent at 48 hours, 24 hours and 2 hours before appointment |
| 4 | No-show follow-up | Follow-up message plus a rebooking link |
| 5 | Recall reminder | Target patients overdue for hygiene appointments |
| 6 | Owner report | Show leads, replies, confirmations and no-shows |

### 1.3 Hosting — FACT (owner-stated)

- Initial hosting is the owner's **DirectAdmin web server**.
- The word "initially" indicates hosting may change later — INFERENCE. Treated as the starting target, not a permanent constraint.

### 1.4 Governance and working method — FACT (owner-stated and file-observed)

- The project owner is **not an expert software developer**. Technical decisions must be explained, not assumed.
- Development proceeds **phase by phase**. Phases are not skipped. The next phase does not begin automatically.
- Phase 1 was limited to: understand the concept, identify missing information, create this document. No production application code.
- `CLAUDE.md` contains the **MASTER_AI_RELIABILITY_PROTOCOL v1.0**, which additionally requires: no invented facts or sources; assumptions never presented as verified fact; external verification for consequential information; never claiming work was executed, tested or verified unless it was; explicit uncertainty; and a final audit before substantial work is delivered.

### 1.5 Workspace inventory — FACT (observed via file inspection, 2026-09-03)

| Path | Observation | Verification status |
|---|---|---|
| `CLAUDE.md` | 8048 bytes. Contains MASTER_AI_RELIABILITY_PROTOCOL v1.0. Relocated by the owner from `App/` to the repository root, where it governs the whole project. Byte size and modification time unchanged by the move, so the content is identical to the version read in full. | Read in full |
| `App/` | Now empty. Retained but contains no files. | Confirmed by directory listing |
| `Country Wise Data/Bahrain/Bahrain_Dental_Prospects_2026.xlsx` | Present. **Contents not read.** Its role in this project has not been stated. | Existence only |
| `.git` | Repository initialised on branch `master`, **zero commits** at 2026-09-03 | Confirmed via `git log`. **Updated 2026-09-26 (rev 8):** initial commit `de088b9` created and pushed to `origin`; remote HEAD verified to match |
| `PROJECT_STATE.md` | This document | — |

No source code, dependency manifest, database schema, or configuration exists — FACT (verified: no such files found).

> Note: `App/` was recorded as retained-but-empty in revision 3. Direct directory inspection on 2026-09-26 found no `App/` directory at all — FACT (observed). The folder has since been removed. Whether application code belongs at the repository root is now the only placement question; recorded under 4.3. Full 2026-09-26 inventory (adds `Application Prompt.txt`, `Project_Planning_Dentalistics.md`, `INTEGRATION_PLAN.md`, `M0_Project_Audit.md`) is in `M0_Project_Audit.md`.

### 1.6 Appointment intake — FACT (owner-stated, 2026-09-26)

The patient creates an appointment through an online application form which the application serves for a new customer.

Consequence: for these bookings, appointment data originates inside this system. No third-party practice-management integration is required for them. What this does **not** yet cover (UNKNOWN): bookings made by phone, walk-in or reception; rescheduling and cancellation handling; appointments already in the clinic's diary at go-live; whether the clinic uses a practice-management system at all (bears on A4).

### 1.7 Server environment — FACT (owner-stated, 2026-09-26)

- DirectAdmin-hosted server with **Node.js** and **MySQL** available.
- **Server-based SSH terminal** access available.

Still UNKNOWN under B6: Node.js/MySQL versions; whether a persistent Node process may be kept running and how it is managed (INFERENCE: SSH access makes this plausible, not confirmed); inbound HTTPS webhooks; cron availability and shortest interval; outbound HTTPS to third-party APIs; SSL certificate and domain; physical server location (bears on C2); shared hosting vs VPS.

### 1.8 Market scope and providers — FACT (owner-stated, 2026-09-26)

- The application is **not specific to Bahrain**. The owner may market it **globally, by subscription**. This supersedes the Bahrain-only reading of A2 (§3).
- Integration is to be built for **WhatsApp and Twilio — both** (owner-stated; recorded as decision D2, §6).
- Channel assignment (WhatsApp for messaging, Twilio for SMS and voice) is **ASSUMED** from the context of the owner's message ("call and SMS"); the owner did not separately state which provider carries which channel. Must be confirmed or corrected before build.
- Consequence: per-country rules (SMS sender regimes, data-protection law, language, quiet hours) vary by market and are **UNKNOWN** for every market except Bahrain, which is partially researched (C4). A per-clinic country setting is a design consideration — PROPOSED, not yet a requirement.

---

## 2. CONSTRAINTS

### 2.1 Process constraints — FACT (owner-stated)

- Phase-gated delivery with explicit owner approval between phases.
- Explanations must not assume software engineering expertise.
- Reliability protocol in `CLAUDE.md` applies to all work.

### 2.2 External constraints — VERIFIED

These are cited because they affect schedule, legality or design. They are external facts, not owner requirements.

**C1 — WhatsApp template messages must be pre-approved. FACT (cited).**
Template messages (which is what reminders and recall nudges are) must reach status `APPROVED` before they can be sent; any other status blocks sending. Review is automatic and takes **up to 24 hours**. Session messages — replies inside the 24-hour customer service window — need no approval. Business verification is not required for an individual template to be approved, but it raises the template limit from 250 to 6,000 per account, and Meta requires it for most API features; verification typically takes **2 to 5 business days**, and display name approval **1 to 3 days**.
Sources: [Meta — Template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview), [Meta — Message Template Guidelines](https://developers.facebook.com/docs/whatsapp/message-templates/guidelines), [Bird — WhatsApp business verification](https://bird.com/en-au/docs/knowledge-base/whatsapp/business-verification), [DMHub setup guide](https://www.dmhub.ai/blog/whatsapp-business-api-setup-guide-2026)

> Correction to revision 1 of this document: revision 1 stated WhatsApp lead time was "days to weeks, not hours." That was NOT_VERIFIED and overstated. The verified position is above. Dependent conclusion revalidated: WhatsApp onboarding remains a real schedule dependency, but on a **days** scale, not weeks — and it must be started before reminder features can be demonstrated.

**C2 — Under Bahraini law, patient health data is sensitive personal data. FACT (cited). Applicability: Bahraini clinics; other markets unexamined (UNKNOWN) — see §1.8.**
Bahrain's Personal Data Protection Law (Law No. 30 of 2018) took effect 1 August 2019. Data relating to a person's health is classified as **sensitive personal data**, and processing it without the data subject's consent is prohibited subject to listed exceptions. Obligations include privacy notices, explicit written consent where consent is the basis, security measures proportionate to sensitivity, **written processor contracts**, and restrictions on cross-border transfer to countries lacking adequate protection. Penalties under Article 58 include up to 1 year imprisonment and/or a fine of BHD 1,000–20,000.
Sources: [Al Tamimi — Bahrain PDPL and patient privacy](https://www.tamimi.com/law-update-articles/how-does-bahrains-new-personal-data-protection-law-impact-patient-privacy/), [Official text, Law No. 30/2018](https://www.lloc.gov.bh/Legislation/HTM/K3018), [Bahrain PDPA](https://www.pdp.gov.bh/en/about-PDPA.html)

> Caveat: the Al Tamimi analysis dates from November 2019 and describes implementing regulations as not yet issued. Current PDPA guidance must be re-checked before relying on the detail. Whether Bahraini law applies depends on which market the clinic sits in; the owner's 2026-09-26 statement (§1.8) makes Bahrain one possible market among many, so C2 applies to Bahraini clinics specifically and applicable law elsewhere is UNKNOWN (unexamined).
> Direct consequence if applicable: a written data processing agreement between Apex and each clinic is a legal requirement, not paperwork to defer. Cross-border transfer rules constrain where the server may sit and which messaging provider may be used.

**C3 — Selectively soliciting positive reviews is prohibited by Google. FACT (cited).**
Google's Maps User Contributed Content Policy states merchants may not "discourage or prohibit negative reviews, or selectively solicit positive reviews from customers." Enforcement is at profile level and can include blocking new reviews, unpublishing existing reviews, and a public warning on the profile. The common two-step "how did we do?" flow — where only satisfied patients receive the review link — is a violation; the routing itself is the breach, even when every review posted is genuine.
Sources: [Google — Prohibited and restricted content](https://support.google.com/contributionpolicy/answer/7400114?hl=en), [Google — Business Profile restrictions for policy violations](https://support.google.com/business/answer/14114287)
Design consequence: the review request feature must send the **same request and same link to every eligible patient**, with no sentiment filtering. This forecloses a design pattern that is common in competing products.

### 2.3 External constraints — mixed status

**C4** was NOT_VERIFIED and is now partially verified (below). **C5** remains NOT_VERIFIED.

**C4 — SMS sender ID registration and automated-messaging rules in Gulf markets. PARTIALLY VERIFIED 2026-09-26; remainder NOT_VERIFIED.**

Revision 1 of this document asserted that Bahrain, the UAE and Saudi Arabia each require registered SMS sender IDs and restrict automated messaging. That claim came from model memory. Partial verification performed on 2026-09-26 while researching `INTEGRATION_PLAN.md`:

- **Bahrain — claim not supported for Twilio routes. FACT (cited):** [Twilio's alphanumeric sender-ID table](https://help.twilio.com/articles/223133767-International-support-for-Alphanumeric-Sender-ID) lists Bahrain as supported with **no** registration requirement, and [Twilio's Bahrain SMS guidelines](https://www.twilio.com/en-us/guidelines/bh/sms) state alphanumeric pre-registration "Not Required", sender ID preserved, number portability available — and that **two-way SMS is not supported** on Twilio in Bahrain (patients could not reply by SMS through that route; design consequence recorded in `INTEGRATION_PLAN.md` §3).
- **UAE and Saudi Arabia — pre-registration corroborated by a secondary source:** smsroute.cc's country dataset lists both as pre-registration regimes (verified 2026-07-26); Bahrain is not covered by that dataset. [Source](https://github.com/SMSRoute-cc/sms-sender-id-regulations)
- **Still NOT VERIFIED:** the primary TRA position for Bahrain (regulator text not read — TRA published [Guidelines for Reducing Fraudulent SMS](https://www.tra.org.bh/en/en/article/tra-bahrain-and-mobile-operators-launch-guidelines-to-combat-fraudulent-sms) with operators in Oct 2025, which concerns blocking fraudulent traffic, not a sender-ID registration programme on its face); whether "restricts automated messaging" applies; and any of this for providers other than Twilio. Must be confirmed against the TRA and the chosen provider before any cost or timeline estimate depends on it.

**C5 — Practice management systems named as examples. NOT_VERIFIED as applicable.**
The product names listed under B1 below (Open Dental, Dentrix, Eaglesoft, Dentally, Curve, CareStack, Cliniko, Dental4Windows, ClinicSoft) are offered as prompts to help the owner identify what the clinic uses. Their individual integration capabilities have not been researched, and none is known to be relevant to this project.

---

## 3. ASSUMPTIONS

Each started as an inference from context, not a statement by the owner. Any row later confirmed or superseded by the owner is annotated in place; the rest must be confirmed, corrected, or deleted before build work depends on them.

| # | Assumption | Basis | Risk if wrong |
|---|---|---|---|
| A1 | This is a **product sold to dental clinics** as a subscription, not an internal tool for a clinic the owner operates | **Owner-CONFIRMED 2026-09-26: "I may market it for subscription globally."** Previously: presence of a dental prospects list; the phrase "starter package" | Changes multi-tenancy, onboarding, billing and support model — that is, most of the architecture |
| A2 | The **initial target market is Bahrain / the Gulf** | **SUPERSEDED 2026-09-26 by owner statement: the application is not Bahrain-only; global subscription marketing is intended (§1.8).** Whether Bahrain remains the first market is still ASSUMED (basis: Bahrain prospects file, owner's earlier focus) | Wrong law (invalidates C2's reach), wrong telecom rules, wrong language, wrong timezone — now per-market rather than single-market |
| A3 | Patient messaging is by **SMS and/or WhatsApp** | **Owner-CONFIRMED 2026-09-26: integration to be built for WhatsApp and Twilio — both (D2); SMS and calls were owner-confirmed the same day.** Originally inferred from "text-back" and "text" | Different provider, cost model and approval path; C1 may not apply |
| A4 | The clinic already uses **practice management software** holding appointments and visit history | Reminders and recall nudges are impossible without that data. **Questioned by the owner's 2026-09-26 answer to B1 (CONFIRMED): new-customer appointments are booked by the patient through this application's own online form, so a practice-management system is not required for those bookings.** A4 must now be confirmed or deleted; whether any practice-management system exists, and how non-online bookings are recorded, is UNKNOWN | If no such system exists and other booking channels are not captured, reminders and recall may only cover online bookings — a materially different product |
| A5 | "Starter package" implies **paid tiers** later | Packaging language. **Revised 2026-09-26: subscription model owner-CONFIRMED ("market it for subscription globally"); pricing, tiers and billing mechanics remain UNKNOWN** | Affects architecture only if billing enters scope early |
| A6 | The owner report is for the **clinic owner**, not for Apex internally | The terms "owner dashboard" and "owner report" | Different audience, metrics and access control |

Nothing in Section 3 is treated as a requirement.

---

## 4. OPEN_ISSUES — information required before development

### 4.1 BLOCKING — the system cannot be safely designed without these.

Status after the owner's answers of 2026-09-26: **B1 and B6 partially resolved (CONFIRMED portions recorded in 1.6 and 1.7). B2 deferred by decision D1 (clinic-side unknowns remain). B3 largely resolved by decision D2 (WhatsApp + Twilio selected; onboarding questions remain). B4, B5 unanswered. Every item still carries UNKNOWN sub-questions that must be closed before the affected stage is built.**

**B1 — Where does appointment and patient data come from?** — **PARTIALLY RESOLVED 2026-09-26 (owner-stated, CONFIRMED).**

Resolved: the patient creates the appointment through an online application form served by this application to a new customer (see 1.6). For those bookings the data originates in this system — no external API, export or CSV is needed.

Still UNKNOWN — reminders, no-show follow-up and recall nudges depend on these:

- How are bookings made by phone, walk-in or reception recorded, and can this system see them?
- What happens on rescheduling or cancellation, and who confirms it?
- Are there existing appointments in the clinic's diary at go-live that must be reminded?
- Does a practice-management system exist at all now that online booking is in-house? (A4 — confirm or delete.)
- Patient identity: which fields the form captures (name, phone, email), and whether one patient can hold multiple appointments.

**B2 — Where do phone calls happen, and can missed-call events be observed?** — **PARTIALLY ANSWERED 2026-09-26: owner has no call integration, application or plan at present, and has decided to defer call integration to a later stage while keeping the capability in scope (decision D1, §6; plan in `INTEGRATION_PLAN.md`).** The clinic-side facts below remain UNKNOWN and are required before Stage 2 design — they do not block Stage 0 or Stage 1.

Text-back "within seconds" requires a real-time signal that a call was missed.

- Landline, mobile, VoIP, or cloud phone system?
- Can the clinic's number be forwarded to, or replaced by, a programmable number?
- Is a number change acceptable, or must the existing number be preserved exactly?
- Who answers calls today, and what counts as "missed" — unanswered, out of hours, busy, or all three?

**B3 — Which messaging provider, and is it usable in the target market?** — **LARGELY RESOLVED 2026-09-26: owner selected WhatsApp and Twilio, both to be built (decision D2); SMS and calls are owner-confirmed media; integration timing to be confirmed (see 4.1 header and D1/D2).** See C1 (verified WhatsApp constraints) and C4 (partially verified 2026-09-26).

Remaining UNKNOWN: how WhatsApp access is obtained (direct Meta Cloud API or a Business Solution Provider); who holds and pays for the Meta and Twilio accounts — Apex or each clinic; whether a Twilio account already exists; per-market SMS usability for every target country (global marketing, §1.8).

**B4 — What data protection obligations apply?**
See C2. Specifically still unknown:

- Which law governs, which depends on resolving A2.
- Is storing patient names, phone numbers and appointment history on this DirectAdmin server acceptable to the clinic and lawful?
- Required retention period and deletion obligations.
- How patient consent to be messaged is captured and recorded.
- Opt-out handling, for example replying STOP.

**B5 — One clinic, or many?** — **RESOLVED 2026-09-26 by the governing plan (`Project_Planning_Dentalistics.md`, MVP-1 and MULTI-TENANCY sections): the application must support multiple clinics architecturally from the start, with strict tenant isolation tested at Milestone 2.** How many clinics initially remains unknown but is no longer an architecture question.

**B6 — What does the DirectAdmin server actually support?** — **PARTIALLY RESOLVED 2026-09-26 (owner-stated, CONFIRMED).**

Resolved: DirectAdmin-hosted server with **Node.js** and **MySQL** available, plus **server-based SSH terminal** access (see 1.7). The stack direction Node.js + MySQL is therefore feasible in principle — CONFIRMED at the capability level only; versions untested.

Still UNKNOWN — required before a stack is chosen; the owner can establish these without clinic involvement:

- Node.js and MySQL version numbers
- How Node processes are run and whether one may persist (INFERENCE: SSH access makes this plausible; not confirmed)
- Cron access and shortest permitted interval
- **Ability to receive inbound HTTPS webhooks**
- Outbound HTTPS to third-party APIs, permitted or firewalled
- SSL certificate for the application's domain; which domain or subdomain
- Physical server location, which bears on C2
- Shared hosting or VPS

INFERENCE, not a decision: cron alone can send scheduled reminders reliably, but missed-call text-back "within seconds" must react to an inbound webhook. Whether the server can accept webhooks is therefore a hard gate on starter-package feature 1 — still open.

### 4.2 IMPORTANT — required before building the specific feature. All UNKNOWN.

**Messaging behaviour**

- Wording for every message type: who writes it, who approves it?
- Language: English, Arabic, or both? Right-to-left text and per-patient language preference materially affect the build.
- Clinic timezone, and quiet hours during which no message may be sent.
- Behaviour when an appointment is booked less than 48 hours out: fewer reminders, or a compressed schedule?
- May patients reply? If so, who reads and answers replies, and where?
- Confirmation mechanism: reply keyword, tap a link, or none?
- What happens on a cancellation reply, and who at the clinic is notified?
- Frequency cap per patient, so several automations do not fire at once.

**Definitions that must be exact, because the owner report counts them**

- "No-show": who marks it, in which system, how soon after the appointment?
- "Overdue hygiene patient": which interval defines overdue, measured from which date?
- "Lead": does a missed call create one, or only a website form submission?
- "Reply" and "confirmation" as counted in the report.

**Lead capture**

- Website platform: WordPress, Wix, custom, none.
- How submissions reach the system: a form we host and embed, a webhook from their form, or email parsing.
- Which fields are captured, and which are mandatory.
- Expected lead volume per clinic per month.

**Review requests** — subject to C3

- Which platform: Google Business Profile, Facebook, other.
- Trigger point: after appointment completion, or another event. Sentiment-based routing is excluded by C3.

**Owner dashboard and report**

- Web dashboard, emailed report, or both? Frequency?
- Exact metric definitions and date ranges.
- Who logs in, how many users per clinic, and are there roles such as owner versus reception?
- Authentication: password only, or two-factor?
- Must it work on a phone?

**Operations**

- Who runs the system day to day: clinic reception, or Apex on the clinic's behalf?
- What happens when a message fails to send, and who is alerted?
- Expected uptime and acceptable behaviour during downtime.
- Backup and recovery expectations.

### 4.3 NON-BLOCKING open questions

- Budget for third-party services (messaging, telephony, hosting).
- Target date for a first working pilot.
- Is a pilot clinic committed, and which one?
- How success will be measured, for example no-show rate reduction or time-to-first-contact.
- Pricing and billing to clinics.
- Roadmap beyond the starter package.
- The role of `Country Wise Data/Bahrain/Bahrain_Dental_Prospects_2026.xlsx` — sales prospecting data, or input to this system?
- Whether `App/` is intended to be the application root. It is now empty, so the question is still open: application code could live at the repository root or inside `App/`. This is a Phase 3 decision, not a Phase 2 blocker.

---

## 5. ARCHITECTURE

**M0 recommendation (PROPOSED 2026-09-26):** one TypeScript modular monolith — Express HTTP layer, mysql2 pool, migration-managed schema, DB-backed job queue + provider abstraction (mock first), authenticated webhook receivers, structured logging, Vitest + ESLint + tsc quality gates. Alternatives (separate services, message brokers) rejected under the plan's Decision Rule. Full rationale: `M0_Project_Audit.md` RECOMMENDED ARCHITECTURE.

**M1 implementation (CONFIRMED — executed 2026-09-26):** the foundation layer exists at scaffold level: Express 5 app factory with injected dependencies, `src/config.ts` (env validation, fail-fast, password never echoed in errors), `src/logger.ts` (structured JSON, redacts password/token/secret-like keys at any depth), `src/errors.ts` (AppError/NotFoundError/ValidationError + Express error handler: 400/404/413/500 with generic 500 message), `src/db/pool.ts` (mysql2 pool, UTC `timezone: 'Z'`, health check), `src/db/migrate.ts` (SQL-file runner, `schema_migrations` tracking, explicit `npm run migrate`, idempotent), `GET /` and `GET /health`, `tests/` (4 suites, 26 tests). Not implemented (later milestones): job queue, provider abstraction, webhook receivers, authentication, tenant isolation (M2+).

**Stack acceptance status:** M1 was executed on the M0-recommended stack (TypeScript 5.9.3, Express 5, mysql2, Vitest, ESLint; all versions resolved live from npm, not memory). ASSUMED: the owner's "proceed" instruction — which under the gate system was required to include a stack decision for M1 to start — constitutes acceptance of that stack. No separate stack approval was given; the owner may still correct it at M1 acceptance.

---

## 6. DECISIONS

No provider selection has been made. Recorded scoping decisions:

| Date | Decision | Reason | Made by |
|---|---|---|---|
| 2026-09-26 | **D1 — Call and SMS integration is deferred to a later stage, but stays in scope.** The application is to be built now with a provider-pluggable messaging layer (Stage 0), messaging integration happens at Stage 1, missed-call text-back at Stage 2. Plan recorded in `INTEGRATION_PLAN.md` (PROPOSED, awaiting owner approval) | Owner has no call/SMS provider, connection or plan at present; SMS/calls are current demand and the most convenient medium, so the capability cannot be skipped | Project owner |
| 2026-09-26 | **D2 — Build integration for both WhatsApp and Twilio. Application is not Bahrain-only; global subscription marketing intended.** Timing of the build (with the application vs started immediately) clarified with the owner before code is written | Owner statement, 2026-09-26 | Project owner |
| 2026-09-26 | **D3 — Owner instruction "Please proceed" after the M0 report.** Effects: M0 treated as accepted under the gate system; M1 (Foundation) authorized; the M0 audit's PROPOSED initial git commit + push authorized (reported at end of M1). ASSUMED to also accept the M0-recommended stack (gate requires a stack decision for M1; no separate stack approval given — confirmable at M1 acceptance) | Direct owner instruction following the M0 status report | Project owner |

---

## 7. KNOWN_ISSUES

| # | Issue | Status |
|---|---|---|
| K1 | The reliability protocol was scoped to the `App/` directory while this document sat at the repository root. | **Resolved 2026-09-03.** Owner moved `CLAUDE.md` to the repository root; verified by directory listing. Protocol and state document are now at the same level and the protocol governs the whole project. |
| K2 | "Within seconds" missed-call text-back may be incompatible with a cron-only shared host. See B6. | Open — narrowed 2026-09-26: Node.js + SSH confirmed (a persistent process is plausible, not confirmed), but inbound webhook capability is still UNKNOWN, and B2 (how a missed call is observed at all) is unanswered. Both gate feature 1. Integration itself deferred by decision D1 (§6); sequencing in `INTEGRATION_PLAN.md` §4. |
| K3 | Assumption A2 (Bahrain) is load-bearing: constraint C2 stands or falls with it, and C2 has legal and architectural consequences. | **Re-scoped 2026-09-26** — A2 superseded: the owner targets a global subscription market (§1.8). C2 still governs Bahraini clinics; the load-bearing question is now per-market legal assessment for each target country (UNKNOWN, unexamined — plan/global consequence recorded in `INTEGRATION_PLAN.md`). |
| K4 | Constraint C4 (SMS sender ID rules) was asserted from memory in revision 1 and remains unverified. | **Partially resolved 2026-09-26** — verified against Twilio documentation: Bahrain requires no sender-ID pre-registration per Twilio (original claim corrected), UAE/Saudi pre-registration corroborated by a secondary dataset. TRA primary source and non-Twilio providers still unverified — see C4 and plan item V1. |
| K5 | The Bahrain PDPL analysis cited in C2 dates from 2019 and may be out of date on implementing regulations. | Open — re-check current PDPA guidance |
| K6 | The local dev MySQL root password was written into `README.md` and pushed to the **public** repository `apexsolutions78/dentalistics` in commits `de088b9` and `c20437f` (2026-09-26). | **Mitigated same day:** credential rotated (old value verified non-authenticating over TCP), README replaced with a placeholder (`6d6b66c`), current tree verified clean via `git grep`. The dead value remains in git **history**; removing it requires a history rewrite/force-push — NOT done (needs explicit owner instruction). Optional owner decision: keep repo public, make it private, or rewrite history. |

---

## 8. COMPLETED

| Item | Verification status |
|---|---|
| Workspace inspected; file inventory recorded | Verified by file inspection |
| `CLAUDE.md` read in full and applied to this document | Verified — read after owner populated it |
| Product concept captured from owner's brief | Verified against owner's message |
| Gap analysis performed; blocking / important / non-blocking separated | Complete |
| External verification of C1, C2, C3 | Verified with cited sources |
| This document created | Written to disk |
| B1 partially answered by owner (online booking form owns appointment data) and recorded — 2026-09-26 | Verified against owner message; written to disk |
| B6 partially answered by owner (Node.js, MySQL, SSH on DirectAdmin server) and recorded — 2026-09-26 | Verified against owner message; written to disk |
| C4 partially verified against Twilio documentation while researching the integration plan — 2026-09-26 | Verified with cited sources; remainder left NOT_VERIFIED |
| `INTEGRATION_PLAN.md` created (Stage 0/1/2 plan, verification checklist, sources) | Written to disk; PROPOSED, awaiting owner approval |
| Providers selected (WhatsApp + Twilio, both) and global subscription market scope recorded as D2 / §1.8 — 2026-09-26 | Verified against owner message; written to disk |
| Milestone 0 accepted and Milestone 1 authorized via owner instruction "Please proceed" (decision D3, §6) — 2026-09-26 | Verified against owner message |
| M1 foundation scaffold written: `src/config.ts`, `src/logger.ts`, `src/errors.ts`, `src/app.ts`, `src/index.ts`, `src/db/pool.ts`, `src/db/migrate.ts`, 4 test suites, `migrations/0001_create_app_meta.sql`, tooling configs (`package.json`, `tsconfig*`, `eslint.config.mjs`, `vitest.config.mts`, `.gitignore`, `.env.example`), `README.md` — 2026-09-26 | Written to disk |
| M1 gates executed: `npm run lint` exit 0, `npm run typecheck` exit 0, `npm test` 26/26 passed, `npm run build` exit 0; full `npm run verify` exit 0 run twice (second run after a test fix) | Executed on this machine 2026-09-26; exit codes observed |
| DB integration tests executed against local MySQL 8.4 Docker container (connection up/bad-credentials down, migration apply-once + idempotent re-run, real `./migrations` applied, `app_meta` table present) | Executed 2026-09-26; container `dentalistics-mysql` healthy |
| Server smoke tests executed from `dist/`: boot verifies DB then listens; `GET /health` 200 `database:"up"`; `GET /` 200; unknown route structured 404; startup with missing env → ConfigError on stderr, exit 1; startup with unreachable DB → logged, exit 1 | Executed 2026-09-26; observed in terminal |
| `npm run migrate` executed twice: first run applied `0001_create_app_meta.sql`, second run skipped it (idempotent, `schema_migrations` tracking works) | Executed 2026-09-26 |
| Initial commit `de088b9` created (28 files) and pushed to `origin`; remote HEAD verified equal to local via `git ls-remote` | Verified 2026-09-26 |

One test defect was found and fixed during M1 (migration probe used a fixed file name, so a second run against the same test database reported the file as already applied instead of applying it): fixed with a unique per-run name plus tracking-row cleanup, then re-verified — `npm test` 26/26 twice.

Everything beyond the M1 scope (`/`, `/health`, config, logging, errors, migrations) remains unimplemented: no authentication, tenant isolation, domain schema, providers, webhooks, queue, or UI — those belong to later milestones.

---

## 9. Out of scope for now

Recorded so scope does not drift. Not rejected — simply not in scope.

- Clinical records, charting, treatment planning
- Billing, insurance, claims
- Payments taken from patients
- Patient self-service online booking. A rebooking **link** is in scope; a full booking engine has not been requested.
- Staff scheduling or payroll
- Native mobile applications
- Marketing campaigns beyond the six starter-package automations

---

## 10. Phase log

| Phase | Description | Status |
|---|---|---|
| 1 | Concept capture and gap analysis; create this document | Complete, awaiting owner review |
| 2 | Requirements clarification: resolve Section 4.1, then 4.2; verify C4; re-check C5 and K5 | **Not formally started (Rule 1).** Owner volunteered partial answers to B1 and B6 on 2026-09-26; recorded under Rule 12. Remaining 4.1 items (B1 sub-items, B2, B3, B4, B5, B6 sub-items) unanswered — awaiting owner instruction to proceed |
| 3+ | Not yet defined | Not started |

**Nothing proceeds past Phase 1 without explicit instruction from the project owner.**

> Superseded note (2026-09-26, revision 7): the owner issued `Project_Planning_Dentalistics.md`, which replaces this phase model with milestones **M0–M23** governed by its MILESTONE GATE SYSTEM. Milestone 0 is in progress; every later milestone is NOT_STARTED. The stopping rule is unchanged: no next milestone without explicit acceptance of the current one.
>
> **Updated 2026-09-26 (revision 8):** M0 **ACCEPTED** (owner "Please proceed", D3); M1 **COMPLETED, awaiting owner acceptance**; M2–M23 NOT_STARTED. Stopping rule unchanged: M2 does not begin until the owner accepts the M1 report.

---

## 11. Change log

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-09-03 | Initial creation. Recorded `CLAUDE.md` as empty (correct at time of reading, 18:19). |
| 2 | 2026-09-03 | `CLAUDE.md` re-read after owner populated it at 18:24; reliability protocol adopted and document restructured to its `<PROJECT_STATE>` categories. Evidence labels added throughout. WhatsApp lead-time claim corrected against Meta documentation. Bahrain PDPL and Google review policy verified and cited. Unverified SMS sender-ID claim demoted to NOT_VERIFIED. Sections added for ARCHITECTURE, KNOWN_ISSUES, COMPLETED. |
| 3 | 2026-09-03 | Owner moved `CLAUDE.md` from `App/` to the repository root; verified by directory listing. All path references updated. K1 closed as resolved. `App/` recorded as now empty. No change to the protocol's content, and no change to any requirement, assumption or unknown. |
| 4 | 2026-09-26 | Owner answered B1 (appointment data comes from an online application form the application serves to new customers) and B6 (DirectAdmin server with Node.js, MySQL and server-based SSH). Recorded as CONFIRMED in 1.6 and 1.7; 4.1 B1/B6 marked partially resolved with remaining sub-items listed; A4 questioned; K2 narrowed; phase log updated. `App/` found absent on re-inspection (noted in 1.5). No other section changed. |
| 5 | 2026-09-26 | Owner stated no call/SMS integration exists or is planned, requires the capability, and deferred integration to a later stage. Recorded as decision D1 (§6); B2/B3 annotated; A3 revised (SMS and calls owner-confirmed, WhatsApp still assumed); K2 annotated. C4 partially verified and corrected against Twilio documentation (Bahrain: no sender-ID pre-registration, two-way SMS unsupported on Twilio). `INTEGRATION_PLAN.md` created (Stage 0/1/2, verification checklist V1–V7, sources). |
| 7 | 2026-09-26 | Owner issued `Project_Planning_Dentalistics.md` as the governing development plan ("follow as per planning in the file"). Milestone 0 executed: `M0_Project_Audit.md` written (13-section audit + M0–M23 status table), delivered IN_PROGRESS awaiting acceptance. B5 resolved (multi-clinic architecture required by MVP-1). CURRENT_STATUS, §1.0 phase log and inventory pointer updated. No code written. |
| 6 | 2026-09-26 | Owner selected WhatsApp + Twilio (both to be built) and stated the application is not Bahrain-only — global subscription marketing intended. Recorded as D2 (§6) and §1.8; A1 confirmed (subscription product), A2 superseded, A3 confirmed (WhatsApp), A5 revised (subscription confirmed); B3 largely resolved; C2 applicability re-scoped to Bahraini clinics; K3 re-scoped; C2 caveat corrected. Build timing to be clarified with owner before code. |
| 8 | 2026-09-26 | Owner instruction "Please proceed" recorded as decision D3: M0 accepted, M1 authorized, initial commit + push authorized. Milestone 1 executed: foundation scaffold written (7 source files, 4 test suites, 1 migration, tooling configs); `npm run verify` exit 0 with 26/26 tests (including 4 live-DB integration tests on MySQL 8.4 Docker); server smoke-tested incl. fail-fast startup paths; `npm run migrate` verified idempotent. One test defect found, fixed, re-verified. Initial commit `de088b9` pushed to `origin`, remote HEAD verified. §5 ARCHITECTURE rewritten (M0 proposal + M1 implementation status), §8 COMPLETED updated, M0 audit K-I1/R1/M0/M1 rows updated. M1 report delivered; awaiting owner acceptance — M2 NOT_STARTED. |
| 9 | 2026-09-26 | Security incident recorded as K6: dev MySQL password had been committed in README (public repo). Rotated credential, fixed README (`6d6b66c`), verified current tree clean and old password non-authenticating; re-ran `npm run verify` exit 0 + migrate + server health after rotation. History retains the dead value — history rewrite only on explicit owner instruction. |
