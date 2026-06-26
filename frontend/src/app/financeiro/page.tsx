"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import {
  getFinanceSummary, getFinanceByConfederation, getConfederations,
  getRedistributions, createRedistribution, payRedistributionItem, deleteRedistribution,
  getBeneficiaries, createBeneficiary, updateBeneficiary, deleteBeneficiary,
  getDistributionRules, getFinanceEmails, syncEmails,
  getDirectPayments, createDirectPayment, deleteDirectPayment, getOperators,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TABS = ["Resumo", "Repasses (Fase 2)", "Lançamentos Avulsos", "Beneficiários", "E-mails"];
const BTYPES: Record<string, string> = { confederacao: "Confederação", atleta: "Atleta", clube: "Clube/Entidade", federacao: "Federação", outro: "Outro" };

function todayISO() { const d = new Date(); return d.toISOString().slice(0, 10); }

export default function FinanceiroPage() {
  const [tab, setTab] = useState(0);
  const [confs, setConfs] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 3500); }

  // Resumo
  const [summary, setSummary] = useState<any>(null);
  const [byConf, setByConf] = useState<any[]>([]);

  // Repasses
  const [redis, setRedis] = useState<any[]>([]);
  const [redisConf, setRedisConf] = useState<string>("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [showNew, setShowNew] = useState(false);

  // Beneficiários
  const [beneficiaries, setBeneficiaries] = useState<any[]>([]);
  const [benConf, setBenConf] = useState<string>("");
  const [editBen, setEditBen] = useState<any>(null);

  // Lançamentos Avulsos
  const [directPayments, setDirectPayments] = useState<any[]>([]);
  const [directConfFilter, setDirectConfFilter] = useState("");
  const [directOpFilter, setDirectOpFilter] = useState("");
  const [operators, setOperators] = useState<any[]>([]);
  const [showDirectForm, setShowDirectForm] = useState(false);
  const [directForm, setDirectForm] = useState({ operator_id: "", confederation_id: "", reference_month: new Date().toISOString().slice(0, 7), amount_received: "", received_date: new Date().toISOString().slice(0, 10), notes: "" });
  const [savingDirect, setSavingDirect] = useState(false);

  // E-mails
  const [emails, setEmails] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    getConfederations().then(r => setConfs(r.data));
    getOperators({ limit: 300 }).then(r => setOperators(r.data));
  }, []);
  useEffect(() => {
    if (tab === 0) { getFinanceSummary().then(r => setSummary(r.data)); getFinanceByConfederation().then(r => setByConf(r.data)); }
    if (tab === 1) loadRedis();
    if (tab === 2) loadDirectPayments();
    if (tab === 3) loadBen();
    if (tab === 4) getFinanceEmails().then(r => setEmails(r.data));
  }, [tab]);

  function loadRedis() {
    const params: any = {};
    if (redisConf) params.confederation_id = Number(redisConf);
    if (onlyOverdue) params.overdue = true;
    getRedistributions(params).then(r => setRedis(r.data));
  }
  useEffect(() => { if (tab === 1) loadRedis(); }, [redisConf, onlyOverdue]);

  function loadDirectPayments() {
    const params: any = {};
    if (directConfFilter) params.confederation_id = Number(directConfFilter);
    if (directOpFilter) params.operator_id = Number(directOpFilter);
    getDirectPayments(params).then(r => setDirectPayments(r.data));
  }
  useEffect(() => { if (tab === 2) loadDirectPayments(); }, [directConfFilter, directOpFilter]);

  async function handleSaveDirectPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!directForm.operator_id) { alert("Selecione o agente operador."); return; }
    setSavingDirect(true);
    try {
      await createDirectPayment(Number(directForm.operator_id), {
        confederation_id: Number(directForm.confederation_id),
        reference_month: directForm.reference_month + "-01",
        amount_received: parseFloat(directForm.amount_received),
        received_date: directForm.received_date,
        notes: directForm.notes || undefined,
      });
      setShowDirectForm(false);
      setDirectForm({ operator_id: "", confederation_id: confs[0]?.id?.toString() || "", reference_month: new Date().toISOString().slice(0, 7), amount_received: "", received_date: new Date().toISOString().slice(0, 10), notes: "" });
      loadDirectPayments();
      flash("Lançamento registrado.");
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao registrar lançamento.");
    }
    setSavingDirect(false);
  }

  async function handleDeleteDirect(opId: number, payId: number) {
    if (!confirm("Excluir este lançamento?")) return;
    await deleteDirectPayment(opId, payId);
    loadDirectPayments();
    flash("Lançamento excluído.");
  }

  function loadBen() {
    const params: any = {};
    if (benConf) params.confederation_id = Number(benConf);
    getBeneficiaries(params).then(r => setBeneficiaries(r.data));
  }
  useEffect(() => { if (tab === 3) loadBen(); }, [benConf]);

  async function doSync() {
    setSyncing(true);
    try {
      const r = await syncEmails();
      if (!r.data.configured) flash("Integração de e-mail (M365) não configurada no .env.");
      else flash(`Sincronizado: ${r.data.imported} importados, ${r.data.matched} casados.`);
      getFinanceEmails().then(rr => setEmails(rr.data));
    } catch { flash("Erro ao sincronizar e-mails."); }
    setSyncing(false);
  }

  const confName = (id: number) => confs.find(c => c.id === id)?.acronym || `#${id}`;

  return (
    <AppShell>
      <Header title="Financeiro" subtitle="Receitas, cobranças e repasses aos beneficiários finais" />
      {msg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{msg}</div>}

      <div className="flex gap-1 border-b border-surface-border mb-6">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={"px-4 py-2.5 text-sm font-medium border-b-2 transition-colors " + (tab === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-slate-200")}>
            {t}
          </button>
        ))}
      </div>

      {/* RESUMO */}
      {tab === 0 && summary && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-muted mb-2 uppercase">Receitas (Fase 1 — recebido)</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="card"><p className="text-xs text-muted">Total Recebido</p><p className="text-2xl font-bold text-success">{formatCurrency(summary.receita.total)}</p></div>
              <div className="card"><p className="text-xs text-muted">Repasse Direto</p><p className="text-2xl font-bold text-white">{formatCurrency(summary.receita.repasse_direto)}</p></div>
              <div className="card"><p className="text-xs text-muted">Via ENDR</p><p className="text-2xl font-bold text-white">{formatCurrency(summary.receita.via_endr)}</p></div>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-muted mb-2 uppercase">Repasses aos beneficiários (Fase 2)</h3>
            <div className="grid grid-cols-4 gap-4">
              <div className="card"><p className="text-xs text-muted">A Repassar</p><p className="text-2xl font-bold text-white">{formatCurrency(summary.repasses.total_a_repassar)}</p></div>
              <div className="card"><p className="text-xs text-muted">Já Repassado</p><p className="text-2xl font-bold text-success">{formatCurrency(summary.repasses.total_repassado)}</p></div>
              <div className="card"><p className="text-xs text-muted">Pendente</p><p className="text-2xl font-bold text-warning">{formatCurrency(summary.repasses.pendente_repasse)}</p></div>
              <div className="card"><p className="text-xs text-muted">Prazos Vencidos</p><p className={"text-2xl font-bold " + (summary.repasses.redistribuicoes_vencidas > 0 ? "text-danger" : "text-success")}>{summary.repasses.redistribuicoes_vencidas}</p></div>
            </div>
          </div>
          <div className="card p-0 overflow-hidden">
            <div className="p-4 border-b border-surface-border"><h3 className="font-semibold text-white">Por Confederação</h3></div>
            <table className="w-full text-sm">
              <thead className="bg-surface"><tr>
                <th className="table-th">Confederação</th><th className="table-th">Receita Total</th>
                <th className="table-th">Repassado</th><th className="table-th">Pendente Repasse</th>
                <th className="table-th">Vencidos</th><th className="table-th">Beneficiários</th>
              </tr></thead>
              <tbody>
                {byConf.map(c => (
                  <tr key={c.confederation_id} className="border-b border-surface-border/50">
                    <td className="table-td text-white">{c.acronym}</td>
                    <td className="table-td text-success">{formatCurrency(c.receita_total)}</td>
                    <td className="table-td">{formatCurrency(c.total_repassado)}</td>
                    <td className="table-td text-warning">{formatCurrency(c.pendente_repasse)}</td>
                    <td className="table-td">{c.redistribuicoes_vencidas > 0 ? <span className="text-danger">{c.redistribuicoes_vencidas}</span> : "0"}</td>
                    <td className="table-td text-muted">{c.beneficiarios}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* REPASSES */}
      {tab === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <select className="input w-48" value={redisConf} onChange={e => setRedisConf(e.target.value)}>
                <option value="">Todas as confederações</option>
                {confs.map(c => <option key={c.id} value={c.id}>{c.acronym}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} /> Só prazos vencidos
              </label>
            </div>
            <button onClick={() => setShowNew(true)} className="btn-primary">+ Nova Redistribuição</button>
          </div>

          {showNew && <NewRedistribution confs={confs} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); loadRedis(); flash("Redistribuição criada."); }} />}

          {redis.length === 0 && <p className="text-muted text-sm text-center py-8">Nenhuma redistribuição. Crie uma a partir de um valor recebido.</p>}
          {redis.map(r => <RedistributionCard key={r.id} r={r} confName={confName} onChanged={loadRedis} />)}
        </div>
      )}

      {/* LANÇAMENTOS AVULSOS */}
      {tab === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <select className="input w-48" value={directConfFilter} onChange={e => setDirectConfFilter(e.target.value)}>
                <option value="">Todas as confederações</option>
                {confs.map(c => <option key={c.id} value={c.id}>{c.acronym}</option>)}
              </select>
              <select className="input w-56" value={directOpFilter} onChange={e => setDirectOpFilter(e.target.value)}>
                <option value="">Todos os agentes operadores</option>
                {operators.map(o => <option key={o.id} value={o.id}>{o.fantasy_name || o.company_name}</option>)}
              </select>
            </div>
            <button onClick={() => { setDirectForm(f => ({ ...f, confederation_id: confs[0]?.id?.toString() || "" })); setShowDirectForm(true); }} className="btn-primary">+ Novo Lançamento</button>
          </div>

          {showDirectForm && (
            <div className="card border border-primary/20 bg-primary/5">
              <h4 className="font-semibold text-white mb-3">Registrar Lançamento Avulso</h4>
              <form onSubmit={handleSaveDirectPayment} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Agente Operador (Bet) *</label>
                    <select className="input" required value={directForm.operator_id} onChange={e => setDirectForm(f => ({ ...f, operator_id: e.target.value }))}>
                      <option value="">Selecione...</option>
                      {operators.map(o => <option key={o.id} value={o.id}>{o.fantasy_name || o.company_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Confederação *</label>
                    <select className="input" required value={directForm.confederation_id} onChange={e => setDirectForm(f => ({ ...f, confederation_id: e.target.value }))}>
                      <option value="">Selecione...</option>
                      {confs.map(c => <option key={c.id} value={c.id}>{c.acronym} — {c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Mês de Referência *</label>
                    <input className="input" type="month" required value={directForm.reference_month} onChange={e => setDirectForm(f => ({ ...f, reference_month: e.target.value }))} />
                    <p className="text-xs text-muted mt-1">Mês ao qual o repasse se refere (competência)</p>
                  </div>
                  <div>
                    <label className="label">Data do Recebimento *</label>
                    <input className="input" type="date" required value={directForm.received_date} onChange={e => setDirectForm(f => ({ ...f, received_date: e.target.value }))} />
                    <p className="text-xs text-muted mt-1">Data em que o valor entrou no caixa</p>
                  </div>
                  <div>
                    <label className="label">Valor Recebido (R$) *</label>
                    <input className="input" type="number" step="0.01" min="0.01" required placeholder="0,00" value={directForm.amount_received} onChange={e => setDirectForm(f => ({ ...f, amount_received: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Observações</label>
                    <input className="input" placeholder="Ex: TED recebido referente a abril/2026" value={directForm.notes} onChange={e => setDirectForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button type="button" className="btn-secondary" onClick={() => setShowDirectForm(false)}>Cancelar</button>
                  <button type="submit" className="btn-primary" disabled={savingDirect}>{savingDirect ? "Salvando..." : "Registrar Lançamento"}</button>
                </div>
              </form>
            </div>
          )}

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className="table-th">Agente Operador</th>
                  <th className="table-th">Confederação</th>
                  <th className="table-th">Mês Referência</th>
                  <th className="table-th">Valor Recebido</th>
                  <th className="table-th">Data Recebimento</th>
                  <th className="table-th">Observações</th>
                  <th className="table-th"></th>
                </tr>
              </thead>
              <tbody>
                {directPayments.length === 0 && (
                  <tr><td colSpan={7} className="table-td text-center text-muted py-8">Nenhum lançamento avulso registrado.</td></tr>
                )}
                {directPayments.map((dp: any) => {
                  const op = operators.find(o => o.id === dp.operator_id);
                  const conf = confs.find(c => c.id === dp.confederation_id);
                  const [yr, mo] = (dp.reference_month || "").split("-");
                  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
                  const monthStr = mo ? `${months[parseInt(mo)-1]}/${yr}` : "—";
                  return (
                    <tr key={dp.id} className="border-b border-surface-border/50 hover:bg-surface-border/20">
                      <td className="table-td font-medium text-white">{op?.fantasy_name || op?.company_name || `#${dp.operator_id}`}</td>
                      <td className="table-td">{conf?.acronym || `#${dp.confederation_id}`}</td>
                      <td className="table-td">{monthStr}</td>
                      <td className="table-td text-success font-medium">{formatCurrency(dp.amount_received)}</td>
                      <td className="table-td text-muted">{formatDate(dp.received_date)}</td>
                      <td className="table-td text-muted text-xs">{dp.notes || "—"}</td>
                      <td className="table-td">
                        <button className="text-danger text-xs hover:underline" onClick={() => handleDeleteDirect(dp.operator_id, dp.id)}>Excluir</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* BENEFICIÁRIOS */}
      {tab === 3 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <select className="input w-56" value={benConf} onChange={e => setBenConf(e.target.value)}>
              <option value="">Todas as confederações</option>
              {confs.map(c => <option key={c.id} value={c.id}>{c.acronym}</option>)}
            </select>
            <button onClick={() => setEditBen({ type: "atleta", name: "", confederation_id: benConf ? Number(benConf) : (confs[0]?.id) })} className="btn-primary">+ Beneficiário</button>
          </div>
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface"><tr>
                <th className="table-th">Nome</th><th className="table-th">Tipo</th><th className="table-th">Confederação</th>
                <th className="table-th">Documento</th><th className="table-th">Dados Bancários</th><th className="table-th"></th>
              </tr></thead>
              <tbody>
                {beneficiaries.map(b => (
                  <tr key={b.id} className="border-b border-surface-border/50">
                    <td className="table-td text-white">{b.name}</td>
                    <td className="table-td">{BTYPES[b.type] || b.type}</td>
                    <td className="table-td text-muted">{confName(b.confederation_id)}</td>
                    <td className="table-td font-mono text-xs">{b.document || "—"}</td>
                    <td className="table-td text-xs text-muted">{b.pix_key ? `PIX: ${b.pix_key}` : (b.bank_name ? `${b.bank_name} ${b.bank_agency || ""}/${b.bank_account || ""}` : "—")}</td>
                    <td className="table-td text-right">
                      <button onClick={() => setEditBen(b)} className="text-xs text-primary hover:underline mr-2">Editar</button>
                      <button onClick={() => { deleteBeneficiary(b.id).then(loadBen); }} className="text-xs text-danger hover:underline">Excluir</button>
                    </td>
                  </tr>
                ))}
                {beneficiaries.length === 0 && <tr><td colSpan={6} className="table-td text-center text-muted py-8">Nenhum beneficiário cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
          {editBen && <BeneficiaryModal confs={confs} ben={editBen} onClose={() => setEditBen(null)} onSaved={() => { setEditBen(null); loadBen(); flash("Beneficiário salvo."); }} />}
        </div>
      )}

      {/* E-MAILS */}
      {tab === 4 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Respostas das Bets importadas automaticamente da caixa de entrada (M365), casadas pelo remetente.</p>
            <button onClick={doSync} disabled={syncing} className="btn-primary">{syncing ? "Sincronizando..." : "Sincronizar Caixa de Entrada"}</button>
          </div>
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface"><tr>
                <th className="table-th">Recebido</th><th className="table-th">De</th><th className="table-th">Assunto</th>
                <th className="table-th">Bet</th><th className="table-th">Status</th>
              </tr></thead>
              <tbody>
                {emails.filter(e => e.direction === "inbound").map(e => (
                  <tr key={e.id} className="border-b border-surface-border/50">
                    <td className="table-td text-muted text-xs">{e.received_at ? formatDate(e.received_at) : "—"}</td>
                    <td className="table-td text-xs">{e.from_addr}</td>
                    <td className="table-td">{e.subject || "(sem assunto)"}</td>
                    <td className="table-td">{e.operator_id ? `#${e.operator_id}` : "—"}</td>
                    <td className="table-td">{e.matched ? <span className="text-xs text-success">✓ Casada</span> : <span className="text-xs text-warning">Sem correspondência</span>}</td>
                  </tr>
                ))}
                {emails.length === 0 && <tr><td colSpan={5} className="table-td text-center text-muted py-8">Nenhuma resposta importada ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}

/* ---------- Nova Redistribuição ---------- */
function NewRedistribution({ confs, onClose, onSaved }: any) {
  const [form, setForm] = useState({ confederation_id: confs[0]?.id || "", competition_name: "", amount_received: "", received_date: todayISO(), reference_month: "", notes: "" });
  const [rules, setRules] = useState<any[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<any[]>([]);
  const [items, setItems] = useState<{ beneficiary_id?: number; beneficiary_label: string; category: string; amount: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!form.confederation_id) return;
    getDistributionRules(Number(form.confederation_id)).then(r => setRules(r.data));
    getBeneficiaries({ confederation_id: Number(form.confederation_id) }).then(r => setBeneficiaries(r.data));
  }, [form.confederation_id]);

  function applyRuleSplit(rule: any) {
    const amt = parseFloat(form.amount_received || "0");
    if (rule.is_equanime) {
      // Rateio equânime: cria itens com categorias padrão sem valores pré-definidos
      // (o usuário preenche manualmente conforme os participantes da competição)
      const equanimeItems: any[] = [
        { beneficiary_label: "Confederação", category: "confederacao", amount: "" },
        { beneficiary_label: "Atleta", category: "atleta", amount: "" },
        { beneficiary_label: "Entidade/Clube", category: "clube", amount: "" },
      ];
      setItems(equanimeItems);
      return;
    }
    if (!amt) return;
    const newItems: any[] = [];
    const map: [string, string][] = [["confederation_pct", "confederacao"], ["athlete_pct", "atleta"], ["entity_pct", "clube"], ["federation_pct", "federacao"]];
    for (const [pctKey, cat] of map) {
      if (rule[pctKey]) newItems.push({ beneficiary_label: BTYPES[cat], category: cat, amount: (amt * parseFloat(rule[pctKey])).toFixed(2) });
    }
    setItems(newItems);
  }

  function addItem() { setItems(i => [...i, { beneficiary_label: "", category: "atleta", amount: "" }]); }
  function setItem(idx: number, patch: any) { setItems(i => i.map((it, k) => k === idx ? { ...it, ...patch } : it)); }
  function removeItem(idx: number) { setItems(i => i.filter((_, k) => k !== idx)); }

  const totalItems = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);

  async function save() {
    if (!form.confederation_id || !form.amount_received || !form.received_date) return;
    setSaving(true);
    try {
      await createRedistribution({
        confederation_id: Number(form.confederation_id),
        source_type: "manual",
        competition_name: form.competition_name || null,
        reference_month: form.reference_month ? form.reference_month + "-01" : null,
        amount_received: parseFloat(form.amount_received),
        received_date: form.received_date,
        notes: form.notes || null,
        items: items.map(it => ({
          beneficiary_id: it.beneficiary_id || null,
          beneficiary_label: it.beneficiary_label || null,
          category: it.category || null,
          amount: parseFloat(it.amount || "0"),
        })).filter(it => it.amount > 0),
      });
      onSaved();
    } catch { alert("Erro ao criar redistribuição."); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card border border-surface-border rounded-xl p-6 w-full max-w-3xl space-y-4 max-h-[92vh] overflow-y-auto">
        <h3 className="font-semibold text-white">Nova Redistribuição (Fase 2)</h3>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Confederação</label>
            <select className="input" value={form.confederation_id} onChange={e => setForm(f => ({ ...f, confederation_id: e.target.value }))}>
              {confs.map((c: any) => <option key={c.id} value={c.id}>{c.acronym}</option>)}
            </select></div>
          <div><label className="label">Valor Recebido (R$)</label>
            <input type="number" step="0.01" className="input" value={form.amount_received} onChange={e => setForm(f => ({ ...f, amount_received: e.target.value }))} /></div>
          <div><label className="label">Data de Recebimento</label>
            <input type="date" className="input" value={form.received_date} onChange={e => setForm(f => ({ ...f, received_date: e.target.value }))} /></div>
          <div><label className="label">Competição</label>
            <input className="input" placeholder="opcional" value={form.competition_name} onChange={e => setForm(f => ({ ...f, competition_name: e.target.value }))} /></div>
          <div><label className="label">Mês de Referência</label>
            <input type="month" className="input" value={form.reference_month} onChange={e => setForm(f => ({ ...f, reference_month: e.target.value }))} /></div>
        </div>

        {rules.length > 0 && (
          <div>
            <label className="label">Aplicar rateio do regulamento (preenche os itens)</label>
            <div className="flex flex-wrap gap-2">
              {rules.map(ru => (
                <button key={ru.id} type="button" onClick={() => applyRuleSplit(ru)}
                  title={ru.is_equanime ? "Rateio equânime: cria os itens com categorias padrão — preencha os valores manualmente conforme participantes" : "Aplica percentuais fixos do regulamento"}
                  className={"px-2.5 py-1 text-xs rounded border " + (ru.is_equanime ? "border-warning/30 text-warning hover:bg-warning/10" : "border-primary/30 text-primary hover:bg-primary/10")}>
                  {ru.scenario_label}{ru.is_equanime ? " (equânime)" : ""}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Itens (beneficiários)</label>
            <button type="button" onClick={addItem} className="text-xs text-primary hover:underline">+ Adicionar item</button>
          </div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <select className="input flex-1" value={it.beneficiary_id || ""} onChange={e => {
                  const bid = e.target.value ? Number(e.target.value) : undefined;
                  const ben = beneficiaries.find(b => b.id === bid);
                  setItem(idx, { beneficiary_id: bid, beneficiary_label: ben?.name || it.beneficiary_label, category: ben?.type || it.category });
                }}>
                  <option value="">— beneficiário (opcional) —</option>
                  {beneficiaries.map(b => <option key={b.id} value={b.id}>{b.name} ({BTYPES[b.type]})</option>)}
                </select>
                <input className="input w-28" placeholder="categoria" value={it.category} onChange={e => setItem(idx, { category: e.target.value })} />
                <input className="input w-32" type="number" step="0.01" placeholder="valor" value={it.amount} onChange={e => setItem(idx, { amount: e.target.value })} />
                <button type="button" onClick={() => removeItem(idx)} className="text-danger text-xs px-2">✕</button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-2">
            Soma dos itens: <strong>{formatCurrency(totalItems)}</strong> / Recebido: {formatCurrency(parseFloat(form.amount_received || "0"))}
            {totalItems > 0 && Math.abs(totalItems - parseFloat(form.amount_received || "0")) > 0.01 && (
              <span className="text-warning ml-2">⚠ A soma dos itens difere do valor recebido</span>
            )}
          </p>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Criar"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Card de Redistribuição ---------- */
function RedistributionCard({ r, confName, onChanged }: any) {
  const overdue = r.deadline_date && new Date(r.deadline_date) < new Date() && r.status !== "completed";
  const statusMap: Record<string, string> = { pending: "Pendente", partial: "Parcial", completed: "Concluída" };

  async function payItem(itemId: number) {
    const d = prompt("Data do repasse (AAAA-MM-DD):", todayISO());
    if (!d) return;
    await payRedistributionItem(r.id, itemId, { paid_date: d });
    onChanged();
  }
  async function del() { if (confirm("Excluir esta redistribuição?")) { await deleteRedistribution(r.id); onChanged(); } }

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-white">
            {confName(r.confederation_id)} — {formatCurrency(r.amount_received)}
            {r.competition_name && <span className="text-muted font-normal"> · {r.competition_name}</span>}
          </p>
          <p className="text-xs text-muted mt-0.5">
            Recebido em {formatDate(r.received_date)}
            {r.deadline_date && <> · Prazo: <span className={overdue ? "text-danger font-medium" : ""}>{formatDate(r.deadline_date)}</span></>}
            {" · "}<span className={r.status === "completed" ? "text-success" : "text-warning"}>{statusMap[r.status]}</span>
          </p>
        </div>
        <button onClick={del} className="text-xs text-danger hover:underline">Excluir</button>
      </div>
      <div className="space-y-1.5">
        {r.items.map((it: any) => (
          <div key={it.id} className="flex items-center justify-between text-sm bg-surface rounded-lg px-3 py-2">
            <div>
              <span className="text-white">{it.beneficiary_label || "(sem nome)"}</span>
              <span className="text-xs text-muted ml-2">{it.category}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-300">{formatCurrency(it.amount)}</span>
              {it.status === "paid"
                ? <span className="text-xs text-success">✓ {it.paid_date ? formatDate(it.paid_date) : "pago"}</span>
                : <button onClick={() => payItem(it.id)} className="text-xs text-primary hover:underline">Marcar repassado</button>}
            </div>
          </div>
        ))}
        {r.items.length === 0 && <p className="text-xs text-muted">Sem itens. Edite para adicionar beneficiários.</p>}
      </div>
    </div>
  );
}

/* ---------- Modal Beneficiário ---------- */
function BeneficiaryModal({ confs, ben, onClose, onSaved }: any) {
  const [f, setF] = useState<any>({ type: "atleta", name: "", document: "", email: "", phone: "", bank_name: "", bank_agency: "", bank_account: "", pix_key: "", active: true, confederation_id: confs[0]?.id, ...ben });
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!f.name) return;
    setSaving(true);
    try {
      const payload = { type: f.type, name: f.name, document: f.document, email: f.email, phone: f.phone, bank_name: f.bank_name, bank_agency: f.bank_agency, bank_account: f.bank_account, pix_key: f.pix_key, active: f.active };
      if (f.id) await updateBeneficiary(f.id, payload);
      else await createBeneficiary(Number(f.confederation_id), payload);
      onSaved();
    } catch { alert("Erro ao salvar."); }
    setSaving(false);
  }
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card border border-surface-border rounded-xl p-6 w-full max-w-xl space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="font-semibold text-white">{f.id ? "Editar" : "Novo"} Beneficiário</h3>
        <div className="grid grid-cols-2 gap-3">
          {!f.id && <div><label className="label">Confederação</label>
            <select className="input" value={f.confederation_id} onChange={e => setF((s: any) => ({ ...s, confederation_id: e.target.value }))}>
              {confs.map((c: any) => <option key={c.id} value={c.id}>{c.acronym}</option>)}
            </select></div>}
          <div><label className="label">Tipo</label>
            <select className="input" value={f.type} onChange={e => setF((s: any) => ({ ...s, type: e.target.value }))}>
              {Object.entries(BTYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="col-span-2"><label className="label">Nome</label><input className="input" value={f.name} onChange={e => setF((s: any) => ({ ...s, name: e.target.value }))} /></div>
          <div><label className="label">CPF/CNPJ</label><input className="input" value={f.document || ""} onChange={e => setF((s: any) => ({ ...s, document: e.target.value }))} /></div>
          <div><label className="label">E-mail</label><input className="input" value={f.email || ""} onChange={e => setF((s: any) => ({ ...s, email: e.target.value }))} /></div>
          <div><label className="label">Banco</label><input className="input" value={f.bank_name || ""} onChange={e => setF((s: any) => ({ ...s, bank_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Agência</label><input className="input" value={f.bank_agency || ""} onChange={e => setF((s: any) => ({ ...s, bank_agency: e.target.value }))} /></div>
            <div><label className="label">Conta</label><input className="input" value={f.bank_account || ""} onChange={e => setF((s: any) => ({ ...s, bank_account: e.target.value }))} /></div>
          </div>
          <div className="col-span-2"><label className="label">Chave PIX</label><input className="input" value={f.pix_key || ""} onChange={e => setF((s: any) => ({ ...s, pix_key: e.target.value }))} /></div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
