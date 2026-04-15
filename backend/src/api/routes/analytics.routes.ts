import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceTenantScope, enforceRole } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';

const router = Router();
router.use(verifyJWT, enforceTenantScope);
router.use(enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER', 'AGENT'));

// ── Scope helper ──────────────────────────────────────────────────────────────
async function buildAnalyticsScope(req: any): Promise<{ where: any } | null> {
  const { role, sub: userId, tenantId, customerId } = req.user!;

  if (role === 'SUPER_ADMIN') {
    return { where: { tenantId } };
  }
  if (role === 'COMPANY_ADMIN') {
    if (!customerId) return null;
    return { where: { tenantId, customerId } };
  }
  if (role === 'AGENT') {
    const agent = await resolveAgent(userId);
    if (!agent) return null;
    return { where: { tenantId, assignedAgentId: agent.id } };
  }
  if (role === 'PROJECT_MANAGER') {
    const agent = await resolveAgent(userId);
    if (!agent) return null;
    const ids = await resolveManagedCustomerIds(agent.id, tenantId);
    if (ids.length === 0) return null;
    return { where: { tenantId, customerId: { in: ids } } };
  }
  return null;
}

// ── GET /analytics/classification ─────────────────────────────────────────────
// Structured breakdown by SAP module + sub-module + record type + priority
router.get('/classification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildAnalyticsScope(req);
    if (!scope) { res.json({ success: true, data: [] }); return; }

    const { tenantId } = req.user!;
    const days = parseInt(req.query.days as string) || 30;
    const since = new Date(Date.now() - days * 86400000);
    const baseWhere = { ...scope.where, createdAt: { gte: since } };

    // Module breakdown with counts
    const [byModule, byType, byPriority, byStatus, topModules] = await Promise.all([
      // Per module: total, open, resolved
      prisma.sAPModuleMaster.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true, code: true, name: true,
          subModules: { select: { id: true, code: true, name: true } },
          records: {
            where: baseWhere,
            select: { status: true, priority: true, recordType: true, createdAt: true, resolvedAt: true },
          },
        },
      }),

      // By record type
      (prisma.iTSMRecord.groupBy as any)({
        by: ['recordType'],
        where: baseWhere,
        _count: { id: true },
      }),

      // By priority (open only)
      (prisma.iTSMRecord.groupBy as any)({
        by: ['priority'],
        where: { ...baseWhere, status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } },
        _count: { id: true },
      }),

      // By status
      (prisma.iTSMRecord.groupBy as any)({
        by: ['status'],
        where: baseWhere,
        _count: { id: true },
      }),

      // Top 5 modules by volume for heat signal
      (prisma.iTSMRecord.groupBy as any)({
        by: ['sapModuleId'],
        where: { ...baseWhere, sapModuleId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
    ]);

    // Build module breakdown with health signal
    const moduleBreakdown = byModule
      .filter((m: any) => m.records.length > 0)
      .map((m: any) => {
        const records = m.records;
        const total = records.length;
        const open = records.filter((r: any) => !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(r.status)).length;
        const resolved = records.filter((r: any) => ['RESOLVED', 'CLOSED'].includes(r.status)).length;
        const p1p2 = records.filter((r: any) => ['P1', 'P2'].includes(r.priority) && !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(r.status)).length;
        const incidents = records.filter((r: any) => r.recordType === 'INCIDENT').length;

        // Health signal: red = p1p2 > 2 or open > total*0.7, amber = open > total*0.4, green = otherwise
        const health = p1p2 > 2 || open > total * 0.7 ? 'critical'
          : open > total * 0.4 || p1p2 > 0 ? 'warning'
          : 'healthy';

        // Sub-module breakdown
        const subBreakdown = m.subModules.map((sm: any) => {
          const smRecords = records.filter((r: any) => r.sapSubModuleId === sm.id);
          return { id: sm.id, code: sm.code, name: sm.name, count: smRecords.length };
        }).filter((sm: any) => sm.count > 0);

        return {
          moduleId: m.id,
          code: m.code,
          name: m.name,
          total,
          open,
          resolved,
          p1p2Open: p1p2,
          incidents,
          health,
          subModules: subBreakdown,
        };
      })
      .sort((a: any, b: any) => b.total - a.total);

    // Totals
    const totalRecords = await prisma.iTSMRecord.count({ where: baseWhere });
    const totalOpen = await prisma.iTSMRecord.count({
      where: { ...baseWhere, status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } },
    });

    res.json({
      success: true,
      period: { days, since },
      summary: {
        total: totalRecords,
        open: totalOpen,
        resolved: totalRecords - totalOpen,
      },
      moduleBreakdown,
      byType: byType.map((t: any) => ({ type: t.recordType, count: t._count.id })),
      byPriority: byPriority.map((p: any) => ({ priority: p.priority, count: p._count.id })),
      byStatus: byStatus.map((s: any) => ({ status: s.status, count: s._count.id })),
    });
  } catch (err) { next(err); }
});

// ── GET /analytics/patterns ────────────────────────────────────────────────────
// Recurring incident clusters in rolling window
router.get('/patterns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildAnalyticsScope(req);
    if (!scope) { res.json({ success: true, patterns: [] }); return; }

    const { tenantId } = req.user!;
    const days = parseInt(req.query.days as string) || 30;
    const threshold = parseInt(req.query.threshold as string) || 3;
    const since = new Date(Date.now() - days * 86400000);
    const baseWhere = { ...scope.where, createdAt: { gte: since }, recordType: 'INCIDENT' };

    // Group by module + sub-module to find repeat patterns
    const modulePatterns = await (prisma.iTSMRecord.groupBy as any)({
      by: ['sapModuleId', 'sapSubModuleId'],
      where: { ...baseWhere, sapModuleId: { not: null } },
      _count: { id: true },
      having: { id: { _count: { gte: threshold } } },
      orderBy: { _count: { id: 'desc' } },
    });

    // Enrich with module names and sample tickets
    const enriched = await Promise.all(
      modulePatterns.map(async (p: any) => {
        const [mod, subMod, samples, linked] = await Promise.all([
          p.sapModuleId ? prisma.sAPModuleMaster.findUnique({
            where: { id: p.sapModuleId }, select: { code: true, name: true },
          }) : null,
          p.sapSubModuleId ? prisma.sAPSubModuleMaster.findUnique({
            where: { id: p.sapSubModuleId }, select: { code: true, name: true },
          }) : null,
          // Sample 3 recent tickets for this pattern
          prisma.iTSMRecord.findMany({
            where: { ...baseWhere, sapModuleId: p.sapModuleId, sapSubModuleId: p.sapSubModuleId },
            select: { id: true, recordNumber: true, title: true, priority: true, status: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 3,
          }),
          // Check if a Problem record exists for this module in the window
          prisma.iTSMRecord.count({
            where: {
              ...scope.where,
              recordType: 'PROBLEM',
              sapModuleId: p.sapModuleId,
              createdAt: { gte: since },
            },
          }),
        ]);

        return {
          moduleId: p.sapModuleId,
          subModuleId: p.sapSubModuleId,
          moduleCode: mod?.code || 'UNKNOWN',
          moduleName: mod?.name || 'Unknown Module',
          subModuleCode: subMod?.code || null,
          subModuleName: subMod?.name || null,
          count: p._count.id,
          hasProblemRecord: linked > 0,
          severity: p._count.id >= 8 ? 'high' : p._count.id >= 5 ? 'medium' : 'low',
          samples,
        };
      })
    );

    res.json({
      success: true,
      period: { days, threshold },
      patterns: enriched,
      totalPatterns: enriched.length,
      highSeverity: enriched.filter((p: any) => p.severity === 'high').length,
    });
  } catch (err) { next(err); }
});

// ── GET /analytics/root-cause ──────────────────────────────────────────────────
// Where tickets stall — avg time in each status by module
router.get('/root-cause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildAnalyticsScope(req);
    if (!scope) { res.json({ success: true, data: [] }); return; }

    const { tenantId } = req.user!;
    const days = parseInt(req.query.days as string) || 30;
    const since = new Date(Date.now() - days * 86400000);

    // Stalled tickets: open for more than 2 days, by module and status
    const stalledByModule = await prisma.$queryRawUnsafe(`
      SELECT
        m.code AS module_code,
        m.name AS module_name,
        r.status,
        COUNT(*)::int AS count,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - r.updated_at))/3600)::numeric, 1) AS avg_hours_in_status,
        SUM(CASE WHEN r.priority IN ('P1','P2') THEN 1 ELSE 0 END)::int AS critical_count
      FROM itsm_records r
      LEFT JOIN sap_module_masters m ON m.id = r.sap_module_id
      WHERE r.tenant_id = $1
        AND r.created_at >= $2
        AND r.status NOT IN ('RESOLVED','CLOSED','CANCELLED')
        AND r.updated_at <= NOW() - INTERVAL '2 hours'
      GROUP BY m.code, m.name, r.status
      ORDER BY avg_hours_in_status DESC
      LIMIT 30
    `, tenantId, since);

    // Top bottleneck agents (most tickets in PENDING > 24h)
    const pendingByAgent = await prisma.$queryRawUnsafe(`
      SELECT
        u.first_name || ' ' || u.last_name AS agent_name,
        COUNT(*)::int AS pending_count,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - r.updated_at))/3600)::numeric, 1) AS avg_pending_hours
      FROM itsm_records r
      JOIN agents a ON a.id = r.assigned_agent_id
      JOIN users u ON u.id = a.user_id
      WHERE r.tenant_id = $1
        AND r.status = 'PENDING'
        AND r.updated_at <= NOW() - INTERVAL '24 hours'
      GROUP BY u.first_name, u.last_name
      ORDER BY pending_count DESC
      LIMIT 10
    `, tenantId);

    res.json({
      success: true,
      period: { days },
      stalledByModule,
      pendingByAgent,
    });
  } catch (err) { next(err); }
});

// ── GET /analytics/knowledge-gaps ─────────────────────────────────────────────
// Module+priority combos with recurring incidents and no Problem record
router.get('/knowledge-gaps', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildAnalyticsScope(req);
    if (!scope) { res.json({ success: true, gaps: [] }); return; }

    const { tenantId } = req.user!;
    const days = parseInt(req.query.days as string) || 60;
    const since = new Date(Date.now() - days * 86400000);
    const baseWhere = { ...scope.where, createdAt: { gte: since }, recordType: 'INCIDENT' as any };

    // Find module+priority combos with 3+ incidents and NO linked Problem
    const incidentGroups = await (prisma.iTSMRecord.groupBy as any)({
      by: ['sapModuleId', 'priority'],
      where: { ...baseWhere, sapModuleId: { not: null } },
      _count: { id: true },
      having: { id: { _count: { gte: 3 } } },
      orderBy: { _count: { id: 'desc' } },
    });

    const gaps = await Promise.all(
      incidentGroups.map(async (g: any) => {
        const [mod, problemCount, avgResolution, unresolved] = await Promise.all([
          prisma.sAPModuleMaster.findUnique({
            where: { id: g.sapModuleId }, select: { code: true, name: true },
          }),
          // Check for Problem records
          prisma.iTSMRecord.count({
            where: {
              ...scope.where,
              recordType: 'PROBLEM',
              sapModuleId: g.sapModuleId,
              createdAt: { gte: since },
            },
          }),
          // Avg resolution time for resolved in this combo
          prisma.$queryRawUnsafe(`
            SELECT ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600)::numeric, 1) as avg_hours
            FROM itsm_records
            WHERE tenant_id = $1 AND sap_module_id = $2 AND priority = $3
              AND record_type = 'INCIDENT' AND resolved_at IS NOT NULL AND created_at >= $4
          `, tenantId, g.sapModuleId, g.priority, since),
          // How many still unresolved
          prisma.iTSMRecord.count({
            where: {
              ...baseWhere,
              sapModuleId: g.sapModuleId,
              priority: g.priority,
              status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] },
            },
          }),
        ]);

        const avgHours = (avgResolution as any)?.[0]?.avg_hours || null;
        const gapScore = (g._count.id * (unresolved + 1)) / (problemCount + 1);

        return {
          moduleId: g.sapModuleId,
          moduleCode: mod?.code || 'UNKNOWN',
          moduleName: mod?.name || 'Unknown',
          priority: g.priority,
          incidentCount: g._count.id,
          unresolvedCount: unresolved,
          hasProblemRecord: problemCount > 0,
          avgResolutionHours: avgHours ? Number(avgHours) : null,
          gapScore: Math.round(gapScore * 10) / 10,
          recommendation: problemCount === 0 && g._count.id >= 5
            ? 'Create Problem record — recurring pattern with no root-cause investigation'
            : problemCount === 0
            ? 'Consider KB article — no documented resolution path'
            : 'Problem record exists — check if linked',
        };
      })
    );

    // Sort by gap score descending
    gaps.sort((a: any, b: any) => b.gapScore - a.gapScore);

    res.json({
      success: true,
      period: { days },
      gaps,
      totalGaps: gaps.length,
      criticalGaps: gaps.filter((g: any) => !g.hasProblemRecord && g.incidentCount >= 5).length,
    });
  } catch (err) { next(err); }
});

// ── GET /analytics/similar/:recordId ──────────────────────────────────────────
// Top 5 similar resolved tickets for a given record
router.get('/similar/:recordId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildAnalyticsScope(req);
    if (!scope) { res.json({ success: true, similar: [] }); return; }

    const { recordId } = req.params;
    const { tenantId } = req.user!;

    // Load the source ticket
    const source = await prisma.iTSMRecord.findFirst({
      where: { id: recordId, tenantId },
      select: {
        id: true, title: true, sapModuleId: true, sapSubModuleId: true,
        recordType: true, priority: true, tags: true,
      },
    });

    if (!source) { res.status(404).json({ success: false, error: 'Record not found' }); return; }

    // Find similar: same module + sub-module, resolved, exclude self
    // Score: exact sub-module match = +3, same module = +2, same priority = +1, same type = +1
    const candidates = await prisma.iTSMRecord.findMany({
      where: {
        ...scope.where,
        id: { not: recordId },
        status: { in: ['RESOLVED', 'CLOSED'] },
        sapModuleId: source.sapModuleId || undefined,
        resolvedAt: { not: null },
      },
      select: {
        id: true, recordNumber: true, title: true, priority: true,
        status: true, recordType: true, sapModuleId: true, sapSubModuleId: true,
        createdAt: true, resolvedAt: true, tags: true,
        customer: { select: { companyName: true } },
        comments: {
          where: { internalFlag: false },
          select: { text: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { resolvedAt: 'desc' },
      take: 50,
    });

    // Score and rank
    const scored = candidates.map((c: any) => {
      let score = 0;
      if (c.sapModuleId === source.sapModuleId) score += 2;
      if (c.sapSubModuleId && c.sapSubModuleId === source.sapSubModuleId) score += 3;
      if (c.priority === source.priority) score += 1;
      if (c.recordType === source.recordType) score += 1;
      // Tag overlap
      const tagOverlap = (source.tags || []).filter((t: string) => (c.tags || []).includes(t)).length;
      score += tagOverlap;

      const resolutionHours = c.resolvedAt
        ? Math.round((new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime()) / 3600000)
        : null;

      return { ...c, similarityScore: score, resolutionHours, lastComment: c.comments?.[0]?.text || null };
    });

    const top5 = scored
      .filter((c: any) => c.similarityScore >= 2)
      .sort((a: any, b: any) => b.similarityScore - a.similarityScore)
      .slice(0, 5)
      .map(({ comments, ...rest }: any) => rest);

    res.json({ success: true, sourceId: recordId, similar: top5 });
  } catch (err) { next(err); }
});

export default router;
