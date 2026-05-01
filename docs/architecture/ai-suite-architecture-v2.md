# Evidence-Based SAP AMS Diagnostic Accelerator — Architecture v2

**ServiceDeskPro · Architecture proposal · April 2026**
**Supersedes:** `ai-suite-architecture-v1.md`
**Companion to:** `sap-itsm-v37-context.md`

---

## 1. What this is

A design for the AI features on the ServiceDeskPro AMS roadmap, revised after external review. The product is positioned as an **evidence-based diagnostic accelerator** — not a generic AI helpdesk, not autonomous resolution. It helps human SAP AMS agents diagnose tickets faster by pulling and structuring evidence from the customer's SAP system, with the LLM acting as a renderer of pre-validated facts rather than as a free-form reasoner.

Two tiers covered in detail:

- **Tier 1 — Safe Ticket Intelligence.** Operates on ticket text only. No customer SAP integration. Deterministic where possible; LLM-assisted only for natural-language tasks.
- **Tier 2 — Controlled SAP Evidence Service.** Read-only customer SAP access via a governed extractor catalog. Extractor results pass through a deterministic rule mapper into typed evidence objects. The LLM only renders narrative from those objects — it never sees raw SAP data and never writes prose unsupported by an evidence object.

Both tiers augment human agents. No automated SAP writes, ever. Recommendations are drafts an agent reviews and acts on — the agent always has final responsibility.

Tier 3 (resolution recommendation with KB feedback loop) and SLA breach prediction (separate ML stream) are out of scope here.

### What we promise

> **Evidence-backed SAP AMS triage that helps agents diagnose faster.**

We do not promise:
- "AI resolves SAP tickets"
- "L1 agents self-resolve L2 tickets immediately"
- "Plug and play with any SAP system"

We do promise:
- Faster time-to-diagnosis on supported templates
- Every recommendation backed by traceable evidence from customer SAP
- Human agent in the loop on every action
- Read-only — no SAP changes ever made by the system

---

## 2. Locked architectural decisions

| Decision | Choice |
|---|---|
| Customer-side setup | Per-customer onboarding is acceptable — managed engagement, not plug-and-play |
| Read-only against customer SAP | Always. No write paths, ever |
| Extractor model | Pre-tested library, AI selects + fills params. AI never invents calls |
| Extractor governance | Draft → validate → test → security review → publish → customer version-pin. No direct DB edits |
| Synthesis model | Evidence-first: deterministic rule mapper produces typed evidence objects from extractor results. LLM renders narrative only from evidence objects |
| Deterministic precheck | All SAP calls pass through a precheck layer that validates customer enablement, params, format, rate limits, auth scope before execution |
| Inference (initial) | External LLM (Anthropic or OpenAI) via swappable interface; per-customer local-LLM opt-in later |
| SAP topology | OData-first. RFC/CDS adapter interfaces defined; only OdataAdapter implemented in V1 |
| V1 template scope | GR/IR fully built first (Phase B-1); F110 + Pricing + MRP follow in parallel (Phase B-2) |
| Compliance posture | Production rollout gated on redaction + audit + retention controls. V1 internal demo not gated |
| Product positioning | "Evidence-Based SAP AMS Diagnostic Accelerator" — augmentation, not autonomous resolution |

---

## 3. Tier 1 — Safe Ticket Intelligence

### What it does

When a ticket is created or updated, Tier 1 runs against ticket text and existing platform data (templates, similar resolved tickets) and produces:

- **Classification** — module, sub-module, business-impact severity (separate from priority)
- **Pattern match** — matches against existing IssueTemplate library, with confidence score
- **Similar resolved tickets** — top N filtered by tenant, module, SAP edition, and time window (already shipped this session)
- **Investigation checklist** — ordered list, derived from matched template's curated items + LLM-augmented natural-language items
- **Suggested first response** — drafted reply to requester when key information is missing ("which payment run?" / "which company code?")

### Inputs

- Ticket title, description, recordType, priority, sapModuleId
- Existing public comments on the ticket
- Tenant's IssueTemplate library
- Resolved tickets in the same module, same tenant, same SAP edition, last 90 days

No customer SAP data. Tier 1 runs entirely on platform-internal data — data-residency-safe.

### Pipeline

```
Ticket created/updated
  ↓
Pattern matcher (existing, deterministic)        → matchedTemplate?, confidence
  ↓
Classifier (LLM, constrained JSON output)        → moduleId, subModuleId, businessImpact
  ↓
Similar tickets (existing, with new filters)     → top 5 resolved
  ↓
Checklist generator (curated + LLM-aug + strip)  → ordered checklist
  ↓
First-response generator (LLM, optional)         → drafted reply OR null
  ↓
Persist as ITSMRecord.aiClassification (Json)
  ↓
Frontend renders on RecordDetailPage
```

### Checklist generation — mechanical guardrail

This is the most error-prone part of Tier 1. LLMs naturally suggest SAP transactions, table names, and field paths that may not exist in this customer's specific tenant.

**Three-layer guardrail:**

1. **Curated baseline.** Every published IssueTemplate has a human-curated checklist of items. These always render first, never LLM-generated.

2. **LLM augmentation, plain-English only.** The LLM may add contextual items based on the specific ticket text — "ask the requester which company code" / "confirm whether this is the first run." These are unrestricted natural language.

3. **Mechanical strip-out.** All LLM-generated items pass through a regex post-processor that strips/rejects items containing patterns matching SAP transaction codes (e.g., `[A-Z][A-Z0-9]{2,3}`), BAPI/RFC names (`BAPI_*`, uppercase function names), or SAP table names (uppercase 4-7 char strings without vowels). If detected, the item is dropped — the LLM cannot smuggle a fabricated SAP object into the output.

When no template matches, only items 2 and 3 fire — the checklist is strictly plain-English, no SAP-specific guidance attempted.

### Similar-ticket guardrails

The similar-tickets endpoint (already shipped) is extended in Tier 1's scope to filter by:

- **Tenant** — never cross-tenant matches
- **SAP module** — already in place
- **SAP edition** — Public Cloud / Private Cloud / On-Prem (a vendor-block fix in S/4HANA may not apply on ECC)
- **Time window** — last 90 days default
- **Resolution quality** — V2+ (requires resolution rating signal we don't have today)

For V1, tenant + module + SAP edition + time window. Resolution-quality filter waits until data exists to feed it.

### Schema additions

```prisma
model ITSMRecord {
  // ...existing fields...
  aiClassification Json?    // { moduleId, subModuleId, businessImpact,
                            //   matchedTemplateId, confidence,
                            //   checklist: [...], suggestedFirstResponse,
                            //   classifierVersion: 'v1' }
  aiClassifiedAt   DateTime?
  aiVersion        String?  // for backwards-compat as we iterate
}

model IssueTemplate {
  // ...existing fields...
  curatedChecklist Json?    // human-authored baseline checklist items
  extractors       TemplateExtractor[]   // links to catalog (Tier 2)
}

model Tenant {
  // ...existing fields...
  inferenceProvider  String  @default("anthropic")
  inferenceConfig    Json?    // API endpoint, model, etc.
  sapEdition         String?  // PUBLIC_CLOUD | PRIVATE_CLOUD | ON_PREM
}
```

### Job handling

Async via BullMQ with the following safeguards (per reviewer):

- **Idempotency keys** — keyed on `ticketId + ticketVersion`. Updating a ticket with the same content does not enqueue a new job.
- **Deduplication** — multiple updates within a 30-second window collapse into one job.
- **Retry caps** — max 3 attempts per job, exponential backoff. After 3 failures, the ticket is marked `aiClassification: { error: '...' }` and the agent sees a small "AI unavailable — please diagnose manually" indicator.
- **Timeout** — hard 30-second cap per LLM call. Beyond that the job fails and falls into retry path.
- **Per-tenant rate limits** — caps to prevent one runaway tenant from consuming all LLM quota.

The frontend ticket-detail page polls or subscribes for `aiClassification` to populate. While pending, render an "Analyzing…" pill.

---

## 4. Tier 2 — Controlled SAP Evidence Service

This is the core product differentiation. Strict architecture; high governance.

### What it does

When an agent opens a ticket and clicks "Diagnose," Tier 2 runs the matched template's extractors against the customer's S/4HANA tenant, produces typed evidence objects via a deterministic rule mapper, and asks the LLM to render a narrative recommendation strictly from those evidence objects.

### Pipeline

```
Agent clicks "Diagnose"
  ↓
Load ticket + matched template + extractor list + customer SAP profile
  ↓
LLM extracts parameters from ticket text     → { runId: "...", documentNumber: "...", ... }
  ↓
DETERMINISTIC PRECHECK LAYER (fail-closed):
  - Each extractor allowed for this template?
  - Each extractor enabled in customer's SAP profile?
  - Required params present?
  - Param formats match expected schema?
  - Within rate limit for this tenant?
  - Customer's auth scope permits this extractor?
  ↓
SAP execution (only extractors that pass precheck):
  - For each: integration adapter call (OData V1, RFC/CDS later)
  - Cache, structure response per known schema
  ↓
DETERMINISTIC RULE MAPPER (per template):
  - Receives raw extractor results
  - Applies template-specific rules
  - Produces TYPED EVIDENCE OBJECTS
  ↓
LLM RENDERER:
  - Input: ticket, classification, evidence objects (NOT raw SAP data)
  - Instruction: produce narrative from these evidence objects only
  - Output: recommendation prose with inline evidence-id citations
  ↓
Persist as DiagnosticRun row
  ↓
Render on RecordDetailPage as collapsible "AI Diagnosis" section
```

The critical shift from v1: **the LLM never sees raw SAP data**. It sees structured evidence objects with known shapes, produced by deterministic code. The LLM is a renderer, not a reasoner.

### The extractor catalog — governed lifecycle

The extractor catalog is the only way Tier 2 talks to customer SAP. It is **governed**, not editable.

**Lifecycle states** (enforced by schema + workflow):

```
DRAFT
  ↓ (validate schema, params, auth scope)
VALIDATED
  ↓ (test against sandbox SAP system)
SANDBOX_TESTED
  ↓ (security review by designated reviewer)
SECURITY_REVIEWED
  ↓ (publish — assigns version number, locks definition)
PUBLISHED
  ↓ (customer pins their tenant to this version)
IN_USE
  ↓ (deprecation flow when superseded by newer version)
DEPRECATED
```

Senior agents may **propose** new extractors or revisions (creates `DRAFT` entry) but cannot publish directly. The validation, sandbox testing, and security review gates are operational steps logged in an audit trail. Customers explicitly version-pin their tenant — upgrading to a new extractor version is a deliberate change tracked per customer.

**Extractor definition shape:**

```typescript
{
  id: 'getGRIRBalance',
  version: 1,
  state: 'PUBLISHED',
  description: 'GR/IR clearing account balance per PO + line, with mismatch flags',
  transport: 'odata',          // odata | rfc | cds (only odata implemented V1)
  endpoint: '/sap/opu/odata/sap/API_GRIR_CLEARING_SRV/GRIRBalance',
  filterTemplate: "PurchaseOrder eq '{poNumber}'",
  requiredParams: ['poNumber'],
  paramSchema: { poNumber: { type: 'string', pattern: '^[0-9]{10}$' } },
  expectedScope: 'API_GRIR_CLEARING_SRV_0001',
  responseSchema: { /* JSON schema for validating response shape */ },
  rateLimit: { perCustomerPerMinute: 10 },
  testCase: { params: { poNumber: '4500001234' }, expectedShape: '...' },
  publishedAt: '2026-04-15T...',
  publishedBy: 'security-review',
}
```

### Customer SAP integration profile

Per-customer config:

```prisma
model CustomerSapProfile {
  customerId           String  @id
  sapEdition           SapEdition  // PUBLIC_CLOUD | PRIVATE_CLOUD | ON_PREM
  primaryTransport     Transport   // ODATA | RFC | HYBRID
  odataBaseUrl         String?
  odataAuthMethod      String?    // BASIC, OAUTH2, X509
  rfcDestinationId     String?
  cloudConnectorId     String?
  defaultClient        String?    // SAP client (e.g. '100')
  defaultLanguage      String     @default("EN")
  rateLimitPerMinute   Int        @default(30)
  enabledExtractors    Json       // [{ extractorId, pinnedVersion }]
  authScopes           String[]   // OData scopes / RFC authorization objects available
}
```

Onboarding fills this profile + customer's basis team grants narrow read-only auth — see Section 8.

### Evidence objects — typed, structured, citable

Per-template, the rule mapper converts raw extractor results into typed evidence objects with a known shape. **The LLM only sees these.**

Example evidence object types for GR/IR template:

```typescript
type EvidenceObject = {
  evidenceId: string         // unique within the diagnostic run
  type: string               // discriminator
  source: { extractorId, version, callId }
  finding: string            // one-line factual claim
  severity: 'low' | 'medium' | 'high' | 'critical'
  data: Record<string, unknown>   // structured supporting data
  recommendedAgentAction?: string // human-readable next step
}

// Example concrete evidence object:
{
  evidenceId: 'ev-001',
  type: 'GRIR_QUANTITY_MISMATCH',
  source: { extractorId: 'getGRIRBalance', version: 1, callId: '...' },
  finding: 'Quantity mismatch on PO 4500001234 line 10 — GR 100 EA, IR 95 EA',
  severity: 'high',
  data: { poNumber: '4500001234', lineItem: 10, grQty: 100, irQty: 95, unit: 'EA' },
  recommendedAgentAction: 'Verify GR posting against vendor delivery; consider partial IR or GR reversal'
}
```

Evidence object types are **enumerated per template** — GR/IR has, say, 8-12 possible types covering all canonical mismatch causes. The rule mapper is deterministic logic that examines extractor data and emits evidence objects of these known types.

### LLM as renderer — strict citation

Final step: LLM receives ticket + classification + evidence objects array. Instruction:

> Produce a recommendation narrative for the agent. Every factual claim must cite an evidenceId in this format: `[ev-001]`. If you cannot cite an evidenceId for a claim, do not make the claim. Group findings by severity. Suggest agent actions only those listed in `recommendedAgentAction` of cited evidence.

Output is rendered with citations as inline badges. Clicking a badge expands to show the evidence object's structured data, including the source extractor call. **The agent has full traceability from claim → evidence → SAP call → SAP data.**

This makes the recommendation auditable. The agent doesn't need to trust the LLM — they verify each claim against the actual extractor result.

### Cache validity

Diagnostic results are cached on `DiagnosticRun`. Cache key composed of:

- `ticketId` + `ticketVersion` (any ticket update invalidates)
- All `(extractorId + extractorVersion)` pairs used
- `templateVersion`
- `parameterSet` hash
- SAP system timestamp from a low-cost ping extractor

If any component changes, cache is invalid. Re-running creates a new `DiagnosticRun` (history preserved) so an agent can diff diagnoses across reruns.

This prevents acting on stale SAP data — the most insidious failure mode in this category.

### Schema additions

```prisma
model TemplateExtractor {
  id              String   @id
  templateId      String
  extractorId     String   // FK to ExtractorCatalog
  required        Boolean  @default(false)
  // ...
}

model ExtractorCatalog {
  id              String   @id            // e.g. 'getGRIRBalance'
  version         Int
  state           String                  // DRAFT | VALIDATED | SANDBOX_TESTED | SECURITY_REVIEWED | PUBLISHED | DEPRECATED
  definition      Json                    // full extractor spec
  publishedAt     DateTime?
  publishedBy     String?
  // ...
  @@unique([id, version])
}

model DiagnosticRun {
  id              String   @id
  recordId        String
  customerId      String
  templateId      String
  templateVersion Int
  parameterSet    Json
  evidenceObjects Json     // array of typed evidence
  narrative       String   // LLM-rendered prose with citations
  cacheKey        String   // computed from inputs
  startedAt       DateTime
  completedAt     DateTime?
  status          String   // PENDING | SUCCESS | FAILED
}

model SapReadAuditLog {
  id              String   @id
  customerId      String
  diagnosticRunId String?
  extractorId     String
  extractorVersion Int
  parameterSet    Json
  authScope       String
  status          String   // SUCCESS | PRECHECK_FAILED | SAP_ERROR
  durationMs      Int
  invokedAt       DateTime
  invokedBy       String   // userId or 'system'
}
```

### Adapters — interface defined, OData implemented

```
SapIntegrationAdapter (interface)
  ├── OdataAdapter        — V1 implementation (covers Public Cloud, Private Cloud, On-Prem-with-Gateway)
  ├── RfcAdapter          — interface only in V1; built when first on-prem-only customer needs it
  └── CdsAdapter          — interface only in V1; built when needed
```

Adapter interface is small and stable:

```typescript
interface SapIntegrationAdapter {
  execute(extractor: PublishedExtractor, params: Record<string,unknown>, profile: CustomerSapProfile): Promise<RawExtractorResult>
  validateAuthScope(scope: string, profile: CustomerSapProfile): boolean
  ping(profile: CustomerSapProfile): Promise<{ healthy: boolean, sapTimestamp: Date }>
}
```

V1 ships only `OdataAdapter`. The `RfcAdapter` and `CdsAdapter` slots exist; their implementations are explicitly out of V1 scope.

---

## 5. Where the AI code runs

Three options analysed; recommendation is **option B** (sidecar for Tier 2).

### Option A — Inside the Node.js backend (monolith)
Pro: simplest. Same deploy. New `ai.service.ts` + worker module.
Con: when Tier 2 grows (extractors, evidence objects, eventually local LLM), Node ecosystem is weaker than Python for ML/data work. Resource profile is also wrong — Tier 2 needs more CPU/RAM than typical web request.

### Option B — Tier 1 in Node, Tier 2 as a sidecar service (recommended)
Pro:
- Tier 1 stays simple, in the existing monolith. No new infra to ship the first AI feature.
- Tier 2 isolated as a service with its own deploy lifecycle, language choice, resource profile.
- Per-customer microservice topology becomes available later without touching the main app.
- Failure of Tier 2 doesn't take down ticket creation.

Con: more moving parts than a monolith. Two deploys. Internal API.

### Option C — Per-customer microservice from day one
Pro: maximum data residency.
Con: massively more ops cost. Killer for early roadmap.

### Recommended structure

```
sap-itsm-platform/                 ← existing repo
├── backend/                       ← Tier 1 lives here
│   └── src/services/ai/
│       ├── classifier.ts
│       ├── checklist-generator.ts
│       ├── llm-client.ts          ← swappable inference interface
│       └── worker.ts              ← BullMQ consumer
└── ai-diagnostics/                ← new service, separate deploy (Tier 2)
    ├── src/
    │   ├── extractors/
    │   ├── adapters/              ← OData only in V1
    │   ├── precheck/              ← deterministic precheck layer
    │   ├── rule-mappers/          ← per-template logic
    │   ├── synthesis/             ← LLM as renderer
    │   └── api.ts
    └── package.json
```

Two services talk over a small internal API. Main backend never talks to customer SAP — only the diagnostics service does.

**Language for `ai-diagnostics`:** Node initially (same ecosystem, lower context-switch cost). Python option opens later if ML needs grow.

---

## 6. Inference layer — swappable interface

All LLM calls go through one interface:

```typescript
interface LLMClient {
  classify(ticket, options): ClassificationResult
  generateChecklist(ticket, template, options): ChecklistResult
  extractParameters(ticket, template, options): ParameterMap
  renderDiagnosis(ticket, evidenceObjects, options): RenderedDiagnosis
}
```

Implementations:
- `AnthropicClient` — initial. Fastest path. Sets the API contract.
- `OpenAIClient` — drop-in alternative.
- `OllamaClient` — for customers requiring on-premise inference. Plug in after first such customer.

Per-tenant config:
```prisma
model Tenant {
  inferenceProvider  String  @default("anthropic")
  inferenceConfig    Json?
}
```

Small decision today, large optionality later.

---

## 7. End-to-end walkthrough — one GR/IR ticket

Concrete flow, single ticket, both tiers.

### Setup

- Customer: GlobalManufacturing AG (S/4HANA private cloud)
- Customer's SAP profile filled in: OData primary transport, communication user has scope `API_GRIR_CLEARING_SRV_0001`, all GR/IR extractors enabled and pinned to v1
- Template `GRIR_MISMATCH` exists with 4 mapped extractors and a deterministic rule mapper

### Step 1 — Ticket arrives

End user `procurement.user@globalmanufacturing.de` creates an incident:

> **Title:** GR/IR not clearing for PO 4500001234
> **Description:** Goods receipt was posted last week for PO 4500001234, vendor sent invoice yesterday but the IR posting won't clear against the GR. Account balance shows open. Need this resolved before month-end close in 3 days.

Backend creates the ITSMRecord. Tier 1 worker job enqueues.

### Step 2 — Tier 1 fires (~3 seconds)

- **Pattern matcher** matches `GRIR_MISMATCH` template at 0.94 confidence.
- **Classifier (LLM)** confirms: module MM, sub-module IM (Invoice Management), business-impact `HIGH` (month-end deadline).
- **Similar tickets** returns 3 resolved GR/IR mismatches from the same tenant, S/4HANA private cloud, last 90 days.
- **Curated checklist** loaded from template:
  1. Confirm PO number with requester
  2. Pull GR/IR balance for the PO (extractor: `getGRIRBalance`)
  3. Check material document for GR posting (extractor: `getMaterialDocument`)
  4. Check invoice document for IR posting (extractor: `getInvoiceDocument`)
  5. Check for held/parked invoices on this PO (extractor: `getHeldInvoices`)
- **LLM augmentation** adds: "ask requester whether the invoice was posted against the same plant as the GR" — passes the strip-out check (no SAP-object names).
- **First-response generator** is null (description has the PO number).

Persisted as `ITSMRecord.aiClassification`. RecordDetailPage renders "AI Insights" section.

### Step 3 — Agent picks up

L2 agent Anitha opens the ticket. She sees:
- Classified MM/IM, HIGH business impact
- 3 similar resolved tickets in right rail
- 6-item checklist with extractors callable

Anitha clicks "Diagnose."

### Step 4 — Tier 2 fires (~12 seconds)

Diagnostic-run job enqueued.

**LLM parameter extraction:** parses `poNumber: '4500001234'`, `vendor: null` (not in description), `companyCode: null`.

**Deterministic precheck:**
- All 4 extractors allowed for `GRIR_MISMATCH` template ✓
- All 4 enabled in customer profile ✓
- `poNumber` present and matches `^[0-9]{10}$` ✓
- Customer's auth scope `API_GRIR_CLEARING_SRV_0001` permits all 4 extractors ✓
- Tenant rate limit OK ✓
→ All extractors cleared for execution.

**SAP execution:**
- `getGRIRBalance(poNumber=4500001234)` → returns 1 line item, GR qty 100 EA / IR qty 95 EA / quantity mismatch flag = true.
- `getMaterialDocument(poNumber=4500001234)` → returns single GR posting, qty 100 EA, plant DE10, posting date last week.
- `getInvoiceDocument(poNumber=4500001234)` → returns IR posting, qty 95 EA, plant DE10, posting date yesterday, no block.
- `getHeldInvoices(poNumber=4500001234)` → returns empty array.

**Rule mapper** runs against extractor results, emits evidence objects:

```json
[
  {
    "evidenceId": "ev-001",
    "type": "GRIR_QUANTITY_MISMATCH",
    "source": { "extractorId": "getGRIRBalance", "version": 1, "callId": "..." },
    "finding": "Quantity mismatch on PO 4500001234 line 10 — GR 100 EA, IR 95 EA",
    "severity": "high",
    "data": { "poNumber": "4500001234", "lineItem": 10, "grQty": 100, "irQty": 95, "delta": 5, "unit": "EA" },
    "recommendedAgentAction": "Confirm with vendor whether short delivery; if so, consider partial IR adjustment or GR reversal"
  },
  {
    "evidenceId": "ev-002",
    "type": "GR_POSTING_OK",
    "source": { "extractorId": "getMaterialDocument", "version": 1, "callId": "..." },
    "finding": "GR posted correctly at plant DE10 last week — no apparent posting issue",
    "severity": "low",
    "data": { "plant": "DE10", "qty": 100, "unit": "EA", "postingDate": "2026-04-15" }
  },
  {
    "evidenceId": "ev-003",
    "type": "IR_POSTING_OK",
    "source": { "extractorId": "getInvoiceDocument", "version": 1, "callId": "..." },
    "finding": "IR posted at plant DE10, no block flag — IR side is clean",
    "severity": "low",
    "data": { "plant": "DE10", "qty": 95, "unit": "EA", "postingDate": "2026-04-22", "blockFlag": false }
  },
  {
    "evidenceId": "ev-004",
    "type": "NO_HELD_INVOICES",
    "source": { "extractorId": "getHeldInvoices", "version": 1, "callId": "..." },
    "finding": "No held or parked invoices for this PO",
    "severity": "low",
    "data": { "count": 0 }
  }
]
```

**LLM renderer** receives ticket, classification, and the 4 evidence objects (not raw SAP data). Instruction: render narrative; cite every claim; suggest only actions from `recommendedAgentAction` fields.

Output:

> **AI Diagnosis** — confidence: HIGH
>
> The mismatch is caused by a 5 EA quantity delta between GR (100 EA) and IR (95 EA) on PO 4500001234 line 10 [ev-001]. The GR side is clean — material document posted correctly at plant DE10 last week [ev-002]. The IR side is also clean — invoice posted at the same plant, no block flag [ev-003]. No held or parked invoices interfere [ev-004].
>
> **Recommended action:** confirm with the vendor whether this was a short delivery. If yes, consider a partial IR adjustment or GR reversal to clear the 5 EA delta [ev-001].

### Step 5 — Agent acts

Anitha reads the diagnosis. She clicks each `[ev-XXX]` citation to expand the structured evidence — sees the actual GR qty 100, IR qty 95 in the data block. She has full traceability.

She picks up the phone, calls the vendor's AP team, confirms a short delivery happened (5 EA damaged in transit, vendor short-shipped). She advises the requester to either accept partial billing (issue MIRO adjustment) or arrange a return for the missing 5 EA. The agent acts; the AI does not.

Total time-to-diagnosis: under 15 minutes. Without the AI: ~1.5 hours of manual investigation across MMBE, ME23N, MIRO, MR8M, FBL3N.

### Step 6 — Knowledge feeds back

Anitha resolves the ticket. The resolution comment + evidence-object snapshot becomes future training material — feeds into similar-tickets index, eventually into Tier 3's resolution-recommendation engine when that's built.

---

## 8. Per-customer onboarding — managed engagement, not turn-on

Onboarding is a managed engagement. Realistic effort split:

| Step | Owner | Customer effort | Our effort |
|---|---|---|---|
| 1. Customer SAP profile drafted (edition, transport, base URLs) | Joint | 0.5 day | 0.5 day |
| 2. Basis team creates communication user with read-only scope | Customer | 2-5 days | — |
| 3. Customer security review of extractor catalog (which extractors permitted) | Customer | 1-3 days | 0.5 day support |
| 4. Cloud Connector / VPN config (on-prem / private cloud) | Joint | 1-2 days | 0.5 day |
| 5. Map customer's enabled APIs to extractor catalog entries | Us | — | 0.5 day |
| 6. Smoke-test each enabled extractor against real (sandbox) tickets | Joint | 0.5 day | 0.5 day |
| 7. Customer pins extractor versions; production rollout | Joint | 0.5 day | 0.5 day |
| **Total** | | **5-12 customer-days** | **3 our-days** |
| **Elapsed time** | | **2-4 weeks** typical | |

This is **not "turn it on."** Plan for a 2-4 week customer engagement led by a managed-onboarding playbook. Sales messaging should set this expectation, not paper over it.

---

## 9. Compliance prerequisites — production gate, not V1 gate

Internal demo (V1) does not require these. **Before any production customer rollout** all of the following must be in place:

1. **Redaction before external LLM calls** — strip ticket descriptions of customer identifiers (vendor names, invoice numbers, monetary amounts above threshold, names) before sending to LLM. Configurable per customer; some may opt out.
2. **Tenant-level LLM provider controls** — per-tenant choice of inference provider; per-tenant kill switch.
3. **Prompt/response retention rules** — what gets stored where, for how long. Default: nothing retained beyond DiagnosticRun row in our DB. No third-party retention beyond what the LLM provider's data-retention policy specifies (Anthropic 30-day default, OpenAI varies).
4. **SAP-read audit log** — every extractor call logged: who triggered it, what extractor + version, what params, what auth scope. Customer can export their full SAP-read history at any time.
5. **"Agent must verify" UX** — every recommendation is rendered with explicit "Agent verification required" framing. No language suggesting AI conclusions are final.
6. **Right-to-export** — customer can extract all their AI-generated content and audit logs in machine-readable format.

These are project items for Phase D (Hardening), not V1.

---

## 10. Phasing

### Phase A — Tier 1 v1 (3-4 weeks)

- `aiClassification` field on ITSMRecord; schema migrations
- BullMQ worker; `LLMClient` interface; `AnthropicClient` implementation
- Classifier, checklist generator (curated + LLM-aug + mechanical strip-out), suggested first response
- Similar-tickets endpoint extended with tenant + SAP edition filters
- RecordDetailPage "AI Insights" section
- Re-runs on ticket update with idempotency keys + dedup

Deliverable: agents see classification, checklist, similar tickets, suggested response on every ticket. Foundation for Tier 2.

### Phase B-1 — Tier 2 GR/IR end-to-end (4-5 weeks)

This is where the architectural bets get validated.

- `TemplateExtractor`, `ExtractorCatalog`, `CustomerSapProfile`, `DiagnosticRun`, `SapReadAuditLog` schema
- `ai-diagnostics` service skeleton (Node)
- `OdataAdapter` implementation
- Deterministic precheck layer
- GR/IR extractor catalog: 4 extractors fully built (`getGRIRBalance`, `getMaterialDocument`, `getInvoiceDocument`, `getHeldInvoices`) — each draft → validate → sandbox test → security review → publish
- GR/IR rule mapper: 8-12 evidence object types
- LLM renderer with strict citation enforcement
- "Diagnose" button on RecordDetailPage; result rendering with click-through evidence

Deliverable: GR/IR end-to-end diagnostic works against demo data (and any real customer with GR/IR setup). The architectural pattern proven.

**Decision gate at end of B-1:** does the evidence-first model hold up? If yes, proceed to B-2. If something needs to change, change it now — much cheaper than after 3 more templates.

### Phase B-2 — Templates F110 + Pricing + MRP in parallel (4-6 weeks after B-1 gate)

Each leverages B-1 infrastructure. Per-template work:

- **F110 (FICO):** ~5-6 extractors (`getPaymentRunStatus`, `getPaymentRunExceptions`, `getVendorMaster`, `getInvoiceLockStatus`, `getCurrencyTableEntry`); rule mapper for 10-15 evidence types
- **Pricing (SD):** ~4-5 extractors (`getPricingProcedure`, `getConditionRecord`, `getMaterialMaster`, `getCustomerMaster`); rule mapper for 8-10 evidence types
- **MRP exception (PP):** ~5-6 extractors (`getMRPElement`, `getStockOverview`, `getPlanningStrategy`, `getMaterialMaster`, `getRoutingHeader`); rule mapper for 10-15 evidence types

Parallelism is realistic if 2-3 engineers are available. Sequential-and-fast is ~6 weeks; parallel-with-some-coordination is ~4 weeks.

Deliverable: 4 fully-realised templates covering FICO, MM, SD, PP — the AMS sales claim becomes credible.

### Phase C — Hardening + scale (parallel with first customer)

- Compliance prerequisites (Section 9) — redaction, audit log, retention, UX, export
- Inference layer fallback / retry under load
- Per-customer cost reporting
- First production customer rollout

### Phase D — Beyond V1

Open backlog from Section 11.

---

## 11. Open decisions / out of scope

Captured here so they're not lost.

1. **Template lifecycle for AI-proposed templates** — held per earlier call.
2. **Per-customer billing model for AI calls** — LLM costs $0.01-0.10 per ticket; billing model TBD.
3. **Extractor authoring workflow UI** — V1 extractors authored by engineers in code/PR. Senior-agent UI for proposing extractor changes is post-V1.
4. **Tier 3 — KB feedback loop** — successful diagnoses become reusable knowledge. Major scope; separate document later.
5. **SLA breach prediction** — separate ML stream entirely.
6. **Inference vendor:** Anthropic vs OpenAI for V1. Suggest Anthropic for consistency with development workflow. Coin-flip technically.
7. **`ai-diagnostics` language:** Node initially. Python option opens later.
8. **Phase A target customer:** Internal demo against GlobalManufacturing AG (synthetic data) sufficient? Or align Phase A with a real customer's SAP from the start?

---

## 12. Decisions still required from you

- Inference vendor — Anthropic vs OpenAI
- Phase A target customer — internal demo vs real customer alignment
- Anything in this doc that should be cut — over-engineered or premature?
- Anything missing that should be in?

---

*End of v2 architecture proposal — Evidence-Based SAP AMS Diagnostic Accelerator — April 2026*
*Reviewed against external feedback; reviewer's accepted points integrated; reviewer's narrowing applied (Phase B-1 = GR/IR only); product positioning updated.*
