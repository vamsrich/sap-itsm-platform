// One-shot backfill: link every existing contract to the SAP EnterpriseSystem.
// Idempotent — only updates contracts where systemId IS NULL.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  const sap = await prisma.enterpriseSystem.findUnique({ where: { code: 'sap' } });
  if (!sap) throw new Error('SAP EnterpriseSystem missing — run multi-system migration first');
  const result = await prisma.contract.updateMany({
    where: { systemId: null },
    data: { systemId: sap.id },
  });
  console.log(`[backfill] linked ${result.count} contract(s) to SAP system_id=${sap.id}`);
  const remaining = await prisma.contract.count({ where: { systemId: null } });
  console.log(`[backfill] contracts still NULL system_id: ${remaining}`);
  await prisma.$disconnect();
})();
