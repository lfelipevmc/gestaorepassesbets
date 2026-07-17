"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import {
  getFinanceSummary, getFinanceByConfederation, getConfederations,
  getRedistributions, createRedistribution, payRedistributionItem, deleteRedistribution,
  getBeneficiaries, createBeneficiary, updateBeneficiary, deleteBeneficiary,
  getDistributionRules, getFinanceEmails, syncEmails,
  deleteDirectPayment, getOperators, getPhase1,
  suggestEmailOperator, linkEmailOperator,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/Toast";
import HelpTip from "@/components/ui/HelpTip";
import MailboxBadge from "@/components/ui/MailboxBadge";
import DirectPaymentModal from "@/components/finance/DirectPaymentModal";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TABS = ["Resumo", "Repasses (Fase 1)", "Repartição (Fase 2)", "E-mails"];
const BTYPES: Record<string, string> = { confederacao: "Confederação", atleta: "Atleta", clube: "Clube/Entidade", federacao: "Federação", outro: "Outro" };
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function monthBR(iso?: string) { if (!iso) return "—"; const [y, m] = iso.split("-"); return m ? `${MONTHS[parseInt(m) - 1]}/${y}` : "—"; }

export default function FinanceiroPage() {
  const [tab, setTab] = useState(0);
  const [activeConf, setActiveConf] = useState<string>("");  // cliente selecionado ("" = visão geral consolidada)
  const [confs, setConfs] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 3500); }

  // Resumo
  const [summary, setSummary] = useState<any>(null);
  const [byConf, setByConf] = useState<any[]>([]);

  // Fase 1 — repasses recebidos
  const [phase1, setPhase1] = useState<any[]>([]);
  const [phase1Total, setPhase1Total] = useState(0);
  const [p1Op, setP1Op] = useState("");
  const [p1Month, setP1Month] = useState("");
  const [p1Regime, setP1Regime] = useState<"competencia" | "caixa">("competencia");
  const [showDirectForm, setShowDirectForm] = useState(false);

  // Fase 2 — repartição
  const [f2sub, setF2sub] = useState<"repart" | "benef">("repart");
  const [redis, setRedis] = useState<any[]>([]);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [showNew, setShowNew] = useState(false);

  // Beneficiários
  const [beneficiaries, setBeneficiaries] = useState<any[]>([]);
  const [editBen, setEditBen] = useState<any>(null);

  // E-mails
  const [emails, setEmails] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    getConfederations().then(r => setConfs(r.data));
    getOperators({ limit: 1000 }).then(r => setOperators(r.data));
  }, []);
  function loadSummary() {
    const params: any = {};
    if (activeConf) params.confederation_id = Number(activeConf);
    getFinanceSummary(params).then(r => setSummary(r.data));
    getFinanceByConfederation().then(r => setByConf(r.data));
  }
  useEffect(() => {
    if (tab === 0) loadSummary();
    if (tab === 1) loadPhase1();
    if (tab === 2) { f2sub === "repart" ? loadRedis() : loadBen(); }
    if (tab === 3) loadEmails();
  }, [tab]);

  // Trocar de cliente recarrega a aba ativa escopada à confederação
  useEffect(() => {
    if (tab === 0) loadSummary();
    if (tab === 1) loadPhase1();
    if (tab === 2) { f2sub === "repart" ? loadRedis() : loadBen(); }
    if (tab === 3) loadEmails();
  }, [activeConf]);

  function loadPhase1() {
    const params: any = { regime: p1Regime };
    if (activeConf) params.confederation_id = Number(activeConf);
    if (p1Op) params.operator_id = Number(p1Op);
    if (p1Month) params.month = p1Month + "-01";
    getPhase1(params).then(r => { setPhase1(r.data.items); setPhase1Total(r.data.total); });
  }
  useEffect(() => { if (tab === 1) loadPhase1(); }, [p1Op, p1Month, p1Regime]);

  function loadRedis() {
    const params: any = {};
    if (activeConf) params.confederation_id = Number(activeConf);
    if (onlyOverdue) params.overdue = true;
    getRedistributions(params).then(r => setRedis(r.data));
  }
  function loadBen() {
    const params: any = {};
    if (activeConf) params.confederation_id = Number(activeConf);
    getBeneficiaries(params).then(r => setBeneficiaries(r.data));
  }
  function loadEmails() {
    const params: any = {};
    if (activeConf) params.confederation_id = Number(activeConf);
    getFinanceEmails(params).then(r => setEmails(r.data));
  }
  useEffect(() => { if (tab === 2 && f2sub === "repart") loadRedis(); }, [onlyOverdue, f2sub]);
  useEffect(() => { if (tab === 2 && f2sub === "benef") loadBen(); }, [f2sub]);

  async function handleDeleteDirect(opId: number, payId: number) {
    if (!confirm("Excluir este lançamento avulso?")) return;
    await deleteDirectPayment(opId, payId);
    loadPhase1();
    flash("Lançamento excluído.");
  }

  async function doSync() {
    setSyncing(true);
    try {
      const r = await syncEmails();
      if (!r.data.configured) flash("Integração de e-mail (M365) não configurada no .env.");
      else flash(`Sincronizado: ${r.data.imported} importados, ${r.data.matched} casados${r.data.filed ? `, ${r.data.filed} arquivados por confederação` : ""}.`);
      loadEmails();
    } catch { flash("Erro ao sincronizar e-mails."); }
    setSyncing(false);
  }

  const confName = (id: number) => confs.find(c => c.id === id)?.acronym || `#${id}`;

  return (
    <AppShell>
      <Header title="Financeiro" icon="💰"
        help="Estrutura financeira independente por confederação. Fase 1: repasses recebidos das Bets (por ciclo, avulsos e ENDR). Fase 2: repartição dos valores aos beneficiários conforme as regras de rateio. A aba E-mails concilia respostas recebidas. Selecione o cliente no topo para alternar a confederação."
        subtitle="ERP de repasses por confederação — cada cliente é uma estrutura financeira independente" />
      {msg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{msg}</div>}

      {/* Seletor de cliente (confederação) — escopa toda a estrutura financeira */}
      <div className="card mb-6">
        <p className="text-xs text-muted mb-2 uppercase tracking-wide">Cliente (Confederação)</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setActiveConf("")}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${activeConf === "" ? "bg-primary/15 text-primary border-primary/30" : "border-surface-border text-muted hover:text-slate-200"}`}>
            Visão Geral (consolidado)
          </button>
          {confs.map(c => (
            <button key={c.id} onClick={() => setActiveConf(String(c.id))}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${activeConf === String(c.id) ? "bg-primary/15 text-primary border-primary/30" : "border-surface-border text-muted hover:text-slate-200"}`}>
              {c.acronym}
            </button>
          ))}
        </div>
        {activeConf && <p className="text-xs text-muted mt-2">Exibindo a estrutura financeira isolada de <span className="text-slate-200 font-medium">{confs.find(c => String(c.id) === activeConf)?.name}</span>.</p>}
      </div>

      <div className="flex gap-1 border-b border-surface-border mb-6 overflow-x-auto items-center">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={"px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap " + (tab === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-slate-200")}>
            {t}
          </button>
        ))}
        <span className="ml-auto pl-2 pr-1 flex-shrink-0">
          <HelpTip
            title={TABS[tab]}
            text={[
              "Panorama financeiro do cliente selecionado: total recebido, adimplência da competência (calculada pela Conclusão efetiva) e comparativo entre confederações.",
              "Fase 1 — entradas: todos os valores recebidos das Bets (registrados nos ciclos, lançamentos avulsos e repasses ENDR). O mês de competência pode ficar 'a definir' até o relatório da Bet chegar — edite o lançamento para completar.",
              "Fase 2 — saídas: repartição dos valores aos beneficiários conforme as regras de rateio da confederação. Acompanhe parcelas pagas, pendentes e atrasadas, e gerencie o cadastro de beneficiários.",
              "Caixa de conciliação: respostas de e-mail recebidas das Bets. Use Sincronizar para importar do Microsoft 365; mensagens não identificadas podem ser vinculadas manualmente ou com sugestão da IA.",
            ][tab]}
            align="right" wide />
        </span>
      </div>

      {/* RESUMO */}
      {tab === 0 && summary && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-muted mb-2 uppercase">Fase 1 — Recebido das Bets</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="card"><p className="text-xs text-muted">Total Recebido</p><p className="text-2xl font-bold text-success">{formatCurrency(summary.receita.total)}</p></div>
              <div className="card"><p className="text-xs text-muted">Repasse Direto</p><p className="text-2xl font-bold text-white">{formatCurrency(summary.receita.repasse_direto)}</p></div>
              <div className="card"><p className="text-xs text-muted">Via ENDR</p><p className="text-2xl font-bold text-white">{formatCurrency(summary.receita.via_endr)}</p></div>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-muted mb-2 uppercase">Fase 2 — Repartição aos beneficiários</h3>
            <div className="grid grid-cols-4 gap-4">
              <div className="card"><p className="text-xs text-muted">A Repassar</p><p className="text-2xl font-bold text-white">{formatCurrency(summary.repasses.total_a_repassar)}</p></div>
              <div className="card"><p className="text-xs text-muted">Já Repassado</p><p className="text-2xl font-bold text-success">{formatCurrency(summary.repasses.total_repassado)}</p></div>
              <div className="card"><p className="text-xs text-muted">Pendente</p><p className="text-2xl font-bold text-warning">{formatCurrency(summary.repasses.pendente_repasse)}</p></div>
              <div className="card"><p className="text-xs text-muted">Prazos Vencidos</p><p className={"text-2xl font-bold " + (summary.repasses.redistribuicoes_vencidas > 0 ? "text-danger" : "text-success")}>{summary.repasses.redistribuicoes_vencidas}</p></div>
            </div>
          </div>
          {activeConf === "" && (
            <div className="card p-0 overflow-hidden">
              <div className="p-4 border-b border-surface-border"><h3 className="font-semibold text-white">Comparativo por Confederação</h3></div>
              <div className="table-wrap"><table className="w-full text-sm">
                <thead className="bg-surface"><tr>
                  <th className="table-th">Confederação</th><th className="table-th">Receita Total</th>
                  <th className="table-th">Repassado</th><th className="table-th">Pendente Repasse</th>
                  <th className="table-th">Vencidos</th><th className="table-th">Beneficiários</th><th className="table-th"></th>
                </tr></thead>
                <tbody>
                  {byConf.map(c => (
                    <tr key={c.confederation_id} className="border-b border-surface-border/50 hover:bg-surface-border/20 cursor-pointer" onClick={() => setActiveConf(String(c.confederation_id))}>
                      <td className="table-td text-white">{c.acronym}</td>
                      <td className="table-td text-success">{formatCurrency(c.receita_total)}</td>
                      <td className="table-td">{formatCurrency(c.total_repassado)}</td>
                      <td className="table-td text-warning">{formatCurrency(c.pendente_repasse)}</td>
                      <td className="table-td">{c.redistribuicoes_vencidas > 0 ? <span className="text-danger">{c.redistribuicoes_vencidas}</span> : "0"}</td>
                      <td className="table-td text-muted">{c.beneficiarios}</td>
                      <td className="table-td text-primary text-xs">Abrir →</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      )}

      {/* FASE 1 — REPASSES RECEBIDOS */}
      {tab === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-muted">Repasses efetivamente recebidos das Bets: ciclos de cobrança, lançamentos avulsos e repasses do ENDR — tudo a partir da base central única. Estes valores são a origem das repartições da Fase 2.</p>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <select className="input w-56" value={p1Op} onChange={e => setP1Op(e.target.value)}>
                <option value="">Todos os agentes operadores</option>
                {operators.map(o => <option key={o.id} value={o.id}>{o.fantasy_name || o.company_name}</option>)}
              </select>
              <input type="month" className="input w-44" value={p1Month} onChange={e => setP1Month(e.target.value)} />
              <div className="flex rounded-lg border border-surface-border overflow-hidden" title="Competência: mês a que o repasse se refere. Caixa: mês em que o valor entrou.">
                {(["competencia", "caixa"] as const).map(rg => (
                  <button key={rg} onClick={() => setP1Regime(rg)}
                    className={`px-3 py-1.5 text-xs transition-colors ${p1Regime === rg ? "bg-primary text-white" : "bg-surface text-muted hover:text-white"}`}>
                    {rg === "competencia" ? "Competência" : "Caixa"}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => setShowDirectForm(true)} className="btn-primary">+ Novo Lançamento Avulso</button>
          </div>

          <div className="card"><p className="text-xs text-muted">Total recebido (filtros aplicados)</p><p className="text-2xl font-bold text-success">{formatCurrency(phase1Total)}</p></div>

          <DirectPaymentModal
            open={showDirectForm}
            onClose={() => setShowDirectForm(false)}
            onSaved={() => { loadPhase1(); flash("Lançamento registrado na Fase 1."); }}
            operators={operators}
            confederations={confs}
          />

          <div className="card p-0 overflow-hidden">
            <div className="table-wrap"><table className="w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className="table-th">Origem</th><th className="table-th">Agente Operador</th><th className="table-th">Confederação</th>
                  <th className="table-th">Mês Referência</th><th className="table-th">Valor Recebido</th><th className="table-th">Data Recebimento</th>
                  <th className="table-th">Relatório</th><th className="table-th"></th>
                </tr>
              </thead>
              <tbody>
                {phase1.length === 0 && <tr><td colSpan={8} className="table-td text-center text-muted py-8">Nenhum repasse recebido para os filtros.</td></tr>}
                {phase1.map((p: any) => (
                  <tr key={`${p.source}-${p.id}`} className="border-b border-surface-border/50 hover:bg-surface-border/20">
                    <td className="table-td">{p.source === "direct"
                      ? <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full">Avulso</span>
                      : p.source === "endr"
                        ? <span className="text-xs bg-violet-500/15 text-violet-300 px-2 py-0.5 rounded-full">ENDR</span>
                        : <span className="text-xs bg-surface px-2 py-0.5 rounded-full text-slate-300">Ciclo</span>}</td>
                    <td className="table-td font-medium text-white">{p.operator_label}</td>
                    <td className="table-td">{p.confederation_acronym}</td>
                    <td className="table-td">{monthBR(p.reference_month)}{p.reference_month_end ? ` – ${monthBR(p.reference_month_end)}` : ""}</td>
                    <td className="table-td text-success font-medium">{p.amount == null ? <span className="text-muted font-normal text-xs">não individualizado</span> : formatCurrency(p.amount)}</td>
                    <td className="table-td text-muted">{p.received_date ? formatDate(p.received_date) : "—"}</td>
                    <td className="table-td">{p.report_url
                      ? <a href={API_URL + p.report_url} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">Ver</a>
                      : p.report_received ? <span className="text-success text-xs">✓</span> : <span className="text-muted text-xs">—</span>}</td>
                    <td className="table-td">{p.source === "direct" && <button className="text-danger text-xs hover:underline" onClick={() => handleDeleteDirect(p.operator_id, p.id)}>Excluir</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      )}

      {/* FASE 2 — REPARTIÇÃO */}
      {tab === 2 && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={() => setF2sub("repart")} className={f2sub === "repart" ? "btn-primary" : "btn-secondary"}>Repartições</button>
            <button onClick={() => setF2sub("benef")} className={f2sub === "benef" ? "btn-primary" : "btn-secondary"}>Beneficiários</button>
          </div>

          {f2sub === "repart" ? (
            <>
              <p className="text-sm text-muted">Cada repartição deve estar vinculada a um repasse recebido na Fase 1. Os valores são distribuídos aos beneficiários finais conforme o regulamento.</p>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} /> Só prazos vencidos
                </label>
                <button onClick={() => setShowNew(true)} className="btn-primary">+ Nova Repartição</button>
              </div>

              {showNew && <NewRedistribution confs={confs} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); loadRedis(); flash("Repartição criada."); }} />}

              {redis.length === 0 && <p className="text-muted text-sm text-center py-8">Nenhuma repartição. Crie uma a partir de um repasse recebido na Fase 1.</p>}
              {redis.map(r => <RedistributionCard key={r.id} r={r} confName={confName} onChanged={loadRedis} />)}
            </>
          ) : (
            <>
              <div className="flex items-center justify-end">
                <button onClick={() => setEditBen({ type: "atleta", name: "", confederation_id: activeConf ? Number(activeConf) : (confs[0]?.id) })} className="btn-primary">+ Beneficiário</button>
              </div>
              <div className="card p-0 overflow-hidden">
                <div className="table-wrap"><table className="w-full text-sm">
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
                </table></div>
              </div>
              {editBen && <BeneficiaryModal confs={confs} ben={editBen} onClose={() => setEditBen(null)} onSaved={() => { setEditBen(null); loadBen(); flash("Beneficiário salvo."); }} />}
            </>
          )}
        </div>
      )}

      {/* E-MAILS */}
      {tab === 3 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm text-muted">Respostas das Bets importadas da caixa de entrada (M365), casadas pelo remetente e arquivadas como documento para auditoria.</p>
              <div className="mt-2"><MailboxBadge prefix="Sincronizando a caixa" /></div>
            </div>
            <button onClick={doSync} disabled={syncing} className="btn-primary">{syncing ? "Sincronizando..." : "Sincronizar Caixa de Entrada"}</button>
          </div>

          {/* Fila de revisão — e-mails não casados */}
          <EmailReviewQueue
            emails={emails.filter(e => e.direction === "inbound" && !e.matched)}
            operators={operators}
            onLinked={() => { getFinanceEmails().then(r => setEmails(r.data)); flash("E-mail vinculado ao operador."); }}
          />

          {/* E-mails já casados */}
          <div>
            <h3 className="font-semibold text-white text-sm mb-2">Respostas já vinculadas</h3>
            <div className="card p-0 overflow-hidden">
              <div className="table-wrap"><table className="w-full text-sm">
                <thead className="bg-surface"><tr>
                  <th className="table-th">Recebido</th><th className="table-th">De</th><th className="table-th">Assunto</th>
                  <th className="table-th">Bet</th><th className="table-th">Status</th>
                </tr></thead>
                <tbody>
                  {emails.filter(e => e.direction === "inbound" && e.matched).map(e => {
                    const op = operators.find(o => o.id === e.operator_id);
                    return (
                      <tr key={e.id} className="border-b border-surface-border/50">
                        <td className="table-td text-muted text-xs">{e.received_at ? formatDate(e.received_at) : "—"}</td>
                        <td className="table-td text-xs">{e.from_addr}</td>
                        <td className="table-td">{e.subject || "(sem assunto)"}</td>
                        <td className="table-td text-xs">{op ? (op.fantasy_name || op.company_name) : `#${e.operator_id}`}</td>
                        <td className="table-td"><span className="text-xs text-success">✓ Casada</span></td>
                      </tr>
                    );
                  })}
                  {emails.filter(e => e.direction === "inbound" && e.matched).length === 0 && (
                    <tr><td colSpan={5} className="table-td text-center text-muted py-8">Nenhuma resposta casada ainda.</td></tr>
                  )}
                </tbody>
              </table></div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

/* ---------- Nova Repartição (vinculada à Fase 1) ---------- */
function NewRedistribution({ confs, onClose, onSaved }: any) {
  const [form, setForm] = useState<any>({ confederation_id: confs[0]?.id || "", competition_name: "", amount_received: "", received_date: todayISO(), reference_month: "", notes: "", source: "" });
  const [rules, setRules] = useState<any[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<any[]>([]);
  const [phase1, setPhase1] = useState<any[]>([]);
  const [items, setItems] = useState<{ beneficiary_id?: number; beneficiary_label: string; category: string; amount: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!form.confederation_id) return;
    getDistributionRules(Number(form.confederation_id)).then(r => setRules(r.data));
    getBeneficiaries({ confederation_id: Number(form.confederation_id) }).then(r => setBeneficiaries(r.data));
    getPhase1({ confederation_id: Number(form.confederation_id) }).then(r => setPhase1(r.data.items));
  }, [form.confederation_id]);

  function selectSource(val: string) {
    const item = phase1.find((p: any) => `${p.source}:${p.id}` === val);
    if (!item) { setForm((f: any) => ({ ...f, source: "" })); return; }
    setForm((f: any) => ({
      ...f, source: val,
      amount_received: String(item.amount),
      received_date: item.received_date || todayISO(),
      reference_month: item.reference_month ? item.reference_month.slice(0, 7) : "",
      competition_name: f.competition_name || `${item.operator_label} — ${item.confederation_acronym}`,
    }));
  }

  function applyRuleSplit(rule: any) {
    const amt = parseFloat(form.amount_received || "0");
    if (rule.is_equanime) {
      setItems([
        { beneficiary_label: "Confederação", category: "confederacao", amount: "" },
        { beneficiary_label: "Atleta", category: "atleta", amount: "" },
        { beneficiary_label: "Entidade/Clube", category: "clube", amount: "" },
      ]);
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
    if (!form.source) { toast.warn("Selecione o repasse de origem (Fase 1)."); return; }
    if (!form.confederation_id || !form.amount_received || !form.received_date) { toast.warn("Preencha os campos obrigatórios."); return; }
    const [src, srcId] = form.source.split(":");
    setSaving(true);
    try {
      await createRedistribution({
        confederation_id: Number(form.confederation_id),
        source_type: src === "direct" ? "manual" : "payment",
        source_payment_id: src === "payment" ? Number(srcId) : null,
        source_direct_payment_id: src === "direct" ? Number(srcId) : null,
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
    } catch { toast.error("Erro ao criar repartição."); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card border border-surface-border rounded-xl p-6 w-full max-w-3xl space-y-4 max-h-[92vh] overflow-y-auto">
        <h3 className="font-semibold text-white">Nova Repartição (Fase 2)</h3>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Confederação *</label>
            <select className="input" value={form.confederation_id} onChange={e => setForm((f: any) => ({ ...f, confederation_id: e.target.value, source: "" }))}>
              {confs.map((c: any) => <option key={c.id} value={c.id}>{c.acronym}</option>)}
            </select></div>
          <div className="col-span-2"><label className="label">Repasse de origem (Fase 1) *</label>
            <select className="input" value={form.source} onChange={e => selectSource(e.target.value)}>
              <option value="">Selecione o repasse recebido...</option>
              {phase1.map((p: any) => (
                <option key={`${p.source}:${p.id}`} value={`${p.source}:${p.id}`}>
                  {p.source === "direct" ? "[Avulso] " : "[Ciclo] "}{p.operator_label} · {monthBR(p.reference_month)} · {formatCurrency(p.amount)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted mt-1">A repartição é obrigatoriamente vinculada a um valor recebido na Fase 1.</p>
          </div>
          <div><label className="label">Valor Recebido (R$)</label>
            <input type="number" step="0.01" className="input" value={form.amount_received} onChange={e => setForm((f: any) => ({ ...f, amount_received: e.target.value }))} /></div>
          <div><label className="label">Data de Recebimento</label>
            <input type="date" className="input" value={form.received_date} onChange={e => setForm((f: any) => ({ ...f, received_date: e.target.value }))} /></div>
          <div><label className="label">Mês de Referência</label>
            <input type="month" className="input" value={form.reference_month} onChange={e => setForm((f: any) => ({ ...f, reference_month: e.target.value }))} /></div>
          <div className="col-span-3"><label className="label">Competição (opcional)</label>
            <input className="input" placeholder="Ex.: Campeonato Brasileiro 2026" value={form.competition_name} onChange={e => setForm((f: any) => ({ ...f, competition_name: e.target.value }))} /></div>
        </div>

        {rules.length > 0 && (
          <div>
            <label className="label">Aplicar rateio do regulamento (preenche os itens)</label>
            <div className="flex flex-wrap gap-2">
              {rules.map(ru => (
                <button key={ru.id} type="button" onClick={() => applyRuleSplit(ru)}
                  title={ru.is_equanime ? "Rateio equânime: cria os itens com categorias padrão — preencha os valores manualmente" : "Aplica percentuais fixos do regulamento"}
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
                <input className="input w-32" type="number" step="0.01" placeholder="valor (R$)" value={it.amount} onChange={e => setItem(idx, { amount: e.target.value })} />
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

/* ---------- Card de Repartição ---------- */
function RedistributionCard({ r, confName, onChanged }: any) {
  const overdue = r.deadline_date && new Date(r.deadline_date) < new Date() && r.status !== "completed";
  const statusMap: Record<string, string> = { pending: "Pendente", partial: "Parcial", completed: "Concluída" };

  async function payItem(itemId: number) {
    const d = prompt("Data do repasse (formato AAAA-MM-DD):", todayISO());
    if (!d) return;
    await payRedistributionItem(r.id, itemId, { paid_date: d });
    onChanged();
  }
  async function del() { if (confirm("Excluir esta repartição?")) { await deleteRedistribution(r.id); onChanged(); } }

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
    if (!f.name) { toast.warn("Informe o nome do beneficiário."); return; }
    setSaving(true);
    try {
      const payload = { type: f.type, name: f.name, document: f.document, email: f.email, phone: f.phone, bank_name: f.bank_name, bank_agency: f.bank_agency, bank_account: f.bank_account, pix_key: f.pix_key, active: f.active };
      if (f.id) await updateBeneficiary(f.id, payload);
      else await createBeneficiary(Number(f.confederation_id), payload);
      onSaved();
    } catch { toast.success("Erro ao salvar."); }
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
          <div className="col-span-2"><label className="label">Nome *</label><input className="input" placeholder="Ex.: João da Silva / Clube Atlético" value={f.name} onChange={e => setF((s: any) => ({ ...s, name: e.target.value }))} /></div>
          <div><label className="label">CPF/CNPJ</label><input className="input" placeholder="Apenas números ou formatado" value={f.document || ""} onChange={e => setF((s: any) => ({ ...s, document: e.target.value }))} /></div>
          <div><label className="label">E-mail</label><input className="input" type="email" placeholder="exemplo@dominio.com" value={f.email || ""} onChange={e => setF((s: any) => ({ ...s, email: e.target.value }))} /></div>
          <div><label className="label">Telefone</label><input className="input" placeholder="(11) 99999-9999" value={f.phone || ""} onChange={e => setF((s: any) => ({ ...s, phone: e.target.value }))} /></div>
          <div><label className="label">Banco</label><input className="input" placeholder="Ex.: Banco do Brasil" value={f.bank_name || ""} onChange={e => setF((s: any) => ({ ...s, bank_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Agência</label><input className="input" placeholder="0000" value={f.bank_agency || ""} onChange={e => setF((s: any) => ({ ...s, bank_agency: e.target.value }))} /></div>
            <div><label className="label">Conta</label><input className="input" placeholder="00000-0" value={f.bank_account || ""} onChange={e => setF((s: any) => ({ ...s, bank_account: e.target.value }))} /></div>
          </div>
          <div className="col-span-2"><label className="label">Chave PIX</label><input className="input" placeholder="CPF, e-mail, telefone ou chave aleatória" value={f.pix_key || ""} onChange={e => setF((s: any) => ({ ...s, pix_key: e.target.value }))} /></div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Fila de revisão de e-mails não casados (com sugestão de IA) ---------- */
function EmailReviewQueue({ emails, operators, onLinked }: any) {
  const [suggestions, setSuggestions] = useState<Record<number, any>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [selectedOp, setSelectedOp] = useState<Record<number, string>>({});
  const [addContact, setAddContact] = useState<Record<number, boolean>>({});
  const [linkingId, setLinkingId] = useState<number | null>(null);

  async function suggest(emailId: number) {
    setLoadingId(emailId);
    try {
      const r = await suggestEmailOperator(emailId);
      setSuggestions(s => ({ ...s, [emailId]: r.data }));
      if (r.data.operator_id) {
        setSelectedOp(s => ({ ...s, [emailId]: String(r.data.operator_id) }));
      }
    } catch {
      setSuggestions(s => ({ ...s, [emailId]: { error: true } }));
    } finally { setLoadingId(null); }
  }

  async function link(emailId: number) {
    const opId = selectedOp[emailId];
    if (!opId) return;
    setLinkingId(emailId);
    try {
      await linkEmailOperator(emailId, { operator_id: Number(opId), add_as_contact: !!addContact[emailId] });
      onLinked();
    } catch {
      // noop
    } finally { setLinkingId(null); }
  }

  if (emails.length === 0) {
    return (
      <div className="bg-success/10 border border-success/30 rounded-lg px-4 py-3 text-sm text-success">
        ✓ Nenhum e-mail aguardando revisão — todas as respostas estão vinculadas a um operador.
      </div>
    );
  }

  const confColors: Record<string, string> = { high: "text-success", medium: "text-warning", low: "text-muted" };

  return (
    <div>
      <h3 className="font-semibold text-white text-sm mb-2 flex items-center gap-2">
        Fila de Revisão
        <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded-full">{emails.length} sem correspondência</span>
      </h3>
      <p className="text-xs text-muted mb-3">E-mails recebidos cujo remetente não está cadastrado. Use a sugestão da IA e confirme o vínculo (revisão humana).</p>
      <div className="space-y-3">
        {emails.map((e: any) => {
          const sug = suggestions[e.id];
          return (
            <div key={e.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{e.subject || "(sem assunto)"}</p>
                  <p className="text-xs text-muted mt-0.5">De: <span className="font-mono">{e.from_addr}</span> · {e.received_at ? formatDate(e.received_at) : "—"}</p>
                  {e.body_preview && <p className="text-xs text-muted mt-1 line-clamp-2">{e.body_preview.replace(/<[^>]+>/g, "").slice(0, 180)}</p>}
                </div>
                <button onClick={() => suggest(e.id)} disabled={loadingId === e.id} className="btn-secondary text-xs whitespace-nowrap">
                  {loadingId === e.id ? "Analisando..." : "✨ Sugerir com IA"}
                </button>
              </div>

              {sug && !sug.error && (
                <div className="mt-3 p-2 bg-surface rounded-lg text-xs">
                  {sug.operator_id ? (
                    <p className="text-slate-300">
                      Sugestão: <span className="text-white font-medium">{sug.operator_label}</span>
                      <span className={`ml-2 ${confColors[sug.confidence] || "text-muted"}`}>({sug.confidence})</span>
                      {sug.reasoning && <span className="block text-muted mt-0.5">{sug.reasoning}</span>}
                    </p>
                  ) : (
                    <p className="text-muted">A IA não encontrou correspondência clara. Selecione o operador manualmente.{sug.reasoning ? ` ${sug.reasoning}` : ""}</p>
                  )}
                </div>
              )}
              {sug?.error && <p className="mt-3 text-xs text-danger">Erro ao consultar a IA.</p>}

              <div className="flex flex-wrap items-end gap-3 mt-3">
                <div className="flex-1 min-w-[200px]">
                  <label className="label">Vincular ao operador</label>
                  <select className="input" value={selectedOp[e.id] || ""} onChange={ev => setSelectedOp(s => ({ ...s, [e.id]: ev.target.value }))}>
                    <option value="">Selecione...</option>
                    {operators.map((o: any) => <option key={o.id} value={o.id}>{o.fantasy_name || o.company_name}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300 pb-2">
                  <input type="checkbox" checked={!!addContact[e.id]} onChange={ev => setAddContact(s => ({ ...s, [e.id]: ev.target.checked }))} />
                  Cadastrar remetente como contato
                </label>
                <button onClick={() => link(e.id)} disabled={!selectedOp[e.id] || linkingId === e.id} className="btn-primary text-sm">
                  {linkingId === e.id ? "Vinculando..." : "Confirmar vínculo"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
