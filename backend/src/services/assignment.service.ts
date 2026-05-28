import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface ScoringWeights {
  moduleWeight: number;
  subModuleWeight: number;
  levelWeight: number;
  workloadWeight: number;
  availabilityWeight: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  moduleWeight: 30,
  subModuleWeight: 20,
  levelWeight: 25,
  workloadWeight: 15,
  availabilityWeight: 10,
};

interface AgentScore {
  agentId: string;
  agentName: string;
  level: string;
  moduleMatch: number;
  subModuleMatch: number;
  levelScore: number;
  workloadScore: number;
  availabilityScore: number;
  totalScore: number;
  openTickets: number;
  maxConcurrent: number;
  status: string;
}

// Level priority mapping: P1→L4/L3 best, P4→L1/L2 best.
// Returns a 0..1 multiplier applied to the configured levelWeight.
const LEVEL_PRIORITY_MULTIPLIERS: Record<string, Record<string, number>> = {
  P1: { L4: 1.0, L3: 0.8, L2: 0.4, L1: 0.2 },
  P2: { L4: 0.8, L3: 1.0, L2: 0.6, L1: 0.2 },
  P3: { L4: 0.2, L3: 0.4, L2: 1.0, L1: 0.8 },
  P4: { L4: 0.2, L3: 0.2, L2: 0.8, L1: 1.0 },
};

// Resolve scoring weights for (customerId, ticketPriority).
// Order: (customer, priority) → (customer, 'ALL') → hardcoded fallback.
export async function resolveScoringConfig(
  customerId: string,
  ticketPriority: string,
): Promise<ScoringWeights> {
  const rows = await prisma.assignmentScoringConfig.findMany({
    where: { customerId, priority: { in: [ticketPriority, 'ALL'] } },
  });
  const specific = rows.find((r) => r.priority === ticketPriority);
  const fallback = rows.find((r) => r.priority === 'ALL');
  const chosen = specific || fallback;
  if (!chosen) return DEFAULT_SCORING_WEIGHTS;
  return {
    moduleWeight: chosen.moduleWeight,
    subModuleWeight: chosen.subModuleWeight,
    levelWeight: chosen.levelWeight,
    workloadWeight: chosen.workloadWeight,
    availabilityWeight: chosen.availabilityWeight,
  };
}

export async function findMatchingRule(params: {
  tenantId: string;
  customerId: string;
  recordType: string;
  priority: string;
  moduleId?: string | null;
}) {
  const { tenantId, customerId, recordType, priority, moduleId } = params;

  // Find matching rules ordered by specificity (most specific first)
  const rules = await prisma.assignmentRule.findMany({
    where: {
      tenantId,
      customerId,
      isActive: true,
    },
    include: {
      customer: { select: { companyName: true } },
      module: { select: { code: true, name: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  // Score rules by specificity and find best match
  for (const rule of rules) {
    const typeMatch = !rule.recordType || rule.recordType === recordType;
    const priorityMatch = !rule.priority || rule.priority === priority;
    const moduleMatch = !rule.moduleId || rule.moduleId === moduleId;

    if (typeMatch && priorityMatch && moduleMatch) {
      return rule;
    }
  }

  return null;
}

export async function scoreAgents(params: {
  tenantId: string;
  customerId: string;
  priority: string;
  moduleId?: string | null;
  subModuleId?: string | null;
  preferredLevel?: string | null;
  weights?: ScoringWeights;
}): Promise<AgentScore[]> {
  const { tenantId, customerId, priority, moduleId, subModuleId, preferredLevel } = params;
  const weights = params.weights ?? (await resolveScoringConfig(customerId, priority));

  // Get agents assigned to this customer
  const customerAgents = await prisma.customerAgent.findMany({
    where: { customerId },
    select: { agentId: true },
  });
  const agentIds = customerAgents.map((ca) => ca.agentId);

  if (agentIds.length === 0) return [];

  // Load agent details with specializations and open ticket counts
  const agents = await prisma.agent.findMany({
    where: {
      id: { in: agentIds },
      user: { tenantId, status: 'ACTIVE' },
      agentType: 'AGENT',
    },
    include: {
      user: { select: { firstName: true, lastName: true } },
      specializations: { select: { moduleId: true, subModuleIds: true } },
      _count: {
        select: {
          assignments: {
            where: { status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] } },
          },
        },
      },
    },
  });

  const scores: AgentScore[] = agents.map((agent) => {
    // Module match — full weight if agent specializes in the ticket's module.
    let moduleMatch = 0;
    if (moduleId) {
      const spec = agent.specializations.find((s) => s.moduleId === moduleId);
      if (spec) moduleMatch = weights.moduleWeight;
    }

    // Sub-module match — full weight if agent specializes in the sub-module.
    let subModuleMatch = 0;
    if (moduleId && subModuleId) {
      const spec = agent.specializations.find((s) => s.moduleId === moduleId);
      if (spec && spec.subModuleIds.includes(subModuleId)) subModuleMatch = weights.subModuleWeight;
    }

    // Level score — fractional weight based on level-vs-priority/preference fit.
    let levelMultiplier: number;
    if (preferredLevel) {
      const distance = Math.abs(
        ['L1', 'L2', 'L3', 'L4'].indexOf(agent.level) - ['L1', 'L2', 'L3', 'L4'].indexOf(preferredLevel),
      );
      levelMultiplier = distance === 0 ? 1.0 : distance === 1 ? 0.6 : 0.2;
    } else {
      levelMultiplier = LEVEL_PRIORITY_MULTIPLIERS[priority]?.[agent.level] ?? 0.4;
    }
    const levelScore = Math.round(weights.levelWeight * levelMultiplier);

    // Workload — full weight at 0% util, 0 at >=100% util.
    const openTickets = (agent._count as any).assignments || 0;
    const maxC = agent.maxConcurrent || 5;
    const utilizationPct = openTickets / maxC;
    const workloadScore =
      utilizationPct >= 1.0 ? 0 : Math.round((1 - utilizationPct) * weights.workloadWeight);

    // Availability — full weight when AVAILABLE, half when BUSY, 0 OFFLINE.
    const availabilityScore =
      agent.status === 'AVAILABLE'
        ? weights.availabilityWeight
        : agent.status === 'BUSY'
          ? Math.round(weights.availabilityWeight / 2)
          : 0;

    const totalScore = moduleMatch + subModuleMatch + levelScore + workloadScore + availabilityScore;

    return {
      agentId: agent.id,
      agentName: `${agent.user.firstName} ${agent.user.lastName}`,
      level: agent.level,
      moduleMatch,
      subModuleMatch,
      levelScore,
      workloadScore,
      availabilityScore,
      totalScore,
      openTickets,
      maxConcurrent: maxC,
      status: agent.status,
    };
  });

  // Sort by total score descending, then by workload (fewer tickets first for tie-breaking)
  scores.sort((a, b) => b.totalScore - a.totalScore || a.openTickets - b.openTickets);

  return scores;
}

// Round-robin: pick the agent with fewest open tickets (simple load balancing)
export async function roundRobinAgent(params: {
  tenantId: string;
  customerId: string;
  moduleId?: string | null;
}): Promise<AgentScore | null> {
  const scores = await scoreAgents({
    ...params,
    priority: 'P3', // neutral priority for round-robin
  });

  // Filter to available agents only, sort by workload
  const available = scores.filter((s) => s.status !== 'OFFLINE' && s.openTickets < s.maxConcurrent);
  if (available.length === 0) return null;

  // Sort by open tickets ascending (least loaded first)
  available.sort((a, b) => a.openTickets - b.openTickets);
  return available[0];
}
