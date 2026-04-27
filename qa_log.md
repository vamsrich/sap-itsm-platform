# ServiceDeskPro — QA Defect Log

This file is the running defect log for ServiceDeskPro QA passes. The QA agent writes entries here when scenarios from `business_scenarios.md` fail. Humans (the product owner / dev team) update `Status` and `Fix direction` as bugs move through the development cycle.

## How this file is used

- The QA agent appends new entries during scenario execution.
- The agent groups entries by **QA Pass** — a single session of testing where multiple scenarios may run.
- Each defect gets a sequential `BUG-NNN` ID. IDs never get reused, even after a bug is closed.
- Status changes (Open → In Progress → Fixed → Retest → Closed) are made by humans, not the agent.

## Status values

- **Open** — Newly logged, not yet picked up by a developer
- **In Progress** — A developer is actively fixing
- **Fixed** — Code change made, awaiting QA verification
- **Retest** — Scheduled for re-running through the QA agent
- **Closed** — Verified fixed via re-test
- **Deferred** — Acknowledged but not prioritized for current cycle

## Severity values

- **Critical** — System unusable or data loss; production blocker
- **High** — Major functionality broken; workaround exists or affects subset of users
- **Medium** — Functionality partially broken or incorrect; manageable workaround
- **Low** — Cosmetic or edge case; doesn't impact normal operation

---

## QA Pass 0 — Pre-existing defects (filed during catalog drafting, April 27)

Test basis:
- Defects identified during code investigation, not via scenario execution
- No fresh QA-created data needed; defects are in code/configuration

### BUG-001

- **Status:** Open
- **Severity:** Low
- **Area:** Audit Log / Frontend
- **Title:** AuditPage filter options don't match schema enum — filtering by these returns silently empty results

**Scenario:**
- Surfaced during code investigation. Not yet covered by a scenario in `business_scenarios.md`. Will be covered when Scenario 1.8 (SUPER_ADMIN/COMPANY_ADMIN can view Audit Page) is drafted in detail.

**Steps to reproduce:**
1. Log in as `admin@intraedge.com` (SUPER_ADMIN)
2. Navigate to Audit Page (`frontend/src/pages/AuditPage.tsx`)
3. Open the "Action" filter dropdown
4. Select one of: `TIME_ENTRY`, `LOGIN_FAILED`, `PASSWORD_CHANGE`, `SLA_BREACH`
5. Apply the filter

**Expected result:**
- Audit log entries matching the selected action appear (or a clear "no results" message)
- The filter values offered should match the actual `AuditAction` enum in `backend/prisma/schema.prisma`

**Actual result:**
- Filter applies but always returns zero results
- Frontend offers filter values (`TIME_ENTRY`, `LOGIN_FAILED`, `PASSWORD_CHANGE`, `SLA_BREACH`) that do not exist in the backend schema's `AuditAction` enum
- Closest existing enum values are `BREACH` and `SLA_WARNING`
- No error shown — silent empty-result state misleads the user

**Impact:**
- Cosmetic but misleading. SUPER_ADMIN / COMPANY_ADMIN may believe no audit activity occurred when filtering by these values, when in reality the filter is invalid.
- Affects troubleshooting workflows (e.g., "show me all login failures") that simply don't work.

**Fix direction:**
- Sync the AuditPage filter dropdown options with the backend `AuditAction` enum
- Either: (a) remove the unsupported values from the dropdown, or (b) add corresponding values to the schema enum + migration if those events should be audited
- Add a runtime check (or codegen) to prevent frontend/backend drift in enum-backed filters

### BUG-002

- **Status:** Open
- **Severity:** Medium
- **Area:** Time Entry / Frontend
- **Title:** Time entry approve/reject UI doesn't exist — backend API works but no UI calls it

**Scenario:**
- Surfaced during code investigation while preparing Scenarios 8.4 and 8.5
- Blocks Scenarios 8.4 (PM approves time entry) and 8.5 (PM rejects time entry) from being run via the UI

**Steps to reproduce:**
1. Backend has working endpoint: `PATCH /records/:id/time-entry/:entryId` with body `{status: 'APPROVED' | 'REJECTED'}`
2. Endpoint is restricted to SUPER_ADMIN, COMPANY_ADMIN, PROJECT_MANAGER (correct)
3. Endpoint stamps `approvedById` from JWT and `approvedAt = now` (correct)
4. Log in as PROJECT_MANAGER (`priya.sharma@intraedge.com`)
5. Navigate to a ticket that has at least one time entry in `PENDING` status
6. Look for an "Approve" or "Reject" button on each pending time entry

**Expected result:**
- "Approve" and "Reject" buttons visible to SUPER_ADMIN / COMPANY_ADMIN / PROJECT_MANAGER on each PENDING time entry
- Clicking either button calls the backend endpoint and updates the entry's status
- AGENT receives notification of approval or rejection (per Reference 2 in `business_scenarios.md`)

**Actual result:**
- No "Approve" or "Reject" UI elements anywhere in the frontend
- `frontend/src/pages/RecordDetailPage.tsx` shows a status badge for time entries (PENDING/APPROVED/REJECTED) but offers no action buttons
- `frontend/src/api/services.ts` has no `approveTimeEntry` or similar function
- A user wanting to approve must hit the API directly via curl/Postman — not realistic
- The status badge implies the workflow is complete, which is misleading

**Impact:**
- Time entry approval workflow is non-functional from a user perspective
- Backend capability exists but is unreachable through normal UI
- Customer billing or PM oversight that depends on approved time entries is blocked
- Status badge gives false impression of feature completeness

**Fix direction:**
- Add "Approve" and "Reject" buttons to time-entry rows on `RecordDetailPage.tsx`, visible only to roles allowed by the backend (SUPER_ADMIN, COMPANY_ADMIN, PROJECT_MANAGER)
- Reject button should prompt for a rejection reason (free-text comment) and pass it to the API
- Wire to a new `approveTimeEntry(recordId, entryId, status, reason?)` function in `services.ts`
- After action, refresh the time entry list and show success toast
- Verify post-action: AGENT receives notification per Reference 2

---

## QA Pass 1 — First agent-driven run (April 27)

Test basis:
- First session of agent-driven execution against the catalog
- Backend port: `localhost:4000` (qa-runner.md had `:3000` baked in; corrected in commit `a0b4338`)
- Defects found get logged here with sequential `BUG-NNN` IDs continuing from BUG-002
- Format for defect entries follows BUG-001 / BUG-002 above

### Skipped runs

Scenarios that could not be executed due to environment / precondition gaps. These are NOT defects — they're environment notes.

| Run timestamp (UTC) | Scenario | Mode | Reason |
| --- | --- | --- | --- |
| 2026-04-27T04:58:49Z | 2.1 — Ticket creation + initial notifications | manual-guided | Backend not running on `localhost:4000` (connect refused on `/api/v1/health`). Operator chose to abort rather than start backend. |

---

## Future passes

Each subsequent agent run gets a new "QA Pass N" section with fresh test basis (test users, test customer, fresh QA-created data). Existing bugs from prior passes are referenced by ID, not duplicated.

---

*— End of qa_log.md —*
