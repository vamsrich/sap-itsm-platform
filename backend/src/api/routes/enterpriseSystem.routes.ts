import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyJWT, enforceTenantScope, enforceRole } from '../middleware/auth.middleware';

const prisma = new PrismaClient();
const router = Router();
router.use(verifyJWT, enforceTenantScope);

// GET /enterprise-systems — read-only list of available systems for picking.
// SUPER_ADMIN and COMPANY_ADMIN can read; AGENT/PM/USER don't need this.
router.get(
  '/',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const onlyActive = req.query.activeOnly !== 'false';
      const systems = await prisma.enterpriseSystem.findMany({
        where: onlyActive ? { isActive: true } : undefined,
        select: { id: true, code: true, name: true, isActive: true },
        orderBy: { name: 'asc' },
      });
      res.json({ success: true, data: systems });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
