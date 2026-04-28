# Design Document — Master Data Seed v1

**Scope:** Establish a proper master-data foundation for ServiceDeskPro's intelligence and SLA features. Tier templates for `SupportTypeMaster` and `SLAPolicyMaster`. US + India holiday calendars. Multi-shift coverage. Re-link the existing GlobalManufacturing contract to the new master library. Author 5 assignment rules. Add `Agent.shiftId` so agents have explicit working windows.

**Status:** Design — not implemented. Awaiting approval.

**Predecessor pattern:** [issue-pattern-detection-v1.md](./issue-pattern-detection-v1.md). This doc follows the same structural conventions: numbered sections, concrete data tables, calibration step, deferred list, open questions, implementation plan footer.

---

## 1. Goals and non-goals

### Goals
- Establish multi-tier `SupportTypeMaster` library — 5 tiers (Standard, Standard Plus, Premium, Premium Plus, On-Call) so the Contract form has a real menu instead of a single option.
- Establish multi-tier `SLAPolicyMaster` library — 4 tiers (Gold Standard, Silver Standard, Bronze Standard, Bronze P1-Only) so contracts can be priced against real service tiers.
- Seed two `HolidayCalendar`s — US 2026 (11 federal holidays) and India 2026 (8 national holidays) so SLA logic can pause on non-working days.
- Seed 4 `Shift`s — India Day (09-18 IST), 2 PM IST (14-23 IST), US East (09-18 EDT), 24x7 — so coverage windows are explicit and follow-the-sun handoff is modelable.
- Re-link the existing `CON-2026-GLAG-001` contract in place to reference the new masters (Premium Plus support + Silver Standard SLA + 2 PM IST shift + US 2026 calendar).
- Add `Agent.shiftId` (nullable FK) so each agent has a defined working window beyond their assigned customer's contract shift.
- Author 5 `AssignmentRule`s — one per SAP module (FICO/MM/SD/PP) plus a P1 PM-notification rule — so smart routing is no longer dormant.
- Honor the *masters as single source of truth* principle: every consumer (Contract, Agent, AssignmentRule) selects from masters via FK only.

### Non-goals (deferred)
- **Contract form refactor** — verifying that `ContractFormPage.tsx` uses dropdowns of existing masters and never allows free-text override of SLA/SupportType/Shift values. **Verified separately, separate session.**
- **`AgentAvailability` / PTO model** — no schema home for vacations or per-agent time-off windows. Out of scope.
- **Multi-shift agent support** — `Agent.shiftId` is single-FK in this design. An agent transitioning between shifts can't be modeled. Out of scope.
- **Append-only / referential-integrity enforcement in admin UI** — SUPER_ADMIN should be warned before deleting a master row referenced by other tables. Out of scope.
- **`master.isActive` filtering in dropdowns** — Contract form should hide deactivated masters from pickers. Out of scope.
- **Transaction seed (tickets, time entries, comments, audit logs)** — already owned by `ams-seed.ts`. This work touches masters only.

---

## 2. Schema change

### 2.1 Add `Agent.shiftId`

```prisma
model Agent {
  // ... existing fields ...
  shiftId   String?   @map("shift_id")
  shift     Shift?    @relation(fields: [shiftId], references: [id])
  // ... existing relations ...
}

model Shift {
  // ... existing fields ...
  agents    Agent[]
  // ... existing relations (contracts ContractShift[]) ...
}
```

**Why nullable:** existing 18 agents on Railway would FAIL on a non-null column unless every row is updated atomically. Nullable allows `prisma db push` to apply cleanly; the seed script then populates the FK row-by-row.

**Why "purely additive":** no column drops, no type changes, no constraint changes. Per CLAUDE.md hard rule #1, `db push --accept-data-loss` is the standard. With purely additive changes, the `--accept-data-loss` flag has no destructive work to do — the rule is satisfied with zero risk.

### 2.2 Master `isActive` audit

| Master | Has `isActive` boolean? | Notes |
|---|---|---|
| `SupportTypeMaster` | ✅ `Boolean @default(true)` | OK |
| `SLAPolicyMaster` | ✅ `Boolean @default(true)` | OK |
| `HolidayCalendar` | ✅ `Boolean @default(true)` | OK |
| `IssueTemplate` | ✅ `Boolean @default(true)` | OK (just shipped) |
| `Shift` | ⚠️ `status: String @default("active")` | String, not boolean. Inconsistent with peers. |

**Action:** no schema change in this seed. Flagged for future hardening (`Shift.status` → `Shift.isActive: Boolean`). The seed will treat `status === 'active'` as the equivalent of `isActive: true`.

### 2.3 Why no `SupportType.priorities` per-customer override

The schema does NOT include per-contract override fields like `Contract.customSlaMatrix` or `Contract.afterHoursOverride`. Per the *masters as single source of truth* principle (saved memory), the design rejects any future addition of such fields — a customer needing different terms gets a new `SLAPolicyMaster` row, not an inline override.

---

## 3. Master spec — concrete values

### 3.1 Customer (in-place update)

Existing `customerId` retained. Profile fields updated:

| Field | Current | New |
|---|---|---|
| `companyName` | `GlobalManufacturing AG` | `GlobalManufacturing Inc` |
| `country` | `DE` | `US` |
| `timezone` | `Europe/Berlin` | `America/New_York` |
| `industry` | `Manufacturing` | unchanged |
| `contactName` | `Klaus Weber` | unchanged (or update to a US-named contact — open question) |
| `contactEmail` | `it.admin@globalmanufacturing.de` | unchanged |

Currency is on `Contract`, not `Customer` — handled in §3.6.

### 3.2 Holiday Calendars (2 calendars, 19 dates total)

#### Calendar 1: `US 2026` — 11 US federal holidays

| Date (2026) | Day | Name |
|---|---|---|
| Jan 1 | Thu | New Year's Day |
| Jan 19 | Mon | Martin Luther King Jr. Day (3rd Mon Jan) |
| Feb 16 | Mon | Presidents' Day (3rd Mon Feb) |
| May 25 | Mon | Memorial Day (last Mon May) |
| Jun 19 | Fri | Juneteenth |
| Jul 3 | Fri | Independence Day (observed — Jul 4 is Saturday) |
| Sep 7 | Mon | Labor Day (1st Mon Sep) |
| Oct 12 | Mon | Columbus Day (2nd Mon Oct) |
| Nov 11 | Wed | Veterans Day |
| Nov 26 | Thu | Thanksgiving (4th Thu Nov) |
| Dec 25 | Fri | Christmas Day |

#### Calendar 2: `India 2026` — 8 national holidays

| Date (2026) | Day | Name |
|---|---|---|
| Jan 26 | Mon | Republic Day |
| Mar 4 | Wed | Holi |
| Mar 21 | Sat | Eid al-Fitr (approximate — verify against authoritative Hijri calendar) |
| Apr 3 | Fri | Good Friday |
| Aug 15 | Sat | Independence Day |
| Oct 2 | Fri | Gandhi Jayanti |
| Nov 8 | Sun | Diwali |
| Dec 25 | Fri | Christmas Day |

Each `HolidayDate` row defaults `supportType: NONE` (no work). Per-date overrides possible via the schema but not seeded.

### 3.3 Shifts (4 total)

Schema: `Shift` has `name`, `startTime`, `endTime`, `timezone`, `breakMinutes`, `status`. No `code` field today.

| Display name | Start | End | Timezone | Break (min) | Notes |
|---|---|---|---|---|---|
| **India Day Shift** | 09:00 | 18:00 | Asia/Kolkata | 60 | Standard 9-6 IST. (Existing "IST Business Hours" shift renamed in place — see §11 Q3.) |
| **2 PM IST Shift** | 14:00 | 23:00 | Asia/Kolkata | 60 | Overlaps US East morning (09:30-13:30 EDT) — anchor shift for follow-the-sun |
| **US East Day Shift** | 09:00 | 18:00 | America/New_York | 60 | Standard 9-6 EDT |
| **24x7 Coverage** | 00:00 | 23:59 | UTC | 0 | Continuous; intended for follow-the-sun handoff (handoff logic itself is out of scope) |

### 3.4 Support Types (5 tiers)

Reference structure (existing `EXT-PLUS` / Extended Plus):

```
workDays: [1,2,3,4,5,6], weekendCoverage: ON_CALL, holidayCoverage: NONE,
afterHoursCoverage: ON_CALL, weekendMultiplier: 2, holidayMultiplier: 2,
afterHoursMultiplier: 1.5, slaPauseConditions: ['PENDING_CUSTOMER', 'OUTSIDE_BUSINESS_HOURS'],
onCallPriorities: [], priorityScope: ALL, slaEnabled: {P1:true, P2:true, P3:true, P4:true}
```

Known enum values from existing data: `NONE`, `ON_CALL`. Other potential values (`COVERED`, `FULL`) need verification during implementation — if a needed value doesn't exist on the enum, propose schema enum extension as a separate sub-PR. The proposed values below use only `NONE` and `ON_CALL` to stay safe within the verified enum range.

#### `STD` — Standard
| Field | Value | Rationale |
|---|---|---|
| name | Standard | |
| description | Business-hours support, weekdays only | |
| workDays | `[1,2,3,4,5]` | Mon-Fri |
| weekendCoverage | `NONE` | |
| holidayCoverage | `NONE` | |
| afterHoursCoverage | `NONE` | |
| weekendMultiplier | 1 | Not used (no coverage) |
| holidayMultiplier | 1 | Not used |
| afterHoursMultiplier | 1 | Not used |
| slaPauseConditions | `[PENDING_CUSTOMER, OUTSIDE_BUSINESS_HOURS, WEEKEND, HOLIDAY]` | Pause SLA on every non-coverage condition |
| onCallPriorities | `[]` | |
| priorityScope | `ALL` | |
| slaEnabled | `{P1:true, P2:true, P3:true, P4:true}` | |

#### `STD-PLUS` — Standard Plus
| Field | Value |
|---|---|
| name | Standard Plus |
| description | Business-hours + after-hours on-call for P1 |
| workDays | `[1,2,3,4,5]` |
| weekendCoverage | `NONE` |
| holidayCoverage | `NONE` |
| afterHoursCoverage | `ON_CALL` |
| weekendMultiplier | 1 |
| holidayMultiplier | 1 |
| afterHoursMultiplier | 1.5 |
| slaPauseConditions | `[PENDING_CUSTOMER, WEEKEND, HOLIDAY]` |
| onCallPriorities | `[P1]` |
| priorityScope | `ALL` |
| slaEnabled | `{P1:true, P2:true, P3:true, P4:true}` |

#### `PREM` — Premium
| Field | Value |
|---|---|
| name | Premium |
| description | 6-day support + after-hours on-call P1/P2 |
| workDays | `[1,2,3,4,5,6]` (Mon-Sat) |
| weekendCoverage | `ON_CALL` (Sundays) |
| holidayCoverage | `NONE` |
| afterHoursCoverage | `ON_CALL` |
| weekendMultiplier | 1.5 |
| holidayMultiplier | 2 |
| afterHoursMultiplier | 1.5 |
| slaPauseConditions | `[PENDING_CUSTOMER, HOLIDAY]` |
| onCallPriorities | `[P1, P2]` |
| priorityScope | `ALL` |
| slaEnabled | `{P1:true, P2:true, P3:true, P4:true}` |

#### `PREM-PLUS` — Premium Plus
| Field | Value |
|---|---|
| name | Premium Plus |
| description | 6-day full + 24/7 on-call for P1/P2 + holiday coverage |
| workDays | `[1,2,3,4,5,6]` |
| weekendCoverage | `ON_CALL` |
| holidayCoverage | `ON_CALL` |
| afterHoursCoverage | `ON_CALL` |
| weekendMultiplier | 1.5 |
| holidayMultiplier | 1.5 |
| afterHoursMultiplier | 1.25 |
| slaPauseConditions | `[PENDING_CUSTOMER]` |
| onCallPriorities | `[P1, P2]` |
| priorityScope | `ALL` |
| slaEnabled | `{P1:true, P2:true, P3:true, P4:true}` |

#### `ON-CALL` — On-Call (24/7)
| Field | Value |
|---|---|
| name | On-Call |
| description | 24/7 coverage for all priorities |
| workDays | `[1,2,3,4,5,6,7]` |
| weekendCoverage | `ON_CALL` |
| holidayCoverage | `ON_CALL` |
| afterHoursCoverage | `ON_CALL` |
| weekendMultiplier | 1 |
| holidayMultiplier | 1 |
| afterHoursMultiplier | 1 |
| slaPauseConditions | `[PENDING_CUSTOMER]` |
| onCallPriorities | `[P1, P2, P3, P4]` |
| priorityScope | `ALL` |
| slaEnabled | `{P1:true, P2:true, P3:true, P4:true}` |

### 3.5 SLA Policies (4 tiers)

Storage: minutes (existing `SLAPolicyMaster.priorities` JSON convention). Display: human-readable (§4).

#### `GOLD-STD` — Gold Standard
```
P1: response 15 min,  resolution 240 min  (4 hr)
P2: response 60 min,  resolution 480 min  (8 hr)
P3: response 240 min, resolution 1440 min (24 hr / 1 day)
P4: response 480 min, resolution 2880 min (48 hr / 2 days)

priorities = {
  P1: { response: 15,  resolution: 240 },
  P2: { response: 60,  resolution: 480 },
  P3: { response: 240, resolution: 1440 },
  P4: { response: 480, resolution: 2880 }
}
warningThreshold = 0.8
color = '#fbbf24' (gold)
```

#### `SILVER-STD` — Silver Standard
```
P1: response 60 min,    resolution 480 min   (8 hr)
P2: response 240 min,   resolution 1440 min  (24 hr / 1 day)
P3: response 480 min,   resolution 4320 min  (72 hr / 3 days)
P4: response 1440 min,  resolution 7200 min  (5 days)

priorities = {
  P1: { response: 60,    resolution: 480 },
  P2: { response: 240,   resolution: 1440 },
  P3: { response: 480,   resolution: 4320 },
  P4: { response: 1440,  resolution: 7200 }
}
warningThreshold = 0.8
color = '#94a3b8' (silver)
```

#### `BRONZE-STD` — Bronze Standard
```
P1: response 240 min,   resolution 1440 min  (24 hr / 1 day)
P2: response 480 min,   resolution 2880 min  (48 hr / 2 days)
P3: response 1440 min,  resolution 7200 min  (5 days)
P4: response 2880 min,  resolution 14400 min (10 days)

priorities = {
  P1: { response: 240,   resolution: 1440 },
  P2: { response: 480,   resolution: 2880 },
  P3: { response: 1440,  resolution: 7200 },
  P4: { response: 2880,  resolution: 14400 }
}
warningThreshold = 0.8
color = '#cd7f32' (bronze)
```

#### `BRONZE-P1` — Bronze P1-Only
```
P1: response 240 min, resolution 1440 min (24 hr / 1 day)
P2-P4: not applicable (key absent from priorities JSON)

priorities = {
  P1: { response: 240, resolution: 1440 }
}
warningThreshold = 0.8
color = '#cd7f32'
```

For P2-P4, only the `P1` key is present in the JSON. SLA tracking logic must handle "priority not in policy" cleanly — if a P3 ticket is created against `BRONZE-P1`, the system must either (a) skip SLA tracking for that ticket entirely, (b) emit a warning and use a default best-effort value, or (c) raise a config error. **Open question §11 Q5** — verify current behavior in `slaTracking` creation logic.

### 3.6 Contract — in-place update of `CON-2026-GLAG-001`

| Field | Current | New |
|---|---|---|
| `contractNumber` | `CON-2026-GLAG-001` | unchanged |
| `customerId` | (existing AG id) | unchanged |
| `supportTypeMasterId` | EXT-PLUS id | **PREM-PLUS id** |
| `slaPolicyMasterId` | GOLD-AMS id | **SILVER-STD id** |
| `currency` | `EUR` | `USD` |
| `billingAmount` | `180000` | `180000` (no re-pricing in this seed — flag §11 Q4) |
| `startDate` | `2026-01-01` | unchanged |
| `endDate` | `2026-12-31` | unchanged |
| `autoRenewal` | `true` | unchanged |
| `renewalNoticeDays` | `60` | unchanged |

#### ContractShift link (in-place update)
The single existing `ContractShift` row (pointing at "IST Business Hours" / IND-DAY) is **replaced** with one pointing at the new `2 PM IST Shift`. Delete the old row, insert the new — both within a transaction.

#### ContractHolidayCalendar link (new)
Add link from contract → `US 2026` calendar. (The customer is now US-based; holiday tracking aligns with US dates.)

### 3.7 Agents — assign shifts (5 agents)

Existing 5 agents (in DB via AMS seed) get `shiftId` populated:

| User email | Role | Shift | Reason |
|---|---|---|---|
| `priya.sharma@intraedge.com` | Project Manager | India Day Shift | PM works standard hours, supervises team |
| `rajesh.kumar@intraedge.com` | FICO Agent (L3) | 2 PM IST Shift | Anchors US-overlap window |
| `anitha.reddy@intraedge.com` | MM Agent (L3) | 2 PM IST Shift | Same |
| `vikram.nair@intraedge.com` | SD Agent (L3) | 2 PM IST Shift | Same |
| `deepa.menon@intraedge.com` | PP Agent (L3) | 2 PM IST Shift | Same |

Each `Agent.shiftId` populated via the new column. Update by `userId` (which is unique per Agent).

### 3.8 CustomerAgent — verify, no change

The 4 specialists + PM are already linked to GlobalManufacturing AG via `CustomerAgent` rows from AMS seed. This seed step verifies these links still exist post-update; no insertion needed unless missing. (If missing — log a warning, recreate from a hardcoded list, but don't fail the seed.)

### 3.9 AssignmentRule — 5 rules

Working from the schema (`AssignmentRule` at line 290 in `schema.prisma`); field-level structure to be verified during implementation.

| Code | Trigger | Action |
|---|---|---|
| `RULE-FICO-AUTO` | New ticket, customer = GlobalMfg, sapModule = FICO | Auto-assign to `rajesh.kumar` |
| `RULE-MM-AUTO` | New ticket, customer = GlobalMfg, sapModule = MM | Auto-assign to `anitha.reddy` |
| `RULE-SD-AUTO` | New ticket, customer = GlobalMfg, sapModule = SD | Auto-assign to `vikram.nair` |
| `RULE-PP-AUTO` | New ticket, customer = GlobalMfg, sapModule = PP | Auto-assign to `deepa.menon` |
| `RULE-P1-PM-NOTIFY` | Any P1 ticket on this customer | **Notify** PM `priya.sharma` (assignment of agent stays per module rules) |

**Open question §11 Q6:** does current `AssignmentRule` schema cleanly support both "assign-to-agent" and "notify-without-assigning" semantics in the same model? If not, rule 5 may need a different shape (e.g., a separate `NotificationRule` row). Verify before authoring.

---

## 4. SLA tracking units

**Storage:** minutes (existing `SLAPolicyMaster.priorities` JSON convention). No schema change.

**Display:** human-readable, computed UI-side. Suggested formatter:

| Stored (min) | Displayed |
|---|---|
| `< 60` | `"{N} min"` (e.g. "15 min") |
| `60 to 1439` | `"{N/60} hrs"` (e.g. "4 hrs", "8 hrs", "1 day" if exactly 1440 → see next row) |
| `>= 1440` | `"{N/1440} days"` (e.g. "5 days", "10 days") |

This is a UI concern only. Backend storage stays as integers in minutes. No new fields, no migrations, no API change. The formatter lives in `frontend/src/utils/format.ts` (or similar) and is called from contract detail / SLA report / pattern detection cards wherever minutes are rendered today.

---

## 5. Idempotency strategy

Each seed step uses `prisma.upsert` keyed on a stable identifier:

| Master | Upsert key | Rationale |
|---|---|---|
| `Customer` | by `id` (existing customer's row) | Update in place — companyName changes from AG to Inc, but id is stable |
| `HolidayCalendar` | `(tenantId, name, year)` | e.g. `('US 2026', 2026)` |
| `HolidayDate` | `(calendarId, date)` | Within each calendar |
| `Shift` | `(tenantId, name)` | Existing IST shift renamed in place; new shifts upserted by name |
| `SupportTypeMaster` | `(tenantId, code)` | Code is upper-case slug |
| `SLAPolicyMaster` | `(tenantId, code)` | |
| `Contract` | `contractNumber` (already unique) | Update in place — same id retained |
| `ContractShift` | `(contractId, shiftId)` composite key | Delete old, insert new during contract relink |
| `ContractHolidayCalendar` | `(contractId, holidayCalendarId)` composite | Insert new (none existed before) |
| `Agent` | by `userId` (unique per agent) | Update existing rows to add shiftId |
| `AssignmentRule` | `(tenantId, code)` (assuming code field exists; otherwise on `(tenantId, name)`) | |

**Re-runnable:** running the seed twice produces the same end state. No duplicates. No FK breakage.

**Existing contract `CON-2026-GLAG-001`** is updated in place — same `id`, new master FKs. The 75 existing tickets continue to point at the same `contractId` and are unaffected by the master swap. SLA computations on those tickets will use the new policy on next event/recompute.

**Existing `GOLD-AMS` SLA policy** stays in DB, marked `isActive: false` so it doesn't appear in dropdowns. Same with `EXT-PLUS` support type (`isActive: false`). Deactivate-not-delete pattern preserves history. Open question §11 Q1/Q2 — confirm vs alternative.

---

## 6. Implementation file structure

### Step 0 (BEFORE the seed) — Mount the orphan SLA Policy route

**Status:** 1-line fix in `backend/src/app.ts`.

The existing `slaPolicy.routes.ts` has full CRUD code (5 handlers) but is NOT mounted in `app.ts` — confirmed via `GET /api/v1/sla-policies → 404` against Railway. Without mounting, the 4 new SLA tier policies seeded by this work would be invisible to the SUPER_ADMIN UI.

```ts
// backend/src/app.ts
import slaPolicyRoutes from './api/routes/slaPolicy.routes';   // ← new import
// ...
app.use(`${API}/sla-policies`, slaPolicyRoutes);                // ← new mount
```

The route file already has `verifyJWT + enforceTenantScope` (line 7) — no auth refactor needed. Mutating routes already gated to `SUPER_ADMIN` (lines 39, 68, 84). The mount can land:
- **Before** the seed PR (preferred — verification of seeded data assumes the endpoint is reachable)
- **Alongside** the seed PR as part of the same commit (fine)
- **After** the seed PR (would block UI verification in the gap)

This is unrelated to seed work in terms of code, but a prerequisite for verifying seed results. Recommend: alongside the seed PR.

### Step 1 — Schema migration

`backend/prisma/schema.prisma` updated with `Agent.shiftId` + `Shift.agents[]` relation. Run `npx prisma db push --accept-data-loss` to apply (per CLAUDE.md hard rule #1). Run BEFORE running the seed script.

### Step 2 — `npx prisma generate`

Refresh TypeScript types so `prisma.agent.update({ data: { shiftId } })` typechecks.

### Step 3 — Seed file structure

```
backend/src/seeds/masters/
├── 01-customer.seed.ts                # in-place update of GlobalManufacturing AG → Inc
├── 02-holiday-calendars.seed.ts       # US 2026 (11 dates) + India 2026 (8 dates)
├── 03-shifts.seed.ts                  # 4 shifts (rename IST Business Hours → IND-DAY,
│                                      #          create IND-2PM, US-EAST, 24x7)
├── 04-support-types.seed.ts           # 5 tiers (STD, STD-PLUS, PREM, PREM-PLUS, ON-CALL)
│                                      #   + deactivate existing EXT-PLUS
├── 05-sla-policies.seed.ts            # 4 tiers (GOLD-STD, SILVER-STD, BRONZE-STD, BRONZE-P1)
│                                      #   + deactivate existing GOLD-AMS
├── 06-contract.seed.ts                # update CON-2026-GLAG-001 in place + ContractShift
│                                      #   + ContractHolidayCalendar
├── 07-agents.seed.ts                  # assign Agent.shiftId for the 5 AMS-seed agents
├── 08-customer-agents.seed.ts         # verify existing CustomerAgent links intact
├── 09-assignment-rules.seed.ts        # 5 rules (4 module-routing + 1 P1-notify)
└── index.ts                           # orchestrator — runs 01..09 in order
```

Each `NN-X.seed.ts` exports `async function seedX(prisma): Promise<{ created, updated, skipped }>`. Each function is idempotent. The orchestrator runs them in order; each in a `try/catch` so a failure in step N doesn't roll back steps 1..N-1, but reports a clear stop point.

### Step 4 — NPM script

```json
// backend/package.json
{
  "scripts": {
    // ... existing scripts ...
    "seed:masters": "ts-node src/seeds/masters/index.ts"
  }
}
```

### File-level change inventory

| File | Action | Purpose |
|---|---|---|
| `backend/prisma/schema.prisma` | Modify | Add `Agent.shiftId` + `Shift.agents[]` relation |
| `backend/src/app.ts` | Modify | **Step 0** — mount `slaPolicyRoutes` |
| `backend/src/seeds/masters/01-customer.seed.ts` | Create | Customer in-place update |
| `backend/src/seeds/masters/02-holiday-calendars.seed.ts` | Create | US + India calendars + 19 dates |
| `backend/src/seeds/masters/03-shifts.seed.ts` | Create | 4 shift definitions |
| `backend/src/seeds/masters/04-support-types.seed.ts` | Create | 5 tiers + deactivate EXT-PLUS |
| `backend/src/seeds/masters/05-sla-policies.seed.ts` | Create | 4 tiers + deactivate GOLD-AMS |
| `backend/src/seeds/masters/06-contract.seed.ts` | Create | Contract relink + shift/holiday links |
| `backend/src/seeds/masters/07-agents.seed.ts` | Create | Agent shift assignment |
| `backend/src/seeds/masters/08-customer-agents.seed.ts` | Create | Verify CustomerAgent links |
| `backend/src/seeds/masters/09-assignment-rules.seed.ts` | Create | 5 assignment rules |
| `backend/src/seeds/masters/index.ts` | Create | Orchestrator + per-step logging |
| `backend/package.json` | Modify | Add `seed:masters` script |
| `CLAUDE.md` | Modify | Status section — "Master Data Seed v1 shipped" |

Estimated lines: ~700 (10 small files + orchestrator + minor edits).

---

## 7. Bootstrap mechanism

**Standalone CLI invocation. NOT auto-on-boot.**

```bash
# Local
cd backend
DATABASE_URL="postgresql://localhost:5432/itsm" npm run seed:masters

# Against Railway-staging (using the .env.seedrun pattern from earlier work)
cd backend
set -a && source .env.seedrun && set +a && npm run seed:masters
```

**Why not auto-on-boot:** masters change rarely. `IssueTemplate` is auto-bootstrapped because templates are factory defaults that should never drift from code. Master tier definitions, by contrast, may be customized per deployment (one tenant adds a "Diamond" tier; another renames "Bronze" to "Basic"). Auto-bootstrapping would either clobber those edits or require a `manuallyEdited` flag mechanic on every master — disproportionate for v1.

The script is re-runnable safely (per §5), so re-running after env changes or DB resets is the supported recovery path.

---

## 8. Pre-merge calibration

Before the PR merges, run the seed against a test DB (or Railway staging) and verify:

### 8.1 Master row counts

| Master | Before | After expected |
|---|---|---|
| `Customer` (GlobalManufacturing) | 1 (companyName=AG) | 1 (companyName=Inc, country=US, timezone=America/New_York) — same id |
| `HolidayCalendar` | 0 | 2 (US 2026, India 2026) |
| `HolidayDate` | 0 | 19 (11 + 8) |
| `Shift` | 1 | 4 (IND-DAY renamed, IND-2PM new, US-EAST new, 24x7 new) |
| `SupportTypeMaster` (active) | 1 (EXT-PLUS) | 5 active (STD, STD-PLUS, PREM, PREM-PLUS, ON-CALL) + 1 inactive (EXT-PLUS) |
| `SLAPolicyMaster` (active) | 1 (GOLD-AMS) | 4 active (GOLD-STD, SILVER-STD, BRONZE-STD, BRONZE-P1) + 1 inactive (GOLD-AMS) |
| `Contract` | 1 (CON-2026-GLAG-001) | 1 — same id, updated FKs |
| `ContractShift` | 1 | 1 (re-pointed to IND-2PM) |
| `ContractHolidayCalendar` | 0 | 1 (US 2026 link) |
| `Agent.shiftId` populated | 0 / 5 | 5 / 5 |
| `AssignmentRule` | 0 | 5 |

### 8.2 Contract correctness

```
GET /api/v1/contracts/<id>
  → supportTypeMaster.code === 'PREM-PLUS'
  → slaPolicyMaster.code === 'SILVER-STD'
  → shifts[0].shift.name === '2 PM IST Shift'
  → holidayCalendars[0].holidayCalendar.name === 'US 2026'
  → currency === 'USD'
```

### 8.3 SLA Policy reachable (post Step 0)

```
GET /api/v1/sla-policies
  → HTTP 200
  → 4 active policies (GOLD-STD, SILVER-STD, BRONZE-STD, BRONZE-P1)
  → 1 inactive (GOLD-AMS)
```

### 8.4 Agent shift assignments

```
GET /api/v1/agents
  → priya.sharma.shift.name === 'India Day Shift'
  → rajesh.kumar.shift.name === '2 PM IST Shift'
  → anitha.reddy.shift.name === '2 PM IST Shift'
  → vikram.nair.shift.name === '2 PM IST Shift'
  → deepa.menon.shift.name === '2 PM IST Shift'
```

### 8.5 Idempotency

Run `npm run seed:masters` twice. Second run produces the same end state. No duplicate rows. No errors. Per-step counters from the orchestrator should show: first run mostly `created`, second run mostly `updated` or `skipped`.

### 8.6 Existing tickets unaffected

```
GET /api/v1/records (count)
  → still 75 INCIDENTs

GET /api/v1/analytics/patterns?days=90
  → same 7 visible patterns as before (template detection unaffected)
  → classificationRate still 1.0
```

Pattern detection uses module/sub-module taxonomy and ticket titles — none of which the master seed touches. SLA tracking on the 75 tickets will use the new SILVER-STD policy on next recompute event.

If any check fails, iterate on the seed file before merge.

---

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Existing 75 tickets reference contract — does master swap break them? | High concern | Low impact in practice | Tickets reference `Contract` by FK only. Contract `id` doesn't change. SLA policy and support type are referenced **by the contract**, not directly by tickets. SLA recomputation on the 75 tickets will use the new policy on the next event. **No FK breakage.** |
| Existing `GOLD-AMS` SLA policy — what if other contracts/tickets reference it? | Low | Low | Only 1 contract exists; it's the one we're updating. Deactivate (`isActive: false`) GOLD-AMS rather than delete. History preserved. Future contracts pick from the new tier library. |
| Existing `EXT-PLUS` support type rename to `PREM-PLUS` | Low | Low | Don't rename — **deactivate `EXT-PLUS` (keep code), create `PREM-PLUS` as new**. Code mismatch otherwise causes upsert ambiguity. |
| Existing `IST Business Hours` shift rename to `India Day Shift` | Medium | Low | Lean: rename in place (Shift has no `code` field, only `name`; renaming `name` is the only safe edit). FKs continue to work. **Confirm via §11 Q3.** |
| Currency change `EUR → USD` on contract — affects historical billing record | Medium | Medium | The contract has `billingAmount: 180000` in EUR. Switching to USD without changing the amount means the contract is effectively re-priced. **Open question §11 Q4** — should the amount also be adjusted? Lean: keep amount, flip currency, surface for stakeholder review post-seed. |
| `Bronze P1-Only` SLA — what does the SLA tracker do for P2-P4 tickets if the policy has no entry? | Medium | Medium | Behavior of `slaTracking` creation when `priorities[priority]` is missing is unverified. **Open question §11 Q5.** Lean: skip SLA tracking row creation for those priorities; rely on best-effort behavior. Need to read `record.routes.ts` ticket-creation path to confirm. |
| Eid al-Fitr 2026 date is approximate | Low | Cosmetic | Verify against authoritative Hijri calendar before final seed. 1-day-off doesn't break logic, just shifts a single holiday. |
| Schema change `Agent.shiftId` migration — `db push --accept-data-loss` | Very low | Very low | Pure additive: nullable column, default null. `--accept-data-loss` has nothing destructive to apply. CLAUDE.md hard rule #1 satisfied. |
| `AssignmentRule` schema may not support "notify-without-assigning" cleanly | Medium | Low | Verify schema fields during implementation. If model lacks the distinction, either (a) drop rule 5 from this seed and revisit when AssignmentRule schema is extended, or (b) implement rule 5 as a `NotificationRule` instead. **Open question §11 Q6.** |
| Contract form (`ContractFormPage.tsx`) may currently allow override of master values via inline inputs, defeating the masters-as-truth principle | Unknown | Medium | Verified separately (not blocking this seed). **Open question §11 Q7** — read the form file as part of design verification. If form is correct, no work. If form allows overrides, refactor is its own session. |
| Time bombs in production code paths (`resetAndReseed` in `server.ts`, Dockerfile `db push --accept-data-loss`) | Low (gates exist) | Catastrophic if triggered | NOT addressed in this seed. Flagged for separate hardening session. This seed adds nothing new to the destructive surface. |

---

## 10. What's NOT in this seed (deferred)

- **Contract form refactor** — verifying `frontend/src/pages/ContractFormPage.tsx` uses dropdowns of existing masters, not free-text inputs. **Verified separately, separate session.** If the form is already correct (proper FK selectors), no work needed. If the audit reveals the form allows overrides, refactor is its own PR — not blocking this seed.
- **`Contract.notes` free-text field** — schema has `notes: String?` on Contract. Per the *masters as single source of truth* principle, this field is intended for **operational annotations only** ("customer prefers phone calls during Q1", "PM is on leave Dec 20-Jan 5"), NOT for inline config overrides like pasting a custom SLA matrix. **If audit reveals abuse, the fix is operator training, not removing the schema field.** The notes field stays; the rule is enforced socially and by form-level UI design (Phase 2 admin UI work).
- **`AgentAvailability` / PTO model** — no schema home for vacations or per-agent time-off windows today. Deferred.
- **Multi-shift agent support** — `Agent.shiftId` is single-FK in this design. An agent transitioning between shifts can't be modeled. Deferred.
- **Append-only / referential-integrity guards in admin UI** — SUPER_ADMIN should be warned before deleting a master row referenced by other tables (e.g., trying to delete a `SupportTypeMaster` that's used by an active contract). Deferred.
- **`master.isActive` filtering in dropdowns** — Contract form should hide deactivated masters from pickers by default. Deferred.
- **`Shift.isActive` boolean normalization** — currently `Shift.status: String @default("active")`. Inconsistent with peer masters (which use boolean `isActive`). Schema cleanup deferred.
- **Transaction seed (tickets, time entries, comments, audit logs)** — owned by `ams-seed.ts`. This work touches masters only.
- **Tier-aware billing rate model** — no `Agent.hourlyRate` or per-tier rate. TimeEntry has hours but no monetary translation. Deferred.
- **Holiday calendar customization per contract** — schema supports multiple `ContractHolidayCalendar` rows, but seed only creates one (US 2026). India calendar exists as an authored master; future contracts can link it. Deferred.

---

## 11. Open questions to confirm before coding

1. **Existing `EXT-PLUS` support type** — update in place (rename code to `PREM-PLUS`)? Or deactivate `EXT-PLUS` and create new `PREM-PLUS`? **Lean: deactivate + create new** (cleaner audit trail; existing EXT-PLUS becomes a historical record).

2. **Existing `GOLD-AMS` SLA policy** — keep as the Gold tier (rename code to `GOLD-STD`)? Or deactivate `GOLD-AMS` and create new `GOLD-STD`? **Lean: deactivate + create new** (same reasoning).

3. **Existing `IST Business Hours` shift** — rename in place to `India Day Shift` (preserves shift id + ContractShift link) or deactivate + create new? **Lean: rename in place** (Shift currently has no `code` field, only `name`; renaming `name` is the only safe change without schema modification).

4. **Customer currency change EUR → USD** — should `Contract.billingAmount` (180000) also be re-priced when currency flips? Or keep number, just change unit? **Open** — flag for stakeholder decision. Not a code question; not blocking the seed.

5. **`Bronze P1-Only` SLA — P2-P4 ticket behavior** — what does the SLA tracker do when `priorities[priority]` is missing from the policy JSON? **Action:** read `backend/src/api/routes/record.routes.ts` ticket-creation path to verify current behavior before authoring `BRONZE-P1`. **Lean:** skip SLA tracking row creation for those priorities (don't create `slaTracking` record); flag with metadata so dashboards know it was intentional.

6. **`AssignmentRule` schema** — does the existing model cleanly support both "assign-to-agent" and "notify-without-assigning" semantics, or does the P1-PM-notify rule need a different shape? **Action:** read `backend/prisma/schema.prisma` model `AssignmentRule` (lines 290+) before authoring rule 5. If the model is assignment-only, options: (a) drop rule 5 from this seed, (b) implement as `NotificationRule` instead, (c) propose schema extension as a follow-on PR.

7. **`ContractFormPage.tsx` adherence to masters-as-truth principle** — does the form use proper dropdowns from masters, or does it allow override of SLA / SupportType / Shift values via free-text inputs? **Action:** read `frontend/src/pages/ContractFormPage.tsx` as part of design verification. Read-only check; result determines whether the form-refactor session (per §10) is genuinely needed. Not blocking this seed.

8. **Eid al-Fitr 2026 date** — proposed `Mar 21` (approximate). Verify against authoritative 2026 Islamic calendar before merge. **Action:** quick lookup or defer to authoritative source. Cosmetic if 1-day-off, but worth getting right.

9. **Customer contact name** — current `contactName: 'Klaus Weber'` (German name) becomes incongruous when the customer is `GlobalManufacturing Inc, US`. Update to a US-named contact, or leave (Klaus could conceivably be working US operations)? **Open** — non-functional but inconsistent.

---

## Implementation plan once approved

Single PR, single deploy:

1. **Step 0** — Mount orphan SLA route (1-line `app.ts` change). Verify `GET /api/v1/sla-policies → 200` (currently 404).
2. **Schema change** — add `Agent.shiftId` + `Shift.agents[]` relation. Run `npx prisma db push --accept-data-loss`.
3. **`npx prisma generate`** — refresh TypeScript types.
4. **Author 9 seed files + index.ts + npm script.**
5. **Pre-merge calibration** — run `npm run seed:masters` against Railway-staging via `.env.seedrun`. Verify §8.1-8.6.
6. If calibration green: commit + push. Railway auto-deploys backend. **Seed remains a CLI artifact** (NOT auto-run on boot).
7. **Manual post-deploy step** — run `npm run seed:masters` against the deployed Railway DB to populate the masters. Same `.env.seedrun` pattern.
8. **Post-deploy verification** — hit the API endpoints from §8 to confirm.

Estimated coding effort: 1.5-2 sessions.

---

*— End of design document. Phase 2 (Contract form refactor verification, additional masters like AgentAvailability, append-only enforcement) deferred until v1 has been used in real customer onboarding.*
