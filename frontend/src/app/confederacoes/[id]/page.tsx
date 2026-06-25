"use client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import {
  getConfederation, updateConfederation, uploadConfederationLogo,
  getConfederationRules, upsertConfederationRule, deleteConfederationRule,
  getCollections, getPayments, getOperators,
  getEndrPayments, createEndrPayment, uploadEndrReport, deleteEndrPayment,
  registerReport, uploadPaymentReport,
} from "@/lib/api";
import { formatDate, formatCurrency } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TABS = ["Visão Geral", "Cadastro", "Receitas por Mês", "Repasses ENDR", "Regras por Bet"];

type Conf = {
  id: number; name: string; acronym: string; cnpj?: string; website?: string; phone?: string;
  address?: string; president_name?: string; president_email?: string; president_phone?: string;
  president_term?: string; logo_url?: string; regulation_text?: string; rateio_rules?: string;
  contact_email?: string; finance_email?: string; payment_due_day: number;
};
type Payment = {
  id: number; cycle_id: number; operator_id: number; status: string;
  amount_paid?: string; ggr_declared?: string; report_received: boolean;
  report_reference_month?: string; report_notes?: string; report_file_url?: string;
};
type ENDRPay = {
  id: number; confederation_id: number; reference_month: string;
  amount_received: string; received_date: string; notes?: string;
  report_file_url?: string; bet_links: { id: number; operator_id: number }[];
};
type Rule = { id: number; operator_id: number; percentage: string; notes?: string };

function toFirstOfMonth(d: Date) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    paid: { label: "Adimplente", cls: "text-success bg-success/10 border-success/30" },
    report_pending: { label: "Pend. Relatório", cls: "text-warning bg-warning/10 border-warning/30" },
    pending: { label: "Inadimplente", cls: "text-slate-400 bg-slate-400/10 border-slate-400/30" },
    overdue: { label: "Em atraso", cls: "text-danger bg-danger/10 border-danger/30" },
    partial: { label: "Parcial", cls: "text-warning bg-warning/10 border-warning/30" },
  };
  const s = map[status] || { label: status, cls: "text-muted bg-surface-border border-surface-border" };
  return <span className={"px-2 py-0.5 rounded text-xs border " + s.cls}>{s.label}</span>;
}

export default function ConfederationDetailPage() {
  const { id } = useParams();
  const numId = Number(id);
  const [conf, setConf] = useState<Conf | null>(null);
  const [cycles, setCycles] = useState<any[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [endrPayments, setEndrPayments] = useState<ENDRPay[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [msg, setMsg] = useState("");

  const [editConf, setEditConf] = useState(false);
  const [confForm, setConfForm] = useState<Partial<Conf>>({});
  const [savingConf, setSavingConf] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const today = new Date();
  const [filterMonth, setFilterMonth] = useState(toFirstOfMonth(today));
  const [monthPayments, setMonthPayments] = useState<Payment[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(false);

  const [showEndrForm, setShowEndrForm] = useState(false);
  const [endrForm, setEndrForm] = useState({ reference_month: toFirstOfMonth(today), amount_received: "", received_date: "", notes: "", operator_ids: [] as number[] });
  const [savingEndr, setSavingEndr] = useState(false);

  const [reportModal, setReportModal] = useState<{ payId: number } | null>(null);
  const [reportForm, setReportForm] = useState({ report_reference_month: "", report_notes: "" });
  const reportFileRef = useRef<HTMLInputElement>(null);

  const [ruleForm, setRuleForm] = useState({ operator_id: "", percentage: "", notes: "" });
  const [savingRule, setSavingRule] = useState(false);

  useEffect(() => {
    Promise.all([
      getConfederation(numId),
      getCollections({ confederation_id: numId }),
      getPayments({ confederation_id: numId, limit: 500 }),
      getOperators({ limit: 300 }),
      getEndrPayments({ confederation_id: numId }),
      getConfederationRules(numId),
    ]).then(([c, cols, pays, ops, endr, rls]) => {
      setConf(c.data);
      setConfForm(c.data);
      setCycles(cols.data);
      setPayments(pays.data);
      setOperators(ops.data);
      setEndrPayments(endr.data);
      setRules(rls.data);
    }).finally(() => setLoading(false));
  }, [numId]);

  useEffect(() => {
    setLoadingMonth(true);
    getPayments({ confederation_id: numId, month: filterMonth, limit: 300 })
      .then(r => setMonthPayments(r.data))
      .finally(() => setLoadingMonth(false));
  }, [numId, filterMonth]);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 4000); }

  async function saveConf() {
    setSavingConf(true);
    try { const r = await updateConfederation(numId, confForm); setConf(r.data); setEditConf(false); flash("Cadastro salvo."); }
    catch { flash("Erro ao salvar."); }
    setSavingConf(false);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try { const r = await uploadConfederationLogo(numId, fd); setConf(c => c ? { ...c, logo_url: r.data.logo_url } : c); flash("Logomarca atualizada."); }
    catch { flash("Erro ao enviar logomarca."); }
  }

  async function saveEndr() {
    if (!endrForm.amount_received || !endrForm.received_date) return;
    setSavingEndr(true);
    try {
      const r = await createEndrPayment({ confederation_id: numId, reference_month: endrForm.reference_month, amount_received: parseFloat(endrForm.amount_received), received_date: endrForm.received_date, notes: endrForm.notes || null, operator_ids: endrForm.operator_ids });
      setEndrPayments(p => [r.data, ...p]);
      setShowEndrForm(false);
      setEndrForm({ reference_month: toFirstOfMonth(today), amount_received: "", received_date: "", notes: "", operator_ids: [] });
      flash("Repasse ENDR registrado.");
    } catch { flash("Erro ao registrar."); }
    setSavingEndr(false);
  }

  async function handleEndrFileUpload(endrId: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    await uploadEndrReport(endrId, fd);
    const r = await getEndrPayments({ confederation_id: numId }); setEndrPayments(r.data);
    flash("Arquivo enviado.");
  }

  async function handleDeleteEndr(endrId: number) {
    if (!confirm("Excluir este repasse ENDR?")) return;
    await deleteEndrPayment(endrId);
    setEndrPayments(p => p.filter(e => e.id !== endrId));
  }

  async function saveReport() {
    if (!reportModal) return;
    try {
      await registerReport(reportModal.payId, { report_reference_month: reportForm.report_reference_month + "-01" || null, report_notes: reportForm.report_notes || null });
      if (reportFileRef.current?.files?.[0]) {
        const fd = new FormData(); fd.append("file", reportFileRef.current.files[0]);
        await uploadPaymentReport(reportModal.payId, fd);
      }
      const r = await getPayments({ confederation_id: numId, limit: 500 }); setPayments(r.data);
      const rm = await getPayments({ confederation_id: numId, month: filterMonth, limit: 300 }); setMonthPayments(rm.data);
      setReportModal(null); flash("Relatório registrado.");
    } catch { flash("Erro ao registrar relatório."); }
  }

  async function saveRule() {
    if (!ruleForm.operator_id || !ruleForm.percentage) return;
    setSavingRule(true);
    try {
      const r = await upsertConfederationRule(numId, { operator_id: Number(ruleForm.operator_id), percentage: parseFloat(ruleForm.percentage) / 100, notes: ruleForm.notes || null });
      setRules(prev => { const idx = prev.findIndex(x => x.operator_id === r.data.operator_id); if (idx >= 0) { const n = [...prev]; n[idx] = r.data; return n; } return [...prev, r.data]; });
      setRuleForm({ operator_id: "", percentage: "", notes: "" }); flash("Regra salva.");
    } catch { flash("Erro ao salvar."); }
    setSavingRule(false);
  }

  if (loading) return <AppShell><div className="text-muted p-8">Carregando...</div></AppShell>;
  if (!conf) return <AppShell><div className="text-muted p-8">Não encontrado</div></AppShell>;

  const paid = payments.filter(p => p.status === "paid").length;
  const reportPending = payments.filter(p => p.status === "report_pending").length;
  const overdue = payments.filter(p => p.status === "overdue" || p.status === "pending").length;
  const totalReceived = payments.reduce((s, p) => s + parseFloat(p.amount_paid || "0"), 0);
  const monthPaid = monthPayments.filter(p => p.status === "paid").length;
  const monthRptPend = monthPayments.filter(p => p.status === "report_pending").length;
  const monthOverdue = monthPayments.filter(p => p.status === "overdue" || p.status === "pending").length;
  const monthTotal = monthPayments.reduce((s, p) => s + parseFloat(p.amount_paid || "0"), 0);
  const opMap = Object.fromEntries(operators.map(o => [o.id, o]));
  const displayMonth = new Date(filterMonth + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <AppShell>
      <Header title={conf.acronym} subtitle={conf.name} />
      {msg && (
        <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          {msg}<button onClick={() => setMsg("")} className="ml-4 text-muted">✕</button>
        </div>
      )}

      <div className="flex gap-1 border-b border-surface-border mb-6">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={"px-4 py-2.5 text-sm font-medium border-b-2 transition-colors " + (tab === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-slate-200")}>
            {t}
          </button>
        ))}
      </div>

      {/* TAB 0: VISÃO GERAL */}
      {tab === 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <div className="card text-center"><p className="text-3xl font-bold text-success mb-1">{paid}</p><p className="text-xs text-muted">Adimplentes</p></div>
            <div className="card text-center"><p className="text-3xl font-bold text-warning mb-1">{reportPending}</p><p className="text-xs text-muted">Pend. de Relatório</p></div>
            <div className="card text-center"><p className="text-3xl font-bold text-danger mb-1">{overdue}</p><p className="text-xs text-muted">Inadimplentes</p></div>
            <div className="card text-center"><p className="text-xl font-bold text-success mb-1">{formatCurrency(totalReceived)}</p><p className="text-xs text-muted">Total Recebido</p></div>
          </div>
          <div className="card">
            <h3 className="font-semibold text-white mb-4">Ciclos de Cobrança ({cycles.length})</h3>
            {cycles.length === 0 ? <p className="text-muted text-sm">Nenhum ciclo criado</p> : (
              <div className="space-y-2">
                {cycles.slice(0, 8).map(c => (
                  <div key={c.id} className="flex items-center justify-between p-2 bg-surface rounded-lg">
                    <span className="text-sm text-slate-300">{formatDate(c.reference_month)}</span>
                    <span className="text-xs text-muted capitalize">{c.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 1: CADASTRO */}
      {tab === 1 && (
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-white">Dados Cadastrais</h3>
            {!editConf ? (
              <button onClick={() => setEditConf(true)} className="px-4 py-1.5 text-sm bg-primary/15 text-primary border border-primary/30 rounded-lg hover:bg-primary/25 transition-colors">Editar</button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setEditConf(false)} className="px-4 py-1.5 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">Cancelar</button>
                <button onClick={saveConf} disabled={savingConf} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors">{savingConf ? "Salvando..." : "Salvar"}</button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-surface-border">
            {conf.logo_url
              ? <img src={API_URL + conf.logo_url} alt="Logo" className="h-16 w-16 object-contain rounded-lg border border-surface-border bg-surface" />
              : <div className="h-16 w-16 rounded-lg border border-surface-border bg-surface flex items-center justify-center text-muted text-xs">Logo</div>}
            <div>
              <p className="text-sm text-white font-medium mb-1">Logomarca</p>
              <button onClick={() => logoInputRef.current?.click()} className="px-3 py-1.5 text-xs bg-surface-border border border-surface-border rounded-lg hover:bg-surface text-slate-300 transition-colors">
                {conf.logo_url ? "Trocar logo" : "Enviar logo"}
              </button>
              <input ref={logoInputRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden" onChange={handleLogoUpload} />
              <p className="text-xs text-muted mt-1">PNG, JPG, SVG ou WebP</p>
            </div>
          </div>

          {editConf ? (
            <div className="grid grid-cols-2 gap-4">
              {([
                ["Nome Completo", "name"], ["CNPJ", "cnpj"], ["Website", "website"], ["Telefone", "phone"],
                ["E-mail Contato", "contact_email"], ["E-mail Financeiro", "finance_email"],
                ["Presidente", "president_name"], ["E-mail Presidente", "president_email"],
                ["Telefone Presidente", "president_phone"], ["Mandato", "president_term"],
              ] as [string, string][]).map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs text-muted mb-1">{label}</label>
                  <input className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                    value={(confForm as any)[key] || ""} onChange={e => setConfForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
              <div className="col-span-2">
                <label className="block text-xs text-muted mb-1">Endereço</label>
                <input className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  value={confForm.address || ""} onChange={e => setConfForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-muted mb-1">Texto do Regulamento</label>
                <textarea rows={4} className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  value={confForm.regulation_text || ""} onChange={e => setConfForm(f => ({ ...f, regulation_text: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-muted mb-1">Regras de Rateio (regulamento interno)</label>
                <textarea rows={5} placeholder="Descreva as regras de rateio conforme regulamento interno aprovado..."
                  className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  value={confForm.rateio_rules || ""} onChange={e => setConfForm(f => ({ ...f, rateio_rules: e.target.value }))} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {([
                ["CNPJ", conf.cnpj], ["Website", conf.website], ["Telefone", conf.phone],
                ["E-mail Contato", conf.contact_email], ["E-mail Financeiro", conf.finance_email], ["Endereço", conf.address],
                ["Presidente", conf.president_name], ["E-mail Presidente", conf.president_email],
                ["Telefone Presidente", conf.president_phone], ["Mandato", conf.president_term],
              ] as [string, string | undefined][]).map(([label, val]) => (
                <div key={label}>
                  <p className="text-xs text-muted">{label}</p>
                  <p className="text-sm text-white mt-0.5">{val || <span className="text-slate-500 italic">—</span>}</p>
                </div>
              ))}
              {conf.regulation_text && <div className="col-span-3"><p className="text-xs text-muted mb-1">Regulamento</p><p className="text-sm text-slate-300 whitespace-pre-line">{conf.regulation_text}</p></div>}
              {conf.rateio_rules && <div className="col-span-3"><p className="text-xs text-muted mb-1">Regras de Rateio</p><p className="text-sm text-slate-300 whitespace-pre-line">{conf.rateio_rules}</p></div>}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: RECEITAS POR MÊS */}
      {tab === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="text-sm text-muted">Mês de referência:</label>
            <input type="month" value={filterMonth.slice(0, 7)}
              onChange={e => setFilterMonth(e.target.value + "-01")}
              className="bg-surface-border border border-surface-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary" />
            <span className="text-sm text-muted capitalize">{displayMonth}</span>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div className="card text-center"><p className="text-3xl font-bold text-success mb-1">{monthPaid}</p><p className="text-xs text-muted">Adimplentes</p></div>
            <div className="card text-center"><p className="text-3xl font-bold text-warning mb-1">{monthRptPend}</p><p className="text-xs text-muted">Pend. Relatório</p></div>
            <div className="card text-center"><p className="text-3xl font-bold text-danger mb-1">{monthOverdue}</p><p className="text-xs text-muted">Inadimplentes</p></div>
            <div className="card text-center"><p className="text-xl font-bold text-success mb-1">{formatCurrency(monthTotal)}</p><p className="text-xs text-muted">Recebido no Mês</p></div>
          </div>
          {loadingMonth ? <p className="text-muted text-sm">Carregando...</p> : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-surface">
                    <th className="table-th">Operador</th>
                    <th className="table-th">Valor Pago</th>
                    <th className="table-th">GGR Declarado</th>
                    <th className="table-th">Status</th>
                    <th className="table-th">Relatório</th>
                    <th className="table-th">Mês Competência</th>
                    <th className="table-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {monthPayments.length === 0 && <tr><td colSpan={7} className="table-td text-center text-muted py-8">Nenhum pagamento no mês selecionado.</td></tr>}
                  {monthPayments.map(p => {
                    const op = opMap[p.operator_id];
                    return (
                      <tr key={p.id} className="border-b border-surface-border/50 hover:bg-surface-border/30">
                        <td className="table-td text-white">{op?.fantasy_name || op?.company_name || ("#" + p.operator_id)}</td>
                        <td className="table-td">{formatCurrency(parseFloat(p.amount_paid || "0"))}</td>
                        <td className="table-td">{p.ggr_declared ? formatCurrency(parseFloat(p.ggr_declared)) : "—"}</td>
                        <td className="table-td"><StatusBadge status={p.status} /></td>
                        <td className="table-td">{p.report_received ? <span className="text-xs text-success">✓ Recebido</span> : <span className="text-xs text-warning">Pendente</span>}</td>
                        <td className="table-td text-muted text-xs">{p.report_reference_month ? new Date(p.report_reference_month + "T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : "—"}</td>
                        <td className="table-td text-right flex gap-1 justify-end">
                          {!p.report_received && p.amount_paid && (
                            <button onClick={() => { setReportModal({ payId: p.id }); setReportForm({ report_reference_month: "", report_notes: "" }); }}
                              className="px-2 py-1 text-xs bg-primary/15 text-primary border border-primary/30 rounded hover:bg-primary/25 transition-colors">Registrar Relat.</button>
                          )}
                          {p.report_file_url && (
                            <a href={API_URL + p.report_file_url} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs text-muted border border-surface-border rounded hover:bg-surface-border transition-colors">Ver arquivo</a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: REPASSES ENDR */}
      {tab === 3 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted">O ENDR faz um repasse único cobrindo múltiplas bets. Registre cada repasse recebido e indique as bets cobertas.</p>
            <button onClick={() => setShowEndrForm(true)} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors">+ Registrar Repasse</button>
          </div>
          {showEndrForm && (
            <div className="card space-y-4">
              <h4 className="font-semibold text-white">Novo Repasse ENDR</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-muted mb-1">Mês de Referência</label>
                  <input type="month" value={endrForm.reference_month.slice(0, 7)}
                    onChange={e => setEndrForm(f => ({ ...f, reference_month: e.target.value + "-01" }))}
                    className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Valor Recebido (R$)</label>
                  <input type="number" step="0.01" placeholder="0.00" value={endrForm.amount_received}
                    onChange={e => setEndrForm(f => ({ ...f, amount_received: e.target.value }))}
                    className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Data de Recebimento</label>
                  <input type="date" value={endrForm.received_date}
                    onChange={e => setEndrForm(f => ({ ...f, received_date: e.target.value }))}
                    className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-2">Bets que pagaram via ENDR neste mês</label>
                <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto p-2 bg-surface-border rounded-lg">
                  {operators.filter(o => o.status === "active").map(op => (
                    <label key={op.id} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={endrForm.operator_ids.includes(op.id)}
                        onChange={e => setEndrForm(f => ({ ...f, operator_ids: e.target.checked ? [...f.operator_ids, op.id] : f.operator_ids.filter(x => x !== op.id) }))} />
                      <span className="text-xs text-slate-300 truncate">{op.fantasy_name || op.company_name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted mt-1">{endrForm.operator_ids.length} bet(s) selecionada(s)</p>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Observações</label>
                <input value={endrForm.notes} onChange={e => setEndrForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowEndrForm(false)} className="px-4 py-2 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">Cancelar</button>
                <button onClick={saveEndr} disabled={savingEndr || !endrForm.amount_received || !endrForm.received_date}
                  className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors">{savingEndr ? "Salvando..." : "Registrar"}</button>
              </div>
            </div>
          )}
          {endrPayments.length === 0 && !showEndrForm && <p className="text-muted text-sm text-center py-8">Nenhum repasse ENDR registrado.</p>}
          {endrPayments.map(ep => (
            <div key={ep.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-white">
                    {new Date(ep.reference_month + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })} — {formatCurrency(parseFloat(ep.amount_received))}
                  </p>
                  <p className="text-xs text-muted mt-0.5">Recebido em {formatDate(ep.received_date)} · {ep.bet_links.length} bet(s)</p>
                </div>
                <div className="flex gap-2">
                  {ep.report_file_url
                    ? <a href={API_URL + ep.report_file_url} target="_blank" rel="noreferrer" className="px-3 py-1.5 text-xs text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors">Ver relatório</a>
                    : <label className="px-3 py-1.5 text-xs text-muted border border-surface-border rounded-lg hover:bg-surface-border cursor-pointer transition-colors">
                        Anexar relatório<input type="file" className="hidden" onChange={e => handleEndrFileUpload(ep.id, e)} />
                      </label>}
                  <button onClick={() => handleDeleteEndr(ep.id)} className="px-3 py-1.5 text-xs text-danger border border-danger/30 rounded-lg hover:bg-danger/10 transition-colors">Excluir</button>
                </div>
              </div>
              {ep.notes && <p className="text-xs text-muted mb-2">{ep.notes}</p>}
              <div className="flex flex-wrap gap-1.5">
                {ep.bet_links.map(bl => { const op = opMap[bl.operator_id]; return <span key={bl.id} className="px-2 py-0.5 text-xs bg-surface-border rounded text-slate-300">{op?.fantasy_name || op?.company_name || ("#" + bl.operator_id)}</span>; })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 4: REGRAS POR BET */}
      {tab === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-muted">Percentual de rateio individual por agente operador. Se não configurado, usa o percentual padrão da confederação.</p>
          <div className="card">
            <h4 className="font-semibold text-white mb-4">Adicionar / Atualizar Regra</h4>
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-48">
                <label className="block text-xs text-muted mb-1">Agente Operador</label>
                <select value={ruleForm.operator_id} onChange={e => setRuleForm(f => ({ ...f, operator_id: e.target.value }))}
                  className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary">
                  <option value="">Selecione...</option>
                  {operators.map(op => <option key={op.id} value={op.id}>{op.company_name}{op.fantasy_name ? ` (${op.fantasy_name})` : ""}</option>)}
                </select>
              </div>
              <div className="w-32">
                <label className="block text-xs text-muted mb-1">Percentual (%)</label>
                <input type="number" step="0.001" placeholder="ex: 0.25" value={ruleForm.percentage}
                  onChange={e => setRuleForm(f => ({ ...f, percentage: e.target.value }))}
                  className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
              </div>
              <div className="flex-1 min-w-32">
                <label className="block text-xs text-muted mb-1">Observação</label>
                <input value={ruleForm.notes} onChange={e => setRuleForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
              </div>
              <button onClick={saveRule} disabled={savingRule || !ruleForm.operator_id || !ruleForm.percentage}
                className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors">
                {savingRule ? "..." : "Salvar"}
              </button>
            </div>
          </div>
          {rules.length === 0
            ? <p className="text-muted text-sm text-center py-6">Nenhuma regra individual configurada.</p>
            : (
              <div className="card p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-surface-border bg-surface"><th className="table-th">Operador</th><th className="table-th">Percentual</th><th className="table-th">Observação</th><th className="table-th"></th></tr></thead>
                  <tbody>
                    {rules.map(r => { const op = opMap[r.operator_id]; return (
                      <tr key={r.id} className="border-b border-surface-border/50 hover:bg-surface-border/30">
                        <td className="table-td text-white">{op?.company_name || ("#" + r.operator_id)}</td>
                        <td className="table-td text-primary font-mono">{(parseFloat(r.percentage) * 100).toFixed(4)}%</td>
                        <td className="table-td text-muted">{r.notes || "—"}</td>
                        <td className="table-td text-right">
                          <button onClick={() => deleteConfederationRule(numId, r.id).then(() => setRules(p => p.filter(x => x.id !== r.id)))}
                            className="px-2 py-1 text-xs text-danger border border-danger/30 rounded hover:bg-danger/10 transition-colors">Remover</button>
                        </td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* Modal: Registrar Relatório */}
      {reportModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-card border border-surface-border rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-white">Registrar Relatório GGR</h3>
            <p className="text-xs text-muted">O sistema mantém regime de caixa. Informe aqui o mês de competência declarado no relatório recebido.</p>
            <div>
              <label className="block text-xs text-muted mb-1">Mês de Competência (do relatório)</label>
              <input type="month" value={reportForm.report_reference_month}
                onChange={e => setReportForm(f => ({ ...f, report_reference_month: e.target.value }))}
                className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Informações do Relatório</label>
              <textarea rows={3} value={reportForm.report_notes}
                onChange={e => setReportForm(f => ({ ...f, report_notes: e.target.value }))}
                placeholder="Informações relevantes do relatório recebido..."
                className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Anexar Relatório (opcional)</label>
              <input type="file" ref={reportFileRef} accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.png,.jpg" className="text-sm text-slate-300" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setReportModal(null)} className="px-4 py-2 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">Cancelar</button>
              <button onClick={saveReport} className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors">Registrar</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
