"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getConfederations, getCollections, getPayments, getFinanceByConfederation, createConfederation } from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";
import { toast } from "@/components/ui/Toast";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
function monthLabel(iso?: string) {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  return `${MESES[parseInt(m) - 1]}/${y}`;
}

export default function ConfederacoesPage() {
  const [confederations, setConfederations] = useState<any[]>([]);
  const [finance, setFinance] = useState<any[]>([]);
  const [cycleStats, setCycleStats] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", acronym: "" });

  async function load() {
    setLoading(true);
    try {
      const [confs, fin, cycles] = await Promise.all([
        getConfederations(), getFinanceByConfederation(), getCollections(),
      ]);
      setConfederations(confs.data);
      setFinance(fin.data || []);

      // Ciclo mais recente de cada confederação → adimplência da competência vigente
      // (contagem por Bet do ciclo, não acumulada — reflete a realidade do mês)
      const latest: Record<number, any> = {};
      for (const c of cycles.data) {
        if (!latest[c.confederation_id] || c.reference_month > latest[c.confederation_id].reference_month) {
          latest[c.confederation_id] = c;
        }
      }
      const stats: Record<number, any> = {};
      await Promise.all(Object.values(latest).map(async (cyc: any) => {
        try {
          const r = await getPayments({ cycle_id: cyc.id, limit: 300 });
          const pays = r.data;
          const count = (s: string[]) => pays.filter((p: any) => s.includes(p.status)).length;
          const adimplentes = count(["paid", "report_pending"]);
          const naoCobraveis = count(["not_sports", "judicialized"]);
          const base = pays.length - naoCobraveis;
          stats[cyc.confederation_id] = {
            month: cyc.reference_month, cycle_id: cyc.id, total: pays.length,
            adimplentes, inadimplentes: count(["overdue", "pending"]),
            rate: base > 0 ? Math.round((adimplentes / base) * 100) : 0,
          };
        } catch { /* noop */ }
      }));
      setCycleStats(stats);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.acronym) { toast.warn("Preencha nome e sigla."); return; }
    setCreating(true);
    try {
      await createConfederation({ name: form.name, acronym: form.acronym.toUpperCase() });
      setShowCreate(false); setForm({ name: "", acronym: "" }); load();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Erro ao criar confederação. A sigla pode já existir.");
    } finally { setCreating(false); }
  }

  return (
    <AppShell>
      <Header title="Confederações" icon="🏆"
        help="Os clientes do escritório (CBTM, CBT, CBW, CBH). Cada card mostra a situação da competência vigente calculada em tempo real a partir da base central: adimplentes, inadimplentes, ENDR e valores recebidos. Clique para abrir a visão geral dos operadores, ciclos, regras de rateio e repasses ENDR."
        subtitle="Clientes do escritório — situação da competência vigente e financeiro"
        actions={<button onClick={() => setShowCreate(true)} className="btn-primary">+ Nova Confederação</button>} />
      {loading ? <div className="text-muted">Carregando...</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {confederations.map(conf => {
            const st = cycleStats[conf.id];
            const fin = finance.find(f => f.confederation_id === conf.id);
            return (
              <div key={conf.id} className="card">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-primary/15 rounded-xl flex items-center justify-center">
                      <span className="text-primary font-bold text-sm">{conf.acronym}</span>
                    </div>
                    <div>
                      <h2 className="font-bold text-white leading-tight">{conf.name}</h2>
                      <p className="text-muted text-xs mt-0.5">
                        {st ? <>Competência vigente: <span className="text-slate-300 capitalize">{monthLabel(st.month)}</span></> : "Nenhum ciclo de cobrança criado"}
                      </p>
                    </div>
                  </div>
                  {st && (
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${st.rate >= 70 ? "text-success" : st.rate >= 40 ? "text-warning" : "text-danger"}`}>{st.rate}%</p>
                      <p className="text-[11px] text-muted">adimplência do mês</p>
                    </div>
                  )}
                </div>

                {/* Situação do ciclo vigente (por Bet, não acumulado) */}
                {st ? (
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-success/10 rounded-lg p-2.5 text-center">
                      <p className="text-lg font-bold text-success">{st.adimplentes}</p>
                      <p className="text-[11px] text-muted">Adimplentes</p>
                    </div>
                    <div className="bg-danger/10 rounded-lg p-2.5 text-center">
                      <p className="text-lg font-bold text-danger">{st.inadimplentes}</p>
                      <p className="text-[11px] text-muted">Inadimplentes</p>
                    </div>
                    <div className="bg-surface rounded-lg p-2.5 text-center">
                      <p className="text-lg font-bold text-white">{st.total}</p>
                      <p className="text-[11px] text-muted">Bets no ciclo</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-surface rounded-lg p-3 text-center text-xs text-muted mb-4">
                    Crie um ciclo em Cobranças para acompanhar a competência.
                  </div>
                )}

                {/* Financeiro (acumulado real) */}
                <div className="space-y-1.5 text-sm mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Total recebido (Fase 1):</span>
                    <span className="font-semibold text-success">{formatCurrency(fin?.receita_total || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Repassado a beneficiários (Fase 2):</span>
                    <span className="font-semibold text-slate-200">{formatCurrency(fin?.total_repassado || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Pendente de repasse:</span>
                    <span className={`font-semibold ${(fin?.pendente_repasse || 0) > 0 ? "text-warning" : "text-slate-200"}`}>{formatCurrency(fin?.pendente_repasse || 0)}</span>
                  </div>
                  {(fin?.redistribuicoes_vencidas || 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-danger text-xs">⚠ Repartições com prazo vencido:</span>
                      <span className="font-bold text-danger">{fin.redistribuicoes_vencidas}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Link href={`/confederacoes/${conf.id}`} className="btn-secondary flex-1 text-center">Ver Detalhes</Link>
                  {st && <Link href={`/cobrancas/${st.cycle_id}`} className="btn-secondary flex-1 text-center">Abrir Ciclo Vigente</Link>}
                </div>
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
