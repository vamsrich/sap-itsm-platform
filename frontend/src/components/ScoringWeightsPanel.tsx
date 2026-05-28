import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { scoringConfigsApi } from '../api/services';
import { getErrorMessage } from '../api/client';
import { Plus, Pencil, Trash2, RotateCcw, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';

const PRIORITIES = ['ALL', 'P1', 'P2', 'P3', 'P4'] as const;
const FACTORS = [
  { key: 'moduleWeight', label: 'Mod' },
  { key: 'subModuleWeight', label: 'Sub' },
  { key: 'levelWeight', label: 'Lvl' },
  { key: 'workloadWeight', label: 'Load' },
  { key: 'availabilityWeight', label: 'Avail' },
] as const;

const DEFAULTS = {
  moduleWeight: 30,
  subModuleWeight: 20,
  levelWeight: 25,
  workloadWeight: 15,
  availabilityWeight: 10,
};

type Weights = typeof DEFAULTS;

interface Config extends Weights {
  id: string;
  customerId: string;
  priority: string;
}

interface Props {
  customerId: string;
  customerName: string;
}

export default function ScoringWeightsPanel({ customerId, customerName }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ priority: string; weights: Weights } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['scoring-configs', customerId],
    queryFn: () => scoringConfigsApi.list(customerId).then((r) => r.data),
  });

  const configs: Config[] = data?.configs || [];
  const byPriority = useMemo(() => {
    const map: Record<string, Config> = {};
    configs.forEach((c) => (map[c.priority] = c));
    return map;
  }, [configs]);

  const sum = editing ? FACTORS.reduce((s, f) => s + (editing.weights[f.key] || 0), 0) : 0;
  const sumValid = sum === 100;

  const openEdit = (priority: string) => {
    const existing = byPriority[priority];
    setEditing({
      priority,
      weights: existing ? { ...existing } : { ...DEFAULTS },
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!sumValid) {
      toast.error(`Weights must sum to 100 (currently ${sum})`);
      return;
    }
    setSaving(true);
    try {
      const existing = byPriority[editing.priority];
      if (existing) {
        await scoringConfigsApi.update(existing.id, editing.weights);
      } else {
        await scoringConfigsApi.create({ customerId, priority: editing.priority, ...editing.weights });
      }
      toast.success(`${editing.priority} weights saved`);
      qc.invalidateQueries({ queryKey: ['scoring-configs', customerId] });
      setEditing(null);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (config: Config) => {
    if (!confirm(`Remove the ${config.priority} override?`)) return;
    try {
      await scoringConfigsApi.delete(config.id);
      toast.success(`${config.priority} override removed`);
      qc.invalidateQueries({ queryKey: ['scoring-configs', customerId] });
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const handleResetDefault = async () => {
    const defaultConfig = byPriority['ALL'];
    if (!defaultConfig) return;
    if (!confirm('Reset the default to 30/20/25/15/10?')) return;
    try {
      await scoringConfigsApi.update(defaultConfig.id, DEFAULTS);
      toast.success('Default reset');
      qc.invalidateQueries({ queryKey: ['scoring-configs', customerId] });
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-800">Scoring Weights</span>
        <span className="text-xs text-gray-400">{customerName} · 100-pt scale, 5 factors · Default applies unless a priority is overridden</span>
      </div>

      {isLoading ? (
        <div className="px-5 py-4 text-xs text-gray-400">Loading…</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="pl-5 pr-2 py-1.5 w-20">Priority</th>
              {FACTORS.map((f) => (
                <th key={f.key} className="px-2 py-1.5 text-center w-14">{f.label}</th>
              ))}
              <th className="px-2 py-1.5 text-center w-12">Sum</th>
              <th className="pr-3 py-1.5 text-right">&nbsp;</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {PRIORITIES.map((p) => {
              const cfg = byPriority[p];
              const isEditing = editing?.priority === p;
              const isDefault = p === 'ALL';

              if (isEditing) {
                return (
                  <tr key={p} className="bg-blue-50/40">
                    <td className="pl-5 pr-2 py-1.5 font-semibold text-gray-700">{isDefault ? 'Default' : p}</td>
                    {FACTORS.map((f) => (
                      <td key={f.key} className="px-1 py-1 text-center">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={editing.weights[f.key]}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              weights: {
                                ...editing.weights,
                                [f.key]: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)),
                              },
                            })
                          }
                          className="w-12 border border-gray-300 rounded px-1 py-0.5 text-center text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        />
                      </td>
                    ))}
                    <td className={`px-2 py-1 text-center font-bold ${sumValid ? 'text-green-600' : 'text-red-600'}`}>
                      {sum}
                    </td>
                    <td className="pr-3 py-1 text-right">
                      <button
                        onClick={handleSave}
                        disabled={!sumValid || saving}
                        className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Save"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              }

              if (cfg) {
                const rowSum = FACTORS.reduce((s, f) => s + cfg[f.key], 0);
                return (
                  <tr key={p} className="hover:bg-gray-50 group">
                    <td className="pl-5 pr-2 py-1.5">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isDefault ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                        {isDefault ? 'DEFAULT' : p}
                      </span>
                    </td>
                    {FACTORS.map((f) => (
                      <td key={f.key} className="px-2 py-1.5 text-center text-gray-700 font-medium">{cfg[f.key]}</td>
                    ))}
                    <td className="px-2 py-1.5 text-center text-gray-400">{rowSum}</td>
                    <td className="pr-3 py-1 text-right">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5">
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1 text-orange-400 hover:bg-orange-50 rounded"
                          title="Edit"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        {isDefault ? (
                          <button
                            onClick={handleResetDefault}
                            className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Reset to 30/20/25/15/10"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDelete(cfg)}
                            className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded"
                            title="Remove override"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }

              // No override exists for this priority
              return (
                <tr key={p} className="hover:bg-gray-50 group">
                  <td className="pl-5 pr-2 py-1.5 text-[10px] font-semibold text-gray-300">{p}</td>
                  {FACTORS.map((f) => (
                    <td key={f.key} className="px-2 py-1.5 text-center text-gray-200">—</td>
                  ))}
                  <td className="px-2 py-1.5 text-center text-gray-200">—</td>
                  <td className="pr-3 py-1 text-right">
                    <button
                      onClick={() => openEdit(p)}
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50 rounded transition-opacity"
                    >
                      <Plus className="w-3 h-3" /> Override
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
