/**
 * Calibration script — runs the issue-template matcher against real ticket
 * data and reports actual vs expected hits per template. Used PRE-MERGE to
 * verify the seed file's keyword choices before shipping.
 *
 * Invocation (from backend/):
 *   set -a && source .env.seedrun && set +a && npx ts-node src/services/issue-templates.calibrate.ts
 *
 * Pass criterion: every ANCHOR template hits >= 80% of expected count.
 * Secondary templates have softer expectations — surfaced for inspection only.
 *
 * Throwaway tooling. NOT wired into production code paths.
 */

import { PrismaClient } from '@prisma/client';
import { SEED_TEMPLATES } from './issue-templates.seed';
import {
  classifyTickets,
  clusterUnclassified,
  DbTemplate,
  MatchableTicket,
} from './issue-templates.service';

// Expected hit counts per template, derived from the 75-ticket AMS seed.
// Anchors are the ones we care about most for the showcase.
interface Expectation {
  templateKey: string;
  expected: number;
  isAnchor: boolean;
}

const EXPECTATIONS: Expectation[] = [
  // Anchors (must hit ≥ 80% of expected to pass calibration)
  { templateKey: 'fico-f110-payment-run', expected: 7, isAnchor: true },
  { templateKey: 'mm-gr-posting-error', expected: 3, isAnchor: true },
  { templateKey: 'sd-pricing-condition', expected: 7, isAnchor: true },
  { templateKey: 'pp-mrp-run-issue', expected: 5, isAnchor: true },
  // FICO secondary
  { templateKey: 'fico-gl-period', expected: 1, isAnchor: false },
  { templateKey: 'fico-credit-block', expected: 1, isAnchor: false },
  { templateKey: 'fico-co-cost-allocation', expected: 2, isAnchor: false },
  { templateKey: 'fico-document-splitting', expected: 1, isAnchor: false },
  { templateKey: 'fico-fx-revaluation', expected: 1, isAnchor: false },
  { templateKey: 'fico-intercompany', expected: 1, isAnchor: false },
  { templateKey: 'fico-dunning', expected: 1, isAnchor: false },
  { templateKey: 'fico-ar-incoming-payment', expected: 2, isAnchor: false },
  { templateKey: 'fico-product-costing', expected: 1, isAnchor: false },
  // MM secondary
  { templateKey: 'mm-po-creation', expected: 3, isAnchor: false },
  { templateKey: 'mm-miro-invoice', expected: 2, isAnchor: false },
  { templateKey: 'mm-physical-inventory', expected: 1, isAnchor: false },
  { templateKey: 'mm-stock-transfer-order', expected: 1, isAnchor: false },
  { templateKey: 'mm-special-stock', expected: 3, isAnchor: false },
  { templateKey: 'mm-output-print', expected: 2, isAnchor: false },
  // SD secondary
  { templateKey: 'sd-billing-run', expected: 1, isAnchor: false },
  { templateKey: 'sd-delivery-shipping', expected: 2, isAnchor: false },
  { templateKey: 'sd-tax-determination', expected: 1, isAnchor: false },
  { templateKey: 'sd-rma-returns', expected: 1, isAnchor: false },
  { templateKey: 'sd-tor-pp-interface', expected: 1, isAnchor: false },
  { templateKey: 'sd-credit-memo-workflow', expected: 1, isAnchor: false },
  { templateKey: 'sd-output-print', expected: 2, isAnchor: false },
  // PP secondary
  { templateKey: 'pp-production-order', expected: 4, isAnchor: false },
];

const ANCHOR_PASS_THRESHOLD = 0.8;
const WINDOW_DAYS = 90;
const TENANT_SLUG = 'intraedge';

async function main(): Promise<number> {
  const prisma = new PrismaClient();

  console.log('Issue Template Calibration');
  console.log('═══════════════════════════════════════════════════════════════');

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    console.error(`❌ Tenant '${TENANT_SLUG}' not found. Is the seed loaded?`);
    return 2;
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 86400000);
  const records = await prisma.iTSMRecord.findMany({
    where: {
      tenantId: tenant.id,
      recordType: 'INCIDENT',
      createdAt: { gte: since },
    },
    select: {
      id: true,
      recordNumber: true,
      title: true,
      priority: true,
      status: true,
      createdAt: true,
      sapModule: { select: { code: true } },
      sapSubModule: { select: { code: true } },
    },
  });

  console.log(`\nWindow: last ${WINDOW_DAYS} days · Tenant: ${tenant.slug}`);
  console.log(`Loaded ${records.length} INCIDENT records\n`);

  const tickets: MatchableTicket[] = records.map((r) => ({
    id: r.id,
    recordNumber: r.recordNumber,
    title: r.title,
    priority: r.priority,
    status: r.status,
    createdAt: r.createdAt,
    module: r.sapModule?.code ?? null,
    subModule: r.sapSubModule?.code ?? null,
  }));

  // Adapt SeedTemplate[] → DbTemplate[] for the matcher (synthetic ids; we're not
  // touching the DB here — just exercising the in-memory keyword logic).
  const templates: DbTemplate[] = SEED_TEMPLATES.map((s, idx) => ({
    id: `seed-${idx}`,
    templateKey: s.templateKey,
    module: s.module,
    subModule: s.subModule ?? null,
    label: s.label,
    must: s.must,
    boost: s.boost ?? [],
    not: s.not ?? [],
  }));

  const { byTemplate, unclassified } = classifyTickets(tickets, templates);

  // Map synthetic id → templateKey for reporting
  const idToKey = new Map(templates.map((t) => [t.id, t.templateKey]));

  // Per-template report
  console.log('─── Template Hit Report ──────────────────────────────────────');
  let anchorFailures = 0;
  for (const exp of EXPECTATIONS) {
    const tpl = templates.find((t) => t.templateKey === exp.templateKey);
    if (!tpl) {
      console.log(`  ${exp.templateKey.padEnd(34)} (template not found)`);
      continue;
    }
    const actual = (byTemplate.get(tpl.id) || []).length;
    const ratio = exp.expected > 0 ? actual / exp.expected : 1;
    const anchor = exp.isAnchor ? ' [anchor]' : '';

    let status: string;
    if (exp.isAnchor && ratio < ANCHOR_PASS_THRESHOLD) {
      status = '❌';
      anchorFailures++;
    } else if (ratio < 1) {
      status = '⚠️ ';
    } else if (ratio > 1.5) {
      status = '⚠️ ';
    } else {
      status = '✓ ';
    }

    const pct = Math.round(ratio * 100);
    console.log(
      `  ${status} ${exp.templateKey.padEnd(34)} ${String(actual).padStart(2)} / ${exp.expected} (${pct}%)${anchor}`,
    );
  }

  // Show what each template actually matched (titles only, debug aid)
  console.log('\n─── Per-Template Title Samples ───────────────────────────────');
  for (const exp of EXPECTATIONS) {
    const tpl = templates.find((t) => t.templateKey === exp.templateKey);
    if (!tpl) continue;
    const matches = byTemplate.get(tpl.id) || [];
    if (matches.length === 0) {
      console.log(`\n  ${exp.templateKey}: (no matches)`);
      continue;
    }
    console.log(`\n  ${exp.templateKey} (${matches.length}):`);
    for (const m of matches.slice(0, 8)) {
      console.log(`    · ${m.title}`);
    }
    if (matches.length > 8) console.log(`    ... and ${matches.length - 8} more`);
  }

  // Unclassified
  console.log('\n─── Unclassified Tickets ─────────────────────────────────────');
  console.log(`  Count: ${unclassified.length}`);
  if (unclassified.length > 0) {
    for (const u of unclassified.slice(0, 25)) {
      console.log(`    · [${u.module || '—'}] ${u.title}`);
    }
    if (unclassified.length > 25) console.log(`    ... and ${unclassified.length - 25} more`);
  }

  // Pass 2: Jaccard clusters on unclassified
  const clusters = clusterUnclassified(unclassified);
  console.log('\n─── Pass-2 Emergent Clusters (Jaccard ≥ 0.5) ────────────────');
  console.log(`  ${clusters.length} cluster(s)`);
  for (const c of clusters) {
    console.log(`\n  [${c.module}] tokens: ${c.tokens.join(' + ')} (${c.tickets.length} tickets)`);
    for (const t of c.tickets.slice(0, 5)) {
      console.log(`    · ${t.title}`);
    }
    if (c.tickets.length > 5) console.log(`    ... and ${c.tickets.length - 5} more`);
  }

  // Summary
  const totalClassified = [...byTemplate.values()].reduce((sum, v) => sum + v.length, 0);
  const totalEmergent = clusters.reduce((sum, c) => sum + c.tickets.length, 0);
  const finalUnclassified = unclassified.length - totalEmergent;

  console.log('\n─── Summary ──────────────────────────────────────────────────');
  console.log(`  Total INCIDENTS in window:   ${tickets.length}`);
  console.log(
    `  Classified by templates:     ${totalClassified}  (${Math.round((100 * totalClassified) / tickets.length)}%)`,
  );
  console.log(
    `  Emergent (Pass-2 clusters):  ${totalEmergent}  (${Math.round((100 * totalEmergent) / tickets.length)}%)`,
  );
  console.log(
    `  Final unclassified:          ${finalUnclassified}  (${Math.round((100 * finalUnclassified) / tickets.length)}%)`,
  );
  console.log(`  Anchor failures (< 80%):     ${anchorFailures}`);

  await prisma.$disconnect();
  return anchorFailures > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('❌ Calibration failed:', e);
    process.exit(1);
  });
