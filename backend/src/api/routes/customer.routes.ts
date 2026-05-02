import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { paginate, buildPaginatedResult } from '../../utils/pagination';
import { auditLog, auditFromRequest } from '../../utils/audit';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1,
      limit = Number(req.query.limit) || 20;
    const { skip, take } = paginate(page, limit);
    const tenantId = req.user!.tenantId,
      role = req.user!.role,
      userId = req.user!.sub;
    const customerId = req.user!.customerId;

    let scopeFilter: any = {};
    if (role === 'COMPANY_ADMIN') {
      if (!customerId) {
        res.json({ success: true, ...buildPaginatedResult([], 0, page, limit) });
        return;
      }
      scopeFilter = { id: customerId };
    } else if (role === 'PROJECT_MANAGER') {
      const agent = await resolveAgent(userId);
      if (!agent) {
        res.json({ success: true, ...buildPaginatedResult([], 0, page, limit) });
        return;
      }
      const ids = await resolveManagedCustomerIds(agent.id, tenantId);
      if (ids.length === 0) {
        res.json({ success: true, ...buildPaginatedResult([], 0, page, limit) });
        return;
      }
      scopeFilter = { id: { in: ids } };
    }

    const where: any = {
      tenantId,
      ...scopeFilter,
      ...(req.query.status && { status: req.query.status }),
      ...(req.query.search && {
        OR: [
          { companyName: { contains: req.query.search as string, mode: 'insensitive' } },
          { country: { contains: req.query.search as string, mode: 'insensitive' } },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take,
        include: {
          _count: { select: { contracts: true, records: true } },
          adminUser: { select: { id: true, firstName: true, lastName: true, email: true } },
          projectManager: { select: { id: true, user: { select: { id: true, firstName: true, lastName: true } } } },
          customerAgents: {
            include: { agent: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } },
          },
          contracts: {
            select: { id: true, contractNumber: true, endDate: true },
            orderBy: { endDate: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({ success: true, ...buildPaginatedResult(customers, total, page, limit) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role,
      userId = req.user!.sub,
      tenantId = req.user!.tenantId;
    const customerId = req.user!.customerId;

    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        contracts: true,
        systems: { include: { system: { select: { id: true, code: true, name: true } } } },
        adminUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        projectManager: {
          select: { id: true, specialization: true, user: { select: { id: true, firstName: true, lastName: true } } },
        },
        customerAgents: {
          include: {
            agent: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
          },
        },
        users: { select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true } },
        _count: { select: { records: true } },
      },
    });
    if (!customer) {
      res.status(404).json({ success: false, error: 'Customer not found' });
      return;
    }

    if (role === 'COMPANY_ADMIN' && customer.id !== customerId) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }
    if (role === 'PROJECT_MANAGER') {
      const agent = await resolveAgent(userId);
      if (!agent) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      const ids = await resolveManagedCustomerIds(agent.id, tenantId);
      if (!ids.includes(customer.id)) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
    }

    res.json({ success: true, customer });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        companyName,
        industry,
        country,
        timezone,
        status,
        website,
        contactName,
        contactEmail,
        contactPhone,
        billingEmail,
        billingAddress,
        notes,
        allowedDomains,
        adminUserId,
        projectManagerAgentId,
        holidayCalendarId,
        agentIds,
      } = req.body;
      // A-2c: systemIds[] — at least one EnterpriseSystem must be linked.
      // Default to SAP for legacy callers that don't supply it (matches existing demo flow).
      // Only SUPER_ADMIN + PROJECT_MANAGER can specify systemIds; for others
      // (e.g. a COMPANY_ADMIN onboarding their own org) the SAP default applies.
      const role = req.user!.role;
      const canManageSystems = role === 'SUPER_ADMIN' || role === 'PROJECT_MANAGER';
      const rawSystemIds: string[] = canManageSystems && Array.isArray(req.body.systemIds) ? req.body.systemIds : [];
      let systemIdsToLink = rawSystemIds;
      if (systemIdsToLink.length === 0) {
        const sap = await prisma.enterpriseSystem.findUnique({ where: { code: 'sap' }, select: { id: true } });
        if (!sap) {
          res.status(500).json({ success: false, error: 'No SAP EnterpriseSystem present — run multi-system migration' });
          return;
        }
        systemIdsToLink = [sap.id];
      }
      // Validate every systemId exists + active
      const validSystems = await prisma.enterpriseSystem.findMany({
        where: { id: { in: systemIdsToLink }, isActive: true },
        select: { id: true },
      });
      if (validSystems.length !== systemIdsToLink.length) {
        res.status(400).json({ success: false, error: 'One or more systemIds are invalid or inactive' });
        return;
      }

      const customer = await prisma.customer.create({
        data: {
          tenantId: req.user!.tenantId,
          companyName,
          industry,
          country,
          timezone: timezone || 'UTC',
          status: status || 'ACTIVE',
          website,
          contactName,
          contactEmail,
          contactPhone,
          billingEmail,
          billingAddress,
          notes,
          allowedDomains: allowedDomains || [],
          adminUserId: adminUserId || undefined,
          projectManagerAgentId: projectManagerAgentId || undefined,
          holidayCalendarId: holidayCalendarId || undefined,
          customerAgents: agentIds?.length ? { create: agentIds.map((id: string) => ({ agentId: id })) } : undefined,
          systems: { create: systemIdsToLink.map((id) => ({ systemId: id })) },
        } as any,
      });
      if (adminUserId) {
        await prisma.user.updateMany({
          where: { id: adminUserId, tenantId: req.user!.tenantId },
          data: { customerId: customer.id },
        });
      }
      await auditLog({
        ...auditFromRequest(req),
        action: 'CREATE',
        entityType: 'Customer',
        entityId: customer.id,
        newValues: { companyName },
      });
      res.status(201).json({ success: true, customer });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/:id',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const role = req.user!.role;
      // COMPANY_ADMIN can only edit their own customer record
      if (role === 'COMPANY_ADMIN' && req.params.id !== req.user!.customerId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      // PROJECT_MANAGER can only edit customers they manage
      if (role === 'PROJECT_MANAGER') {
        const agent = await resolveAgent(req.user!.sub);
        if (!agent) {
          res.status(403).json({ success: false, error: 'Access denied' });
          return;
        }
        const ids = await resolveManagedCustomerIds(agent.id, req.user!.tenantId);
        if (!ids.includes(req.params.id)) {
          res.status(403).json({ success: false, error: 'Access denied' });
          return;
        }
      }
      // Only SUPER_ADMIN + PROJECT_MANAGER can change systemIds; silently
      // strip from any other role's payload so they can still edit their
      // customer's contact/billing details without errors.
      const canManageSystems = role === 'SUPER_ADMIN' || role === 'PROJECT_MANAGER';
      if (!canManageSystems && Array.isArray(req.body.systemIds)) {
        delete req.body.systemIds;
      }
      const allowed = [
        'companyName',
        'industry',
        'country',
        'timezone',
        'status',
        'website',
        'contactName',
        'contactEmail',
        'contactPhone',
        'billingEmail',
        'billingAddress',
        'notes',
        'allowedDomains',
        'adminUserId',
        'projectManagerAgentId',
        'holidayCalendarId',
      ];
      const data: Record<string, unknown> = {};
      for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k] || undefined;
      const oldCustomer = await prisma.customer.findFirst({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
        select: { companyName: true, status: true, adminUserId: true, projectManagerAgentId: true },
      });
      await prisma.customer.updateMany({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
        data: data as any,
      });
      await auditLog({
        ...auditFromRequest(req),
        action: 'UPDATE',
        entityType: 'Customer',
        entityId: req.params.id,
        oldValues: oldCustomer,
        newValues: data,
      });

      if (req.body.agentIds !== undefined) {
        await prisma.customerAgent.deleteMany({ where: { customerId: req.params.id } });
        if (req.body.agentIds.length > 0) {
          await prisma.customerAgent.createMany({
            data: req.body.agentIds.map((agentId: string) => ({ customerId: req.params.id, agentId })),
            skipDuplicates: true,
          });
        }
      }

      // A-2c: systemIds[] reconciliation with subset-rule guardrail
      if (Array.isArray(req.body.systemIds)) {
        const incoming: string[] = req.body.systemIds;
        if (incoming.length === 0) {
          res.status(400).json({ success: false, error: 'A customer must have at least one system' });
          return;
        }
        // Validate every incoming systemId exists + active
        const validSystems = await prisma.enterpriseSystem.findMany({
          where: { id: { in: incoming }, isActive: true },
          select: { id: true },
        });
        if (validSystems.length !== incoming.length) {
          res.status(400).json({ success: false, error: 'One or more systemIds are invalid or inactive' });
          return;
        }

        const current = await prisma.customerSystem.findMany({
          where: { customerId: req.params.id },
          select: { systemId: true },
        });
        const currentIds = new Set(current.map((c) => c.systemId));
        const incomingIds = new Set(incoming);
        const toRemove = [...currentIds].filter((id) => !incomingIds.has(id));
        const toAdd = [...incomingIds].filter((id) => !currentIds.has(id));

        // Subset-rule guardrail: cannot remove a system if any contract uses it
        if (toRemove.length > 0) {
          const conflictingContracts = await prisma.contract.findMany({
            where: {
              customerId: req.params.id,
              systemId: { in: toRemove },
              isActive: true,
            },
            select: {
              contractNumber: true,
              system: { select: { name: true } },
            },
            take: 5,
          });
          if (conflictingContracts.length > 0) {
            const c = conflictingContracts[0];
            res.status(400).json({
              success: false,
              error: `Cannot remove system ${c.system?.name ?? ''}: contract ${c.contractNumber} still uses it. Update or archive the contract first.`,
            });
            return;
          }
        }

        if (toRemove.length > 0) {
          await prisma.customerSystem.deleteMany({
            where: { customerId: req.params.id, systemId: { in: toRemove } },
          });
        }
        if (toAdd.length > 0) {
          await prisma.customerSystem.createMany({
            data: toAdd.map((systemId) => ({ customerId: req.params.id, systemId })),
            skipDuplicates: true,
          });
        }
      }

      if (req.body.adminUserId) {
        await prisma.user.updateMany({
          where: { id: req.body.adminUserId, tenantId: req.user!.tenantId },
          data: { customerId: req.params.id },
        });
      }
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// GET /customers/:id/systems — deduplicated EnterpriseSystems the customer
// is signed up for via CustomerSystem. Used by the ticket-create form's
// System dropdown. Tenant + role-scoped via the existing access check on
// the parent customer row.
router.get('/:id/systems', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const role = req.user!.role;
    const customerId = req.params.id;

    // Reuse the same access logic as GET /customers/:id (already in this file)
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) {
      res.status(404).json({ success: false, error: 'Customer not found' });
      return;
    }
    if (role === 'COMPANY_ADMIN' && req.user!.customerId !== customerId) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    const links = await prisma.customerSystem.findMany({
      where: { customerId, isActive: true },
      select: { system: { select: { id: true, code: true, name: true, isActive: true } } },
    });
    const activeSystems = links
      .map((l) => l.system)
      .filter((s): s is NonNullable<typeof s> => !!s && s.isActive);

    // Per-system: does the customer have an active contract covering this system?
    // The form uses this to surface a "no active contract" warning before submit.
    const now = new Date();
    const activeContracts = await prisma.contract.findMany({
      where: {
        customerId,
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      select: { systemId: true },
    });
    const systemsWithContract = new Set(activeContracts.map((c) => c.systemId).filter((id): id is string => !!id));

    const systems = activeSystems.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      hasActiveContract: systemsWithContract.has(s.id),
    }));

    res.json({ success: true, data: systems });
  } catch (err) {
    next(err);
  }
});

export default router;
