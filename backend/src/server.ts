import 'dotenv/config';
import app from './app';
import { logger } from './config/logger';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { startSLAWorker } from './workers/sla.worker';
import { startEmailWorker } from './workers/email.worker';
import { startEscalationWorker } from './workers/escalation.worker';
import { startAIWorker } from './workers/ai.worker';
import { seedDatabase } from './seed';
import { bootstrapIssueTemplates } from './services/issue-templates.service';
import { migrateFicoToFiCo } from './seeds/migrate-fico-to-fi-co';
import bcrypt from 'bcryptjs';

const PORT = parseInt(process.env.PORT || '3001', 10);

// ── Full reset: wipe everything, create Intraedge + admin@intraedge.com ──
async function resetAndReseed() {
  // Safety guard: if Intraedge tenant already exists, skip to prevent accidental wipes
  // Override with FORCE_RESET=true to bypass when you need a clean slate
  const existing = await prisma.tenant.findFirst({ where: { slug: 'intraedge' } });
  if (existing && !process.env.FORCE_RESET) {
    logger.info('ℹ️  Intraedge tenant already exists — skipping reset. Remove RESET_AND_RESEED from env vars.');
    return;
  }
  logger.info('⚠️  RESET_AND_RESEED + FORCE_RESET — wiping all data...');

  await prisma.sLAPauseHistory.deleteMany({});
  await prisma.sLATracking.deleteMany({});
  await prisma.timeEntry.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.emailLog.deleteMany({});
  await prisma.iTSMRecord.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.configurationItem.deleteMany({});

  // Contract relations
  try {
    await prisma.contractHolidayCalendar.deleteMany({});
  } catch {}
  await prisma.contractShift.deleteMany({});
  await prisma.contract.deleteMany({});
  try {
    await (prisma as any).customerAgent.deleteMany({});
  } catch {}
  try {
    await (prisma as any).sLAPolicyMaster.deleteMany({});
  } catch {}
  try {
    await (prisma as any).supportTypeMaster.deleteMany({});
  } catch {}

  await prisma.customer.deleteMany({});
  await prisma.agent.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.user.deleteMany({});

  // Holiday & shift cleanup
  try {
    await prisma.holidayDate.deleteMany({});
  } catch {}
  try {
    await prisma.holidayCalendar.deleteMany({});
  } catch {}
  await prisma.shift.deleteMany({});

  await prisma.tenant.deleteMany({});
  logger.info('✅ All data wiped.');

  // Create Intraedge tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Intraedge',
      slug: 'intraedge',
      timezone: 'Asia/Kolkata',
      country: 'IN',
      status: 'ACTIVE',
      settings: { maxUsers: 500, features: ['sla', 'email', 'cmdb', 'shifts', 'holidays'] },
    },
  });
  logger.info(`✅ Tenant created: ${tenant.name}`);

  // Create Super Admin
  const passwordHash = await bcrypt.hash('Admin@123456', 12);
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@intraedge.com',
      passwordHash,
      firstName: 'System',
      lastName: 'Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });
  logger.info(`✅ Super Admin: ${admin.email} / Admin@123456`);
  logger.info('🎉 Reset complete — login with admin@intraedge.com / Admin@123456');
}

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('✅ PostgreSQL connected');

    // RESET_AND_RESEED takes priority — wipes everything and creates fresh admin
    if (process.env.RESET_AND_RESEED === 'true') {
      await resetAndReseed();
    } else if (process.env.SEED_ON_BOOT === 'true') {
      try {
        await seedDatabase();
        logger.info('✅ Seed complete');
      } catch (e: any) {
        logger.warn('Seed skipped:', e?.message || e);
      }
    }

    // AMS_SEED_ON_BOOT — load GlobalManufacturing AG AMS data
    if (process.env.AMS_SEED_ON_BOOT === 'true') {
      logger.info('🌱 AMS_SEED_ON_BOOT=true — loading GlobalManufacturing AG AMS data...');
      try {
        const { seedAmsData } = await import('./ams-seed');
        await seedAmsData();
        logger.info('✅ AMS seed complete');
      } catch (e: any) {
        logger.error('❌ AMS seed failed:', e?.message || e);
      }
    }

    // Bootstrap issue templates per-tenant (idempotent, preserves SA edits via manuallyEdited flag)
    try {
      const tenants = await prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalSkipped = 0;
      for (const t of tenants) {
        const r = await bootstrapIssueTemplates(t.id);
        totalCreated += r.created;
        totalUpdated += r.updated;
        totalSkipped += r.skipped;
        logger.info(
          `[issue-templates] tenant ${t.slug}: created=${r.created}, updated=${r.updated}, skipped=${r.skipped}`,
        );
      }
      if (tenants.length > 0 && totalCreated + totalUpdated + totalSkipped === 0) {
        logger.warn('[issue-templates] no template changes — possible bootstrap bug');
      } else {
        logger.info(
          `[issue-templates] bootstrap complete: created=${totalCreated}, updated=${totalUpdated}, skipped=${totalSkipped} across ${tenants.length} tenant(s)`,
        );
      }
    } catch (e: any) {
      logger.warn('[issue-templates] bootstrap skipped:', e?.message || e);
    }

    // One-shot FICO → FI/CO split. Noop after the first successful run.
    try {
      const tenants = await prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true, slug: true } });
      for (const t of tenants) {
        const r = await migrateFicoToFiCo(prisma, t.id);
        if (r) {
          logger.info(
            `[fico→fi/co] tenant ${t.slug}: tickets=${r.ticketsRemapped}, specs=${r.specsSplit}, rules=${r.rulesDeleted}, ficoDeactivated=${r.ficoDeactivated}`,
          );
        }
      }
    } catch (e: any) {
      logger.warn('[fico→fi/co] migration skipped:', e?.message || e);
    }

    // Bootstrap default agent-scoring weights per customer (idempotent).
    // Seeds the priority='ALL' row with 30/20/25/15/10 for any customer
    // that doesn't already have one. Existing rows (including SA-edited
    // weights and per-priority overrides) are left untouched.
    try {
      const customers = await prisma.customer.findMany({ select: { id: true, tenantId: true } });
      const existing = await prisma.assignmentScoringConfig.findMany({
        where: { priority: 'ALL' },
        select: { customerId: true },
      });
      const haveDefault = new Set(existing.map((r) => r.customerId));
      const missing = customers.filter((c) => !haveDefault.has(c.id));
      if (missing.length > 0) {
        await prisma.assignmentScoringConfig.createMany({
          data: missing.map((c) => ({
            tenantId: c.tenantId,
            customerId: c.id,
            priority: 'ALL',
            moduleWeight: 30,
            subModuleWeight: 20,
            levelWeight: 25,
            workloadWeight: 15,
            availabilityWeight: 10,
          })),
        });
      }
      logger.info(`[scoring-configs] bootstrap: ${missing.length} customer(s) seeded, ${haveDefault.size} already configured`);
    } catch (e: any) {
      logger.warn('[scoring-configs] bootstrap skipped:', e?.message || e);
    }

    await redis.ping();
    logger.info('✅ Redis connected');

    startSLAWorker();
    startEmailWorker();
    startEscalationWorker();
    // AI classification worker — Phase A-1 runs in-process with the API.
    // TODO: in production scale, move this to a dedicated Railway service.
    startAIWorker();
    logger.info('✅ Workers started');

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`✅ Server running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (error) {
    logger.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

bootstrap();
