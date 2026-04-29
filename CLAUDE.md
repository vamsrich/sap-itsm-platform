# Project Brain — ServiceDeskPro

> Read this at the start of every session. This document encodes the rules,
> conventions, and current state of the project. When you see drift between
> this document and the codebase, **the codebase wins** — flag the drift and
> we'll update this doc together.

---

## What this is

ServiceDeskPro is a production multi-tenant SAP ITSM platform built for
Intraedge (the MSP). It manages incidents, service requests, problems, and
changes across SAP customer organisations with SLA tracking, smart agent
assignment, and role-based access control.

| Item | Value |
|---|---|
| Repo | github.com/vamsrich/sap-itsm-platform |
| Frontend (prod) | https://sap-itsm-platform-production.up.railway.app |
| Backend (prod) | https://servicedesk-production-f664.up.railway.app |
| Local path | C:\Users\vamsi\Downloads\Products\ServicedeskPro\sap-itsm-platform |
| Tenant model | Single-tenant (Intraedge, slug `intraedge`) |
| Deploy | Railway, auto-deploys on push to `main` |

---

## Tech stack

- **Backend:** Node.js / TypeScript 5.4 / Express 4.18 / Prisma 5.10 ORM
- **Database:** PostgreSQL (Railway-hosted)
- **Cache/Queue:** Redis + BullMQ — fail-open (system works without Redis)
- **Frontend:** React 18 / TypeScript 5.4 / Vite 5.1 / TailwindCSS / React Query

---

## Hard rules (non-negotiable — every one of these has caused a production bug before)

1. **Schema migrations: `npx prisma db push` ONLY.** Never `migrate deploy`. Railway doesn't support migration history.

2. **Every API route file uses `verifyJWT` + `enforceTenantScope`** at the router top, or has an explicit code comment explaining why it doesn't.

3. **Never hardcode `tenantId`.** Always use `req.user.tenantId` from JWT.

4. **Every `$queryRaw COUNT(*)` uses `CAST(COUNT(*) AS INT)`** — PostgreSQL returns BigInt by default and `JSON.stringify` crashes on BigInt.

5. **Email is always lowercased** on register and login (`email.toLowerCase()`).

6. **Comment visibility filtering:** filter by `internalFlag` based on `canSeeInternal` role check. USER and COMPANY_ADMIN must never see internal comments.

7. **Redis calls wrapped in try/catch** — system must work without Redis.

8. **Role scoping uses `scopeHelpers.ts`:**
   - `resolveAgent(userId)` → User → Agent record
   - `resolveManagedCustomerIds(agentId, tenantId)` → Agent → managed customer IDs

9. **Comment.authorId references User, not Agent.** Always pass `someUser.id`, never `someAgent.id`. (Caused the v35 AMS seed bug.)

10. **Always run `npx prisma generate` after `npm install` in backend.** 
    Without it, TypeScript types for Prisma models are stubs and code won't 
    compile correctly.

11. **Code style is enforced by Prettier.** Each workspace has its own 
    `.prettierrc`. The format-on-save hook auto-formats edited files. Don't 
    fight prettier — if formatting feels wrong, edit `.prettierrc` instead 
    of working around it.

---

## Roles and scope (the visibility matrix)

| Role | Scope |
|---|---|
| `SUPER_ADMIN` | Full tenant — all companies, all data |
| `COMPANY_ADMIN` | Own company only (via `req.user.customerId`) |
| `PROJECT_MANAGER` | Companies where assigned as PM (via `resolveManagedCustomerIds`) |
| `AGENT` | Only tickets where `assignedAgentId = agent.id` |
| `USER` | Only tickets where `createdById = userId` |

When adding a new endpoint, check it against the visibility matrix in the v34 handover doc §4 before merging.

---

## Current state (verified 2026-04-25)

### Codebase reality
- Version line: **v35+** — codebase has progressed beyond what the v35 doc reflects
- Total commits: 15
- Active route files: 17 in `backend/src/api/routes/` + 1 helper (`scopeHelpers.ts`)
- 19 active route group registrations in `app.ts`

### Status
- **AMS seed:** Completed successfully. GlobalManufacturing AG with 82 tickets loaded.
- **`AMS_SEED_ON_BOOT`:** Should be `false` in Railway env vars after successful seed.
- **Schema:** No `aiClassification` field on `ITSMRecord` yet (Phase 1.3 pending).
- **Railway deployment is dev/staging, not real production.** The Railway subdomains contain "production" (Railway naming), but no real customer traffic flows there. Test data and experiments are acceptable. When real customer-facing production launches later, this note and the qa-runner agent's defensive rules must be updated.
- **Issue Pattern Detection v1 shipped.** `/analytics/patterns` now uses DB-backed issue templates (table `issue_templates`, 27 SAP-domain-aware templates seeded per tenant on boot) for Pass-1 classification, plus Jaccard clustering (Pass-2) on whatever doesn't match a template. Calibrated against Railway seed data: 100% classification rate, 7 visible patterns at default threshold of 3. Templates editable at runtime is Phase 2 (today: read-only viewer at `GET /api/v1/admin/issue-templates`). Bootstrap is auto-on-boot, idempotent, preserves SA edits via `manuallyEdited` flag.
- **Master Data Seed v1 shipped.** Tier libraries (5 Support Types — STD/STD-PLUS/PREM/PREM-PLUS/ON-CALL; 4 SLA Policies — GOLD-STD/SILVER-STD/BRONZE-STD/BRONZE-P1), 2 Holiday Calendars (US 2026 / India 2026, 19 dates total), 4 Shifts (India Day / 2 PM IST / US East / 24x7), `Agent.shiftId` column added. Contract `CON-2026-GLAG-001` relinked to PREM-PLUS + SILVER-STD + 2 PM IST + US 2026 + USD. Orphan SLA route mounted in `app.ts`. Single-file seed at `backend/src/seeds/master-data-seed-new.ts`, re-runnable via upserts, NOT auto-on-boot. Run: `cd backend && set -a && source .env.seedrun && set +a && npx ts-node src/seeds/master-data-seed-new.ts`. Design doc: `docs/design/master-data-seed-v1.md`.
- **Contract form verified compliant with masters-as-truth principle** (audited 2026-04-28). `frontend/src/pages/ContractFormPage.tsx` uses FK-only `<select>` for Support Type and SLA Policy, multi-checkbox FK selection for Shifts and Holiday Calendars; submit handler posts FK ids only; no inline override fields anywhere. Phase-2 contract-form refactor (anticipated in master-data-seed-v1 design doc §10) is **not needed**.
- **Master-data follow-ups (non-blocking, cleanup-class):**
  1. **Duplicate active Support Types** — 4 rows from prior seed attempts or manual UI experiments (`BASIC`, `BASIC_PLUS`, `PREMIUM`, `ON_CALL` — underscore variants) sit alongside the new tier templates and clutter the dropdown. Cleanup via admin UI: deactivate them so only the new tier names surface.
  2. **Picker `isActive` filter inconsistency** — Contract form filters Support Type / SLA Policy by `isActive: true`, and Shift by `status === 'active'`. Holiday Calendar picker does **not** filter — deactivated calendars would appear. Cosmetic; fix when a calendar gets deactivated.
  3. **`Shift.status: String` vs peer masters' `isActive: Boolean`** — schema inconsistency. All other masters (SupportType, SLAPolicy, HolidayCalendar, IssueTemplate) use boolean `isActive`. Schema cleanup pass deferred.

### Open issues to address

1. **Phase 2 intelligence features need fixing** — see Roadmap below. v35 doc claims they're done; user testing says they're not.

2. **Orphan route file** — `backend/src/api/routes/slaPolicy.routes.ts` exists on disk but is NOT registered in `app.ts`. Either wire it up or delete it.

3. **Unauthenticated admin endpoints** — `app.ts` exposes the following without auth:
   - `POST /admin/fix-record-customers`
   - `POST /admin/seed-notification-rules`
   - `POST /admin/ams-seed`
   - `POST /admin/seed` (gated only by `SEED_ON_BOOT` env var)

   These need to be either gated by `SUPER_ADMIN` auth or removed.

4. **Missing `.env.example`** — handover docs claim one exists; reality says it doesn't. Should be generated from `process.env.*` references in code.

5. **Pending working-tree changes** — `backend/prisma/ams-seed.ts` is staged for deletion (correct — superseded by `backend/src/ams-seed.ts`).

6. **Cosmetic** — `DashboardPage.tsx` lines 223-234 have three duplicated `// PM OPERATIONAL HEALTH DASHBOARD` banner comments. Trivial cleanup.

7. **Dashboard stubs** — `dashboard.routes.ts:83-84` returns `agentWorkload: []` and `monthlyTrend: []` as hardcoded empty arrays for the SUPER_ADMIN dashboard. Frontend silently hides them. Either implement or remove from spec.

8. **Frontend has no TypeScript validation** — `frontend/` has no `tsconfig.json` 
   and `vite.config.ts` has no type-check plugin. esbuild strips types without 
   checking. Type errors only surface as runtime bugs. Need to either add 
   `tsconfig.json` + `vite-plugin-checker`, or a CI step running `tsc --noEmit`.

9. **Prisma client types must be regenerated after `npm install`** — fresh 
   installs leave `@prisma/client` as an empty stub. Always run 
   `npx prisma generate` in `backend/` after any `npm install` to get typed 
   Prisma models. Without this, `tsc --noEmit` fails with 21+ TS2305/TS2339 errors 
   that look like "Module '@prisma/client' has no exported member 'RecordStatus'".

---

## Roadmap

### Status legend
- ✅ Working — end-to-end functional, validated by user
- 🟡 Code-complete but output not validated / not matching expectations
- 🔴 Broken — confirmed gap (e.g. UI not wired)
- ⚪ Not built

### Phase 1 — Foundation
- ✅ 1.1 — Dashboard scoping fix (v34) — works (admin trend chart is a stub)
- 🟡 1.2 — Incident classification view (v35) — shows data, output not yet user-validated
- ⚪ 1.3 — AI classification scaffold (`aiClassification Json?` field + BullMQ worker)
- ⚪ 1.4 — Global ticket search + filter presets
- ⚪ 1.5 — Problem → incident linking UI

### Phase 2 — Intelligence (status updated 2026-04-29)

- ✅ **2.1 — Similar incident finder** — shipped 2026-04-29 (commit `57dc5b3`). `<SimilarIncidents>` component on `RecordDetailPage.tsx`, gated to `recordType === 'INCIDENT'`. Uses scoring-based ranking (module + sub-module + tag overlap). Pending v2 refactor onto embeddings (see below).

- 🟡 **2.2 — Recurring pattern detection** — DB-backed templates + Jaccard fallback work, 100% classification on seed. Templates approach doesn't scale beyond one customer (manual curation). Pending v2 refactor onto embeddings.

- ✅ **2.3 — Replaced by Bottlenecks** (commit `eae51d8`). Old root-cause endpoint (`/analytics/root-cause`) deleted; `/analytics/bottlenecks` returns 5 KPIs + sortable agents table. Frontend tab renamed.

- 🟡 **2.4 — SLA Reports page** — populates correctly (commits `c723446`, `1204d96`, `55e12b6`). Has KPI cards + breached-tickets table. Resolution-met 82%, response-met 94% post-SLA-service-fix.

- 🔴 **2.5 — Knowledge gap detection** — `/analytics/knowledge-gaps` endpoint returns 500 (Prisma `groupBy + having` issue, untriaged). Will be replaced by clusters-without-Problem-record under v2 plan.

### Intelligence stack v2 — embeddings-first refactor (DEFERRED, agreed direction)

> Decision 2026-04-29: refactor Similar Incidents + Recurring Patterns + Knowledge Gaps onto a unified pgvector + sentence-transformers (`Xenova/all-MiniLM-L6-v2`, 384-dim) foundation. Templates demoted to optional curated labels on top of emergent clusters.
>
> **Why:** hand-curated templates don't scale. 27 templates work for the AMS seed; a real customer has 100-500 distinct issue patterns; 10 customers ≈ 1,000-5,000 mostly non-overlapping patterns. Manual curation is non-viable. Embeddings scale automatically.
>
> **Scope:** ~10 hr core (pgvector schema, embedding service, backfill, ticket lifecycle hook, refactor of Similar/Patterns/Gaps, "promote cluster to template" admin action). +1.5 hr optional LLM cluster summarization.
>
> **Status:** pgvector 0.8.2 enabled on Railway (verified). Plan + decisions documented in memory file `project_intelligence_v2_plan.md`. To resume: ask user "single 10-hr push or foundation-first (2a-2d, ~3 hr)?"

### Phase 3+ (deferred until Phase 2 is actually working)
- Knowledge base, AI resolution suggestions, auto-Problem creation, CSAT
- Executive AI dashboard, customer self-service portal, bulk actions, CSV export
- Workflow engine, pgvector semantic similarity, SLA escalation chains, email-to-ticket

---

## Strategic priority (next work)

Updated 2026-04-29 — items 2.1 and 2.3 shipped today, 2.4 SLA Report shipped, Bottlenecks replaces root-cause.

1. **Intelligence stack v2 refactor** — embeddings-first (pgvector + sentence-transformers). ~10 hr core. Replaces Similar Incidents, Recurring Patterns, Knowledge Gaps onto unified vector space. Templates demoted to optional labels. Plan in memory `project_intelligence_v2_plan.md`. Two starting paths: single 10-hr push, OR foundation-first (2a-2d, ~3 hr) then 2e/2f/2g independently.

2. **Critical Modules drilldown on Classification page** — non-clickable today. Inline filter on the module table below the KPI tile. ~30 min.

3. **Shift assignment Phase 4A** — UI to assign agents to shifts, off-hours opt-in checkbox, ~1.5-2 hr. Phase 4B (smart-assign with off-hours fallback) needs a 5-question decision pass first; deferred until 4A ships.

4. **Phase 1.3 — AI classification scaffold** — blocked on the "AI inference architecture" decision below. v2 refactor (#1) actually unblocks this since it gets embeddings infrastructure in place.

---

## Architecture decisions on file

- **AI inference architecture (option A/B/C from v34 §9):** NOT YET DECIDED. Phase 1.3 cannot start until this is resolved.
- **Single tenant** — Intraedge only. Multi-tenant code paths exist but only one tenant is active.

---

## Future direction (intent, not yet designed)

ServiceDeskPro is currently SAP-focused, but the long-term vision is a **multi-system service desk platform**.

### Target systems

Near-term focus (in priority order):

1. **SAP** (current, immediate) — ECC, S/4HANA modules: FICO, MM, SD, PP, etc.
2. **Oracle** — E-Business Suite, Oracle Fusion / Cloud ERP
3. **NetSuite**

Beyond these three is **explicitly out of scope** for now. We'll revisit when all three above are real customer offerings.

### Multi-system data model (architectural principle, not yet built)

When implemented, system definitions are **database-driven, not hardcoded**:

- An `EnterpriseSystem` table stores system definitions (name, type, module taxonomy)
- SUPER_ADMIN can register new systems and define their modules / sub-modules
- Customer onboarding picks one or more systems from the registered list
- Customers can use a single system or multiple systems (e.g. SAP for finance + NetSuite for sales)

Why database-driven: avoids hardcoded enums that need code changes every time a new system is supported, and lets admins customize module taxonomies per customer if needed.

### Multi-system selection (timing TBD)

When a customer has multiple systems, system selection happens either:
- At project / contract setup (per-contract scope), OR
- At ticket creation time (user picks which system the ticket relates to)

Decision deferred until we have an actual multi-system customer.

### AI / intelligence features must be system-aware

> ⚠️ **Critical architectural principle:** AI features (classification, similar incident detection, root-cause analysis, resolution suggestions, knowledge base) cannot be a single system-agnostic implementation. SAP, Oracle, and NetSuite have different vocabularies, error patterns, and resolution playbooks.

In practice this means:

- **Per-system classifier configs.** Each system gets its own LLM prompt, module taxonomy, and few-shot examples.
- **Per-system knowledge corpus.** Pattern libraries and resolution templates stay scoped per system.
- **Tickets carry system context.** Every `ITSMRecord` knows which system it relates to, so the right classifier runs.

### Implications for current architecture (informational)

When multi-system support is built:

- New `EnterpriseSystem` table; modules / sub-modules link to it
- `Customer` model gains a many-to-many relationship to `EnterpriseSystem`
- `ITSMRecord` gains an `enterpriseSystemId` FK
- `AgentSpecialization` extended to scope per system
- Seed scripts become per-system (`sap-seed.ts`, `oracle-seed.ts`, `netsuite-seed.ts`)
- Existing SAP-named tables/fields (e.g. `SAPModuleMaster`) get migrated to be scoped under `enterpriseSystemId` where the SAP system row is one of many

### Decision deferred — but Phase 1.3 must respect this

> **Do not build multi-system support yet.** SAP-only is correct for now.
>
> **However, Phase 1.3 (AI classification scaffold) must be designed with system-awareness from day one** — not retrofitted later. Specifically:
>
> - The classifier framework accepts a system identifier and routes to the right per-system configuration
> - The `aiClassification` JSON field includes a system identifier alongside the classified module / sub-module
> - First implementation is SAP-only (only system that exists today), but the architecture must allow plugging in Oracle and NetSuite later without refactoring
> - LLM prompts live in per-system config files, not hardcoded in TS

This section will be revisited after Phase 2 intelligence features are working and Phase 1.3+ groundwork is laid.

---

## Known bugs that have been fixed — DO NOT reintroduce

1. BigInt crash on dashboard → `CAST(COUNT(*) AS INT)` in raw SQL
2. PM not visible to COMPANY_ADMIN → `OR` clause adds PM via `projectManagerAgentId`
3. Login case sensitivity → `email.toLowerCase()` on register and login
4. Dashboard Redis crash → try/catch around all `cache.get/set` calls
5. Internal notes visible to all → filter comments by `internalFlag` based on role
6. AGENT seeing all tenant tickets → `assignedAgentId` filter on all list endpoints
7. AMS seed `Comment.authorId` bug → use User.id, not Agent.id
8. AMS seed delete order → delete `ContractShift` before `Contract`

---

## Working agreements with Claude Code

- **Read before write.** Always read a file before editing it.
- **Show diffs.** Display changes before applying them.
- **Never push to `main` without explicit confirmation.**
- **Never run `prisma migrate`.** Use `prisma db push`.
- **Never commit `.env*` files.** They're in `.gitignore`.
- **Flag drift.** When this doc and the codebase disagree, surface it — don't silently follow either.
- **Investigate suspicious working-tree state.** Deleted files, unstaged changes, etc. should be flagged before any commit.
- **No scratch files outside the project.** Don't write temporary/proposal 
  files to /tmp/ or anywhere else. Pipe everything through stdin/stdout in 
  memory. If a multi-step computation needs intermediate state, use a bash 
  pipeline, not a file.

---

## Standard commands

Use proper triple-backticks for the code block below:

```bash
# Local dev
cd backend && npm run dev
cd frontend && npm run dev

# Schema changes
cd backend && npx prisma db push

# Reset and reseed (LOCAL ONLY — destructive)
cd backend && npx ts-node prisma/reset-seed.ts

# Deploy (after manual confirmation)
git add . && git commit -m "message" && git push origin main
```

---

## Default credentials (dev/staging only)

- **Super Admin:** `admin@intraedge.com` / `Admin@123456`
- **AMS seed users** (after AMS seed completes, password `Admin@123456`):
  - PM: `priya.sharma@intraedge.com`
  - FICO Agent: `rajesh.kumar@intraedge.com`
  - MM Agent: `anitha.reddy@intraedge.com`
  - SD Agent: `vikram.nair@intraedge.com`
  - PP Agent: `deepa.menon@intraedge.com`
  - Company Admin: `it.admin@globalmanufacturing.de`
  - Finance user: `finance.user@globalmanufacturing.de`
  - Procurement user: `procurement.user@globalmanufacturing.de`

> **Note:** These are dev/staging credentials. Production credentials should never appear in this file or any committed file.
