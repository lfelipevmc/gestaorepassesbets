"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Modal from "@/components/ui/Modal";
import { getLeads, getStats, runPipeline, ingestText, ingestPdf } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

const ACT_LABELS: Record<string, string> = {
  citacao: "Citação (débito)", audiencia: "Audiência", notificacao: "Notificação",
  acordao_condenatorio: "Acórdão condenatório", edital: "Edital / Pauta", outro: "Outro",
};
const ACT_COLORS: Record<string, string> = {
  citacao: "text-danger bg-danger/10 border-danger/30",
  audiencia: "text-warning bg-warning/10 border-warning/30",
  acordao_condenatorio: "text-purple-300 bg-purple-500/10 border-purple-500/30",
  notificacao: "text-blue-300 bg-blue-500/10 border-blue-500/30",
  edital: "text-slate-300 bg-slate-500/10 border-slate-500/30",
  outro: "text-muted bg-muted/10 border-surface-border",
};
const TEMA_LABELS: Record<string, string> = {
  educacao_fnde: "Educação / FNDE", saude: "Saúde", assistencia_social: "Assistência Social / FNAS",
  infraestrutura: "Infraestrutura / DNIT", cultura_fnc: "Cultura / FNC", previdencia: "Previdência / INSS",
  licitacoes: "Licitações", convenios: "Convênios", outro: "Outro",
};
const LEAD_STATUS_LABELS: Record<string, string> = {
  novo: "Novo", qualificado: "Qualificado", em_analise: "Em análise",
  contatado: "Contatado", em_atendimento: "Em atendimento", descartado: "Descartado",
};
const LEAD_STATUS_COLORS: Record<string, string> = {
  novo: "text-blue-300 bg-blue-500/10", qualificado: "text-primary bg-primary/10",
  em_analise: "text-warning bg-warning/10", contatado: "text-cyan-300 bg-cyan-500/10",
  em_atendimento: "text-success bg-success/10", descartado: "text-muted bg-muted/10",
};

function scoreColor(s: number | null) {
  if (s == null) return "text-muted";
  if (s >= 75) return "text-danger font-bold";
  if (s >= 50) return "text-warning font-semibold";
  return "text-slate-400";
}

function responsaveisNomes(l: any): string {
  const lista = (l.responsaveis || []).map((r: any) => r.nome).filter(Boolean);
  if (lista.length) return lista.join("; ");
  return l.responsavel_nome || "";
}

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

export default function LeadsPage() {
  const [stats, setStats] = useState<any>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");
  const [f, setF] = useState<any>({
    act_type: "", tema: "", status: "", doc_type: "", uf: "",
    valor_min: "", only_opportunities: false, hide_represented: false, search: "", order_by: "score",
  });
  const [showIngest, setShowIngest] = useState(false);
  const [ingestTab, setIngestTab] = useState<"text" | "pdf">("text");
  const [ingestTextVal, setIngestTextVal] = useState("");
  const [ingestDate, setIngestDate] = useState("");
  const [ingestFile, setIngestFile] = useState<File | null>(null);
  const [ingesting, setIngesting] = useState(false);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(() => {
    const params: any = { limit: 200, order_by: f.order_by };
    ["act_type", "tema", "status", "doc_type", "uf", "search"].forEach(k => { if (f[k]) params[k] = f[k]; });
    if (f.valor_min) params.valor_min = parseFloat(f.valor_min);
    if (f.only_opportunities) params.only_opportunities = true;
    if (f.hide_represented) params.hide_represented = true;
    setLoading(true);
    Promise.all([getLeads(params), getStats()])
      .then(([l, s]) => { setLeads(l.data); setStats(s.data); })
      .catch(() => flash("Erro ao carregar."))
      .finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { load(); }, [load]);

  async function handleRun() {
    setRunning(true);
    try {
      const r = await runPipeline();
      flash(r.data.message || "Coleta iniciada.");
      setTimeout(load, 4000);
    } catch { flash("Erro ao iniciar coleta."); }
    finally { setRunning(false); }
  }

  async function handleIngest() {
    setIngesting(true);
    try {
      let r;
      if (ingestTab === "text") {
        if (!ingestTextVal.trim()) { flash("Cole o texto do caderno."); setIngesting(false); return; }
        r = await ingestText({ text: ingestTextVal, publication_date: ingestDate || undefined });
      } else {
        if (!ingestFile) { flash("Selecione um PDF."); setIngesting(false); return; }
        const fd = new FormData();
        fd.append("file", ingestFile);
        if (ingestDate) fd.append("publication_date", ingestDate);
        r = await ingestPdf(fd);
      }
      const d = r.data;
      flash(d.message ? d.message : `Ingestão concluída: ${d.created} novos, ${d.duplicated} duplicados.`);
      setShowIngest(false); setIngestTextVal(""); setIngestFile(null); load();
    } catch (e: any) { flash(e.response?.data?.detail || "Erro na ingestão."); }
    finally { setIngesting(false); }
  }

  function clearFilters() {
    setF({ act_type: "", tema: "", status: "", doc_type: "", uf: "", valor_min: "",
      only_opportunities: false, hide_represented: false, search: "", order_by: "score" });
  }

  return (
    <AppShell>
      <Header
        title="Oportunidades"
        subtitle="Leads identificados no Diário Eletrônico/BTCU e nas APIs abertas do TCU"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setShowIngest(true)} className="btn-secondary">Ingerir Diário</button>
            <button onClick={handleRun} disabled={running} className="btn-primary">
              {running ? "Coletando..." : "Executar coleta"}
            </button>
          </div>
        }
      />

      <div className="mb-5 bg-amber-500/5 border border-amber-500/25 rounded-lg px-4 py-3 text-xs text-amber-200/90 flex items-start gap-2">
        <span className="text-amber-400 mt-0.5">⚖️</span>
        <p><strong>Ferramenta interna de inteligência.</strong> Dados de fontes públicas (Diário Oficial/BTCU) para priorização e qualificação de oportunidades.
        Sem contato automático com as partes — a captação de clientela é vedada (OAB Prov. 205/2021, arts. 3º e 6º). Registre a base de legítimo interesse (LGPD) em cada lead.</p>
      </div>

      {msg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{msg}</div>}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <StatCard label="Leads totais" value={stats.total} />
          <StatCard label="Novos" value={stats.novos} />
          <StatCard label="Oportunidades" value={stats.oportunidades} />
          <StatCard label="Em atendimento" value={stats.em_atendimento} />
          <Link href="/processos" className="card hover:border-primary/40 transition-colors">
            <p className="text-xs text-muted uppercase tracking-wide">Autuados hoje</p>
            <p className="text-2xl font-bold text-white mt-1">{stats.autuados_hoje ?? 0}</p>
            <p className="text-xs text-primary mt-0.5">ver processos →</p>
          </Link>
          <StatCard label="Débito monitorado" value={formatCurrency(stats.valor_total_debito)} />
        </div>
      )}

      {stats?.prazos_proximos?.length > 0 && (
        <div className="card mb-6">
          <h3 className="font-semibold text-white text-sm mb-3">⏱️ Prazos processuais próximos</h3>
          <div className="flex flex-wrap gap-2">
            {stats.prazos_proximos.map((p: any) => (
              <Link key={p.id} href={`/leads/${p.id}`}
                className={`text-xs px-3 py-1.5 rounded-lg border ${p.dias_restantes <= 3 ? "border-danger/40 bg-danger/10 text-danger" : "border-warning/30 bg-warning/10 text-warning"}`}>
                {p.responsavel || p.processo || `Lead #${p.id}`} · {p.dias_restantes}d ({formatDate(p.prazo_final)})
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card mb-5 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <input className="input" placeholder="Buscar nome/CPF/processo..." value={f.search} onChange={e => setF({ ...f, search: e.target.value })} />
          <select className="input" value={f.act_type} onChange={e => setF({ ...f, act_type: e.target.value })}>
            <option value="">Todo tipo de ato</option>
            {Object.entries(ACT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input" value={f.tema} onChange={e => setF({ ...f, tema: e.target.value })}>
            <option value="">Todo tema</option>
            {Object.entries(TEMA_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
            <option value="">Todo status</option>
            {Object.entries(LEAD_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input" value={f.doc_type} onChange={e => setF({ ...f, doc_type: e.target.value })}>
            <option value="">PF e PJ</option>
            <option value="cpf">Pessoa Física (CPF)</option>
            <option value="cnpj">Pessoa Jurídica (CNPJ)</option>
          </select>
          <select className="input" value={f.order_by} onChange={e => setF({ ...f, order_by: e.target.value })}>
            <option value="score">Ordenar: Score</option>
            <option value="valor">Ordenar: Valor</option>
            <option value="deadline">Ordenar: Prazo</option>
            <option value="recent">Ordenar: Recentes</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input className="input max-w-[10rem]" type="number" placeholder="Débito mínimo R$" value={f.valor_min} onChange={e => setF({ ...f, valor_min: e.target.value })} />
          <input className="input max-w-[6rem]" placeholder="UF" maxLength={2} value={f.uf} onChange={e => setF({ ...f, uf: e.target.value.toUpperCase() })} />
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={f.only_opportunities} onChange={e => setF({ ...f, only_opportunities: e.target.checked })} /> Só oportunidades
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={f.hide_represented} onChange={e => setF({ ...f, hide_represented: e.target.checked })} /> Ocultar já representados
          </label>
          <button onClick={clearFilters} className="btn-secondary ml-auto">Limpar</button>
        </div>
      </div>

      {loading ? <div className="text-muted">Carregando...</div> : leads.length === 0 ? (
        <div className="card text-center py-12 text-muted">
          Nenhum lead encontrado. Use <strong className="text-slate-300">Executar coleta</strong> ou <strong className="text-slate-300">Ingerir Diário</strong> para começar.
        </div>
      ) : (
        <>
          <p className="text-xs text-muted mb-2">
            <span className="inline-block w-2 h-2 rounded-full bg-primary align-middle mr-1"></span>
            Linhas em destaque = ainda <strong>não abertas</strong>. Ao abrir um lead, ele fica marcado como visto.
          </p>
          <div className="card p-0 overflow-x-auto">
            <table className="w-full min-w-[1040px]">
              <thead className="bg-surface">
                <tr>
                  <th className="table-th w-16">Score</th>
                  <th className="table-th">Ato</th>
                  <th className="table-th">Responsável(is)</th>
                  <th className="table-th">Órgão / entidade</th>
                  <th className="table-th">Tema</th>
                  <th className="table-th text-right">Valor</th>
                  <th className="table-th">Prazo</th>
                  <th className="table-th">Status</th>
                  <th className="table-th"></th>
                </tr>
              </thead>
              <tbody>
                {leads.map(l => {
                  const seen = !!l.viewed_at;
                  const nomes = responsaveisNomes(l);
                  const nResp = (l.responsaveis || []).length;
                  return (
                    <tr key={l.id} className={`hover:bg-surface-light/30 ${seen ? "opacity-60" : "bg-primary/[0.06]"}`}>
                      <td className={`table-td border-l-2 ${seen ? "border-transparent" : "border-primary"}`}>
                        <span className={scoreColor(l.opportunity_score)}>{l.opportunity_score ?? "-"}</span>
                      </td>
                      <td className="table-td">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${ACT_COLORS[l.act_type] || ACT_COLORS.outro}`}>{ACT_LABELS[l.act_type] || l.act_type}</span>
                        {l.ja_representado && <span className="ml-1 text-[10px] text-muted">(c/ adv.)</span>}
                      </td>
                      <td className="table-td max-w-[320px]">
                        <div className={seen ? "text-slate-300" : "text-white font-medium"}>
                          {nomes || <span className="text-muted">—</span>}
                          {nResp > 1 && <span className="ml-1 text-[10px] text-muted">({nResp})</span>}
                        </div>
                        <div className="text-[11px] text-muted">{l.responsavel_documento || l.numero_processo || ""}</div>
                      </td>
                      <td className="table-td max-w-[240px]">
                        <div className="text-slate-300 truncate">{l.orgao_entidade || <span className="text-muted">—</span>}</div>
                        {(l.uf || l.municipio) && <div className="text-[11px] text-muted">{[l.municipio, l.uf].filter(Boolean).join(" / ")}</div>}
                      </td>
                      <td className="table-td">{l.tema ? (TEMA_LABELS[l.tema] || l.tema) : <span className="text-muted">—</span>}</td>
                      <td className="table-td text-right">
                        {l.valor_debito ? formatCurrency(Number(l.valor_debito))
                          : l.valor_multa ? <span className="text-muted">multa {formatCurrency(Number(l.valor_multa))}</span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="table-td">{l.prazo_final ? formatDate(l.prazo_final) : <span className="text-muted">—</span>}</td>
                      <td className="table-td">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${LEAD_STATUS_COLORS[l.status] || "text-muted bg-muted/10"}`}>{LEAD_STATUS_LABELS[l.status] || l.status}</span>
                      </td>
                      <td className="table-td"><Link href={`/leads/${l.id}`} className="text-primary text-xs hover:underline">Abrir →</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal isOpen={showIngest} onClose={() => setShowIngest(false)} title="Ingerir edição do Diário / BTCU">
        <div className="space-y-4">
          <p className="text-xs text-muted">Cole o texto de um caderno ou envie o PDF baixado do BTCU. Útil para começar já e para carregar histórico.</p>
          <div className="flex gap-1 border-b border-surface-border">
            {(["text", "pdf"] as const).map(t => (
              <button key={t} onClick={() => setIngestTab(t)}
                className={`px-3 py-2 text-sm border-b-2 -mb-px ${ingestTab === t ? "border-primary text-primary" : "border-transparent text-muted"}`}>
                {t === "text" ? "Colar texto" : "Enviar PDF"}
              </button>
            ))}
          </div>
          {ingestTab === "text" ? (
            <textarea className="input h-48 resize-none text-xs font-mono" placeholder="Cole aqui o texto do caderno 'Deliberações dos Colegiados'..."
              value={ingestTextVal} onChange={e => setIngestTextVal(e.target.value)} />
          ) : (
            <input type="file" accept=".pdf" onChange={e => setIngestFile(e.target.files?.[0] || null)}
              className="text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-surface-border file:text-slate-200" />
          )}
          <div>
            <label className="label">Data de publicação (para cálculo de prazos)</label>
            <input type="date" className="input max-w-[12rem]" value={ingestDate} onChange={e => setIngestDate(e.target.value)} />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setShowIngest(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleIngest} disabled={ingesting} className="btn-primary">{ingesting ? "Processando..." : "Processar"}</button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
