"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getFinanceSummary, getFinanceByConfederation, getInadimplenciaHistory } from "@/lib/api";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

type Alert = {
  level: "critical" | "warning" | "info";
  type: string;
  title: string;
  message: string;
  count: number;
  link: string;
};

export default function DashboardPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [inad, setInad] = useState<any>(null);          // {labels, series[]} — inadimplentes por confederação
  const [inadStart, setInadStart] = useState<string>(""); // "YYYY-MM" início da janela (vazio = últimos 6 meses)
  const [summary, setSummary] = useState<any>(null);
  const [byConf, setByConf] = useState<any[]>([]);
  const [transparency, setTransparency] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/api/alerts/"),
      getFinanceSummary(),
      getFinanceByConfederation(),
      api.get("/api/alerts/transparency"),
    ]).then(([al, sum, byc, tr]) => {
      setAlerts(al.data.alerts || []);
      setSummary(sum.data);
      setByConf(byc.data || []);
      setTransparency(tr.data);
    }).finally(() => setLoading(false));
    loadInad("");
  }, []);

  function defaultStart() {
    // últimos 6 meses terminando no mês atual
    const d = new Date(); d.setMonth(d.getMonth() - 5);
    const min = new Date(2025, 0, 1);
    const eff = d < min ? min : d;
    return `${eff.getFullYear()}-${String(eff.getMonth() + 1).padStart(2, "0")}`;
  }

  function loadInad(start: string) {
    const st = start || defaultStart();
    getInadimplenciaHistory({ start: st, months: 6 })
      .then(r => { setInad(r.data); setInadStart(st); })
      .catch(() => {});
  }

  function shiftInad(delta: number) {
    const base = inadStart || defaultStart();
    const [y, m] = base.split("-").map(Number);
    let ny = y, nm = m + delta;
    while (nm <= 0) { nm += 12; ny -= 1; }
    while (nm > 12) { nm -= 12; ny += 1; }
    let next = `${ny}-${String(nm).padStart(2, "0")}`;
    if (next < "2025-01") next = "2025-01";
    const mx = inad?.max_month || defaultStart();
    if (next > mx) next = mx;
    loadInad(next);
  }

  const criticalAlerts = alerts.filter(a => a.level === "critical");
  const warningAlerts = alerts.filter(a => a.level === "warning");
  const infoAlerts = alerts.filter(a => a.level === "info");

  const totalReceived = summary?.receita?.total || 0;
  const totalRepassado = summary?.repasses?.total_repassado || 0;
  const pendente = summary?.repasses?.pendente_repasse || 0;
  const complianceRate = summary?.adimplencia
    ? Math.round(
        (summary.adimplencia.adimplentes /
          Math.max(1, summary.adimplencia.adimplentes + summary.adimplencia.inadimplentes + summary.adimplencia.pendente_relatorio)) *
          100
      )
    : 0;

  return (
    <AppShell>
      <Header
        title="Central de Controle"
        subtitle={`${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`}
      />

      {loading ? (
        <div className="text-muted text-sm">Carregando...</div>
      ) : (
        <>
          {/* Alertas */}
          {alerts.length > 0 && (
            <div className="mb-6 space-y-2">
              {criticalAlerts.map((a, i) => (
                <AlertBanner key={i} alert={a} />
              ))}
              {warningAlerts.map((a, i) => (
                <AlertBanner key={i} alert={a} />
              ))}
              {infoAlerts.map((a, i) => (
                <AlertBanner key={i} alert={a} />
              ))}
            </div>
          )}

          {alerts.length === 0 && (
            <div className="mb-6 bg-success/10 border border-success/30 rounded-lg px-4 py-3 flex items-center gap-3">
              <svg className="w-5 h-5 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-success">Tudo em ordem — nenhuma ação urgente pendente no momento.</p>
            </div>
          )}

          {/* Transparência — o que fizemos este mês */}
          {transparency && (transparency.notificacoes > 0 || transparency.contatos > 0 || transparency.respostas > 0 || transparency.recuperado > 0) && (
            <div className="card mb-6 border border-primary/20 bg-primary/5">
              <h2 className="font-semibold text-white text-sm mb-3">O que realizamos em {transparency.month}</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="text-center"><p className="text-2xl font-bold text-primary">{transparency.notificacoes}</p><p className="text-xs text-muted">Notificações enviadas</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-primary">{transparency.contatos}</p><p className="text-xs text-muted">Contatos ativos</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-primary">{transparency.respostas}</p><p className="text-xs text-muted">Respostas conciliadas</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-success">{formatCurrency(transparency.recuperado)}</p><p className="text-xs text-muted">Recebido no mês</p></div>
              </div>
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard
              label="Total Recebido"
              value={formatCurrency(totalReceived)}
              sub="(Fase 1 — regime de caixa)"
              color="blue"
              icon="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
            <KpiCard
              label="Total Repassado"
              value={formatCurrency(totalRepassado)}
              sub="(Fase 2 — beneficiários)"
              color="green"
              icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
            <KpiCard
              label="A Repassar"
              value={formatCurrency(pendente)}
              sub="pendente para beneficiários"
              color={pendente > 0 ? "yellow" : "green"}
              icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
            <KpiCard
              label="Adimplência Geral"
              value={`${complianceRate}%`}
              sub="pagamentos confirmados"
              color={complianceRate >= 70 ? "green" : complianceRate >= 40 ? "yellow" : "red"}
              icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Evolução de Inadimplentes — por confederação, navegável desde jan/2025 */}
            <div className="card lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-white text-sm">Evolução de Inadimplentes <span className="text-muted font-normal">— por confederação</span></h2>
                <div className="flex items-center gap-1">
                  <button onClick={() => shiftInad(-6)} className="px-2 py-0.5 text-xs border border-surface-border rounded hover:bg-surface text-slate-300" title="6 meses anteriores">«</button>
                  <button onClick={() => shiftInad(-1)} className="px-2 py-0.5 text-xs border border-surface-border rounded hover:bg-surface text-slate-300" title="Mês anterior">‹</button>
                  <span className="text-[11px] text-muted px-1">{inad?.labels?.[0] || ""} — {inad?.labels?.[inad?.labels?.length - 1] || ""}</span>
                  <button onClick={() => shiftInad(1)} className="px-2 py-0.5 text-xs border border-surface-border rounded hover:bg-surface text-slate-300" title="Próximo mês">›</button>
                  <button onClick={() => shiftInad(6)} className="px-2 py-0.5 text-xs border border-surface-border rounded hover:bg-surface text-slate-300" title="6 meses à frente">»</button>
                  <button onClick={() => loadInad("")} className="px-2 py-0.5 text-xs border border-surface-border rounded hover:bg-surface text-slate-300" title="Janela atual">Hoje</button>
                </div>
              </div>
              {inad && inad.labels?.length ? (() => {
                const CORES = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899", "#84cc16"];
                const data = inad.labels.map((lb: string, i: number) => {
                  const row: any = { month: lb };
                  inad.series.forEach((sr: any) => { row[sr.acronym] = sr.data[i]; });
                  return row;
                });
                return (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
                      <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                        labelStyle={{ color: "#e2e8f0" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {inad.series.map((sr: any, i: number) => (
                        <Line key={sr.acronym} type="monotone" dataKey={sr.acronym}
                          stroke={CORES[i % CORES.length]} strokeWidth={2}
                          dot={{ fill: CORES[i % CORES.length], r: 3 }} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                );
              })() : (
                <div className="h-[220px] flex items-center justify-center text-muted text-sm">Carregando histórico...</div>
              )}
              <p className="text-[11px] text-muted mt-2">Histórico desde janeiro/2025; novos meses entram automaticamente. Use as setas para navegar.</p>
            </div>

            {/* Por confederação */}
            <div className="card">
              <h2 className="font-semibold text-white mb-4 text-sm">Por Confederação</h2>
              <div className="space-y-3">
                {byConf.length === 0 && <p className="text-muted text-sm">Sem dados.</p>}
                {byConf.map(c => {
                  const total = c.receita_total || 0;
                  const repassado = c.total_repassado || 0;
                  const pct = total > 0 ? Math.round((repassado / total) * 100) : 0;
                  return (
                    <div key={c.confederation_id} className="p-3 bg-surface rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-white text-sm">{c.acronym}</span>
                        {c.redistribuicoes_vencidas > 0 && (
                          <span className="text-xs bg-danger/20 text-danger px-2 py-0.5 rounded-full">
                            {c.redistribuicoes_vencidas} vencida(s)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted mb-1">
                        <span>Recebido: {formatCurrency(total)}</span>
                        <span>{pct}% repassado</span>
                      </div>
                      <div className="w-full h-1.5 bg-surface-border rounded-full">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Atalhos rápidos */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { href: "/cobrancas", label: "Nova Cobrança", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01", desc: "Abrir ciclo ou lançar avulso" },
              { href: "/financeiro", label: "Registrar Recebimento", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z", desc: "Fase 1 — regime de caixa" },
              { href: "/relatorios", label: "Exportar Relatório", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", desc: "Relatório consolidado em PDF/Excel" },
              { href: "/auditoria", label: "Trilha de Auditoria", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", desc: "Exportar log completo" },
            ].map(item => (
              <Link key={item.href} href={item.href} className="card hover:border-primary/40 border border-surface-border transition-colors group">
                <svg className="w-5 h-5 text-muted group-hover:text-primary mb-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                </svg>
                <p className="text-sm font-medium text-white">{item.label}</p>
                <p className="text-xs text-muted mt-0.5">{item.desc}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}

function AlertBanner({ alert }: { alert: Alert }) {
  const styles = {
    critical: { wrap: "bg-danger/10 border-danger/40 text-danger", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
    warning: { wrap: "bg-warning/10 border-warning/40 text-warning", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
    info: { wrap: "bg-blue-500/10 border-blue-500/30 text-blue-300", icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  };
  const s = styles[alert.level];
  return (
    <Link href={alert.link} className={`flex items-start gap-3 rounded-lg border px-4 py-3 hover:opacity-80 transition-opacity ${s.wrap}`}>
      <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={s.icon} />
      </svg>
      <div>
        <p className="text-sm font-semibold">{alert.title}</p>
        <p className="text-xs opacity-80 mt-0.5">{alert.message}</p>
      </div>
      <svg className="w-4 h-4 ml-auto flex-shrink-0 mt-0.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

function KpiCard({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: string }) {
  const colors: Record<string, string> = {
    blue: "text-blue-400 bg-blue-400/10",
    green: "text-success bg-success/10",
    yellow: "text-warning bg-warning/10",
    red: "text-danger bg-danger/10",
  };
  return (
    <div className="card">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${colors[color]}`}>
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
        </svg>
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-xs font-medium text-slate-300 mt-0.5">{label}</p>
      <p className="text-xs text-muted mt-0.5">{sub}</p>
    </div>
  );
}
