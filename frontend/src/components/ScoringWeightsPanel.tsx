import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { scoringConfigsApi } from '../api/services';
import { getErrorMessage } from '../api/client';
import { Plus, Pencil, Trash2, RotateCcw, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';

const PRIORITIES = ['ALL', 'P1', 'P2', 'P3', 'P4'] as const;
const FACTORS = [
  { key: 'moduleWeight', label: 'Module' },
  { key: 'subModuleWeight', label: 'Sub-Module' },
  { key: 'levelWeight', label: 'Level' },
  { key: 'workloadWeight', label: 'Workload' },
  { key: 'availabilityWeight', label: 'Availability' },
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

  const sum = editing
    ? FACTORS.reduce((s, f) => s + (editing.weights[f.key] || 0), 0)
    : 0;
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
        await scoringConfigsApi.create({
          customerId,
          priority: editing.priority,
          ...editing.weights,
        });
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
    if (!confirm(`Remove the ${config.priority} override? Customer will fall back to the default weights for ${config.priority} tickets.`)) return;
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
    if (!confirm('Reset the default (ALL) row to 30/20/25/15/10?')) return;
    try {
      await scoringConfigsApi.update(defaultConfig.id, DEFAULTS);
      toast.success('Default weights reset');
      qc.invalidateQueries({ queryKey: ['scoring-configs', customerId] });
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-800">Scoring Weights — {customerName}</span>
        <span className="text-xs text-gray-400">
          Agents are scored on a 100-point scale across 5 factors. The "Default" row applies to every priority unless an override is defined below.
        </span>
      </div>

      {isLoading ? (
        <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-white border-b border-gray-100">
            <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2.5 w-24">Priority</th>
              {FACTORS.map((f) => (
                <th key={f.key} className="px-2 py-2.5 text-center w-20">{f.label}</th>
              ))}
              <th className="px-2 py-2.5 text-center w-14">Sum</th>
              <th className="px-3 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {PRIORITIES.map((p) => {
              const cfg = byPriority[p];
              const isEditing = editing?.priority === p;
              const isDefault = p === 'ALL';

              if (isEditing) {
                return (
                  <tr key={p} className="bg-blue-50/40">
                    <td className="px-4 py-2 font-semibold text-gray-800">
                      {isDefault ? 'Default' : p}
                    </td>
                    {FACTORS.map((f) => (
                      <td key={f.key} className="px-2 py-2 text-center">
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
                          className="w-16 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                      </td>
                    ))}
                    <td className={`px-2 py-2 text-center font-bold text-sm ${sumValid ? 'text-green-600' : 'text-red-600'}`}>
                      {sum} {sumValid ? '✓' : ''}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={handleSave}
                        disabled={!sumValid || saving}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed mr-1"
                      >
                        <Check className="w-3.5 h-3.5" /> Save
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-100"
                      >
                        <X className="w-3.5 h-3.5" /> Cancel
                      </button>
                    </td>
                  </tr>
                );
              }

              if (cfg) {
                const rowSum = FACTORS.reduce((s, f) => s + cfg[f.key], 0);
                return (
                  <tr key={p} className="hover:bg-gray-50 group">
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${isDefault ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-700'}`}>
                        {isDefault ? 'Default' : p}
                      </span>
                    </td>
                    {FACTORS.map((f) => (
                      <td key={f.key} className="px-2 py-2.5 text-center text-gray-800 font-medium">{cfg[f.key]}</td>
                    ))}
                    <td className="px-2 py-2.5 text-center text-gray-500 font-medium">{rowSum}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 text-orange-500 hover:bg-orange-50 rounded-lg"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {isDefault ? (
                          <button
                            onClick={handleResetDefault}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                            title="Reset to 30/20/25/15/10"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDelete(cfg)}
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg"
                            title="Remove override"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }

              // No row exists for this priority → show "+ override"
              return (
                <tr key={p} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs font-semibold text-gray-400">{p}</td>
                  {FACTORS.map((f) => (
                    <td key={f.key} className="px-2 py-2.5 text-center text-gray-300">—</td>
                  ))}
                  <td className="px-2 py-2.5 text-center text-gray-300">—</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => openEdit(p)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg"
                    >
                      <Plus className="w-3.5 h-3.5" /> Override
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
