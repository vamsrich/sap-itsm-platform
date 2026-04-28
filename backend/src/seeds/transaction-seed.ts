/**
 * Transaction Seed v1 — recompute SLA tracking + populate TimeEntry rows
 *
 * Run:
 *   cd backend && set -a && source .env.seedrun && set +a \
 *     && npx ts-node src/seeds/transaction-seed.ts
 *
 * What this does:
 *   PASS A — Recompute SLATracking for every customer record using the contract's
 *     active SLAPolicyMaster.priorities. If a priority has no entry (or is disabled),
 *     deletes the SLATracking row. Otherwise updates deadlines from createdAt and
 *     recomputes breachResponse / breachResolution against actual respondedAt /
 *     resolvedAt timestamps.
 *
 *   PASS B — Populates TimeEntry rows on RESOLVED / CLOSED records:
 *     - Idempotent: deletes existing TimeEntry rows scoped to this customer's
 *       records first
 *     - 1-3 entries per record, ~1.5h avg per FICO/MM/SD ticket, ~2.5h for PP,
 *       ±30% variance
 *     - workDate randomised between createdAt and resolvedAt
 *     - status=APPROVED, approvedById=SUPER_ADMIN, approvedAt=resolvedAt+1d
 *
 * Safety: no unscoped deleteMany. No deletes on Customer / Contract / ITSMRecord.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🌱 Transaction Seed v1\n');

  // ── 1. Tenant ──
  const tenant = await prisma.tenant.findFirst({ where: { slug: 'intraedge' } });
  if (!tenant) throw new Error("Tenant 'intraedge' not found");

  // ── 2. Customer ──
  const customer = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, companyName: { contains: 'GlobalManufacturing' } },
  });
  if (!customer) throw new Error('GlobalManufacturing customer not found');

  // ── 3. Active contract with SLA policy ──
  const contract = await prisma.contract.findFirst({
    where: { customerId: customer.id, isActive: true },
    include: { slaPolicyMaster: true },
  });
  if (!contract) throw new Error('Active contract not found for this customer');

  // ── 4. SUPER_ADMIN user (approver for time entries) ──
  const saUser = await prisma.user.findUnique({ where: { email: 'admin@intraedge.com' } });
  if (!saUser) throw new Error('SUPER_ADMIN user (admin@intraedge.com) not found');

  console.log(`Tenant:    ${tenant.name}`);
  console.log(`Customer:  ${customer.companyName}`);
  console.log(`Contract:  ${contract.contractNumber}`);
  console.log(`SLA:       ${contract.slaPolicyMaster?.code ?? '— none —'}`);
  console.log(`Approver:  ${saUser.email}`);

  // ── 5. Load all records for the customer ──
  const records = await prisma.iTSMRecord.findMany({
    where: { customerId: customer.id },
    include: {
      slaTracking: true,
      sapModule: { select: { code: true } },
    },
  });
  console.log(`\nRecords loaded: ${records.length}\n`);

  // ═══ PASS A — SLA recompute ═══════════════════════════════════════════════
  let slaUpdated = 0;
  let slaCreated = 0;
  let slaDeleted = 0;
  let slaSkipped = 0;

  let respondedAtBackfilled = 0;

  if (contract.slaPolicyMaster) {
    const priorities = (contract.slaPolicyMaster.priorities || {}) as Record<
      string,
      { response: number; resolution: number; enabled?: boolean }
    >;
    const now = new Date();

    for (const r of records) {
      const targets = priorities[r.priority];
      const hasTargets =
        targets && targets.response && targets.resolution && targets.enabled !== false;

      if (!hasTargets) {
        // No policy entry for this priority (or disabled) → delete SLATracking row
        if (r.slaTracking) {
          await prisma.sLATracking.delete({ where: { id: r.slaTracking.id } });
          slaDeleted++;
        } else {
          slaSkipped++;
        }
        continue;
      }

      const responseDeadline = new Date(r.createdAt.getTime() + targets.response * 60 * 1000);
      const resolutionDeadline = new Date(r.createdAt.getTime() + targets.resolution * 60 * 1000);

      // Backfill respondedAt for resolved/closed records that don't have one.
      // The AMS seed never populated respondedAt — without this backfill, the breach
      // recompute below has no actual response timestamp and would over-mark every
      // record as response-breached. Place respondedAt at 40-90% of the response budget
      // (so most records show as in-time response), capped at 1 min before resolvedAt
      // to maintain temporal ordering.
      let effectiveRespondedAt = r.respondedAt;
      if (!effectiveRespondedAt && ['RESOLVED', 'CLOSED'].includes(r.status) && r.resolvedAt) {
        const respondedFraction = 0.4 + Math.random() * 0.5; // 40-90% of response budget
        const candidate = r.createdAt.getTime() + targets.response * 60 * 1000 * respondedFraction;
        const maxAllowed = r.resolvedAt.getTime() - 60_000;
        effectiveRespondedAt = new Date(Math.min(candidate, maxAllowed));
        await prisma.iTSMRecord.update({
          where: { id: r.id },
          data: { respondedAt: effectiveRespondedAt },
        });
        respondedAtBackfilled++;
      }

      // Recompute breach against actuals.
      let breachResponse: boolean;
      let breachResolution: boolean;
      if (r.status === 'CANCELLED') {
        breachResponse = false;
        breachResolution = false;
      } else {
        // Response: use effectiveRespondedAt if known. If still null (open ticket
        // never responded), compare now to deadline. Do NOT fall back to resolvedAt —
        // that overstates breach for resolved tickets that genuinely responded in time
        // but weren't recorded.
        const responseRef = effectiveRespondedAt ?? now;
        const resolutionRef = r.resolvedAt ?? now;
        breachResponse = responseRef.getTime() > responseDeadline.getTime();
        breachResolution = resolutionRef.getTime() > resolutionDeadline.getTime();
      }

      if (r.slaTracking) {
        await prisma.sLATracking.update({
          where: { id: r.slaTracking.id },
          data: {
            responseDeadline,
            resolutionDeadline,
            breachResponse,
            breachResolution,
            respondedAt: effectiveRespondedAt,
          },
        });
        slaUpdated++;
      } else {
        await prisma.sLATracking.create({
          data: {
            recordId: r.id,
            responseDeadline,
            resolutionDeadline,
            breachResponse,
            breachResolution,
            respondedAt: effectiveRespondedAt,
          },
        });
        slaCreated++;
      }
    }

    console.log(
      `✅ Pass A — SLA: ${slaUpdated} updated, ${slaCreated} created, ${slaDeleted} deleted (no policy entry), ${slaSkipped} skipped`,
    );
    console.log(`   ↳ respondedAt backfilled on ${respondedAtBackfilled} records (was null)`);
  } else {
    console.log('⚠️  Pass A skipped — contract has no SLA policy assigned');
  }

  // ═══ PASS B — TimeEntry seed ═══════════════════════════════════════════════

  const recordIds = records.map((r) => r.id);

  // Idempotent: clear existing TimeEntry for this customer's records
  const cleared = await prisma.timeEntry.deleteMany({
    where: { recordId: { in: recordIds } },
  });
  console.log(`\nCleared ${cleared.count} existing TimeEntry rows for this customer's records`);

  let teCreated = 0;
  let teSkippedNotResolved = 0;
  let teSkippedNoAgent = 0;

  for (const r of records) {
    if (!['RESOLVED', 'CLOSED'].includes(r.status)) {
      teSkippedNotResolved++;
      continue;
    }
    if (!r.assignedAgentId || !r.resolvedAt) {
      teSkippedNoAgent++;
      continue;
    }

    const moduleCode = r.sapModule?.code;
    const baseHours = moduleCode === 'PP' ? 2.5 : 1.5;
    const numEntries = 1 + Math.floor(Math.random() * 3); // 1, 2, or 3

    const createdAtMs = r.createdAt.getTime();
    const resolvedAtMs = r.resolvedAt.getTime();
    const span = Math.max(1, resolvedAtMs - createdAtMs);

    for (let i = 0; i < numEntries; i++) {
      const variance = 0.7 + Math.random() * 0.6; // ±30%
      const hours = Math.round(((baseHours / numEntries) * variance) * 100) / 100;
      const workDate = new Date(createdAtMs + Math.random() * span);
      const approvedAt = new Date(resolvedAtMs + 86400000); // resolvedAt + 1 day

      await prisma.timeEntry.create({
        data: {
          recordId: r.id,
          agentId: r.assignedAgentId,
          hours,
          description: `Investigation step ${i + 1}`,
          workDate,
          status: 'APPROVED',
          approvedById: saUser.id,
          approvedAt,
        },
      });
      teCreated++;
    }
  }

  console.log(
    `✅ Pass B — TimeEntry: ${teCreated} created, ${teSkippedNotResolved} skipped (not resolved/closed), ${teSkippedNoAgent} skipped (no agent or resolvedAt)`,
  );

  console.log('\n🎉 Transaction Seed v1 complete\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('❌ Transaction seed failed:', e);
    prisma.$disconnect();
    process.exit(1);
  });
