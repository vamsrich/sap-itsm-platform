/**
 * Admin endpoints for IssueTemplate (read-only in Phase 1).
 *
 * Mounted at /api/v1/admin/issue-templates by app.ts.
 *
 * Endpoints:
 *   GET /              List templates for the tenant (filterable)
 *   GET /:id           Single template
 *   GET /:id/matches   Tickets in scope currently matching this template
 *
 * Auth: SUPER_ADMIN or COMPANY_ADMIN. SUPER_ADMIN sees all tenant data;
 * COMPANY_ADMIN's match scope is restricted to their own customerId.
 *
 * Phase 2 will add POST/PUT/DELETE + preview endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceTenantScope, enforceRole } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { classifyTickets, toDbTemplate, MatchableTicket, DbTemplate } from '../../services/issue-templates.service';

const router = Router();
router.use(verifyJWT, enforceTenantScope);
router.use(enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'));

// ── Scope helper (admin variant) ─────────────────────────────────────────────
function buildAdminScope(req: any): { where: any } {
  const { role, tenantId, customerId } = req.user!;
  if (role === 'COMPANY_ADMIN') {
    return { where: { tenantId, ...(customerId ? { customerId } : {}) } };
  }
  return { where: { tenantId } };
}

// ── GET / ────────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.user!;
    const moduleFilter = (req.query.module as string) || undefined;
    const activeFilter = req.query.isActive === undefined ? true : req.query.isActive === 'true';

    const templates = await prisma.issueTemplate.findMany({
      where: {
        tenantId,
        isActive: activeFilter,
        ...(moduleFilter ? { module: moduleFilter } : {}),
      },
      orderBy: [{ module: 'asc' }, { templateKey: 'asc' }],
    });

    res.json({ success: true, templates, total: templates.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.user!;
    const tpl = await prisma.issueTemplate.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!tpl) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }
    res.json({ success: true, template: tpl });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id/matches ─────────────────────────────────────────────────────────
// Returns tickets currently matching the template within the requested window.
// Useful for SA verification ("show me what this template currently catches").
router.get('/:id/matches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.user!;
    const days = parseInt(req.query.days as string) || 30;
    const since = new Date(Date.now() - days * 86400000);

    const tpl = await prisma.issueTemplate.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!tpl) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    const scope = buildAdminScope(req);
    const records = await prisma.iTSMRecord.findMany({
      where: {
        ...scope.where,
        recordType: 'INCIDENT' as any,
        createdAt: { gte: since },
        sapModule: { is: { code: tpl.module } },
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
      orderBy: { createdAt: 'desc' },
    });

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

    // Run the matcher with ONLY this template, so we get the precise hits.
    const singletonTemplate: DbTemplate[] = [toDbTemplate(tpl)];
    const { byTemplate } = classifyTickets(tickets, singletonTemplate);
    const matches = byTemplate.get(tpl.id) || [];

    res.json({
      success: true,
      templateId: tpl.id,
      templateKey: tpl.templateKey,
      label: tpl.label,
      matchCount: matches.length,
      matches: matches.map((m) => ({
        id: m.id,
        recordNumber: m.recordNumber,
        title: m.title,
        priority: m.priority,
        status: m.status,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
