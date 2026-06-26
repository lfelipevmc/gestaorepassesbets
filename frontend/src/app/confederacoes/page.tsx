"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getConfederations, getPayments, createConfederation } from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";

export default function ConfederacoesPage() {
  const [confederations, setConfederations] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", acronym: "" });

  function load() {
    Promise.all([getConfederations(), getPayments({ limit: 1000 })])
      .then(([c, p]) => { setConfederations(c.data); setPayments(p.data); })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.acronym) { alert("Preencha nome e sigla."); return; }
    setCreating(true);
    try {
      await createConfederation({ name: form.name, acronym: form.acronym.toUpperCase() });
      setShowCreate(false); setForm({ name: "", acronym: "" }); load();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao criar confederação. A sigla pode já existir.");
    } finally { setCreating(false); }
  }

  return (
    <AppShell>
      <Header title="Confederações" subtitle="Clientes do escritório — confederações contratantes"
        actions={<button onClick={() => setShowCreate(true)} className="btn-primary">+ Nova Confederação</button>} />
      {loading ? <div className="text-muted">Carregando...</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {confederations.map(conf => {
            const confPays = payments.filter(p => p.confederation_id === conf.id);
            const paid = confPays.filter(p => p.status === "paid").length;
            const reportPending = confPays.filter(p => p.status === "report_pending").length;
            const overdue = confPays.filter(p => p.status === "overdue" || p.status === "pending").length;
            const adimplentes = paid + reportPending;
            const rate = confPays.length > 0 ? Math.round((adimplentes / confPays.length) * 100) : 0;
            const totalReceived = confPays.reduce((s, p) => s + parseFloat(p.amount_paid || 0), 0);

            return (
              <div key={conf.id} className="card">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="w-12 h-12 bg-primary/15 rounded-xl flex items-center justify-center mb-3">
                      <span className="text-primary font-bold text-sm">{conf.acronym}</span>
                    </div>
                    <h2 className="font-bold text-white">{conf.name}</h2>
                    <p className="text-muted text-sm">{conf.acronym}</p>
                  </div>
                  <div className={`text-2xl font-bold ${rate >= 70 ? "text-success" : rate >= 40 ? "text-warning" : "text-danger"}`}>
                    {rate}%
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 mb-4">
                  <div className="bg-success/10 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-success">{paid}</p>
                    <p className="text-xs text-muted">Adimpl.</p>
                  </div>
                  <div className="bg-warning/10 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-warning">{reportPending}</p>
                    <p className="text-xs text-muted">Pend. Rel.</p>
                  </div>
                  <div className="bg-danger/10 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-danger">{overdue}</p>
                    <p className="text-xs text-muted">Inadimpl.</p>
                  </div>
                  <div className="bg-surface rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-white">{confPays.length}</p>
                    <p className="text-xs text-muted">Total</p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm mb-4">
                  <span className="text-muted">Total Recebido:</span>
                  <span className="font-semibold text-success">{formatCurrency(totalReceived)}</span>
                </div>

                <Link href={`/confederacoes/${conf.id}`} className="btn-secondary block text-center">
                  Ver Detalhes
                </Link>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nova Confederação">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Nome da confederação *</label>
            <input className="input" placeholder="Ex.: Confederação Brasileira de Vôlei" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Sigla * <span className="text-muted font-normal">(chave {"{confederacaosigla}"})</span></label>
            <input className="input uppercase" placeholder="Ex.: CBV" value={form.acronym} onChange={e => setForm(f => ({ ...f, acronym: e.target.value }))} />
            <p className="text-xs text-muted mt-1">A sigla é usada nas notificações automáticas pela chave {"{confederacaosigla}"}.</p>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={creating} className="btn-primary">{creating ? "Criando..." : "Criar Confederação"}</button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
