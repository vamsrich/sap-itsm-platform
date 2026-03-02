import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { cache } from '../../config/redis';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

// GET /dashboard — overview metrics
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const cacheKey = cache.key.dashboard(tenantId);

    const cached = await cache.get(cacheKey);
    if (cached) { res.json({ success: true, dashboard: cached }); return; }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalOpen,
      newToday,
      p1Open,
      slaBreaches,
      byStatus,
      byPriority,
      byType,
      recentRecords,
      agentWorkload,
      slaHealth,
    ] = await Promise.all([
      // Total open
      prisma.iTSMRecord.count({
        where: { tenantId, status: { in: ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING'] } },
      }),
      // New today
      prisma.iTSMRecord.count({
        where: { tenantId, createdAt: { gte: today } },
      }),
      // Open P1
      prisma.iTSMRecord.count({
        where: { tenantId, priority: 'P1', status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } },
      }),
      // SLA Breaches (active)
      prisma.sLATracking.count({
        where: {
          record: { tenantId },
          OR: [{ breachResponse: true }, { breachResolution: true }],
        },
      }),
      // By status
      prisma.iTSMRecord.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: true,
      }),
      // By priority
      prisma.iTSMRecord.groupBy({
        by: ['priority'],
        where: { tenantId, status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } },
        _count: true,
      }),
      // By type
      prisma.iTSMRecord.groupBy({
        by: ['recordType'],
        where: { tenantId, status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } },
        _count: true,
      }),
      // Recent records
      prisma.iTSMRecord.findMany({
        where: { tenantId },
        select: {
          id: true, recordNumber: true, title: true, priority: true, status: true,
          recordType: true, createdAt: true,
          customer: { select: { companyName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Agent workload
      prisma.iTSMRecord.groupBy({
        by: ['assignedAgentId'],
        where: { tenantId, status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] }, assignedAgentId: { not: null } },
        _count: true,
        orderBy: { _count: { assignedAgentId: 'desc' } },
        take: 10,
      }),
      // SLA health stats
      prisma.sLATracking.aggregate({
        where: { record: { tenantId } },
        _count: { _all: true },
      }),
    ]);

    // Monthly trend
    const monthlyData = await prisma.$queryRaw<any[]>`
      SELECT 
        DATE_TRUNC('day', "created_at") as day,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN ('RESOLVED','CLOSED')) as resolved
      FROM itsm_records
      WHERE tenant_id = ${tenantId}
        AND created_at >= ${thisMonth}
      GROUP BY day
      ORDER BY day
    `;

    const dashboard = {
      summary: { totalOpen, newToday, p1Open, slaBreaches },
      byStatus: byStatus.map((s: any) => ({ status: s.status, count: s._count })),
      byPriority: byPriority.map((p: any) => ({ priority: p.priority, count: p._count })),
      byType: byType.map((t: any) => ({ type: t.recordType, count: t._count })),
      recentRecords,
      agentWorkload,
      monthlyTrend: monthlyData,
      generatedAt: now,
    };

    await cache.set(cacheKey, dashboard, 120); // 2 min cache
    res.json({ success: true, dashboard });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/sla-report
router.get('/sla-report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();

    const slaData = await prisma.sLATracking.findMany({
      where: {
        record: { tenantId, createdAt: { gte: from, lte: to } },
      },
      include: {
        record: {
          select: {
            recordNumber: true,
            priority: true,
            recordType: true,
            status: true,
            customer: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const summary = {
      total: slaData.length,
      breachResponse: slaData.filter((s: any) => s.breachResponse).length,
      breachResolution: slaData.filter((s: any) => s.breachResolution).length,
      compliant: slaData.filter((s: any) => !s.breachResponse && !s.breachResolution).length,
    };

    res.json({ success: true, summary, records: slaData });
  } catch (err) {
    next(err);
  }
});

export default router;
