/**
 * Issue Template service — Phase 1
 *
 * Two responsibilities:
 *
 *   1. Bootstrap — upsert factory-default templates into a tenant's
 *      IssueTemplate table on backend boot. Idempotent. Preserves SA edits
 *      (manuallyEdited=true) untouched.
 *
 *   2. Matching — given a list of tickets and the active templates, classify
 *      each ticket against the templates (Pass 1) and Jaccard-cluster the
 *      remainder (Pass 2).
 *
 * No HTTP / route concerns live here.
 */

import { prisma } from '../config/database';
import { SEED_TEMPLATES, SeedTemplate } from './issue-templates.seed';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchableTicket {
  id: string;
  recordNumber: string;
  title: string;
  priority: string | null;
  status: string;
  createdAt: Date;
  module: string | null;
  subModule: string | null;
}

export interface DbTemplate {
  id: string;
  templateKey: string;
  module: string;
  subModule: string | null;
  label: string;
  must: string[][];
  boost: string[];
  not: string[];
}

export interface TemplatePattern {
  kind: 'template';
  templateId: string;
  templateKey: string;
  label: string;
  module: string;
  subModule: string | null;
  count: number;
  severity: 'low' | 'medium' | 'high';
  hasProblemRecord: boolean;
  samples: SampleTicket[];
}

export interface EmergentPattern {
  kind: 'emergent';
  label: string;
  module: string;
  subModule: null;
  count: number;
  severity: 'low' | 'medium' | 'high';
  hasProblemRecord: boolean;
  tokens: string[];
  samples: SampleTicket[];
}

export type Pattern = TemplatePattern | EmergentPattern;

export interface SampleTicket {
  id: string;
  recordNumber: string;
  title: string;
  priority: string | null;
  status: string;
  createdAt: Date;
}

export interface BootstrapResult {
  tenantId: string;
  created: number;
  updated: number;
  skipped: number;
  total: number;
}

// ── Pass 1: Template matching ─────────────────────────────────────────────────

interface ClassifyResult {
  byTemplate: Map<string, MatchableTicket[]>;
  unclassified: MatchableTicket[];
}

export function classifyTickets(tickets: MatchableTicket[], templates: DbTemplate[]): ClassifyResult {
  const byTemplate = new Map<string, MatchableTicket[]>();
  const unclassified: MatchableTicket[] = [];

  // Group templates by module for fast lookup
  const tplByModule = new Map<string, DbTemplate[]>();
  for (const tpl of templates) {
    if (!tplByModule.has(tpl.module)) tplByModule.set(tpl.module, []);
    tplByModule.get(tpl.module)!.push(tpl);
  }

  for (const t of tickets) {
    if (!t.module) {
      unclassified.push(t);
      continue;
    }
    const text = (t.title || '').toLowerCase();
    const candidates = tplByModule.get(t.module) || [];

    let best: { tpl: DbTemplate; confidence: number } | null = null;

    for (const tpl of candidates) {
      // Negative gate
      if (tpl.not.length > 0 && tpl.not.some((neg) => text.includes(neg))) continue;

      // Required gate: every must group has ≥1 hit
      const allMatch = tpl.must.every((group) => group.some((kw) => text.includes(kw)));
      if (!allMatch) continue;

      // Confidence: 1 base + 0.25 per boost hit
      const confidence = 1 + 0.25 * tpl.boost.filter((b) => text.includes(b)).length;

      if (!best || confidence > best.confidence) {
        best = { tpl, confidence };
      }
    }

    if (best) {
      const key = best.tpl.id;
      if (!byTemplate.has(key)) byTemplate.set(key, []);
      byTemplate.get(key)!.push(t);
    } else {
      unclassified.push(t);
    }
  }

  return { byTemplate, unclassified };
}

// ── Pass 2: Jaccard clustering on unclassified ────────────────────────────────

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'for',
  'to',
  'in',
  'on',
  'at',
  'of',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'not',
  'no',
  'with',
  'from',
  'by',
  'as',
  'this',
  'that',
  'it',
  'be',
  'been',
  'being',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'can',
  'could',
  'should',
  'may',
  'might',
  'must',
  'i',
  'we',
  'you',
  'they',
  'our',
  'their',
  'my',
  'your',
  'his',
  'her',
  'its',
  // Domain-noisy stopwords (likely to appear in many incident titles)
  'ticket',
  'issue',
  'error',
  'fail',
  'failing',
  'failed',
  'please',
  'help',
  'need',
  'urgent',
  'working',
  'work',
  'new',
  'wrong',
  'incorrect',
  'into',
  'with',
  'without',
  'when',
  'after',
  'before',
]);

function significantTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3)
      .filter((t) => !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface EmergentCluster {
  module: string;
  tickets: MatchableTicket[];
  tokens: string[];
}

export function clusterUnclassified(
  unclassified: MatchableTicket[],
  threshold = 0.5,
  minSize = 3,
): EmergentCluster[] {
  const clusters: EmergentCluster[] = [];

  // Group by module — never cluster across modules
  const byModule = new Map<string, MatchableTicket[]>();
  for (const t of unclassified) {
    const m = t.module || 'UNKNOWN';
    if (!byModule.has(m)) byModule.set(m, []);
    byModule.get(m)!.push(t);
  }

  for (const [moduleCode, tickets] of byModule) {
    if (tickets.length < minSize) continue;

    const tokens = tickets.map((t) => significantTokens(t.title));

    // Single-link transitive clustering via union-find
    const parent = tickets.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

    for (let i = 0; i < tickets.length; i++) {
      for (let j = i + 1; j < tickets.length; j++) {
        if (jaccard(tokens[i], tokens[j]) >= threshold) {
          parent[find(j)] = find(i);
        }
      }
    }

    // Group by root
    const groups = new Map<number, number[]>();
    for (let i = 0; i < tickets.length; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(i);
    }

    for (const indices of groups.values()) {
      if (indices.length < minSize) continue;
      // Cluster tokens = intersection of all members' tokens
      let shared = new Set(tokens[indices[0]]);
      for (let k = 1; k < indices.length; k++) {
        const next = tokens[indices[k]];
        const inter = new Set<string>();
        for (const x of shared) if (next.has(x)) inter.add(x);
        shared = inter;
      }
      const topTokens = [...shared].slice(0, 3);
      clusters.push({
        module: moduleCode,
        tickets: indices.map((i) => tickets[i]),
        tokens: topTokens,
      });
    }
  }

  return clusters;
}

// ── Severity bucket (shared between template and emergent patterns) ───────────

export function severityFor(count: number): 'low' | 'medium' | 'high' {
  if (count >= 8) return 'high';
  if (count >= 5) return 'medium';
  return 'low';
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Upsert SEED_TEMPLATES into the given tenant's IssueTemplate table.
 *
 * Idempotency rules:
 *   - Row absent → INSERT (counter: created)
 *   - Row exists, isSystemSeed=true, manuallyEdited=false → UPDATE from current seed (counter: updated)
 *   - Row exists, manuallyEdited=true → leave alone (counter: skipped, Phase-2 flag)
 *
 * Returns counters for logging.
 */
export async function bootstrapIssueTemplates(tenantId: string): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    tenantId,
    created: 0,
    updated: 0,
    skipped: 0,
    total: SEED_TEMPLATES.length,
  };

  for (const seed of SEED_TEMPLATES) {
    const existing = await prisma.issueTemplate.findUnique({
      where: { tenantId_templateKey: { tenantId, templateKey: seed.templateKey } },
    });

    if (!existing) {
      await prisma.issueTemplate.create({
        data: buildSeedRow(seed, tenantId),
      });
      result.created++;
    } else if (existing.isSystemSeed && !existing.manuallyEdited) {
      await prisma.issueTemplate.update({
        where: { id: existing.id },
        data: buildSeedRow(seed, tenantId),
      });
      result.updated++;
    } else {
      result.skipped++;
    }
  }

  return result;
}

function buildSeedRow(seed: SeedTemplate, tenantId: string) {
  return {
    tenantId,
    enterpriseSystemId: null,
    module: seed.module,
    subModule: seed.subModule ?? null,
    templateKey: seed.templateKey,
    label: seed.label,
    must: seed.must,
    boost: seed.boost ?? [],
    not: seed.not ?? [],
    isActive: true,
    isSystemSeed: true,
    manuallyEdited: false,
  };
}

// ── DB → in-memory shape coercion ─────────────────────────────────────────────

/**
 * Coerces a Prisma IssueTemplate row (with Json fields typed as `any`) into
 * the strongly-typed DbTemplate shape used by the matcher.
 */
export function toDbTemplate(row: {
  id: string;
  templateKey: string;
  module: string;
  subModule: string | null;
  label: string;
  must: any;
  boost: any;
  not: any;
}): DbTemplate {
  return {
    id: row.id,
    templateKey: row.templateKey,
    module: row.module,
    subModule: row.subModule,
    label: row.label,
    must: Array.isArray(row.must) ? (row.must as string[][]) : [],
    boost: Array.isArray(row.boost) ? (row.boost as string[]) : [],
    not: Array.isArray(row.not) ? (row.not as string[]) : [],
  };
}
