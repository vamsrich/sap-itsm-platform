import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  createRecordSchema,
  updateRecordSchema,
  listRecordsSchema,
  addCommentSchema,
  addTimeEntrySchema,
} from '../validators/record.validators';
import {
  createRecord,
  listRecords,
  getRecord,
  updateRecord,
  addComment,
  addTimeEntry,
} from '../../services/record.service';
import { prisma } from '../../config/database';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

// GET /records
router.get('/', validate(listRecordsSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = req.query as any;
    const result = await listRecords({
      tenantId: req.user!.tenantId,
      page: Number(q.page) || 1,
      limit: Number(q.limit) || 20,
      recordType: q.recordType,
      status: q.status,
      priority: q.priority,
      assignedAgentId: q.assignedAgentId,
      customerId: q.customerId,
      search: q.search,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
      from: q.from,
      to: q.to,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /records
router.post(
  '/',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'USER', 'PROJECT_MANAGER'),
  validate(createRecordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await createRecord({
        ...req.body,
        tenantId: req.user!.tenantId,
        createdById: req.user!.sub,
      });
      res.status(201).json({ success: true, record });
    } catch (err) {
      next(err);
    }
  }
);

// GET /records/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await getRecord(req.params.id, req.user!.tenantId);
    res.json({ success: true, record });
  } catch (err) {
    next(err);
  }
});

// PATCH /records/:id
router.patch(
  '/:id',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'PROJECT_MANAGER'),
  validate(updateRecordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await updateRecord(
        req.params.id,
        req.user!.tenantId,
        req.user!.sub,
        req.body
      );
      res.json({ success: true, record });
    } catch (err) {
      next(err);
    }
  }
);

// POST /records/:id/comment
router.post(
  '/:id/comment',
  validate(addCommentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comment = await addComment(
        req.params.id,
        req.user!.tenantId,
        req.user!.sub,
        req.body.text,
        req.body.internalFlag ?? false
      );
      res.status(201).json({ success: true, comment });
    } catch (err) {
      next(err);
    }
  }
);

// POST /records/:id/time-entry
router.post(
  '/:id/time-entry',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'PROJECT_MANAGER'),
  validate(addTimeEntrySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await addTimeEntry(
        req.params.id,
        req.user!.tenantId,
        req.user!.sub,
        req.body.hours,
        req.body.description,
        req.body.workDate
      );
      res.status(201).json({ success: true, entry });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /records/:id/time-entry/:entryId (approve/reject)
router.patch(
  '/:id/time-entry/:entryId',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;
      if (!['APPROVED', 'REJECTED'].includes(status)) {
        res.status(400).json({ success: false, error: 'Invalid status' });
        return;
      }
      const entry = await prisma.timeEntry.updateMany({
        where: { id: req.params.entryId, record: { tenantId: req.user!.tenantId } },
        data: {
          status,
          approvedById: req.user!.sub,
          approvedAt: new Date(),
        },
      });
      res.json({ success: true, updated: entry.count });
    } catch (err) {
      next(err);
    }
  }
);

// GET /records/:id/history (audit trail)
router.get('/:id/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await prisma.auditLog.findMany({
      where: { recordId: req.params.id, tenantId: req.user!.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    res.json({ success: true, history });
  } catch (err) {
    next(err);
  }
});

export default router;
