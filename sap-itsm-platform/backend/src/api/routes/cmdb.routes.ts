import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { paginate, buildPaginatedResult } from '../../utils/pagination';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const { skip, take } = paginate(page, limit);
    const where: any = {
      tenantId: req.user!.tenantId,
      ...(req.query.ciType && { ciType: req.query.ciType }),
      ...(req.query.status && { status: req.query.status }),
      ...(req.query.search && { name: { contains: req.query.search as string, mode: 'insensitive' } }),
    };
    const [items, total] = await Promise.all([
      prisma.configurationItem.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      prisma.configurationItem.count({ where }),
    ]);
    res.json({ success: true, ...buildPaginatedResult(items, total, page, limit) });
  } catch (err) { next(err); }
});

router.post('/', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ci = await prisma.configurationItem.create({
      data: { ...req.body, tenantId: req.user!.tenantId },
    });
    res.status(201).json({ success: true, ci });
  } catch (err) { next(err); }
});

router.patch('/:id', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['name', 'ciType', 'environment', 'sid', 'hostname', 'version', 'status', 'metadata'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    await prisma.configurationItem.updateMany({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      data,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/:id', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.configurationItem.updateMany({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      data: { status: 'DECOMMISSIONED' },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
