"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import { getConfederations, getCollections, getComplianceReport, downloadExcelReport } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export default function RelatoriosPage() {
  const [confederations, setConfederations] = useState<any[]>([]);
  const [cycles, setCycles] = useState<any[]>([]);
  const [selectedCycle, setSelectedCycle] = useState("");
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    Promise.all([getConfederations(), getCollections()])
      .then(([c, cy]) => { setConfederations(c.data); setCycles(cy.data); });
  }, []);

  async function handleGenerate() {
    if (!selectedCycle) return;
    setLoading(true);
    try {
      const r = await getComplianceReport(parseInt(selectedCycle));
      setReport(r.data);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao gerar relatório");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadExcel() {
    if (!selectedCycle) return;
    setDownloading(true);
    try {
      const r = await downloadExcelReport(parseInt(selectedCycle));
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio_ciclo_${selectedCycle}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const getCycleName = (c: any) => {
    const conf = confederations.find(cf => cf.id === c.confederation_id);
    return `${conf?.acronym || "?"} - ${c.reference_month}`;
  };

  return (
    <AppShell>
      <Header title="Relatórios" subtitle="Adimplência e conformidade por ciclo de cobrança" />

      <div className="card mb-6">
        <h3 className="font-semibold text-white mb-4">Selecionar Ciclo</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="label">Ciclo de Cobrança</label>
            <select className="input" value={selectedCycle} onChange={e => { setSelectedCycle(e.target.value); setReport(null); }}>
              <option value="">Selecione um ciclo...</option>
              {cycles.map(c => (
                <option key={c.id} value={c.id}>{getCycleName(c)} (#{c.id})</option>
              ))}
            </select>
          </div>
          <button onClick={handleGenerate} disabled={!selectedCycle || loading} className="btn-primary">
            {loading ? "Gerando..." : "Gerar Relatório"}
          </button>
          <button onClick={handleDownloadExcel} disabled={!selectedCycle || downloading} className="btn-secondary">
            {downloading ? "Baixando..." : "Exportar Excel"}
          </button>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <div className="card text-center">
              <p className="text-3xl font-bold text-white">{report.summary.total_operators}</p>
              <p className="text-xs text-muted">Total de Operadores</p>
            </div>
            <div className="card text-center">
              <p className="text-3xl font-bold text-success">{report.summary.paid}</p>
              <p className="text-xs text-muted">Adimplentes</p>
            </div>
            <div className="card text-center">
              <p className="text-3xl font-bold text-warning">{report.summary.report_pending}</p>
              <p className="text-xs text-muted">Pend. de Relatório</p>
            </div>
            <div className="card text-center">
              <p className="text-3xl font-bold text-danger">{report.summary.overdue}</p>
              <p className="text-xs text-muted">Inadimplentes</p>
            </div>
            <div className="card text-center">
              <p className={`text-3xl font-bold ${report.summary.compliance_rate >= 70 ? "text-success" : "text-warning"}`}>
                {report.summary.compliance_rate}%
              </p>
              <p className="text-xs text-muted">Taxa de Adimplência</p>
            </div>
          </div>

          <div className="card mb-6">
            <p className="text-xs text-muted mb-1">Total Recebido (regime de caixa)</p>
            <p className="text-2xl font-bold text-success">{formatCurrency(report.summary.total_received_brl)}</p>
          </div>

          {/* Non-compliant */}
          {report.non_compliant.length > 0 && (
            <div className="card p-0 overflow-hidden mb-4">
              <div className="p-4 border-b border-surface-border bg-danger/5">
                <h3 className="font-semibold text-danger">Inadimplentes ({report.non_compliant.length})</h3>
              </div>
              <table className="w-full">
                <thead className="bg-surface">
                  <tr>
                    <th className="table-th">Razão Social</th>
                    <th className="table-th">Nome Fantasia</th>
                    <th className="table-th">CNPJ</th>
                    <th className="table-th">Status</th>
                    <th className="table-th">Valor Devido</th>
                  </tr>
                </thead>
                <tbody>
                  {report.non_compliant.map((p: any) => (
                    <tr key={p.operator_id}>
                      <td className="table-td">{p.company_name}</td>
                      <td className="table-td">{p.fantasy_name || "-"}</td>
                      <td className="table-td font-mono text-xs">{p.cnpj || "-"}</td>
                      <td className="table-td"><Badge status={p.status} /></td>
                      <td className="table-td">{formatCurrency(p.amount_due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pendentes de Relatório */}
          {report.report_pending_list?.length > 0 && (
            <div className="card p-0 overflow-hidden mb-4">
              <div className="p-4 border-b border-surface-border bg-warning/5">
                <h3 className="font-semibold text-warning">Pendentes de Relatório ({report.report_pending_list.length})</h3>
                <p className="text-xs text-muted mt-1">Pagaram, mas ainda não enviaram o relatório de individualização.</p>
              </div>
              <table className="w-full">
                <thead className="bg-surface">
                  <tr>
                    <th className="table-th">Razão Social</th>
                    <th className="table-th">CNPJ</th>
                    <th className="table-th">Valor Recebido</th>
                    <th className="table-th">Data Recebimento</th>
                  </tr>
                </thead>
                <tbody>
                  {report.report_pending_list.map((p: any) => (
                    <tr key={p.operator_id}>
                      <td className="table-td">{p.company_name}</td>
                      <td className="table-td font-mono text-xs">{p.cnpj || "-"}</td>
                      <td className="table-td text-warning">{formatCurrency(p.amount_paid)}</td>
                      <td className="table-td">{p.payment_date || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Compliant */}
          {report.compliant.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="p-4 border-b border-surface-border bg-success/5">
                <h3 className="font-semibold text-success">Adimplentes ({report.compliant.length})</h3>
              </div>
              <table className="w-full">
                <thead className="bg-surface">
                  <tr>
                    <th className="table-th">Razão Social</th>
                    <th className="table-th">Nome Fantasia</th>
                    <th className="table-th">Valor Pago</th>
                    <th className="table-th">Data Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {report.compliant.map((p: any) => (
                    <tr key={p.operator_id}>
                      <td className="table-td">{p.company_name}</td>
                      <td className="table-td">{p.fantasy_name || "-"}</td>
                      <td className="table-td text-success">{formatCurrency(p.amount_paid)}</td>
                      <td className="table-td">{p.payment_date || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
