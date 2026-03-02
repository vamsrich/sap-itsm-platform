import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { auditLog, auditFromRequest } from '../../utils/audit';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contracts = await prisma.contract.findMany({
      where: { customer: { tenantId: req.user!.tenantId } },
      include: {
        customer:         { select: { id: true, companyName: true } },
        supportTypeMaster: { select: { id: true, name: true, code: true, color: true } },
        slaPolicyMaster:   { select: { id: true, name: true, code: true, color: true } },
        shifts:            { include: { shift: true } },
        holidayCalendars:  { include: { holidayCalendar: { select: { id: true, name: true, country: true, year: true } } } },
        _count:            { select: { records: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, contracts });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contract = await prisma.contract.findFirst({
      where: { id: req.params.id, customer: { tenantId: req.user!.tenantId } },
      include: {
        customer:          { select: { id: true, companyName: true, timezone: true } },
        supportTypeMaster: true,
        slaPolicyMaster:   true,
        shifts:            { include: { shift: true } },
        holidayCalendars:  { include: { holidayCalendar: { include: { dates: true } } } },
      },
    });
    if (!contract) { res.status(404).json({ success: false, error: 'Contract not found' }); return; }
    res.json({ success: true, contract });
  } catch (err) { next(err); }
});

router.post('/', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      customerId, contractNumber, supportTypeMasterId, slaPolicyMasterId,
      startDate, endDate, autoRenewal, renewalNoticeDays,
      billingAmount, currency, billingFrequency, paymentTerms, notes,
      shiftIds, holidayCalendarIds,
    } = req.body;

    if (!customerId || !contractNumber || !startDate || !endDate) {
      res.status(400).json({ success: false, error: 'customerId, contractNumber, startDate, endDate are required' });
      return;
    }

    const contract = await prisma.contract.create({
      data: {
        customerId,
        contractNumber,
        supportTypeMasterId: supportTypeMasterId || undefined,
        slaPolicyMasterId:   slaPolicyMasterId   || undefined,
        startDate:  new Date(startDate),
        endDate:    new Date(endDate),
        autoRenewal:       autoRenewal ?? false,
        renewalNoticeDays: renewalNoticeDays ?? 60,
        billingAmount:     parseFloat(billingAmount) || 0,
        currency:          currency || 'USD',
        billingFrequency:  billingFrequency || 'Monthly',
        paymentTerms:      paymentTerms || 'Net 30',
        notes:             notes || undefined,
        shifts: shiftIds?.length
          ? { create: shiftIds.map((id: string) => ({ shiftId: id })) }
          : undefined,
        holidayCalendars: holidayCalendarIds?.length
          ? { create: holidayCalendarIds.map((id: string) => ({ holidayCalendarId: id })) }
          : undefined,
      },
    });
    await auditLog({ ...auditFromRequest(req), action: 'CREATE', entityType: 'Contract', entityId: contract.id, newValues: { contractNumber } });
    res.status(201).json({ success: true, contract });
  } catch (err) { next(err); }
});

router.patch('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = [
      'supportTypeMasterId', 'slaPolicyMasterId',
      'startDate', 'endDate', 'autoRenewal', 'renewalNoticeDays',
      'billingAmount', 'currency', 'billingFrequency', 'paymentTerms', 'notes',
    ];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k] || undefined;
    const updated = await prisma.contract.updateMany({
      where: { id: req.params.id, customer: { tenantId: req.user!.tenantId } },
      data,
    });
    res.json({ success: true, updated: updated.count });
  } catch (err) { next(err); }
});

export default router;
