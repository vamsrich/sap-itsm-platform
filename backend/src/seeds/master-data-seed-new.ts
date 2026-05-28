/**
 * Master Data Seed v1 — single-file, idempotent, re-runnable.
 *
 * Run:
 *   cd backend
 *   set -a && source .env.seedrun && set +a && npx ts-node src/seeds/master-data-seed-new.ts
 *
 * What this does:
 *   1. Updates existing GlobalManufacturing AG → Inc, country US, Eastern timezone
 *   2. Creates US 2026 + India 2026 holiday calendars (19 dates)
 *   3. Renames existing IST shift → India Day Shift; adds 2 PM IST, US East, 24x7
 *   4. Creates 5 Support Type tiers (STD/STD-PLUS/PREM/PREM-PLUS/ON-CALL); deactivates EXT-PLUS
 *   5. Creates 4 SLA Policy tiers (GOLD/SILVER/BRONZE/BRONZE-P1); deactivates GOLD-AMS
 *   6. Updates contract CON-2026-GLAG-001 to PREM-PLUS + SILVER-STD + 2 PM IST + US 2026
 *   7. Sets Agent.shiftId for the 5 AMS agents (PM on India Day, 4 specialists on 2 PM IST)
 *   8. Creates 4 AssignmentRules (one per SAP module, AUTO_ASSIGN to L3 specialists)
 *
 * This file is the canonical master-data seed source referenced by CLAUDE.md.
 * See docs/design/master-data-seed-v1.md for design details.
 *
 * NOT auto-on-boot. Standalone CLI only. Re-runnable safely.
 *
 * NOTE: P1 PM-notify rule was dropped — AssignmentRule.assignmentMode supports
 * AUTO_ASSIGN/RECOMMEND/ROUND_ROBIN only, not NOTIFY_ONLY. P1 PM notification
 * belongs in NotificationRule (separate model with 34 live rows already).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🌱 Master Data Seed v1\n');

  const tenant = await prisma.tenant.findFirst({ where: { slug: 'intraedge' } });
  if (!tenant) throw new Error("Tenant 'intraedge' not found");
  console.log(`Tenant: ${tenant.name}`);

  // ═══ 1. Customer in-place update ════════════════════════════════════════════
  let customer = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, companyName: { in: ['GlobalManufacturing AG', 'GlobalManufacturing Inc'] } },
  });
  if (!customer) throw new Error('GlobalManufacturing customer not found');
  customer = await prisma.customer.update({
    where: { id: customer.id },
    data: { companyName: 'GlobalManufacturing Inc', country: 'US', timezone: 'America/New_York' },
  });
  console.log('✅ Customer → GlobalManufacturing Inc, US, America/New_York');

  // ═══ 2. Holiday Calendars ═══════════════════════════════════════════════════
  const usCal = await upsertHolidayCalendar(tenant.id, 'US 2026', 'US', 2026);
  await ensureHolidayDates(usCal.id, [
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
    { date: '2026-02-16', name: "Presidents' Day" },
    { date: '2026-05-25', name: 'Memorial Day' },
    { date: '2026-06-19', name: 'Juneteenth' },
    { date: '2026-07-03', name: 'Independence Day (observed)' },
    { date: '2026-09-07', name: 'Labor Day' },
    { date: '2026-10-12', name: 'Columbus Day' },
    { date: '2026-11-11', name: 'Veterans Day' },
    { date: '2026-11-26', name: 'Thanksgiving' },
    { date: '2026-12-25', name: 'Christmas Day' },
  ]);
  console.log('✅ Holiday Calendar: US 2026 (11 dates)');

  const inCal = await upsertHolidayCalendar(tenant.id, 'India 2026', 'IN', 2026);
  await ensureHolidayDates(inCal.id, [
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-03-04', name: 'Holi' },
    { date: '2026-03-21', name: 'Eid al-Fitr (approximate)' },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-11-08', name: 'Diwali' },
    { date: '2026-12-25', name: 'Christmas Day' },
  ]);
  console.log('✅ Holiday Calendar: India 2026 (8 dates)');

  // ═══ 3. Shifts ══════════════════════════════════════════════════════════════
  // Rename existing IST Business Hours → India Day Shift (preserves shift id)
  const istShift = await prisma.shift.findFirst({ where: { tenantId: tenant.id, name: 'IST Business Hours' } });
  if (istShift) {
    await prisma.shift.update({ where: { id: istShift.id }, data: { name: 'India Day Shift' } });
    console.log('✅ Renamed IST Business Hours → India Day Shift');
  }

  const indDayShift = await upsertShift(tenant.id, 'India Day Shift', '09:00', '18:00', 'Asia/Kolkata', 60);
  const ind2pmShift = await upsertShift(tenant.id, '2 PM IST Shift', '14:00', '23:00', 'Asia/Kolkata', 60);
  await upsertShift(tenant.id, 'US East Day Shift', '09:00', '18:00', 'America/New_York', 60);
  await upsertShift(tenant.id, '24x7 Coverage', '00:00', '23:59', 'UTC', 0);
  console.log('✅ Shifts: 4 total (India Day, 2 PM IST, US East, 24x7)');

  // ═══ 4. Support Types ═══════════════════════════════════════════════════════
  await prisma.supportTypeMaster.updateMany({
    where: { tenantId: tenant.id, code: 'EXT-PLUS' },
    data: { isActive: false },
  });

  await upsertSupportType(tenant.id, 'STD', 'Standard', {
    description: 'Business-hours support, weekdays only',
    workDays: [1, 2, 3, 4, 5],
    weekendCoverage: 'NONE',
    holidayCoverage: 'NONE',
    afterHoursCoverage: 'NONE',
    weekendMultiplier: 1,
    holidayMultiplier: 1,
    afterHoursMultiplier: 1,
    slaPauseConditions: ['PENDING_CUSTOMER', 'OUTSIDE_BUSINESS_HOURS', 'WEEKEND', 'HOLIDAY'],
    onCallPriorities: [],
    priorityScope: 'ALL',
    slaEnabled: { P1: true, P2: true, P3: true, P4: true },
  });

  await upsertSupportType(tenant.id, 'STD-PLUS', 'Standard Plus', {
    description: 'Business-hours + after-hours on-call for P1',
    workDays: [1, 2, 3, 4, 5],
    weekendCoverage: 'NONE',
    holidayCoverage: 'NONE',
    afterHoursCoverage: 'ON_CALL',
    weekendMultiplier: 1,
    holidayMultiplier: 1,
    afterHoursMultiplier: 1.5,
    slaPauseConditions: ['PENDING_CUSTOMER', 'WEEKEND', 'HOLIDAY'],
    onCallPriorities: ['P1'],
    priorityScope: 'ALL',
    slaEnabled: { P1: true, P2: true, P3: true, P4: true },
  });

  await upsertSupportType(tenant.id, 'PREM', 'Premium', {
    description: '6-day support + after-hours on-call P1/P2',
    workDays: [1, 2, 3, 4, 5, 6],
    weekendCoverage: 'ON_CALL',
    holidayCoverage: 'NONE',
    afterHoursCoverage: 'ON_CALL',
    weekendMultiplier: 1.5,
    holidayMultiplier: 2,
    afterHoursMultiplier: 1.5,
    slaPauseConditions: ['PENDING_CUSTOMER', 'HOLIDAY'],
    onCallPriorities: ['P1', 'P2'],
    priorityScope: 'ALL',
    slaEnabled: { P1: true, P2: true, P3: true, P4: true },
  });

  const premPlus = await upsertSupportType(tenant.id, 'PREM-PLUS', 'Premium Plus', {
    description: '6-day full + 24/7 on-call for P1/P2 + holiday coverage',
    workDays: [1, 2, 3, 4, 5, 6],
    weekendCoverage: 'ON_CALL',
    holidayCoverage: 'ON_CALL',
    afterHoursCoverage: 'ON_CALL',
    weekendMultiplier: 1.5,
    holidayMultiplier: 1.5,
    afterHoursMultiplier: 1.25,
    slaPauseConditions: ['PENDING_CUSTOMER'],
    onCallPriorities: ['P1', 'P2'],
    priorityScope: 'ALL',
    slaEnabled: { P1: true, P2: true, P3: true, P4: true },
  });

  await upsertSupportType(tenant.id, 'ON-CALL', 'On-Call (24/7)', {
    description: '24/7 coverage for all priorities',
    workDays: [1, 2, 3, 4, 5, 6, 7],
    weekendCoverage: 'ON_CALL',
    holidayCoverage: 'ON_CALL',
    afterHoursCoverage: 'ON_CALL',
    weekendMultiplier: 1,
    holidayMultiplier: 1,
    afterHoursMultiplier: 1,
    slaPauseConditions: ['PENDING_CUSTOMER'],
    onCallPriorities: ['P1', 'P2', 'P3', 'P4'],
    priorityScope: 'ALL',
    slaEnabled: { P1: true, P2: true, P3: true, P4: true },
  });
  console.log('✅ Support Types: 5 active (EXT-PLUS deactivated)');

  // ═══ 5. SLA Policies ════════════════════════════════════════════════════════
  await prisma.sLAPolicyMaster.updateMany({
    where: { tenantId: tenant.id, code: 'GOLD-AMS' },
    data: { isActive: false },
  });

  await upsertSLAPolicy(tenant.id, 'GOLD-STD', 'Gold Standard', '#fbbf24', {
    P1: { response: 15, resolution: 240 },
    P2: { response: 60, resolution: 480 },
    P3: { response: 240, resolution: 1440 },
    P4: { response: 480, resolution: 2880 },
  });

  const silver = await upsertSLAPolicy(tenant.id, 'SILVER-STD', 'Silver Standard', '#94a3b8', {
    P1: { response: 60, resolution: 480 },
    P2: { response: 240, resolution: 1440 },
    P3: { response: 480, resolution: 4320 },
    P4: { response: 1440, resolution: 7200 },
  });

  await upsertSLAPolicy(tenant.id, 'BRONZE-STD', 'Bronze Standard', '#cd7f32', {
    P1: { response: 240, resolution: 1440 },
    P2: { response: 480, resolution: 2880 },
    P3: { response: 1440, resolution: 7200 },
    P4: { response: 2880, resolution: 14400 },
  });

  await upsertSLAPolicy(tenant.id, 'BRONZE-P1', 'Bronze P1-Only', '#cd7f32', {
    P1: { response: 240, resolution: 1440 },
    // P2-P4 absent — slaApplies() returns false; no slaTracking row created (verified)
  });
  console.log('✅ SLA Policies: 4 active (GOLD-AMS deactivated)');

  // ═══ 6. Contract update ═════════════════════════════════════════════════════
  const contract = await prisma.contract.findFirst({ where: { contractNumber: 'CON-2026-GLAG-001' } });
  if (!contract) throw new Error('Contract CON-2026-GLAG-001 not found');

  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      supportTypeMasterId: premPlus.id,
      slaPolicyMasterId: silver.id,
      currency: 'USD',
    },
  });

  // ContractShift: replace existing with 2 PM IST
  await prisma.contractShift.deleteMany({ where: { contractId: contract.id } });
  await prisma.contractShift.create({ data: { contractId: contract.id, shiftId: ind2pmShift.id } });

  // ContractHolidayCalendar: ensure US 2026 link exists
  const existingHCLink = await prisma.contractHolidayCalendar.findFirst({
    where: { contractId: contract.id, holidayCalendarId: usCal.id },
  });
  if (!existingHCLink) {
    await prisma.contractHolidayCalendar.create({
      data: { contractId: contract.id, holidayCalendarId: usCal.id },
    });
  }
  console.log('✅ Contract CON-2026-GLAG-001 → PREM-PLUS + SILVER-STD + 2 PM IST + US 2026 + USD');

  // ═══ 7. Agent shift assignments ═════════════════════════════════════════════
  const agentShifts: { email: string; shiftId: string }[] = [
    { email: 'priya.sharma@intraedge.com', shiftId: indDayShift.id },
    { email: 'rajesh.kumar@intraedge.com', shiftId: ind2pmShift.id },
    { email: 'anitha.reddy@intraedge.com', shiftId: ind2pmShift.id },
    { email: 'vikram.nair@intraedge.com', shiftId: ind2pmShift.id },
    { email: 'deepa.menon@intraedge.com', shiftId: ind2pmShift.id },
  ];
  let assigned = 0;
  for (const a of agentShifts) {
    const user = await prisma.user.findUnique({ where: { email: a.email } });
    if (!user) {
      console.log(`⚠️  User ${a.email} not found — skipping`);
      continue;
    }
    const updated = await prisma.agent.updateMany({
      where: { userId: user.id },
      data: { shiftId: a.shiftId },
    });
    assigned += updated.count;
  }
  console.log(`✅ Agent shifts assigned (${assigned}/5)`);

  // ═══ 8. Assignment Rules (5 module-routing rules: FI/CO/MM/SD/PP) ═══════════
  const sapModules = await prisma.moduleMaster.findMany({
    where: { tenantId: tenant.id, code: { in: ['FI', 'CO', 'MM', 'SD', 'PP'] } },
  });
  const moduleByCode = new Map(sapModules.map((m) => [m.code, m]));

  for (const code of ['FI', 'CO', 'MM', 'SD', 'PP']) {
    const mod = moduleByCode.get(code);
    if (!mod) {
      console.log(`⚠️  SAP Module ${code} not found — skipping rule`);
      continue;
    }
    await upsertAssignmentRule({
      tenantId: tenant.id,
      customerId: customer.id,
      moduleId: mod.id,
      name: `${code} module routing → L3 specialist`,
      recordType: 'INCIDENT',
      assignmentMode: 'AUTO_ASSIGN',
      preferredLevel: 'L3',
    });
  }
  console.log('✅ Assignment Rules: 5 module-routing rules (FI/CO/MM/SD/PP → L3 specialists)');

  console.log('\n🎉 Master Data Seed v1 complete\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function upsertHolidayCalendar(tenantId: string, name: string, country: string, year: number) {
  const existing = await prisma.holidayCalendar.findFirst({ where: { tenantId, name, year } });
  if (existing) {
    return prisma.holidayCalendar.update({
      where: { id: existing.id },
      data: { country, isActive: true },
    });
  }
  return prisma.holidayCalendar.create({
    data: { tenantId, name, country, year, isActive: true },
  });
}

async function ensureHolidayDates(calendarId: string, dates: { date: string; name: string }[]) {
  for (const d of dates) {
    const dateObj = new Date(d.date);
    const existing = await prisma.holidayDate.findFirst({
      where: { calendarId, date: dateObj },
    });
    if (!existing) {
      await prisma.holidayDate.create({
        data: { calendarId, date: dateObj, name: d.name },
      });
    } else if (existing.name !== d.name) {
      await prisma.holidayDate.update({ where: { id: existing.id }, data: { name: d.name } });
    }
  }
}

async function upsertShift(
  tenantId: string,
  name: string,
  startTime: string,
  endTime: string,
  timezone: string,
  breakMinutes: number,
) {
  const existing = await prisma.shift.findFirst({ where: { tenantId, name } });
  if (existing) {
    return prisma.shift.update({
      where: { id: existing.id },
      data: { startTime, endTime, timezone, breakMinutes, status: 'active' },
    });
  }
  return prisma.shift.create({
    data: { tenantId, name, startTime, endTime, timezone, breakMinutes, status: 'active' },
  });
}

async function upsertSupportType(tenantId: string, code: string, name: string, fields: Record<string, unknown>) {
  const existing = await prisma.supportTypeMaster.findFirst({ where: { tenantId, code } });
  const data: any = { tenantId, code, name, isActive: true, ...fields };
  if (existing) {
    return prisma.supportTypeMaster.update({ where: { id: existing.id }, data });
  }
  return prisma.supportTypeMaster.create({ data });
}

async function upsertSLAPolicy(
  tenantId: string,
  code: string,
  name: string,
  color: string,
  priorities: Record<string, { response: number; resolution: number }>,
) {
  const existing = await prisma.sLAPolicyMaster.findFirst({ where: { tenantId, code } });
  const data: any = {
    tenantId,
    code,
    name,
    color,
    warningThreshold: 0.8,
    priorities,
    isActive: true,
  };
  if (existing) {
    return prisma.sLAPolicyMaster.update({ where: { id: existing.id }, data });
  }
  return prisma.sLAPolicyMaster.create({ data });
}

async function upsertAssignmentRule(args: {
  tenantId: string;
  customerId: string;
  moduleId: string;
  name: string;
  recordType: string;
  assignmentMode: string;
  preferredLevel: string;
}) {
  const existing = await prisma.assignmentRule.findFirst({
    where: {
      tenantId: args.tenantId,
      customerId: args.customerId,
      moduleId: args.moduleId,
      recordType: args.recordType,
    },
  });
  const data = {
    tenantId: args.tenantId,
    customerId: args.customerId,
    moduleId: args.moduleId,
    name: args.name,
    recordType: args.recordType,
    assignmentMode: args.assignmentMode,
    preferredLevel: args.preferredLevel,
    sortOrder: 0,
    isActive: true,
  };
  if (existing) {
    return prisma.assignmentRule.update({ where: { id: existing.id }, data });
  }
  return prisma.assignmentRule.create({ data });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('❌ Master seed failed:', e);
    prisma.$disconnect();
    process.exit(1);
  });
