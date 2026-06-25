"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import { getConfederation, getCollections, getPayments, getOperators } from "@/lib/api";
import { formatDate, formatCurrency } from "@/lib/utils";

export default function ConfederationDetailPage() {
  const { id } = useParams();
  const numId = Number(id);
  const [conf, setConf] = useState<any>(null);
  const [cycles, setCycles] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getConfederation(numId),
      getCollections({ confederation_id: numId }),
      getPayments({ confederation_id: numId, limit: 500 }),
      getOperators({ limit: 200 }),
    ]).then(([c, cols, pays, ops]) => {
      setConf(c.data);
      setCycles(cols.data);
      setPayments(pays.data);
      setOperators(ops.data);
    }).finally(() => setLoading(false));
  }, [numId]);

  if (loading) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;
  if (!conf) return <AppShell><div className="text-muted">Não encontrado</div></AppShell>;

  const paid = payments.filter(p => p.status === "paid").length;
  const total = payments.length;
  const rate = total > 0 ? Math.round((paid / total) * 100) : 0;
  const totalReceived = payments.reduce((s, p) => s + parseFloat(p.amount_paid || 0), 0);

  return (
    <AppShell>
      <Header title={conf.acronym} subtitle={conf.name} />

      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="card text-center">
          <p className={`text-3xl font-bold mb-1 ${rate >= 70 ? "text-success" : rate >= 40 ? "text-warning" : "text-danger"}`}>{rate}%</p>
          <p className="text-xs text-muted">Adimplência</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-success mb-1">{paid}</p>
          <p className="text-xs text-muted">Adimplentes</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-danger mb-1">{total - paid}</p>
          <p className="text-xs text-muted">Inadimplentes</p>
        </div>
        <div className="card text-center">
          <p className="text-xl font-bold text-success mb-1">{formatCurrency(totalReceived)}</p>
          <p className="text-xs text-muted">Total Recebido</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="card">
          <h3 className="font-semibold text-white mb-4">Dados da Confederação</h3>
          <div className="space-y-3">
            <div><p className="text-xs text-muted">Nome</p><p className="text-sm text-slate-200">{conf.name}</p></div>
            <div><p className="text-xs text-muted">Sigla</p><p className="text-sm text-slate-200">{conf.acronym}</p></div>
            <div><p className="text-xs text-muted">% do GGR</p><p className="text-sm text-slate-200">{conf.ggr_percentage ? `${(parseFloat(conf.ggr_percentage) * 100).toFixed(1)}%` : "-"}</p></div>
            <div><p className="text-xs text-muted">Email Contato</p><p className="text-sm text-slate-200">{conf.contact_email || "-"}</p></div>
            <div><p className="text-xs text-muted">Email Financeiro</p><p className="text-sm text-slate-200">{conf.finance_email || "-"}</p></div>
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-white mb-4">Ciclos de Cobrança ({cycles.length})</h3>
          {cycles.length === 0 ? (
            <p className="text-muted text-sm">Nenhum ciclo criado</p>
          ) : (
            <div className="space-y-2">
              {cycles.slice(0, 6).map(c => (
                <div key={c.id} className="flex items-center justify-between p-2 bg-surface rounded-lg">
                  <span className="text-sm text-slate-300">{formatDate(c.reference_month)}</span>
                  <Badge status={c.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Payments table */}
      <div className="card p-0 overflow-hidden">
        <div className="p-4 border-b border-surface-border">
          <h3 className="font-semibold text-white">Pagamentos dos Operadores</h3>
        </div>
        <table className="w-full">
          <thead className="bg-surface">
            <tr>
              <th className="table-th">Operador</th>
              <th className="table-th">Ciclo</th>
              <th className="table-th">GGR Declarado</th>
              <th className="table-th">Valor Calculado</th>
              <th className="table-th">Valor Pago</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody>
            {payments.slice(0, 50).map(p => {
              const op = operators.find(o => o.id === p.operator_id);
              return (
                <tr key={p.id}>
                  <td className="table-td">{op?.fantasy_name || op?.company_name || `#${p.operator_id}`}</td>
                  <td className="table-td text-muted">#{p.cycle_id}</td>
                  <td className="table-td">{formatCurrency(p.ggr_declared)}</td>
                  <td className="table-td">{formatCurrency(p.calculated_amount)}</td>
                  <td className="table-td">{formatCurrency(p.amount_paid)}</td>
                  <td className="table-td"><Badge status={p.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
