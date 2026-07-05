"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getProcesses, getProcessStats } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/utils";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const PERIODS = [
  { key: "hoje", label: "Hoje" },
  { key: "ontem", label: "Ontem" },
  { key: "semana", label: "Últimos 7 dias" },
  { key: "todos", label: "Todos" },
];

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
    </div>
  );
}

export default function ProcessosPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [period, setPeriod] = useState("hoje");
  const [search, setSearch] = useState("");
  const [hasLead, setHasLead] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const params: any = { limit: 300 };
    if (period === "hoje") params.detection_date = isoDaysAgo(0);
    else if (period === "ontem") params.detection_date = isoDaysAgo(1);
    else if (period === "semana") params.since = isoDaysAgo(7);
    if (search) params.search = search;
    if (hasLead) params.has_lead = hasLead === "sim";
    setLoading(true);
    Promise.all([getProcesses(params), getProcessStats()])
      .then(([p, s]) => { setRows(p.data); setStats(s.data); })
      .finally(() => setLoading(false));
  }, [period, search, hasLead]);
  useEffect(() => { load(); }, [load]);

  return (
    <AppShell>
      <Header
        title="Processos Autuados"
        subtitle="Processos recém-abertos no TCU, detectados pela comparação diária com os já conhecidos"
      />

      <div className="mb-5 bg-blue-500/5 border border-blue-500/25 rounded-lg px-4 py-3 text-xs text-blue-200/90">
        A cada coleta, o sistema compara a lista de processos do TCU com a já conhecida. Todo processo inédito é registrado como
        <strong> autuado do dia</strong>. Processos que também geraram uma oportunidade aparecem com o link para o lead.
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard label="Hoje" value={stats.hoje} />
          <StatCard label="Ontem" value={stats.ontem} />
          <StatCard label="Últimos 7 dias" value={stats.semana} />
          <StatCard label="Com oportunidade" value={stats.com_lead} />
          <StatCard label="Total conhecido" value={stats.total} />
        </div>
      )}

      <div className="card mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${period === p.key ? "bg-primary/15 text-primary border-primary/30" : "border-surface-border text-muted hover:text-slate-200"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <input className="input max-w-xs" placeholder="Buscar processo/órgão/relator..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input max-w-[12rem]" value={hasLead} onChange={e => setHasLead(e.target.value)}>
          <option value="">Todos</option>
          <option value="sim">Com oportunidade</option>
          <option value="nao">Sem oportunidade</option>
        </select>
      </div>

      {loading ? <div className="text-muted">Carregando...</div> : rows.length === 0 ? (
        <div className="card text-center py-12 text-muted">
          Nenhum processo detectado neste período. A detecção depende da fonte de listagem de processos estar configurada
          (<Link href="/config" className="text-primary">Configuração</Link>) ou de processos vistos nas demais fontes.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full min-w-[1040px]">
            <thead className="bg-surface">
              <tr>
                <th className="table-th">Nº do processo</th>
                <th className="table-th">Responsável(is)</th>
                <th className="table-th">Órgão / Relator</th>
                <th className="table-th">Natureza / Assunto</th>
                <th className="table-th">UF</th>
                <th className="table-th">Detectado em</th>
                <th className="table-th">Oportunidade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const nomes = (r.responsaveis || []).map((x: any) => x.nome).filter(Boolean).join("; ");
                return (
                  <tr key={r.id} className="hover:bg-surface-light/30">
                    <td className="table-td font-medium text-slate-200">{r.numero_processo}</td>
                    <td className="table-td max-w-[300px]">
                      <div className="text-slate-300 truncate">{nomes || <span className="text-muted">—</span>}</div>
                    </td>
                    <td className="table-td max-w-[220px]">
                      <div className="truncate">{r.orgao_entidade || <span className="text-muted">—</span>}</div>
                      <div className="text-[11px] text-muted">{r.relator || ""}</div>
                    </td>
                    <td className="table-td max-w-[220px]">
                      <div className="truncate">{r.natureza || <span className="text-muted">—</span>}</div>
                      <div className="text-[11px] text-muted truncate">{r.assunto || ""}</div>
                    </td>
                    <td className="table-td">{r.uf || <span className="text-muted">—</span>}</td>
                    <td className="table-td">{r.detection_date ? formatDate(r.detection_date) : formatDateTime(r.first_seen_at)}</td>
                    <td className="table-td">
                      {r.lead_id ? <Link href={`/leads/${r.lead_id}`} className="text-primary text-xs hover:underline">ver lead →</Link>
                        : <span className="text-muted text-xs">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
