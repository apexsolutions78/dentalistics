# FRONTEND PLANNING — DENTAL CLINIC AUTOMATION PLATFORM

## 1. PURPOSE

This document defines the exact frontend/UI/UX requirements for the Dental Clinic Automation Platform.

It is a companion to the main project `PLANNING.md`.

The main `PLANNING.md` defines:

* Product requirements
* Backend architecture
* Database
* APIs
* Integrations
* Automation
* Security
* Testing
* Development milestones

This document defines:

* Frontend architecture
* Application navigation
* Screens
* Layouts
* Components
* UX behavior
* Design system
* Responsive behavior
* Loading/error/empty states
* Role-specific interfaces
* Frontend acceptance criteria

Do not redesign the product scope in this document.

Do not introduce frontend features that are outside the approved MVP scope.

---

# 2. FRONTEND ROLE

Act as an expert:

* Senior frontend engineer
* Senior product designer
* UX/UI designer
* Design-system architect
* Accessibility specialist
* Frontend QA engineer

The frontend must be designed and implemented as a production SaaS application for dental clinics.

The UI must prioritize:

1. Clarity
2. Speed
3. Simplicity
4. Usability
5. Reliability
6. Accessibility
7. Consistency
8. Maintainability

Do not optimize for visual complexity.

Do not create unnecessary screens.

Do not create decorative features that do not support clinic workflows.

---

# 3. PRIMARY FRONTEND USERS

The application has three primary roles.

## 3.1 Clinic Owner

Primary needs:

* Understand clinic communication performance
* See new leads
* See appointments
* Understand confirmations and no-shows
* See rebooking
* See recall opportunities
* Understand automation performance
* Configure clinic settings

The owner interface should emphasize:

```text
WHAT IS HAPPENING?
WHAT NEEDS ATTENTION?
WHAT RESULT IS BEING GENERATED?
```

---

## 3.2 Receptionist

Primary needs:

* See new leads
* Respond to patient activity
* See missed calls
* See patient replies
* Manage appointments
* Confirm appointments
* Handle no-shows
* Rebook patients
* Handle recall opportunities

The receptionist interface should emphasize:

```text
WHO NEEDS ATTENTION?
WHAT HAPPENED?
WHAT SHOULD I DO NEXT?
```

---

## 3.3 Administrator

Primary needs:

* Manage clinic settings
* Manage users
* Manage permissions
* Configure communication providers
* Configure templates
* Configure automation settings
* Review operational logs where authorized

The administrator interface may expose more technical information than the receptionist interface.

---

# 4. FRONTEND APPLICATION STRUCTURE

The application should use a consistent application shell.

Conceptually:

```text
┌─────────────────────────────────────────────────────────┐
│ Header                                                  │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│ Sidebar      │ Main Content                             │
│              │                                          │
│ Dashboard    │ Page                                     │
│ Leads        │                                          │
│ Patients     │                                          │
│ Appointments │                                          │
│ Automations  │                                          │
│ Communic.    │                                          │
│ Recall       │                                          │
│ Settings     │                                          │
│              │                                          │
└──────────────┴──────────────────────────────────────────┘
```

The exact implementation must follow the existing project architecture after repository inspection.

Do not replace an existing frontend framework without justification.

---

# 5. PRIMARY NAVIGATION

The primary navigation should contain only approved MVP areas.

Recommended structure:

```text
Dashboard

Workspace

Leads
Patients
Appointments

Automations
Communications
Recall

Settings
```

The exact grouping may be adjusted after reviewing the existing application architecture.

Navigation must be role-aware.

Users must not see navigation items for features they cannot access.

Do not hide authorization failures merely through UI.

Backend authorization remains authoritative.

---

# 6. APPLICATION SHELL

## Sidebar

The sidebar should contain:

* Product/clinic identity
* Main navigation
* Current page indicator
* Settings
* User/account menu

The active navigation item must be visually obvious.

The sidebar should support a collapsed state if appropriate.

Do not make navigation unnecessarily complex.

---

## Header

The header should provide:

* Current page/context
* User account
* Notifications where applicable
* Clinic context where applicable

Avoid filling the header with unnecessary controls.

---

# 7. DESIGN SYSTEM

Create a reusable frontend design system rather than styling every page independently.

The design system should define:

## Typography

Use a clear, modern, highly readable type hierarchy.

Define:

* Page title
* Section title
* Card title
* Body text
* Secondary text
* Labels
* Captions
* Table text
* Error text

Do not use excessive font sizes.

---

## Spacing

Use a consistent spacing scale.

Do not manually invent different spacing values throughout the application unless required by the design system.

---

## Buttons

Define consistent variants:

```text
Primary
Secondary
Tertiary/Ghost
Danger
```

Buttons must clearly communicate their action.

Examples:

```text
Add Lead
Book Appointment
Confirm
Rebook
Cancel
Mark No-show
Save
```

Destructive actions must require appropriate confirmation.

---

## Inputs

Standardize:

* Text inputs
* Phone inputs
* Email inputs
* Selects
* Date inputs
* Time inputs
* Search
* Text areas
* Checkboxes
* Toggles

Every form control should have:

* Label
* Validation state
* Error state
* Disabled state
* Loading/submitting state where appropriate

---

## Status Badges

Use consistent statuses throughout the application.

Examples:

```text
NEW
CONTACTED
QUALIFIED
APPOINTMENT_BOOKED
LOST
CLOSED

SCHEDULED
CONFIRMED
CANCELLED
COMPLETED
NO_SHOW
RESCHEDULED

DUE
CONTACTED
BOOKED
COMPLETED
CLOSED
```

Status colors must not be the only way information is communicated.

---

# 8. DASHBOARD

## Route

Conceptually:

```text
/dashboard
```

The dashboard is primarily for clinic owners.

It must provide a fast overview of clinic communication and appointment activity.

---

## Dashboard layout

Recommended structure:

```text
Page Header
    ↓
Date Range / Context
    ↓
Key Metrics
    ↓
Lead Performance
    ↓
Appointment Performance
    ↓
No-show / Rebooking
    ↓
Recall
    ↓
Communication Activity
```

---

## Key metric cards

Initial metrics:

```text
New Leads
Appointments Booked
Confirmed Appointments
No-shows
Rebooked
Recall Opportunities
```

Do not display dozens of metrics.

Each metric must have a clear label.

Where useful, display:

* Current value
* Comparison period
* Trend

Do not display a trend unless the underlying calculation is actually available.

---

## Dashboard actions

Where appropriate, clicking a metric should take the user to the relevant filtered list.

Example:

```text
No-shows: 8
       ↓
Appointments
filter = NO_SHOW
```

The dashboard should be actionable rather than purely informational.

---

# 9. RECEPTIONIST WORKSPACE

## Purpose

The receptionist workspace is the primary operational interface.

Conceptually:

```text
/workspace
```

The screen should answer:

> What needs attention right now?

---

## Priority sections

Recommended order:

### 1. New Leads

Display:

* Patient name
* Contact method
* Source
* Requested service
* Created time
* Status
* Last activity
* Primary action

---

### 2. Missed Calls

Display:

* Caller
* Time
* Status
* Whether automated message was sent
* Whether patient replied
* Primary action

---

### 3. Patient Replies

Display:

* Patient
* Message preview
* Related lead/appointment
* Time
* Response status
* Primary action

---

### 4. Upcoming Appointments

Display:

* Patient
* Appointment time
* Service
* Confirmation status
* Required action

---

### 5. No-shows

Display:

* Patient
* Appointment
* No-show time
* Recovery status
* Rebooking action

---

### 6. Recall Opportunities

Display:

* Patient
* Recall type
* Due date
* Last contact
* Status
* Booking action

---

# 10. LEADS

## Lead List

Conceptual route:

```text
/leads
```

The lead list must support:

* Search
* Status filter
* Source filter
* Date filter
* Assigned-user filter where applicable

Columns:

```text
Patient
Phone
Source
Requested Service
Status
Assigned To
Created
Last Activity
```

Do not display excessive columns.

---

## Lead Detail

Conceptual route:

```text
/leads/:id
```

Recommended structure:

```text
Lead Header
    ↓
Contact Information
    ↓
Lead Information
    ↓
Current Status
    ↓
Primary Actions
    ↓
Appointment
    ↓
Communication Timeline
    ↓
Activity Timeline
    ↓
Notes
```

Primary actions may include:

```text
Contact
Book Appointment
Change Status
Add Note
```

The exact actions depend on the lead state.

---

## Lead activity timeline

Display meaningful events such as:

```text
Lead created
Message sent
Message delivered
Patient replied
Appointment booked
Appointment confirmed
Appointment cancelled
No-show
Lead status changed
```

Do not expose raw technical logs to ordinary clinic users.

---

# 11. PATIENTS

## Patient List

Conceptual route:

```text
/patients
```

Support:

* Search
* Phone search
* Name search
* Basic filtering where useful

Do not turn this into a full electronic medical record interface.

---

## Patient Profile

Conceptual route:

```text
/patients/:id
```

Recommended structure:

```text
Patient Header
    ↓
Contact Information
    ↓
Current Appointment
    ↓
Appointment History
    ↓
Communication History
    ↓
Lead History
    ↓
Recall Status
```

Do not add:

* Dental charting
* Tooth chart
* Clinical notes
* X-ray management
* Diagnosis
* Treatment planning
* Medical records

Those are outside this application's scope.

---

# 12. APPOINTMENTS

## Appointment List

Conceptual route:

```text
/appointments
```

Provide:

* Date
* Patient
* Time
* Service
* Status
* Assigned provider where applicable

Support appropriate date/status filtering.

---

## Appointment Detail

Conceptual route:

```text
/appointments/:id
```

Display:

```text
Patient
Date
Time
Service
Status
Communication history
Automation status
```

Primary actions:

```text
Confirm
Cancel
Reschedule
Mark Completed
Mark No-show
Rebook
```

Actions must respect the current appointment state.

---

## Calendar

A calendar view may be implemented if it materially improves appointment management.

Do not build a complex resource-management scheduling system.

The MVP does not require:

* Multi-chair optimization
* Complex room allocation
* Equipment scheduling
* Advanced resource management

---

# 13. AUTOMATIONS

## Automation Overview

Conceptual route:

```text
/automations
```

The MVP should display predefined workflows such as:

```text
Lead acknowledgement
Appointment reminders
No-show recovery
Recall
Review request
Missed-call recovery
```

Each automation should display:

* Name
* Status
* Description
* Enabled/disabled
* Recent activity

---

## Automation Detail

Display:

```text
Trigger
    ↓
Conditions
    ↓
Actions
    ↓
Delays
    ↓
Recent executions
```

The MVP does NOT require a visual drag-and-drop workflow builder.

Do not build an advanced workflow designer unless specifically authorized.

---

# 14. AUTOMATION ACTIVITY

Provide an operational view of automation execution.

Display:

```text
Automation
Patient
Trigger
Status
Scheduled
Executed
Result
```

Statuses:

```text
SCHEDULED
RUNNING
COMPLETED
FAILED
CANCELLED
```

Clinic users should see understandable explanations.

Technical errors should be available to authorized administrators without exposing unnecessary implementation details.

---

# 15. COMMUNICATIONS

## Communication List

Conceptual route:

```text
/communications
```

Display:

* Patient
* Channel
* Message type
* Direction
* Status
* Timestamp

Channels may include:

```text
SMS
WhatsApp
Voice
Email
```

Only show channels that are actually configured/available.

---

## Communication Detail

Display:

```text
Patient
Channel
Message
Status
Timestamp
Related lead
Related appointment
Related automation
```

Statuses may include:

```text
QUEUED
SENT
DELIVERED
FAILED
RECEIVED
```

Do not expose provider-specific technical details to ordinary users unless useful.

---

# 16. PATIENT COMMUNICATION TIMELINE

Where communications are shown, use a clear chronological timeline.

Example:

```text
Today

10:42
Patient replied:
"Can I come tomorrow?"

10:40
Clinic sent:
"Hi Sarah, your appointment..."

Yesterday

09:00
Appointment reminder sent
```

Clearly distinguish:

* Incoming
* Outgoing
* Automated
* Manual

The timeline should make patient history understandable without reading technical logs.

---

# 17. RECALL

## Recall List

Conceptual route:

```text
/recall
```

Display:

* Patient
* Recall type
* Due date
* Last contacted
* Status
* Primary action

Statuses:

```text
DUE
CONTACTED
BOOKED
COMPLETED
CLOSED
```

---

## Recall Detail

Display:

```text
Patient
Recall type
Due date
Communication history
Appointment
Current status
```

Primary actions:

```text
Contact
Book Appointment
Close Recall
```

---

# 18. SETTINGS

Settings should be organized into understandable categories.

Recommended:

```text
Clinic
Users
Communication
Templates
Appointments
Recall
Reviews
Automation
```

Do not expose internal technical configuration unnecessarily.

---

## Clinic Settings

Fields may include:

* Clinic name
* Logo
* Phone
* Email
* Address
* Timezone
* Business hours

---

## Communication Settings

Display configured communication providers and channels.

Clearly distinguish:

```text
Connected
Not connected
Configuration required
Error
```

Never display API secrets.

---

## Template Settings

Allow authorized users to manage approved message templates.

Available template types:

```text
Lead acknowledgement
Missed-call response
48-hour reminder
24-hour reminder
2-hour reminder
No-show message
No-show follow-up
Recall message
Review request
```

Supported variables should be clearly documented.

Example:

```text
{{first_name}}
{{clinic_name}}
{{appointment_date}}
{{appointment_time}}
{{booking_link}}
{{clinic_phone}}
```

Provide safe template preview functionality.

---

# 19. MESSAGE TEMPLATE UX

Template editor should include:

```text
Template Name
Message Content
Available Variables
Preview
Save
Cancel
```

If a variable is invalid, clearly identify it.

Do not silently save broken templates.

Show a realistic preview using sample data.

---

# 20. NOTIFICATIONS

Notifications should be limited to useful operational events.

Examples:

```text
New lead
Missed call
Patient reply
Automation failure
New appointment
```

Avoid creating a complicated notification center in the MVP.

---

# 21. SEARCH

Search should be fast and predictable.

Where applicable, support:

* Patient name
* Phone number
* Lead name
* Appointment
* Communication history

Search results should clearly identify what was found.

Avoid a global search system until the underlying entities justify it.

---

# 22. FILTERING

Filters should be:

* Easy to understand
* Persistent during navigation where appropriate
* Resettable
* Clearly visible when active

Example:

```text
Status: No-show
Date: Last 30 days
Source: Website
```

Provide a clear reset option.

---

# 23. FORMS

All forms must:

* Use clear labels
* Validate input
* Show errors next to relevant fields
* Preserve valid input when validation fails
* Prevent accidental duplicate submission
* Show loading state during submission
* Show success feedback
* Show meaningful failure feedback

Never clear a completed form merely because a request failed.

---

# 24. LOADING STATES

Every asynchronous screen must have an intentional loading state.

Use:

* Skeletons
* Loading indicators
* Disabled submitting buttons

Avoid displaying blank pages while data loads.

Do not overuse spinners.

---

# 25. EMPTY STATES

Every list must have an intentional empty state.

Examples:

### No Leads

```text
No leads yet.

New website enquiries and manually added leads
will appear here.
```

Provide an appropriate action if applicable.

### No Appointments

```text
No appointments found.
```

### No Recall

```text
No recall opportunities currently require attention.
```

Empty states should explain what the user is seeing.

---

# 26. ERROR STATES

Errors must be understandable to clinic staff.

Bad:

```text
500 Internal Server Error
```

Better:

```text
We couldn't load the appointments.

Please try again.
```

Where appropriate provide:

```text
Retry
```

Technical details may be available to administrators.

Never expose stack traces to ordinary users.

---

# 27. SUCCESS FEEDBACK

After successful actions provide clear confirmation.

Examples:

```text
Lead created
Appointment confirmed
Patient rebooked
Template saved
Recall closed
```

Feedback should be visible but not disruptive.

Avoid excessive toast notifications.

---

# 28. DESTRUCTIVE ACTIONS

Require confirmation for meaningful destructive actions.

Examples:

```text
Delete
Close
Cancel appointment
Close recall
Disable automation
```

Confirmation should explain the consequence.

Example:

```text
Cancel appointment?

The patient will no longer receive reminders
for this appointment.

Cancel appointment
Keep appointment
```

Do not use confirmation dialogs for trivial actions.

---

# 29. RESPONSIVE DESIGN

The application is desktop-first but must be responsive.

Desktop is the primary environment for:

* Clinic owners
* Receptionists
* Administrators

Responsive behavior must support smaller screens.

On smaller screens:

* Sidebar may collapse
* Tables may become cards or horizontally scroll where appropriate
* Forms should become single-column
* Primary actions remain accessible
* Important information remains visible

Do not simply shrink the desktop UI.

---

# 30. ACCESSIBILITY

The frontend must target practical WCAG-aligned accessibility.

Requirements include:

* Keyboard navigation
* Visible focus states
* Semantic HTML
* Proper labels
* Accessible form errors
* Sufficient contrast
* Meaningful button labels
* Screen-reader-friendly status information
* Do not rely solely on color
* Dialog focus management
* Logical heading hierarchy

Accessibility must be tested during the UX milestone.

---

# 31. TABLE DESIGN

Tables should prioritize useful information.

Requirements:

* Clear headers
* Consistent alignment
* Readable density
* Sorting where useful
* Filtering where useful
* Pagination where necessary
* Loading state
* Empty state
* Error state

Do not create tables with excessive columns.

On smaller screens, use an appropriate responsive representation.

---

# 32. DETAIL DRAWERS VS PAGES

Use detail drawers/modals only when the task is lightweight and users benefit from staying in context.

Use dedicated pages when:

* The record contains substantial information
* Multiple sections are required
* Users need a persistent URL
* The workflow is complex

Do not use modals for entire applications.

---

# 33. UX FOR AUTOMATED COMMUNICATION

Every automated action shown in the UI must clearly communicate:

```text
What happened?
Why did it happen?
When did it happen?
What was sent?
Was it delivered?
What happens next?
```

Example:

```text
Appointment reminder

Sent today at 10:00 AM
Delivered

Next reminder:
Tomorrow at 10:00 AM
```

This is important for receptionist trust.

---

# 34. UX FOR FAILED AUTOMATIONS

When automation fails, show understandable information.

Example:

```text
Reminder failed

Patient: Sarah Ahmed
Appointment: 14 October, 3:00 PM

Reason:
Message provider rejected the request.

Action:
Retry
```

Do not show raw provider errors to ordinary users unless necessary.

---

# 35. UX FOR PATIENT REPLIES

When a patient replies:

```text
PATIENT REPLIED
        ↓
Receptionist sees notification
        ↓
Opens patient/lead
        ↓
Reads conversation
        ↓
Sees related appointment
        ↓
Takes action
```

The interface should make the relationship between:

```text
Patient
Lead
Appointment
Communication
Automation
```

obvious.

---

# 36. VISUAL DESIGN DIRECTION

The product should look like a professional healthcare SaaS application.

Design characteristics:

* Clean
* Calm
* Modern
* Professional
* Trustworthy
* Spacious
* High readability
* Restrained visual hierarchy

Avoid:

* Excessive gradients
* Excessive glass effects
* Overly animated interfaces
* Gaming-style dashboards
* Excessive colors
* Decorative illustrations that distract from workflow
* Generic AI-product aesthetics

The UI should feel like a serious operational tool.

---

# 37. COMPONENT ARCHITECTURE

Build reusable components.

Examples:

```text
AppShell
Sidebar
Header
PageHeader
MetricCard
DataTable
SearchInput
FilterBar
StatusBadge
EmptyState
ErrorState
LoadingState
ConfirmDialog
FormField
DatePicker
TimePicker
PatientCard
LeadCard
AppointmentCard
Timeline
MessageBubble
AutomationStatus
Notification
```

Do not duplicate components unnecessarily.

Use the project's existing component system if one exists.

---

# 38. FRONTEND DATA HANDLING

The frontend must respect backend API contracts.

Do not:

* Duplicate business logic unnecessarily
* Reimplement authorization rules
* Assume API responses
* Hard-code database behavior
* Fake successful requests

Handle:

```text
Loading
Success
Empty
Validation Error
Authorization Error
Not Found
Server Error
Network Error
```

appropriately.

---

# 39. FRONTEND SECURITY

Never trust frontend authorization.

The UI may hide inaccessible actions, but backend authorization must remain authoritative.

Never expose:

* API secrets
* Provider credentials
* Private keys
* Internal credentials
* Sensitive debug information

Do not place sensitive information into client-side code unnecessarily.

---

# 40. FRONTEND PERFORMANCE

Prioritize:

* Fast initial load
* Efficient data fetching
* Avoiding unnecessary requests
* Pagination for large datasets
* Appropriate caching
* Lazy loading where justified
* Efficient rendering

Do not prematurely optimize.

Measure before making complex performance changes.

---

# 41. FRONTEND MILESTONE INTEGRATION

Frontend work must follow the main project's milestone system.

Frontend implementation should occur alongside the relevant backend milestone.

Do not wait until the end to build the entire UI.

Recommended mapping:

```text
M1  → Application shell / foundation
M2  → Authentication / tenant-aware UI
M3  → Leads + Patients UI
M4  → Communication UI foundation
M5  → Website lead capture UI
M6  → Lead follow-up activity UI
M7  → Appointment UI
M8  → Reminder status UI
M9  → No-show/rebooking UI
M10 → Recall UI
M11 → Review request UI
M12 → Missed-call UI
M13 → WhatsApp communication UI
M14 → Owner Dashboard
M15 → Receptionist Workspace
M16 → Settings / Templates
M17 → Operational/automation UI
M18 → Security UI review
M19 → Performance review
M20 → End-to-end UI scenarios
M21 → Dedicated UX audit
M22 → Production frontend readiness
M23 → Final frontend acceptance
```

---

# 42. FRONTEND ACCEPTANCE CRITERIA

A frontend milestone cannot be marked complete merely because the page renders.

The following must be verified where applicable:

### Functional

* Correct API integration
* Correct data displayed
* Correct actions
* Correct navigation
* Correct state transitions
* Correct permissions

### UX

* Clear hierarchy
* Understandable actions
* Appropriate loading states
* Appropriate empty states
* Appropriate error states
* Appropriate success feedback
* No confusing dead ends

### Responsive

* Desktop
* Tablet where applicable
* Mobile behavior

### Accessibility

* Keyboard navigation
* Focus states
* Labels
* Semantic structure
* Error communication
* Color-independent status communication

### Quality

* No console errors
* No broken routes
* No obvious layout defects
* No unnecessary duplicate components
* No hard-coded fake data in production flows

---

# 43. FRONTEND TESTING

Where the project supports it, use:

* Unit tests
* Component tests
* Integration tests
* End-to-end tests
* Accessibility checks
* Visual/manual review

Test important workflows rather than only individual components.

---

# 44. REQUIRED FRONTEND END-TO-END SCENARIOS

## Scenario 1 — New Lead

```text
Open application
→ Lead appears
→ Open lead
→ View source
→ View patient information
→ View acknowledgement
→ View communication history
→ Book appointment
```

Verify the entire UI flow is understandable.

---

## Scenario 2 — Missed Call

```text
Open Workspace
→ See missed call
→ Open patient/lead
→ See automated response
→ See patient reply
→ Book appointment
```

---

## Scenario 3 — Appointment

```text
Open appointment
→ Confirm
→ See confirmation state
→ View reminder status
→ Reschedule
→ Verify UI reflects new appointment state
```

---

## Scenario 4 — No-show

```text
Appointment
→ Mark No-show
→ View recovery status
→ Patient rebooks
→ View new appointment
→ Verify recovery workflow state
```

---

## Scenario 5 — Recall

```text
Open Recall
→ Find overdue patient
→ Open recall
→ View communication history
→ Book appointment
→ Verify recall becomes BOOKED
```

---

# 45. UX REVIEW GATE

Before M21 can be marked PASSED, perform a dedicated UX review.

Review every primary workflow:

```text
Login
Dashboard
Workspace
Lead
Patient
Appointment
No-show
Recall
Communication
Automation
Settings
```

For each workflow ask:

```text
Can a new receptionist understand this?
Can they identify the next action?
Can they complete the task without unnecessary steps?
Are errors understandable?
Is important information visible?
Is the interface consistent?
```

Any blocking usability problem must be fixed before M21 passes.

---

# 46. FRONTEND CHANGE CONTROL

Before implementing a new UI feature, determine:

```text
Does this feature exist in the approved MVP scope?
Does it support an approved workflow?
Does it require backend/API changes?
Does it affect existing screens?
Does it introduce a new design pattern?
Does it create additional maintenance?
```

If it is outside MVP scope:

```text
DO NOT IMPLEMENT
```

unless explicitly authorized.

---

# 47. NO PLACEHOLDER PRODUCT UI

Do not leave major production screens as:

```text
Coming Soon
Lorem ipsum
Fake statistics
Fake patient records
Fake communication results
Fake automation statuses
```

Mock data may be used for development/testing, but it must be clearly separated from production behavior.

Never present mock data as real application data.

---

# 48. NO GENERIC ADMIN DASHBOARD

Do not create a generic SaaS dashboard containing arbitrary cards such as:

```text
Users
Revenue
Traffic
System Activity
Random Statistics
```

unless those metrics are explicitly required.

The dashboard must represent the actual dental clinic communication workflow.

---

# 49. FRONTEND DEFINITION OF DONE

A frontend feature is complete only when:

* UI implemented
* Correct API integration implemented
* Loading state implemented
* Empty state implemented where applicable
* Error state implemented
* Success state implemented where applicable
* Permissions respected
* Responsive behavior checked
* Accessibility checked
* Relevant tests pass
* No console errors
* No known blocking UI defects
* Acceptance criteria satisfied

If any required item is incomplete:

```text
FRONTEND STATUS = NOT PASSED
```

Do not move to the next milestone.

---

# 50. FINAL FRONTEND PRINCIPLE

The frontend must make the product's value obvious.

A clinic user should be able to understand:

```text
New lead
    ↓
Response
    ↓
Appointment
    ↓
Confirmation
    ↓
Attendance
    ↓
Review / Recall
```

The UI should make this operational journey easy to understand and act upon.

The application is not primarily a database interface.

It is a **patient communication and appointment-recovery workflow tool for dental clinics**.

Every frontend decision should support that purpose.


# 1. SCREEN INVENTORY

This section is authoritative for the MVP frontend.

The application must contain the screens listed below unless a screen is explicitly marked as conditional.

Do not create additional product screens without a clear MVP requirement.

Each screen must have:

* Defined purpose
* Defined user role
* Defined route
* Defined primary actions
* Loading state
* Empty state where applicable
* Error state
* Permission handling
* Responsive behavior
* Accessibility considerations

---

## A. AUTHENTICATION SCREENS

### A1. Login

**Route**

```text
/login
```

**Users**

* Owner
* Receptionist
* Administrator

**Purpose**

Allow authorized users to access their clinic workspace.

**Required UI**

* Email/username
* Password
* Show/hide password
* Sign in
* Forgot password
* Loading state
* Authentication error

**Do not add**

* Social login unless explicitly required
* Unnecessary onboarding fields

---

### A2. Forgot Password

**Route**

```text
/forgot-password
```

**Purpose**

Allow users to request password recovery.

**Required UI**

* Email
* Submit
* Success state
* Invalid email state
* Rate-limit/error state

---

### A3. Reset Password

**Route**

```text
/reset-password
```

**Required UI**

* New password
* Confirm password
* Password requirements
* Submit
* Success state
* Invalid/expired token state

---

# B. APPLICATION SHELL

These are not independent business screens but are required application-level UI.

### B1. Main Application Shell

**Authenticated routes**

```text
/dashboard
/workspace
/leads
/patients
/appointments
/automations
/communications
/recall
/settings/*
```

**Contains**

* Sidebar
* Header
* Clinic identity
* User menu
* Navigation
* Main content area
* Responsive navigation

---

### B2. User Account Menu

**Accessed from**

Application header.

**Required actions**

* User information
* Account settings where applicable
* Sign out

Do not create a separate account-management system unless required.

---

# C. OWNER SCREENS

## C1. Owner Dashboard

**Route**

```text
/dashboard
```

**Primary user**

Clinic Owner

**Purpose**

Provide an immediate overview of clinic communication and appointment performance.

**Required sections**

* New leads
* Lead responses
* Appointments booked
* Confirmations
* No-shows
* Rebookings
* Recall opportunities
* Recall bookings
* Communication activity
* Delivery/failure information where available

**Primary actions**

* Open leads
* Open appointments
* Open no-shows
* Open recall
* Open communication activity

---

# D. RECEPTIONIST WORKSPACE

## D1. Receptionist Workspace

**Route**

```text
/workspace
```

**Primary users**

* Receptionist
* Owner

**Purpose**

Provide a prioritized operational queue.

**Required sections**

1. New leads
2. Missed calls
3. Patient replies
4. Upcoming appointments
5. No-shows
6. Recall opportunities

**Primary principle**

The receptionist should immediately understand:

```text
What needs attention?
Why does it need attention?
What should I do?
```

---

# E. LEAD SCREENS

## E1. Lead List

**Route**

```text
/leads
```

**Users**

* Owner
* Receptionist
* Administrator where appropriate

**Required functionality**

* Search
* Status filter
* Source filter
* Date filter
* Assigned-user filter where applicable
* Pagination where necessary

**Required columns**

* Patient
* Phone
* Source
* Requested service
* Status
* Assigned user
* Created
* Last activity

---

## E2. Create Lead

**Route**

```text
/leads/new
```

**Purpose**

Allow receptionist/staff to manually create a lead.

**Required fields**

* First name
* Last name
* Phone
* Email where applicable
* Requested service
* Source
* Notes where applicable

**Required behavior**

After creation:

```text
Lead created
→ Lead detail
→ Appropriate automation
```

Do not send an automated message merely because the form was submitted unless the backend determines that the lead qualifies for the workflow.

---

## E3. Lead Detail

**Route**

```text
/leads/:id
```

**Required sections**

* Lead header
* Contact information
* Lead information
* Status
* Notes
* Appointment
* Communication timeline
* Activity timeline

**Primary actions**

* Contact
* Change status
* Add note
* Book appointment
* Open patient

---

## E4. Edit Lead

**Route**

```text
/leads/:id/edit
```

May alternatively be implemented as an inline edit or drawer if the existing architecture supports it.

**Editable information**

* Contact details
* Requested service
* Status
* Assigned user
* Notes

---

# F. PATIENT SCREENS

## F1. Patient List

**Route**

```text
/patients
```

**Required functionality**

* Search by name
* Search by phone
* Basic filtering where useful

**Required information**

* Patient
* Phone
* Email where available
* Last appointment
* Next appointment
* Recall status where applicable

Do not turn this screen into a clinical medical-record interface.

---

## F2. Patient Detail

**Route**

```text
/patients/:id
```

**Required sections**

* Patient header
* Contact information
* Current appointment
* Appointment history
* Lead history
* Communication history
* Recall status

**Primary actions**

* Book appointment
* Contact
* Open lead
* Open appointment
* Manage recall where applicable

---

## F3. Edit Patient

**Route**

```text
/patients/:id/edit
```

**Purpose**

Edit basic patient/contact information.

This screen must NOT include:

* Diagnosis
* Clinical notes
* Treatment plans
* Dental chart
* X-rays
* Prescriptions
* Clinical records

---

# G. APPOINTMENT SCREENS

## G1. Appointment List

**Route**

```text
/appointments
```

**Required functionality**

* Date filtering
* Status filtering
* Patient search
* Appointment search where applicable

**Required information**

* Patient
* Date
* Time
* Service
* Status
* Assigned provider where applicable

---

## G2. Appointment Calendar

**Route**

```text
/appointments/calendar
```

**Status**

Conditional MVP screen.

Implement only if it materially improves the appointment workflow and is compatible with the existing application architecture.

The calendar must NOT become a complex resource-management system.

Do not implement:

* Chair optimization
* Room optimization
* Equipment scheduling
* Complex resource allocation

---

## G3. Create Appointment

**Route**

```text
/appointments/new
```

**Required fields**

* Patient
* Date
* Time
* Service
* Assigned provider where applicable

**Required behavior**

On creation:

```text
Appointment created
→ Correct appointment status
→ Reminder automation scheduled
```

---

## G4. Appointment Detail

**Route**

```text
/appointments/:id
```

**Required sections**

* Patient
* Date
* Time
* Service
* Status
* Communication history
* Automation status

**Primary actions**

* Confirm
* Cancel
* Reschedule
* Mark completed
* Mark no-show
* Rebook

Actions must respect appointment state.

---

## G5. Reschedule Appointment

**Route**

```text
/appointments/:id/reschedule
```

May be implemented as a modal/drawer where appropriate.

**Required behavior**

```text
Old appointment
→ Rescheduled
→ Old reminder sequence cancelled
→ New reminder sequence created
```

The UI must clearly show the new appointment information.

---

## G6. Rebook Appointment

May be implemented as a dedicated screen, drawer, or modal.

**Purpose**

Provide a fast rebooking flow for:

* No-shows
* Cancelled appointments
* Recall patients
* Leads

The preferred UX is a short workflow rather than a large form.

---

# H. AUTOMATION SCREENS

## H1. Automation Overview

**Route**

```text
/automations
```

**Required workflows**

* Lead acknowledgement
* Appointment reminders
* No-show recovery
* Recall
* Review requests
* Missed-call recovery
* WhatsApp workflows where enabled

**Required information**

* Automation name
* Description
* Enabled/disabled state
* Recent activity

---

## H2. Automation Detail

**Route**

```text
/automations/:id
```

**Required information**

* Trigger
* Eligibility
* Actions
* Delays
* Current configuration
* Recent executions

The MVP does NOT require a visual workflow builder.

---

## H3. Automation Activity

**Route**

```text
/automations/activity
```

**Required information**

* Automation
* Patient
* Trigger
* Status
* Scheduled time
* Execution time
* Result
* Error where applicable

**Statuses**

```text
SCHEDULED
RUNNING
COMPLETED
FAILED
CANCELLED
```

---

## H4. Automation Run Detail

**Route**

```text
/automations/activity/:id
```

**Purpose**

Allow authorized users to understand why an automation succeeded, failed, or was cancelled.

**Required information**

* Trigger
* Patient/lead
* Related appointment
* Workflow
* Actions attempted
* Message status
* Timing
* Result
* Error information where appropriate

Technical provider details should only be exposed to authorized users.

---

# I. COMMUNICATION SCREENS

## I1. Communication Center

**Route**

```text
/communications
```

**Required functionality**

* Search
* Patient filter
* Channel filter
* Status filter
* Date filter

**Required information**

* Patient
* Channel
* Direction
* Message type
* Status
* Timestamp

---

## I2. Conversation / Communication Detail

**Route**

```text
/communications/:id
```

Where the underlying communication model supports conversation-level navigation, use a conversation route instead.

**Required information**

* Patient
* Conversation/messages
* Channel
* Delivery status
* Related lead
* Related appointment
* Related automation

---

## I3. Patient Conversation View

May be embedded inside:

* Lead detail
* Patient detail
* Communication detail

The preferred experience is a chronological conversation view.

Clearly distinguish:

```text
Patient message
Automated message
Staff message
Delivery event
```

---

# J. RECALL SCREENS

## J1. Recall List

**Route**

```text
/recall
```

**Required information**

* Patient
* Recall type
* Due date
* Last contact
* Status
* Primary action

**Statuses**

```text
DUE
CONTACTED
BOOKED
COMPLETED
CLOSED
```

---

## J2. Recall Detail

**Route**

```text
/recall/:id
```

**Required sections**

* Patient
* Recall type
* Due date
* Communication history
* Appointment
* Current status

**Primary actions**

* Contact
* Book appointment
* Close recall

---

# K. SETTINGS SCREENS

Settings should use a consistent settings navigation.

Conceptually:

```text
/settings
/settings/clinic
/settings/users
/settings/communication
/settings/templates
/settings/appointments
/settings/recall
/settings/reviews
/settings/automation
```

---

## K1. Settings Overview

**Route**

```text
/settings
```

Provide clear categories rather than a large form containing every setting.

---

## K2. Clinic Settings

**Route**

```text
/settings/clinic
```

**Fields**

* Clinic name
* Logo where supported
* Phone
* Email
* Address
* Timezone
* Business hours

---

## K3. Users and Roles

**Route**

```text
/settings/users
```

**Purpose**

Manage clinic users.

**Required information**

* Name
* Email
* Role
* Status

**Roles**

```text
OWNER
RECEPTIONIST
ADMIN
```

Role availability must follow the backend authorization model.

---

## K4. Communication Settings

**Route**

```text
/settings/communication
```

**Required information**

* Provider
* Channel
* Connection status
* Configuration status
* Test/verification state where supported

Never display secrets.

---

## K5. Message Templates

**Route**

```text
/settings/templates
```

**Required functionality**

* Template list
* Template type
* Enabled/disabled where applicable
* Edit
* Preview

---

## K6. Message Template Editor

**Route**

```text
/settings/templates/:id
```

or:

```text
/settings/templates/new
```

**Required UI**

* Template name
* Message content
* Available variables
* Preview
* Save
* Cancel

Invalid variables must be detected.

---

## K7. Appointment Automation Settings

**Route**

```text
/settings/appointments
```

**Required settings**

* Reminder timing
* Communication behavior
* Quiet hours where supported
* Related clinic configuration

Default reminder sequence:

```text
48 hours
24 hours
2 hours
```

---

## K8. Recall Settings

**Route**

```text
/settings/recall
```

**Required settings**

* Recall timing
* Recall categories
* Follow-up timing
* Templates
* Communication behavior

Do not implement complex clinical recall logic.

---

## K9. Review Settings

**Route**

```text
/settings/reviews
```

**Required settings**

* Review destination URL
* Delay after eligible appointment
* Suppression period
* Message template

---

## K10. Automation Settings

**Route**

```text
/settings/automation
```

**Required settings**

* Enable/disable approved automations
* Timing configuration
* Communication behavior
* Quiet hours where applicable

Do not build an arbitrary visual workflow builder.

---

# L. ADMIN / OPERATIONAL SCREENS

These screens are for authorized administrative users.

## L1. Webhook Activity

**Route**

```text
/admin/webhooks
```

**Status**

Conditional.

Implement only if operational debugging requires it.

Display:

* Provider
* Event type
* Received time
* Processing status
* Idempotency status
* Error state

Do not expose sensitive payloads unnecessarily.

---

## L2. Failed Automation Jobs

**Route**

```text
/admin/automation-failures
```

**Status**

Conditional.

Display:

* Automation
* Patient/record reference
* Failure time
* Failure category
* Retry state

---

## L3. Audit Log

**Route**

```text
/admin/audit
```

**Status**

Conditional / authorized users only.

Display:

* Actor
* Action
* Entity
* Timestamp
* Result

Sensitive information must be minimized.

---

# M. SYSTEM STATES

These are required UI states, not necessarily standalone routes.

## M1. 404 Not Found

Display a clear message and navigation back to an appropriate application page.

---

## M2. Unauthorized

Display when the user lacks permission.

Do not expose protected information.

---

## M3. Session Expired

Clearly inform the user that their session has expired and provide a path to sign in again.

---

## M4. Network Error

Provide:

* Human-readable explanation
* Retry action where appropriate

---

## M5. Server Error

Provide:

* Human-readable explanation
* Retry action
* No stack trace to ordinary users

---

## M6. Empty State

Every data-driven list must have an appropriate empty state.

---

## M7. Loading State

Every asynchronous screen must have an intentional loading state.

---

# N. SCREEN ACCESS MATRIX

The frontend must reflect the application's authorization model.

| Screen                          |          Owner |     Receptionist | Admin |
| ------------------------------- | -------------: | ---------------: | ----: |
| Login                           |            Yes |              Yes |   Yes |
| Dashboard                       |            Yes |         Optional |   Yes |
| Workspace                       |            Yes |              Yes |   Yes |
| Leads                           |            Yes |              Yes |   Yes |
| Patients                        |            Yes |              Yes |   Yes |
| Appointments                    |            Yes |              Yes |   Yes |
| Automations                     |            Yes | Operational view |   Yes |
| Communications                  |            Yes |              Yes |   Yes |
| Recall                          |            Yes |              Yes |   Yes |
| Settings                        |            Yes |          Limited |   Yes |
| Users                           |            Yes |               No |   Yes |
| Communication Provider Settings |            Yes |               No |   Yes |
| Templates                       |            Yes |          Limited |   Yes |
| Webhook Activity                |             No |               No |   Yes |
| Failed Automation Jobs          |             No |               No |   Yes |
| Audit Log                       | Yes/Authorized |               No |   Yes |

The backend remains authoritative for authorization.

The frontend must never rely solely on hiding navigation items for security.

---

# O. MVP SCREEN COUNT

The initial MVP should target approximately the following screen inventory:

### Core

```text
1. Login
2. Forgot Password
3. Reset Password
4. Dashboard
5. Receptionist Workspace
6. Lead List
7. Create Lead
8. Lead Detail
9. Edit Lead
10. Patient List
11. Patient Detail
12. Edit Patient
13. Appointment List
14. Appointment Detail
15. Create Appointment
16. Reschedule Appointment
17. Automations
18. Automation Detail
19. Automation Activity
20. Communications
21. Communication Detail
22. Recall List
23. Recall Detail
24. Settings Overview
25. Clinic Settings
26. Users & Roles
27. Communication Settings
28. Message Templates
29. Message Template Editor
30. Appointment Settings
31. Recall Settings
32. Review Settings
33. Automation Settings
```

Conditional operational screens:

```text
34. Appointment Calendar
35. Automation Run Detail
36. Webhook Activity
37. Failed Automation Jobs
38. Audit Log
```

Some of these may be implemented as drawers, modals, tabs, or nested views rather than independent browser pages.

The screen inventory defines the **required UX capability**, not a requirement that every item must have a unique URL.

---

# P. SCREEN IMPLEMENTATION RULE

Before implementing a screen, the development agent must identify:

```text
SCREEN NAME
ROUTE
PRIMARY USER
PURPOSE
DATA REQUIRED
API DEPENDENCIES
PRIMARY ACTIONS
SECONDARY ACTIONS
PERMISSIONS
LOADING STATE
EMPTY STATE
ERROR STATE
SUCCESS STATE
RESPONSIVE BEHAVIOR
ACCESSIBILITY REQUIREMENTS
ACCEPTANCE CRITERIA
```

Do not begin implementation if critical requirements are unknown.

---

# Q. SCREEN ACCEPTANCE GATE

A screen is not considered complete merely because it visually renders.

The screen must pass:

```text
UI IMPLEMENTATION
        ↓
API INTEGRATION
        ↓
REAL DATA STATE
        ↓
LOADING STATE
        ↓
EMPTY STATE
        ↓
ERROR STATE
        ↓
SUCCESS STATE
        ↓
PERMISSION TEST
        ↓
RESPONSIVE CHECK
        ↓
ACCESSIBILITY CHECK
        ↓
FUNCTIONAL TEST
        ↓
REGRESSION TEST
        ↓
PASSED
```

If a required stage fails:

```text
DO NOT MARK SCREEN COMPLETE.
```

Fix the issue and retest.

---

# R. FRONTEND SCOPE CONTROL

The following are explicitly outside the frontend MVP unless separately authorized:

* Dental chart UI
* Tooth chart
* X-ray/image management
* Clinical records
* Treatment planning
* Prescription UI
* Billing UI
* Insurance UI
* Accounting UI
* Inventory UI
* Payroll UI
* Advanced CRM pipeline
* AI receptionist interface
* AI voice interface
* Call transcription interface
* Advanced call-center interface
* Marketing campaign builder
* Advertising dashboard
* Social-media management
* Complex visual workflow builder
* Enterprise administration
* Advanced analytics suite

Do not create navigation items, placeholder screens, database views, or UI components for these features.

---

# S. FINAL FRONTEND OBJECTIVE

The complete frontend must make the following workflow immediately understandable:

```text
NEW LEAD
    ↓
FAST RESPONSE
    ↓
PATIENT REPLY
    ↓
APPOINTMENT
    ↓
CONFIRMATION
    ↓
ATTENDANCE
    ↓
REVIEW
    ↓
RECALL
```

And:

```text
MISSED CALL
    ↓
AUTOMATIC RESPONSE
    ↓
PATIENT REPLY
    ↓
APPOINTMENT
```

And:

```text
NO-SHOW
    ↓
RECOVERY
    ↓
REBOOKING
```

The frontend should make these workflows operationally simple for clinic staff.

The objective is not to create the largest interface.

The objective is to create the **smallest clear, reliable, professional frontend that makes the approved MVP easy for dental clinics to operate.**

# 2. FRONTEND ROUTES AND PERMISSIONS

This section defines the authoritative frontend route structure and access-control requirements.

The frontend must enforce permissions at the UI and routing layers. Backend authorization remains authoritative and must independently reject unauthorized API requests.

## 2.1 Route Access Levels

### Public Routes

| Route              | Screen          | Access |
| ------------------ | --------------- | ------ |
| `/login`           | Login           | Public |
| `/forgot-password` | Forgot Password | Public |
| `/reset-password`  | Reset Password  | Public |

### Authenticated Routes

Authenticated users must belong to an active clinic account.

| Route                          | Owner | Receptionist | Admin |
| ------------------------------ | ----: | -----------: | ----: |
| `/dashboard`                   |   Yes |           No |   Yes |
| `/workspace`                   |   Yes |          Yes |   Yes |
| `/leads`                       |   Yes |          Yes |   Yes |
| `/leads/new`                   |   Yes |          Yes |   Yes |
| `/leads/:id`                   |   Yes |          Yes |   Yes |
| `/leads/:id/edit`              |   Yes |          Yes |   Yes |
| `/patients`                    |   Yes |          Yes |   Yes |
| `/patients/:id`                |   Yes |          Yes |   Yes |
| `/patients/:id/edit`           |   Yes |          Yes |   Yes |
| `/appointments`                |   Yes |          Yes |   Yes |
| `/appointments/calendar`       |   Yes |          Yes |   Yes |
| `/appointments/new`            |   Yes |          Yes |   Yes |
| `/appointments/:id`            |   Yes |          Yes |   Yes |
| `/appointments/:id/reschedule` |   Yes |          Yes |   Yes |
| `/appointments/:id/rebook`     |   Yes |          Yes |   Yes |
| `/automations`                 |   Yes |          Yes |   Yes |
| `/automations/:id`             |   Yes |          Yes |   Yes |
| `/automations/activity`        |   Yes |          Yes |   Yes |
| `/automations/activity/:id`    |  Yes* |          No* |  Yes* |
| `/communications`              |   Yes |          Yes |   Yes |
| `/communications/:id`          |   Yes |          Yes |   Yes |
| `/recall`                      |   Yes |          Yes |   Yes |
| `/recall/:id`                  |   Yes |          Yes |   Yes |
| `/settings`                    |   Yes |      Limited |   Yes |
| `/settings/clinic`             |   Yes |           No |   Yes |
| `/settings/users`              |   Yes |           No |   Yes |
| `/settings/communication`      |   Yes |           No |   Yes |
| `/settings/templates`          |   Yes |      Limited |   Yes |
| `/settings/templates/:id`      |   Yes |      Limited |   Yes |
| `/settings/appointments`       |   Yes |      Limited |   Yes |
| `/settings/recall`             |   Yes |      Limited |   Yes |
| `/settings/reviews`            |   Yes |      Limited |   Yes |
| `/settings/automation`         |   Yes |           No |   Yes |

`*` Access must be determined by the final backend role/permission model. The frontend must not assume operational privileges that the backend does not grant.

## 2.2 Operational/Admin Routes

These routes are not necessarily visible in normal clinic navigation.

| Route                        | Purpose                |       Owner | Receptionist |       Admin |
| ---------------------------- | ---------------------- | ----------: | -----------: | ----------: |
| `/admin/webhooks`            | Webhook activity       | Conditional |           No | Conditional |
| `/admin/automation-failures` | Failed automation jobs | Conditional |           No | Conditional |
| `/admin/audit`               | Audit records          | Conditional |           No | Conditional |

Operational screens must only be exposed when the authenticated user has the corresponding permission.

## 2.3 Permission Model

Frontend permissions must be capability-based rather than hard-coded exclusively around role names.

Example capabilities:

```text
dashboard.view

leads.view
leads.create
leads.edit

patients.view
patients.create
patients.edit

appointments.view
appointments.create
appointments.edit
appointments.reschedule
appointments.rebook

communications.view
communications.send

automations.view
automations.manage
automations.activity.view

recall.view
recall.manage

settings.view
settings.clinic.manage
settings.users.manage
settings.communication.manage
settings.templates.manage
settings.appointments.manage
settings.recall.manage
settings.reviews.manage
settings.automation.manage

admin.webhooks.view
admin.automation_failures.view
admin.audit.view
```

The exact backend permission names may differ, but the frontend architecture must support capability-based authorization.

## 2.4 Permission Behavior

For every protected route:

1. Verify authentication.
2. Load authenticated user and clinic context.
3. Resolve permissions.
4. Verify required capability.
5. Render the screen only when authorized.
6. Otherwise render the Unauthorized state.
7. Never rely on hidden navigation as the security mechanism.
8. API authorization must independently enforce access.

Unauthorized users must not receive sensitive API data merely because a frontend route was hidden.

---

# 3. SCREEN-TO-API DEPENDENCIES

Every production screen must have an explicit API dependency map before implementation.

The frontend must not invent data locally when the required backend data does not exist.

## 3.1 Authentication

### `/login`

**Required APIs**

* Login
* Session/token creation
* Current-user retrieval

**Dependencies**

```text
POST /auth/login
GET  /auth/me
```

**States**

* Initial
* Submitting
* Authentication failure
* Account disabled
* Success
* Network failure

### `/forgot-password`

**Required APIs**

```text
POST /auth/forgot-password
```

### `/reset-password`

**Required APIs**

```text
POST /auth/reset-password
```

---

## 3.2 Dashboard

### `/dashboard`

**Required data**

* Lead count
* New leads
* Lead response activity
* Appointments
* Confirmations
* No-shows
* Recall activity
* Automation activity
* Relevant communication activity

**Expected API dependencies**

```text
GET /dashboard/summary
GET /dashboard/activity
```

If the backend exposes separate resources rather than dashboard aggregation endpoints, the frontend may compose them, but unnecessary repeated requests should be avoided.

---

## 3.3 Receptionist Workspace

### `/workspace`

**Required data**

* Today's appointments
* New leads requiring attention
* Recent patient replies
* Missed-call recoveries
* No-show recovery tasks
* Recall tasks
* Communication status

**Expected dependencies**

```text
GET /workspace/summary
GET /appointments?date=today
GET /leads?status=...
GET /communications?status=...
GET /recall?status=...
```

The final implementation should prefer an appropriate aggregated endpoint where practical.

---

## 3.4 Leads

### `/leads`

**Required APIs**

```text
GET /leads
```

Supports:

* Pagination
* Search
* Filtering
* Sorting
* Status
* Source
* Date range

### `/leads/new`

```text
POST /leads
```

### `/leads/:id`

```text
GET /leads/:id
GET /leads/:id/activity
GET /leads/:id/communications
```

### `/leads/:id/edit`

```text
GET /leads/:id
PATCH /leads/:id
```

Lead creation or update may trigger backend automation. The frontend must display the actual returned automation/communication state rather than assuming success.

---

## 3.5 Patients

### `/patients`

```text
GET /patients
```

### `/patients/:id`

```text
GET /patients/:id
GET /patients/:id/appointments
GET /patients/:id/communications
GET /patients/:id/recall
GET /patients/:id/activity
```

### `/patients/:id/edit`

```text
GET /patients/:id
PATCH /patients/:id
```

The patient module remains operational/communication-focused. It must not become a clinical-record interface.

---

## 3.6 Appointments

### `/appointments`

```text
GET /appointments
```

### `/appointments/calendar`

```text
GET /appointments?from=...
GET /appointments?to=...
```

### `/appointments/new`

```text
GET /patients
POST /appointments
```

### `/appointments/:id`

```text
GET /appointments/:id
GET /appointments/:id/activity
GET /appointments/:id/communications
```

### `/appointments/:id/reschedule`

```text
GET /appointments/:id
PATCH /appointments/:id
```

### `/appointments/:id/rebook`

```text
GET /appointments/:id
POST /appointments
```

The exact appointment mutation endpoints must follow the backend API contract. The frontend must not assume that `PATCH` or `POST` is correct until the API contract is established.

---

## 3.7 Automations

### `/automations`

```text
GET /automations
```

### `/automations/:id`

```text
GET /automations/:id
GET /automations/:id/activity
```

### `/automations/activity`

```text
GET /automation-runs
```

### `/automations/activity/:id`

```text
GET /automation-runs/:id
GET /automation-runs/:id/events
```

This screen must display actual automation execution data.

It must not show fabricated "successful" automation activity.

---

## 3.8 Communications

### `/communications`

```text
GET /communications
```

Supports:

* Search
* Patient/lead filtering
* Communication channel
* Delivery status
* Date range
* Conversation status

### `/communications/:id`

```text
GET /communications/:id
GET /communications/:id/messages
```

### Patient Conversation View

```text
GET  /conversations/:id
GET  /conversations/:id/messages
POST /conversations/:id/messages
```

Exact endpoint names remain subject to the backend API contract.

The UI must distinguish:

```text
queued
sent
delivered
failed
received
```

where those states are actually provided by the backend/provider.

---

## 3.9 Recall

### `/recall`

```text
GET /recall
```

Supports:

* Overdue status
* Patient
* Due date
* Communication status

### `/recall/:id`

```text
GET /recall/:id
GET /recall/:id/activity
POST /recall/:id/contact
```

The frontend must display actual recall state returned by the backend.

---

## 3.10 Settings

### `/settings`

```text
GET /settings
GET /auth/me
```

### `/settings/clinic`

```text
GET /clinic
PATCH /clinic
```

### `/settings/users`

```text
GET /users
POST /users
PATCH /users/:id
```

### `/settings/communication`

```text
GET /communication/settings
PATCH /communication/settings
```

### `/settings/templates`

```text
GET /message-templates
```

### `/settings/templates/:id`

```text
GET /message-templates/:id
POST /message-templates
PATCH /message-templates/:id
```

### `/settings/appointments`

```text
GET /appointment-settings
PATCH /appointment-settings
```

### `/settings/recall`

```text
GET /recall-settings
PATCH /recall-settings
```

### `/settings/reviews`

```text
GET /review-settings
PATCH /review-settings
```

### `/settings/automation`

```text
GET /automation-settings
PATCH /automation-settings
```

The actual endpoint naming must follow the finalized backend API specification.

---

## 3.11 Operational Screens

### `/admin/webhooks`

```text
GET /admin/webhooks
GET /admin/webhooks/:id
```

### `/admin/automation-failures`

```text
GET /admin/automation-failures
GET /admin/automation-failures/:id
```

### `/admin/audit`

```text
GET /admin/audit
```

These endpoints must enforce backend authorization.

---

## 3.12 API Dependency Rule

Before implementing a screen, document:

```text
SCREEN
ROUTE
USER ROLE
REQUIRED PERMISSIONS

DATA SOURCES
API ENDPOINTS
HTTP METHODS

QUERY PARAMETERS
REQUEST PAYLOADS
RESPONSE DATA

LOADING STATE
EMPTY STATE
ERROR STATE
SUCCESS STATE

MUTATIONS
INVALIDATION/REFETCH BEHAVIOR

ACCESS CONTROL
AUDIT REQUIREMENTS
```

No screen should be considered implementation-complete while its API dependencies are undefined.

---

# 4. ROUTE NAMING CONVENTION

The frontend must use predictable, resource-oriented, lowercase route names.

## 4.1 General Rules

Use:

```text
/lowercase
/resource
/resource/:id
/resource/:id/action
```

Examples:

```text
/leads
/leads/123
/leads/123/edit

/patients
/patients/123

/appointments
/appointments/123
/appointments/123/reschedule

/automations
/automations/123

/communications
/communications/123
```

## 4.2 Naming Rules

### Rule 1 — Lowercase

Use:

```text
/appointments
```

Not:

```text
/Appointments
/AppointmentList
```

### Rule 2 — Plural Resource Names

Use plural nouns for collections:

```text
/leads
/patients
/appointments
/communications
/automations
```

Not:

```text
/lead
/patient
/appointment
```

### Rule 3 — IDs Use `:id`

Use:

```text
/leads/:id
/patients/:id
/appointments/:id
```

Do not create resource-specific parameter names unless there is a strong architectural reason.

### Rule 4 — Actions Follow the Resource

Use:

```text
/appointments/:id/reschedule
/appointments/:id/rebook
```

Not:

```text
/rescheduleAppointment/:id
/rebookAppointment/:id
```

### Rule 5 — Settings Use a Dedicated Namespace

Use:

```text
/settings
/settings/clinic
/settings/users
/settings/communication
/settings/templates
/settings/appointments
/settings/recall
/settings/reviews
/settings/automation
```

### Rule 6 — Operational Routes Use `/admin`

Use:

```text
/admin/webhooks
/admin/automation-failures
/admin/audit
```

These routes must not be mixed with normal clinic operational routes.

### Rule 7 — Query Parameters for Filtering

Use query parameters for filtering, sorting, pagination, and date ranges.

Example:

```text
/leads?status=new&page=2
/appointments?date=2026-09-28
/communications?channel=sms&status=failed
/recall?status=overdue
```

Do not create routes such as:

```text
/leads/status/new
/appointments/date/today
```

unless the resource represents a genuinely distinct screen.

### Rule 8 — No UI Terminology in Resource Routes

Routes should describe resources or actions, not visual components.

Avoid:

```text
/leads-table
/leads-page
/lead-drawer
/appointment-modal
```

The same screen may later change from a page to a drawer or modal without changing its resource route.

### Rule 9 — Stable Routes

Do not change route names merely because the UI layout changes.

For example:

```text
/leads/:id
```

should remain the lead detail route whether the detail is presented as:

* full page
* side drawer
* responsive modal
* embedded detail view

### Rule 10 — Consistent URL Structure

The application should follow this hierarchy:

```text
/
├── login
├── forgot-password
├── reset-password
│
├── dashboard
├── workspace
│
├── leads
│   ├── new
│   └── :id
│       └── edit
│
├── patients
│   └── :id
│       └── edit
│
├── appointments
│   ├── calendar
│   ├── new
│   └── :id
│       ├── reschedule
│       └── rebook
│
├── automations
│   ├── activity
│   └── :id
│
├── communications
│   └── :id
│
├── recall
│   └── :id
│
├── settings
│   ├── clinic
│   ├── users
│   ├── communication
│   ├── templates
│   ├── appointments
│   ├── recall
│   ├── reviews
│   └── automation
│
└── admin
    ├── webhooks
    ├── automation-failures
    └── audit
```

## 4.3 Route Implementation Requirements

The frontend router must provide:

* Authentication guards
* Permission guards
* Clinic/tenant context validation
* Lazy loading where appropriate
* 404 handling
* Unauthorized handling
* Session-expired handling
* Error boundary handling
* Deep-link support
* Browser refresh support
* Consistent route metadata
* Page title handling
* Navigation state handling

Each route definition should have machine-readable metadata equivalent to:

```text
route
screen
requiredPermissions
layout
authenticationRequired
navigationVisibility
```

## 4.4 Route Definition of Done

A route is complete only when:

1. Route exists.
2. Correct screen renders.
3. Authentication behavior is tested.
4. Permission behavior is tested.
5. API dependencies are connected.
6. Loading state works.
7. Empty state works where applicable.
8. Error state works.
9. Success/mutation state works where applicable.
10. Deep linking works.
11. Browser refresh works.
12. Responsive behavior works.
13. Accessibility requirements are met.
14. No unauthorized data is exposed.
15. E2E coverage exists for critical workflows.
16. Regression tests pass.

---

# 5. FRONTEND ROUTE/API/SCREEN SOURCE OF TRUTH

The following hierarchy is authoritative:

```text
Backend API Contract
        ↓
Permission Contract
        ↓
Frontend Route Contract
        ↓
Screen Specification
        ↓
Component Implementation
```

The frontend must not invent API behavior to make a screen appear complete.

If an API, permission, data field, mutation, or backend capability is not verified, it must be marked:

```text
NOT_VERIFIED
```

rather than implemented as if it already exists.

The route structure, screen inventory, API dependencies, and permission model must remain synchronized throughout development.

Any change to one of these areas requires review of the dependent screens, API calls, permissions, tests, and navigation.

# 6. FRONTEND IMPLEMENTATION GATE

Before a screen is marked complete:

```text
ROUTE DEFINED
↓
PERMISSION DEFINED
↓
API DEPENDENCIES DEFINED
↓
API CONTRACT VERIFIED
↓
SCREEN IMPLEMENTED
↓
REAL DATA CONNECTED
↓
LOADING TESTED
↓
EMPTY TESTED
↓
ERROR TESTED
↓
SUCCESS TESTED
↓
AUTHORIZATION TESTED
↓
RESPONSIVE TESTED
↓
ACCESSIBILITY TESTED
↓
E2E TESTED
↓
REGRESSION TESTED
↓
PASSED
```

No screen should be marked complete solely because the visual UI renders successfully.
