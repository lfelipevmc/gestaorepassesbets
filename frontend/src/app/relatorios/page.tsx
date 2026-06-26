"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import {
  getConfederations, getCollections, getOperators, getComplianceReport, downloadExcelReport,
  getCrossReport, downloadCrossExcel, downloadCrossPdf, downloadEvidencePdf,
} from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "", label: "Todas as situações" },
  { value: "paid", label: "Adimplente" },
  { value: "report_pending", label: "Pendente de Relatório" },
  { value: "pending", label: "Inadimplente" },
  { value: "overdue", label: "Em Atraso" },
  { value: "partial", label: "Parcial" },
];

export default function RelatoriosPage() {
  const [tab, setTab] = useState<"consolidado" | "ciclo" | "evidencias">("consolidado");
  const [confederations, setConfederations] = useState<any[]>([]);
  const [cycles, setCycles] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([getConfederations(), getCollections(), getOperators({ limit: 300 })])
      .then(([c, cy, ops]) => { setConfederations(c.data); setCycles(cy.data); setOperators(ops.data); });
  }, []);

  return (
    <AppShell>
      <Header title="Relatórios" subtitle="Adimplência individualizada por confederação, mês e Bet — com visão consolidada e cruzada" />

      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab("consolidado")} className={tab === "consolidado" ? "btn-primary" : "btn-secondary"}>Consolidado / Cruzado</button>
        <button onClick={() => setTab("ciclo")} className={tab === "ciclo" ? "btn-primary" : "btn-secondary"}>Por Ciclo</button>
        <button onClick={() => setTab("evidencias")} className={tab === "evidencias" ? "btn-primary" : "btn-secondary"}>Evidências (ISO 9001)</button>
      </div>

      {tab === "consolidado" && <Consolidado confederations={confederations} operators={operators} cycles={cycles} />}
      {tab === "ciclo" && <PorCiclo confederations={confederations} cycles={cycles} />}
      {tab === "evidencias" && <Evidencias confederations={confederations} />}
    </AppShell>
  );
}

/* ------------------------- Consolidado / Cruzado ------------------------- */
function Consolidado({ confederations, operators, cycles }: { confederations: any[]; operators: any[]; cycles: any[] }) {
  const [filters, setFilters] = useState({ confederation_id: "", month: "", operator_id: "", status: "" });
  const MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const availableMonths = Array.from(new Set((cycles || []).map((c: any) => (c.reference_month || "").slice(0, 7)).filter(Boolean))).sort().reverse() as string[];
  const monthBtnLabel = (ym: string) => { const [y, m] = ym.split("-"); return `${MESES_PT[parseInt(m) - 1]}/${y}`; };
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  function buildParams() {
    const p: any = {};
    if (filters.confederation_id) p.confederation_id = filters.confederation_id;
    if (filters.month) p.month = `${filters.month}-01`;
    if (filters.operator_id) p.operator_id = filters.operator_id;
    if (filters.status) p.status = filters.status;
    return p;
  }

  async function generate() {
    setLoading(true);
    try {
      const r = await getCrossReport(buildParams());
      setReport(r.data);
    } catch (e: any) {
      alert(e.response?.data?.detail || "Erro ao gerar relatório");
    } finally { setLoading(false); }
  }

  useEffect(() => { generate(); /* carga inicial */ }, []); // eslint-disable-line

  async function download() {
    setDownloading(true);
    try {
      const r = await downloadCrossExcel(buildParams());
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a");
      a.href = url; a.download = "relatorio_consolidado.xlsx"; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const r = await downloadCrossPdf(buildParams());
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = "relatorio_consolidado.pdf"; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  }

  return (
    <>
      <div className="card mb-6">
        <h3 className="font-semibold text-white mb-4">Filtros</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Confederação</label>
            <select className="input" value={filters.confederation_id} onChange={e => setFilters(f => ({ ...f, confederation_id: e.target.value }))}>
              <option value="">Todas</option>
              {confederations.map(c => <option key={c.id} value={c.id}>{c.acronym}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Mês de Referência</label>
            {availableMonths.length === 0 ? (
              <p className="text-xs text-muted mt-2">Nenhum ciclo cadastrado.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setFilters(f => ({ ...f, month: "" }))}
                  className={`px-2.5 py-1 rounded-full text-xs border ${!filters.month ? "bg-primary/15 text-primary border-primary/30" : "border-surface-border text-muted hover:text-slate-200"}`}>Todos</button>
                {availableMonths.map(ym => (
                  <button key={ym} type="button" onClick={() => setFilters(f => ({ ...f, month: ym }))}
                    className={`px-2.5 py-1 rounded-full text-xs border ${filters.month === ym ? "bg-primary/15 text-primary border-primary/30" : "border-surface-border text-muted hover:text-slate-200"}`}>{monthBtnLabel(ym)}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="label">Bet (Agente Operador)</label>
            <select className="input" value={filters.operator_id} onChange={e => setFilters(f => ({ ...f, operator_id: e.target.value }))}>
              <option value="">Todas</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.fantasy_name || o.company_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Situação</label>
            <select className="input" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={generate} disabled={loading} className="btn-primary">{loading ? "Gerando..." : "Aplicar Filtros"}</button>
          <button onClick={download} disabled={downloading} className="btn-secondary">{downloading ? "Baixando..." : "Exportar Excel"}</button>
          <button onClick={downloadPdf} disabled={downloading} className="btn-secondary">{downloading ? "Baixando..." : "Exportar PDF"}</button>
          <button onClick={() => { setFilters({ confederation_id: "", month: "", operator_id: "", status: "" }); }} className="btn-secondary">Limpar</button>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <Stat value={report.totals.count} label="Lançamentos" />
            <Stat value={report.totals.adimplentes} label="Adimplentes" color="text-success" />
            <Stat value={report.totals.pendente_relatorio} label="Pend. de Relatório" color="text-warning" />
            <Stat value={report.totals.inadimplentes} label="Inadimplentes" color="text-danger" />
            <div className="card text-center">
              <p className="text-2xl font-bold text-success">{formatCurrency(report.totals.amount_paid)}</p>
              <p className="text-xs text-muted">Total Recebido</p>
            </div>
          </div>

          {/* Visão cruzada: por confederação e por mês */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <AggTable title="Por Confederação" labelKey="confederation_acronym" rows={report.by_confederation} header="Confederação" />
            <AggTable title="Por Mês" labelKey="reference_month" rows={report.by_month} header="Mês" />
          </div>

          {/* Individualizado */}
          <div className="card p-0 overflow-hidden">
            <div className="p-4 border-b border-surface-border">
              <h3 className="font-semibold text-white">Individualizado por Bet ({report.rows.length})</h3>
              <p className="text-xs text-muted mt-1">Cada linha é um lançamento de uma Bet em uma confederação num determinado mês.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface">
                  <tr>
                    <th className="table-th">Conf.</th>
                    <th className="table-th">Mês</th>
                    <th className="table-th">Razão Social</th>
                    <th className="table-th">CNPJ</th>
                    <th className="table-th">Situação</th>
                    <th className="table-th">Valor Devido</th>
                    <th className="table-th">Valor Recebido</th>
                    <th className="table-th">Relatório</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.length === 0 ? (
                    <tr><td colSpan={8} className="table-td text-center text-muted py-12">Nenhum lançamento para os filtros selecionados</td></tr>
                  ) : report.rows.map((r: any) => (
                    <tr key={r.payment_id} className="hover:bg-surface-light/20">
                      <td className="table-td">{r.confederation_acronym}</td>
                      <td className="table-td text-muted">{r.reference_month || "-"}</td>
                      <td className="table-td font-medium text-white">{r.company_name}</td>
                      <td className="table-td font-mono text-xs text-muted">{r.cnpj || "-"}</td>
                      <td className="table-td"><Badge status={r.status} /></td>
                      <td className="table-td">{formatCurrency(r.amount_due)}</td>
                      <td className="table-td text-success">{formatCurrency(r.amount_paid)}</td>
                      <td className="table-td">{r.report_received ? <span className="text-success text-xs">Recebido</span> : <span className="text-warning text-xs">Pendente</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ value, label, color = "text-white" }: { value: number; label: string; color?: string }) {
  return (
    <div className="card text-center">
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function AggTable({ title, labelKey, rows, header }: { title: string; labelKey: string; rows: any[]; header: string }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="p-4 border-b border-surface-border"><h3 className="font-semibold text-white">{title}</h3></div>
      <table className="w-full">
        <thead className="bg-surface">
          <tr>
            <th className="table-th">{header}</th>
            <th className="table-th">Bets</th>
            <th className="table-th">Recebido</th>
            <th className="table-th">Adimpl.</th>
            <th className="table-th">Inadimpl.</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="table-td text-center text-muted py-6">Sem dados</td></tr>
          ) : rows.map((g: any, i: number) => (
            <tr key={i}>
              <td className="table-td font-medium text-white">{g[labelKey] || "-"}</td>
              <td className="table-td text-muted">{g.count}</td>
              <td className="table-td text-success">{formatCurrency(g.amount_paid)}</td>
              <td className="table-td text-success">{g.adimplentes}</td>
              <td className="table-td text-danger">{g.inadimplentes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------- Por Ciclo ------------------------------- */
function PorCiclo({ confederations, cycles }: { confederations: any[]; cycles: any[] }) {
  const [selectedCycle, setSelectedCycle] = useState("");
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleGenerate() {
    if (!selectedCycle) return;
    setLoading(true);
    try {
      const r = await getComplianceReport(parseInt(selectedCycle));
      setReport(r.data);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao gerar relatório");
    } finally { setLoading(false); }
  }

  async function handleDownloadExcel() {
    if (!selectedCycle) return;
    setDownloading(true);
    try {
      const r = await downloadExcelReport(parseInt(selectedCycle));
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a");
      a.href = url; a.download = `relatorio_ciclo_${selectedCycle}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  }

  const getCycleName = (c: any) => {
    const conf = confederations.find(cf => cf.id === c.confederation_id);
    return `${conf?.acronym || "?"} - ${c.reference_month}`;
  };

  return (
    <>
      <div className="card mb-6">
        <h3 className="font-semibold text-white mb-4">Selecionar Ciclo</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="label">Ciclo de Cobrança</label>
            <select className="input" value={selectedCycle} onChange={e => { setSelectedCycle(e.target.value); setReport(null); }}>
              <option value="">Selecione um ciclo...</option>
              {cycles.map(c => <option key={c.id} value={c.id}>{getCycleName(c)} (#{c.id})</option>)}
            </select>
          </div>
          <button onClick={handleGenerate} disabled={!selectedCycle || loading} className="btn-primary">{loading ? "Gerando..." : "Gerar Relatório"}</button>
          <button onClick={handleDownloadExcel} disabled={!selectedCycle || downloading} className="btn-secondary">{downloading ? "Baixando..." : "Exportar Excel"}</button>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <Stat value={report.summary.total_operators} label="Total de Operadores" />
            <Stat value={report.summary.paid} label="Adimplentes" color="text-success" />
            <Stat value={report.summary.report_pending} label="Pend. de Relatório" color="text-warning" />
            <Stat value={report.summary.overdue} label="Inadimplentes" color="text-danger" />
            <div className="card text-center">
              <p className={`text-3xl font-bold ${report.summary.compliance_rate >= 70 ? "text-success" : "text-warning"}`}>{report.summary.compliance_rate}%</p>
              <p className="text-xs text-muted">Taxa de Adimplência</p>
            </div>
          </div>

          <div className="card mb-6">
            <p className="text-xs text-muted mb-1">Total Recebido (regime de caixa)</p>
            <p className="text-2xl font-bold text-success">{formatCurrency(report.summary.total_received_brl)}</p>
          </div>

          {report.non_compliant.length > 0 && (
            <CycleTable title={`Inadimplentes (${report.non_compliant.length})`} rows={report.non_compliant} />
          )}
          {report.report_pending_list?.length > 0 && (
            <div className="card p-0 overflow-hidden mb-4">
              <div className="p-4 border-b border-surface-border bg-warning/5">
                <h3 className="font-semibold text-warning">Pendentes de Relatório ({report.report_pending_list.length})</h3>
                <p className="text-xs text-muted mt-1">Pagaram, mas ainda não enviaram o relatório de individualização.</p>
              </div>
              <table className="w-full">
                <thead className="bg-surface"><tr>
                  <th className="table-th">Razão Social</th><th className="table-th">CNPJ</th>
                  <th className="table-th">Valor Recebido</th><th className="table-th">Data Recebimento</th>
                </tr></thead>
                <tbody>{report.report_pending_list.map((p: any) => (
                  <tr key={p.operator_id}>
                    <td className="table-td">{p.company_name}</td>
                    <td className="table-td font-mono text-xs">{p.cnpj || "-"}</td>
                    <td className="table-td text-warning">{formatCurrency(p.amount_paid)}</td>
                    <td className="table-td">{p.payment_date || "-"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {report.compliant.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="p-4 border-b border-surface-border bg-success/5">
                <h3 className="font-semibold text-success">Adimplentes ({report.compliant.length})</h3>
              </div>
              <table className="w-full">
                <thead className="bg-surface"><tr>
                  <th className="table-th">Razão Social</th><th className="table-th">Nome Fantasia</th>
                  <th className="table-th">Valor Pago</th><th className="table-th">Data Pagamento</th>
                </tr></thead>
                <tbody>{report.compliant.map((p: any) => (
                  <tr key={p.operator_id}>
                    <td className="table-td">{p.company_name}</td>
                    <td className="table-td">{p.fantasy_name || "-"}</td>
                    <td className="table-td text-success">{formatCurrency(p.amount_paid)}</td>
                    <td className="table-td">{p.payment_date || "-"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

function CycleTable({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="card p-0 overflow-hidden mb-4">
      <div className="p-4 border-b border-surface-border bg-danger/5"><h3 className="font-semibold text-danger">{title}</h3></div>
      <table className="w-full">
        <thead className="bg-surface"><tr>
          <th className="table-th">Razão Social</th><th className="table-th">Nome Fantasia</th>
          <th className="table-th">CNPJ</th><th className="table-th">Status</th><th className="table-th">Valor Devido</th>
        </tr></thead>
        <tbody>{rows.map((p: any) => (
          <tr key={p.operator_id}>
            <td className="table-td">{p.company_name}</td>
            <td className="table-td">{p.fantasy_name || "-"}</td>
            <td className="table-td font-mono text-xs">{p.cnpj || "-"}</td>
            <td className="table-td"><Badge status={p.status} /></td>
            <td className="table-td">{formatCurrency(p.amount_due)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* ------------------------- Evidências (ISO 9001) ------------------------- */
function Evidencias({ confederations }: { confederations: any[] }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [confId, setConfId] = useState("");
  const [downloading, setDownloading] = useState(false);

  async function download() {
    if (!month) { alert("Selecione o mês de competência."); return; }
    setDownloading(true);
    try {
      const params: any = { month: `${month}-01` };
      if (confId) params.confederation_id = Number(confId);
      const r = await downloadEvidencePdf(params);
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `evidencias_${month.replace("-", "_")}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.response?.data?.detail || "Erro ao gerar o relatório de evidências.");
    } finally { setDownloading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="card bg-blue-500/5 border border-blue-500/20">
        <h3 className="font-semibold text-white text-sm mb-1">Dossiê Mensal de Evidências</h3>
        <p className="text-xs text-muted">
          Gera um PDF consolidando todas as evidências do mês para fins de auditoria e rastreabilidade
          (ISO 9001 — 7.5 Informação documentada e 8.5 Provisão de serviço): notificações enviadas,
          respostas recebidas das Bets, valores declarados x recebidos, relatórios de GGR e repartições
          aos beneficiários. Ideal para apresentar à confederação como comprovação do trabalho realizado.
        </p>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="label">Mês de competência *</label>
            <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} />
            <p className="text-xs text-muted mt-1">Mês a que se referem os repasses (competência).</p>
          </div>
          <div>
            <label className="label">Confederação</label>
            <select className="input" value={confId} onChange={e => setConfId(e.target.value)}>
              <option value="">Todas as confederações</option>
              {confederations.map(c => <option key={c.id} value={c.id}>{c.acronym} — {c.name}</option>)}
            </select>
            <p className="text-xs text-muted mt-1">Deixe em branco para um dossiê completo.</p>
          </div>
          <button onClick={download} disabled={downloading} className="btn-primary">
            {downloading ? "Gerando dossiê..." : "⬇ Gerar Dossiê em PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
