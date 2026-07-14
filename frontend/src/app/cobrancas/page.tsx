"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import {
  getCollections, createCollection, getConfederations, getTemplates,
  createTemplate, updateTemplate, deleteTemplate, archiveCycle,
} from "@/lib/api";
import { getUser } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/Toast";
import HelpTip from "@/components/ui/HelpTip";
import EmptyState from "@/components/ui/EmptyState";

const TABS = ["Ciclos", "Modelos de Cobrança"];

const OCCASIONS: Record<string, string> = {
  first_notification: "1ª Notificação",
  second_notification: "2ª Notificação",
  final_notice: "Notificação Final",
  report_request: "Solicitação de Relatório",
  receipt_ack: "Confirmação de Recebimento",
  custom: "Personalizado",
};
const PLACEHOLDERS = ["{bet}", "{confederacao}", "{confederacaosigla}", "{mes}", "{ano}", "{valor}", "{prazo}", "{escritorio}", "{usuario}", "{logomarca}"];

const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function monthLabel(d: string) {
  try {
    const dt = new Date(d);
    const s = dt.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    return s.charAt(0).toUpperCase() + s.slice(1);   // "Julho de 2026" (só a inicial)
  } catch { return d; }
}

// Lista de anos para o seletor (de 2024 ao ano atual + 1)
function yearOptions() {
  const now = new Date().getFullYear();
  const years: number[] = [];
  for (let y = now + 1; y >= 2024; y--) years.push(y);
  return years;
}

export default function CobrancasPage() {
  const me = getUser();
  const [tab, setTab] = useState(0);
  const [cycles, setCycles] = useState<any[]>([]);
  const [confederations, setConfederations] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const now = new Date();
  const [form, setForm] = useState({ confederation_id: "", month: String(now.getMonth() + 1), year: String(now.getFullYear()), template_id: "" });

  // Filtros de organização dos ciclos
  const [filterConf, setFilterConf] = useState("");
  const [filterMonths, setFilterMonths] = useState<string[]>([]);  // múltipla escolha: "YYYY-MM"

  // Estado dos modelos
  const [editing, setEditing] = useState<any | null>(null);
  const [tmplMsg, setTmplMsg] = useState("");

  const fetchAll = () => {
    Promise.all([getCollections(), getConfederations(), getTemplates()])
      .then(([c, confs, tmpls]) => { setCycles(c.data); setConfederations(confs.data); setTemplates(tmpls.data); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchAll(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const mm = String(form.month).padStart(2, "0");
      await createCollection({
        confederation_id: parseInt(form.confederation_id),
        reference_month: `${form.year}-${mm}-01`,
        template_id: form.template_id ? parseInt(form.template_id) : null,
      });
      setShowCreate(false);
      setForm({ confederation_id: "", month: String(now.getMonth() + 1), year: String(now.getFullYear()), template_id: "" });
      fetchAll();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === "string" ? detail
        : Array.isArray(detail) ? detail.map((e: any) => e.msg || JSON.stringify(e)).join(" | ")
        : "Erro ao criar ciclo de cobrança";
      toast.warn(msg);
    } finally { setCreating(false); }
  }

  // ---- Modelos ----
  function flashTmpl(m: string) { setTmplMsg(m); setTimeout(() => setTmplMsg(""), 3000); }
  function newTemplate() { setEditing({ name: "", occasion: "custom", confederation_id: null, subject: "", body: "", active: true }); }
  async function saveTemplate() {
    if (!editing?.name || !editing?.subject || !editing?.body) { flashTmpl("Preencha nome, assunto e corpo."); return; }
    const payload = {
      name: editing.name, occasion: editing.occasion, confederation_id: editing.confederation_id || null,
      subject: editing.subject, body: editing.body, active: editing.active ?? true,
    };
    try {
      if (editing.id) await updateTemplate(editing.id, payload); else await createTemplate(payload);
      setEditing(null); fetchAll(); flashTmpl("Modelo salvo.");
    } catch { flashTmpl("Erro ao salvar."); }
  }
  async function removeTemplate(id: number) {
    if (!confirm("Excluir este modelo?")) return;
    await deleteTemplate(id); fetchAll();
  }

  // Meses disponíveis (para o filtro de múltipla escolha): "YYYY-MM" -> label
  const availableMonths = Array.from(new Set(cycles.map(c => (c.reference_month || "").slice(0, 7)).filter(Boolean)))
    .sort().reverse();
  function toggleMonth(m: string) {
    setFilterMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  }
  function monthChipLabel(ym: string) {
    const [y, m] = ym.split("-");
    return `${MESES_PT[parseInt(m) - 1]?.slice(0, 3)}/${y}`;
  }

  // ---- Agrupamento de ciclos: Confederação → Mês ----
  const filtered = cycles.filter(c =>
    (!filterConf || c.confederation_id.toString() === filterConf) &&
    (filterMonths.length === 0 || filterMonths.includes((c.reference_month || "").slice(0, 7)))
  );
  const byConf: Record<string, any[]> = {};
  filtered.forEach(c => {
    const k = c.confederation_id.toString();
    (byConf[k] = byConf[k] || []).push(c);
  });

  return (
    <AppShell>
      <Header
        title="Cobranças"
        icon="📨"
        help="Cada ciclo representa a cobrança de uma competência (mês) para uma confederação. O ciclo é um espelho da base central: não cria lista própria de operadores. Aqui você prepara notificações, registra recebimentos e acompanha a situação. Ciclos antigos podem ser arquivados pelo administrador — o histórico fica preservado."
        subtitle="Ciclos mensais de cobrança e modelos de mensagem"
        actions={tab === 0
          ? <button onClick={() => setShowCreate(true)} className="btn-primary">+ Novo Ciclo</button>
          : <button onClick={newTemplate} className="btn-primary">+ Novo Modelo</button>}
      />

      <div className="flex gap-1 border-b border-surface-border mb-6 items-center">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-slate-300"}`}>
            {t}
          </button>
        ))}
        <span className="ml-auto pl-2 pr-1 flex-shrink-0">
          <HelpTip
            title={TABS[tab]}
            text={tab === 0
              ? "Ciclos agrupados por confederação, do mais recente ao mais antigo. Cada ciclo espelha a base central de operadores na competência. O administrador pode arquivar ciclos antigos — eles saem da lista, mas o histórico permanece no sistema."
              : "Modelos de mensagem usados nas notificações de cobrança. Aceitam variáveis como {bet}, {confederacao}, {mes} e {valor}, substituídas automaticamente no envio. Modelos podem ser globais ou específicos de uma confederação."}
            align="right" wide />
        </span>
      </div>

      {loading ? <div className="text-muted">Carregando...</div> : tab === 0 ? (
        <>
          {/* Filtros */}
          <div className="space-y-3 mb-5">
            <div className="flex flex-wrap items-center gap-3">
              <select className="input max-w-xs" value={filterConf} onChange={e => setFilterConf(e.target.value)}>
                <option value="">Todas as confederações</option>
                {confederations.map(c => <option key={c.id} value={c.id}>{c.acronym} — {c.name}</option>)}
              </select>
              {(filterConf || filterMonths.length > 0) && (
                <button onClick={() => { setFilterConf(""); setFilterMonths([]); }} className="btn-secondary">Limpar filtros</button>
              )}
            </div>
            {availableMonths.length > 0 && (
              <div>
                <p className="text-xs text-muted mb-1.5">Filtrar por mês/ano (selecione um ou mais):</p>
                <div className="flex flex-wrap gap-2">
                  {availableMonths.map(ym => {
                    const active = filterMonths.includes(ym);
                    return (
                      <button key={ym} onClick={() => toggleMonth(ym)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          active ? "bg-primary/15 text-primary border-primary/30" : "border-surface-border text-muted hover:text-slate-200"}`}>
                        {monthChipLabel(ym)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6 stagger">
            {confederations
              .slice()
              .sort((a, b) => a.acronym.localeCompare(b.acronym))
              .filter(conf => byConf[conf.id.toString()]?.length)
              .map(conf => {
                const confCycles = (byConf[conf.id.toString()] || []).slice().sort((a: any, b: any) => b.reference_month.localeCompare(a.reference_month));
                const currentYm = new Date().toISOString().slice(0, 7);
                return (
                  <div key={conf.id} className="card p-0 overflow-hidden">
                    <div className="px-4 sm:px-5 py-3.5 border-b border-surface-border bg-gradient-to-r from-surface to-surface-light/40 flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-primary/30 to-indigo-500/20 border border-primary/25">
                          <span className="text-primary font-bold text-[11px] tracking-wide">{conf.acronym}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white text-sm truncate">{conf.name}</p>
                          <p className="text-[11px] text-muted">{confCycles.length} competência{confCycles.length !== 1 ? "s" : ""} em acompanhamento</p>
                        </div>
                      </div>
                    </div>

                    {/* Linha do tempo de competências */}
                    <div className="divide-y divide-surface-border/60">
                      {confCycles.map((c: any) => {
                        const isCurrent = (c.reference_month || "").slice(0, 7) === currentYm;
                        return (
                          <Link
                            key={c.id}
                            href={`/cobrancas/${c.id}`}
                            className="group flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 transition-all duration-150 hover:bg-surface-light/40"
                          >
                            {/* marcador do mês */}
                            <div className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0 border transition-colors ${
                              isCurrent
                                ? "bg-primary/20 border-primary/40 text-primary"
                                : "bg-surface border-surface-border text-slate-300 group-hover:border-slate-500/60"}`}>
                              <span className="text-sm font-bold leading-none num">{(c.reference_month || "").slice(5, 7)}</span>
                              <span className="text-[9px] uppercase tracking-wider opacity-70 mt-0.5">{(c.reference_month || "").slice(2, 4)}</span>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-white text-sm">{monthLabel(c.reference_month)}</p>
                                {isCurrent && (
                                  <span className="pill text-primary bg-primary/10 border-primary/30 !py-0.5 text-[10px]">
                                    <span className="pill-dot bg-primary animate-pulse" />competência vigente
                                  </span>
                                )}
                              </div>
                              {c.created_at && <p className="text-[11px] text-muted mt-0.5">Criado em {formatDate(c.created_at)}</p>}
                            </div>

                            <Badge status={c.status} />

                            {me?.role === "admin" && (
                              <button
                                onClick={async (e) => {
                                  e.preventDefault(); e.stopPropagation();
                                  if (!confirm(`Arquivar o ciclo ${monthLabel(c.reference_month)} da ${conf.acronym}? O histórico fica preservado.`)) return;
                                  try { await archiveCycle(c.id); fetchAll(); } catch (err: any) { toast.error(err.response?.data?.detail || "Erro ao arquivar"); }
                                }}
                                className="hidden sm:inline-flex text-[11px] text-muted hover:text-danger px-2 py-1 rounded-md hover:bg-danger/10 transition-colors"
                                title="Somente admin — histórico preservado"
                              >Arquivar</button>
                            )}

                            <svg className="w-4 h-4 text-muted group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            {filtered.length === 0 && <div className="card p-0"><EmptyState icon="📨" title="Nenhum ciclo de cobrança encontrado" hint="Crie o primeiro ciclo com + Novo Ciclo — ele espelha automaticamente a base de operadores na competência escolhida." /></div>}
          </div>
        </>
      ) : (
        <>
          {tmplMsg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{tmplMsg}</div>}
          <p className="text-sm text-muted mb-4">O modelo gera o texto padrão que pode ser trazido na criação dos ciclos e revisado antes do envio. O endereçamento à Bet é preenchido automaticamente.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {templates.map(t => (
              <div key={t.id} className="card">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white">{t.name}</h3>
                      {!t.active && <span className="text-xs text-muted">(inativo)</span>}
                    </div>
                    <p className="text-xs text-muted mt-0.5">
                      {OCCASIONS[t.occasion] || t.occasion}
                      {t.confederation_id ? ` · ${confederations.find(c => c.id === t.confederation_id)?.acronym || ""}` : " · Global"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(t)} className="text-xs text-primary hover:underline">Editar</button>
                    <button onClick={() => removeTemplate(t.id)} className="text-xs text-danger hover:underline">Excluir</button>
                  </div>
                </div>
                <p className="text-xs text-slate-400 font-medium mb-1">{t.subject}</p>
                <p className="text-xs text-slate-500 whitespace-pre-line line-clamp-4">{t.body}</p>
              </div>
            ))}
            {templates.length === 0 && <p className="text-muted text-sm">Nenhum modelo cadastrado.</p>}
          </div>
        </>
      )}

      {/* Modal criar ciclo */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Novo Ciclo de Cobrança">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Confederação *</label>
            <select className="input" required value={form.confederation_id} onChange={e => setForm(f => ({ ...f, confederation_id: e.target.value }))}>
              <option value="">Selecione...</option>
              {confederations.map(c => <option key={c.id} value={c.id}>{c.name} ({c.acronym})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Mês de Referência *</label>
            <div className="grid grid-cols-2 gap-3">
              <select className="input" required value={form.month} onChange={e => setForm(f => ({ ...f, month: e.target.value }))}>
                {MESES_PT.map((nome, i) => <option key={i} value={i + 1}>{nome}</option>)}
              </select>
              <select className="input" required value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))}>
                {yearOptions().map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <p className="text-xs text-muted mt-1">Mês de competência a que se refere a cobrança.</p>
          </div>
          <div>
            <label className="label">Modelo de Cobrança <span className="text-muted font-normal">(opcional)</span></label>
            <select className="input" value={form.template_id} onChange={e => setForm(f => ({ ...f, template_id: e.target.value }))}>
              <option value="">— Nenhum —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={creating} className="btn-primary">{creating ? "Criando..." : "Criar Ciclo"}</button>
          </div>
        </form>
      </Modal>

      {/* Modal editar/criar modelo */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-card border border-surface-border rounded-xl p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-white">{editing.id ? "Editar Modelo" : "Novo Modelo"}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nome</label>
                <input className="input" value={editing.name || ""} onChange={e => setEditing((s: any) => ({ ...s, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Ocasião</label>
                <select className="input" value={editing.occasion} onChange={e => setEditing((s: any) => ({ ...s, occasion: e.target.value }))}>
                  {Object.entries(OCCASIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Confederação (vazio = vale para todas)</label>
                <select className="input" value={editing.confederation_id ?? ""} onChange={e => setEditing((s: any) => ({ ...s, confederation_id: e.target.value ? Number(e.target.value) : null }))}>
                  <option value="">Global (todas)</option>
                  {confederations.map(c => <option key={c.id} value={c.id}>{c.acronym} — {c.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Assunto</label>
                <input className="input" value={editing.subject || ""} onChange={e => setEditing((s: any) => ({ ...s, subject: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Corpo do e-mail</label>
              <div className="flex flex-wrap gap-1 mb-2">
                {PLACEHOLDERS.map(ph => (
                  <button key={ph} type="button" onClick={() => setEditing((e: any) => ({ ...e, body: (e.body || "") + ph }))}
                    className="px-2 py-0.5 text-xs bg-surface-border rounded text-primary hover:bg-primary/10">{ph}</button>
                ))}
              </div>
              <textarea className="input h-48 resize-none font-mono text-xs" value={editing.body || ""} onChange={e => setEditing((s: any) => ({ ...s, body: e.target.value }))} />
              <p className="text-xs text-muted mt-1">Os campos entre chaves são substituídos automaticamente no envio.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={editing.active ?? true} onChange={e => setEditing((s: any) => ({ ...s, active: e.target.checked }))} /> Ativo
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(null)} className="btn-secondary">Cancelar</button>
              <button onClick={saveTemplate} className="btn-primary">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
