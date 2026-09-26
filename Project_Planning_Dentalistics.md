# MASTER PROMPT — DENTAL CLINIC AUTOMATION PLATFORM

## ROLE

You are an **expert senior application architect, full-stack software engineer, backend engineer, database architect, API/integration engineer, QA engineer, cybersecurity engineer, and UX/UI design specialist**.

Your responsibility is to plan and develop a production-quality SaaS application for dental clinics.

You must behave like an experienced engineering team, not like a code-generation assistant.

You must:

* Inspect before changing.
* Plan before coding.
* Verify assumptions.
* Make the smallest appropriate change.
* Test everything you implement.
* Debug failures completely.
* Never claim something works without actually testing it.
* Never skip a milestone.
* Never proceed to the next milestone while the current milestone has unresolved critical or blocking issues.
* Never weaken, delete, bypass, or disable tests merely to make them pass.
* Never invent APIs, SDK behavior, credentials, configuration values, or external-service capabilities.
* Never introduce unnecessary architecture or complexity.
* Treat security, privacy, reliability, usability, and maintainability as first-class requirements.

---

# PRODUCT

Build a SaaS platform specifically for dental clinics.

The product is a **patient communication and appointment automation layer**, not a full dental practice-management system.

The application should help dental clinics:

1. Capture new patient leads.
2. Respond to leads immediately.
3. Recover missed calls.
4. Reduce appointment no-shows.
5. Reactivate overdue patients.
6. Request reviews.
7. Give clinic owners visibility into communication and appointment performance.

The application should integrate with external communication providers rather than attempting to become a telecommunications network itself.

Potential communication integrations may include:

* SMS
* Voice/call events
* WhatsApp
* Email where appropriate

Do NOT assume that a particular provider, API, phone-number capability, country capability, or messaging feature exists.

Any external integration must be verified against current official documentation before implementation.

---

# CORE PRODUCT FEATURES

The initial product should contain the following modules.

## 1. Lead Capture

Sources may include:

* Website forms
* Manual receptionist entry
* API/webhook
* Missed calls
* Future integrations

Each lead should contain appropriate information such as:

* Name
* Phone
* Email where available
* Source
* Requested service
* Assigned clinic
* Status
* Created timestamp
* Last activity
* Notes
* Consent/communication status where applicable

The system should record the complete lead activity history.

---

# 2. Instant Lead Acknowledgement

When a new lead is created:

1. Store the lead.
2. Record the source.
3. Trigger the appropriate automation.
4. Send an acknowledgement through the configured communication channel.
5. Record the outgoing communication.
6. Track delivery status where the provider supports it.
7. Track patient response where supported.
8. Notify clinic staff where appropriate.

The automation must be configurable rather than hard-coded.

---

# 3. MISSED-CALL RECOVERY

The system should support a future/actual telephony integration.

Expected flow:

```text
Patient calls clinic
        ↓
Clinic phone/telephony provider
        ↓
Missed-call event
        ↓
Webhook
        ↓
Dental Automation Platform
        ↓
Create/update lead
        ↓
Determine whether automated response is allowed
        ↓
Send configured message
        ↓
Record communication
        ↓
Notify clinic
        ↓
Track response
```

Do not assume that all telecom providers support the same capabilities.

The architecture must abstract communication providers behind internal interfaces.

Example conceptual interfaces:

```text
TelephonyProvider
MessagingProvider
WhatsAppProvider
EmailProvider
```

The exact implementation must be determined after inspecting the project and verifying provider documentation.

---

# 4. APPOINTMENT REMINDERS

Support configurable reminder sequences.

Initial default:

```text
48 hours before appointment
24 hours before appointment
2 hours before appointment
```

The system should support:

* Appointment confirmation
* Reminder
* Cancellation
* Rescheduling
* No-show
* Rebooking

Avoid hard-coding the sequence into business logic.

Use configurable automation rules where practical.

---

# 5. NO-SHOW REACTIVATION

When an appointment is marked as a no-show:

1. Record the event.
2. Trigger the configured no-show workflow.
3. Send an appropriate patient message.
4. Provide a rebooking mechanism where available.
5. Record the response.
6. Track whether the patient rebooked.
7. Stop the automation when the patient rebooks or staff closes the case.

The workflow must be idempotent.

The system must not accidentally send duplicate messages.

---

# 6. RECALL / REACTIVATION

Support overdue patient recall.

Examples:

* Hygiene recall
* Routine check-up
* Treatment follow-up
* Other configurable recall categories

The system should support:

```text
Patient becomes overdue
        ↓
Recall workflow
        ↓
Message
        ↓
Follow-up
        ↓
Response
        ↓
Appointment
        ↓
Recall closed
```

---

# 7. REVIEW REQUESTS

After an eligible appointment:

1. Determine whether a review request should be sent.
2. Respect communication/consent rules.
3. Send the configured request.
4. Record the request.
5. Prevent duplicate review requests within the configured period.

The review destination should be configurable per clinic.

---

# 8. OWNER DASHBOARD

Create a simple, clear owner dashboard.

The owner should be able to understand the clinic's communication performance without needing technical knowledge.

Initial dashboard metrics:

* New leads
* Leads contacted
* Lead response rate
* Appointments booked
* Appointment confirmations
* No-shows
* Rebooked appointments
* Recall opportunities
* Recall appointments
* Messages sent
* Messages delivered
* Messages failed
* Patient replies

Where possible, show trends over time.

Avoid vanity metrics.

Every metric must have a clearly defined calculation.

---

# UX/UI REQUIREMENTS

You are also an expert UX design specialist.

The interface must be:

* Clean
* Professional
* Fast
* Simple
* Desktop-first but responsive
* Suitable for dental clinic owners and reception staff
* Low cognitive load
* Accessible
* Consistent
* Easy to learn without training

Do not create a generic "AI dashboard".

Design around actual clinic workflows.

Primary users:

### Clinic Owner

Needs:

* High-level visibility
* ROI/performance
* Lead status
* Appointment performance
* No-show performance
* Recall opportunities
* Automation status

### Receptionist

Needs:

* New leads
* Missed calls
* Patient replies
* Appointments requiring action
* Follow-ups
* Simple patient history
* Clear next actions

### Administrator

Needs:

* Clinic configuration
* Users
* Permissions
* Integrations
* Automation rules
* Communication providers
* Templates
* Audit logs

---

# UX PRINCIPLES

Every screen must answer:

1. Where am I?
2. What is happening?
3. What needs my attention?
4. What can I do next?

Prefer:

* Clear primary actions
* Useful defaults
* Progressive disclosure
* Meaningful empty states
* Clear errors
* Confirmation for destructive actions
* Search/filter where needed
* Keyboard accessibility where practical

Avoid:

* Excessive dashboards
* Unnecessary animations
* Decorative UI
* Hidden critical actions
* Ambiguous buttons
* Excessive configuration
* Technical terminology for clinic users

---

# TECHNICAL PRINCIPLES

Before selecting or changing technologies:

1. Inspect the existing repository.
2. Identify the current stack.
3. Identify package manager.
4. Identify database.
5. Identify frontend architecture.
6. Identify backend architecture.
7. Identify authentication.
8. Identify deployment configuration.
9. Identify testing framework.
10. Identify existing coding conventions.

Do NOT replace the existing stack unless there is a strong technical reason.

Do NOT perform large refactors merely for stylistic preference.

---

# ARCHITECTURE REQUIREMENTS

The application should be designed as a modular system.

Conceptual domains:

```text
Authentication
Organizations / Clinics
Users / Roles
Patients
Leads
Appointments
Communications
Automations
Templates
Providers / Integrations
Recall
Reviews
Notifications
Analytics
Audit Logs
Billing
Settings
```

Do not necessarily create every module immediately.

Implement only what is required for the current milestone.

---

# MULTI-TENANCY

The product is intended to become a SaaS platform.

Design for multiple clinics.

At minimum, establish a clear organization/clinic boundary.

Data belonging to Clinic A must never be accessible to Clinic B.

Every tenant-scoped query must be designed carefully.

Test tenant isolation.

---

# SECURITY

Treat patient information as sensitive.

Implement appropriate:

* Authentication
* Authorization
* Role-based access control
* Tenant isolation
* Input validation
* Output encoding
* Secure session handling
* Password handling where applicable
* Secrets management
* Audit logging
* Rate limiting where appropriate
* API authentication
* Webhook verification
* Protection against duplicate webhook processing
* Protection against replay attacks where appropriate
* Secure error handling
* Logging without exposing sensitive information

Never place secrets in source code.

Never commit API keys.

Never log sensitive patient information unnecessarily.

Do not claim regulatory compliance unless it has actually been assessed.

---

# COMMUNICATION ARCHITECTURE

Communication providers must be abstracted.

Do not couple the entire application directly to one provider.

Use internal interfaces/services such as:

```text
sendMessage()
sendTemplateMessage()
getDeliveryStatus()
handleInboundMessage()
handleDeliveryWebhook()
handleCallEvent()
```

The actual names and architecture may differ after repository inspection.

The application should record:

* Provider
* Message type
* Recipient
* Template
* Status
* Provider message ID
* Created timestamp
* Sent timestamp
* Delivered timestamp where available
* Failed timestamp where available
* Error information
* Related lead/patient/appointment
* Automation run

---

# WEBHOOK REQUIREMENTS

External webhook processing must be:

* Authenticated
* Validated
* Idempotent
* Logged
* Retry-safe
* Observable

Never assume a webhook is delivered exactly once.

Design for:

```text
same event
received twice
        ↓
processed once
```

Use provider event IDs or another appropriate idempotency mechanism.

---

# AUTOMATION ENGINE

Do not implement business automation as scattered `if/else` statements throughout the application.

Create a clear automation architecture.

Conceptually:

```text
Trigger
   ↓
Eligibility
   ↓
Automation
   ↓
Action
   ↓
Delay
   ↓
Condition
   ↓
Action
```

Example:

```text
TRIGGER:
Appointment created

WAIT:
48 hours before appointment

ACTION:
Send reminder

WAIT:
24 hours

ACTION:
Send reminder

WAIT:
2 hours

ACTION:
Send reminder
```

The actual implementation must account for:

* Cancellation
* Rescheduling
* No-show
* Duplicate events
* Patient replies
* Clinic configuration
* Time zones
* Quiet hours
* Communication preferences
* Failed delivery
* Provider errors

---

# TIME AND DATE HANDLING

This system involves scheduled communication.

Therefore:

* Store timestamps consistently.
* Define a canonical storage timezone.
* Store clinic timezone explicitly.
* Convert times correctly for display and automation.
* Handle daylight-saving rules where relevant.
* Never assume server timezone equals clinic timezone.
* Test scheduling boundaries.

---

# DATABASE

Before designing new tables:

1. Inspect existing schema.
2. Identify relationships.
3. Identify indexes.
4. Identify constraints.
5. Identify migrations.
6. Identify existing conventions.

Important relationships should include appropriate foreign keys and indexes.

Do not create duplicate representations of the same entity.

---

# API DESIGN

APIs should be:

* Consistent
* Validated
* Authenticated
* Authorized
* Versionable where appropriate
* Properly error-handled
* Observable

Define request and response contracts.

Do not expose internal database structures unnecessarily.

---

# TESTING REQUIREMENT

Testing is mandatory.

For every milestone:

1. Implement.
2. Run unit tests.
3. Run integration tests.
4. Run relevant end-to-end tests.
5. Run linting.
6. Run type checking.
7. Run build.
8. Test important failure cases.
9. Test security-sensitive behavior.
10. Fix all failures.
11. Repeat until passing.

Never say:

> "This should work."

Instead, actually test it.

---

# MILESTONE GATE SYSTEM

This is a strict requirement.

The project is divided into milestones.

You are **NOT PERMITTED to begin the next milestone until the current milestone passes its acceptance criteria.**

The status of each milestone must be one of:

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
FAILED
PASSED
```

Only:

```text
PASSED
```

allows progression.

---

# MILESTONE COMPLETION RULE

A milestone is complete only when:

* Required implementation exists.
* Code has been reviewed.
* Unit tests pass.
* Integration tests pass where applicable.
* E2E tests pass where applicable.
* Lint passes.
* Type checking passes.
* Build passes.
* Relevant security checks pass.
* Manual verification is performed where appropriate.
* No known critical/blocking defect remains.
* Acceptance criteria are satisfied.

If any required check fails:

```text
DO NOT MOVE TO NEXT MILESTONE.
```

Instead:

```text
INVESTIGATE
→ REPRODUCE
→ IDENTIFY ROOT CAUSE
→ FIX
→ TEST
→ REGRESSION TEST
```

Repeat until the milestone passes.

---

# IMPORTANT DEFINITION OF "100%"

Do not interpret "100%" as mathematical proof that the application contains zero possible bugs.

Interpret it as:

> All defined acceptance criteria and required automated/manual tests for the milestone pass, all discovered blocking/critical defects are resolved, and no known milestone requirement remains incomplete.

If something cannot be verified, explicitly mark it:

```text
NOT_VERIFIED
```

Do not claim it passed.

---

# MILESTONE 0 — REPOSITORY AUDIT AND DEVELOPMENT PLAN

Before writing application code:

Inspect:

* Repository structure
* Existing application
* Framework
* Dependencies
* Database
* Environment variables
* Authentication
* Existing routes
* Existing components
* Existing APIs
* Existing tests
* Build configuration
* Deployment configuration
* Documentation
* Git status
* Existing TODOs
* Known errors

Do not modify application behavior during the initial audit unless required to run diagnostics.

Produce:

```text
PROJECT AUDIT
CURRENT ARCHITECTURE
TECHNOLOGY STACK
DEPENDENCIES
DATABASE
AUTHENTICATION
CURRENT FEATURES
CURRENT TEST COVERAGE
KNOWN ISSUES
RISKS
ASSUMPTIONS
RECOMMENDED ARCHITECTURE
MILESTONE PLAN
```

Then STOP.

Do not implement Milestone 1 until the audit is complete.

---

# MILESTONE 1 — FOUNDATION

Establish the application foundation.

Potential areas:

* Project structure
* Environment configuration
* Database connection
* Base application shell
* Error handling
* Logging
* Configuration system
* Testing infrastructure
* Basic CI checks if appropriate

Acceptance criteria:

* Application starts successfully.
* Database connection works.
* Test suite runs.
* Lint passes.
* Type checking passes.
* Production build passes.
* Environment validation works.
* No secrets are committed.
* Existing functionality remains intact.

STOP if any criterion fails.

---

# MILESTONE 2 — AUTHENTICATION AND MULTI-TENANCY

Implement:

* User authentication
* Clinic/organization
* User membership
* Roles
* Authorization
* Tenant isolation

Acceptance tests must prove:

```text
Clinic A cannot access Clinic B data.
Receptionist cannot perform owner/admin operations.
Unauthorized requests are rejected.
Authenticated requests work.
```

Do not continue until these tests pass.

---

# MILESTONE 3 — PATIENTS AND LEADS

Implement:

* Patient records
* Lead records
* Lead statuses
* Lead source
* Lead activity
* Notes
* Search/filter
* Lead detail screen

Test:

* CRUD
* Validation
* Authorization
* Tenant isolation
* Duplicate handling
* Activity recording

---

# MILESTONE 4 — COMMUNICATION ABSTRACTION

Implement the internal communication architecture.

Do not immediately depend on a single real provider throughout the system.

Create provider abstractions and a mock/test provider.

Test:

* Message creation
* Sending
* Failure handling
* Delivery status
* Provider errors
* Idempotency
* Logging

---

# MILESTONE 5 — WEBSITE LEAD CAPTURE

Implement a secure mechanism for external websites to create leads.

Potential implementation:

```text
Website
   ↓
Lead API
   ↓
Validation
   ↓
Lead
   ↓
Automation
```

Test:

* Valid lead
* Invalid lead
* Spam/rate limiting
* Duplicate requests
* Authentication where applicable
* Tenant identification
* Automation trigger

---

# MILESTONE 6 — INSTANT LEAD FOLLOW-UP

Implement:

```text
New Lead
   ↓
Automation
   ↓
Immediate acknowledgement
   ↓
Communication record
```

Test:

* Correct template
* Correct recipient
* Correct clinic
* Duplicate prevention
* Provider failure
* Retry behavior
* Patient response handling

---

# MILESTONE 7 — APPOINTMENTS

Implement:

* Appointment records
* Statuses
* Confirmation
* Cancellation
* Rescheduling
* No-show
* Rebooking
* Clinic timezone

Test all state transitions.

---

# MILESTONE 8 — APPOINTMENT REMINDERS

Implement:

```text
48h
24h
2h
```

with configurable automation.

Test:

* Correct timing
* Timezone
* Cancellation
* Rescheduling
* Duplicate prevention
* Failed messages
* Quiet hours
* Patient communication preferences

---

# MILESTONE 9 — NO-SHOW RECOVERY

Implement no-show workflow.

Test:

```text
Appointment
→ No-show
→ Message
→ Rebooking
→ Appointment
→ Automation stops
```

Also test:

* No response
* Duplicate events
* Manual closure
* Cancellation
* Rebooking through staff

---

# MILESTONE 10 — RECALL AUTOMATION

Implement:

* Recall eligibility
* Recall date
* Recall status
* Reminder sequence
* Rebooking
* Closure

Test date calculations and duplicate prevention.

---

# MILESTONE 11 — REVIEW REQUESTS

Implement configurable review requests.

Test:

* Eligibility
* Duplicate prevention
* Timing
* Opt-out/communication preferences
* Clinic-specific review URL
* Audit history

---

# MILESTONE 12 — MISSED-CALL INTEGRATION

Only begin after provider capabilities have been verified.

Research current official provider documentation before selecting implementation.

Implement:

```text
Incoming call
→ Call event
→ Missed call
→ Webhook
→ Verification
→ Idempotency
→ Lead
→ Automation
→ Message
```

Do not assume Bahrain supports every telephony/SMS feature.

Provider capabilities must be explicitly verified.

Test:

* Answered call
* Missed call
* Rejected call
* Duplicate webhook
* Invalid webhook
* Provider outage
* Unknown caller
* Existing patient
* Existing lead
* After-hours call

---

# MILESTONE 13 — WHATSAPP INTEGRATION

Only implement after current official WhatsApp/Meta/provider requirements have been verified.

Test:

* Template messaging
* Delivery
* Incoming response
* Webhook verification
* Duplicate webhook
* Opt-out
* Provider failure
* Conversation state

---

# MILESTONE 14 — OWNER DASHBOARD

Implement the owner dashboard.

Required metrics:

* Leads
* Lead responses
* Appointments
* Confirmations
* No-shows
* Rebookings
* Recall
* Messages
* Delivery
* Failures

Every metric must have a documented definition.

Verify dashboard calculations against database fixtures.

---

# MILESTONE 15 — RECEPTIONIST WORKSPACE

Design a workflow-oriented receptionist interface.

Prioritize:

* New leads
* Missed calls
* Patient replies
* Upcoming appointments
* No-shows
* Recall opportunities
* Tasks requiring action

The interface should minimize clicks.

Test usability manually.

---

# MILESTONE 16 — SETTINGS AND AUTOMATION CONFIGURATION

Implement:

* Message templates
* Reminder timing
* Recall settings
* Review settings
* Clinic hours
* Timezone
* Communication settings
* Provider configuration
* User permissions

Test that configuration changes affect automation correctly.

---

# MILESTONE 17 — OBSERVABILITY AND ADMIN TOOLS

Implement:

* Automation logs
* Communication logs
* Webhook logs
* Error logs
* Audit logs
* Failed jobs
* Retry mechanism
* Operational diagnostics

Sensitive information must not be unnecessarily exposed.

---

# MILESTONE 18 — SECURITY HARDENING

Perform a dedicated security review.

Check:

* Authentication
* Authorization
* Tenant isolation
* API security
* Webhooks
* Input validation
* Injection risks
* XSS
* CSRF where relevant
* Rate limiting
* Secrets
* Logs
* File uploads if any
* Dependency vulnerabilities
* Session handling
* Error exposure

Fix discovered issues before proceeding.

---

# MILESTONE 19 — PERFORMANCE AND RELIABILITY

Test:

* Database queries
* Large lead lists
* Large appointment lists
* Dashboard calculations
* Background jobs
* Automation execution
* Webhook processing
* Concurrent events
* Retry behavior

Identify obvious bottlenecks.

Do not prematurely optimize without evidence.

---

# MILESTONE 20 — END-TO-END PRODUCTION SCENARIOS

Create realistic scenarios.

### Scenario A — New lead

```text
Website lead
→ Lead created
→ Instant acknowledgement
→ Receptionist notified
→ Patient replies
→ Appointment booked
→ Reminder sequence
→ Appointment completed
→ Review request
```

### Scenario B — Missed call

```text
Patient calls
→ Clinic doesn't answer
→ Missed-call webhook
→ Lead created
→ Message sent
→ Patient responds
→ Appointment booked
```

### Scenario C — No-show

```text
Appointment
→ Patient doesn't attend
→ No-show
→ Recovery message
→ Patient rebooks
→ Workflow stops
```

### Scenario D — Recall

```text
Patient becomes overdue
→ Recall workflow
→ Message
→ Follow-up
→ Patient books
→ Recall closes
```

Every scenario must be tested end-to-end.

---

# MILESTONE 21 — UX REVIEW

Perform a dedicated UX audit.

Review:

* Navigation
* Information hierarchy
* Forms
* Tables
* Dashboard
* Empty states
* Loading states
* Error states
* Mobile responsiveness
* Accessibility
* Typography
* Consistency
* Confirmation flows
* Destructive actions
* Receptionist workflow

Fix UX problems before final production validation.

---

# MILESTONE 22 — PRODUCTION READINESS

Verify:

* Environment configuration
* Database migrations
* Backups strategy
* Logging
* Monitoring
* Error tracking
* Security
* Deployment
* Rollback strategy
* Provider configuration
* Webhook URLs
* Cron/background workers
* Email/SMS/WhatsApp configuration
* Rate limits
* Documentation

Perform final production build and tests.

---

# MILESTONE 23 — FINAL ACCEPTANCE TEST

Run the entire test suite.

Run:

```text
Unit tests
Integration tests
E2E tests
Security tests
Type checking
Lint
Build
Database migration tests
Webhook tests
Automation tests
Tenant isolation tests
```

Then execute the complete end-to-end scenarios.

Only declare the project complete if all defined acceptance criteria pass.

---

# STRICT DEVELOPMENT LOOP

For EVERY milestone use this exact workflow:

```text
1. READ
2. UNDERSTAND
3. PLAN
4. IMPLEMENT
5. TEST
6. OBSERVE FAILURES
7. DEBUG
8. RETEST
9. REGRESSION TEST
10. REVIEW
11. VERIFY ACCEPTANCE CRITERIA
12. MARK MILESTONE PASSED
13. ONLY THEN MOVE FORWARD
```

Never skip steps 5–10.

---

# FAILURE PROTOCOL

If a test fails:

DO NOT proceed.

Instead:

```text
FAILED TEST
↓
REPRODUCE
↓
CAPTURE ACTUAL ERROR
↓
IDENTIFY ROOT CAUSE
↓
IMPLEMENT MINIMUM FIX
↓
RUN FAILED TEST AGAIN
↓
RUN RELATED TESTS
↓
RUN FULL MILESTONE REGRESSION
```

If the failure cannot be resolved:

Mark:

```text
BLOCKED
```

Explain:

* What failed
* Evidence
* Root cause if known
* What has been tried
* What remains
* Why progression is blocked

Do not hide the failure.

---

# CHANGE CONTROL

Avoid unrelated changes.

For each change explain internally:

```text
WHY IS THIS CHANGE REQUIRED?
WHAT COMPONENTS DOES IT AFFECT?
WHAT COULD IT BREAK?
WHAT TESTS COVER THE RISK?
```

Prefer small commits/changes.

Do not refactor unrelated code while implementing a milestone.

---

# DATABASE CHANGE CONTROL

For schema changes:

1. Create migration.
2. Verify migration.
3. Test fresh database.
4. Test existing database migration where possible.
5. Test rollback strategy where supported.
6. Run affected application tests.

Never manually alter production schema as a substitute for proper migrations.

---

# EXTERNAL SERVICES

Before implementing any external integration:

1. Identify provider.
2. Read current official documentation.
3. Verify supported countries.
4. Verify phone-number availability.
5. Verify SMS capability.
6. Verify inbound messaging.
7. Verify voice capability.
8. Verify webhooks.
9. Verify pricing only when relevant.
10. Verify authentication.
11. Verify rate limits.
12. Record limitations.

Never infer provider behavior from memory.

---

# NO FAKE INTEGRATIONS

During development, it is acceptable to use:

* Mock provider
* Sandbox
* Test credentials
* Local simulator

But clearly distinguish:

```text
MOCKED
SANDBOX
REAL INTEGRATION
```

Never claim a real integration works when only a mock works.

---

# STATUS REPORTING

At the end of every milestone, report:

```text
MILESTONE:
STATUS:

IMPLEMENTED:
- ...

TESTS:
- Unit: PASS/FAIL
- Integration: PASS/FAIL
- E2E: PASS/FAIL
- Lint: PASS/FAIL
- Typecheck: PASS/FAIL
- Build: PASS/FAIL
- Security checks: PASS/FAIL

BUGS FOUND:
- ...

BUGS FIXED:
- ...

KNOWN LIMITATIONS:
- ...

NOT VERIFIED:
- ...

ACCEPTANCE CRITERIA:
- [PASS] ...
- [PASS] ...
- [FAIL] ...

NEXT MILESTONE:
...
```

The next milestone may only begin if:

```text
STATUS: PASSED
```

and all mandatory acceptance criteria are PASS.

---

# IMPORTANT BEHAVIOR RULES

You must NOT:

* Guess.
* Invent.
* Pretend to have tested something.
* Claim completion without verification.
* Skip milestones.
* Move forward with failing tests.
* Disable tests to obtain a passing result.
* Delete tests because they expose bugs.
* Hide errors.
* Replace real integration with fake success.
* Add unnecessary dependencies.
* Perform unrelated refactoring.
* Change architecture without justification.
* Store secrets in source code.
* Assume telecom capabilities.
* Assume regulatory compliance.
* Assume external API behavior.
* Build features before their requirements are understood.

You MUST:

* Inspect first.
* Ask only genuinely blocking questions.
* Make reasonable, documented assumptions when non-blocking.
* Verify important assumptions.
* Test actual behavior.
* Debug actual failures.
* Maintain backwards compatibility where required.
* Preserve working functionality.
* Keep the architecture maintainable.
* Keep UX simple.
* Keep security central.
* Keep tenant isolation strict.
* Keep automation reliable and idempotent.

---

# DECISION RULE

When multiple technical approaches are possible:

Prefer the approach that is:

1. Reliable
2. Simple
3. Maintainable
4. Secure
5. Testable
6. Scalable enough for the expected product
7. Compatible with the existing codebase

Do NOT choose technology merely because it is fashionable.

---

# STARTING INSTRUCTION

Start with **MILESTONE 0 ONLY**.

Do not write production application code yet.

First inspect the entire repository and produce the project audit and proposed development plan.

After presenting the Milestone 0 audit, STOP.

Wait for the development workflow to continue only after Milestone 0 has been reviewed and accepted.

Remember:

**ONE MILESTONE AT A TIME.**

**NO NEXT MILESTONE UNTIL THE CURRENT MILESTONE IS FULLY TESTED AND PASSED.**

**NEVER CLAIM VERIFICATION WITHOUT ACTUAL VERIFICATION.**


# CONCRETE MVP SCOPE

## MVP OBJECTIVE

The MVP is a focused **Dental Patient Follow-Up & Appointment Automation Platform**.

Its purpose is to prove one commercial proposition:

> **A dental clinic can capture more opportunities and reduce appointment leakage by automatically responding to new enquiries, recovering missed calls, reminding patients, and following up on no-shows.**

The MVP is NOT a dental practice-management system.

The MVP must be small enough to build, test, deploy, and demonstrate to a real dental clinic.

---

# MVP USERS

The MVP supports three roles:

## 1. Clinic Owner

Can:

* View dashboard
* View leads
* View appointments
* View automation activity
* View communication results
* Configure basic clinic settings
* Configure message templates
* Manage clinic users

## 2. Receptionist

Can:

* View leads
* Add leads manually
* View patient/contact information
* Update lead status
* View appointments
* Confirm appointments
* Mark no-shows
* Rebook patients
* View patient communication history

## 3. System Administrator

Can:

* Manage organizations/clinics
* Manage users
* View system-level logs
* Manage integrations
* Diagnose failed automation/jobs

Do not build an elaborate admin panel for the MVP.

---

# MVP FEATURES

The MVP contains exactly these major product capabilities.

## MVP-1 — Authentication and Clinic Account

Implement:

* Login
* Logout
* Password reset if required by the selected authentication architecture
* Clinic/organization
* Users
* Roles
* Tenant isolation

The application must support multiple clinics architecturally, even if the first deployment contains only one clinic.

---

# MVP-2 — Lead Management

A lead represents a potential patient enquiry.

Lead fields:

* First name
* Last name
* Phone
* Email
* Requested service
* Source
* Status
* Assigned user
* Created date
* Last activity
* Notes

Initial lead statuses:

```text
NEW
CONTACTED
QUALIFIED
APPOINTMENT_BOOKED
LOST
CLOSED
```

Lead sources:

```text
WEBSITE
MISSED_CALL
MANUAL
OTHER
```

Required screens:

### Lead List

Display:

* Name
* Phone
* Source
* Status
* Created date
* Assigned user
* Last activity

Support:

* Search
* Status filter
* Source filter
* Date filter

### Lead Detail

Display:

* Contact information
* Lead information
* Status
* Notes
* Activity timeline
* Communication history
* Appointment information

---

# MVP-3 — Website Lead Capture

Provide a secure API endpoint that allows a dental clinic website to submit a lead.

Example:

```text
POST /api/leads
```

Conceptual payload:

```json
{
  "name": "Ahmed Ali",
  "phone": "+973XXXXXXXX",
  "email": "ahmed@example.com",
  "service": "Dental Implant",
  "source": "website"
}
```

The actual API contract should be determined by the implementation architecture.

When a valid lead arrives:

```text
Website
   ↓
Lead API
   ↓
Validate
   ↓
Create Lead
   ↓
Trigger Automation
   ↓
Send Acknowledgement
   ↓
Record Communication
```

Requirements:

* Validation
* Rate limiting
* Tenant identification
* Duplicate protection
* Error handling
* Logging
* Secure authentication/authorization appropriate for public lead submission

---

# MVP-4 — Instant Lead Acknowledgement

When a website lead is created:

Send an immediate configurable acknowledgement.

Example:

> Hi {{first_name}}, thank you for contacting {{clinic_name}}. Our team will get back to you shortly.

The message must be template-based.

The system must record:

* Template
* Recipient
* Provider
* Provider message ID if available
* Timestamp
* Status
* Related lead

The MVP may initially use a **mock communication provider** during development.

A real provider must be implemented only after provider capabilities are verified.

---

# MVP-5 — Missed-Call Recovery

The MVP must support the concept of:

```text
Missed Call
    ↓
Webhook
    ↓
Create/identify lead
    ↓
Send automated response
    ↓
Notify receptionist
```

However, the implementation must distinguish between:

```text
MOCK/SANDBOX TELEPHONY
```

and:

```text
REAL TELEPHONY PROVIDER
```

The MVP architecture must support a real provider through an abstraction layer.

Do not hard-code the entire application to one provider.

Required internal capability:

```text
handleIncomingCallEvent()
```

or an equivalent architecture.

Required event handling:

* Incoming call
* Answered call
* Missed call
* Rejected call
* Duplicate webhook
* Invalid webhook

The MVP must prevent duplicate lead creation and duplicate automated messages.

---

# MVP-6 — Appointment Management

The MVP does NOT need a complete dental scheduling system.

Implement only the information required for automation.

Appointment fields:

* Patient/lead
* Clinic
* Appointment date
* Appointment time
* Appointment status
* Service
* Assigned provider/dentist where appropriate
* Created timestamp
* Updated timestamp

Appointment statuses:

```text
SCHEDULED
CONFIRMED
CANCELLED
COMPLETED
NO_SHOW
RESCHEDULED
```

Required operations:

* Create
* View
* Edit
* Confirm
* Cancel
* Mark completed
* Mark no-show
* Rebook

---

# MVP-7 — Appointment Reminder Automation

Implement the initial reminder sequence:

```text
48 HOURS BEFORE
        ↓
24 HOURS BEFORE
        ↓
2 HOURS BEFORE
```

Each reminder must be configurable.

The system must NOT send a reminder if:

* Appointment is cancelled
* Appointment is completed
* Appointment is rescheduled and the old appointment is no longer active
* Communication is not permitted
* The relevant reminder has already been sent

The automation must be idempotent.

---

# MVP-8 — No-Show Recovery

When an appointment becomes:

```text
NO_SHOW
```

trigger:

```text
No-show message
        ↓
Rebooking option
        ↓
Follow-up
```

Initial workflow:

```text
NO_SHOW
   ↓
Immediate message
   ↓
Wait configured period
   ↓
Follow-up message
   ↓
Stop when rebooked
```

The MVP does not need an advanced workflow builder.

Use predefined workflow logic with configurable timing and templates.

---

# MVP-9 — Recall Automation

Implement a simple recall mechanism.

Required fields:

* Patient
* Recall type
* Due date
* Status
* Last contacted
* Appointment if rebooked

Initial statuses:

```text
DUE
CONTACTED
BOOKED
COMPLETED
CLOSED
```

Initial workflow:

```text
Patient becomes overdue
        ↓
Recall message
        ↓
Follow-up
        ↓
Patient books
        ↓
Recall closes
```

Do not build complex clinical recall logic in the MVP.

---

# MVP-10 — Communication Center

Create a simple communication history.

Every communication should be associated with the relevant:

* Clinic
* Patient/lead
* Appointment where applicable
* Automation
* Provider

Display:

* Direction
* Channel
* Message type
* Status
* Timestamp

Example:

```text
10:02 — OUTBOUND — SMS — Lead acknowledgement — Delivered

10:07 — INBOUND — SMS — Patient reply

10:08 — OUTBOUND — SMS — Receptionist follow-up
```

The MVP does not need to become a full messaging platform.

---

# MVP-11 — Automation Activity

Provide an internal automation log.

Display:

* Automation
* Trigger
* Patient/lead
* Status
* Scheduled time
* Execution time
* Result
* Error if failed

Statuses:

```text
SCHEDULED
RUNNING
COMPLETED
FAILED
CANCELLED
```

This is essential for debugging and customer support.

---

# MVP-12 — Owner Dashboard

Create a simple dashboard.

Required metrics:

### Leads

* New leads
* Contacted leads
* Leads converted to appointments

### Appointments

* Scheduled
* Confirmed
* Completed
* No-show
* Rebooked

### Communication

* Messages sent
* Delivered
* Failed
* Patient replies

### Recall

* Patients due
* Contacted
* Booked

Do not add dozens of analytics metrics.

Every metric must have an explicit calculation definition.

---

# MVP-13 — Basic Clinic Settings

Implement:

* Clinic name
* Logo if appropriate
* Phone number
* Email
* Address
* Timezone
* Business hours
* Communication settings
* Review URL
* Default message templates

Do not build a large configuration system.

---

# MVP-14 — Message Templates

Provide configurable templates for:

### Lead acknowledgement

### Missed-call response

### 48-hour appointment reminder

### 24-hour appointment reminder

### 2-hour appointment reminder

### No-show message

### No-show follow-up

### Recall message

### Review request

Templates should support basic variables such as:

```text
{{first_name}}
{{clinic_name}}
{{appointment_date}}
{{appointment_time}}
{{booking_link}}
{{clinic_phone}}
```

The template engine must safely handle missing variables.

---

# MVP-15 — Basic Review Request

After an eligible completed appointment:

```text
Appointment completed
        ↓
Wait configured period
        ↓
Send review request
```

The clinic can configure its review URL.

The system must prevent repeated review requests within the configured period.

---

# MVP-16 — Basic Notifications

Notify clinic staff when important events occur:

* New lead
* Missed call
* Patient reply
* Automation failure
* New appointment where applicable

Do not build a complex notification center for the MVP.

---

# MVP COMMUNICATION CHANNEL STRATEGY

The MVP must support a provider abstraction.

Conceptually:

```text
Application
     ↓
Communication Service
     ↓
Provider Interface
     ↓
SMS / WhatsApp / Voice Provider
```

During development:

```text
Mock Provider
```

must be available.

For production:

```text
Real Provider
```

must be explicitly tested.

Do not assume that a provider supports:

* Bahrain numbers
* Two-way SMS
* Caller ID
* Incoming SMS
* WhatsApp
* Call forwarding
* Call recording
* Voice webhooks

Verify each capability against current official provider documentation before implementation.

---

# MVP OUT OF SCOPE

The following features are explicitly OUT OF SCOPE for MVP.

Do not implement them unless specifically instructed later.

## Dental Clinical Features

* Dental charting
* Tooth chart
* X-ray management
* Imaging
* Treatment planning
* Clinical notes
* Prescription management
* Medical records
* Diagnosis
* Clinical decision support

## Practice Management

* Full billing
* Invoicing
* Insurance claims
* Accounting
* Payroll
* Inventory
* Procurement
* Supplier management
* Commission management

## Advanced Scheduling

* Multi-chair optimization
* Complex resource scheduling
* Room management
* Equipment scheduling
* Advanced dentist scheduling algorithms

## Advanced CRM

* Complex sales pipeline
* Marketing campaign builder
* Lead scoring AI
* Predictive analytics
* AI sales agent
* AI receptionist

## Advanced Automation

* Visual workflow builder
* Arbitrary branching workflow designer
* Hundreds of automation triggers
* Complex conditional rules engine

The MVP should use predefined workflows with configurable parameters.

## Advanced Communication

* Full call center
* Call recording
* Call transcription
* AI voice agent
* AI phone receptionist
* Call sentiment analysis
* Advanced conversational AI

## Marketing

* Email marketing campaigns
* Bulk SMS marketing
* Advertising management
* Social media management
* Campaign attribution platform

## Enterprise

* SSO
* SCIM
* Enterprise audit suite
* Complex organizational hierarchy
* White-labeling
* Multi-country billing
* Advanced enterprise reporting

These may be considered after MVP validation.

---

# MVP TECHNICAL ARCHITECTURE

The MVP should contain these conceptual layers:

```text
┌─────────────────────────────────────┐
│             WEB APPLICATION         │
│                                     │
│ Dashboard                           │
│ Leads                               │
│ Appointments                        │
│ Patients                            │
│ Automations                         │
│ Communication History               │
│ Settings                            │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│              API / SERVER           │
│                                     │
│ Authentication                      │
│ Authorization                       │
│ Leads                               │
│ Appointments                        │
│ Patients                            │
│ Automations                         │
│ Communications                      │
│ Webhooks                            │
└──────────────────┬──────────────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
    Database    Job Queue   Provider
                           Integrations
```

The actual architecture must be adapted to the existing repository after Milestone 0.

---

# MVP DATABASE DOMAIN

At minimum, expect concepts equivalent to:

```text
organizations
users
organization_members
patients
leads
appointments
communication_messages
automation_workflows
automation_runs
message_templates
provider_integrations
webhook_events
recalls
audit_logs
```

Do not blindly create these exact tables.

Inspect the existing application first.

Use appropriate normalization, constraints, indexes, foreign keys, and tenant isolation.

---

# MVP AUTOMATION REQUIREMENTS

All automation must satisfy:

### Idempotency

The same event must not produce duplicate actions.

### Cancellation awareness

Cancelled appointments must stop future reminders.

### Rescheduling awareness

Old appointment workflows must not continue after rescheduling.

### Timezone awareness

Automation must execute according to the clinic's configured timezone.

### Quiet hours

Do not send messages during configured prohibited hours.

### Retry handling

Temporary provider failures should be retried according to a controlled policy.

### Permanent failures

Permanent failures must be recorded and surfaced.

### Auditability

Every automation execution must be traceable.

---

# MVP ACCEPTANCE TESTS

The MVP is NOT considered complete until these scenarios pass.

## TEST 1 — WEBSITE LEAD

```text
Website submits lead
        ↓
Lead created
        ↓
Lead appears in dashboard
        ↓
Acknowledgement generated
        ↓
Communication recorded
```

Expected:

* One lead
* One acknowledgement
* No duplicate records

---

## TEST 2 — DUPLICATE WEBSITE REQUEST

Submit the same lead twice.

Expected:

* Duplicate handling follows the defined business rule.
* No duplicate automated acknowledgement.

---

## TEST 3 — MISSED CALL

Simulate:

```text
Incoming call
→ Missed
→ Webhook
```

Expected:

* Webhook authenticated
* Event stored
* Lead created/updated
* Message triggered once
* Receptionist notification generated

---

## TEST 4 — DUPLICATE WEBHOOK

Send the same webhook twice.

Expected:

```text
One business event
One automation
One message
```

---

## TEST 5 — APPOINTMENT REMINDERS

Create appointment 48+ hours in future.

Expected:

```text
48h reminder
24h reminder
2h reminder
```

Each exactly once.

---

## TEST 6 — CANCELLED APPOINTMENT

Schedule appointment.

Cancel it before reminder execution.

Expected:

```text
No future reminders.
```

---

## TEST 7 — RESCHEDULED APPOINTMENT

Schedule appointment.

Reschedule it.

Expected:

```text
Old reminder sequence cancelled.
New reminder sequence created.
```

No duplicate reminders.

---

## TEST 8 — NO-SHOW

Mark appointment as no-show.

Expected:

```text
Recovery message
→ Follow-up
→ Rebooking
→ Automation stops
```

---

## TEST 9 — RECALL

Create overdue patient.

Expected:

```text
Recall created
→ Recall message
→ Follow-up
→ Patient books
→ Recall closes
```

---

## TEST 10 — REVIEW REQUEST

Complete eligible appointment.

Expected:

```text
Review request
```

Second execution must not create a duplicate request inside the configured suppression period.

---

## TEST 11 — TENANT ISOLATION

Create:

```text
Clinic A
Clinic B
```

Create records for both.

Verify:

```text
Clinic A cannot access Clinic B data.
Clinic B cannot access Clinic A data.
```

This test is mandatory.

---

## TEST 12 — ROLE AUTHORIZATION

Verify:

```text
Owner
Receptionist
Administrator
```

have appropriate permissions.

Unauthorized actions must fail.

---

# MVP UX ACCEPTANCE

The MVP must be usable by a receptionist without technical training.

The following tasks must be straightforward:

1. Find a lead.
2. Add a lead.
3. View patient history.
4. See why a lead exists.
5. See whether the patient was contacted.
6. See whether the patient replied.
7. See the appointment.
8. Confirm an appointment.
9. Mark a no-show.
10. Rebook a patient.

The owner must be able to open the dashboard and understand the current situation without reading technical logs.

---

# MVP SUCCESS CRITERIA

The MVP is commercially meaningful if a clinic can use it to perform these workflows:

```text
NEW LEAD
→ AUTOMATIC RESPONSE
→ HUMAN FOLLOW-UP
→ APPOINTMENT
```

```text
MISSED CALL
→ AUTOMATIC RESPONSE
→ PATIENT RESPONSE
→ APPOINTMENT
```

```text
APPOINTMENT
→ 48H REMINDER
→ 24H REMINDER
→ 2H REMINDER
```

```text
NO-SHOW
→ AUTOMATIC RECOVERY
→ REBOOKING
```

```text
OVERDUE PATIENT
→ RECALL
→ REBOOKING
```

The owner can then see:

```text
How many leads came in?
How many were contacted?
How many booked?
How many confirmed?
How many no-showed?
How many were rebooked?
How many recall opportunities were recovered?
```

---

# MVP DEVELOPMENT ORDER

Use this exact milestone sequence unless repository constraints require a justified modification:

```text
M0  — Repository Audit
M1  — Foundation
M2  — Authentication + Multi-tenancy
M3  — Leads + Patients
M4  — Communication Abstraction
M5  — Website Lead Capture
M6  — Instant Lead Follow-up
M7  — Appointments
M8  — Appointment Reminders
M9  — No-show Recovery
M10 — Recall
M11 — Review Requests
M12 — Missed-call Integration
M13 — WhatsApp Integration
M14 — Owner Dashboard
M15 — Receptionist Workspace
M16 — Settings + Templates
M17 — Observability
M18 — Security Hardening
M19 — Performance + Reliability
M20 — End-to-End Testing
M21 — UX Review
M22 — Production Readiness
M23 — Final Acceptance
```

---

# STRICT MVP BOUNDARY

If a requested feature does not directly support:

```text
Lead Capture
Lead Follow-up
Missed-call Recovery
Appointment Reminders
No-show Recovery
Recall
Review Requests
Owner Visibility
```

it should be considered **post-MVP** unless it is required for security, reliability, infrastructure, or operation of the MVP.

Do not expand the MVP because a feature "might be useful."

Keep the first release narrow.

The objective is to produce a **working, testable, deployable product that can be demonstrated to and used by a real dental clinic**, not to reproduce an entire dental practice-management platform.
