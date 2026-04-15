/**
 * ams-seed.ts
 *
 * Realistic AMS seed for ServiceDeskPro intelligence validation.
 * Client: GlobalManufacturing AG (mid-size SAP AMS client)
 * Modules: FICO, MM, SD, PP — with realistic ticket patterns
 *
 * Run via Railway admin endpoint: POST /admin/ams-seed
 * Or add to startup.ts with AMS_SEED=true env var
 *
 * Ticket volumes (last 90 days):
 *   FICO — 28 tickets (GL, AP, AR, Asset Accounting)
 *   MM   — 22 tickets (Procurement, Inventory, GR/GI)
 *   SD   — 18 tickets (Order Management, Billing, Pricing)
 *   PP   — 14 tickets (MRP, Production Orders, BOM)
 *   Total: 82 tickets across incidents, requests, problems, changes
 *
 * Patterns built in for intelligence validation:
 *   - FICO/AP: 7 recurring payment run failures → knowledge gap signal
 *   - MM/GR: 5 GR/GI posting errors → pattern detection
 *   - SD/Pricing: 4 pricing condition errors → recurring pattern
 *   - PP/MRP: Problem record exists for MRP exceptions
 *   - Mix of P1-P4, open/resolved, with realistic resolution times
 */

import { PrismaClient, RecordStatus, Priority, RecordType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3600000);
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let recCounter = 1;
function nextNumber(type: RecordType): string {
  const prefix = { INCIDENT: 'INC', REQUEST: 'REQ', PROBLEM: 'PRB', CHANGE: 'CHG' }[type];
  return `${prefix}-2026-${String(recCounter++).padStart(5, '0')}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Starting AMS seed for intelligence validation...');

  const pw = await bcrypt.hash('Admin@123456', 12);

  // ── 1. Tenant (upsert Intraedge) ──────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'intraedge' },
    update: {},
    create: {
      name: 'Intraedge',
      slug: 'intraedge',
      timezone: 'Asia/Kolkata',
      country: 'IN',
      status: 'ACTIVE',
      settings: { maxUsers: 500, features: ['sla', 'email', 'cmdb'] },
    },
  });
  console.log('✅ Tenant:', tenant.name);

  // ── 2. Clear existing tickets only (keep users/agents if exist) ──
  // Delete in safe order
// Delete in safe dependency order
  await prisma.sLAPauseHistory.deleteMany({});
  await prisma.sLATracking.deleteMany({ where: { record: { tenantId: tenant.id } } });
  await prisma.timeEntry.deleteMany({ where: { record: { tenantId: tenant.id } } });
  await prisma.comment.deleteMany({ where: { record: { tenantId: tenant.id } } });
  await prisma.notification.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.emailLog.deleteMany({ where: { record: { tenantId: tenant.id } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.iTSMRecord.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.contractShift.deleteMany({ where: { contract: { customer: { tenantId: tenant.id } } } });
  await prisma.contractHolidayCalendar.deleteMany({ where: { contract: { customer: { tenantId: tenant.id } } } });
  await prisma.contract.deleteMany({ where: { customer: { tenantId: tenant.id } } });
  await prisma.customerAgent.deleteMany({ where: { customer: { tenantId: tenant.id } } });
  await prisma.user.updateMany({ where: { tenantId: tenant.id, customerId: { not: null } }, 
    data: { customerId: null } 
  });
  await prisma.customer.deleteMany({ where: { tenantId: tenant.id } });
  console.log('✅ Cleared existing ticket data');

  // ── 3. Users ──────────────────────────────────────────────
  const saUser = await prisma.user.upsert({
    where: { email: 'admin@intraedge.com' },
    update: {},
    create: {
      tenantId: tenant.id, email: 'admin@intraedge.com', passwordHash: pw,
      firstName: 'System', lastName: 'Administrator', role: 'SUPER_ADMIN', status: 'ACTIVE',
    },
  });

  const pmUser = await prisma.user.upsert({
    where: { email: 'priya.sharma@intraedge.com' },
    update: {},
    create: {
      tenantId: tenant.id, email: 'priya.sharma@intraedge.com', passwordHash: pw,
      firstName: 'Priya', lastName: 'Sharma', role: 'PROJECT_MANAGER', status: 'ACTIVE',
    },
  });

  // Agents — one per module specialty
  const ficoAgentUser = await prisma.user.upsert({
    where: { email: 'rajesh.kumar@intraedge.com' },
    update: {},
    create: {
      tenantId: tenant.id, email: 'rajesh.kumar@intraedge.com', passwordHash: pw,
      firstName: 'Rajesh', lastName: 'Kumar', role: 'AGENT', status: 'ACTIVE',
    },
  });

  const mmAgentUser = await prisma.user.upsert({
    where: { email: 'anitha.reddy@intraedge.com' },
    update: {},
    create: {
      tenantId: tenant.id, email: 'anitha.reddy@intraedge.com', passwordHash: pw,
      firstName: 'Anitha', lastName: 'Reddy', role: 'AGENT', status: 'ACTIVE',
    },
  });

  const sdAgentUser = await prisma.user.upsert({
    where: { email: 'vikram.nair@intraedge.com' },
    update: {},
    create: {
      tenantId: tenant.id, email: 'vikram.nair@intraedge.com', passwordHash: pw,
      firstName: 'Vikram', lastName: 'Nair', role: 'AGENT', status: 'ACTIVE',
    },
  });

  const ppAgentUser = await prisma.user.upsert({
    where: { email: 'deepa.menon@intraedge.com' },
    update: {},
    create: {
      tenantId: tenant.id, email: 'deepa.menon@intraedge.com', passwordHash: pw,
      firstName: 'Deepa', lastName: 'Menon', role: 'AGENT', status: 'ACTIVE',
    },
  });

  // Client-side users
  const caUser = await prisma.user.upsert({
    where: { email: 'it.admin@globalmanufacturing.de' },
    update: {},
    create: {
      tenantId: tenant.id, email: 'it.admin@globalmanufacturing.de', passwordHash: pw,
      firstName: 'Klaus', lastName: 'Weber', role: 'COMPANY_ADMIN', status: 'ACTIVE',
    },
  });

  const endUser1 = await prisma.user.upsert({
    where: { email: 'finance.user@globalmanufacturing.de' },
    update: {},
    create: {
      tenantId: tenant.id, email: 'finance.user@globalmanufacturing.de', passwordHash: pw,
      firstName: 'Maria', lastName: 'Fischer', role: 'USER', status: 'ACTIVE',
    },
  });

  const endUser2 = await prisma.user.upsert({
    where: { email: 'procurement.user@globalmanufacturing.de' },
    update: {},
    create: {
      tenantId: tenant.id, email: 'procurement.user@globalmanufacturing.de', passwordHash: pw,
      firstName: 'Hans', lastName: 'Mueller', role: 'USER', status: 'ACTIVE',
    },
  });

  console.log('✅ Users created');

  // ── 4. Agents ─────────────────────────────────────────────
  const pmAgent = await prisma.agent.upsert({
    where: { userId: pmUser.id },
    update: {},
    create: {
      userId: pmUser.id, specialization: 'SAP Project Management',
      level: 'SPECIALIST', timezone: 'Asia/Kolkata', maxConcurrent: 0,
      status: 'AVAILABLE', agentType: 'PROJECT_MANAGER',
    },
  });

  const ficoAgent = await prisma.agent.upsert({
    where: { userId: ficoAgentUser.id },
    update: {},
    create: {
      userId: ficoAgentUser.id, specialization: 'SAP FICO',
      level: 'L3', timezone: 'Asia/Kolkata', maxConcurrent: 10,
      status: 'AVAILABLE', agentType: 'AGENT',
    },
  });

  const mmAgent = await prisma.agent.upsert({
    where: { userId: mmAgentUser.id },
    update: {},
    create: {
      userId: mmAgentUser.id, specialization: 'SAP MM',
      level: 'L3', timezone: 'Asia/Kolkata', maxConcurrent: 10,
      status: 'AVAILABLE', agentType: 'AGENT',
    },
  });

  const sdAgent = await prisma.agent.upsert({
    where: { userId: sdAgentUser.id },
    update: {},
    create: {
      userId: sdAgentUser.id, specialization: 'SAP SD',
      level: 'L2', timezone: 'Asia/Kolkata', maxConcurrent: 10,
      status: 'AVAILABLE', agentType: 'AGENT',
    },
  });

  const ppAgent = await prisma.agent.upsert({
    where: { userId: ppAgentUser.id },
    update: {},
    create: {
      userId: ppAgentUser.id, specialization: 'SAP PP',
      level: 'L2', timezone: 'Asia/Kolkata', maxConcurrent: 10,
      status: 'AVAILABLE', agentType: 'AGENT',
    },
  });

  console.log('✅ Agents created');

  // ── 5. SAP Modules ────────────────────────────────────────
  const ficoModule = await prisma.sAPModuleMaster.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'FICO' } },
    update: {},
    create: {
      tenantId: tenant.id, code: 'FICO',
      name: 'Financial Accounting & Controlling', isActive: true,
    },
  });

  const mmModule = await prisma.sAPModuleMaster.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'MM' } },
    update: {},
    create: {
      tenantId: tenant.id, code: 'MM',
      name: 'Materials Management', isActive: true,
    },
  });

  const sdModule = await prisma.sAPModuleMaster.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'SD' } },
    update: {},
    create: {
      tenantId: tenant.id, code: 'SD',
      name: 'Sales & Distribution', isActive: true,
    },
  });

  const ppModule = await prisma.sAPModuleMaster.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'PP' } },
    update: {},
    create: {
      tenantId: tenant.id, code: 'PP',
      name: 'Production Planning', isActive: true,
    },
  });

  // Sub-modules
  const ficoGL = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: ficoModule.id, code: 'FICO-GL' } },
    update: {}, create: { tenantId: tenant.id, moduleId: ficoModule.id, code: 'FICO-GL', name: 'General Ledger', isActive: true },
  });
  const ficoAP = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: ficoModule.id, code: 'FICO-AP' } },
    update: {}, create: { tenantId: tenant.id, moduleId: ficoModule.id, code: 'FICO-AP', name: 'Accounts Payable', isActive: true },
  });
  const ficoAR = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: ficoModule.id, code: 'FICO-AR' } },
    update: {}, create: { tenantId: tenant.id, moduleId: ficoModule.id, code: 'FICO-AR', name: 'Accounts Receivable', isActive: true },
  });
  const ficoCO = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: ficoModule.id, code: 'FICO-CO' } },
    update: {}, create: { tenantId: tenant.id, moduleId: ficoModule.id, code: 'FICO-CO', name: 'Controlling / Cost Center', isActive: true },
  });
  const mmPR = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: mmModule.id, code: 'MM-PR' } },
    update: {}, create: { tenantId: tenant.id, moduleId: mmModule.id, code: 'MM-PR', name: 'Procurement / Purchase Orders', isActive: true },
  });
  const mmGR = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: mmModule.id, code: 'MM-GR' } },
    update: {}, create: { tenantId: tenant.id, moduleId: mmModule.id, code: 'MM-GR', name: 'Goods Receipt / Goods Issue', isActive: true },
  });
  const mmIM = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: mmModule.id, code: 'MM-IM' } },
    update: {}, create: { tenantId: tenant.id, moduleId: mmModule.id, code: 'MM-IM', name: 'Inventory Management', isActive: true },
  });
  const sdOM = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: sdModule.id, code: 'SD-OM' } },
    update: {}, create: { tenantId: tenant.id, moduleId: sdModule.id, code: 'SD-OM', name: 'Order Management', isActive: true },
  });
  const sdBI = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: sdModule.id, code: 'SD-BI' } },
    update: {}, create: { tenantId: tenant.id, moduleId: sdModule.id, code: 'SD-BI', name: 'Billing & Invoicing', isActive: true },
  });
  const sdPC = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: sdModule.id, code: 'SD-PC' } },
    update: {}, create: { tenantId: tenant.id, moduleId: sdModule.id, code: 'SD-PC', name: 'Pricing & Conditions', isActive: true },
  });
  const ppMRP = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: ppModule.id, code: 'PP-MRP' } },
    update: {}, create: { tenantId: tenant.id, moduleId: ppModule.id, code: 'PP-MRP', name: 'MRP / Demand Planning', isActive: true },
  });
  const ppPO = await prisma.sAPSubModuleMaster.upsert({
    where: { tenantId_moduleId_code: { tenantId: tenant.id, moduleId: ppModule.id, code: 'PP-PO' } },
    update: {}, create: { tenantId: tenant.id, moduleId: ppModule.id, code: 'PP-PO', name: 'Production Orders', isActive: true },
  });

  console.log('✅ SAP modules and sub-modules created');

  // ── 6. Agent specializations ──────────────────────────────
  await prisma.agentSpecialization.upsert({
    where: { agentId_sapModuleId: { agentId: ficoAgent.id, sapModuleId: ficoModule.id } },
    update: {},
    create: { agentId: ficoAgent.id, sapModuleId: ficoModule.id, sapSubModuleIds: [ficoGL.id, ficoAP.id, ficoAR.id, ficoCO.id] },
  });
  await prisma.agentSpecialization.upsert({
    where: { agentId_sapModuleId: { agentId: mmAgent.id, sapModuleId: mmModule.id } },
    update: {},
    create: { agentId: mmAgent.id, sapModuleId: mmModule.id, sapSubModuleIds: [mmPR.id, mmGR.id, mmIM.id] },
  });
  await prisma.agentSpecialization.upsert({
    where: { agentId_sapModuleId: { agentId: sdAgent.id, sapModuleId: sdModule.id } },
    update: {},
    create: { agentId: sdAgent.id, sapModuleId: sdModule.id, sapSubModuleIds: [sdOM.id, sdBI.id, sdPC.id] },
  });
  await prisma.agentSpecialization.upsert({
    where: { agentId_sapModuleId: { agentId: ppAgent.id, sapModuleId: ppModule.id } },
    update: {},
    create: { agentId: ppAgent.id, sapModuleId: ppModule.id, sapSubModuleIds: [ppMRP.id, ppPO.id] },
  });

  console.log('✅ Agent specializations created');

  // ── 7. Shift + Holiday Calendar ───────────────────────────
  const existingShift = await prisma.shift.findFirst({ where: { tenantId: tenant.id, name: 'IST Business Hours' } });
  const shift = existingShift || await prisma.shift.create({
    data: {
      tenantId: tenant.id, name: 'IST Business Hours',
      startTime: '09:00', endTime: '18:00',
      timezone: 'Asia/Kolkata', breakMinutes: 60,
    },
  });

  // ── 8. SLA Policy ─────────────────────────────────────────
  const existingSLA = await prisma.sLAPolicyMaster.findFirst({ where: { tenantId: tenant.id, code: 'GOLD-AMS' } });
  const slaPolicy = existingSLA || await prisma.sLAPolicyMaster.create({
    data: {
      tenantId: tenant.id, code: 'GOLD-AMS', name: 'Gold AMS SLA',
      priorities: { P1: { response: 30, resolution: 240 }, P2: { response: 60, resolution: 480 }, P3: { response: 240, resolution: 1440 }, P4: { response: 480, resolution: 2880 } },
      isActive: true,
    },
  });

  // ── 9. Support Type ───────────────────────────────────────
  const existingST = await prisma.supportTypeMaster.findFirst({ where: { tenantId: tenant.id, code: 'EXT-PLUS' } });
  const supportType = existingST || await prisma.supportTypeMaster.create({
    data: {
      tenantId: tenant.id, code: 'EXT-PLUS', name: 'Extended Plus',
      workDays: [1,2,3,4,5,6],
      afterHoursCoverage: 'ON_CALL', weekendCoverage: 'ON_CALL', holidayCoverage: 'NONE',
      slaPauseConditions: ['PENDING_CUSTOMER', 'OUTSIDE_BUSINESS_HOURS'],
      priorityScope: 'ALL',
      isActive: true,
    },
  });

  // ── 10. Customer ──────────────────────────────────────────
  await prisma.customerAgent.deleteMany({ where: { customer: { tenantId: tenant.id } } });
  const existingCustomer = await prisma.customer.findFirst({ where: { tenantId: tenant.id, companyName: 'GlobalManufacturing AG' } });
  if (existingCustomer) {
    await prisma.contract.deleteMany({ where: { customerId: existingCustomer.id } });
    await prisma.customer.delete({ where: { id: existingCustomer.id } });
  }

  const customer = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      companyName: 'GlobalManufacturing AG',
      industry: 'Manufacturing',
      country: 'DE',
      timezone: 'Europe/Berlin',
      status: 'ACTIVE',
      adminUserId: caUser.id,
      projectManagerAgentId: pmAgent.id,
      contactName: 'Klaus Weber',
      contactEmail: 'it.admin@globalmanufacturing.de',
    },
  });

  await prisma.user.update({ where: { id: caUser.id }, data: { customerId: customer.id } });
  await prisma.user.update({ where: { id: endUser1.id }, data: { customerId: customer.id } });
  await prisma.user.update({ where: { id: endUser2.id }, data: { customerId: customer.id } });

  await prisma.customerAgent.createMany({
    data: [
      { customerId: customer.id, agentId: pmAgent.id },
      { customerId: customer.id, agentId: ficoAgent.id },
      { customerId: customer.id, agentId: mmAgent.id },
      { customerId: customer.id, agentId: sdAgent.id },
      { customerId: customer.id, agentId: ppAgent.id },
    ],
    skipDuplicates: true,
  });

  // ── 11. Contract ──────────────────────────────────────────
  const contract = await prisma.contract.create({
    data: {
      customerId: customer.id,
      contractNumber: 'CON-2026-GLAG-001',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      billingAmount: 180000,
      currency: 'EUR',
      billingFrequency: 'Monthly',
      autoRenewal: true,
      renewalNoticeDays: 60,
      supportTypeMasterId: supportType.id,
      slaPolicyMasterId: slaPolicy.id,
      shifts: { create: { shiftId: shift.id } },
    },
  });

  console.log('✅ Customer and contract created: GlobalManufacturing AG');

  // ── 12. CMDB ──────────────────────────────────────────────
  const ciProd = await prisma.configurationItem.create({
    data: { tenantId: tenant.id, ciType: 'SYSTEM', name: 'SAP S/4HANA Production', environment: 'PROD', sid: 'PRD', hostname: 'sap-prd.globalmanufacturing.de', version: 'S/4HANA 2023 FPS02', status: 'ACTIVE' },
  });
  await prisma.configurationItem.create({
    data: { tenantId: tenant.id, ciType: 'DATABASE', name: 'SAP HANA DB Production', environment: 'PROD', sid: 'HDB', hostname: 'hana-prd.globalmanufacturing.de', version: 'HANA 2.0 SPS07', status: 'ACTIVE' },
  });

  console.log('✅ CMDB items created');

  // ── 13. Helper to create a ticket ────────────────────────
  async function createTicket(opts: {
    type: RecordType;
    title: string;
    description: string;
    priority: Priority;
    status: RecordStatus;
    moduleId: string;
    subModuleId: string;
    agentId: string;
    createdById: string;
    createdDaysAgo: number;
    resolvedDaysAgo?: number;
    tags?: string[];
    isParentProblem?: boolean;
    parentProblemId?: string;
  }) {
    const createdAt = daysAgo(opts.createdDaysAgo);
    const resolvedAt = opts.resolvedDaysAgo ? daysAgo(opts.resolvedDaysAgo) : null;
    const responseDeadline = new Date(createdAt.getTime() + (opts.priority === 'P1' ? 30 : opts.priority === 'P2' ? 60 : opts.priority === 'P3' ? 240 : 480) * 60000);
    const resolutionDeadline = new Date(createdAt.getTime() + (opts.priority === 'P1' ? 240 : opts.priority === 'P2' ? 480 : opts.priority === 'P3' ? 1440 : 2880) * 60000);
    const responded = opts.status !== 'NEW';
    const breachRes = resolvedAt ? resolvedAt > resolutionDeadline : opts.status !== 'RESOLVED' && opts.status !== 'CLOSED' && new Date() > resolutionDeadline;

    const record = await prisma.iTSMRecord.create({
      data: {
        tenantId: tenant.id,
        recordNumber: nextNumber(opts.type),
        recordType: opts.type,
        title: opts.title,
        description: opts.description,
        priority: opts.priority,
        status: opts.status,
        customerId: customer.id,
        contractId: contract.id,
        ciId: ciProd.id,
        createdById: opts.createdById,
        assignedAgentId: opts.agentId,
        sapModuleId: opts.moduleId,
        sapSubModuleId: opts.subModuleId,
        tags: opts.tags || [],
        parentProblemId: opts.parentProblemId || null,
        createdAt,
        updatedAt: resolvedAt || createdAt,
        resolvedAt,
        closedAt: opts.status === 'CLOSED' ? resolvedAt : null,
        slaTracking: {
          create: {
            responseDeadline,
            resolutionDeadline,
            respondedAt: responded ? new Date(createdAt.getTime() + randomBetween(5, 50) * 60000) : null,
            breachResponse: responded ? false : new Date() > responseDeadline,
            breachResolution: breachRes,
            warningResponseSent: false,
            warningResolutionSent: false,
          },
        },
      },
    });
    return record;
  }

  console.log('📋 Creating FICO tickets...');

  // ── FICO TICKETS (28 total) ────────────────────────────────

  // GL — 6 tickets
  await createTicket({ type: 'INCIDENT', title: 'Month-end GL closing period not opening in PRD', description: 'Finance team unable to open posting period for period 12/2025 in production. T-code OB52 shows period locked. Month-end closing is blocked.', priority: 'P1', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoGL.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 45, resolvedDaysAgo: 44, tags: ['period-close', 'gl', 'month-end'] });
  await createTicket({ type: 'INCIDENT', title: 'Document splitting not working for profit center', description: 'Document splitting activated for profit center accounting but line items not being split correctly for cross-segment postings. Affects financial reports.', priority: 'P2', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoGL.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 38, resolvedDaysAgo: 36, tags: ['document-splitting', 'profit-center'] });
  await createTicket({ type: 'INCIDENT', title: 'Foreign currency revaluation posting incorrect exchange rate', description: 'Monthly FX revaluation job SAPF100 posting with yesterday\'s exchange rate instead of month-end rate. Affects balance sheet valuation for USD/EUR positions.', priority: 'P2', status: 'IN_PROGRESS', moduleId: ficoModule.id, subModuleId: ficoGL.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 5, tags: ['fx-revaluation', 'exchange-rate'] });
  await createTicket({ type: 'REQUEST', title: 'Create new GL account for CAPEX tracking — 0020450', description: 'Request to create new GL account 0020450 for capital expenditure tracking per finance directive FIN-2026-003. Chart of accounts: GLAG. Account group: ANLAGEN.', priority: 'P3', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoGL.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 22, resolvedDaysAgo: 20, tags: ['gl-account', 'capex', 'master-data'] });
  await createTicket({ type: 'CHANGE', title: 'Activate new fiscal year variant V6 for company code DE01', description: 'Configuration change to activate fiscal year variant V6 (April-March) for new subsidiary DE01. Requires transport DEVK900123 to PRD. CAB approved ref CAB-2026-045.', priority: 'P2', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoGL.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 30, resolvedDaysAgo: 28, tags: ['fiscal-year', 'config', 'transport'] });
  await createTicket({ type: 'INCIDENT', title: 'Intercompany posting failing with error F5263', description: 'Intercompany postings between DE01 and DE02 failing with message F5 263 — clearing account not found. Blocking month-end intercompany reconciliation.', priority: 'P2', status: 'OPEN', moduleId: ficoModule.id, subModuleId: ficoGL.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 3, tags: ['intercompany', 'clearing', 'month-end'] });

  // AP — 9 tickets (recurring payment run pattern — knowledge gap signal)
  const apProblem = await createTicket({ type: 'PROBLEM', title: 'Recurring payment run F110 failures — root cause investigation', description: 'Root cause investigation for 7 incidents of F110 payment run failures in last 60 days. Pattern: failures occur on last business day of month. Suspected: BSEG table lock during payment run + parallel batch jobs. No permanent fix in place.', priority: 'P2', status: 'IN_PROGRESS', moduleId: ficoModule.id, subModuleId: ficoAP.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 10, tags: ['payment-run', 'f110', 'problem-management', 'recurring'] });

  await createTicket({ type: 'INCIDENT', title: 'F110 payment run terminated — BSEG table lock timeout', description: 'Monthly payment run F110 terminated after 45 minutes with ABAP short dump TSV_TNEW_PAGE_ALLOC_FAILED. Table BSEG locked. 234 vendor payments not processed. Finance escalating to CFO.', priority: 'P1', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoAP.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 62, resolvedDaysAgo: 62, tags: ['payment-run', 'f110', 'dump', 'recurring'], parentProblemId: apProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'F110 payment run terminated — house bank not found', description: 'Payment run F110 failing for company code DE01 with error "House bank DEUTDEDB not found in payment parameters". 89 urgent vendor payments blocked. Month-end impact.', priority: 'P1', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoAP.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 52, resolvedDaysAgo: 52, tags: ['payment-run', 'f110', 'house-bank', 'recurring'], parentProblemId: apProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'F110 payment run not picking vendor invoices due to payment terms', description: 'Payment run F110 not selecting 45 vendor invoices that are due. Payment terms ZB30 not being evaluated correctly. Manual workaround applied — business blocked.', priority: 'P2', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoAP.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 42, resolvedDaysAgo: 41, tags: ['payment-run', 'f110', 'payment-terms', 'recurring'], parentProblemId: apProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'F110 duplicate payment — same invoice paid twice', description: 'Duplicate payment created by F110 run — vendor invoice 4500012345 paid twice. Total duplicate amount EUR 45,230. Reversal and vendor credit note required urgently.', priority: 'P1', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoAP.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 33, resolvedDaysAgo: 33, tags: ['payment-run', 'f110', 'duplicate-payment', 'recurring'], parentProblemId: apProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'F110 payment run job cancelled — printer spool overflow', description: 'Payment run F110 cancelled due to spool overflow on SAP print server. Debit memo print job blocking payment advice output. 156 payments not executed.', priority: 'P2', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoAP.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 25, resolvedDaysAgo: 24, tags: ['payment-run', 'f110', 'spool', 'recurring'], parentProblemId: apProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'F110 failing — SEPA XML file not generated for bank submission', description: 'Payment run F110 completed but SEPA XML file (pain.001) not generated for bank upload. Bank submission deadline in 2 hours. Payment format configuration issue suspected.', priority: 'P1', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoAP.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 18, resolvedDaysAgo: 18, tags: ['payment-run', 'f110', 'sepa', 'recurring'], parentProblemId: apProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'F110 payment run failing again — month-end run blocked', description: 'Latest occurrence of recurring F110 failure. Payment run terminated at 02:30 AM. Finance team discovered at 08:00 AM. Month-end payment deadline missed. Escalated to PM.', priority: 'P1', status: 'OPEN', moduleId: ficoModule.id, subModuleId: ficoAP.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 2, tags: ['payment-run', 'f110', 'recurring', 'escalated'], parentProblemId: apProblem.id });

  // AR — 5 tickets
  await createTicket({ type: 'INCIDENT', title: 'Dunning run sending incorrect dunning letters — wrong amounts', description: 'Dunning program F150 sending dunning letters with incorrect open item amounts. Letters show EUR 0 balance for customers with outstanding invoices. Customer complaints received.', priority: 'P2', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoAR.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 40, resolvedDaysAgo: 38, tags: ['dunning', 'ar', 'customer'] });
  await createTicket({ type: 'INCIDENT', title: 'Customer account incorrectly blocked — credit limit issue', description: 'Customer account 10045623 blocked for orders due to incorrect credit limit calculation. Customer has paid all invoices. System showing stale credit exposure. EUR 280,000 sales order on hold.', priority: 'P2', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoAR.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 28, resolvedDaysAgo: 27, tags: ['credit-limit', 'customer-block', 'ar'] });
  await createTicket({ type: 'REQUEST', title: 'Extend credit limit for customer 10045623 to EUR 500,000', description: 'Request to extend credit limit for GlobalManufacturing key customer Deutsche Bahn AG from EUR 350,000 to EUR 500,000 per approval from CFO ref FIN-APPR-2026-019.', priority: 'P3', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoAR.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 15, resolvedDaysAgo: 14, tags: ['credit-limit', 'master-data', 'ar'] });
  await createTicket({ type: 'INCIDENT', title: 'Incoming payment not clearing customer invoice automatically', description: 'Bank statement upload via FEBP not auto-clearing customer invoices. 23 incoming payments sitting in clearing account 11000010. Manual clearing effort blocking AR team.', priority: 'P2', status: 'IN_PROGRESS', moduleId: ficoModule.id, subModuleId: ficoAR.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 4, tags: ['bank-statement', 'auto-clearing', 'ar'] });
  await createTicket({ type: 'INCIDENT', title: 'AR aging report showing incorrect balances for GBP accounts', description: 'AR aging report S_ALR_87012178 showing incorrect outstanding balances for GBP-denominated customer accounts. Suspected FX translation issue in reporting.', priority: 'P3', status: 'NEW', moduleId: ficoModule.id, subModuleId: ficoAR.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 1, tags: ['ar-aging', 'fx', 'reporting'] });

  // CO — 4 tickets
  await createTicket({ type: 'INCIDENT', title: 'Cost center planning upload failing — transaction KP06', description: 'Annual cost center planning upload via KP06 failing for cost centers 100100-100150. Error: "Plan version 0 locked for planning". Finance planning deadline tomorrow.', priority: 'P2', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoCO.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 35, resolvedDaysAgo: 34, tags: ['cost-center', 'planning', 'co'] });
  await createTicket({ type: 'INCIDENT', title: 'Internal order settlement failing — receiver cost center invalid', description: 'Internal order KO88 settlement failing for orders IO-2026-0045 through IO-2026-0067. Error: receiver cost center 200450 not valid for settlement period 01/2026.', priority: 'P2', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoCO.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 20, resolvedDaysAgo: 18, tags: ['internal-order', 'settlement', 'co'] });
  await createTicket({ type: 'REQUEST', title: 'Create new profit center PC-2026-EMEA for EMEA region reporting', description: 'Create new profit center PC-2026-EMEA in SAP as per org restructure memo ORG-2026-012. Valid from 01.04.2026. Assign to profit center group EMEA-PC-GRP.', priority: 'P3', status: 'RESOLVED', moduleId: ficoModule.id, subModuleId: ficoCO.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 12, resolvedDaysAgo: 11, tags: ['profit-center', 'master-data', 'org-change'] });
  await createTicket({ type: 'INCIDENT', title: 'Product costing run CK11N giving zero costs for material group FERT', description: 'Standard cost estimate CK11N returning zero material costs for finished goods (FERT) material group. BOM explosion working but activity costs not picking up. Month-end costing run at risk.', priority: 'P2', status: 'OPEN', moduleId: ficoModule.id, subModuleId: ficoCO.id, agentId: ficoAgent.id, createdById: endUser1.id, createdDaysAgo: 2, tags: ['product-costing', 'ck11n', 'bom', 'co'] });

  console.log('✅ FICO tickets created (28)');
  console.log('📋 Creating MM tickets...');

  // ── MM TICKETS (22 total) ──────────────────────────────────

  // PR/PO — 8 tickets
  await createTicket({ type: 'INCIDENT', title: 'Purchase order release strategy not triggering for PO value > EUR 50,000', description: 'POs above EUR 50,000 threshold not triggering release workflow. Release strategy Z2 (2-level approval) not being determined. POs being created without required approval. Audit finding risk.', priority: 'P1', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmPR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 55, resolvedDaysAgo: 54, tags: ['po-release', 'approval', 'audit'] });
  await createTicket({ type: 'INCIDENT', title: 'ME21N PO creation blocked — vendor evaluation score below threshold', description: 'Unable to create POs for vendor 100023 (Siemens AG). Error: vendor evaluation score 42/100 below required threshold 60. Vendor has no open quality complaints. Score appears incorrect.', priority: 'P2', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmPR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 44, resolvedDaysAgo: 43, tags: ['vendor-eval', 'po-creation', 'mm'] });
  await createTicket({ type: 'REQUEST', title: 'Extend contract 4600000123 for vendor 100045 by 12 months', description: 'Extend SAP framework agreement (scheduling agreement) 4600000123 with vendor 100045 by 12 months to 31.12.2027. Procurement approval PAP-2026-089 attached.', priority: 'P3', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmPR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 30, resolvedDaysAgo: 29, tags: ['contract-extension', 'scheduling-agreement'] });
  await createTicket({ type: 'INCIDENT', title: 'Vendor invoice MIRO failing — GR/IR account determination error', description: 'MIRO invoice verification failing for PO 4500234567 with error "Account determination for GR/IR clearing account not found". 12 vendor invoices blocked. Accounts payable deadline today.', priority: 'P2', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmPR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 25, resolvedDaysAgo: 24, tags: ['miro', 'invoice-verification', 'gr-ir'] });
  await createTicket({ type: 'INCIDENT', title: 'Purchase requisition conversion to PO failing — plant not found', description: 'ME57/ME59N automatic PO creation from purchase requisitions failing. Error: "Purchasing organization PGAG not assigned to plant DE10". 34 PRs stuck in queue.', priority: 'P2', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmPR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 18, resolvedDaysAgo: 17, tags: ['pr-conversion', 'po', 'plant-config'] });
  await createTicket({ type: 'CHANGE', title: 'Add new payment term ZB45 (45-day net) to vendor master', description: 'Create new payment term ZB45 (45 days net payment) and assign to 23 vendors as per negotiated contracts. Transport DEVK900456. Requires update to vendor master records.', priority: 'P3', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmPR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 15, resolvedDaysAgo: 13, tags: ['payment-terms', 'vendor-master', 'config'] });
  await createTicket({ type: 'INCIDENT', title: 'PO price variance posting to wrong GL account at MIRO', description: 'Price variance at invoice verification (MIRO) being posted to account 0021000 instead of configured PRD account 0023500. Price difference postings incorrect for last 15 invoices.', priority: 'P2', status: 'IN_PROGRESS', moduleId: mmModule.id, subModuleId: mmPR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 4, tags: ['price-variance', 'miro', 'account-determination'] });
  await createTicket({ type: 'INCIDENT', title: 'Output type NEU not printing for POs to vendor group FOREIGN', description: 'PO output type NEU (purchase order print) not generating for vendors in vendor account group FOREIGN. SAP print preview works but background job not creating spool. 28 POs not sent to vendors.', priority: 'P3', status: 'OPEN', moduleId: mmModule.id, subModuleId: mmPR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 3, tags: ['output-management', 'po-print', 'vendor'] });

  // GR/GI — 8 tickets (recurring pattern)
  const mmGRProblem = await createTicket({ type: 'PROBLEM', title: 'Recurring GR posting errors for plant DE10 — root cause investigation', description: 'Pattern of 5 goods receipt posting failures in plant DE10 in last 30 days. All related to movement type 101 with account assignment category K. Suspected: missing account determination for valuation class 3100 + cost center combination in plant DE10.', priority: 'P2', status: 'OPEN', moduleId: mmModule.id, subModuleId: mmGR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 8, tags: ['goods-receipt', 'plant-de10', 'problem-management', 'recurring'] });

  await createTicket({ type: 'INCIDENT', title: 'MIGO GR posting error — account determination not found for movement 101', description: 'Goods receipt posting in MIGO failing for all POs with account assignment K (cost center). Error: "G/L account not found in account determination for transaction WRX". Plant DE10. 34 deliveries waiting.', priority: 'P2', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmGR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 28, resolvedDaysAgo: 27, tags: ['goods-receipt', 'migo', 'account-determination', 'recurring'], parentProblemId: mmGRProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'GR posting blocked — material document reversal creating negative stock', description: 'Material document reversal (movement type 102) creating negative stock for material MAT-100234 in storage location DE10-LAG1. System should block but tolerance allowing it. Inventory reconciliation affected.', priority: 'P2', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmGR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 22, resolvedDaysAgo: 21, tags: ['goods-receipt', 'negative-stock', 'reversal', 'recurring'], parentProblemId: mmGRProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'GI posting for production order failing — batch not found error', description: 'Goods issue for production order (movement type 261) failing. Error: "Batch 20260301-A not found in unrestricted stock". Batch visible in MMBE but not available for GI. Production line stopped.', priority: 'P1', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmGR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 16, resolvedDaysAgo: 16, tags: ['goods-issue', 'batch', 'production', 'recurring'], parentProblemId: mmGRProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'GR/GI slip not printing after goods movement posting', description: 'WE03 goods receipt/goods issue slip not printing after MIGO posting. Output type WA03 not triggering for movement types 101, 261, 601 in plant DE10. Warehouse operations unable to confirm deliveries.', priority: 'P2', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmGR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 12, resolvedDaysAgo: 11, tags: ['output-management', 'gr-gi', 'warehouse', 'recurring'], parentProblemId: mmGRProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'GR posting creating wrong valuation for split-valuated material', description: 'Goods receipt for split-valuated material MAT-500123 (valuated by vendor) posting with incorrect valuation price. System using standard price instead of vendor-specific price. Inventory value overstated by EUR 12,400.', priority: 'P2', status: 'OPEN', moduleId: mmModule.id, subModuleId: mmGR.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 3, tags: ['goods-receipt', 'split-valuation', 'inventory-value', 'recurring'], parentProblemId: mmGRProblem.id });

  // Inventory — 6 tickets
  await createTicket({ type: 'INCIDENT', title: 'Physical inventory posting blocked — tolerance exceeded for material group', description: 'Physical inventory document posting blocked for 45 materials in material group RAWS. Tolerance check showing >5% variance but actual count verified correct. System tolerance config issue.', priority: 'P2', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmIM.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 50, resolvedDaysAgo: 48, tags: ['physical-inventory', 'tolerance', 'inventory'] });
  await createTicket({ type: 'INCIDENT', title: 'Stock transfer order posting failing between plants DE10 and DE20', description: 'STO (stock transfer order) goods issue at supplying plant DE10 failing. Receiving plant DE20 not found in interplant transfer config. 8 urgent STOs blocked for production supply.', priority: 'P2', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmIM.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 37, resolvedDaysAgo: 35, tags: ['stock-transfer', 'interplant', 'sto'] });
  await createTicket({ type: 'REQUEST', title: 'Update safety stock levels for 120 fast-moving materials', description: 'Update minimum safety stock and reorder point for 120 Class A materials as per annual review. Excel upload template attached. Effective 01.04.2026.', priority: 'P3', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmIM.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 20, resolvedDaysAgo: 17, tags: ['safety-stock', 'reorder-point', 'material-master'] });
  await createTicket({ type: 'INCIDENT', title: 'Consignment stock not being reduced at goods withdrawal', description: 'Consignment stock for vendor 200045 not being reduced when goods are withdrawn from consignment stores. Material documents created but consignment liability not updated. Vendor reconciliation affected.', priority: 'P2', status: 'IN_PROGRESS', moduleId: mmModule.id, subModuleId: mmIM.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 5, tags: ['consignment', 'stock-management', 'vendor'] });
  await createTicket({ type: 'INCIDENT', title: 'Batch expiry date check not blocking GI for expired batches', description: 'System allowing goods issues for batches past expiry date. Batch classification ZEXP01 has shelf life check but it is not being enforced at GI. Quality/compliance risk — expired materials shipped to customer last week.', priority: 'P1', status: 'OPEN', moduleId: mmModule.id, subModuleId: mmIM.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 1, tags: ['batch-management', 'expiry', 'quality', 'compliance'] });
  await createTicket({ type: 'REQUEST', title: 'Configure new storage location DE10-QUAL for quality inspection stock', description: 'Create new storage location DE10-QUAL in plant DE10 for quality inspection stock. Assign to warehouse number WH10. Restrict movement types to 321/322 (quality to unrestricted). Per QM-2026-034.', priority: 'P3', status: 'RESOLVED', moduleId: mmModule.id, subModuleId: mmIM.id, agentId: mmAgent.id, createdById: endUser2.id, createdDaysAgo: 10, resolvedDaysAgo: 8, tags: ['storage-location', 'quality', 'warehouse-config'] });

  console.log('✅ MM tickets created (22)');
  console.log('📋 Creating SD tickets...');

  // ── SD TICKETS (18 total) ──────────────────────────────────

  // Order Management — 6 tickets
  await createTicket({ type: 'INCIDENT', title: 'Sales order blocked for delivery — credit check hard block', description: 'Sales order 4000123456 for customer 10023456 (Volkswagen AG) blocked at delivery creation. Credit check hard block despite customer having EUR 2M available credit. Dynamic credit check malfunction.', priority: 'P1', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdOM.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 48, resolvedDaysAgo: 48, tags: ['sales-order', 'credit-check', 'delivery-block'] });
  await createTicket({ type: 'INCIDENT', title: 'Delivery creation failing — picking location not determined', description: 'Outbound delivery creation (VL01N) failing for 23 sales orders. Error: "No picking location found for storage condition 01 in warehouse WH10". Dispatch deadline 16:00 today. Orders for key accounts.', priority: 'P2', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdOM.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 35, resolvedDaysAgo: 34, tags: ['delivery', 'picking', 'warehouse', 'sd'] });
  await createTicket({ type: 'INCIDENT', title: 'Customer returns processing — RMA credit memo not generated', description: 'Returns order created (order type RE) but credit memo request not automatically generated after returns delivery GR. Manual workaround needed for 12 return orders. Revenue recognition affected.', priority: 'P2', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdOM.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 22, resolvedDaysAgo: 20, tags: ['returns', 'credit-memo', 'rma', 'sd'] });
  await createTicket({ type: 'REQUEST', title: 'Create new sales area for Poland market DE/12/01', description: 'Configure new sales area Sales Org DE / Distribution Channel 12 / Division 01 for Poland market entry. Assign to company code DE01. Per project go-live PL-LAUNCH-2026.', priority: 'P2', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdOM.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 28, resolvedDaysAgo: 25, tags: ['sales-area', 'config', 'market-expansion'] });
  await createTicket({ type: 'INCIDENT', title: 'Transfer of requirement (ToR) not creating planned orders in PP', description: 'Sales order demand not triggering transfer of requirements to PP. Planned independent requirements not visible in MRP planning. SD-PP integration broken — production planning team cannot see order pipeline.', priority: 'P2', status: 'IN_PROGRESS', moduleId: sdModule.id, subModuleId: sdOM.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 6, tags: ['transfer-of-requirements', 'tor', 'sd-pp-integration', 'mrp'] });
  await createTicket({ type: 'INCIDENT', title: 'Sales order confirmation email not being sent to customers', description: 'Output type BA00 (order confirmation) not being sent via email to customers since 3 days. Email log shows queued but not dispatched. SMTP connection issue suspected. 67 orders without confirmation.', priority: 'P2', status: 'OPEN', moduleId: sdModule.id, subModuleId: sdOM.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 3, tags: ['output-management', 'email', 'order-confirmation'] });

  // Billing — 5 tickets
  await createTicket({ type: 'INCIDENT', title: 'Billing run VF04 not selecting deliveries for invoicing', description: 'Collective billing run VF04 not selecting 45 completed deliveries for invoicing. Billing due list showing deliveries but billing document not created. Month-end revenue recognition at risk.', priority: 'P2', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdBI.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 40, resolvedDaysAgo: 39, tags: ['billing', 'vf04', 'revenue-recognition'] });
  await createTicket({ type: 'INCIDENT', title: 'Customer invoice showing incorrect tax amount — wrong tax code', description: 'Customer invoices for export deliveries showing 19% VAT instead of 0% (tax exempt). Tax code E0 not being determined for export sales area. 34 invoices need correction. Tax compliance risk.', priority: 'P1', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdBI.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 32, resolvedDaysAgo: 32, tags: ['tax', 'vat', 'invoice', 'compliance'] });
  await createTicket({ type: 'INCIDENT', title: 'Credit memo request blocked — approval workflow not triggering', description: 'Credit memo requests above EUR 5,000 not triggering required approval workflow. Reason: order reason 104 not included in release procedure Z_CREDIT. 8 credit memos stuck without approval.', priority: 'P2', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdBI.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 20, resolvedDaysAgo: 18, tags: ['credit-memo', 'approval', 'workflow'] });
  await createTicket({ type: 'CHANGE', title: 'Configure new billing type ZRE for consignment returns billing', description: 'Create new billing type ZRE for consignment return billing. Copy from standard RE, adjust account determination. Required for new consignment business with 3 key accounts. Transport DEVK900789.', priority: 'P3', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdBI.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 14, resolvedDaysAgo: 11, tags: ['billing-type', 'consignment', 'config'] });
  await createTicket({ type: 'INCIDENT', title: 'Invoice output RVINVOICE01 printing with wrong company address', description: 'Customer invoices printing with old company address (before relocation). Logo and address footer showing Dusseldorf address. Should show Munich. All invoices since 01.03.2026 affected.', priority: 'P3', status: 'NEW', moduleId: sdModule.id, subModuleId: sdBI.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 2, tags: ['invoice-output', 'smartform', 'address'] });

  // Pricing — 7 tickets (recurring pattern)
  await createTicket({ type: 'INCIDENT', title: 'Pricing condition PR00 not being determined for new material group', description: 'Sales orders for materials in new material group FERT-NEW showing zero net price. Condition type PR00 (base price) not found in pricing procedure ZVKPRO. New materials added last week without price master.', priority: 'P2', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdPC.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 60, resolvedDaysAgo: 58, tags: ['pricing', 'pr00', 'material-group', 'recurring'] });
  await createTicket({ type: 'INCIDENT', title: 'Customer-specific discount condition ZK01 expiring — urgent renewal', description: 'Customer-specific discount condition ZK01 for 12 key accounts expired 31.01.2026. Orders being placed without contracted discounts. Customer disputes incoming. EUR 45,000 revenue impact estimated.', priority: 'P1', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdPC.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 45, resolvedDaysAgo: 45, tags: ['pricing', 'discount', 'condition-expiry', 'recurring'] });
  await createTicket({ type: 'INCIDENT', title: 'Freight surcharge ZFRT applied twice on split deliveries', description: 'Freight condition ZFRT being applied twice when single sales order splits into multiple deliveries and invoices. Customers being double-charged for freight. 23 disputed invoices open.', priority: 'P2', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdPC.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 30, resolvedDaysAgo: 28, tags: ['pricing', 'freight', 'split-delivery', 'recurring'] });
  await createTicket({ type: 'INCIDENT', title: 'Price list not updating from approved pricing table — VK11 issue', description: 'Quarterly price list upload via VK11 not updating condition records for 340 materials. Records showing old Q4 2025 prices. Sales team quoting incorrect prices. Urgent — new price list effective today.', priority: 'P1', status: 'RESOLVED', moduleId: sdModule.id, subModuleId: sdPC.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 18, resolvedDaysAgo: 18, tags: ['pricing', 'vk11', 'price-list', 'recurring'] });
  await createTicket({ type: 'INCIDENT', title: 'Inter-company pricing condition PI01 not found — interco sales blocked', description: 'Intercompany sales from DE01 to US10 failing at billing. Condition PI01 (intercompany price) not determined in pricing procedure ZICPRO. Cross-border intercompany sales blocked.', priority: 'P2', status: 'IN_PROGRESS', moduleId: sdModule.id, subModuleId: sdPC.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 5, tags: ['pricing', 'intercompany', 'condition', 'recurring'] });
  await createTicket({ type: 'INCIDENT', title: 'Rebate agreement ZRB02 settlement not posting correct accruals', description: 'Rebate agreement type ZRB02 year-end settlement posting incorrect accrual amounts. Expected EUR 234,000 but system posting EUR 189,000. Rebate condition records appear correctly configured. Auditor query.', priority: 'P2', status: 'OPEN', moduleId: sdModule.id, subModuleId: sdPC.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 4, tags: ['rebate', 'accruals', 'year-end', 'recurring'] });
  await createTicket({ type: 'INCIDENT', title: 'Minimum order value surcharge ZMIN triggering incorrectly for framework orders', description: 'Minimum order value surcharge condition ZMIN (EUR 150 fee for orders < EUR 500) triggering on framework agreement call-off orders. Call-offs should be exempt. Customers disputing charges.', priority: 'P3', status: 'NEW', moduleId: sdModule.id, subModuleId: sdPC.id, agentId: sdAgent.id, createdById: endUser1.id, createdDaysAgo: 1, tags: ['pricing', 'surcharge', 'framework-orders', 'recurring'] });

  console.log('✅ SD tickets created (18)');
  console.log('📋 Creating PP tickets...');

  // ── PP TICKETS (14 total) ──────────────────────────────────

  // MRP — 8 tickets
  const ppMRPProblem = await createTicket({ type: 'PROBLEM', title: 'MRP generating excessive exception messages — investigation', description: 'MRP run generating 2,000+ exception messages daily for plant DE10. Majority are message type 10 (reschedule in) and 15 (reschedule out). Production planners spending 3+ hours daily processing exceptions. Root cause: MRP lot sizing configuration mismatch with actual production batch sizes.', priority: 'P2', status: 'IN_PROGRESS', moduleId: ppModule.id, subModuleId: ppMRP.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 14, tags: ['mrp', 'exception-messages', 'problem-management', 'planning'] });

  await createTicket({ type: 'INCIDENT', title: 'MRP run MD01 not generating planned orders for MRP type PD materials', description: 'MRP run not creating planned orders for 45 materials with MRP type PD (MRP). Materials show stock below safety stock level. Production line will stop in 3 days without intervention. Plant DE10.', priority: 'P1', status: 'RESOLVED', moduleId: ppModule.id, subModuleId: ppMRP.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 58, resolvedDaysAgo: 58, tags: ['mrp', 'planned-orders', 'stock-coverage'], parentProblemId: ppMRPProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'Planned order not being converted to production order — MRP error', description: 'MD04 showing planned orders but conversion to production order (CO40) failing. Error: "Work center DE10-WELD01 not found in routing for material MAT-200345". 12 production orders blocked.', priority: 'P2', status: 'RESOLVED', moduleId: ppModule.id, subModuleId: ppMRP.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 40, resolvedDaysAgo: 38, tags: ['planned-order', 'production-order', 'routing', 'work-center'], parentProblemId: ppMRPProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'MRP planning run taking 6+ hours — performance issue PRD system', description: 'Full MRP planning run (MD01) taking 6.5 hours in production vs expected 90 minutes. Blocking other background jobs. Month-end production planning delayed. ABAP performance trace shows table RESB causing bottleneck.', priority: 'P2', status: 'RESOLVED', moduleId: ppModule.id, subModuleId: ppMRP.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 26, resolvedDaysAgo: 24, tags: ['mrp', 'performance', 'background-job', 'table-resb'], parentProblemId: ppMRPProblem.id });
  await createTicket({ type: 'INCIDENT', title: 'Demand from sales order not reflected in MRP — SD-PP interface issue', description: 'Confirmed sales orders not creating demand in MRP. Individual customer requirements (strategy 40) not triggering replenishment planning. Related to SD-PP ToR issue logged in SD module. Cross-module issue.', priority: 'P2', status: 'IN_PROGRESS', moduleId: ppModule.id, subModuleId: ppMRP.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 6, tags: ['mrp', 'sd-pp-integration', 'tor', 'demand', 'recurring'], parentProblemId: ppMRPProblem.id });
  await createTicket({ type: 'REQUEST', title: 'Change MRP type from PD to VB for 34 C-class materials', description: 'Change MRP type from MRP (PD) to reorder point planning (VB) for 34 C-class materials per annual ABC analysis. Safety stock and reorder points defined in attached spreadsheet. Plant DE10 and DE20.', priority: 'P3', status: 'RESOLVED', moduleId: ppModule.id, subModuleId: ppMRP.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 21, resolvedDaysAgo: 19, tags: ['mrp-type', 'material-master', 'abc-analysis'] });
  await createTicket({ type: 'INCIDENT', title: 'MRP exception messages for rescheduling not clearing after action', description: 'Exception messages type 10 (reschedule in) persisting in MD04 even after planner has confirmed/actioned them. Background job MDRP_EXCEP not clearing processed exceptions. Planning board cluttered — 450+ uncleared messages.', priority: 'P3', status: 'OPEN', moduleId: ppModule.id, subModuleId: ppMRP.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 3, tags: ['mrp', 'exception-messages', 'recurring'], parentProblemId: ppMRPProblem.id });
  await createTicket({ type: 'CHANGE', title: 'Activate new MRP area for consignment warehouse DE10-CONS', description: 'Activate MRP area for consignment warehouse DE10-CONS. Separate MRP planning from main plant stock for 23 consignment materials. Configuration transport DEVK901234. Go-live 01.05.2026.', priority: 'P3', status: 'RESOLVED', moduleId: ppModule.id, subModuleId: ppMRP.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 10, resolvedDaysAgo: 7, tags: ['mrp-area', 'consignment', 'config', 'transport'] });

  // Production Orders — 6 tickets
  await createTicket({ type: 'INCIDENT', title: 'Production order confirmation CO11N blocking — work center capacity exceeded', description: 'Operators unable to confirm production order operations via CO11N. Error: "Capacity overload on work center DE10-ASSM02 exceeds 120% threshold". Capacity check should warn not block at shop floor level. 34 confirmations pending.', priority: 'P2', status: 'RESOLVED', moduleId: ppModule.id, subModuleId: ppPO.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 45, resolvedDaysAgo: 44, tags: ['production-order', 'confirmation', 'capacity', 'work-center'] });
  await createTicket({ type: 'INCIDENT', title: 'Backflushing not posting component consumption at order confirmation', description: 'Automatic backflush (movement type 261) not posting material consumption when production orders are confirmed. Components showing as still "reserved" but not consumed. Inventory balances incorrect. Affects COGS.', priority: 'P2', status: 'RESOLVED', moduleId: ppModule.id, subModuleId: ppPO.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 33, resolvedDaysAgo: 31, tags: ['backflush', 'component-consumption', 'production-order', 'inventory'] });
  await createTicket({ type: 'INCIDENT', title: 'Production order goods receipt posting wrong storage location', description: 'Production order goods receipt (movement type 101 from PP) posting finished goods to storage location DE10-LAG2 instead of DE10-FG (finished goods). Storage location determination in order incorrect. 12 orders affected.', priority: 'P2', status: 'IN_PROGRESS', moduleId: ppModule.id, subModuleId: ppPO.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 7, tags: ['production-order', 'goods-receipt', 'storage-location'] });
  await createTicket({ type: 'INCIDENT', title: 'Production order settlement KO88 failing — cost element not assigned', description: 'Production order period-end settlement failing for 23 orders. Error: "Cost element 620000 not assigned to settlement cost element in allocation structure Z1". Monthly cost of goods manufactured report incorrect.', priority: 'P2', status: 'OPEN', moduleId: ppModule.id, subModuleId: ppPO.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 2, tags: ['production-order', 'settlement', 'cost-element', 'month-end'] });
  await createTicket({ type: 'REQUEST', title: 'Create new work center DE10-ROB01 for robot welding cell', description: 'Create new work center DE10-ROB01 (robotic welding cell) in plant DE10. Capacity: 2 shifts x 8h. Cost center 100250. Activity type MACHINE. Assign to workcenter category Z003 (automated). Effective 01.05.2026.', priority: 'P3', status: 'RESOLVED', moduleId: ppModule.id, subModuleId: ppPO.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 13, resolvedDaysAgo: 11, tags: ['work-center', 'capacity', 'master-data'] });
  await createTicket({ type: 'CHANGE', title: 'Update BOM for finished good FG-100234 — new component revision', description: 'Update bill of materials for FG-100234 (Hydraulic Pump Assembly): replace component C-089034 rev A with rev B. ECN-2026-045 approved. Effective for production orders from 01.05.2026. Transport DEVK901567.', priority: 'P3', status: 'RESOLVED', moduleId: ppModule.id, subModuleId: ppPO.id, agentId: ppAgent.id, createdById: endUser2.id, createdDaysAgo: 8, resolvedDaysAgo: 6, tags: ['bom', 'engineering-change', 'component', 'transport'] });

  console.log('✅ PP tickets created (14)');

  // ── 14. Add comments to key tickets ──────────────────────
  const openTickets = await prisma.iTSMRecord.findMany({
    where: { tenantId: tenant.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    take: 10, orderBy: { createdAt: 'asc' },
  });

  for (const ticket of openTickets) {
    await prisma.comment.create({
      data: {
        recordId: ticket.id,
        authorId: ficoAgent.id,
        text: 'Initial investigation complete. Root cause identified. Working on fix — ETA 4 hours.',
        internalFlag: true,
        createdAt: new Date(ticket.createdAt.getTime() + 3600000),
      },
    });
  }

  console.log('✅ Comments added to open tickets');

  // ── 15. Summary ───────────────────────────────────────────
  const totalTickets = await prisma.iTSMRecord.count({ where: { tenantId: tenant.id } });
  const byModule = await prisma.iTSMRecord.groupBy({
    by: ['sapModuleId'], where: { tenantId: tenant.id }, _count: true,
  });

  console.log('\n🎉 AMS Seed Complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Client:  GlobalManufacturing AG`);
  console.log(`  Tickets: ${totalTickets} total`);
  console.log(`  Modules: FICO (28) · MM (22) · SD (18) · PP (14)`);
  console.log('');
  console.log('  Intelligence patterns built in:');
  console.log('  ✓ FICO/AP — 7 recurring F110 failures → knowledge gap');
  console.log('  ✓ MM/GR  — 5 recurring GR errors → pattern detected');
  console.log('  ✓ SD/PC  — 7 recurring pricing issues → pattern detected');
  console.log('  ✓ PP/MRP — Problem record + 5 linked incidents');
  console.log('  ✓ Problem records for FICO-AP, MM-GR, PP-MRP');
  console.log('');
  console.log('  Login credentials (password: Admin@123456)');
  console.log('  ─────────────────────────────────────────');
  console.log('  Super Admin  : admin@intraedge.com');
  console.log('  Project Mgr  : priya.sharma@intraedge.com');
  console.log('  FICO Agent   : rajesh.kumar@intraedge.com');
  console.log('  MM Agent     : anitha.reddy@intraedge.com');
  console.log('  SD Agent     : vikram.nair@intraedge.com');
  console.log('  PP Agent     : deepa.menon@intraedge.com');
  console.log('  Company Admin: it.admin@globalmanufacturing.de');
  console.log('  End User 1   : finance.user@globalmanufacturing.de');
  console.log('  End User 2   : procurement.user@globalmanufacturing.de');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error('❌ Seed failed:', e); prisma.$disconnect(); process.exit(1); });

export { main as seedAmsData };
