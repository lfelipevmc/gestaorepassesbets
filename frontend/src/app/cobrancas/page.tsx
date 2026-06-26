"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import {
  getCollections, createCollection, getConfederations, getTemplates,
  createTemplate, updateTemplate, deleteTemplate,
} from "@/lib/api";
import { formatDate } from "@/lib/utils";

const TABS = ["Ciclos", "Modelos de Cobrança"];

const OCCASIONS: Record<string, string> = {
  first_notification: "1ª Notificação",
  second_notification: "2ª Notificação",
  final_notice: "Notificação Final",
  report_request: "Solicitação de Relatório",
  receipt_ack: "Confirmação de Recebimento",
  custom: "Personalizado",
};
const PLACEHOLDERS = ["{bet}", "{confederacao}", "{mes}", "{valor}", "{prazo}", "{escritorio}"];

function monthLabel(d: string) {
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  } catch { return d; }
}

export default function CobrancasPage() {
  const [tab, setTab] = useState(0);
  const [cycles, setCycles] = useState<any[]>([]);
  const [confederations, setConfederations] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ confederation_id: "", reference_month: "", template_id: "" });

  // Filtros de organização dos ciclos
  const [filterConf, setFilterConf] = useState("");
  const [filterMonth, setFilterMonth] = useState("");

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
      await createCollection({
        confederation_id: parseInt(form.confederation_id),
        reference_month: form.reference_month + "-01",
        template_id: form.template_id ? parseInt(form.template_id) : null,
      });
      setShowCreate(false);
      setForm({ confederation_id: "", reference_month: "", template_id: "" });
      fetchAll();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === "string" ? detail
        : Array.isArray(detail) ? detail.map((e: any) => e.msg || JSON.stringify(e)).join(" | ")
        : "Erro ao criar ciclo de cobrança";
      alert(msg);
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

  // ---- Agrupamento de ciclos: Confederação → Mês ----
  const filtered = cycles.filter(c =>
    (!filterConf || c.confederation_id.toString() === filterConf) &&
    (!filterMonth || (c.reference_month || "").startsWith(filterMonth))
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
        subtitle="Ciclos mensais de cobrança e modelos de mensagem"
        actions={tab === 0
          ? <button onClick={() => setShowCreate(true)} className="btn-primary">+ Novo Ciclo</button>
          : <button onClick={newTemplate} className="btn-primary">+ Novo Modelo</button>}
      />

      <div className="flex gap-1 border-b border-surface-border mb-6">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-slate-300"}`}>
            {t}
          </button>
        ))}
      </div>

      {loading ? <div className="text-muted">Carregando...</div> : tab === 0 ? (
        <>
          {/* Filtros */}
          <div className="flex flex-wrap gap-3 mb-5">
            <select className="input max-w-xs" value={filterConf} onChange={e => setFilterConf(e.target.value)}>
              <option value="">Todas as confederações</option>
              {confederations.map(c => <option key={c.id} value={c.id}>{c.acronym} — {c.name}</option>)}
            </select>
            <input type="month" className="input max-w-[200px]" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} placeholder="Mês" />
            {(filterConf || filterMonth) && (
              <button onClick={() => { setFilterConf(""); setFilterMonth(""); }} className="btn-secondary">Limpar filtros</button>
            )}
          </div>

          <div className="space-y-8">
            {Object.entries(byConf).map(([confId, confCycles]) => {
              const conf = confederations.find(c => c.id.toString() === confId);
              const byMonth: Record<string, any[]> = {};
              confCycles.forEach(c => { (byMonth[c.reference_month] = byMonth[c.reference_month] || []).push(c); });
              const months = Object.keys(byMonth).sort().reverse();
              return (
                <div key={confId}>
                  <h2 className="font-semibold text-white mb-3">{conf?.name || `Confederação #${confId}`} <span className="text-muted text-sm">({conf?.acronym})</span></h2>
                  <div className="space-y-4">
                    {months.map(m => (
                      <div key={m}>
                        <p className="text-xs uppercase tracking-wide text-muted mb-1.5 capitalize">{monthLabel(m)}</p>
                        <div className="card p-0 overflow-hidden">
                          <table className="w-full">
                            <thead className="bg-surface">
                              <tr>
                                <th className="table-th">Ciclo</th>
                                <th className="table-th">Status</th>
                                <th className="table-th">Criado em</th>
                                <th className="table-th"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {byMonth[m].map(c => (
                                <tr key={c.id} className="hover:bg-surface-light/30">
                                  <td className="table-td font-medium text-white">#{c.id}</td>
                                  <td className="table-td"><Badge status={c.status} /></td>
                                  <td className="table-td text-muted">{formatDate(c.created_at)}</td>
                                  <td className="table-td">
                                    <Link href={`/cobrancas/${c.id}`} className="text-primary text-xs hover:underline">Abrir ciclo</Link>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="card text-center py-12 text-muted">Nenhum ciclo de cobrança encontrado</div>}
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
            <input type="month" className="input" required value={form.reference_month} onChange={e => setForm(f => ({ ...f, reference_month: e.target.value }))} />
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
