"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getTasksToday } from "@/lib/api";

const PRIORITY: Record<number, { label: string; cls: string }> = {
  0: { label: "Urgente", cls: "bg-danger/15 text-danger border-danger/30" },
  1: { label: "Hoje", cls: "bg-warning/15 text-warning border-warning/30" },
  2: { label: "Em breve", cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  3: { label: "Acompanhar", cls: "bg-surface text-muted border-surface-border" },
};

export default function TarefasPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTasksToday().then(r => setTasks(r.data.tasks || [])).finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <Header title="A Fazer Hoje" subtitle="Fila priorizada de tarefas operacionais com canal de contato sugerido" />
      {loading ? <div className="text-muted">Carregando...</div> : tasks.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-success font-semibold">Tudo em dia! 🎉</p>
          <p className="text-muted text-sm mt-1">Nenhuma tarefa pendente no momento.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((t, i) => {
            const pr = PRIORITY[t.priority] || PRIORITY[3];
            return (
              <Link key={i} href={t.link} className="card flex items-start justify-between gap-4 hover:border-primary/40 border border-surface-border transition-colors">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${pr.cls}`}>{pr.label}</span>
                    <h3 className="font-semibold text-white text-sm">{t.title}</h3>
                  </div>
                  <p className="text-xs text-muted">{t.detail}</p>
                  {t.items && t.items.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {t.items.slice(0, 12).map((it: any, j: number) => (
                        <span key={j} className="text-[11px] bg-surface px-2 py-0.5 rounded-full text-slate-300">
                          {it.label} <span className="text-muted">· {it.channel}</span>
                        </span>
                      ))}
                      {t.items.length > 12 && <span className="text-[11px] text-muted">+{t.items.length - 12}</span>}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  {t.channel && t.channel !== "—" && <p className="text-[11px] text-muted">Canal: <span className="text-slate-200">{t.channel}</span></p>}
                  <span className="text-primary text-xs">Abrir →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
