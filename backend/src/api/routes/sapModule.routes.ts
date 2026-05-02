import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyJWT, enforceTenantScope, enforceRole } from '../middleware/auth.middleware';

const prisma = new PrismaClient();
const router = Router();
router.use(verifyJWT, enforceTenantScope);

// Resolve the SAP EnterpriseSystem id (used as default for backward compat
// since this route was SAP-only until A-2a). New endpoints can take systemId
// in the body; absent → SAP.
let cachedSapSystemId: string | null = null;
async function getSapSystemId(): Promise<string> {
  if (cachedSapSystemId) return cachedSapSystemId;
  const sys = await prisma.enterpriseSystem.findUnique({ where: { code: 'sap' } });
  if (!sys) throw new Error('SAP EnterpriseSystem row missing — run multi-system migration');
  cachedSapSystemId = sys.id;
  return cachedSapSystemId;
}

// ══════════════════════════════════════════════════════════════
// SAP MODULES
// ══════════════════════════════════════════════════════════════

// GET /sap-modules — list all modules (any authenticated user)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const modules = await prisma.moduleMaster.findMany({
      where: { tenantId: req.user!.tenantId },
      include: { subModules: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: modules });
  } catch (err) {
    next(err);
  }
});

// GET /sap-modules/active?systemId=X — active modules + active submodules.
// systemId is optional; when omitted, returns all systems' modules (legacy
// behaviour). The ticket-create form should always pass systemId so the
// dropdown only shows modules from the currently-selected system.
router.get('/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const systemId = (req.query.systemId as string | undefined) || undefined;
    const modules = await prisma.moduleMaster.findMany({
      where: {
        tenantId: req.user!.tenantId,
        isActive: true,
        ...(systemId && { systemId }),
      },
      include: { subModules: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: modules });
  } catch (err) {
    next(err);
  }
});

// POST /sap-modules — create module (SUPER_ADMIN only)
// PATCH /sap-modules/sub-modules/:id — MUST be before /:id routes
router.patch(
  '/sub-modules/:id',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description, sortOrder, isActive } = req.body;
      const data: any = {};
      if (name !== undefined) data.name = name;
      if (description !== undefined) data.description = description;
      if (sortOrder !== undefined) data.sortOrder = sortOrder;
      if (isActive !== undefined) data.isActive = isActive;

      const sub = await prisma.subModuleMaster.updateMany({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
        data,
      });
      if (sub.count === 0) {
        res.status(404).json({ success: false, error: 'Sub-module not found' });
        return;
      }
      const updated = await prisma.subModuleMaster.findUnique({ where: { id: req.params.id } });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /sap-modules/sub-modules/:id — MUST be before /:id routes
router.delete(
  '/sub-modules/:id',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await prisma.iTSMRecord.count({ where: { subModuleId: req.params.id } });
      if (count > 0) {
        res.status(400).json({
          success: false,
          error: `Cannot delete: ${count} tickets use this sub-module. Deactivate it instead.`,
        });
        return;
      }
      await prisma.subModuleMaster.deleteMany({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post('/', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, name, description, sortOrder } = req.body;
    if (!code || !name) {
      res.status(400).json({ success: false, error: 'Code and name are required' });
      return;
    }
    const systemId = req.body.systemId || (await getSapSystemId());
    const module = await prisma.moduleMaster.create({
      data: {
        tenantId: req.user!.tenantId,
        systemId,
        code: code.toUpperCase(),
        name,
        description: description || null,
        sortOrder: sortOrder || 0,
      },
      include: { subModules: true },
    });
    res.status(201).json({ success: true, data: module });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, error: `Module code "${req.body.code}" already exists` });
      return;
    }
    next(err);
  }
});

// PATCH /sap-modules/:id — update module
router.patch('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, sortOrder, isActive } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (isActive !== undefined) data.isActive = isActive;

    const module = await prisma.moduleMaster.updateMany({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      data,
    });
    if (module.count === 0) {
      res.status(404).json({ success: false, error: 'Module not found' });
      return;
    }
    const updated = await prisma.moduleMaster.findUnique({
      where: { id: req.params.id },
      include: { subModules: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /sap-modules/:id
router.delete('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check if any records use this module
    const count = await prisma.iTSMRecord.count({ where: { moduleId: req.params.id } });
    if (count > 0) {
      res
        .status(400)
        .json({ success: false, error: `Cannot delete: ${count} tickets use this module. Deactivate it instead.` });
      return;
    }
    await prisma.subModuleMaster.deleteMany({ where: { moduleId: req.params.id, tenantId: req.user!.tenantId } });
    await prisma.moduleMaster.deleteMany({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════════════════════
// SAP SUB-MODULES
// ══════════════════════════════════════════════════════════════

// POST /sap-modules/:moduleId/sub-modules
router.post(
  '/:moduleId/sub-modules',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, name, description, sortOrder } = req.body;
      if (!code || !name) {
        res.status(400).json({ success: false, error: 'Code and name are required' });
        return;
      }
      // Resolve systemId from the parent module so sub-modules inherit
      const parentModule = await prisma.moduleMaster.findUnique({
        where: { id: req.params.moduleId },
        select: { systemId: true },
      });
      if (!parentModule) {
        res.status(404).json({ success: false, error: 'Parent module not found' });
        return;
      }
      const sub = await prisma.subModuleMaster.create({
        data: {
          tenantId: req.user!.tenantId,
          systemId: parentModule.systemId,
          moduleId: req.params.moduleId,
          code: code.toUpperCase(),
          name,
          description: description || null,
          sortOrder: sortOrder || 0,
        },
      });
      res.status(201).json({ success: true, data: sub });
    } catch (err: any) {
      if (err.code === 'P2002') {
        res
          .status(409)
          .json({ success: false, error: `Sub-module code "${req.body.code}" already exists for this module` });
        return;
      }
      next(err);
    }
  },
);

// ── Seed default SAP modules ─────────────────────────────────
router.post('/seed', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const defaults = [
      {
        code: 'MM',
        name: 'Materials Management',
        subs: [
          { code: 'INV', name: 'Inventory Management' },
          { code: 'PROC', name: 'Procurement' },
          { code: 'PO', name: 'Purchase Orders' },
          { code: 'PR', name: 'Purchase Requisitions' },
          { code: 'VM', name: 'Vendor Management' },
          { code: 'IM', name: 'Invoice Management' },
        ],
      },
      {
        code: 'FI',
        name: 'Financial Accounting',
        subs: [
          { code: 'GL', name: 'General Ledger' },
          { code: 'AR', name: 'Accounts Receivable' },
          { code: 'AP', name: 'Accounts Payable' },
          { code: 'AA', name: 'Asset Accounting' },
          { code: 'BL', name: 'Bank Ledger' },
        ],
      },
      {
        code: 'CO',
        name: 'Controlling',
        subs: [
          { code: 'CCA', name: 'Cost Center Accounting' },
          { code: 'PC', name: 'Product Costing' },
          { code: 'PA', name: 'Profitability Analysis' },
          { code: 'IO', name: 'Internal Orders' },
        ],
      },
      {
        code: 'SD',
        name: 'Sales & Distribution',
        subs: [
          { code: 'SO', name: 'Sales Orders' },
          { code: 'DL', name: 'Delivery' },
          { code: 'BIL', name: 'Billing' },
          { code: 'PR', name: 'Pricing' },
          { code: 'CRM', name: 'Customer Master' },
        ],
      },
      {
        code: 'PP',
        name: 'Production Planning',
        subs: [
          { code: 'MRP', name: 'Material Requirements Planning' },
          { code: 'SFC', name: 'Shop Floor Control' },
          { code: 'BOM', name: 'Bill of Materials' },
          { code: 'RTG', name: 'Routing' },
          { code: 'DM', name: 'Demand Management' },
        ],
      },
      {
        code: 'PM',
        name: 'Plant Maintenance',
        subs: [
          { code: 'PM-WO', name: 'Work Orders' },
          { code: 'PM-EQ', name: 'Equipment Management' },
          { code: 'PM-CB', name: 'Calibration' },
          { code: 'PM-SM', name: 'Service Management' },
        ],
      },
      {
        code: 'QM',
        name: 'Quality Management',
        subs: [
          { code: 'QI', name: 'Quality Inspection' },
          { code: 'QN', name: 'Quality Notifications' },
          { code: 'QC', name: 'Quality Certificates' },
        ],
      },
      {
        code: 'HR',
        name: 'Human Resources (HCM)',
        subs: [
          { code: 'PA', name: 'Personnel Administration' },
          { code: 'PY', name: 'Payroll' },
          { code: 'TM', name: 'Time Management' },
          { code: 'OM', name: 'Organizational Management' },
        ],
      },
      {
        code: 'WM',
        name: 'Warehouse Management',
        subs: [
          { code: 'WM-ST', name: 'Storage' },
          { code: 'WM-GR', name: 'Goods Receipt' },
          { code: 'WM-GI', name: 'Goods Issue' },
          { code: 'WM-PI', name: 'Physical Inventory' },
        ],
      },
      {
        code: 'BASIS',
        name: 'SAP Basis / Technology',
        subs: [
          { code: 'AUTH', name: 'Authorization & Roles' },
          { code: 'PERF', name: 'Performance Tuning' },
          { code: 'TRNS', name: 'Transport Management' },
          { code: 'UPGR', name: 'Upgrades & Patches' },
          { code: 'CONN', name: 'Connectivity / RFC / IDoc' },
        ],
      },
      {
        code: 'ABAP',
        name: 'ABAP Development',
        subs: [
          { code: 'RPT', name: 'Reports' },
          { code: 'ENH', name: 'Enhancements / BADIs' },
          { code: 'FORM', name: 'Forms (Smartforms/Adobe)' },
          { code: 'WF', name: 'Workflow' },
          { code: 'INTF', name: 'Interfaces' },
        ],
      },
    ];

    const systemId = await getSapSystemId();
    let moduleCount = 0,
      subCount = 0;
    for (let i = 0; i < defaults.length; i++) {
      const d = defaults[i];
      let mod = await prisma.moduleMaster.findUnique({
        where: { tenantId_systemId_code: { tenantId, systemId, code: d.code } },
      });
      if (!mod) {
        mod = await prisma.moduleMaster.create({
          data: { tenantId, systemId, code: d.code, name: d.name, sortOrder: (i + 1) * 10 },
        });
        moduleCount++;
      }
      for (let j = 0; j < d.subs.length; j++) {
        const s = d.subs[j];
        const existing = await prisma.subModuleMaster.findUnique({
          where: { tenantId_moduleId_code: { tenantId, moduleId: mod.id, code: s.code } },
        });
        if (!existing) {
          await prisma.subModuleMaster.create({
            data: { tenantId, systemId, moduleId: mod.id, code: s.code, name: s.name, sortOrder: (j + 1) * 10 },
          });
          subCount++;
        }
      }
    }

    res.json({ success: true, message: `Seeded ${moduleCount} modules, ${subCount} sub-modules` });
  } catch (err) {
    next(err);
  }
});

export default router;
