# ServiceDeskPro — v37 Handover

**Successor to:** v34, v35, v36 handover documents (the latter referenced in CLAUDE.md but never committed to the repo). This is the first handover landed inside the repository itself.

**Date:** 2026-04-28
**Tip-of-main commit:** `e4f7388`
**Author:** Claude Code session, signed off by vamsrich

---

## What this is

A point-in-time snapshot of ServiceDeskPro's state after a productive session that landed two substantive features (Pattern Detection v1, Master Data Seed v1), recovered from a data-loss incident, established testing infrastructure, and verified an architectural compliance question. Use this document plus `CLAUDE.md` as the cold-start context for the next session.

The earlier v34/v35/v36 docs lived as separate Word/PDF artifacts outside the repo. From v37 onward, handovers commit alongside code so they're versioned, diff-able, and cold-start-readable without external uploads.

---

## Project snapshot

| Item | Value |
|---|---|
| Repo | github.com/vamsrich/sap-itsm-platform |
| Branch | `main` |
| Frontend (Railway dev/staging) | https://sap-itsm-platform-production.up.railway.app |
| Backend (Railway dev/staging) | https://servicedesk-production-f664.up.railway.app |
| Database | Railway PostgreSQL (proxy.rlwy.net) |
| Tenant | Intraedge (slug: `intraedge`) |
| Active customer | GlobalManufacturing Inc (US, America/New_York, USD) — was "GlobalManufacturing AG" in DE/EUR pre-master-seed |
| Active contract | CON-2026-GLAG-001 — PREM-PLUS support + SILVER-STD SLA + 2 PM IST shift + US 2026 holidays + USD |
| Tickets in DB | 75 INCIDENTs (from AMS seed) — unchanged structurally; SLA recompute on next event uses SILVER-STD priorities |
| Backend health | ✅ `GET /health` → 200 |
| `AMS_SEED_ON_BOOT` | `false` (verified) |

---

## What was done since v36

In rough chronological order through the session.

### 1. Foundation tooling (commits `bdbbe74`, `89d0287`, `a0b4338`, `7ae9bdd`)

- **QA scenario catalog skeleton** authored at `business_scenarios.md` — 10 parts, 2 reference scenarios detailed (2.1 Ticket Creation, 8.1 Time Entry Logging), the rest as stubs. Defect log at `qa_log.md` initialized with BUG-001 (audit page filter enum drift) and BUG-002 (time-entry approve/reject UI missing).
- **`qa-runner` agent definition** at `.claude/agents/qa-runner.md` — drives scenario execution, can hit Railway or localhost, refuses real production, stays scoped to authored scenarios.
- **Local port correction** — `qa-runner.md` originally hardcoded `localhost:3000`; corrected to `:4000` to match the actual backend dev port.
- **Railway-as-staging clarification** — multiple files were treating Railway URLs as production-untouchable. Pinned the design fact: Railway IS dev/staging despite the "production" subdomain label. The qa-runner agent now permits Railway testing.

### 2. Playwright e2e foundation (commit `eda708e`)

- `@playwright/test ^1.59.1` + Chromium binaries installed.
- `frontend/playwright.config.ts` configured: Railway as default `BASE_URL`, HTML + JSON + list reporters, screenshots on failure, retries in CI.
- Login helper at `frontend/tests/lib/auth.ts` for all 9 AMS-seed users.
- Smoke test at `frontend/tests/smoke.spec.ts` — Railway reachable + USER login.
- npm scripts: `test:e2e`, `test:e2e:headed`, `test:e2e:debug`.
- `tests/reports/` gitignored.

### 3. Smoke test hardening (commit `42c110c`)

The original smoke test was a false positive — it waited for `!url.pathname.includes('login')`, which the LoginPage form's URL `/` already satisfied. The test passed on a mid-submit page.

- Replaced with deterministic `waitForURL(/\/dashboard/)` (LoginPage hardcodes `navigate('/dashboard')` post-success).
- Added DOM assertion: `getByRole('link', { name: 'Dashboard' })` visible.
- Added loader-clear assertion: `loading your tickets` text becomes hidden — necessary because `<LoadingSpinner fullscreen>` overlays the AppLayout header for a few seconds during data fetch.
- Verified with a deliberate negative run (`wrong-password`): test fails cleanly with `waitForURL` timeout.
- Switched password selector to `input[placeholder="••••••••"]` to survive the eye-toggle.

### 4. SUPER_ADMIN credentials drift fix (commit `16778fb`)

`CLAUDE.md` and `business_scenarios.md` documented `admin@intraedge.com / Admin@123` for SUPER_ADMIN. Reality on Railway is `Admin@123456` (set by AMS seed). Docs corrected.

### 5. Issue Pattern Detection v1 ⭐ (commit `84fb739`)

**The biggest semantic change in this session.**

The previous `/analytics/patterns` endpoint did pure-categorical `GROUP BY (sapModuleId, sapSubModuleId)` — coarse, generic clusters. Replaced with a two-pass classifier:

- **Pass 1 — DB-backed `IssueTemplate` library (27 templates)**
  - 4 anchor tier templates (FICO F110, MM GR/MIGO, SD Pricing, PP MRP)
  - 23 secondary templates covering FICO/MM/SD/PP issue families
  - SAP-domain-aware keywords (T-codes like ME21N, MIGO, CO11N, KO88, F110, F-28, F-30, KP06, MI01, MIRO; canonical process terms like "document splitting", "transfer of requirement", "physical inventory", "stock transfer order")
  - Mutual exclusion via `not` clauses keeps siblings separated (Production Order ≠ PO, Physical Inventory ≠ PO, STO ≠ PO, Print/Output ≠ Posting Errors)
- **Pass 2 — Jaccard clustering on the unclassified bucket** (default threshold 0.5)
- **Storage:** `IssueTemplate` table (tenant-scoped, `enterpriseSystemId` nullable for future multi-system shift, `manuallyEdited` flag for Phase-2 SA editing)
- **Bootstrap:** auto-on-boot in `server.ts`, idempotent, preserves SA edits via `manuallyEdited=true && isSystemSeed=true` rule
- **Calibrated against Railway data:** 100% classification rate (58/58 INCIDENTs), 0 anchor failures, 7 visible patterns at default threshold of 3
- **Read-only admin endpoints:** `GET /api/v1/admin/issue-templates`, `/:id`, `/:id/matches` (SUPER_ADMIN/COMPANY_ADMIN)
- **Frontend tweak:** `kind: 'emergent'` badge + label heading + tokens display added to `ClassificationPage.tsx` Patterns tab

Visible patterns surfaced for the demo:
1. F110 Payment Run Failure (7) — high
2. Pricing Condition Error (7) — high
3. MRP Run Issue (5) — medium
4. Production Order Processing (4) — low
5. GR/MIGO Posting Error (3) — low
6. PO Creation Issue (3) — low
7. Special Stock / Batch Management (3) — low

### 6. Data loss recovery (no commit — runtime DB operation)

Mid-session, AMS seed was re-run against the Railway DB (via the standalone `npx ts-node src/ams-seed.ts` invocation pattern, sourced from `.env.seedrun`). The seed was destructive in scope (wiped + recreated GlobalManufacturing's tickets/comments/audit/contracts). Seed reported 75 tickets created — slight discrepancy from the docstring claim of 82, traced to 7 tickets being PROBLEM/REQUEST type rather than INCIDENT (the docstring count was wrong, not the seed).

Postgres password was rotated post-seed. The leaked credential in chat (from inline-on-CLI invocations) is now invalid. `.env.seedrun` is the supported pattern for keeping DATABASE_URL out of chat going forward.

### 7. Master Data Seed v1 ⭐ (commit `821ba08`)

Established a proper tier library so the Contract form has a real menu and SLA computation has multi-tier policies to choose from.

**Schema change:** added `Agent.shiftId` (nullable FK to Shift) so individual agents have explicit working windows. Pure additive — `db push --accept-data-loss` had no destructive work to do.

**Orphan SLA route mounted** (`app.ts` 1-line change) — was code-complete in `slaPolicy.routes.ts` but never wired. SLA Policy Master admin page + Contract form SLA dropdown were both broken pre-mount; both fixed post-deploy.

**Single-file seed** at `backend/src/seeds/master-data-seed-new.ts` (~400 lines, idempotent, NOT auto-on-boot) populates:

| Master | Outcome |
|---|---|
| Customer | GlobalManufacturing AG → Inc (US, America/New_York). Same id retained. |
| Holiday Calendars | US 2026 (11 federal holidays) + India 2026 (8 national holidays) — 19 dates total |
| Shifts | Renamed IST Business Hours → India Day Shift; created 2 PM IST, US East, 24x7 (4 total) |
| Support Types | 5 active tiers (STD, STD-PLUS, PREM, PREM-PLUS, ON-CALL); EXT-PLUS deactivated |
| SLA Policies | 4 active tiers (GOLD-STD, SILVER-STD, BRONZE-STD, BRONZE-P1); GOLD-AMS deactivated |
| Contract `CON-2026-GLAG-001` | Relinked: PREM-PLUS + SILVER-STD + 2 PM IST + US 2026 + USD. Same id retained. |
| Agent.shiftId | All 5 agents populated (PM on India Day, 4 specialists on 2 PM IST) |
| Assignment Rules | 4 module-routing rules (FICO/MM/SD/PP → AUTO_ASSIGN to L3 specialist) |

**Design doc:** `docs/design/master-data-seed-v1.md`

**Why P1 PM-notify rule was dropped:** `AssignmentRule.assignmentMode` schema supports `AUTO_ASSIGN/RECOMMEND/ROUND_ROBIN` only — no `NOTIFY_ONLY` mode. P1 PM notification belongs in `NotificationRule` (which has 34 live rows already from a prior admin-endpoint seed). Schema gap; not fixed in this seed.

### 8. Contract form verification (commit `e4f7388`)

End-to-end audit of `frontend/src/pages/ContractFormPage.tsx` confirmed it complies with the *masters as single source of truth* design principle (saved to memory as `feedback_masters_single_source_of_truth.md`):

| Master | Picker type | Inline override? |
|---|---|---|
| Support Type | `<select>` (FK only, filtered to `isActive: true`) | None — read-only preview only |
| SLA Policy | `<select>` (FK only, filtered to `isActive: true`) | None — read-only priorities table |
| Shifts | Multi-checkbox (FK only, filtered to `status === 'active'`) | None |
| Holiday Calendars | Multi-checkbox (FK only, **NOT** filtered) | None |
| Submit handler | Posts FK ids, no master row creation | N/A |

The Phase-2 contract-form refactor anticipated in the master-data-seed-v1 design doc §10 is **not needed**. Captured as a "Verification finding" in `qa_log.md` QA Pass 1.

---

## Verified current state

End-to-end checks performed against the running Railway deploy.

### Backend health

```
GET /health                                       → 200 OK
GET /api/v1/auth/login (admin@intraedge.com)      → 200 (Admin@123456)
GET /api/v1/admin/issue-templates                 → 27 templates
GET /api/v1/sla-policies                          → 200 (post-deploy of 821ba08)
GET /api/v1/analytics/patterns?days=90            → 7 patterns, 100% classification
```

### Master data on Railway

```
Customer:           GlobalManufacturing Inc (US, America/New_York)
Contract:           CON-2026-GLAG-001
   currency:        USD
   slaPolicy:       SILVER-STD (Silver Standard)
   supportType:     PREM-PLUS (Premium Plus)
   shift:           2 PM IST Shift (14:00-23:00 Asia/Kolkata)
   holidayCalendar: US 2026 (11 dates)
Shifts:             4 total (India Day, 2 PM IST, US East, 24x7)
Holiday Calendars:  2 (US 2026 / 11 dates, India 2026 / 8 dates)
Support Types:      10 active in DB (5 from this seed + 4 pre-existing duplicates + 1 inactive)
SLA Policies:       5 (4 active tiers + 1 inactive GOLD-AMS)
Assignment Rules:   4 (one per SAP module)
Agent shifts:       5/5 populated
Issue Templates:    27 (all active, all bootstrap-seeded)
Tickets:            75 INCIDENTs (unchanged from AMS seed)
```

### Frontend pages — populated post-deploy

- ✅ SLA Policy Master admin page now lists all 5 policies (was "No SLA policies yet")
- ✅ Contract form's SLA dropdown now populated (was empty)
- ✅ Patterns tab shows the 7 named patterns (was generic module groupings)
- ✅ Smoke test passing in headed mode against Railway

---

## Open backlog items

Categorized by urgency. None of these block the next session.

### Cleanup-class (cosmetic, low effort)

1. **Duplicate Support Types** — 4 active rows from prior seed/manual experiments (`BASIC`, `BASIC_PLUS`, `PREMIUM`, `ON_CALL` — underscore variants) clutter the dropdown alongside the 5 new tier templates. Manual deactivation via admin UI when convenient.
2. **Holiday Calendar picker doesn't filter `isActive`** — `ContractFormPage.tsx:344` skips the filter that other master pickers apply. Cosmetic; matters only after a calendar gets deactivated.
3. **`Shift.status: String` vs peer masters' `isActive: Boolean`** — schema inconsistency. All peer masters (SupportType, SLAPolicy, HolidayCalendar, IssueTemplate) use boolean `isActive`. Schema cleanup pass deferred.
4. **`EXT-PLUS` Support Type row's `name` field** — shows "Premium Plus" rather than the original "Extended Plus". Something in the prior history renamed it. The row is now inactive; cosmetic.

### Feature gaps (real work, not blocking)

5. **Phase 2.1 — Similar Incident finder** — backend endpoint exists (`GET /analytics/similar/:recordId`); frontend never wired. From v36 backlog, still not addressed.
6. **Phase 2.3 — Root-cause accumulation view** — wired but reported as "doesn't work" by user testing. Not investigated this session.
7. **Phase 2.4 — SLA compliance reports** — not built. Now feasible since proper SLA policy library exists.
8. **Phase 2.5 — Knowledge gap detection** — wired but reported as "empty". Not investigated this session.
9. **Phase 2 IssueTemplate editing UI** — Phase 1 shipped read-only viewer. POST/PUT/DELETE admin endpoints + admin UI deferred.
10. **`master.isActive` filter in Holiday Calendar picker** — see #2.
11. **Tier-aware billing rate model** — no `Agent.hourlyRate` or per-tier rate. TimeEntry has hours but no monetary translation. Deferred.
12. **AgentAvailability / PTO model** — no schema home for vacations or per-agent time-off windows. Deferred.

### Open defects from prior sessions

13. **BUG-001** (Open, Low) — `AuditPage` filter values (TIME_ENTRY, LOGIN_FAILED, PASSWORD_CHANGE, SLA_BREACH) don't match the backend `AuditAction` enum. Filtering by these returns silently empty results.
14. **BUG-002** (Open, Medium) — TimeEntry approve/reject UI doesn't exist. Backend `PATCH /records/:id/time-entry/:entryId` works; no frontend buttons call it. Blocks scenarios 8.4 and 8.5.

### Time bombs in production code paths (not fixed; no new ones added this session)

15. **`backend/src/server.ts:14-95`** — `resetAndReseed()` has 22 unscoped `deleteMany({})` calls across all tenants. Gated by `RESET_AND_RESEED=true && FORCE_RESET=true` env vars (or fresh DB). Deactivate-by-env-var only — schema-level safety would be better.
16. **`backend/src/ams-seed.ts:76`** — single unscoped `deleteMany({})` on `sLAPauseHistory` (all other deletes in the AMS seed are tenant-scoped). Wipes pause history across all tenants.
17. **`backend/Dockerfile:18`** — CMD runs `prisma db push --accept-data-loss` on every container boot. Schema-drift = data loss every redeploy if anyone added a column out of band.
18. **`server.ts:126`** — `redis.ping()` not wrapped in try/catch, contradicting CLAUDE.md hard rule #7. If Redis is down, bootstrap throws and container exits.
19. **4 unauthenticated admin endpoints in `app.ts`** — `POST /admin/fix-record-customers`, `POST /admin/seed-notification-rules`, `POST /admin/ams-seed`, `POST /admin/seed`. All are reachable without auth on Railway. Per CLAUDE.md hard rule #2.

Items 15-19 were flagged in v36; not introduced or worsened this session, just unchanged.

---

## Honest scorecard update — Phase 2 status

The v35 doc claimed Phase 2 was "DONE". v36 corrected to honest assessments. Updated based on this session's work:

| Phase | Item | v36 status | v37 status | Change reason |
|---|---|---|---|---|
| 2.1 | Similar incident finder | 🔴 backend OK, frontend never wired | 🔴 unchanged | Not addressed this session |
| 2.2 | Recurring pattern detection | 🟡 wired, "not accurate" | ✅ **FIXED** (Pattern Detection v1) | DB-backed templates + Jaccard, 100% classification, 7 named patterns surface |
| 2.3 | Root-cause accumulation | 🟡 wired, "doesn't work" | 🟡 unchanged | Not investigated this session |
| 2.4 | SLA compliance reports | ⚪ not built | ⚪ not built — but **now unblocked** | Master tier library exists; can be authored |
| 2.5 | Knowledge gap detection | 🟡 wired, "empty" | 🟡 unchanged | Not investigated this session |

**Net change:** Phase 2.2 moves from 🟡 to ✅. Master Data Seed v1 unblocks 2.4 future work. Other Phase 2 items unchanged.

---

## Future direction (unchanged from v36)

ServiceDeskPro is currently SAP-focused but the long-term vision is a **multi-system service desk platform**. Target systems in priority order:

1. **SAP** (current) — ECC, S/4HANA: FICO, MM, SD, PP, etc.
2. **Oracle** — E-Business Suite, Fusion / Cloud ERP
3. **NetSuite**

Beyond these three is explicitly out of scope until all three are real customer offerings.

When implemented, system definitions are **database-driven, not hardcoded**:
- `EnterpriseSystem` table stores system definitions
- SUPER_ADMIN registers new systems and defines module taxonomies
- Customers pick one or more systems
- `IssueTemplate.enterpriseSystemId` (already in schema, nullable) becomes meaningful — per-system template libraries
- AI / intelligence features must be system-aware (per-system classifier configs, per-system knowledge corpora)

The Phase 1.3 AI classification scaffold (deferred) must be designed system-aware from day one — not retrofitted.

---

## Next session plan — Transaction seed

The natural follow-on to Master Data Seed v1. Three signals on the Classification tab need transaction data to surface:

1. **MTTR by category** — `resolvedAt - createdAt` aggregated per module. Seed already populates resolvedAt; numbers will compute.
2. **Volume trend** — count current N-day vs prior N-day window per module. Already populates correctly.
3. **Cost-of-service** — sum of `TimeEntry.hours` per module. **Currently broken** because the AMS seed never creates TimeEntry rows (only deletes them as cleanup).

### Concrete scope (~3-4 hours)

- **Update `ams-seed.ts`** to add a TimeEntry-creation loop after each ticket is created/resolved. Realistic distributions: 1.5h avg per FICO/MM/SD ticket, 2.5h for PP. 1-3 entries per resolved ticket. workDate between createdAt and resolvedAt.
- **Optionally widen MTTR variance** — current seed has `resolvedDaysAgo` typically 1-2 days after `createdDaysAgo` (lab-fast). Widen to 5-10 days on ~30% of P1/P2 tickets so MTTR figures look realistic for stakeholder demos.
- **Add three new fields to `/analytics/classification` response**: per-module `mttrHours`, `mttrP50`, `mttrP90`, `effortHours`, `effortPercentOfTotal`, `trend.{current, previous, deltaPercent, direction}`.
- **Frontend redesign** of module breakdown table — primary row + secondary "scorecard line" with the new metrics.
- **3 new top-line KPIs** — Total Effort hours, Avg MTTR (all incidents), Permanent-fix coverage %.
- **Run the updated seed** against Railway (same `.env.seedrun` pattern) so the demo dashboard populates with believable numbers.

### Open design questions for the transaction seed session

1. Touch `ams-seed.ts` directly, or create a separate `transaction-seed.ts` and gradually migrate? Lean: separate file (cleaner), but `ams-seed.ts` already creates the tickets — coordinating two seeds is awkward.
2. Should TimeEntry seed populate `approvedById` / `approvedAt` to make some entries APPROVED vs PENDING (so the time-entry approval UI demo has data to act on)? Probably yes — mix of statuses.
3. Should we enable `slaApplies()` recompute on the existing 75 tickets so they pick up the new SILVER-STD priorities? Current behavior: SLA tracking on existing tickets uses whatever policy was in effect at ticket-creation time. New tickets use SILVER-STD. Worth confirming the semantics match expectations.

---

## How to resume in a new chat

1. **Read `CLAUDE.md`** — project rules, hard rules, Status section, current state.
2. **Read this file** (`docs/handovers/sap-itsm-v37-context.md`) for the session-specific context.
3. **Optionally read recent design docs:**
   - `docs/design/master-data-seed-v1.md` — for master taxonomy
   - (issue pattern detection design was inline in the chat, not committed; the seed file `backend/src/services/issue-templates.seed.ts` is the source of truth)
4. **Acknowledge state in chat:** confirm Pattern Detection v1 + Master Data Seed v1 are both live, contracts use SILVER-STD, agents have shiftId. Don't re-author these.
5. **Pick up where left off:** transaction seed work (next session plan above), OR redirect to one of the open backlog items.

### Cold-start sanity checks (optional, ~30 seconds)

```bash
# Verify Railway is healthy
curl -s -o /dev/null -w "%{http_code}\n" \
  https://servicedesk-production-f664.up.railway.app/health
# Expected: 200

# Get a SUPER_ADMIN token
TOKEN=$(curl -s -X POST \
  https://servicedesk-production-f664.up.railway.app/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@intraedge.com","password":"Admin@123456"}' \
  | grep -o '"accessToken":"[^"]*"' | sed 's/.*":"//; s/"$//')

# Verify masters exist
curl -s -H "Authorization: Bearer $TOKEN" \
  https://servicedesk-production-f664.up.railway.app/api/v1/sla-policies \
  | grep -o '"code"' | wc -l   # Expect: 5

curl -s -H "Authorization: Bearer $TOKEN" \
  https://servicedesk-production-f664.up.railway.app/api/v1/admin/issue-templates \
  | grep -o '"templateKey"' | wc -l   # Expect: 27
```

If counts match, masters + intelligence are intact and you're cleared to start new work.

### If something looks wrong

- `GET /health` returning 404 or non-200: backend deploy may have failed. Check Railway dashboard → backend service → Deployments → latest → Deploy Logs. Look for `❌ Startup failed:` lines.
- `/sla-policies` returning 404: the SLA route mount in `app.ts` rolled back somehow. Check `git log app.ts`.
- `/admin/issue-templates` empty: bootstrap didn't run or DB was wiped. Look for `[issue-templates] bootstrap complete` line in Deploy Logs.
- Master counts wrong: re-run `npx ts-node src/seeds/master-data-seed-new.ts` against Railway via `.env.seedrun` — it's idempotent.
- AMS data missing entirely: re-run `npx ts-node src/ams-seed.ts` against Railway. Destructive but recoverable.

---

## Standing decisions referenced this session

- **Masters are single source of truth.** Forms must select from existing master rows via FK only; never expose per-consumer overrides. (Saved as memory: `feedback_masters_single_source_of_truth.md`)
- **No scratch files for previews.** Show diffs inline in chat; never write `.proposed`/temp files. (Saved as memory: `feedback_no_scratch_files.md`)
- **`db push --accept-data-loss` only**, never `migrate deploy`. (CLAUDE.md hard rule #1)
- **Railway IS dev/staging**, not real production. Real production deployment hasn't happened. (Codified in qa-runner.md, business_scenarios.md, CLAUDE.md.)
- **`AMS_SEED_ON_BOOT=false`** on Railway env vars (verified). Re-enabling triggers a destructive seed on every container restart.

---

*— End of v37 handover. Next: transaction seed (TimeEntry population + Classification tab cost/MTTR/trend signals).*
