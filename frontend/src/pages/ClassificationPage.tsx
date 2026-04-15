import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Legend,
} from 'recharts';
import {
  AlertTriangle, TrendingUp, Search, AlertCircle,
  ChevronDown, ChevronRight, ExternalLink, Lightbulb, Activity,
} from 'lucide-react';
import { analyticsApi } from '../api/services';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { PriorityBadge, StatusBadge } from '../components/ui/Badges';
import { PageHeader, Card, StatCard } from '../components/ui/Forms';
import { formatDistanceToNow } from 'date-fns';

const PIE_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6', '#f97316', '#06b6d4'];
const PERIOD_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 60 days', value: 60 },
  { label: 'Last 90 days', value: 90 },
];

type Tab = 'classification' | 'patterns' | 'rootcause' | 'gaps';

export default function ClassificationPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('classification');
  const [days, setDays] = useState(30);
  const [expandedModule, setExpandedModule] = useState<string | null>(null);

  const { data: classData, isLoading: loadingClass } = useQuery({
    queryKey: ['analytics-classification', days],
    queryFn: () => analyticsApi.classification(days).then(r => r.data),
  });

  const { data: patternData, isLoading: loadingPatterns } = useQuery({
    queryKey: ['analytics-patterns', days],
    queryFn: () => analyticsApi.patterns(days).then(r => r.data),
    enabled: activeTab === 'patterns',
  });

  const { data: rootData, isLoading: loadingRoot } = useQuery({
    queryKey: ['analytics-rootcause', days],
    queryFn: () => analyticsApi.rootCause(days).then(r => r.data),
    enabled: activeTab === 'rootcause',
  });

  const { data: gapData, isLoading: loadingGaps } = useQuery({
    queryKey: ['analytics-gaps', days],
    queryFn: () => analyticsApi.knowledgeGaps(days).then(r => r.data),
    enabled: activeTab === 'gaps',
  });

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'classification', label: 'Incident Classification', icon: <Activity className="w-4 h-4" /> },
    { id: 'patterns',       label: 'Recurring Patterns',      icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'rootcause',      label: 'Root-Cause View',         icon: <Search className="w-4 h-4" /> },
    { id: 'gaps',           label: 'Knowledge Gaps',          icon: <Lightbulb className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Incident Intelligence"
        subtitle="Classification, patterns, root-cause signals, and knowledge gaps"
        actions={
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {PERIOD_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        }
      />

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(tab => (
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
      {activeTab === 'classification' && (
        loadingClass ? <LoadingSpinner label="Analysing incidents…" /> : (
          <div className="space-y-6">
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
                label="Resolved"
                value={classData?.summary?.resolved ?? 0}
                sub="Closed out"
                icon={<TrendingUp className="w-6 h-6" />}
                color="green"
              />
              <StatCard
                label="Critical Modules"
                value={(classData?.moduleBreakdown || []).filter((m: any) => m.health === 'critical').length}
                sub="Needing immediate focus"
                icon={<AlertCircle className="w-6 h-6" />}
                color="red"
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
                        dataKey="value" nameKey="name" cx="50%" cy="50%"
                        innerRadius={50} outerRadius={80}
                      >
                        {(classData?.byType || []).map((_: any, i: number) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip /><Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Open by Priority">
                <div className="p-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={['P1','P2','P3','P4'].map(p => ({
                        name: p,
                        count: (classData?.byPriority || []).find((x: any) => x.priority === p)?.count || 0,
                      }))}
                      margin={{ top: 0, right: 0, bottom: 0, left: -20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {['P1','P2','P3','P4'].map((_: any, i: number) => (
                          <Cell key={i} fill={['#ef4444','#f97316','#eab308','#22c55e'][i]} />
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
                          name: s.status.replace('_', ' '), value: s.count,
                        }))}
                        dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
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
                {(classData?.moduleBreakdown || []).map((mod: any) => (
                  <div key={mod.moduleId}>
                    {/* Module row */}
                    <div
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedModule(expandedModule === mod.moduleId ? null : mod.moduleId)}
                    >
                      <div className="flex items-center gap-2 w-8">
                        {mod.subModules?.length > 0
                          ? expandedModule === mod.moduleId
                            ? <ChevronDown className="w-4 h-4 text-gray-400" />
                            : <ChevronRight className="w-4 h-4 text-gray-400" />
                          : <span className="w-4" />
                        }
                      </div>

                      {/* Health dot */}
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        mod.health === 'critical' ? 'bg-red-500' :
                        mod.health === 'warning'  ? 'bg-amber-400' : 'bg-green-400'
                      }`} />

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
                          <div className={`font-semibold ${mod.open > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{mod.open}</div>
                          <div className="text-xs text-gray-400">Open</div>
                        </div>
                        <div className="text-center">
                          <div className="font-semibold text-green-600">{mod.resolved}</div>
                          <div className="text-xs text-gray-400">Resolved</div>
                        </div>
                        <div className="text-center">
                          <div className={`font-semibold ${mod.p1p2Open > 0 ? 'text-red-600' : 'text-gray-400'}`}>{mod.p1p2Open}</div>
                          <div className="text-xs text-gray-400">P1/P2</div>
                        </div>
                        <div className="text-center">
                          <div className="font-semibold text-gray-700">{mod.incidents}</div>
                          <div className="text-xs text-gray-400">Incidents</div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          mod.health === 'critical' ? 'bg-red-100 text-red-700' :
                          mod.health === 'warning'  ? 'bg-amber-100 text-amber-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {mod.health}
                        </span>
                      </div>
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
                ))}
              </div>
            </Card>
          </div>
        )
      )}

      {/* ── Tab: Patterns ───────────────────────────────────────────────────── */}
      {activeTab === 'patterns' && (
        loadingPatterns ? <LoadingSpinner label="Detecting patterns…" /> : (
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
                  No recurring patterns found with {patternData?.period?.threshold || 3}+ incidents in the last {days} days.
                  Try extending the time window.
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {(patternData?.patterns || []).map((p: any, idx: number) => (
                  <div key={idx} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="flex items-start gap-4 p-4">
                      <span className={`mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        p.severity === 'high'   ? 'bg-red-500' :
                        p.severity === 'medium' ? 'bg-amber-400' : 'bg-blue-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                            {p.moduleCode}
                          </span>
                          {p.subModuleCode && (
                            <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                              {p.subModuleCode}
                            </span>
                          )}
                          <span className="text-sm font-medium text-gray-900">{p.moduleName}</span>
                          {p.subModuleName && (
                            <span className="text-sm text-gray-500">/ {p.subModuleName}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mb-3">
                          <span className="font-semibold text-gray-800">{p.count} incidents</span> in the last {days} days
                          {p.hasProblemRecord
                            ? <span className="ml-2 text-green-600 font-medium">✓ Problem record exists</span>
                            : <span className="ml-2 text-red-600 font-medium">✗ No Problem record</span>
                          }
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
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          p.severity === 'high'   ? 'bg-red-100 text-red-700' :
                          p.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
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
        )
      )}

      {/* ── Tab: Root Cause ─────────────────────────────────────────────────── */}
      {activeTab === 'rootcause' && (
        loadingRoot ? <LoadingSpinner label="Analysing bottlenecks…" /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Where Tickets Stall — By Module & Status">
                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                  {(rootData?.stalledByModule || []).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">No stalled tickets found.</p>
                  )}
                  {(rootData?.stalledByModule || []).map((row: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded w-14 text-center">
                        {row.module_code || '—'}
                      </span>
                      <StatusBadge status={row.status} />
                      <div className="flex-1">
                        <span className="text-sm text-gray-700">{row.module_name || 'Unclassified'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{row.count}</div>
                          <div className="text-xs text-gray-400">tickets</div>
                        </div>
                        <div>
                          <div className={`text-sm font-semibold ${Number(row.avg_hours_in_status) > 48 ? 'text-red-600' : Number(row.avg_hours_in_status) > 24 ? 'text-amber-600' : 'text-gray-700'}`}>
                            {row.avg_hours_in_status}h
                          </div>
                          <div className="text-xs text-gray-400">avg wait</div>
                        </div>
                        {row.critical_count > 0 && (
                          <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">
                            {row.critical_count} P1/P2
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Agents with Longest Pending Tickets">
                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                  {(rootData?.pendingByAgent || []).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">No pending bottlenecks found.</p>
                  )}
                  {(rootData?.pendingByAgent || []).map((row: any, i: number) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700">
                        {row.agent_name?.charAt(0) || '?'}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{row.agent_name}</p>
                        <p className="text-xs text-gray-400">{row.pending_count} pending tickets</p>
                      </div>
                      <div className={`text-sm font-semibold ${Number(row.avg_pending_hours) > 48 ? 'text-red-600' : 'text-amber-600'}`}>
                        avg {row.avg_pending_hours}h
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )
      )}

      {/* ── Tab: Knowledge Gaps ──────────────────────────────────────────────── */}
      {activeTab === 'gaps' && (
        loadingGaps ? <LoadingSpinner label="Identifying knowledge gaps…" /> : (
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
                  No knowledge gaps detected in the last {days} days. Either coverage is good or there isn't enough data yet.
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
                      <div><PriorityBadge priority={gap.priority} /></div>
                      <div className="text-sm font-semibold text-gray-900">{gap.incidentCount}</div>
                      <div className={`text-sm font-semibold ${gap.unresolvedCount > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
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
        )
      )}
    </div>
  );
}
