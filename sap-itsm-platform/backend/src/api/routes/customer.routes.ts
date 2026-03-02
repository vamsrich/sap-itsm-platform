import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { paginate, buildPaginatedResult } from '../../utils/pagination';
import { auditLog, auditFromRequest } from '../../utils/audit';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page  = Number(req.query.page)  || 1;
    const limit = Number(req.query.limit) || 20;
    const { skip, take } = paginate(page, limit);
    const tenantId = req.user!.tenantId;

    const where: any = {
      tenantId,
      ...(req.query.status && { status: req.query.status }),
      ...(req.query.search && {
        OR: [
          { companyName: { contains: req.query.search as string, mode: 'insensitive' } },
          { country:     { contains: req.query.search as string, mode: 'insensitive' } },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where, skip, take,
        include: {
          _count:         { select: { contracts: true, records: true } },
          adminUser:      { select: { id: true, firstName: true, lastName: true, email: true } },
          projectManager: { select: { id: true, user: { select: { id: true, firstName: true, lastName: true } } } },
          customerAgents: { include: { agent: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } } },
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
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      include: {
        contracts:      true,
        adminUser:      { select: { id: true, firstName: true, lastName: true, email: true } },
        projectManager: { select: { id: true, specialization: true, user: { select: { id: true, firstName: true, lastName: true } } } },
        customerAgents: { include: { agent: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } } } },
        users:          { select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true } },
        _count:         { select: { records: true } },
      },
    });
    if (!customer) { res.status(404).json({ success: false, error: 'Customer not found' }); return; }
    res.json({ success: true, customer });
  } catch (err) { next(err); }
});

router.post('/', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      companyName, industry, country, timezone, status,
      website, contactName, contactEmail, contactPhone,
      billingEmail, billingAddress, notes,
      adminUserId, projectManagerAgentId, holidayCalendarId,
      agentIds,
    } = req.body;

    const customer = await prisma.customer.create({
      data: {
        tenantId:              req.user!.tenantId,
        companyName, industry, country,
        timezone:              timezone || 'UTC',
        status:                status   || 'ACTIVE',
        website, contactName, contactEmail, contactPhone,
        billingEmail, billingAddress, notes,
        adminUserId:           adminUserId           || undefined,
        projectManagerAgentId: projectManagerAgentId || undefined,
        holidayCalendarId:     holidayCalendarId     || undefined,
        // Create CustomerAgent join records
        customerAgents: agentIds?.length
          ? { create: agentIds.map((id: string) => ({ agentId: id })) }
          : undefined,
      } as any,
    });

    // Link admin user to this customer (sets user.customerId)
    if (adminUserId) {
      await prisma.user.updateMany({
        where: { id: adminUserId, tenantId: req.user!.tenantId },
        data:  { customerId: customer.id },
      });
    }

    await auditLog({ ...auditFromRequest(req), action: 'CREATE', entityType: 'Customer', entityId: customer.id, newValues: { companyName } });
    res.status(201).json({ success: true, customer });
  } catch (err) { next(err); }
});

router.patch('/:id', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = [
      'companyName', 'industry', 'country', 'timezone', 'status',
      'website', 'contactName', 'contactEmail', 'contactPhone',
      'billingEmail', 'billingAddress', 'notes',
      'adminUserId', 'projectManagerAgentId', 'holidayCalendarId',
    ];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k] || undefined;

    await prisma.customer.updateMany({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      data: data as any,
    });

    // Re-sync agent assignments if provided
    if (req.body.agentIds !== undefined) {
      await prisma.customerAgent.deleteMany({ where: { customerId: req.params.id } });
      if (req.body.agentIds.length > 0) {
        await prisma.customerAgent.createMany({
          data: req.body.agentIds.map((agentId: string) => ({ customerId: req.params.id, agentId })),
          skipDuplicates: true,
        });
      }
    }

    // Re-link admin user if changed
    if (req.body.adminUserId) {
      await prisma.user.updateMany({
        where: { id: req.body.adminUserId, tenantId: req.user!.tenantId },
        data:  { customerId: req.params.id },
      });
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
