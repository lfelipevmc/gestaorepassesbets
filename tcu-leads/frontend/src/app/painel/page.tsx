"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getStats, runPipeline } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import {
  LEAD_STATUS_ORDER, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS,
  CATEGORIA_LABELS, ORIGEM_LABELS,
} from "@/lib/tcu";

function Kpi({ label, value, hint, href, accent }: any) {
  const body = (
    <>
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${accent || "text-white"}`}>{value}</p>
      {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="card hover:border-primary/40 transition-colors block">{body}
      <p className="text-[11px] text-primary mt-1">ver →</p>
    </Link>
  ) : <div className="card">{body}</div>;
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-32 flex-shrink-0 text-slate-300 truncate">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-surface overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-slate-400 tabular-nums">{value}</span>
    </div>
  );
}

const STATUS_BAR: Record<string, string> = {
  novo: "bg-blue-400", qualificado: "bg-primary", em_analise: "bg-warning",
  contatado: "bg-cyan-400", em_atendimento: "bg-success", descartado: "bg-slate-600",
};

export default function PainelPage() {
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const toast = useToast();

  const load = () => {
    setLoading(true);
    getStats().then(r => setS(r.data)).catch(() => toast("Erro ao carregar o painel.", "error")).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function handleRun() {
    setRunning(true);
    try {
      const r = await runPipeline();
      toast(r.data.message || "Coleta iniciada.", "success");
      setTimeout(load, 4000);
    } catch { toast("Erro ao iniciar coleta.", "error"); }
    finally { setRunning(false); }
  }

  if (loading || !s) {
    return <AppShell><Header title="Painel" subtitle="Visão geral da captação" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="card h-24 animate-pulse" />)}
      </div></AppShell>;
  }

  const statusMax = Math.max(1, ...Object.values(s.by_status || {}).map(Number));
  const trendMax = Math.max(1, ...(s.novos_por_dia || []).map((d: any) => d.qtd));
  const origem = Object.entries(s.by_origem || {}).sort((a: any, b: any) => b[1] - a[1]);
  const categoria = Object.entries(s.by_categoria || {}).sort((a: any, b: any) => b[1] - a[1]);
  const pipelineTotal = LEAD_STATUS_ORDER.reduce((acc, k) => acc + (s.by_status?.[k] || 0), 0);

  return (
    <AppShell>
      <Header
        title="Painel"
        subtitle="Visão geral da captação de oportunidades no TCU e no Radar Externo"
        actions={<button onClick={handleRun} disabled={running} className="btn-primary">{running ? "Coletando..." : "Executar coleta"}</button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Oportunidades" value={s.oportunidades ?? 0} accent="text-primary" href="/leads?only_opportunities=1" />
        <Kpi label="Novos (não vistos)" value={s.novos ?? 0} href="/leads?status=novo" />
        <Kpi label="Em atendimento" value={s.em_atendimento ?? 0} accent="text-success" href="/leads?status=em_atendimento" />
        <Kpi label="Autuados hoje" value={s.autuados_hoje ?? 0} hint={`${s.autuados_semana ?? 0} na semana`} href="/processos" accent="text-amber-300" />
        <Kpi label="Com responsável" value={s.com_responsavel ?? 0} hint={`de ${s.total ?? 0} leads`} />
        <Kpi label="Processos rastreados" value={s.processos_total ?? 0} href="/processos" />
        <Kpi label="Débito monitorado" value={formatCurrency(s.valor_total_debito)} />
        <Kpi label="Leads totais" value={s.total ?? 0} href="/leads" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white text-sm">Funil de qualificação</h3>
            <span className="text-xs text-muted">{pipelineTotal} leads no fluxo</span>
          </div>
          <div className="space-y-2.5">
            {LEAD_STATUS_ORDER.map((k) => (
              <BarRow key={k} label={LEAD_STATUS_LABELS[k]} value={s.by_status?.[k] || 0} max={statusMax} color={STATUS_BAR[k]} />
            ))}
          </div>

          <h3 className="font-semibold text-white text-sm mt-6 mb-3">Novos leads nos últimos 7 dias</h3>
          <div className="flex items-end gap-2 h-28">
            {(s.novos_por_dia || []).map((d: any, i: number) => {
              const h = trendMax > 0 ? Math.max(4, Math.round((d.qtd / trendMax) * 100)) : 4;
              const wd = new Date(d.data + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-slate-400 tabular-nums">{d.qtd || ""}</span>
                  <div className="w-full rounded-t bg-primary/70 hover:bg-primary transition-colors" style={{ height: `${h}%` }} title={`${d.qtd} em ${formatDate(d.data)}`} />
                  <span className="text-[10px] text-muted">{wd}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Prazos + origem/categoria + execução */}
        <div className="space-y-6">
          <div className="card">
            <h3 className="font-semibold text-white text-sm mb-3">⏱️ Prazos processuais próximos</h3>
            {s.prazos_proximos?.length ? (
              <div className="space-y-2">
                {s.prazos_proximos.slice(0, 6).map((p: any) => (
                  <Link key={p.id} href={`/leads/${p.id}`} className="flex items-center justify-between gap-2 text-xs hover:bg-surface/60 rounded-lg px-2 py-1.5 -mx-2">
                    <span className="truncate text-slate-300">{p.responsavel || p.processo || `Lead #${p.id}`}</span>
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full ${p.dias_restantes <= 3 ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning"}`}>
                      {p.dias_restantes}d
                    </span>
                  </Link>
                ))}
              </div>
            ) : <p className="text-xs text-muted">Nenhum prazo mapeado.</p>}
          </div>

          <div className="card">
            <h3 className="font-semibold text-white text-sm mb-3">Origem dos leads</h3>
            <div className="space-y-1.5">
              {origem.length ? origem.map(([k, v]: any) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{ORIGEM_LABELS[k] || k}</span>
                  <span className="text-slate-400 tabular-nums">{v}</span>
                </div>
              )) : <p className="text-xs text-muted">Sem dados ainda.</p>}
            </div>
            {categoria.length > 0 && (
              <>
                <div className="border-t border-surface-border my-3" />
                <div className="flex flex-wrap gap-1.5">
                  {categoria.map(([k, v]: any) => (
                    <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-surface text-slate-300">
                      {CATEGORIA_LABELS[k] || k}: <strong>{v}</strong>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {s.last_run && (
            <div className="card">
              <h3 className="font-semibold text-white text-sm mb-2">Última coleta</h3>
              <p className="text-xs text-muted">
                {s.last_run.finished_at ? formatDate(s.last_run.finished_at) : "em andamento"} ·{" "}
                <span className={s.last_run.status === "success" ? "text-success" : s.last_run.status === "error" ? "text-danger" : "text-warning"}>
                  {s.last_run.status}
                </span> · {s.last_run.leads_created ?? 0} novos leads
              </p>
              <Link href="/config" className="text-xs text-primary hover:underline">ver execuções →</Link>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
