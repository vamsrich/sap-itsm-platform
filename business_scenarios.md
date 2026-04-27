# ServiceDeskPro — Business Scenarios

This file is the test scenario catalog for the ServiceDeskPro QA agent. The agent reads this file to enumerate available test scenarios, ask the operator which to run, walk through preconditions and steps, and capture findings in `qa_log.md`.

## How this file is used

- The QA agent parses this file to list scenarios, organized by Part.
- Each scenario has a fixed structure: `Type`, `Preconditions`, `Data setup`, `Steps`, `Expected`, `Cleanup`, `Notes`.
- Every scenario should be runnable independently OR clearly state which scenario must precede it.
- Audit log assertions are baked INTO scenarios, not separated. If an action should produce an audit entry, the scenario asserts it under `Expected`.
- Scenarios marked `⚠️ BLOCKED` cannot currently be executed end-to-end (e.g., UI doesn't exist). The agent should report blockage clearly.

## Conventions

- **Type**: `Unit` (single discrete action) | `Integration` (multi-step within one feature) | `End-to-End` (full business cycle, possibly with data manipulation)
- **Test data principle**: Prefer fresh UI-created data per run. Use AMS seed users for login (don't create new users per run). Test tickets/comments/time entries can be left for audit history unless cleanup is specified.
- **Naming convention for QA-created data**: Title prefix `QA-<scenario-id>-<timestamp>` so test data is identifiable. Example: `QA-2.1-20260427-103000 - Test FICO ticket`.

---

## Cross-cutting reference data

Every scenario below references data defined here. Update this section when test environment, users, or rules change.

### Reference 1: Test user matrix

These are AMS seed users (loaded by `backend/src/ams-seed.ts`). Use these for login in scenarios. Do NOT create new users per scenario — reuse these.

| Email | Password | Role | Notes |
| --- | --- | --- | --- |
| `admin@intraedge.com` | `Admin@123` | SUPER_ADMIN | Full tenant access |
| `priya.sharma@intraedge.com` | `Admin@123456` | PROJECT_MANAGER | Manages GlobalManufacturing AG |
| `rajesh.kumar@intraedge.com` | `Admin@123456` | AGENT | FICO specialist (L3) |
| `anitha.reddy@intraedge.com` | `Admin@123456` | AGENT | MM specialist (L3) |
| `vikram.nair@intraedge.com` | `Admin@123456` | AGENT | SD specialist (L3) |
| `deepa.menon@intraedge.com` | `Admin@123456` | AGENT | PP specialist (L3) |
| `it.admin@globalmanufacturing.de` | `Admin@123456` | COMPANY_ADMIN | GlobalManufacturing AG admin |
| `finance.user@globalmanufacturing.de` | `Admin@123456` | USER | Finance team end-user |
| `procurement.user@globalmanufacturing.de` | `Admin@123456` | USER | Procurement team end-user |

**Customer:** GlobalManufacturing AG (the only customer in AMS seed). All scenarios run against this customer unless stated.

### Reference 2: Notification matrix

Defines who gets notified for which events. **The agent uses this to verify expected notifications.** Update when notification rules change.

| Event | Recipient | Channel | Trigger condition |
| --- | --- | --- | --- |
| Ticket created | Project Manager (assigned to customer) | Email + In-app | Always |
| Ticket created | Company Admin | Email + In-app | **Only if priority = P1** |
| Ticket created | Ticket creator | Email + In-app | Always (confirmation) |
| Ticket assigned to agent | Assigned Agent | Email + In-app | Always |
| Ticket assigned to agent | Ticket creator | Email + In-app | Always |
| Ticket status change → In Progress | Ticket creator | Email + In-app | Always |
| Ticket status change → Awaiting Info | Ticket creator | Email + In-app | Always |
| Ticket status change → Resolved | Ticket creator | Email + In-app | Always |
| Ticket status change → Closed | Assigned Agent | In-app only | Always |
| Ticket reopened | Assigned Agent | Email + In-app | Always |
| Public comment added | Other party (USER ↔ AGENT) | Email + In-app | Always |
| Internal comment added | Other agents on customer | In-app only | Never to USER or COMPANY_ADMIN |
| Priority change | Assigned Agent + PM | Email + In-app | Always |
| Re-assignment | Old agent (notify), new agent (assignment) | Email + In-app | Always |
| Time entry approved | Time entry creator (AGENT) | In-app only | Always |
| Time entry rejected | Time entry creator (AGENT) | In-app + Email | Always (with reason) |

**[ASSUMPTION]** Email content includes ticket ID, link to ticket, and a short context line. Exact templates are in `EmailTemplate` model. Verify per scenario by checking email log (`/admin/email-log` if accessible) or in-app notification inbox.

**[ASSUMPTION]** SMTP may not be configured in dev/staging. If so, agent verifies notifications via in-app inbox only and notes "email channel unverified — SMTP not configured".

### Reference 3: Status transition state machine

Valid transitions for `ITSMRecord.status`. Agent uses this to validate scenarios and reject invalid expected transitions.

```
                              ┌─────────────────────────────────┐
                              │                                 │
                              ▼                                 │
  [Open] ──> [In Progress] ──> [Awaiting Info] ──> [In Progress]  (loop until resolved)
                │
                ├──> [Resolved] ──> [Closed]
                │                       │
                │                       ▼
                │                   (terminal)
                │
                └──> [Resolved] ──> [In Progress]  (USER reopen within reopen window)
```

**Valid transitions:**

| From | To | Allowed actor |
| --- | --- | --- |
| Open | In Progress | AGENT (assigned) |
| In Progress | Awaiting Info | AGENT (assigned) |
| Awaiting Info | In Progress | USER (creator) OR AGENT (assigned) |
| In Progress | Resolved | AGENT (assigned) |
| Resolved | Closed | USER (creator) — terminal |
| Resolved | In Progress | USER (creator) — reopen |

**Invalid transitions** (must be rejected by API):
- Open → Resolved (cannot skip In Progress)
- Closed → anything (terminal state)
- Any → Open (cannot return to initial state)

**[ASSUMPTION]** Reopen window is unlimited or 14 days. Verify in code: search `parentRecordId` and reopen logic in `record.routes.ts`.

### Reference 4: Test data conventions

- **Test environment**: scenarios run against one of two environments — operator chooses at session start:
  - **Local:** backend `http://localhost:4000`, frontend `http://localhost:5173`
  - **Railway (dev/staging):**
    - Frontend: `https://sap-itsm-platform-production.up.railway.app`
    - Backend:  `https://servicedesk-production-f664.up.railway.app`

  > Despite "production" appearing in the Railway subdomains (Railway deployment-naming convention), this is the dev/staging environment. No real customer traffic. Real production deployment has NOT happened yet — when it does, this section gets updated to ban it.

- **Title prefix**: `QA-<scenario-id>-<UTC-timestamp>` — example: `QA-2.1-20260427-103000`
- **Description**: Should include `[QA TEST]` marker so it's filterable
- **Cleanup**: Default = leave data for audit history. Scenarios that REQUIRE cleanup state it explicitly under `Cleanup`.
- **Existing data check**: Some scenarios require pre-existing data (e.g., 2.10 USER reopens — needs a Resolved ticket first). The agent should:
  1. Check if eligible data exists
  2. If yes → use it, run the scenario
  3. If no → either create the data via a precondition scenario OR ask the operator

---

## PART 1 — Authentication & Authorization

Scenarios validate that each role can log in, sees the correct dashboard, and only the data they're authorized to see.

| # | Scenario | Status |
| --- | --- | --- |
| 1.1 | SUPER_ADMIN login + dashboard scope | Stub |
| 1.2 | COMPANY_ADMIN login + dashboard scope | Stub |
| 1.3 | PROJECT_MANAGER login + dashboard scope | Stub |
| 1.4 | AGENT login + dashboard scope | Stub |
| 1.5 | USER login + dashboard scope | Stub |
| 1.6 | Login is case-insensitive (regression: email.toLowerCase) | Stub |
| 1.7 | Non-admin roles cannot access GET /audit endpoint | Stub |
| 1.8 | SUPER_ADMIN and COMPANY_ADMIN can view Audit Page | Stub |

---

## PART 2 — Ticket Lifecycle

Scenarios validate the full lifecycle of a ticket, from creation through close/reopen, including comments, status changes, priority changes, and reassignment. Audit log assertions are baked in.

| # | Scenario | Status |
| --- | --- | --- |
| **2.1** | **Ticket creation + initial notifications** | **Detailed (reference)** |
| 2.2 | Manual assignment by PM | Stub |
| 2.3 | Agent picks up — Open → In Progress | Stub |
| 2.4 | Agent requests info — In Progress → Awaiting Info | Stub |
| 2.5 | USER provides info — Awaiting Info → In Progress | Stub |
| 2.6 | Agent resolves — In Progress → Resolved | Stub |
| 2.7 | USER closes — Resolved → Closed | Stub |
| 2.8 | USER reopens — Resolved → In Progress | Stub |
| 2.9 | Public comment by AGENT | Stub |
| 2.10 | Internal comment by AGENT (with visibility test) | Stub |
| 2.11 | Comment by USER | Stub |
| 2.12 | Priority change by AGENT/PM | Stub |
| 2.13 | Re-assignment to different agent | Stub |

### Scenario 2.1 — Ticket creation + initial notifications

**Type:** Integration

**Purpose:** Validates that USER can create a ticket; appropriate notifications fire to PM (always) and Company Admin (only for P1); ticket creator receives confirmation; audit log entry is created.

**Preconditions:**
- USER `finance.user@globalmanufacturing.de` exists with valid login
- PROJECT_MANAGER `priya.sharma@intraedge.com` is assigned as PM for GlobalManufacturing AG
- COMPANY_ADMIN `it.admin@globalmanufacturing.de` exists for GlobalManufacturing AG
- Notification rules per Reference 2 are configured (PM always, COMPANY_ADMIN only for P1)
- Email log endpoint or in-app notification inbox is accessible to verify notifications

**Data setup:**
- None — this scenario creates its own ticket from scratch
- The scenario will be run twice with different priorities to test the conditional Company Admin notification:
  - Run A: priority = P2 (expect: PM notified, Company Admin NOT notified)
  - Run B: priority = P1 (expect: PM notified, Company Admin notified)

**Steps:**

**Run A — P2 ticket (Company Admin should NOT be notified):**

1. Log in as USER (`finance.user@globalmanufacturing.de` / `Admin@123456`)
2. Navigate to "New Record" / ticket creation page
3. Select record type: `INCIDENT`
4. Enter title: `QA-2.1A-<UTC-timestamp> - Test P2 incident creation`
5. Enter description: `[QA TEST] Verifying P2 ticket creation and notification routing`
6. Select SAP module: `FICO`
7. Select sub-module: `AP` (Accounts Payable)
8. Select priority: `P2`
9. Click "Create" / "Submit"
10. Capture the resulting ticket ID

**Run B — P1 ticket (Company Admin SHOULD be notified):**

11. (Same login session as Run A or fresh — both work)
12. Navigate to "New Record" again
13. Select record type: `INCIDENT`
14. Enter title: `QA-2.1B-<UTC-timestamp> - Test P1 incident creation`
15. Enter description: `[QA TEST] Verifying P1 ticket creation and notification routing`
16. Select SAP module: `FICO`
17. Select sub-module: `AP`
18. Select priority: `P1`
19. Click "Create" / "Submit"
20. Capture the resulting ticket ID

**Expected:**

For both Run A and Run B (P2 and P1):

- ✅ Ticket created successfully; redirects to ticket detail page or returns success
- ✅ Ticket appears in record list with status `Open`, correct title, correct module/sub-module, correct priority
- ✅ Ticket has `customerId` matching GlobalManufacturing AG (USER's customer)
- ✅ Ticket has `createdById` matching USER's user ID
- ✅ Ticket has `tenantId` matching the Intraedge tenant
- ✅ **Audit log entry created** with:
  - `action = CREATE`
  - `entityType = ITSMRecord` (or equivalent)
  - `entityId = <ticket ID>`
  - `userId = <USER's user ID>`
  - `tenantId = <Intraedge tenant ID>`
  - `timestamp ≈ creation time` (within 5 seconds)
- ✅ Notification fired to PM `priya.sharma@intraedge.com` (in-app + email if SMTP configured)
- ✅ Notification fired to ticket creator USER (confirmation, in-app + email)

**Run A specifically (P2):**
- ❌ NO notification fired to COMPANY_ADMIN `it.admin@globalmanufacturing.de`
- Verify via in-app inbox while logged in as COMPANY_ADMIN: the new P2 ticket does not generate a new notification

**Run B specifically (P1):**
- ✅ Notification FIRED to COMPANY_ADMIN `it.admin@globalmanufacturing.de` (in-app + email)
- Verify via in-app inbox while logged in as COMPANY_ADMIN: a new notification appears for the P1 ticket

**Cleanup:**
- Default: leave both tickets for audit history
- Optional: tag tickets for later bulk delete via title prefix `QA-2.1-`

**Notes:**
- This scenario tests the conditional notification rule (Reference 2). The behavior difference between P2 and P1 is the critical assertion.
- If SMTP is not configured in the test environment, only in-app notifications are verified; email assertions are reported as "unverified — SMTP not configured".
- Audit entry verification requires logging in as SUPER_ADMIN or COMPANY_ADMIN to view the audit page (Reference: Scenario 1.8).
- **[ASSUMPTION]** Notification rules use the `NotificationRule` model with event `TICKET_CREATED` and a priority filter for the COMPANY_ADMIN rule. If notification rules are misconfigured in seed data, this scenario will fail — log as defect, not as test failure of creation logic.

---

## PART 3 — Module-Based Categorization (deferred)

Scenarios validate that tickets are routed to the right specialist based on SAP module. **Auto-assignment scenarios deferred per session decision (April 27).**

| # | Scenario | Status |
| --- | --- | --- |
| 3.1 | FICO ticket routes to FICO agent | Deferred |
| 3.2 | Sub-module routing | Deferred |

---

## PART 4 — Notifications

Notification scenarios live INSIDE other scenarios (per Reference 2). This section captures notification-specific scenarios that don't fit naturally elsewhere.

| # | Scenario | Status |
| --- | --- | --- |
| 4.1 | Notification preferences honored (email vs in-app only) | Stub |
| 4.2 | Notification not fired when SMTP fails (graceful degradation) | Stub |

---

## PART 5 — Similar Incidents & Pattern Detection

Scenarios validate the Phase 2 intelligence features. **Phase 2 features are partially broken per v36 handover** — these scenarios serve as acceptance specs for fixes.

| # | Scenario | Status |
| --- | --- | --- |
| 5.1 | Similar incidents surface on ticket detail page | Stub (acceptance spec for fixing 2.1 — Similar Incidents UI) |
| 5.2 | Recurring pattern detection across multiple similar tickets | Stub |
| 5.3 | Root-cause accumulation view | Stub |
| 5.4 | Knowledge gap tab | Stub |

---

## PART 6 — SLA Tracking

| # | Scenario | Status |
| --- | --- | --- |
| 6.1 | New ticket creates SLA deadlines per priority | Stub |
| 6.2 | SLA pause during Awaiting Info | Stub |
| 6.3 | SLA resume on user response | Stub |
| 6.4 | SLA breach alert fires | Stub |

---

## PART 7 — Comments & Visibility

Scenarios for comments are baked into Part 2 (2.9, 2.10, 2.11). This part captures cross-cutting visibility tests.

| # | Scenario | Status |
| --- | --- | --- |
| 7.1 | USER cannot create internal comments | Stub |
| 7.2 | Internal comment never appears in USER notification feed | Stub |

---

## PART 8 — Time Recording

Scenarios validate time entry creation, edit, approval workflow, and visibility rules.

| # | Scenario | Status |
| --- | --- | --- |
| **8.1** | **AGENT logs single time entry on a ticket** | **Detailed (reference)** |
| 8.2 | AGENT logs multiple time entries on the same ticket | Stub |
| 8.3 | AGENT edits an existing time entry | Stub |
| 8.4 | PM/SUPER_ADMIN approves a time entry | Stub — ⚠️ BLOCKED: Frontend UI for approve/reject doesn't exist (BUG-002 in qa_log.md). Backend API works (`PATCH /records/:id/time-entry/:entryId`). Run via API only until UI is built. |
| 8.5 | PM/SUPER_ADMIN rejects a time entry with reason | Stub — ⚠️ BLOCKED: Same as 8.4 |
| 8.6 | Time entry totals roll up correctly on ticket detail | Stub |
| 8.7 | COMPANY_ADMIN cannot view time entries (returns 403) | Stub |

### Scenario 8.1 — AGENT logs single time entry on a ticket

**Type:** Unit

**Purpose:** Validates that an AGENT can log a time entry against a ticket assigned to them, the entry is persisted with status `PENDING`, the audit log captures the action, and the entry appears on the ticket detail.

**Preconditions:**
- AGENT `rajesh.kumar@intraedge.com` exists and can log in
- A ticket exists that is **assigned to** Rajesh Kumar in status `Open` or `In Progress`
  - If no such ticket exists, run a precondition flow: create one via Scenario 2.1 (P2 ticket on FICO module) and have it assigned to Rajesh (manual or auto-assignment)
  - **[ASSUMPTION]** AMS seed already has tickets assigned to Rajesh; the agent can pick one programmatically

**Data setup:**
- If no eligible ticket exists, agent prompts operator: "No tickets are currently assigned to Rajesh. Create one now? [Y/n]"
- If Y: run Scenario 2.1 with assignment to Rajesh as a setup step, then proceed
- If N: skip scenario, log as `Skipped — preconditions not met`

**Steps:**
1. Log in as AGENT (`rajesh.kumar@intraedge.com` / `Admin@123456`)
2. Navigate to "My Tickets" / agent dashboard
3. Open one of the tickets assigned to Rajesh (capture ticket ID for later assertion)
4. Locate the "Time Entries" section on the ticket detail page (typically below comments)
5. Click "Add Time Entry" / "Log Time"
6. Fill in:
   - Hours: `1.5`
   - Description: `QA-8.1-<UTC-timestamp> - Investigated F110 dump`
   - Activity date: today's date (or default if pre-filled)
7. Click "Save" / "Submit"

**Expected:**
- ✅ Time entry created successfully; UI refreshes to show the new entry
- ✅ New entry appears in the ticket's time-entry list with:
  - Hours: `1.5`
  - Description matches what was entered
  - Status: `PENDING` (visible as a colored badge — yellow)
  - Created by: Rajesh Kumar
  - Created date: today
- ✅ TimeEntry record exists in DB with:
  - `recordId = <ticket ID>`
  - `agentId = <Rajesh's agent ID>` OR `userId = <Rajesh's user ID>` (verify which the schema uses; per CLAUDE.md, Comment.authorId references User; assume TimeEntry follows same pattern unless confirmed otherwise)
  - `tenantId = <Intraedge tenant ID>`
  - `status = PENDING`
  - `hours = 1.5`
  - `approvedById = null`
  - `approvedAt = null`
- ✅ **Audit log entry created** with:
  - `action = TIME_ENTRY_ADD` (or equivalent — verify against `AuditAction` enum)
  - `entityType = TimeEntry` (or `ITSMRecord` if audit is ticket-level only)
  - `entityId = <time entry ID>` (or ticket ID with metadata)
  - `userId = <Rajesh's user ID>`
  - `tenantId = <Intraedge tenant ID>`
  - `metadata` includes hours and ticket reference
  - `timestamp ≈ creation time` (within 5 seconds)
- ✅ Time entry total on ticket detail updates from previous total + 1.5 hours
- ✅ No notification fires to USER (USER does not need to know about agent time entries)

**Cleanup:**
- Default: leave time entry for audit history
- Optional: delete via API if test environment is being reset

**Notes:**
- This is a unit-level scenario — tests just the time entry creation, not approval (which is BLOCKED — see 8.4).
- **[ASSUMPTION]** Time entry creation is allowed in any open ticket status (Open, In Progress, Awaiting Info). It is NOT allowed in Closed status. This scenario uses In Progress (or Open) — explicit Closed-status test would be a separate scenario.
- **[ASSUMPTION]** Audit log uses action `TIME_ENTRY_ADD`. If the actual `AuditAction` enum doesn't have this value, log as defect (similar to BUG-001 in qa_log.md — frontend/backend audit value drift).
- The COMPANY_ADMIN visibility check (Scenario 8.7) is a separate scenario, not part of this one.

---

## PART 9 — Contracts & SLA Configuration

| # | Scenario | Status |
| --- | --- | --- |
| 9.1 | New customer + contract + SLA policy | Stub |
| 9.2 | Customer-specific SLA applied to tickets | Stub |

---

## PART 10 — Audit Trail (eliminated as standalone)

**Per session decision (April 27):** Audit log assertions are baked into the relevant scenarios above (Part 2, Part 8, etc.). The only standalone audit scenarios live in Part 1 (Authentication & Authorization):

- 1.7 — Non-admin roles cannot access GET /audit endpoint
- 1.8 — SUPER_ADMIN and COMPANY_ADMIN can view Audit Page

Therefore Part 10 has no scenarios of its own and serves only as a navigational anchor.

---

## Open questions for next session

These are decisions or verifications needed before the corresponding scenarios can be drafted:

1. Exact `AuditAction` enum values — verify against `backend/prisma/schema.prisma` to make audit assertions precise (related to BUG-001 in qa_log.md)
2. Reopen window length (Scenario 2.8) — find in code: `record.routes.ts` or service layer
3. Notification email templates — confirm subject lines and body content for each event in Reference 2
4. SMTP configuration in dev/staging — is it configured? If not, all email assertions are "unverified" by default
5. Whether `TimeEntry.userId` or `TimeEntry.agentId` is the foreign key (affects Scenario 8.1 expected DB state)
6. Closed ticket time-entry behavior — is creation blocked, allowed but flagged, or silently allowed?

---

*— End of business_scenarios.md —*
