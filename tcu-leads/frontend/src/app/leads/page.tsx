"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Modal from "@/components/ui/Modal";
import { getLeads, runPipeline, ingestText, ingestPdf, updateLead } from "@/lib/api";
import { formatCurrency, formatDate, relativeDays } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import {
  ACT_LABELS, ACT_COLORS, TEMA_LABELS,
  LEAD_STATUS_ORDER, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, LEAD_STATUS_ACCENT,
  ORIGEM_LABELS, CATEGORIA_LABELS, CATEGORIA_COLORS,
  origemBadge, scoreColor, responsaveisNomes,
} from "@/lib/tcu";

const EMPTY_FILTERS = {
  act_type: "", tema: "", status: "", doc_type: "", uf: "", source_kind: "", categoria: "",
  valor_min: "", only_opportunities: false, hide_represented: false, search: "", order_by: "score",
};

function OrigemBadges({ l }: { l: any }) {
  return (
    <>
      <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${origemBadge(l.source_kind)}`} title={l.fonte_nome || ""}>
        {ORIGEM_LABELS[l.source_kind] || l.source_kind}
      </span>
      {l.categoria && l.categoria !== "tcu" && CATEGORIA_COLORS[l.categoria] && (
        <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${CATEGORIA_COLORS[l.categoria]}`}>
          {CATEGORIA_LABELS[l.categoria] || l.categoria}
        </span>
      )}
    </>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<"lista" | "quadro">("lista");
  const [f, setF] = useState<any>(EMPTY_FILTERS);
  const [showIngest, setShowIngest] = useState(false);
  const [ingestTab, setIngestTab] = useState<"text" | "pdf">("text");
  const [ingestTextVal, setIngestTextVal] = useState("");
  const [ingestDate, setIngestDate] = useState("");
  const [ingestFile, setIngestFile] = useState<File | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const toast = useToast();

  // Filtros iniciais vindos da URL (links do Painel)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.toString()) return;
    setF((prev: any) => ({
      ...prev,
      status: q.get("status") || prev.status,
      source_kind: q.get("source_kind") || prev.source_kind,
      categoria: q.get("categoria") || prev.categoria,
      search: q.get("search") || prev.search,
      only_opportunities: q.get("only_opportunities") === "1" || prev.only_opportunities,
    }));
    if (q.get("view") === "quadro") setView("quadro");
  }, []);

  const load = useCallback(() => {
    const params: any = { limit: 300, order_by: f.order_by };
    ["act_type", "tema", "status", "doc_type", "uf", "source_kind", "categoria", "search"].forEach(k => { if (f[k]) params[k] = f[k]; });
    if (f.valor_min) params.valor_min = parseFloat(f.valor_min);
    if (f.only_opportunities) params.only_opportunities = true;
    if (f.hide_represented) params.hide_represented = true;
    setLoading(true);
    getLeads(params).then(l => setLeads(l.data)).catch(() => toast("Erro ao carregar.", "error")).finally(() => setLoading(false));
  }, [f, toast]);
  useEffect(() => { load(); }, [load]);

  async function handleRun() {
    setRunning(true);
    try {
      const r = await runPipeline();
      toast(r.data.message || "Coleta iniciada.", "success");
      setTimeout(load, 4000);
    } catch { toast("Erro ao iniciar coleta.", "error"); }
    finally { setRunning(false); }
  }

  async function handleIngest() {
    setIngesting(true);
    try {
      let r;
      if (ingestTab === "text") {
        if (!ingestTextVal.trim()) { toast("Cole o texto do caderno.", "error"); setIngesting(false); return; }
        r = await ingestText({ text: ingestTextVal, publication_date: ingestDate || undefined });
      } else {
        if (!ingestFile) { toast("Selecione um PDF.", "error"); setIngesting(false); return; }
        const fd = new FormData();
        fd.append("file", ingestFile);
        if (ingestDate) fd.append("publication_date", ingestDate);
        r = await ingestPdf(fd);
      }
      const d = r.data;
      toast(d.message ? d.message : `Ingestão concluída: ${d.created} novos, ${d.duplicated} duplicados.`, "success");
      setShowIngest(false); setIngestTextVal(""); setIngestFile(null); load();
    } catch (e: any) { toast(e.response?.data?.detail || "Erro na ingestão.", "error"); }
    finally { setIngesting(false); }
  }

  async function moveLead(id: number, status: string) {
    const lead = leads.find(l => l.id === id);
    if (!lead || lead.status === status) return;
    const prev = lead.status;
    setLeads(ls => ls.map(l => l.id === id ? { ...l, status } : l));  // otimista
    try {
      await updateLead(id, { status });
      toast(`Movido para “${LEAD_STATUS_LABELS[status]}”.`, "success");
    } catch {
      setLeads(ls => ls.map(l => l.id === id ? { ...l, status: prev } : l));
      toast("Não foi possível mover o lead.", "error");
    }
  }

  function exportCsv() {
    const cols = [
      ["Score", (l: any) => l.opportunity_score ?? ""],
      ["Status", (l: any) => LEAD_STATUS_LABELS[l.status] || l.status],
      ["Origem", (l: any) => ORIGEM_LABELS[l.source_kind] || l.source_kind],
      ["Categoria", (l: any) => CATEGORIA_LABELS[l.categoria] || l.categoria || ""],
      ["Ato", (l: any) => ACT_LABELS[l.act_type] || l.act_type],
      ["Responsáveis", (l: any) => responsaveisNomes(l)],
      ["Documento", (l: any) => l.responsavel_documento || ""],
      ["Órgão", (l: any) => l.orgao_entidade || ""],
      ["UF", (l: any) => l.uf || ""],
      ["Processo", (l: any) => l.numero_processo || ""],
      ["Débito", (l: any) => l.valor_debito || ""],
      ["Multa", (l: any) => l.valor_multa || ""],
      ["Prazo", (l: any) => l.prazo_final || ""],
      ["Fonte", (l: any) => l.fonte_nome || ""],
    ] as const;
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [cols.map(c => c[0]).join(";")];
    leads.forEach(l => rows.push(cols.map(c => esc(c[1](l))).join(";")));
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tcu-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast(`${leads.length} leads exportados.`, "success");
  }

  const activeFilters = Object.entries(f).filter(([k, v]) => v && v !== "score" && k !== "order_by").length;

  return (
    <AppShell>
      <Header
        title="Oportunidades"
        subtitle="Leads do TCU (Diário/BTCU, autuados) e do Radar Externo (DOU, sites e RSS)"
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
          <select className="input" value={f.source_kind} onChange={e => setF({ ...f, source_kind: e.target.value })}>
            <option value="">Toda origem</option>
            <option value="dou">DOU (Diário Oficial)</option>
            <option value="fonte_web">Radar web (sites/RSS)</option>
            <option value="processo_autuado">TCU · Autuado</option>
            <option value="btcu_deliberacoes">TCU · Diário/BTCU</option>
            <option value="acordaos_api">TCU · Acórdão</option>
            <option value="pauta_sessao">TCU · Pauta</option>
          </select>
          <select className="input" value={f.categoria} onChange={e => setF({ ...f, categoria: e.target.value })}>
            <option value="">Toda categoria</option>
            <option value="tcu">TCU</option>
            <option value="licitacao">Licitação / contratação</option>
            <option value="sancao">Sanção / investigação</option>
            <option value="nomeacao">Nomeação / gestão</option>
            <option value="palavra_chave">Palavra-chave</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select className="input max-w-[11rem]" value={f.doc_type} onChange={e => setF({ ...f, doc_type: e.target.value })}>
            <option value="">PF e PJ</option>
            <option value="cpf">Pessoa Física (CPF)</option>
            <option value="cnpj">Pessoa Jurídica (CNPJ)</option>
          </select>
          <select className="input max-w-[11rem]" value={f.order_by} onChange={e => setF({ ...f, order_by: e.target.value })}>
            <option value="score">Ordenar: Score</option>
            <option value="valor">Ordenar: Valor</option>
            <option value="deadline">Ordenar: Prazo</option>
            <option value="recent">Ordenar: Recentes</option>
          </select>
          <input className="input max-w-[9rem]" type="number" placeholder="Débito mín. R$" value={f.valor_min} onChange={e => setF({ ...f, valor_min: e.target.value })} />
          <input className="input max-w-[5rem]" placeholder="UF" maxLength={2} value={f.uf} onChange={e => setF({ ...f, uf: e.target.value.toUpperCase() })} />
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={f.only_opportunities} onChange={e => setF({ ...f, only_opportunities: e.target.checked })} /> Só oportunidades
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={f.hide_represented} onChange={e => setF({ ...f, hide_represented: e.target.checked })} /> Ocultar já representados
          </label>
          {activeFilters > 0 && <button onClick={() => setF(EMPTY_FILTERS)} className="btn-secondary ml-auto">Limpar filtros</button>}
        </div>
      </div>

      {/* Barra de ações: contagem, alternância de visão, exportar */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-muted">{loading ? "Carregando..." : `${leads.length} lead(s)`}</p>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} disabled={!leads.length} className="btn-secondary text-xs disabled:opacity-40">⭳ Exportar CSV</button>
          <div className="inline-flex rounded-lg border border-surface-border overflow-hidden">
            {(["lista", "quadro"] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs ${view === v ? "bg-primary text-white" : "text-slate-400 hover:text-slate-200"}`}>
                {v === "lista" ? "☰ Lista" : "▦ Quadro"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card h-14 animate-pulse" />)}</div>
      ) : leads.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-4xl mb-2">🔍</p>
          <p className="text-slate-300 font-medium">Nenhum lead encontrado</p>
          <p className="text-muted text-sm mt-1">
            {activeFilters > 0 ? "Tente limpar os filtros." : <>Use <strong className="text-slate-300">Executar coleta</strong> ou <strong className="text-slate-300">Ingerir Diário</strong> para começar.</>}
          </p>
        </div>
      ) : view === "quadro" ? (
        /* ---------- QUADRO (Kanban) ---------- */
        <div className="flex gap-3 overflow-x-auto pb-3">
          {LEAD_STATUS_ORDER.map(status => {
            const cards = leads.filter(l => l.status === status);
            return (
              <div key={status}
                onDragOver={e => { e.preventDefault(); setDragOver(status); }}
                onDragLeave={() => setDragOver(d => d === status ? null : d)}
                onDrop={e => { e.preventDefault(); setDragOver(null); const id = Number(e.dataTransfer.getData("text/plain")); if (id) moveLead(id, status); }}
                className={`w-72 flex-shrink-0 rounded-xl border-t-2 ${LEAD_STATUS_ACCENT[status]} bg-surface-card border border-surface-border ${dragOver === status ? "ring-2 ring-primary/50" : ""}`}>
                <div className="px-3 py-2.5 flex items-center justify-between border-b border-surface-border">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${LEAD_STATUS_COLORS[status]}`}>{LEAD_STATUS_LABELS[status]}</span>
                  <span className="text-xs text-muted tabular-nums">{cards.length}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[80px] max-h-[calc(100vh-320px)] overflow-y-auto">
                  {cards.map(l => (
                    <Link key={l.id} href={`/leads/${l.id}`} draggable
                      onDragStart={e => e.dataTransfer.setData("text/plain", String(l.id))}
                      className="block rounded-lg border border-surface-border bg-surface p-2.5 hover:border-primary/40 cursor-grab active:cursor-grabbing">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1 flex-wrap"><OrigemBadges l={l} /></div>
                        <span className={`text-xs ${scoreColor(l.opportunity_score)}`}>{l.opportunity_score ?? "-"}</span>
                      </div>
                      <p className="text-sm text-white font-medium leading-snug line-clamp-2">{responsaveisNomes(l) || l.orgao_entidade || l.numero_processo || "—"}</p>
                      {l.orgao_entidade && responsaveisNomes(l) && <p className="text-[11px] text-muted truncate mt-0.5">{l.orgao_entidade}</p>}
                      <div className="flex items-center justify-between mt-1.5 text-[11px]">
                        <span className="text-slate-400">{l.valor_debito ? formatCurrency(Number(l.valor_debito)) : l.numero_processo || ""}</span>
                        {l.prazo_final && <span className="text-warning">{relativeDays(l.prazo_final)}</span>}
                      </div>
                    </Link>
                  ))}
                  {cards.length === 0 && <p className="text-[11px] text-muted text-center py-4">Arraste leads para cá</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ---------- LISTA ---------- */
        <>
          <p className="text-xs text-muted mb-2">
            <span className="inline-block w-2 h-2 rounded-full bg-primary align-middle mr-1"></span>
            Linhas em destaque = ainda <strong>não abertas</strong>. Ao abrir um lead, ele fica marcado como visto.
          </p>
          <div className="card p-0 overflow-x-auto">
            <table className="w-full min-w-[1180px]">
              <thead className="bg-surface">
                <tr>
                  <th className="table-th w-16">Score</th>
                  <th className="table-th">Origem</th>
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
                      <td className="table-td"><div className="flex flex-col gap-1 items-start"><OrigemBadges l={l} /></div></td>
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
                      <td className="table-td whitespace-nowrap">{l.prazo_final ? <span title={formatDate(l.prazo_final)}>{relativeDays(l.prazo_final)}</span> : <span className="text-muted">—</span>}</td>
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
