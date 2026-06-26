"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getTemplates, createTemplate, updateTemplate, deleteTemplate, getConfederations } from "@/lib/api";

const OCCASIONS: Record<string, string> = {
  first_notification: "1ª Notificação",
  second_notification: "2ª Notificação",
  final_notice: "Notificação Final",
  report_request: "Solicitação de Relatório",
  receipt_ack: "Confirmação de Recebimento",
  custom: "Personalizado",
};
const PLACEHOLDERS = ["{bet}", "{confederacao}", "{mes}", "{valor}", "{prazo}", "{escritorio}"];

type Template = { id: number; name: string; occasion: string; confederation_id?: number | null; subject: string; body: string; active: boolean };

export default function ModelosPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [confs, setConfs] = useState<any[]>([]);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [msg, setMsg] = useState("");

  function load() {
    getTemplates().then(r => setTemplates(r.data));
  }
  useEffect(() => { load(); getConfederations().then(r => setConfs(r.data)); }, []);
  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 3000); }

  function newTemplate() {
    setEditing({ name: "", occasion: "custom", confederation_id: null, subject: "", body: "", active: true });
  }

  async function save() {
    if (!editing?.name || !editing?.subject || !editing?.body) { flash("Preencha nome, assunto e corpo."); return; }
    const payload = {
      name: editing.name, occasion: editing.occasion, confederation_id: editing.confederation_id || null,
      subject: editing.subject, body: editing.body, active: editing.active ?? true,
    };
    try {
      if (editing.id) await updateTemplate(editing.id, payload);
      else await createTemplate(payload);
      setEditing(null); load(); flash("Modelo salvo.");
    } catch { flash("Erro ao salvar."); }
  }

  async function remove(id: number) {
    if (!confirm("Excluir este modelo?")) return;
    await deleteTemplate(id); load();
  }

  function insertPlaceholder(ph: string) {
    setEditing(e => e ? { ...e, body: (e.body || "") + ph } : e);
  }

  return (
    <AppShell>
      <Header title="Modelos de Cobrança" subtitle="Textos padrão por ocasião — o endereçamento à Bet é preenchido automaticamente"
        actions={<button onClick={newTemplate} className="btn-primary">+ Novo Modelo</button>} />

      {msg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{msg}</div>}

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
                  {t.confederation_id ? ` · ${confs.find(c => c.id === t.confederation_id)?.acronym || ""}` : " · Global"}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(t)} className="text-xs text-primary hover:underline">Editar</button>
                <button onClick={() => remove(t.id)} className="text-xs text-danger hover:underline">Excluir</button>
              </div>
            </div>
            <p className="text-xs text-slate-400 font-medium mb-1">{t.subject}</p>
            <p className="text-xs text-slate-500 whitespace-pre-line line-clamp-4">{t.body}</p>
          </div>
        ))}
        {templates.length === 0 && <p className="text-muted text-sm">Nenhum modelo cadastrado.</p>}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-card border border-surface-border rounded-xl p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-white">{editing.id ? "Editar Modelo" : "Novo Modelo"}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nome</label>
                <input className="input" value={editing.name || ""} onChange={e => setEditing(s => ({ ...s!, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Ocasião</label>
                <select className="input" value={editing.occasion} onChange={e => setEditing(s => ({ ...s!, occasion: e.target.value }))}>
                  {Object.entries(OCCASIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Confederação (vazio = vale para todas)</label>
                <select className="input" value={editing.confederation_id ?? ""} onChange={e => setEditing(s => ({ ...s!, confederation_id: e.target.value ? Number(e.target.value) : null }))}>
                  <option value="">Global (todas)</option>
                  {confs.map(c => <option key={c.id} value={c.id}>{c.acronym} — {c.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Assunto</label>
                <input className="input" value={editing.subject || ""} onChange={e => setEditing(s => ({ ...s!, subject: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Corpo do e-mail</label>
              <div className="flex flex-wrap gap-1 mb-2">
                {PLACEHOLDERS.map(ph => (
                  <button key={ph} type="button" onClick={() => insertPlaceholder(ph)}
                    className="px-2 py-0.5 text-xs bg-surface-border rounded text-primary hover:bg-primary/10">{ph}</button>
                ))}
              </div>
              <textarea className="input h-48 resize-none font-mono text-xs" value={editing.body || ""} onChange={e => setEditing(s => ({ ...s!, body: e.target.value }))} />
              <p className="text-xs text-muted mt-1">Os campos entre chaves são substituídos automaticamente no envio.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={editing.active ?? true} onChange={e => setEditing(s => ({ ...s!, active: e.target.checked }))} /> Ativo
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(null)} className="btn-secondary">Cancelar</button>
              <button onClick={save} className="btn-primary">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
