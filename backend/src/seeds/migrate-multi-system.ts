// One-shot migration runner for the A-2a multi-system foundation.
//
// Reads `prisma/migrations/manual/2026-05-02-multi-system.sql`, splits it
// into individual statements, and executes each inside a single Prisma
// interactive transaction.
//
// We split + run statement-by-statement because $executeRawUnsafe uses
// prepared statements which don't accept multi-statement scripts.

import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function splitSql(sql: string): string[] {
  // Strip comment-only lines, then split on ';' at end of line.
  const cleaned = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return cleaned
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !/^(BEGIN|COMMIT)$/i.test(s)); // Prisma's interactive tx handles begin/commit
}

(async () => {
  const sqlPath = join(__dirname, '..', '..', 'prisma', 'migrations', 'manual', '2026-05-02-multi-system.sql');
  const sql = readFileSync(sqlPath, 'utf8');
  const statements = splitSql(sql);

  console.log(`[migrate] running: ${sqlPath}`);
  console.log(`[migrate] ${statements.length} statements`);

  try {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const preview = stmt.split('\n')[0].slice(0, 90);
        console.log(`[migrate] [${i + 1}/${statements.length}] ${preview}`);
        await tx.$executeRawUnsafe(stmt);
      }
    }, { timeout: 60_000 });
    console.log('[migrate] ✅ SQL executed successfully');

    const systems = await prisma.$queryRawUnsafe<Array<{ code: string }>>(
      `SELECT code FROM enterprise_systems ORDER BY code`,
    );
    console.log(`[migrate] enterprise_systems: ${systems.map((s) => s.code).join(', ')}`);

    const cfgRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint as count FROM classifier_configs`,
    );
    console.log(`[migrate] classifier_configs rows: ${cfgRows[0].count}`);

    const nullModuleSys = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint as count FROM module_masters WHERE system_id IS NULL`,
    );
    console.log(`[migrate] module_masters with NULL system_id: ${nullModuleSys[0].count}`);

    const nullRecordSys = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint as count FROM itsm_records WHERE system_id IS NULL`,
    );
    console.log(`[migrate] itsm_records with NULL system_id: ${nullRecordSys[0].count}`);

    const customerLinks = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint as count FROM customer_systems`,
    );
    console.log(`[migrate] customer_systems rows: ${customerLinks[0].count}`);
  } catch (err) {
    console.error('[migrate] ❌ failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
