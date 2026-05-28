import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyJWT, enforceTenantScope, enforceRole } from '../middleware/auth.middleware';
import { DEFAULT_SCORING_WEIGHTS, ScoringWeights } from '../../services/assignment.service';

const prisma = new PrismaClient();
const router = Router();
router.use(verifyJWT, enforceTenantScope);
router.use(enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'));

const VALID_PRIORITIES = ['ALL', 'P1', 'P2', 'P3', 'P4'];

// COMPANY_ADMIN can only access their own customer's configs.
function canAccessCustomer(req: Request, customerId: string): boolean {
  if (req.user!.role === 'SUPER_ADMIN') return true;
  return req.user!.customerId === customerId;
}

function validateWeights(body: any): { ok: true; weights: ScoringWeights } | { ok: false; error: string } {
  const fields = ['moduleWeight', 'subModuleWeight', 'levelWeight', 'workloadWeight', 'availabilityWeight'] as const;
  const weights: any = {};
  for (const f of fields) {
    const v = body[f];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) {
      return { ok: false, error: `${f} must be an integer 0-100` };
    }
    weights[f] = v;
  }
  const sum = fields.reduce((s, f) => s + weights[f], 0);
  if (sum !== 100) return { ok: false, error: `Weights must sum to 100 (got ${sum})` };
  return { ok: true, weights };
}

// GET /scoring-configs?customerId=... — list configs for a customer
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = req.query.customerId as string | undefined;
    if (!customerId) {
      res.status(400).json({ success: false, error: 'customerId query parameter is required' });
      return;
    }
    if (!canAccessCustomer(req, customerId)) {
      res.status(403).json({ success: false, error: 'You can only view your own customer configs' });
      return;
    }
    const configs = await prisma.assignmentScoringConfig.findMany({
      where: { customerId, tenantId: req.user!.tenantId },
      orderBy: { priority: 'asc' },
    });
    res.json({ success: true, configs, defaults: DEFAULT_SCORING_WEIGHTS });
  } catch (err) {
    next(err);
  }
});

// POST /scoring-configs — create a per-priority override
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerId, priority } = req.body;
    if (!customerId || !priority) {
      res.status(400).json({ success: false, error: 'customerId and priority are required' });
      return;
    }
    if (!VALID_PRIORITIES.includes(priority)) {
      res.status(400).json({ success: false, error: `priority must be one of ${VALID_PRIORITIES.join(', ')}` });
      return;
    }
    if (priority === 'ALL') {
      res.status(400).json({
        success: false,
        error: 'The ALL row is auto-created with the customer. Use PATCH to edit it.',
      });
      return;
    }
    if (!canAccessCustomer(req, customerId)) {
      res.status(403).json({ success: false, error: 'You can only create configs for your own customer' });
      return;
    }
    const v = validateWeights(req.body);
    if ('error' in v) {
      res.status(400).json({ success: false, error: v.error });
      return;
    }
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId: req.user!.tenantId },
      select: { id: true },
    });
    if (!customer) {
      res.status(404).json({ success: false, error: 'Customer not found' });
      return;
    }
    const config = await prisma.assignmentScoringConfig.create({
      data: {
        tenantId: req.user!.tenantId,
        customerId,
        priority,
        ...v.weights,
      },
    });
    res.status(201).json({ success: true, config });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(409).json({ success: false, error: 'Override for this priority already exists' });
      return;
    }
    next(err);
  }
});

// PATCH /scoring-configs/:id — update weights on an existing config (ALL or per-priority)
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.assignmentScoringConfig.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Config not found' });
      return;
    }
    if (!canAccessCustomer(req, existing.customerId)) {
      res.status(403).json({ success: false, error: 'You can only update configs for your own customer' });
      return;
    }
    const v = validateWeights(req.body);
    if ('error' in v) {
      res.status(400).json({ success: false, error: v.error });
      return;
    }
    const config = await prisma.assignmentScoringConfig.update({
      where: { id: req.params.id },
      data: v.weights,
    });
    res.json({ success: true, config });
  } catch (err) {
    next(err);
  }
});

// DELETE /scoring-configs/:id — delete a per-priority override
// (the ALL row cannot be deleted; reset it via PATCH instead)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.assignmentScoringConfig.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Config not found' });
      return;
    }
    if (!canAccessCustomer(req, existing.customerId)) {
      res.status(403).json({ success: false, error: 'You can only delete configs for your own customer' });
      return;
    }
    if (existing.priority === 'ALL') {
      res.status(400).json({
        success: false,
        error: 'The ALL (default) row cannot be deleted. Reset it via PATCH instead.',
      });
      return;
    }
    await prisma.assignmentScoringConfig.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
