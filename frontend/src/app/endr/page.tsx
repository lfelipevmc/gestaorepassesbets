"use client";
import { useState, useEffect } from "react";
import AppShell from "@/components/AppShell";
import {
  getEndrEntity, updateEndrEntity,
  getEndrMonthly, getEndrAvailableOperators,
  addEndrMonthly, removeEndrMonthly,
} from "@/lib/api";

type ENDREntity = {
  id: number; name: string; cnpj?: string; website?: string;
  phone?: string; email?: string; address?: string; notes?: string;
};
type AssocRow = {
  assoc_id: number; operator_id: number; company_name: string;
  fantasy_name?: string; cnpj?: string; reference_month: string; notes?: string;
};
type OpOption = { id: number; company_name: string; fantasy_name?: string; cnpj?: string };

function toFirstOfMonth(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function EndrPage() {
  const today = new Date();
  const [month, setMonth] = useState(toFirstOfMonth(today));
  const [entity, setEntity] = useState<ENDREntity | null>(null);
  const [editEntity, setEditEntity] = useState(false);
  const [entityForm, setEntityForm] = useState<Partial<ENDREntity>>({});
  const [assocs, setAssocs] = useState<AssocRow[]>([]);
  const [available, setAvailable] = useState<OpOption[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<{ operator_ids: number[]; months: string[]; notes: string; opFilter: string }>({ operator_ids: [], months: [], notes: "", opFilter: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { loadEntity(); }, []);
  useEffect(() => { loadMonthly(); }, [month]);

  async function loadEntity() {
    try { const r = await getEndrEntity(); setEntity(r.data); setEntityForm(r.data); }
    catch { /* ignore */ }
  }

  async function loadMonthly() {
    try {
      const [ra, rv] = await Promise.all([getEndrMonthly(month), getEndrAvailableOperators(month)]);
      setAssocs(ra.data);
      setAvailable(rv.data);
    } catch { /* ignore */ }
  }

  async function saveEntity() {
    setSaving(true);
    try {
      const r = await updateEndrEntity(entityForm);
      setEntity(r.data);
      setEditEntity(false);
      setMsg("Cadastro salvo com sucesso.");
    } catch { setMsg("Erro ao salvar."); }
    setSaving(false);
  }

  async function handleAdd() {
    if (addForm.operator_ids.length === 0) return;
    // Se nenhum mês extra foi marcado, usa o mês em exibição
    const months = addForm.months.length > 0 ? addForm.months : [month.slice(0, 7)];
    setSaving(true);
    let ok = 0, fail = 0;
    for (const opId of addForm.operator_ids) {
      for (const ym of months) {
        try {
          await addEndrMonthly({ operator_id: opId, reference_month: `${ym}-01`, notes: addForm.notes || null });
          ok++;
        } catch { fail++; }
      }
    }
    setShowAdd(false);
    setAddForm({ operator_ids: [], months: [], notes: "", opFilter: "" });
    loadMonthly();
    setMsg(`${ok} associação(ões) registrada(s)${fail ? ` · ${fail} falhou(aram) (possivelmente já existiam)` : ""}.`);
    setSaving(false);
  }

  function toggleOp(id: number) {
    setAddForm(f => ({ ...f, operator_ids: f.operator_ids.includes(id) ? f.operator_ids.filter(x => x !== id) : [...f.operator_ids, id] }));
  }
  function toggleMonth(ym: string) {
    setAddForm(f => ({ ...f, months: f.months.includes(ym) ? f.months.filter(m => m !== ym) : [...f.months, ym] }));
  }

  async function handleRemove(assocId: number) {
    if (!confirm("Remover esta bet da lista ENDR do mês?")) return;
    await removeEndrMonthly(assocId);
    loadMonthly();
  }

  const displayMonth = new Date(month + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <AppShell>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">ENDR</h1>
          <p className="text-muted text-sm mt-1">Escritório Nacional de Direitos de Rateio</p>
        </div>
      </div>

      {msg && (
        <div className="bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          {msg}
          <button onClick={() => setMsg("")} className="ml-4 text-muted hover:text-white">✕</button>
        </div>
      )}

      {/* Cadastro ENDR */}
      <div className="bg-surface-card border border-surface-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Dados Cadastrais</h2>
          {!editEntity ? (
            <button onClick={() => setEditEntity(true)} className="px-4 py-1.5 text-sm bg-primary/15 text-primary border border-primary/30 rounded-lg hover:bg-primary/25 transition-colors">
              Editar
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditEntity(false)} className="px-4 py-1.5 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">Cancelar</button>
              <button onClick={saveEntity} disabled={saving} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors disabled:opacity-50">
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          )}
        </div>

        {editEntity ? (
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Nome", key: "name" },
              { label: "CNPJ", key: "cnpj" },
              { label: "Website", key: "website" },
              { label: "Telefone", key: "phone" },
              { label: "E-mail", key: "email" },
              { label: "Endereço", key: "address" },
            ].map(({ label, key }) => (
              <div key={key} className={key === "address" ? "col-span-2" : ""}>
                <label className="block text-xs text-muted mb-1">{label}</label>
                <input
                  className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  value={(entityForm as any)[key] || ""}
                  onChange={e => setEntityForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="col-span-2">
              <label className="block text-xs text-muted mb-1">Observações</label>
              <textarea
                rows={3}
                className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                value={entityForm.notes || ""}
                onChange={e => setEntityForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Nome", val: entity?.name },
              { label: "CNPJ", val: entity?.cnpj },
              { label: "Website", val: entity?.website },
              { label: "Telefone", val: entity?.phone },
              { label: "E-mail", val: entity?.email },
              { label: "Endereço", val: entity?.address },
            ].map(({ label, val }) => (
              <div key={label}>
                <p className="text-xs text-muted">{label}</p>
                <p className="text-sm text-white mt-0.5">{val || <span className="text-slate-500 italic">—</span>}</p>
              </div>
            ))}
            {entity?.notes && (
              <div className="col-span-3">
                <p className="text-xs text-muted">Observações</p>
                <p className="text-sm text-white mt-0.5">{entity.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Visão Mensal */}
      <div className="bg-surface-card border border-surface-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-white">Bets Associadas</h2>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted">Mês:</label>
              <input
                type="month"
                value={month.slice(0, 7)}
                onChange={e => setMonth(e.target.value + "-01")}
                className="bg-surface-border border border-surface-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
              />
            </div>
            <span className="text-sm text-muted capitalize">{displayMonth} — {assocs.length} bet{assocs.length !== 1 ? "s" : ""}</span>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
          >
            + Adicionar Bet
          </button>
        </div>

        {showAdd && (
          <div className="mb-4 bg-surface-border border border-surface-border rounded-lg p-4 space-y-4">
            <div>
              <label className="block text-xs text-muted mb-1">Agentes Operadores <span className="text-slate-400">(marque um ou vários)</span></label>
              <input
                className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary mb-2"
                placeholder="Filtrar por nome ou CNPJ..."
                value={addForm.opFilter}
                onChange={e => setAddForm(f => ({ ...f, opFilter: e.target.value }))}
              />
              <div className="max-h-48 overflow-y-auto border border-surface-border rounded-lg divide-y divide-surface-border bg-surface-card">
                {available
                  .filter(op => {
                    const t = addForm.opFilter.toLowerCase();
                    if (!t) return true;
                    return op.company_name.toLowerCase().includes(t) || (op.fantasy_name || "").toLowerCase().includes(t) || (op.cnpj || "").includes(t);
                  })
                  .map(op => (
                    <label key={op.id} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-surface cursor-pointer">
                      <input type="checkbox" checked={addForm.operator_ids.includes(op.id)} onChange={() => toggleOp(op.id)} />
                      <span className="flex-1">{op.company_name}{op.fantasy_name ? ` (${op.fantasy_name})` : ""}</span>
                      <span className="text-xs text-muted font-mono">{op.cnpj || ""}</span>
                    </label>
                  ))}
                {available.length === 0 && <p className="px-3 py-2 text-xs text-muted">Todas as bets já estão associadas neste mês.</p>}
              </div>
              {addForm.operator_ids.length > 0 && <p className="text-xs text-primary mt-1">{addForm.operator_ids.length} selecionada(s)</p>}
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Meses <span className="text-slate-400">(vazio = apenas {displayMonth}; marque para incluir vários meses do ano)</span></label>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 12 }, (_, i) => {
                  const y = month.slice(0, 4);
                  const ym = `${y}-${String(i + 1).padStart(2, "0")}`;
                  const label = new Date(`${ym}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short" });
                  const checked = addForm.months.includes(ym);
                  return (
                    <label key={ym} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border cursor-pointer capitalize ${checked ? "bg-primary/15 text-primary border-primary/30" : "border-surface-border text-slate-300 hover:bg-surface"}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleMonth(ym)} />
                      {label}/{y.slice(2)}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1">Observação (opcional)</label>
                <input
                  className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  placeholder="ex: lista ENDR de 29/04..."
                  value={addForm.notes}
                  onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <button onClick={handleAdd} disabled={saving || addForm.operator_ids.length === 0} className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors">
                {saving ? "Registrando..." : "Adicionar"}
              </button>
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {assocs.length === 0 ? (
          <div className="text-center py-10 text-muted text-sm">
            Nenhuma bet associada ao ENDR em {displayMonth}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left py-2 px-3 text-xs text-muted font-medium">Razão Social</th>
                  <th className="text-left py-2 px-3 text-xs text-muted font-medium">Nome Fantasia</th>
                  <th className="text-left py-2 px-3 text-xs text-muted font-medium">CNPJ</th>
                  <th className="text-left py-2 px-3 text-xs text-muted font-medium">Observação</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {assocs.map(a => (
                  <tr key={a.assoc_id} className="border-b border-surface-border/50 hover:bg-surface-border/30 transition-colors">
                    <td className="py-2.5 px-3 text-white font-medium">
                      <a href={`/operadores/${a.operator_id}`} className="hover:text-primary transition-colors">
                        {a.company_name}
                      </a>
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">{a.fantasy_name || "—"}</td>
                    <td className="py-2.5 px-3 text-slate-400 font-mono text-xs">{a.cnpj || "—"}</td>
                    <td className="py-2.5 px-3 text-slate-400">{a.notes || "—"}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => handleRemove(a.assoc_id)}
                        className="px-3 py-1 text-xs text-danger border border-danger/30 rounded hover:bg-danger/10 transition-colors"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </AppShell>
  );
}
