"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Modal from "@/components/ui/Modal";
import { getTasksBoard, checkTask, createReminder, toggleReminder, deleteReminder } from "@/lib/api";
import MailboxBadge from "@/components/ui/MailboxBadge";
import { toast } from "@/components/ui/Toast";

const PRIORITY: Record<number, { label: string; cls: string }> = {
  0: { label: "Urgente", cls: "bg-danger/15 text-danger border-danger/30" },
  1: { label: "Hoje", cls: "bg-warning/15 text-warning border-warning/30" },
  2: { label: "Em breve", cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  3: { label: "Acompanhar", cls: "bg-surface text-muted border-surface-border" },
};

export default function TarefasPage() {
  const [board, setBoard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState<string>("");
  const [prioFilter, setPrioFilter] = useState<string>("");
  const [hideDone, setHideDone] = useState(true);
  const [showReminder, setShowReminder] = useState(false);
  const [remForm, setRemForm] = useState({ title: "", notes: "", due_date: "" });
  const [saving, setSaving] = useState(false);

  function load() {
    getTasksBoard().then(r => setBoard(r.data)).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function toggle(item: any) {
    // otimista
    setBoard((b: any) => ({
      ...b,
      categories: b.categories.map((c: any) => ({
        ...c,
        items: c.items.map((i: any) => i.key === item.key ? { ...i, done: !i.done } : i),
      })),
    }));
    try {
      if (item.reminder_id) await toggleReminder(item.reminder_id, !item.done);
      else await checkTask(item.key, !item.done);
    } catch { load(); }
  }

  async function saveReminder(e: React.FormEvent) {
    e.preventDefault();
    if (!remForm.title) { toast.warn("Informe o título."); return; }
    setSaving(true);
    try {
      await createReminder({ title: remForm.title, notes: remForm.notes || null, due_date: remForm.due_date || null });
      setShowReminder(false);
      setRemForm({ title: "", notes: "", due_date: "" });
      load();
    } catch (err: any) { toast.error(err.response?.data?.detail || "Erro ao criar lembrete"); }
    finally { setSaving(false); }
  }

  const cats = (board?.categories || [])
    .filter((c: any) => !catFilter || c.id === catFilter)
    .map((c: any) => ({
      ...c,
      items: c.items
        .filter((i: any) => !hideDone || !i.done)
        .filter((i: any) => prioFilter === "" || String(i.priority) === prioFilter)
        .slice()
        .sort((a: any, b: any) => a.priority - b.priority),
    }));
  const visibleCount = cats.reduce((s: number, c: any) => s + c.items.length, 0);

  return (
    <AppShell>
      <Header
        title="A Fazer"
        icon="✅"
        help="Painel inteligente de atividades: o sistema gera as pendências automaticamente (cronograma de ciclos, respostas de Bets aguardando, contatos desatualizados, relatórios pendentes, tratativas, fechamento do mês e inconsistências cadastrais). Marque o checkbox ao concluir — itens de relatório reaparecem na competência seguinte. Use + Lembrete para criar tarefas próprias com prazo."
        subtitle="Painel de gestão operacional — pendências geradas automaticamente + lembretes"
        actions={<button onClick={() => setShowReminder(true)} className="btn-primary">+ Lembrete</button>}
      />

      {loading ? <div className="text-muted">Carregando...</div> : (
        <>
          {/* Resumo + filtros */}
          <div className="card mb-5">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-warning">{board?.pending ?? 0}</p>
                  <p className="text-[11px] text-muted">pendentes</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{board?.total ?? 0}</p>
                  <p className="text-[11px] text-muted">itens hoje</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select className="input max-w-[220px]" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                  <option value="">Todas as categorias</option>
                  {(board?.categories || []).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.icon} {c.label} ({c.items.length})</option>
                  ))}
                </select>
                <select className="input max-w-[170px]" value={prioFilter} onChange={e => setPrioFilter(e.target.value)}>
                  <option value="">Todas as prioridades</option>
                  <option value="0">Urgente</option>
                  <option value="1">Hoje</option>
                  <option value="2">Em breve</option>
                  <option value="3">Acompanhar</option>
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} /> Ocultar concluídas
                </label>
              </div>
            </div>
          </div>

          {visibleCount === 0 && (
            <div className="card text-center py-12">
              <p className="text-success font-semibold">Tudo em dia! 🎉</p>
              <p className="text-muted text-sm mt-1">Nenhuma pendência para os filtros selecionados.</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {cats.filter((c: any) => c.items.length > 0).map((c: any) => (
              <div key={c.id} className="card p-0 overflow-hidden">
                <div className="px-4 py-3 bg-surface border-b border-surface-border flex items-center justify-between gap-2 flex-wrap">
                  <p className="font-semibold text-white text-sm">{c.icon} {c.label}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.id === "respostas" && <MailboxBadge prefix="Caixa monitorada" />}
                    <span className="text-xs bg-surface-border text-slate-300 px-2 py-0.5 rounded-full">{c.items.filter((i: any) => !i.done).length} pendente(s)</span>
                  </div>
                </div>
                <div className="divide-y divide-surface-border/60 max-h-[420px] overflow-y-auto">
                  {c.items.map((i: any) => {
                    const pr = PRIORITY[i.priority] || PRIORITY[3];
                    return (
                      <div key={i.key} className={`flex items-start gap-3 px-4 py-2.5 hover:bg-surface-light/10 ${i.done ? "opacity-50" : ""}`}>
                        <input type="checkbox" className="mt-1" checked={i.done} onChange={() => toggle(i)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${pr.cls}`}>{pr.label}</span>
                            <p className={`text-sm font-medium ${i.done ? "line-through text-muted" : "text-white"}`}>{i.title}</p>
                            {i.due && <span className="text-[10px] text-muted">({i.due})</span>}
                          </div>
                          {i.detail && <p className="text-xs text-muted mt-0.5">{i.detail}</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                          {i.link && <Link href={i.link} className="text-primary text-xs hover:underline">Abrir</Link>}
                          {i.reminder_id && (
                            <button onClick={async () => { if (confirm("Excluir este lembrete?")) { await deleteReminder(i.reminder_id); load(); } }}
                              className="text-danger text-xs hover:underline">Excluir</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Modal isOpen={showReminder} onClose={() => setShowReminder(false)} title="Novo Lembrete">
        <form onSubmit={saveReminder} className="space-y-4">
          <div>
            <label className="label">Título *</label>
            <input className="input" placeholder="Ex.: Cobrar procuração da CBW" value={remForm.title} onChange={e => setRemForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="label">Detalhes</label>
            <textarea className="input h-20 resize-none" value={remForm.notes} onChange={e => setRemForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div>
            <label className="label">Prazo (opcional)</label>
            <input type="date" className="input max-w-[200px]" value={remForm.due_date} onChange={e => setRemForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowReminder(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Criar Lembrete"}</button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
