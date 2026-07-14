"use client";
import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { createDirectPayment } from "@/lib/api";
import { toast } from "@/components/ui/Toast";

/**
 * Registro de repasse recebido de um Agente Operador (lançamento na BASE CENTRAL —
 * direct_payments). Componente ÚNICO reutilizado pelo Financeiro e pela aba da
 * Confederação, evitando duplicidade de código e de lançamentos.
 */
export default function DirectPaymentModal({
  open, onClose, onSaved, operators, confederations, fixedConfederationId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  operators: any[];
  confederations: any[];
  fixedConfederationId?: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    operator_id: "", confederation_id: fixedConfederationId ? String(fixedConfederationId) : "",
    reference_month: new Date().toISOString().slice(0, 7), amount_received: "", received_date: today, notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [opSearch, setOpSearch] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const confId = fixedConfederationId || Number(f.confederation_id);
    if (!f.operator_id) { toast.warn("Selecione o agente operador."); return; }
    if (!confId) { toast.warn("Selecione a confederação."); return; }
    if (!f.amount_received || parseFloat(f.amount_received) <= 0) { toast.warn("Informe o valor recebido."); return; }
    setSaving(true);
    try {
      await createDirectPayment(Number(f.operator_id), {
        confederation_id: confId,
        reference_month: f.reference_month ? f.reference_month + "-01" : null,
        amount_received: parseFloat(f.amount_received),
        received_date: f.received_date,
        notes: f.notes || undefined,
      });
      toast.success("Repasse registrado na base central — refletido em todas as telas.");
      setF({ operator_id: "", confederation_id: fixedConfederationId ? String(fixedConfederationId) : "",
             reference_month: new Date().toISOString().slice(0, 7), amount_received: "", received_date: today, notes: "" });
      onSaved(); onClose();
    } catch (err: any) { toast.error(err.response?.data?.detail || "Erro ao registrar o repasse."); }
    finally { setSaving(false); }
  }

  const filtered = operators.filter((o: any) => {
    if (!opSearch) return true;
    const t = opSearch.toLowerCase();
    return (o.fantasy_name || "").toLowerCase().includes(t) || (o.company_name || "").toLowerCase().includes(t) || (o.cnpj || "").includes(t);
  });

  return (
    <Modal isOpen={open} onClose={onClose} title="Registrar Repasse de Agente Operador">
      <form onSubmit={save} className="space-y-4">
        <p className="text-xs text-muted">Lançamento gravado na <b>base central</b> (fonte única): aparece no Financeiro, no ciclo da competência, na ficha da Bet e nos relatórios — sem redigitação.</p>
        <div>
          <label className="label">Agente Operador *</label>
          <input className="input mb-2" placeholder="Pesquisar por nome ou CNPJ..." value={opSearch} onChange={e => setOpSearch(e.target.value)} />
          <select className="input" required value={f.operator_id} onChange={e => setF(x => ({ ...x, operator_id: e.target.value }))}>
            <option value="">Selecione...</option>
            {filtered.map((o: any) => <option key={o.id} value={o.id}>{o.fantasy_name || o.company_name}</option>)}
          </select>
        </div>
        {!fixedConfederationId && (
          <div>
            <label className="label">Confederação *</label>
            <select className="input" required value={f.confederation_id} onChange={e => setF(x => ({ ...x, confederation_id: e.target.value }))}>
              <option value="">Selecione...</option>
              {confederations.map((c: any) => <option key={c.id} value={c.id}>{c.acronym} — {c.name}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Competência <span className="normal-case text-slate-500">(vazio = a definir)</span></label>
            <input type="month" className="input" value={f.reference_month} onChange={e => setF(x => ({ ...x, reference_month: e.target.value }))} />
          </div>
          <div>
            <label className="label">Recebido em *</label>
            <input type="date" className="input" required value={f.received_date} onChange={e => setF(x => ({ ...x, received_date: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="label">Valor recebido (R$) *</label>
          <input type="number" step="0.01" min="0.01" className="input" placeholder="0,00" required
            value={f.amount_received} onChange={e => setF(x => ({ ...x, amount_received: e.target.value }))} />
        </div>
        <div>
          <label className="label">Observações</label>
          <textarea className="input h-16 resize-none" value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} />
        </div>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Registrar Repasse"}</button>
        </div>
      </form>
    </Modal>
  );
}
