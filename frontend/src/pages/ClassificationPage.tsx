import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  AlertTriangle,
  TrendingUp,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Lightbulb,
  Activity,
  Clock,
  Zap,
  Users,
  Inbox,
  TrendingDown,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { analyticsApi } from '../api/services';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { PriorityBadge, StatusBadge } from '../components/ui/Badges';
import { PageHeader, Card, StatCard } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import { renderPieLabel } from '../components/charts/renderPieLabel';
import { formatDistanceToNow } from 'date-fns';

const PIE_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6', '#f97316', '#06b6d4'];
const PERIOD_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 60 days', value: 60 },
  { label: 'Last 90 days', value: 90 },
];

type Tab = 'classification' | 'patterns' | 'bottlenecks' | 'gaps';
type Drill = null | 'atRisk' | 'breached' | 'mttr' | 'closure' | 'unassigned';

export default function ClassificationPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('classification');
  const [days, setDays] = useState(30);
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [drill, setDrill] = useState<Drill>(null);
  const [agentSort, setAgentSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
    key: 'problems',
    dir: 'desc',
  });

  const { data: classData, isLoading: loadingClass } = useQuery({
    queryKey: ['analytics-classification', days],
    queryFn: () => analyticsApi.classification(days).then((r) => r.data),
  });

  const { data: patternData, isLoading: loadingPatterns } = useQuery({
    queryKey: ['analytics-patterns', days],
    queryFn: () => analyticsApi.patterns(days).then((r) => r.data),
    enabled: activeTab === 'patterns',
  });

  const { data: bottleneckData, isLoading: loadingBottlenecks } = useQuery({
    queryKey: ['analytics-bottlenecks'],
    queryFn: () => analyticsApi.bottlenecks().then((r) => r.data),
    enabled: activeTab === 'bottlenecks',
  });

  const { data: gapData, isLoading: loadingGaps } = useQuery({
    queryKey: ['analytics-gaps', days],
    queryFn: () => analyticsApi.knowledgeGaps(days).then((r) => r.data),
    enabled: activeTab === 'gaps',
  });

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'classification', label: 'Incident Classification', icon: <Activity className="w-4 h-4" /> },
    { id: 'patterns', label: 'Recurring Patterns', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'bottlenecks', label: 'Bottlenecks', icon: <Zap className="w-4 h-4" /> },
    { id: 'gaps', label: 'Knowledge Gaps', icon: <Lightbulb className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Incident Intelligence"
        subtitle="Classification, patterns, bottlenecks, and knowledge gaps"
        actions={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        }
      />

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Classification ─────────────────────────────────────────────── */}
      {activeTab === 'classification' &&
        (loadingClass ? (
          <LoadingSpinner label="Analysing incidents…" />
        ) : (
          <div className="space-y-6">
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <StatCard
                label="Total Incidents"
                value={classData?.summary?.total ?? 0}
                sub={`Last ${days} days`}
                icon={<Activity className="w-6 h-6" />}
                color="blue"
              />
              <StatCard
                label="Open"
                value={classData?.summary?.open ?? 0}
                sub="Needs attention"
                icon={<AlertTriangle className="w-6 h-6" />}
                color="orange"
              />
              <StatCard
                label="Critical Modules"
                value={(classData?.moduleBreakdown || []).filter((m: any) => m.health === 'critical').length}
                sub="Needing immediate focus"
                icon={<AlertCircle className="w-6 h-6" />}
                color="red"
              />
              <StatCard
                label="Avg MTTR"
                value={classData?.summary?.avgMttrHours != null ? `${classData.summary.avgMttrHours}h` : '—'}
                sub="all incidents"
                icon={<Clock className="w-6 h-6" />}
                color="amber"
              />
              <StatCard
                label="Total Effort"
                value={classData?.summary?.totalEffortHours != null ? `${classData.summary.totalEffortHours}h` : '0h'}
                sub="logged this period"
                icon={<TrendingUp className="w-6 h-6" />}
                color="green"
              />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="By Record Type">
                <div className="p-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={(classData?.byType || []).map((t: any) => ({ name: t.type, value: t.count }))}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                      >
                        {(classData?.byType || []).map((_: any, i: number) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Open by Priority">
                <div className="p-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={['P1', 'P2', 'P3', 'P4'].map((p) => ({
                        name: p,
                        count: (classData?.byPriority || []).find((x: any) => x.priority === p)?.count || 0,
                      }))}
                      margin={{ top: 0, right: 0, bottom: 0, left: -20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {['P1', 'P2', 'P3', 'P4'].map((_: any, i: number) => (
                          <Cell key={i} fill={['#ef4444', '#f97316', '#eab308', '#22c55e'][i]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="By Status">
                <div className="p-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={(classData?.byStatus || []).map((s: any) => ({
                          name: s.status.replace('_', ' '),
                          value: s.count,
                        }))}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={renderPieLabel}
                        labelLine={false}
                      >
                        {(classData?.byStatus || []).map((_: any, i: number) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            {/* Module breakdown table */}
            <Card title="SAP Module Breakdown">
              <div className="divide-y divide-gray-100">
                {(classData?.moduleBreakdown || []).length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-10">
                    No incidents with SAP module classification found. Make sure tickets have SAP modules assigned.
                  </p>
                )}
                {(classData?.moduleBreakdown || []).map((mod: any) => {
                  const trendDir = mod.trend?.direction;
                  const showSecondary =
                    mod.mttrHours != null ||
                    mod.effortHours > 0 ||
                    (mod.trend && (mod.trend.previous > 0 || mod.trend.current > 0));
                  return (
                  <div key={mod.moduleId}>
                    {/* Module row */}
                    <div
                      className="px-5 py-3.5 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedModule(expandedModule === mod.moduleId ? null : mod.moduleId)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 w-8">
                          {mod.subModules?.length > 0 ? (
                            expandedModule === mod.moduleId ? (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            )
                          ) : (
                            <span className="w-4" />
                          )}
                        </div>

                        {/* Health dot */}
                        <span
                          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                            mod.health === 'critical'
                              ? 'bg-red-500'
                              : mod.health === 'warning'
                                ? 'bg-amber-400'
                                : 'bg-green-400'
                          }`}
                        />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                              {mod.code}
                            </span>
                            <span className="text-sm font-medium text-gray-900">{mod.name}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-6 text-sm">
                          <div className="text-center">
                            <div className="font-semibold text-gray-900">{mod.total}</div>
                            <div className="text-xs text-gray-400">Total</div>
                          </div>
                          <div className="text-center">
                            <div className={`font-semibold ${mod.open > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                              {mod.open}
                            </div>
                            <div className="text-xs text-gray-400">Open</div>
                          </div>
                          <div className="text-center">
                            <div className="font-semibold text-green-600">{mod.resolved}</div>
                            <div className="text-xs text-gray-400">Resolved</div>
                          </div>
                          <div className="text-center">
                            <div className={`font-semibold ${mod.p1p2Open > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                              {mod.p1p2Open}
                            </div>
                            <div className="text-xs text-gray-400">P1/P2</div>
                          </div>
                          <div className="text-center">
                            <div className="font-semibold text-gray-700">{mod.incidents}</div>
                            <div className="text-xs text-gray-400">Incidents</div>
                          </div>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              mod.health === 'critical'
                                ? 'bg-red-100 text-red-700'
                                : mod.health === 'warning'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-green-100 text-green-700'
                            }`}
                          >
                            {mod.health}
                          </span>
                        </div>
                      </div>

                      {/* Secondary metrics line: MTTR · Effort · Trend */}
                      {showSecondary && (
                        <div className="ml-14 mt-1.5 text-xs text-gray-500 flex flex-wrap items-center gap-3">
                          {mod.mttrHours != null && (
                            <span>
                              MTTR <span className="font-semibold text-gray-700">{mod.mttrHours}h</span>
                              {mod.mttrP50 != null && mod.mttrP90 != null && (
                                <span className="text-gray-400">
                                  {' '}
                                  · p50 {mod.mttrP50}h / p90 {mod.mttrP90}h
                                </span>
                              )}
                            </span>
                          )}
                          {mod.effortHours > 0 && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span>
                                Effort <span className="font-semibold text-gray-700">{mod.effortHours}h</span>
                                <span className="text-gray-400"> ({mod.effortPercentOfTotal}%)</span>
                              </span>
                            </>
                          )}
                          {mod.trend && (mod.trend.previous > 0 || mod.trend.current > 0) && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span
                                className={`font-medium ${
                                  trendDir === 'up'
                                    ? 'text-red-600'
                                    : trendDir === 'down'
                                      ? 'text-green-600'
                                      : trendDir === 'new'
                                        ? 'text-amber-600'
                                        : 'text-gray-500'
                                }`}
                              >
                                {trendDir === 'up'
                                  ? '↑'
                                  : trendDir === 'down'
                                    ? '↓'
                                    : trendDir === 'new'
                                      ? '✦'
                                      : '→'}
                                {mod.trend.deltaPercent != null
                                  ? ` ${Math.abs(mod.trend.deltaPercent)}%`
                                  : ' new'}
                              </span>
                              <span className="text-gray-400">vs prior {days}d</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Sub-module rows (expanded) */}
                    {expandedModule === mod.moduleId && mod.subModules?.length > 0 && (
                      <div className="bg-gray-50 border-t border-gray-100">
                        {mod.subModules.map((sm: any) => (
                          <div key={sm.id} className="flex items-center gap-4 px-5 py-2.5 pl-16">
                            <div className="flex-1 flex items-center gap-2">
                              <span className="text-xs font-mono text-gray-400">{sm.code}</span>
                              <span className="text-sm text-gray-600">{sm.name}</span>
                            </div>
                            <span className="text-sm font-medium text-gray-700">{sm.count} tickets</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </Card>
          </div>
        ))}

      {/* ── Tab: Patterns ───────────────────────────────────────────────────── */}
      {activeTab === 'patterns' &&
        (loadingPatterns ? (
          <LoadingSpinner label="Detecting patterns…" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard
                label="Patterns Detected"
                value={patternData?.totalPatterns ?? 0}
                sub={`In last ${days} days`}
                icon={<TrendingUp className="w-6 h-6" />}
                color="blue"
              />
              <StatCard
                label="High Severity"
                value={patternData?.highSeverity ?? 0}
                sub="8+ incidents in window"
                icon={<AlertTriangle className="w-6 h-6" />}
                color="red"
              />
              <StatCard
                label="Without Problem Record"
                value={(patternData?.patterns || []).filter((p: any) => !p.hasProblemRecord).length}
                sub="No root-cause investigation"
                icon={<AlertCircle className="w-6 h-6" />}
                color="orange"
              />
            </div>

            {(patternData?.patterns || []).length === 0 ? (
              <Card title="No Patterns Detected">
                <p className="text-sm text-gray-400 text-center py-10">
                  No recurring patterns found with {patternData?.period?.threshold || 3}+ incidents in the last {days}{' '}
                  days. Try extending the time window.
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {(patternData?.patterns || []).map((p: any, idx: number) => (
                  <div key={idx} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="flex items-start gap-4 p-4">
                      <span
                        className={`mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                          p.severity === 'high'
                            ? 'bg-red-500'
                            : p.severity === 'medium'
                              ? 'bg-amber-400'
                              : 'bg-blue-400'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                            {p.moduleCode}
                          </span>
                          {p.subModuleCode && (
                            <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                              {p.subModuleCode}
                            </span>
                          )}
                          {p.kind === 'emergent' && (
                            <span className="text-[10px] font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded uppercase tracking-wide">
                              Emergent
                            </span>
                          )}
                          <span className="text-sm font-semibold text-gray-900">{p.label || p.moduleName}</span>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">
                          <span className="font-semibold text-gray-800">{p.count} incidents</span> in the last {days}{' '}
                          days
                          {p.hasProblemRecord ? (
                            <span className="ml-2 text-green-600 font-medium">✓ Problem record exists</span>
                          ) : (
                            <span className="ml-2 text-red-600 font-medium">✗ No Problem record</span>
                          )}
                          {p.kind === 'emergent' && p.tokens && p.tokens.length > 0 && (
                            <span className="ml-2 text-orange-700">· tokens: {p.tokens.join(', ')}</span>
                          )}
                        </p>
                        {/* Sample tickets */}
                        <div className="space-y-1">
                          {(p.samples || []).map((s: any) => (
                            <div
                              key={s.id}
                              onClick={() => navigate(`/records/${s.id}`)}
                              className="flex items-center gap-2 text-xs text-gray-600 hover:text-indigo-600 cursor-pointer group"
                            >
                              <span className="font-mono text-gray-400">{s.recordNumber}</span>
                              <PriorityBadge priority={s.priority} short />
                              <span className="truncate flex-1">{s.title}</span>
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            p.severity === 'high'
                              ? 'bg-red-100 text-red-700'
                              : p.severity === 'medium'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {p.severity}
                        </span>
                        {!p.hasProblemRecord && (
                          <button
                            onClick={() => navigate(`/records/new?type=PROBLEM&moduleId=${p.moduleId}`)}
                            className="text-xs text-indigo-600 hover:underline"
                          >
                            + Create Problem
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

      {/* ── Tab: Bottlenecks ────────────────────────────────────────────────── */}
      {activeTab === 'bottlenecks' &&
        (loadingBottlenecks ? (
          <LoadingSpinner label="Finding bottlenecks…" />
        ) : (
          (() => {
            const b = bottleneckData || {};
            const topAtRisk = (b.topAtRiskAgents || [])[0];
            const topBreached = (b.topBreachedAgents || [])[0];
            const slowest = (b.modulesByMTTR || [])[0];
            const closure = b.closureRate?.totals || { opened: 0, resolved: 0, backlogDelta: 0 };
            const unassigned = b.unassignedAging || { totalCount: 0, perModule: [] };
            const agents = b.agents || [];
            const sortedAgents = [...agents].sort((x: any, y: any) => {
              const dir = agentSort.dir === 'asc' ? 1 : -1;
              if (agentSort.key === 'problems') {
                return dir * (x.atRiskCount + x.breachedCount - (y.atRiskCount + y.breachedCount));
              }
              if (agentSort.key === 'name') return dir * x.agentName.localeCompare(y.agentName);
              return dir * ((x[agentSort.key] || 0) - (y[agentSort.key] || 0));
            });
            const toggleSort = (key: string) =>
              setAgentSort((s) =>
                s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
              );
            const headerCls = 'px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700';

            return (
              <div className="space-y-4">
                {/* ── 5 KPI Tiles ───────────────────────────────────────── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {/* Tile 1 — Most At-Risk */}
                  <button
                    onClick={() => setDrill('atRisk')}
                    className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-orange-300 hover:shadow-sm transition flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                        <Clock className="w-4 h-4" />
                      </div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Most At-Risk</p>
                    </div>
                    {topAtRisk ? (
                      <>
                        <p className="text-lg font-bold text-gray-900">{topAtRisk.agentName}</p>
                        <p className="text-xs text-gray-500">
                          {topAtRisk.count} ticket{topAtRisk.count !== 1 ? 's' : ''} past 50% of SLA
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400">Nothing flagged</p>
                    )}
                  </button>

                  {/* Tile 2 — Most Breached */}
                  <button
                    onClick={() => setDrill('breached')}
                    className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-red-300 hover:shadow-sm transition flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Most Breached</p>
                    </div>
                    {topBreached ? (
                      <>
                        <p className="text-lg font-bold text-gray-900">{topBreached.agentName}</p>
                        <p className="text-xs text-gray-500">
                          {topBreached.count} open breach{topBreached.count !== 1 ? 'es' : ''}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400">Nothing flagged</p>
                    )}
                  </button>

                  {/* Tile 3 — Slowest Module */}
                  <button
                    onClick={() => setDrill('mttr')}
                    className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-purple-300 hover:shadow-sm transition flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                        <TrendingDown className="w-4 h-4" />
                      </div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Slowest Module</p>
                    </div>
                    {slowest ? (
                      <>
                        <p className="text-lg font-bold text-gray-900">
                          {slowest.moduleCode} · {slowest.avgMttrHours}h
                        </p>
                        <p className="text-xs text-gray-500">
                          p50 {slowest.p50}h · p90 {slowest.p90}h
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400">—</p>
                    )}
                  </button>

                  {/* Tile 4 — Backlog Delta */}
                  <button
                    onClick={() => setDrill('closure')}
                    className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow-sm transition flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                        <Activity className="w-4 h-4" />
                      </div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Backlog (7d)</p>
                    </div>
                    <p
                      className={`text-lg font-bold ${closure.backlogDelta > 0 ? 'text-red-600' : closure.backlogDelta < 0 ? 'text-green-600' : 'text-gray-900'}`}
                    >
                      {closure.backlogDelta > 0 ? '+' : ''}
                      {closure.backlogDelta}
                    </p>
                    <p className="text-xs text-gray-500">
                      {closure.opened} opened · {closure.resolved} resolved
                    </p>
                  </button>

                  {/* Tile 5 — Unassigned Aging */}
                  <button
                    onClick={() => setDrill('unassigned')}
                    className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-amber-300 hover:shadow-sm transition flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                        <Inbox className="w-4 h-4" />
                      </div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Unassigned</p>
                    </div>
                    <p className="text-lg font-bold text-gray-900">
                      {unassigned.totalCount} ticket{unassigned.totalCount !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-gray-500">
                      {unassigned.perModule[0]
                        ? `oldest ${(unassigned.perModule[0].oldestHours / 24).toFixed(1)}d`
                        : 'all assigned'}
                    </p>
                  </button>
                </div>

                {/* ── Agents Table ──────────────────────────────────────── */}
                <Card title="Agents — workload & problem load">
                  {agents.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-400">No agents have open tickets.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-100">
                          <tr>
                            <th className={headerCls} onClick={() => toggleSort('name')}>
                              Agent
                            </th>
                            <th className={headerCls} onClick={() => toggleSort('openCount')}>
                              Open
                            </th>
                            <th className={headerCls} onClick={() => toggleSort('atRiskCount')}>
                              At-Risk
                            </th>
                            <th className={headerCls} onClick={() => toggleSort('breachedCount')}>
                              Breached
                            </th>
                            <th className={headerCls} onClick={() => toggleSort('oldestAtRiskHours')}>
                              Oldest At-Risk
                            </th>
                            <th className={headerCls} onClick={() => toggleSort('problems')}>
                              Problem Load
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {sortedAgents.map((a: any) => {
                            const problems = a.atRiskCount + a.breachedCount;
                            return (
                              <tr
                                key={a.agentId}
                                onClick={() => navigate(`/records?assignedAgentId=${a.agentId}`)}
                                className="hover:bg-gray-50 cursor-pointer"
                              >
                                <td className="px-5 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700">
                                      {a.agentName?.charAt(0) || '?'}
                                    </div>
                                    <span className="font-medium text-gray-900">{a.agentName}</span>
                                  </div>
                                </td>
                                <td className="px-5 py-3 text-gray-700">{a.openCount}</td>
                                <td className="px-5 py-3">
                                  <span
                                    className={`text-xs font-medium px-2 py-0.5 rounded ${a.atRiskCount > 0 ? 'bg-orange-50 text-orange-700' : 'bg-gray-50 text-gray-400'}`}
                                  >
                                    {a.atRiskCount}
                                  </span>
                                </td>
                                <td className="px-5 py-3">
                                  <span
                                    className={`text-xs font-medium px-2 py-0.5 rounded ${a.breachedCount > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-400'}`}
                                  >
                                    {a.breachedCount}
                                  </span>
                                </td>
                                <td className="px-5 py-3 text-xs text-gray-500">
                                  {a.oldestAtRiskHours > 0 ? `${a.oldestAtRiskHours}h` : '—'}
                                </td>
                                <td className="px-5 py-3">
                                  <span
                                    className={`text-xs font-bold ${problems >= 4 ? 'text-red-600' : problems >= 2 ? 'text-amber-600' : 'text-gray-400'}`}
                                  >
                                    {problems}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                {/* ── Drilldown Modals ──────────────────────────────────── */}
                <Modal
                  open={drill === 'atRisk'}
                  onClose={() => setDrill(null)}
                  title="Agents with At-Risk Tickets"
                  size="lg"
                >
                  {(b.topAtRiskAgents || []).length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">Nothing flagged.</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {(b.topAtRiskAgents || []).map((a: any) => (
                        <div
                          key={a.agentId}
                          onClick={() => navigate(`/records?assignedAgentId=${a.agentId}`)}
                          className="flex items-center gap-3 py-3 cursor-pointer hover:bg-gray-50 px-2 rounded"
                        >
                          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-xs font-semibold text-orange-700">
                            {a.agentName.charAt(0)}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">{a.agentName}</p>
                            {a.topTicket && (
                              <p className="text-xs text-gray-500 font-mono">
                                top: {a.topTicket.recordNumber} ({a.topTicket.priority})
                              </p>
                            )}
                          </div>
                          <span className="text-sm font-bold text-orange-700">{a.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Modal>

                <Modal
                  open={drill === 'breached'}
                  onClose={() => setDrill(null)}
                  title="Agents with Open Breaches"
                  size="lg"
                >
                  {(b.topBreachedAgents || []).length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">Nothing flagged.</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {(b.topBreachedAgents || []).map((a: any) => (
                        <div
                          key={a.agentId}
                          onClick={() => navigate(`/records?assignedAgentId=${a.agentId}`)}
                          className="flex items-center gap-3 py-3 cursor-pointer hover:bg-gray-50 px-2 rounded"
                        >
                          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-xs font-semibold text-red-700">
                            {a.agentName.charAt(0)}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">{a.agentName}</p>
                            {a.topTicket && (
                              <p className="text-xs text-gray-500 font-mono">
                                top: {a.topTicket.recordNumber} ({a.topTicket.priority})
                              </p>
                            )}
                          </div>
                          <span className="text-sm font-bold text-red-700">{a.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Modal>

                <Modal open={drill === 'mttr'} onClose={() => setDrill(null)} title="Module MTTR" size="lg">
                  {(b.modulesByMTTR || []).length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No resolved data.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Module</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Avg</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">p50</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">p90</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Sample</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(b.modulesByMTTR || []).map((m: any) => (
                          <tr key={m.moduleId}>
                            <td className="px-3 py-2 font-medium text-gray-900">
                              {m.moduleCode} <span className="text-xs text-gray-400">{m.moduleName}</span>
                            </td>
                            <td className="px-3 py-2 text-gray-700">{m.avgMttrHours}h</td>
                            <td className="px-3 py-2 text-gray-700">{m.p50}h</td>
                            <td className="px-3 py-2 text-gray-700">{m.p90}h</td>
                            <td className="px-3 py-2 text-xs text-gray-500">{m.sampleSize}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Modal>

                <Modal
                  open={drill === 'closure'}
                  onClose={() => setDrill(null)}
                  title="Backlog Delta by Module (last 7 days)"
                  size="lg"
                >
                  {(b.closureRate?.perModule || []).length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No activity in window.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Module</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Opened</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">
                            Resolved
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Delta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(b.closureRate?.perModule || []).map((m: any) => (
                          <tr key={m.moduleCode}>
                            <td className="px-3 py-2 font-medium text-gray-900">{m.moduleCode}</td>
                            <td className="px-3 py-2 text-gray-700">{m.opened}</td>
                            <td className="px-3 py-2 text-gray-700">{m.resolved}</td>
                            <td
                              className={`px-3 py-2 font-semibold ${m.backlogDelta > 0 ? 'text-red-600' : m.backlogDelta < 0 ? 'text-green-600' : 'text-gray-700'}`}
                            >
                              {m.backlogDelta > 0 ? '+' : ''}
                              {m.backlogDelta}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Modal>

                <Modal
                  open={drill === 'unassigned'}
                  onClose={() => setDrill(null)}
                  title="Unassigned Tickets by Module"
                  size="lg"
                >
                  {(b.unassignedAging?.perModule || []).length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">All open tickets are assigned.</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {(b.unassignedAging?.perModule || []).map((m: any) => (
                        <div key={m.moduleCode} className="flex items-center gap-3 py-3 px-2">
                          <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded w-14 text-center">
                            {m.moduleCode}
                          </span>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {m.count} ticket{m.count !== 1 ? 's' : ''}
                            </p>
                            {m.oldestTicket && (
                              <Link
                                to={`/records/${m.oldestTicket.id}`}
                                className="text-xs text-blue-600 font-mono hover:underline"
                              >
                                oldest: {m.oldestTicket.recordNumber} ({m.oldestTicket.priority})
                              </Link>
                            )}
                          </div>
                          <span className="text-sm font-semibold text-amber-700">{m.oldestHours}h</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Modal>
              </div>
            );
          })()
        ))}

      {/* ── Tab: Knowledge Gaps ──────────────────────────────────────────────── */}
      {activeTab === 'gaps' &&
        (loadingGaps ? (
          <LoadingSpinner label="Identifying knowledge gaps…" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard
                label="Gaps Identified"
                value={gapData?.totalGaps ?? 0}
                sub={`Last ${days} days`}
                icon={<Lightbulb className="w-6 h-6" />}
                color="blue"
              />
              <StatCard
                label="Critical Gaps"
                value={gapData?.criticalGaps ?? 0}
                sub="5+ incidents, no Problem"
                icon={<AlertTriangle className="w-6 h-6" />}
                color="red"
              />
              <StatCard
                label="Need KB Articles"
                value={(gapData?.gaps || []).filter((g: any) => !g.hasProblemRecord).length}
                sub="No documented resolution"
                icon={<AlertCircle className="w-6 h-6" />}
                color="orange"
              />
            </div>

            {(gapData?.gaps || []).length === 0 ? (
              <Card title="No Gaps Found">
                <p className="text-sm text-gray-400 text-center py-10">
                  No knowledge gaps detected in the last {days} days. Either coverage is good or there isn't enough data
                  yet.
                </p>
              </Card>
            ) : (
              <Card title="Knowledge Gap Analysis">
                <div className="divide-y divide-gray-100">
                  <div className="grid grid-cols-6 gap-4 px-5 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide bg-gray-50">
                    <span className="col-span-2">Module</span>
                    <span>Priority</span>
                    <span>Incidents</span>
                    <span>Unresolved</span>
                    <span>Recommendation</span>
                  </div>
                  {(gapData?.gaps || []).map((gap: any, i: number) => (
                    <div key={i} className="grid grid-cols-6 gap-4 px-5 py-3.5 items-start hover:bg-gray-50">
                      <div className="col-span-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                            {gap.moduleCode}
                          </span>
                          <span className="text-sm text-gray-800">{gap.moduleName}</span>
                        </div>
                        {gap.avgResolutionHours && (
                          <span className="text-xs text-gray-400 mt-0.5 block">
                            avg {gap.avgResolutionHours}h to resolve
                          </span>
                        )}
                      </div>
                      <div>
                        <PriorityBadge priority={gap.priority} />
                      </div>
                      <div className="text-sm font-semibold text-gray-900">{gap.incidentCount}</div>
                      <div
                        className={`text-sm font-semibold ${gap.unresolvedCount > 0 ? 'text-orange-600' : 'text-gray-400'}`}
                      >
                        {gap.unresolvedCount}
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 leading-relaxed">{gap.recommendation}</p>
                        {!gap.hasProblemRecord && gap.incidentCount >= 5 && (
                          <button
                            onClick={() => navigate(`/records/new?type=PROBLEM&moduleId=${gap.moduleId}`)}
                            className="mt-1.5 text-xs text-indigo-600 hover:underline"
                          >
                            + Create Problem record →
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        ))}
    </div>
  );
}
