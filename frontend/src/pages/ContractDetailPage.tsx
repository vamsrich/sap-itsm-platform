import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { contractsApi } from '../api/services';
import { format } from 'date-fns';
import { ArrowLeft, FileText, Pencil, History } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';

const SLA_LABELS = {
  P1: 'P1 – Blocker / Critical',
  P2: 'P2 – Major',
  P3: 'P3 – Normal / Minor',
  P4: 'P4 – Query',
} as Record<string, string>;
const SLA_COLORS = { P1: 'text-red-600', P2: 'text-orange-500', P3: 'text-blue-600', P4: 'text-green-600' } as Record<
  string,
  string
>;
const SLA_DESCS = {
  P1: 'Critical system down. Business completely blocked.',
  P2: 'Major feature broken. Significant impact.',
  P3: 'Minor issue. Workaround available.',
  P4: 'General query or low-impact issue.',
} as Record<string, string>;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Row({ label, value }: { label: string; value?: string | React.ReactNode }) {
  return (
    <div className="flex items-start py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-400 w-52 flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value || <span className="text-gray-300">—</span>}</span>
    </div>
  );
}
function Sec({
  icon,
  title,
  color,
  children,
}: {
  icon: string;
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
      <div className="flex items-center gap-2 pb-3 border-b border-gray-100 mb-5">
        <span className="text-xl">{icon}</span>
        <h3 className={`font-semibold text-base ${color}`}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [showChangelog, setShowChangelog] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['contract', id],
    queryFn: () => contractsApi.get(id!).then((r) => r.data.contract),
  });

  const { data: changelogData } = useQuery({
    queryKey: ['contract-changelog', id],
    queryFn: () => contractsApi.changelog(id!).then((r) => r.data.logs || []),
    enabled: showChangelog,
  });

  if (isLoading) return <div className="p-10 text-center text-gray-400">Loading contract...</div>;
  if (!data) return <div className="p-10 text-center text-red-400">Contract not found</div>;

  const c = data;
  const expired = new Date(c.endDate) < new Date();
  const isActive = c.isActive !== false;
  const supportType = c.supportTypeMaster;
  const slaPolicy = c.slaPolicyMaster;
  // Contract response from GET /:id includes nested shifts and holiday calendars via Prisma include
  const shifts = (c.shifts || []).map((s: any) => s.shift).filter(Boolean);
  const holidayCalendars = (c.holidayCalendars || []).map((h: any) => h.holidayCalendar).filter(Boolean);
  const priorities = (slaPolicy?.priorities || {}) as Record<
    string,
    { response: number; resolution: number; enabled?: boolean }
  >;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/contracts')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 bg-white border border-gray-200 px-3 py-2 rounded-lg"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900 font-mono">{c.contractNumber}</h1>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {isActive ? 'Active' : 'Inactive'}
              </span>
              {expired && (
                <span className="text-xs font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">EXPIRED</span>
              )}
              {slaPolicy && (
                <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                  {slaPolicy.code}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400">{c.customer?.companyName}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {user?.role === 'SUPER_ADMIN' && (
            <button
              onClick={() => navigate(`/contracts/${id}/edit`)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium"
            >
              <Pencil className="w-4 h-4" /> Edit Contract
            </button>
          )}
        </div>
      </div>

      {/* Section 1 — Contract Details */}
      <Sec icon="📋" title="Contract Details" color="text-slate-700">
        <Row label="Contract Number" value={<span className="font-mono">{c.contractNumber}</span>} />
        <Row label="Customer" value={c.customer?.companyName} />
        <Row label="System" value={c.system?.name} />
        <Row
          label="Status"
          value={
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {isActive ? 'Active' : 'Inactive'}
            </span>
          }
        />
        <Row label="Start Date" value={format(new Date(c.startDate), 'MMMM d, yyyy')} />
        <Row
          label="End Date"
          value={
            <span className={expired ? 'text-red-600 font-semibold' : ''}>
              {format(new Date(c.endDate), 'MMMM d, yyyy')}
              {expired ? ' (Expired)' : ''}
            </span>
          }
        />
        <Row label="Customer Timezone" value={c.customer?.timezone} />
      </Sec>

      {/* Section 2 — Coverage Configuration */}
      <Sec icon="🕐" title="Coverage Configuration" color="text-blue-700">
        {supportType ? (
          <>
            <Row
              label="Support Type"
              value={
                <span className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                    {supportType.code}
                  </span>
                  <span>{supportType.name}</span>
                </span>
              }
            />
            <Row
              label="Work Days"
              value={
                supportType.workDays?.length ? supportType.workDays.map((d: number) => DAYS[d]).join(', ') : undefined
              }
            />
            <Row label="Weekend Coverage" value={supportType.weekendCoverage} />
            <Row label="Holiday Coverage" value={supportType.holidayCoverage} />
            <Row label="After-Hours Coverage" value={supportType.afterHoursCoverage} />
            {supportType.afterHoursMultiplier != null && (
              <Row label="After-Hours Multiplier" value={`${supportType.afterHoursMultiplier}×`} />
            )}
            {supportType.weekendMultiplier != null && (
              <Row label="Weekend Multiplier" value={`${supportType.weekendMultiplier}×`} />
            )}
            {supportType.holidayMultiplier != null && (
              <Row label="Holiday Multiplier" value={`${supportType.holidayMultiplier}×`} />
            )}
            {supportType.slaPauseConditions?.length > 0 && (
              <div className="flex items-start py-2.5 border-b border-gray-50">
                <span className="text-sm text-gray-400 w-52 flex-shrink-0">SLA Pause Conditions</span>
                <div className="flex flex-wrap gap-1.5">
                  {supportType.slaPauseConditions.map((p: string) => (
                    <span
                      key={p}
                      className="text-xs font-medium bg-purple-50 text-purple-700 px-2 py-0.5 rounded-lg"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-400 italic">No support type assigned to this contract.</p>
        )}

        {shifts.length > 0 && (
          <div className="flex items-start py-2.5 border-b border-gray-50">
            <span className="text-sm text-gray-400 w-52 flex-shrink-0">Support Shifts</span>
            <div className="flex flex-wrap gap-1.5">
              {shifts.map((s: any) => (
                <span key={s.id} className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg">
                  {s.name} ({s.startTime}–{s.endTime} {s.timezone})
                </span>
              ))}
            </div>
          </div>
        )}

        {holidayCalendars.length > 0 && (
          <div className="flex items-start py-2.5">
            <span className="text-sm text-gray-400 w-52 flex-shrink-0">Holiday Calendars</span>
            <div className="flex flex-wrap gap-1.5">
              {holidayCalendars.map((h: any) => (
                <span key={h.id} className="text-xs font-medium bg-green-50 text-green-700 px-2 py-0.5 rounded-lg">
                  {h.name} ({h.country} {h.year}) — {(h.dates || []).length} dates
                </span>
              ))}
            </div>
          </div>
        )}
      </Sec>

      {/* Section 3 — SLA Policy */}
      <Sec icon="📊" title="SLA Policy" color="text-indigo-700">
        {slaPolicy ? (
          <>
            <Row
              label="Policy"
              value={
                <span className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                    {slaPolicy.code}
                  </span>
                  <span>{slaPolicy.name}</span>
                </span>
              }
            />
            {slaPolicy.warningThreshold != null && (
              <Row
                label="Warning Threshold"
                value={`Alert at ${Math.round(slaPolicy.warningThreshold * 100)}% elapsed`}
              />
            )}
            <div className="mt-4 border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-5 py-3 font-semibold text-gray-700 w-1/2">Priority</th>
                    <th className="text-center px-5 py-3 font-semibold text-gray-700">Response</th>
                    <th className="text-center px-5 py-3 font-semibold text-gray-700">Resolution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {['P1', 'P2', 'P3', 'P4'].map((p) => {
                    const sla = priorities[p];
                    const enabled = sla && sla.enabled !== false;
                    return (
                      <tr key={p} className={!enabled ? 'opacity-40 bg-gray-50' : ''}>
                        <td className="px-5 py-4">
                          <p className={`font-semibold ${SLA_COLORS[p]}`}>{SLA_LABELS[p]}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{SLA_DESCS[p]}</p>
                        </td>
                        <td className="px-5 py-4 text-center">
                          {enabled ? (
                            <span className="inline-block bg-blue-50 text-blue-700 font-semibold text-sm px-3 py-1.5 rounded-lg">
                              {sla.response} min
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-center">
                          {enabled ? (
                            <span className="inline-block bg-purple-50 text-purple-700 font-semibold text-sm px-3 py-1.5 rounded-lg">
                              {sla.resolution} min
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-400 italic">No SLA policy assigned (SLA tracking disabled).</p>
        )}
      </Sec>

      {/* Section 4 — Billing */}
      <Sec icon="💰" title="Billing & Renewal" color="text-green-700">
        <Row
          label="Billing Amount"
          value={c.billingAmount ? `${c.currency} ${Number(c.billingAmount).toLocaleString()}` : undefined}
        />
        <Row label="Currency" value={c.currency} />
        <Row label="Billing Frequency" value={c.billingFrequency} />
        <Row label="Payment Terms" value={c.paymentTerms} />
        <Row
          label="Auto Renewal"
          value={
            <span className={c.autoRenewal ? 'text-green-600 font-semibold' : 'text-gray-400'}>
              {c.autoRenewal ? '✓ Yes — Auto Renew' : 'No — Manual Renewal'}
            </span>
          }
        />
        <Row label="Renewal Notice" value={c.renewalNoticeDays ? `${c.renewalNoticeDays} days` : undefined} />
        {c.notes && <Row label="Notes" value={c.notes} />}
      </Sec>

      {/* Change Log */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <button
          onClick={() => setShowChangelog(!showChangelog)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-700 w-full text-left"
        >
          <History className="w-4 h-4 text-gray-400" />
          Change Log
          <span className="text-xs text-gray-400 ml-auto">{showChangelog ? '▾ Hide' : '▸ Show'}</span>
        </button>
        {showChangelog && (
          <div className="mt-4 space-y-3">
            {!changelogData || changelogData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No changes recorded yet.</p>
            ) : (
              changelogData.map((log: any) => (
                <div key={log.id} className="flex gap-3 text-sm border-b border-gray-50 pb-3 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600">
                    {log.user ? `${log.user.firstName?.[0]}${log.user.lastName?.[0]}` : '⚙'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">
                        {log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'}
                      </span>
                      <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {log.action}
                      </span>
                      <span className="text-xs text-gray-400 ml-auto">
                        {format(new Date(log.createdAt), 'dd MMM yyyy HH:mm')}
                      </span>
                    </div>
                    {log.newValues && (
                      <div className="mt-1 text-xs text-gray-500">
                        {Object.entries(log.newValues)
                          .filter(([_, v]) => v != null)
                          .map(([k, v]) => (
                            <span key={k} className="mr-3">
                              <span className="text-gray-400">{k}:</span>{' '}
                              {log.oldValues?.[k] != null && (
                                <>
                                  <span className="text-red-400 line-through">
                                    {String(log.oldValues[k]).slice(0, 30)}
                                  </span>{' '}
                                  →{' '}
                                </>
                              )}
                              <span className="text-green-600">{String(v).slice(0, 50)}</span>
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
