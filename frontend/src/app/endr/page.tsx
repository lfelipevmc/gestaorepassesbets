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
  const [addForm, setAddForm] = useState({ operator_id: "", notes: "" });
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
    if (!addForm.operator_id) return;
    setSaving(true);
    try {
      await addEndrMonthly({
        operator_id: Number(addForm.operator_id),
        reference_month: month,
        notes: addForm.notes || null,
      });
      setShowAdd(false);
      setAddForm({ operator_id: "", notes: "" });
      loadMonthly();
    } catch { setMsg("Erro ao adicionar associação."); }
    setSaving(false);
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
          <div className="mb-4 bg-surface-border border border-surface-border rounded-lg p-4 flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Agente Operador</label>
              <select
                className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                value={addForm.operator_id}
                onChange={e => setAddForm(f => ({ ...f, operator_id: e.target.value }))}
              >
                <option value="">Selecione...</option>
                {available.map(op => (
                  <option key={op.id} value={op.id}>
                    {op.company_name}{op.fantasy_name ? ` (${op.fantasy_name})` : ""}{op.cnpj ? ` — ${op.cnpj}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-64">
              <label className="block text-xs text-muted mb-1">Observação (opcional)</label>
              <input
                className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                placeholder="ex: decisão judicial nº..."
                value={addForm.notes}
                onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <button onClick={handleAdd} disabled={saving || !addForm.operator_id} className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors">
              Adicionar
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">
              Cancelar
            </button>
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
