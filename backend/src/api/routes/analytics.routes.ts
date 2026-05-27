import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceTenantScope, enforceRole } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';
import {
  classifyTickets,
  clusterUnclassified,
  toDbTemplate,
  severityFor,
  MatchableTicket,
  DbTemplate,
} from '../../services/issue-templates.service';

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
    if (!scope) {
      res.json({ success: true, data: [] });
      return;
    }

    const { tenantId } = req.user!;
    const days = parseInt(req.query.days as string) || 30;
    const since = new Date(Date.now() - days * 86400000);
    const prevSince = new Date(since.getTime() - days * 86400000);
    const baseWhere = { ...scope.where, createdAt: { gte: since } };

    // Module breakdown with counts + MTTR / Effort / Trend / Problem aggregates
    const [
      byModule,
      byType,
      byPriority,
      byStatus,
      topModules,
      mttrByModuleRaw,
      effortByModuleRaw,
      problemsByModule,
      currentByMod,
      prevByMod,
      avgMttrRaw,
    ] = await Promise.all([
      // Per module: total, open, resolved
      prisma.moduleMaster.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
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
        by: ['moduleId'],
        where: { ...baseWhere, moduleId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),

      // MTTR per module (incidents only, resolved subset)
      prisma.$queryRawUnsafe<Array<{ module_id: string; avg_hours: number; p50: number; p90: number }>>(
        `SELECT
           r.module_id,
           ROUND(AVG(EXTRACT(EPOCH FROM (r.resolved_at - r.created_at))/3600)::numeric, 1)::float AS avg_hours,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.resolved_at - r.created_at))/3600)::numeric, 1)::float AS p50,
           ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.resolved_at - r.created_at))/3600)::numeric, 1)::float AS p90
         FROM itsm_records r
         WHERE r.tenant_id = $1
           AND r.record_type = 'INCIDENT'
           AND r.resolved_at IS NOT NULL
           AND r.created_at >= $2
           AND r.module_id IS NOT NULL
         GROUP BY r.module_id`,
        tenantId,
        since,
      ),

      // Effort hours per module (TimeEntry × ITSMRecord)
      prisma.$queryRawUnsafe<Array<{ module_id: string; hours: number }>>(
        `SELECT
           r.module_id,
           SUM(te.hours)::float AS hours
         FROM time_entries te
         JOIN itsm_records r ON r.id = te.record_id
         WHERE r.tenant_id = $1
           AND te.work_date >= $2
           AND te.status IN ('APPROVED', 'PENDING')
           AND r.module_id IS NOT NULL
         GROUP BY r.module_id`,
        tenantId,
        since,
      ),

      // Problem records per module (for permanent-fix coverage)
      (prisma.iTSMRecord.groupBy as any)({
        by: ['moduleId'],
        where: { ...baseWhere, recordType: 'PROBLEM', moduleId: { not: null } },
        _count: { id: true },
      }),

      // Trend: incidents in current N-day window per module
      (prisma.iTSMRecord.groupBy as any)({
        by: ['moduleId'],
        where: { ...baseWhere, recordType: 'INCIDENT', moduleId: { not: null } },
        _count: { id: true },
      }),

      // Trend: incidents in prior N-day window per module
      (prisma.iTSMRecord.groupBy as any)({
        by: ['moduleId'],
        where: {
          ...scope.where,
          createdAt: { gte: prevSince, lt: since },
          recordType: 'INCIDENT',
          moduleId: { not: null },
        },
        _count: { id: true },
      }),

      // Avg MTTR overall (single-row)
      prisma.$queryRawUnsafe<Array<{ avg_hours: number | null }>>(
        `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600)::numeric, 1)::float AS avg_hours
         FROM itsm_records
         WHERE tenant_id = $1
           AND record_type = 'INCIDENT'
           AND resolved_at IS NOT NULL
           AND created_at >= $2`,
        tenantId,
        since,
      ),
    ]);

    // Build per-module aggregate maps
    const mttrByModule = new Map<string, { avg: number; p50: number; p90: number }>();
    for (const m of mttrByModuleRaw) {
      mttrByModule.set(m.module_id, {
        avg: Number(m.avg_hours),
        p50: Number(m.p50),
        p90: Number(m.p90),
      });
    }

    const effortByModule = new Map<string, number>();
    let totalEffortHours = 0;
    for (const e of effortByModuleRaw) {
      const h = Number(e.hours);
      effortByModule.set(e.module_id, h);
      totalEffortHours += h;
    }

    const problemsByMod = new Map<string, number>();
    for (const p of problemsByModule as Array<{ moduleId: string | null; _count: { id: number } }>) {
      if (p.moduleId) problemsByMod.set(p.moduleId, p._count.id);
    }

    const currentByModMap = new Map<string, number>();
    for (const c of currentByMod as Array<{ moduleId: string | null; _count: { id: number } }>) {
      if (c.moduleId) currentByModMap.set(c.moduleId, c._count.id);
    }
    const prevByModMap = new Map<string, number>();
    for (const p of prevByMod as Array<{ moduleId: string | null; _count: { id: number } }>) {
      if (p.moduleId) prevByModMap.set(p.moduleId, p._count.id);
    }

    // Build module breakdown with health signal
    const moduleBreakdown = byModule
      .filter((m: any) => m.records.length > 0)
      .map((m: any) => {
        const records = m.records;
        const total = records.length;
        const open = records.filter((r: any) => !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(r.status)).length;
        const resolved = records.filter((r: any) => ['RESOLVED', 'CLOSED'].includes(r.status)).length;
        const p1p2 = records.filter(
          (r: any) => ['P1', 'P2'].includes(r.priority) && !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(r.status),
        ).length;
        const incidents = records.filter((r: any) => r.recordType === 'INCIDENT').length;

        // Health signal: red = p1p2 > 2 or open > total*0.7, amber = open > total*0.4, green = otherwise
        const health =
          p1p2 > 2 || open > total * 0.7 ? 'critical' : open > total * 0.4 || p1p2 > 0 ? 'warning' : 'healthy';

        // Sub-module breakdown
        const subBreakdown = m.subModules
          .map((sm: any) => {
            const smRecords = records.filter((r: any) => r.subModuleId === sm.id);
            return { id: sm.id, code: sm.code, name: sm.name, count: smRecords.length };
          })
          .filter((sm: any) => sm.count > 0);

        // Per-module aggregates from new queries
        const mttr = mttrByModule.get(m.id);
        const effortHours = effortByModule.get(m.id) ?? 0;
        const effortPercentOfTotal =
          totalEffortHours > 0 ? Math.round((effortHours / totalEffortHours) * 100) : 0;

        const trendCurrent = currentByModMap.get(m.id) ?? 0;
        const trendPrevious = prevByModMap.get(m.id) ?? 0;
        const trendDelta = trendCurrent - trendPrevious;
        let deltaPercent: number | null;
        let direction: 'up' | 'down' | 'flat' | 'new';
        if (trendPrevious === 0) {
          if (trendCurrent === 0) {
            direction = 'flat';
            deltaPercent = 0;
          } else {
            direction = 'new';
            deltaPercent = null;
          }
        } else {
          deltaPercent = Math.round((trendDelta / trendPrevious) * 100);
          const flatThreshold = Math.max(2, 0.05 * trendPrevious);
          if (Math.abs(trendDelta) <= flatThreshold) direction = 'flat';
          else if (trendDelta > 0) direction = 'up';
          else direction = 'down';
        }

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
          mttrHours: mttr?.avg ?? null,
          mttrP50: mttr?.p50 ?? null,
          mttrP90: mttr?.p90 ?? null,
          effortHours: Math.round(effortHours * 10) / 10,
          effortPercentOfTotal,
          trend: {
            current: trendCurrent,
            previous: trendPrevious,
            delta: trendDelta,
            deltaPercent,
            direction,
          },
        };
      })
      .sort((a: any, b: any) => b.total - a.total);

    // Totals
    const totalRecords = await prisma.iTSMRecord.count({ where: baseWhere });
    const totalOpen = await prisma.iTSMRecord.count({
      where: { ...baseWhere, status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } },
    });

    // Permanent-fix coverage: % of incident-bearing modules that also have a Problem record
    const modulesWithIncidents = byModule.filter((m: any) =>
      m.records.some((r: any) => r.recordType === 'INCIDENT'),
    );
    const modulesWithProblem = modulesWithIncidents.filter((m: any) => problemsByMod.has(m.id));
    const permanentFixCoverage =
      modulesWithIncidents.length > 0
        ? Math.round((modulesWithProblem.length / modulesWithIncidents.length) * 100)
        : null;

    const avgMttrHours = avgMttrRaw[0]?.avg_hours != null ? Number(avgMttrRaw[0].avg_hours) : null;

    res.json({
      success: true,
      period: { days, since, prevSince },
      summary: {
        total: totalRecords,
        open: totalOpen,
        resolved: totalRecords - totalOpen,
        totalEffortHours: Math.round(totalEffortHours * 10) / 10,
        avgMttrHours,
        permanentFixCoverage,
      },
      moduleBreakdown,
      byType: byType.map((t: any) => ({ type: t.recordType, count: t._count.id })),
      byPriority: byPriority.map((p: any) => ({ priority: p.priority, count: p._count.id })),
      byStatus: byStatus.map((s: any) => ({ status: s.status, count: s._count.id })),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /analytics/patterns ────────────────────────────────────────────────────
// Pattern detection v1: Pass 1 (template matching) + Pass 2 (Jaccard clustering
// on unclassified). Templates loaded from DB (IssueTemplate table, tenant-scoped).
router.get('/patterns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildAnalyticsScope(req);
    if (!scope) {
      res.json({
        success: true,
        patterns: [],
        totalPatterns: 0,
        highSeverity: 0,
        unclassifiedCount: 0,
        classificationRate: 0,
      });
      return;
    }

    const { tenantId } = req.user!;
    const days = parseInt(req.query.days as string) || 30;
    const threshold = parseInt(req.query.threshold as string) || 3;
    const pass2Threshold = parseFloat(req.query.pass2Threshold as string) || 0.5;
    const since = new Date(Date.now() - days * 86400000);
    const baseWhere = { ...scope.where, createdAt: { gte: since }, recordType: 'INCIDENT' as any };

    // Load tickets, templates, and SAP module masters in parallel
    const [records, templateRows, moduleMasters, subModuleMasters] = await Promise.all([
      prisma.iTSMRecord.findMany({
        where: baseWhere,
        select: {
          id: true,
          recordNumber: true,
          title: true,
          priority: true,
          status: true,
          createdAt: true,
          module: { select: { code: true, name: true } },
          subModule: { select: { code: true, name: true } },
        },
      }),
      prisma.issueTemplate.findMany({
        where: { tenantId, isActive: true },
      }),
      prisma.moduleMaster.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, code: true, name: true },
      }),
      prisma.subModuleMaster.findMany({
        where: { tenantId },
        select: { id: true, code: true, name: true },
      }),
    ]);

    // Build code → master maps (for legacy moduleCode/moduleName/moduleId fields)
    const moduleByCode = new Map(moduleMasters.map((m) => [m.code, m]));
    const subModuleByCode = new Map(subModuleMasters.map((sm) => [sm.code, sm]));

    const tickets: MatchableTicket[] = records.map((r) => ({
      id: r.id,
      recordNumber: r.recordNumber,
      title: r.title,
      priority: r.priority,
      status: r.status,
      createdAt: r.createdAt,
      module: r.module?.code ?? null,
      subModule: r.subModule?.code ?? null,
    }));
    const templates: DbTemplate[] = templateRows.map(toDbTemplate);

    // Pass 1: template matching
    const { byTemplate, unclassified } = classifyTickets(tickets, templates);

    // Pass 2: Jaccard clustering on what didn't match a template
    const clusters = clusterUnclassified(unclassified, pass2Threshold, threshold);

    // Build template-pattern objects (only those at or above threshold)
    const templatePatterns = await Promise.all(
      Array.from(byTemplate.entries())
        .filter(([, tks]) => tks.length >= threshold)
        .map(async ([tplId, tks]) => {
          const tpl = templateRows.find((t) => t.id === tplId)!;
          const problemCount = await prisma.iTSMRecord.count({
            where: {
              ...scope.where,
              recordType: 'PROBLEM' as any,
              module: { is: { code: tpl.module } },
              createdAt: { gte: since },
            },
          });
          const modMaster = moduleByCode.get(tpl.module);
          const subModMaster = tpl.subModule ? subModuleByCode.get(tpl.subModule) : null;
          return {
            kind: 'template' as const,
            templateId: tpl.id,
            templateKey: tpl.templateKey,
            label: tpl.label,
            module: tpl.module,
            subModule: tpl.subModule,
            // Legacy compat fields (so existing frontend renders unchanged)
            moduleId: modMaster?.id ?? null,
            moduleCode: tpl.module,
            moduleName: modMaster?.name ?? tpl.module,
            subModuleCode: tpl.subModule ?? null,
            subModuleName: subModMaster?.name ?? null,
            count: tks.length,
            severity: severityFor(tks.length),
            hasProblemRecord: problemCount > 0,
            samples: tks.slice(0, 3).map((t) => ({
              id: t.id,
              recordNumber: t.recordNumber,
              title: t.title,
              priority: t.priority,
              status: t.status,
              createdAt: t.createdAt,
            })),
          };
        }),
    );

    // Build emergent-pattern objects (already gated by minSize=threshold inside the clusterer)
    const emergentPatterns = await Promise.all(
      clusters.map(async (c) => {
        const problemCount = await prisma.iTSMRecord.count({
          where: {
            ...scope.where,
            recordType: 'PROBLEM' as any,
            module: { is: { code: c.module } },
            createdAt: { gte: since },
          },
        });
        const modMaster = moduleByCode.get(c.module);
        return {
          kind: 'emergent' as const,
          label: c.tokens.length > 0 ? `Emergent: ${c.tokens.join(' + ')}` : `Emergent: ${c.module} cluster`,
          module: c.module,
          subModule: null as string | null,
          // Legacy compat fields
          moduleId: modMaster?.id ?? null,
          moduleCode: c.module,
          moduleName: modMaster?.name ?? c.module,
          subModuleCode: null as string | null,
          subModuleName: null as string | null,
          count: c.tickets.length,
          severity: severityFor(c.tickets.length),
          hasProblemRecord: problemCount > 0,
          tokens: c.tokens,
          samples: c.tickets.slice(0, 3).map((t) => ({
            id: t.id,
            recordNumber: t.recordNumber,
            title: t.title,
            priority: t.priority,
            status: t.status,
            createdAt: t.createdAt,
          })),
        };
      }),
    );

    const patterns = [...templatePatterns, ...emergentPatterns].sort((a, b) => b.count - a.count);

    const classified = Array.from(byTemplate.values()).reduce((s, v) => s + v.length, 0);
    const emergentTotal = clusters.reduce((s, c) => s + c.tickets.length, 0);
    const classificationRate =
      tickets.length > 0 ? Math.round(((classified + emergentTotal) / tickets.length) * 100) / 100 : 0;

    res.json({
      success: true,
      period: { days, threshold, pass2Threshold },
      patterns,
      totalPatterns: patterns.length,
      highSeverity: patterns.filter((p) => p.severity === 'high').length,
      unclassifiedCount: tickets.length - classified - emergentTotal,
      classificationRate,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /analytics/bottlenecks ──────────────────────────────────────────────────
// Action-oriented "where work is stalling" view.
//
// At-Risk threshold: ticket is past 50% of its priority's SLA resolution budget
// (read at runtime from the contract's SLAPolicyMaster.priorities). Tickets with
// no policy entry or an explicitly-disabled policy are excluded from at-risk math.
//
// Breached: SLATracking.breachResponse OR breachResolution = true. We count only
// currently-open breaches (status NEW/OPEN/IN_PROGRESS/PENDING) — historical
// breaches on resolved tickets aren't bottlenecks anymore.
router.get('/bottlenecks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildAnalyticsScope(req);
    if (!scope) {
      res.json({
        success: true,
        agents: [],
        topAtRiskAgents: [],
        topBreachedAgents: [],
        modulesByMTTR: [],
        closureRate: { windowDays: 7, perModule: [], totals: { opened: 0, resolved: 0, backlogDelta: 0 } },
        unassignedAging: { totalCount: 0, perModule: [] },
      });
      return;
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const OPEN_STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING'];

    // Single fetch: all in-scope records with everything we need for the 5 KPIs
    const records = await prisma.iTSMRecord.findMany({
      where: scope.where,
      include: {
        slaTracking: {
          select: { breachResponse: true, breachResolution: true, responseDeadline: true, resolutionDeadline: true },
        },
        assignedAgent: {
          select: { id: true, user: { select: { firstName: true, lastName: true } } },
        },
        module: { select: { id: true, code: true, name: true } },
        contract: { select: { slaPolicyMaster: { select: { priorities: true } } } },
      },
    });

    type Rec = (typeof records)[number];

    // Compute per-ticket stale + breach state
    const ageHours = (r: Rec) => (now.getTime() - r.createdAt.getTime()) / 3600000;

    const isAtRisk = (r: Rec): boolean => {
      if (!OPEN_STATUSES.includes(r.status)) return false;
      const priorities = (r.contract?.slaPolicyMaster?.priorities || {}) as Record<
        string,
        { resolution?: number; enabled?: boolean }
      >;
      const policy = priorities[r.priority];
      if (!policy || policy.enabled === false || !policy.resolution) return false;
      const atRiskAfterMs = r.createdAt.getTime() + policy.resolution * 60000 * 0.5;
      return now.getTime() > atRiskAfterMs;
    };

    const isBreached = (r: Rec): boolean => {
      if (!OPEN_STATUSES.includes(r.status)) return false;
      const sla = r.slaTracking;
      return !!sla && (sla.breachResponse || sla.breachResolution);
    };

    // ── Agents Table ────────────────────────────────────────────────────────
    const agentsMap = new Map<
      string,
      {
        agentId: string;
        agentName: string;
        openCount: number;
        atRiskCount: number;
        breachedCount: number;
        oldestAtRiskHours: number;
        atRiskTickets: Array<{ id: string; recordNumber: string; priority: string; ageHours: number }>;
        breachedTickets: Array<{ id: string; recordNumber: string; priority: string; ageHours: number }>;
      }
    >();
    for (const r of records) {
      if (!r.assignedAgent || !OPEN_STATUSES.includes(r.status)) continue;
      const aid = r.assignedAgent.id;
      const name = `${r.assignedAgent.user.firstName} ${r.assignedAgent.user.lastName}`;
      if (!agentsMap.has(aid)) {
        agentsMap.set(aid, {
          agentId: aid,
          agentName: name,
          openCount: 0,
          atRiskCount: 0,
          breachedCount: 0,
          oldestAtRiskHours: 0,
          atRiskTickets: [],
          breachedTickets: [],
        });
      }
      const a = agentsMap.get(aid)!;
      a.openCount++;
      const age = ageHours(r);
      if (isAtRisk(r)) {
        a.atRiskCount++;
        a.oldestAtRiskHours = Math.max(a.oldestAtRiskHours, age);
        a.atRiskTickets.push({ id: r.id, recordNumber: r.recordNumber, priority: r.priority, ageHours: age });
      }
      if (isBreached(r)) {
        a.breachedCount++;
        a.breachedTickets.push({ id: r.id, recordNumber: r.recordNumber, priority: r.priority, ageHours: age });
      }
    }
    const agents = Array.from(agentsMap.values())
      .map((a) => ({
        agentId: a.agentId,
        agentName: a.agentName,
        openCount: a.openCount,
        atRiskCount: a.atRiskCount,
        breachedCount: a.breachedCount,
        oldestAtRiskHours: Math.round(a.oldestAtRiskHours * 10) / 10,
      }))
      // Default sort: most-problem agents first (atRisk + breached desc, then openCount)
      .sort((x, y) => y.atRiskCount + y.breachedCount - (x.atRiskCount + x.breachedCount) || y.openCount - x.openCount);

    // ── Top agents by at-risk and by breach (for tile 1 + 2 drilldowns) ─────
    const topAtRiskAgents = Array.from(agentsMap.values())
      .filter((a) => a.atRiskCount > 0)
      .sort((x, y) => y.atRiskCount - x.atRiskCount)
      .slice(0, 10)
      .map((a) => {
        const top = a.atRiskTickets.sort((p, q) => q.ageHours - p.ageHours)[0];
        return {
          agentId: a.agentId,
          agentName: a.agentName,
          count: a.atRiskCount,
          topTicket: top ? { id: top.id, recordNumber: top.recordNumber, priority: top.priority } : null,
        };
      });

    const topBreachedAgents = Array.from(agentsMap.values())
      .filter((a) => a.breachedCount > 0)
      .sort((x, y) => y.breachedCount - x.breachedCount)
      .slice(0, 10)
      .map((a) => {
        const top = a.breachedTickets.sort((p, q) => q.ageHours - p.ageHours)[0];
        return {
          agentId: a.agentId,
          agentName: a.agentName,
          count: a.breachedCount,
          topTicket: top ? { id: top.id, recordNumber: top.recordNumber, priority: top.priority } : null,
        };
      });

    // ── Modules by MTTR (use only resolved tickets) ─────────────────────────
    const moduleHours = new Map<
      string,
      { moduleId: string; moduleCode: string; moduleName: string; hours: number[] }
    >();
    for (const r of records) {
      if (!r.module || !r.resolvedAt) continue;
      const hours = (r.resolvedAt.getTime() - r.createdAt.getTime()) / 3600000;
      if (!moduleHours.has(r.module.id)) {
        moduleHours.set(r.module.id, {
          moduleId: r.module.id,
          moduleCode: r.module.code,
          moduleName: r.module.name,
          hours: [],
        });
      }
      moduleHours.get(r.module.id)!.hours.push(hours);
    }
    const percentile = (sorted: number[], p: number) => {
      if (sorted.length === 0) return 0;
      const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
      return sorted[idx];
    };
    const modulesByMTTR = Array.from(moduleHours.values())
      .map((m) => {
        const sorted = [...m.hours].sort((a, b) => a - b);
        const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
        return {
          moduleId: m.moduleId,
          moduleCode: m.moduleCode,
          moduleName: m.moduleName,
          avgMttrHours: Math.round(avg * 10) / 10,
          p50: Math.round(percentile(sorted, 0.5) * 10) / 10,
          p90: Math.round(percentile(sorted, 0.9) * 10) / 10,
          sampleSize: sorted.length,
        };
      })
      .sort((a, b) => b.avgMttrHours - a.avgMttrHours);

    // ── Closure rate (last 7 days) per module + totals ──────────────────────
    const closureMap = new Map<string, { moduleCode: string; opened: number; resolved: number }>();
    let totalOpened = 0;
    let totalResolved = 0;
    for (const r of records) {
      const code = r.module?.code || '?';
      if (!closureMap.has(code)) closureMap.set(code, { moduleCode: code, opened: 0, resolved: 0 });
      const entry = closureMap.get(code)!;
      if (r.createdAt >= sevenDaysAgo) {
        entry.opened++;
        totalOpened++;
      }
      if (r.resolvedAt && r.resolvedAt >= sevenDaysAgo) {
        entry.resolved++;
        totalResolved++;
      }
    }
    const closurePerModule = Array.from(closureMap.values())
      .filter((m) => m.opened > 0 || m.resolved > 0)
      .map((m) => ({ ...m, backlogDelta: m.opened - m.resolved }))
      .sort((a, b) => b.backlogDelta - a.backlogDelta);

    // ── Unassigned aging ────────────────────────────────────────────────────
    const unassignedMap = new Map<
      string,
      { moduleCode: string; count: number; oldestHours: number; oldestTicket: any }
    >();
    let unassignedTotal = 0;
    for (const r of records) {
      if (r.assignedAgentId || !OPEN_STATUSES.includes(r.status)) continue;
      unassignedTotal++;
      const code = r.module?.code || '?';
      const age = ageHours(r);
      if (!unassignedMap.has(code)) {
        unassignedMap.set(code, {
          moduleCode: code,
          count: 0,
          oldestHours: 0,
          oldestTicket: null,
        });
      }
      const entry = unassignedMap.get(code)!;
      entry.count++;
      if (age > entry.oldestHours) {
        entry.oldestHours = age;
        entry.oldestTicket = {
          id: r.id,
          recordNumber: r.recordNumber,
          priority: r.priority,
          createdAt: r.createdAt,
        };
      }
    }
    const unassignedPerModule = Array.from(unassignedMap.values())
      .map((m) => ({ ...m, oldestHours: Math.round(m.oldestHours * 10) / 10 }))
      .sort((a, b) => b.oldestHours - a.oldestHours);

    res.json({
      success: true,
      agents,
      topAtRiskAgents,
      topBreachedAgents,
      modulesByMTTR,
      closureRate: {
        windowDays: 7,
        perModule: closurePerModule,
        totals: { opened: totalOpened, resolved: totalResolved, backlogDelta: totalOpened - totalResolved },
      },
      unassignedAging: { totalCount: unassignedTotal, perModule: unassignedPerModule },
      generatedAt: now,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /analytics/knowledge-gaps ─────────────────────────────────────────────
// Module+priority combos with recurring incidents and no Problem record
router.get('/knowledge-gaps', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildAnalyticsScope(req);
    if (!scope) {
      res.json({ success: true, gaps: [] });
      return;
    }

    const { tenantId } = req.user!;
    const days = parseInt(req.query.days as string) || 60;
    const since = new Date(Date.now() - days * 86400000);
    const baseWhere = { ...scope.where, createdAt: { gte: since }, recordType: 'INCIDENT' as any };

    // Find module+priority combos with 3+ incidents and NO linked Problem
    const incidentGroups = await (prisma.iTSMRecord.groupBy as any)({
      by: ['moduleId', 'priority'],
      where: { ...baseWhere, moduleId: { not: null } },
      _count: { id: true },
      having: { id: { _count: { gte: 3 } } },
      orderBy: { _count: { id: 'desc' } },
    });

    const gaps = await Promise.all(
      incidentGroups.map(async (g: any) => {
        const [mod, problemCount, avgResolution, unresolved] = await Promise.all([
          prisma.moduleMaster.findUnique({
            where: { id: g.moduleId },
            select: { code: true, name: true },
          }),
          // Check for Problem records
          prisma.iTSMRecord.count({
            where: {
              ...scope.where,
              recordType: 'PROBLEM',
              moduleId: g.moduleId,
              createdAt: { gte: since },
            },
          }),
          // Avg resolution time for resolved in this combo
          prisma.$queryRawUnsafe(
            `
            SELECT ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600)::numeric, 1) as avg_hours
            FROM itsm_records
            WHERE tenant_id = $1 AND module_id = $2 AND priority = $3
              AND record_type = 'INCIDENT' AND resolved_at IS NOT NULL AND created_at >= $4
          `,
            tenantId,
            g.moduleId,
            g.priority,
            since,
          ),
          // How many still unresolved
          prisma.iTSMRecord.count({
            where: {
              ...baseWhere,
              moduleId: g.moduleId,
              priority: g.priority,
              status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] },
            },
          }),
        ]);

        const avgHours = (avgResolution as any)?.[0]?.avg_hours || null;
        const gapScore = (g._count.id * (unresolved + 1)) / (problemCount + 1);

        return {
          moduleId: g.moduleId,
          moduleCode: mod?.code || 'UNKNOWN',
          moduleName: mod?.name || 'Unknown',
          priority: g.priority,
          incidentCount: g._count.id,
          unresolvedCount: unresolved,
          hasProblemRecord: problemCount > 0,
          avgResolutionHours: avgHours ? Number(avgHours) : null,
          gapScore: Math.round(gapScore * 10) / 10,
          recommendation:
            problemCount === 0 && g._count.id >= 5
              ? 'Create Problem record — recurring pattern with no root-cause investigation'
              : problemCount === 0
                ? 'Consider KB article — no documented resolution path'
                : 'Problem record exists — check if linked',
        };
      }),
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
  } catch (err) {
    next(err);
  }
});

// ── GET /analytics/similar/:recordId ──────────────────────────────────────────
// Top 5 similar resolved tickets for a given record
router.get('/similar/:recordId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildAnalyticsScope(req);
    if (!scope) {
      res.json({ success: true, similar: [] });
      return;
    }

    const { recordId } = req.params;
    const { tenantId } = req.user!;

    // Load the source ticket
    const source = await prisma.iTSMRecord.findFirst({
      where: { id: recordId, tenantId },
      select: {
        id: true,
        title: true,
        moduleId: true,
        subModuleId: true,
        recordType: true,
        priority: true,
        tags: true,
      },
    });

    if (!source) {
      res.status(404).json({ success: false, error: 'Record not found' });
      return;
    }

    // Find similar: same module + sub-module, resolved, exclude self
    // Score: exact sub-module match = +3, same module = +2, same priority = +1, same type = +1
    const candidates = await prisma.iTSMRecord.findMany({
      where: {
        ...scope.where,
        id: { not: recordId },
        status: { in: ['RESOLVED', 'CLOSED'] },
        moduleId: source.moduleId || undefined,
        resolvedAt: { not: null },
      },
      select: {
        id: true,
        recordNumber: true,
        title: true,
        priority: true,
        status: true,
        recordType: true,
        moduleId: true,
        subModuleId: true,
        createdAt: true,
        resolvedAt: true,
        tags: true,
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
      if (c.moduleId === source.moduleId) score += 2;
      if (c.subModuleId && c.subModuleId === source.subModuleId) score += 3;
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
  } catch (err) {
    next(err);
  }
});

export default router;
