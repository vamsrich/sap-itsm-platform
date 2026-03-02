import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { emailLogsApi } from '../api/services';
import { Mail, Settings, FileText, Clock, CheckCircle, Send, Eye } from 'lucide-react';
import { format } from 'date-fns';

const EMAIL_TEMPLATES = [
  { key:'ticket_created',       icon:'🎫', label:'Ticket Created',      trigger:'When a new ticket / record is created',              recipients:'Customer contact + assigned agent',
    subject:'[{{recordNumber}}] New {{recordType}} Created: {{title}}',
    body:`Dear {{customerName}},\n\nA new {{recordType}} has been created.\n\nTicket : {{recordNumber}}\nTitle  : {{title}}\nPriority: {{priority}}\nSLA Response Due : {{slaResponseDue}}\nSLA Resolution Due: {{slaResolutionDue}}\n\nDescription:\n{{description}}\n\nRegards,\n{{tenantName}} Support Team` },
  { key:'ticket_assigned',      icon:'👤', label:'Ticket Assigned',      trigger:'When a ticket is assigned or re-assigned to an agent', recipients:'Assigned agent + customer contact',
    subject:'[{{recordNumber}}] Ticket Assigned to {{agentName}}',
    body:`Hi {{agentName}},\n\nA ticket has been assigned to you.\n\nTicket : {{recordNumber}}\nTitle  : {{title}}\nPriority: {{priority}}\nCustomer: {{customerName}}\nSLA Response Due : {{slaResponseDue}}\nSLA Resolution Due: {{slaResolutionDue}}\n\nRegards,\n{{tenantName}} Support Team` },
  { key:'ticket_status_changed',icon:'🔄', label:'Status Changed',       trigger:'When ticket status is updated',                       recipients:'Customer contact + created-by user',
    subject:'[{{recordNumber}}] Status Update: {{oldStatus}} → {{newStatus}}',
    body:`Dear {{customerName}},\n\nStatus on ticket {{recordNumber}} has changed.\n\nPrevious: {{oldStatus}}\nNew Status: {{newStatus}}\nUpdated By: {{updatedBy}}\n\n{{comment}}\n\nRegards,\n{{tenantName}} Support Team` },
  { key:'ticket_comment',       icon:'💬', label:'New Comment',          trigger:'When a public (non-internal) comment is posted',       recipients:'Customer contact',
    subject:'[{{recordNumber}}] New Update on Your Ticket',
    body:`Dear {{customerName}},\n\nAn update has been posted on ticket {{recordNumber}}.\n\nComment from {{agentName}}:\n────────────────────────\n{{commentText}}\n────────────────────────\n\nStatus: {{status}}\n\nRegards,\n{{tenantName}} Support Team` },
  { key:'ticket_resolved',      icon:'✅', label:'Ticket Resolved',      trigger:'When ticket is marked Resolved',                      recipients:'Customer contact + created-by user',
    subject:'[{{recordNumber}}] Ticket Resolved — Please Confirm',
    body:`Dear {{customerName}},\n\nYour ticket has been resolved.\n\nTicket    : {{recordNumber}}\nTitle     : {{title}}\nResolved By: {{agentName}}\nResolved On: {{resolvedAt}}\n\nResolution:\n{{resolutionNotes}}\n\nIf the issue persists please reply or reopen.\n\nRegards,\n{{tenantName}} Support Team` },
  { key:'sla_warning',          icon:'⚠️', label:'SLA Warning',          trigger:'When SLA is 80% elapsed (approaching breach)',         recipients:'Assigned agent + Super Admin',
    subject:'⚠️ SLA Warning: [{{recordNumber}}] — {{timeRemaining}} remaining',
    body:`ALERT: SLA Approaching Breach\n\nTicket   : {{recordNumber}}\nTitle    : {{title}}\nPriority : {{priority}}\nCustomer : {{customerName}}\nAgent    : {{agentName}}\nTime Left: {{timeRemaining}}\nDue By   : {{slaResolutionDue}}\n\nImmediate action required.\n\n{{tenantName}} SLA Monitor` },
  { key:'sla_breached',         icon:'🔴', label:'SLA Breached',         trigger:'When resolution SLA deadline is crossed',              recipients:'Agent + Super Admin + Company Admin',
    subject:'🔴 SLA BREACH: [{{recordNumber}}] {{title}}',
    body:`CRITICAL: SLA HAS BEEN BREACHED\n\nTicket    : {{recordNumber}}\nTitle     : {{title}}\nPriority  : {{priority}}\nCustomer  : {{customerName}}\nAgent     : {{agentName}}\nBreach At : {{breachTime}}\nOverdue By: {{overdueBy}}\n\nImmediate escalation required.\n\n{{tenantName}} SLA Monitor` },
];

const STATUS_COLORS: Record<string,string> = {
  SENT:'bg-green-100 text-green-700', PENDING:'bg-yellow-100 text-yellow-700', FAILED:'bg-red-100 text-red-700',
};

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<'templates'|'smtp'|'log'>('templates');
  const [previewKey, setPreviewKey] = useState<string|null>(null);
  const [editKey, setEditKey] = useState<string|null>(null);
  const [templates, setTemplates] = useState<Record<string,{subject:string;body:string}>>(
    Object.fromEntries(EMAIL_TEMPLATES.map(t => [t.key, {subject:t.subject, body:t.body}]))
  );
  const [editForm, setEditForm] = useState({subject:'', body:''});
  const [smtp, setSmtp] = useState({ host:'', port:'587', secure:false, user:'', password:'', fromName:'Service Desk Pro', fromEmail:'', replyTo:'' });
  const [smtpSaved, setSmtpSaved] = useState(false);
  const [logPage, setLogPage] = useState(1);

  const { data: logData, isLoading: logLoading } = useQuery({
    queryKey: ['email-logs', logPage],
    queryFn: () => emailLogsApi.list({ page: logPage, limit: 20 }).then(r => r.data),
    enabled: activeTab === 'log',
  });
  const logs = logData?.logs || [];
  const logTotal = logData?.pagination?.total || 0;

  const openEdit = (key: string) => { setEditKey(key); setEditForm({...templates[key]}); };
  const saveEdit = () => { if (!editKey) return; setTemplates(p => ({...p, [editKey]: editForm})); setEditKey(null); };

  const previewTemplate = EMAIL_TEMPLATES.find(t => t.key === previewKey);
  const previewContent = previewKey ? templates[previewKey] : null;

  const TABS = [
    {key:'templates', icon:<FileText className="w-4 h-4"/>, label:'Email Templates'},
    {key:'smtp',      icon:<Settings className="w-4 h-4"/>, label:'SMTP Settings'},
    {key:'log',       icon:<Clock className="w-4 h-4"/>,    label:'Sent Log'},
  ];

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Email Notifications</h1>
          <p className="text-sm text-gray-500">Configure automated email alerts and SMTP settings</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
          <CheckCircle className="w-4 h-4"/> {EMAIL_TEMPLATES.length} templates configured
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab===tab.key ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>{tab.icon}{tab.label}</button>
        ))}
      </div>

      {/* ── TEMPLATES ── */}
      {activeTab==='templates' && (
        <div className="space-y-3">
          <div className="bg-blue-50 border-l-4 border-blue-500 rounded-lg px-4 py-3 text-sm text-blue-800">
            <strong>Template Variables:</strong>&nbsp;
            {['{{recordNumber}}','{{title}}','{{priority}}','{{customerName}}','{{agentName}}','{{status}}','{{slaResolutionDue}}'].map(v=>(
              <code key={v} className="bg-blue-100 px-1.5 py-0.5 rounded mr-1 text-xs font-mono">{v}</code>
            ))}
          </div>
          {EMAIL_TEMPLATES.map(t => (
            <div key={t.key} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{t.icon}</span>
                  <div>
                    <p className="font-semibold text-gray-900">{t.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t.trigger}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 hidden lg:block"><strong>To:</strong> {t.recipients}</span>
                  <button onClick={() => setPreviewKey(t.key)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-colors">
                    <Eye className="w-3.5 h-3.5"/> Preview
                  </button>
                  <button onClick={() => openEdit(t.key)}
                    className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors font-medium">
                    ✏️ Edit
                  </button>
                </div>
              </div>
              <div className="px-5 pb-4">
                <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600 font-mono">
                  <span className="text-gray-400 mr-2">Subject:</span>{templates[t.key]?.subject}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── SMTP ── */}
      {activeTab==='smtp' && (
        <div className="max-w-2xl space-y-5">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Settings className="w-4 h-4 text-blue-500"/> SMTP Configuration</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">SMTP Host</label>
                <input value={smtp.host} onChange={e=>setSmtp(s=>({...s,host:e.target.value}))} placeholder="smtp.gmail.com"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Port</label>
                <input value={smtp.port} onChange={e=>setSmtp(s=>({...s,port:e.target.value}))} placeholder="587"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
              </div>
              <div className="flex items-center gap-3 pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={smtp.secure} onChange={e=>setSmtp(s=>({...s,secure:e.target.checked}))} className="w-4 h-4 accent-blue-600 rounded"/>
                  <span className="text-sm font-medium text-gray-700">Use SSL/TLS (port 465)</span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">SMTP Username</label>
                <input value={smtp.user} onChange={e=>setSmtp(s=>({...s,user:e.target.value}))} placeholder="your@email.com"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">SMTP Password</label>
                <input type="password" value={smtp.password} onChange={e=>setSmtp(s=>({...s,password:e.target.value}))} placeholder="App password or SMTP key"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">From Name</label>
                <input value={smtp.fromName} onChange={e=>setSmtp(s=>({...s,fromName:e.target.value}))}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">From Email</label>
                <input value={smtp.fromEmail} onChange={e=>setSmtp(s=>({...s,fromEmail:e.target.value}))} placeholder="noreply@company.com"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Reply-To Email</label>
                <input value={smtp.replyTo} onChange={e=>setSmtp(s=>({...s,replyTo:e.target.value}))} placeholder="support@company.com"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
              </div>
            </div>
            {smtpSaved && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center gap-2">
                <CheckCircle className="w-4 h-4"/> SMTP settings saved.
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => { setSmtpSaved(true); setTimeout(()=>setSmtpSaved(false),3000); }}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium">
                💾 Save SMTP Settings
              </button>
              <button className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-medium">
                <Send className="w-4 h-4"/> Send Test Email
              </button>
            </div>
          </div>
          {/* Trigger toggles */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Mail className="w-4 h-4 text-blue-500"/> Notification Triggers</h3>
            <div className="space-y-3">
              {EMAIL_TEMPLATES.map(t => (
                <div key={t.key} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span>{t.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{t.label}</p>
                      <p className="text-xs text-gray-400">{t.trigger}</p>
                    </div>
                  </div>
                  <label className="flex items-center cursor-pointer">
                    <div className="relative">
                      <input type="checkbox" defaultChecked className="sr-only peer"/>
                      <div className="w-10 h-5 bg-gray-200 peer-checked:bg-blue-600 rounded-full transition-colors"/>
                      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5"/>
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── EMAIL LOG ── */}
      {activeTab==='log' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{logTotal} emails in log</p>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-indigo-900 text-white">
                  {['Template','Subject','Recipient','Ticket','Status','Sent At','Retries'].map(h=>(
                    <th key={h} className="text-left px-4 py-3 font-medium text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logLoading ? (
                  <tr><td colSpan={7} className="text-center py-10 text-gray-400">Loading...</td></tr>
                ) : logs.length===0 ? (
                  <tr><td colSpan={7} className="text-center py-16 text-gray-400">
                    <Mail className="w-10 h-10 mx-auto mb-2 opacity-20"/>No emails sent yet
                  </td></tr>
                ) : logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3"><span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-600">{log.templateKey}</span></td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{log.subject}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{log.recipient}</td>
                    <td className="px-4 py-3">{log.record ? <span className="text-xs font-mono text-blue-600">{log.record.recordNumber}</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[log.status]||'bg-gray-100 text-gray-600'}`}>{log.status}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-400">{log.sentAt ? format(new Date(log.sentAt),'dd MMM yyyy HH:mm') : '—'}</td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">{log.retryCount||0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {logTotal>20 && (
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>Page {logPage} of {Math.ceil(logTotal/20)}</span>
              <div className="flex gap-2">
                <button disabled={logPage<=1} onClick={()=>setLogPage(p=>p-1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
                <button disabled={logPage>=Math.ceil(logTotal/20)} onClick={()=>setLogPage(p=>p+1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {previewKey && previewTemplate && previewContent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-indigo-800 to-violet-900 rounded-t-2xl flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-xl">{previewTemplate.icon}</span>
                <div><h2 className="font-bold text-white text-lg">{previewTemplate.label}</h2><p className="text-xs text-white/60">{previewTemplate.trigger}</p></div>
              </div>
              <button onClick={()=>setPreviewKey(null)} className="text-white/60 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">To</p><p className="text-sm text-gray-700">{previewTemplate.recipients}</p></div>
              <div><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Subject</p><div className="bg-gray-50 rounded-xl px-4 py-2.5 text-sm font-mono text-gray-700">{previewContent.subject}</div></div>
              <div><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Body</p>
                <pre className="bg-gray-50 rounded-xl px-4 py-4 text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed overflow-auto max-h-72">{previewContent.body}</pre>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100 rounded-b-2xl flex-shrink-0">
              <button onClick={()=>{setPreviewKey(null); openEdit(previewKey);}} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">✏️ Edit Template</button>
              <button onClick={()=>setPreviewKey(null)} className="px-5 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-xl text-sm font-medium">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-indigo-800 to-violet-900 rounded-t-2xl flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-xl">{EMAIL_TEMPLATES.find(t=>t.key===editKey)?.icon}</span>
                <h2 className="font-bold text-white text-lg">Edit — {EMAIL_TEMPLATES.find(t=>t.key===editKey)?.label}</h2>
              </div>
              <button onClick={()=>setEditKey(null)} className="text-white/60 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Subject Line</label>
                <input value={editForm.subject} onChange={e=>setEditForm(f=>({...f,subject:e.target.value}))}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Body</label>
                <textarea value={editForm.body} onChange={e=>setEditForm(f=>({...f,body:e.target.value}))} rows={16}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none leading-relaxed"/>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 text-xs text-blue-700">
                Use <code className="bg-blue-100 px-1 rounded">{'{{variableName}}'}</code> placeholders — replaced automatically when emails are sent.
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100 rounded-b-2xl flex-shrink-0">
              <button onClick={()=>setEditKey(null)} className="px-5 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-xl text-sm font-medium">Cancel</button>
              <button onClick={saveEdit} className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium">💾 Save Template</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
