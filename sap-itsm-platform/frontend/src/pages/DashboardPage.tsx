import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend
} from 'recharts';
import { Ticket, AlertTriangle, Clock, Users, RefreshCw, TrendingUp } from 'lucide-react';
import { useDashboard } from '../hooks/useApi';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { StatCard, Card, PageHeader } from '../components/ui/Forms';
import { PriorityBadge, StatusBadge, TypeBadge, SLABadge } from '../components/ui/Badges';
import { formatDistanceToNow } from 'date-fns';
import { useAuthStore } from '../store/auth.store';

const PIE_COLORS = ['#3b82f6','#f59e0b','#8b5cf6','#10b981','#ef4444','#6b7280'];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: dashboard, isLoading, refetch, dataUpdatedAt } = useDashboard();

  if (isLoading) return <LoadingSpinner fullscreen label="Loading dashboard…" />;

  const d = dashboard;
  const lastUpdated = dataUpdatedAt ? formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true }) : '';

  // Recharts data
  const statusData = d?.byStatus?.map((s: any) => ({ name: s.status.replace('_', ' '), value: s.count })) || [];
  const priorityData = d?.byPriority?.map((p: any) => ({ name: p.priority, count: p.count })) || [];
  const typeData = d?.byType?.map((t: any) => ({ name: t.type, value: t.count })) || [];
  const trendData = d?.monthlyTrend?.map((t: any) => ({
    day: new Date(t.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    total: Number(t.total),
    resolved: Number(t.resolved),
  })) || [];

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title={`Good ${getGreeting()}, ${user?.firstName} 👋`}
        subtitle="Here's what's happening in your service desk"
        actions={
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh {lastUpdated && <span className="text-xs text-gray-400">({lastUpdated})</span>}
          </button>
        }
      />

      {/* ── KPI Cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Open Tickets"
          value={d?.summary?.totalOpen ?? 0}
          sub="Across all types"
          icon={<Ticket className="w-6 h-6" />}
          color="blue"
        />
        <StatCard
          label="New Today"
          value={d?.summary?.newToday ?? 0}
          sub="Created since midnight"
          icon={<TrendingUp className="w-6 h-6" />}
          color="green"
        />
        <StatCard
          label="Critical (P1)"
          value={d?.summary?.p1Open ?? 0}
          sub="Require immediate action"
          icon={<AlertTriangle className="w-6 h-6" />}
          color="red"
        />
        <StatCard
          label="SLA Breaches"
          value={d?.summary?.slaBreaches ?? 0}
          sub="Active breaches"
          icon={<Clock className="w-6 h-6" />}
          color="orange"
        />
      </div>

      {/* ── Charts Row 1 ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Priority distribution */}
        <Card title="Open by Priority">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={priorityData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {priorityData.map((_: any, i: number) => (
                    <Cell key={i} fill={['#ef4444','#f97316','#eab308','#22c55e'][i] || '#6b7280'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Status distribution */}
        <Card title="Status Breakdown">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {statusData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Record type */}
        <Card title="By Record Type">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80}>
                  {typeData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ── Monthly Trend ──────────────────────────────────── */}
      {trendData.length > 0 && (
        <Card title="Monthly Ticket Trend">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total"    stroke="#3b82f6" strokeWidth={2} dot={false} name="Created" />
                <Line type="monotone" dataKey="resolved" stroke="#10b981" strokeWidth={2} dot={false} name="Resolved" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ── Recent Records ─────────────────────────────────── */}
      <Card title="Recent Tickets" actions={
        <button onClick={() => navigate('/records')} className="text-xs text-blue-600 hover:underline">View all →</button>
      }>
        <div className="divide-y divide-gray-100">
          {(d?.recentRecords || []).length === 0 && (
            <p className="px-5 py-8 text-sm text-center text-gray-400">No tickets yet.</p>
          )}
          {(d?.recentRecords || []).map((rec: any) => (
            <div
              key={rec.id}
              onClick={() => navigate(`/records/${rec.id}`)}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-gray-400">{rec.recordNumber}</span>
                  <TypeBadge type={rec.recordType} />
                  <PriorityBadge priority={rec.priority} short />
                </div>
                <p className="text-sm font-medium text-gray-900 truncate">{rec.title}</p>
                {rec.customer && <p className="text-xs text-gray-400">{rec.customer.companyName}</p>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={rec.status} />
                <span className="text-xs text-gray-400">
                  {formatDistanceToNow(new Date(rec.createdAt), { addSuffix: true })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}
