// One-shot, idempotent boot migration: split the legacy FICO module
// into separate FI and CO modules.
//
// - Tickets: moduleId=FICO + subModuleId=FICO-GL/AP/AR → FI with mapped sub.
//            moduleId=FICO + subModuleId=FICO-CO       → CO with sub=CCA.
//            moduleId=FICO + subModuleId=null          → FI (best-guess default).
// - Agent specializations on FICO → split into FI + CO specs.
// - Assignment rules targeting FICO → deleted (operator can recreate).
// - FICO module + its 4 sub-modules → deactivated (kept for audit trail).
//
// Safe to re-run: noop when no FICO module is found for a tenant.

import { PrismaClient } from '@prisma/client';

interface MigrationResult {
  tenantId: string;
  ticketsRemapped: number;
  specsSplit: number;
  rulesDeleted: number;
  ficoDeactivated: boolean;
}

export async function migrateFicoToFiCo(prisma: PrismaClient, tenantId: string): Promise<MigrationResult | null> {
  const result: MigrationResult = {
    tenantId,
    ticketsRemapped: 0,
    specsSplit: 0,
    rulesDeleted: 0,
    ficoDeactivated: false,
  };

  // 1. Find the FICO module for this tenant.
  const fico = await prisma.moduleMaster.findFirst({
    where: { tenantId, code: 'FICO' },
    include: { subModules: true },
  });
  if (!fico) return null;

  // 2. Need a systemId to attach new modules to. Reuse FICO's.
  const systemId = fico.systemId;

  // 3. Ensure FI and CO modules exist (idempotent upsert by code).
  const fi = await prisma.moduleMaster.upsert({
    where: { tenantId_systemId_code: { tenantId, systemId, code: 'FI' } },
    update: { isActive: true },
    create: { tenantId, systemId, code: 'FI', name: 'Financial Accounting', isActive: true },
  });
  const co = await prisma.moduleMaster.upsert({
    where: { tenantId_systemId_code: { tenantId, systemId, code: 'CO' } },
    update: { isActive: true },
    create: { tenantId, systemId, code: 'CO', name: 'Controlling', isActive: true },
  });

  // 4. Ensure FI sub-modules (GL/AP/AR) and CO sub-module (CCA) exist.
  const ensureSub = async (parent: { id: string }, code: string, name: string) =>
    prisma.subModuleMaster.upsert({
      where: { tenantId_moduleId_code: { tenantId, moduleId: parent.id, code } },
      update: { isActive: true },
      create: { tenantId, systemId, moduleId: parent.id, code, name, isActive: true },
    });

  const fiGL = await ensureSub(fi, 'GL', 'General Ledger');
  const fiAP = await ensureSub(fi, 'AP', 'Accounts Payable');
  const fiAR = await ensureSub(fi, 'AR', 'Accounts Receivable');
  const coCCA = await ensureSub(co, 'CCA', 'Cost Center Accounting');

  // 5. Build the FICO sub → new (module, sub) mapping by old sub code.
  const ficoSubByCode = new Map(fico.subModules.map((s) => [s.code, s]));
  const remapTargets: Array<{ oldSubId: string | null; newModuleId: string; newSubId: string | null }> = [
    { oldSubId: ficoSubByCode.get('FICO-GL')?.id ?? null, newModuleId: fi.id, newSubId: fiGL.id },
    { oldSubId: ficoSubByCode.get('FICO-AP')?.id ?? null, newModuleId: fi.id, newSubId: fiAP.id },
    { oldSubId: ficoSubByCode.get('FICO-AR')?.id ?? null, newModuleId: fi.id, newSubId: fiAR.id },
    { oldSubId: ficoSubByCode.get('FICO-CO')?.id ?? null, newModuleId: co.id, newSubId: coCCA.id },
  ];

  // 6. Remap tickets.
  for (const t of remapTargets) {
    if (!t.oldSubId) continue;
    const r = await prisma.iTSMRecord.updateMany({
      where: { tenantId, moduleId: fico.id, subModuleId: t.oldSubId },
      data: { moduleId: t.newModuleId, subModuleId: t.newSubId },
    });
    result.ticketsRemapped += r.count;
  }
  // Tickets on FICO with null sub-module → default to FI, sub stays null.
  const fallback = await prisma.iTSMRecord.updateMany({
    where: { tenantId, moduleId: fico.id, subModuleId: null },
    data: { moduleId: fi.id },
  });
  result.ticketsRemapped += fallback.count;

  // 7. Split agent specializations. Each FICO spec becomes a FI spec
  //    (with FI subs from the old spec) and a CO spec (with CCA if the
  //    old spec included FICO-CO).
  const oldSpecs = await prisma.agentSpecialization.findMany({
    where: { moduleId: fico.id },
  });
  for (const spec of oldSpecs) {
    const oldSubIds = new Set(spec.subModuleIds);
    const fiSubs = [fiGL.id, fiAP.id, fiAR.id].filter((id, i) => {
      const oldId = [ficoSubByCode.get('FICO-GL')?.id, ficoSubByCode.get('FICO-AP')?.id, ficoSubByCode.get('FICO-AR')?.id][i];
      return oldId && oldSubIds.has(oldId);
    });
    const coSubs = oldSubIds.has(ficoSubByCode.get('FICO-CO')?.id ?? '') ? [coCCA.id] : [];

    // If the old spec listed no recognised subs (e.g. empty), default to all FI subs.
    if (fiSubs.length > 0 || coSubs.length === 0) {
      await prisma.agentSpecialization.upsert({
        where: { agentId_moduleId: { agentId: spec.agentId, moduleId: fi.id } },
        update: { subModuleIds: fiSubs.length > 0 ? fiSubs : [fiGL.id, fiAP.id, fiAR.id] },
        create: {
          agentId: spec.agentId,
          moduleId: fi.id,
          subModuleIds: fiSubs.length > 0 ? fiSubs : [fiGL.id, fiAP.id, fiAR.id],
        },
      });
    }
    if (coSubs.length > 0) {
      await prisma.agentSpecialization.upsert({
        where: { agentId_moduleId: { agentId: spec.agentId, moduleId: co.id } },
        update: { subModuleIds: coSubs },
        create: { agentId: spec.agentId, moduleId: co.id, subModuleIds: coSubs },
      });
    }
    await prisma.agentSpecialization.delete({ where: { id: spec.id } });
    result.specsSplit++;
  }

  // 8. Delete assignment rules targeting FICO (operator recreates via UI).
  const ruleDelete = await prisma.assignmentRule.deleteMany({
    where: { tenantId, moduleId: fico.id },
  });
  result.rulesDeleted = ruleDelete.count;

  // 9. Deactivate FICO module + its 4 sub-modules (keep rows for audit).
  await prisma.subModuleMaster.updateMany({
    where: { moduleId: fico.id },
    data: { isActive: false },
  });
  await prisma.moduleMaster.update({
    where: { id: fico.id },
    data: { isActive: false },
  });
  result.ficoDeactivated = true;

  return result;
}
