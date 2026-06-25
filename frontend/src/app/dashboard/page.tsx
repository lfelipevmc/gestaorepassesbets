"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import { getOperators, getCollections, getPayments, getConfederations } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

export default function DashboardPage() {
  const [operators, setOperators] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [confederations, setConfederations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getOperators({ limit: 200 }),
      getCollections(),
      getPayments({ limit: 500 }),
      getConfederations(),
    ]).then(([ops, cols, pays, confs]) => {
      setOperators(ops.data);
      setCollections(cols.data);
      setPayments(pays.data);
      setConfederations(confs.data);
    }).finally(() => setLoading(false));
  }, []);

  const activeOps = operators.filter(o => o.status === "active").length;
  const paidPayments = payments.filter(p => p.status === "paid").length;
  const totalPayments = payments.length;
  const complianceRate = totalPayments > 0 ? Math.round((paidPayments / totalPayments) * 100) : 0;
  const totalReceived = payments.reduce((s, p) => s + (parseFloat(p.amount_paid || 0)), 0);

  const pieData = [
    { name: "Adimplentes", value: paidPayments, color: "#22c55e" },
    { name: "Inadimplentes", value: payments.filter(p => p.status === "overdue").length, color: "#ef4444" },
    { name: "Parciais", value: payments.filter(p => p.status === "partial").length, color: "#f59e0b" },
    { name: "Pendentes", value: payments.filter(p => p.status === "pending").length, color: "#94a3b8" },
  ].filter(d => d.value > 0);

  const recentCollections = collections.slice(0, 8);

  return (
    <AppShell>
      <Header
        title="Dashboard"
        subtitle="Visão geral do sistema de gestão de repasses"
      />

      {loading ? (
        <div className="text-muted text-sm">Carregando dados...</div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="Agentes Operadores Ativos" value={activeOps.toString()} icon="building" color="blue" />
            <StatCard label="Taxa de Adimplência" value={`${complianceRate}%`} icon="check" color={complianceRate >= 70 ? "green" : "red"} />
            <StatCard label="Total Recebido" value={formatCurrency(totalReceived)} icon="money" color="green" />
            <StatCard label="Confederações" value={confederations.length.toString()} icon="flag" color="purple" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Compliance chart */}
            <div className="card">
              <h2 className="font-semibold text-white mb-4">Status de Pagamentos</h2>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => [v, "Pagamentos"]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted text-sm">
                  Nenhum pagamento registrado
                </div>
              )}
            </div>

            {/* Confederations */}
            <div className="card">
              <h2 className="font-semibold text-white mb-4">Confederações</h2>
              <div className="space-y-3">
                {confederations.map(conf => {
                  const confPayments = payments.filter(p => p.confederation_id === conf.id);
                  const confPaid = confPayments.filter(p => p.status === "paid").length;
                  const rate = confPayments.length > 0 ? Math.round((confPaid / confPayments.length) * 100) : 0;
                  return (
                    <div key={conf.id} className="flex items-center justify-between p-3 bg-surface rounded-lg">
                      <div>
                        <p className="font-medium text-white text-sm">{conf.acronym}</p>
                        <p className="text-muted text-xs">{confPaid}/{confPayments.length} adimplentes</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold ${rate >= 70 ? "text-success" : rate >= 40 ? "text-warning" : "text-danger"}`}>{rate}%</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Recent collections */}
          <div className="card">
            <h2 className="font-semibold text-white mb-4">Ciclos de Cobrança Recentes</h2>
            {recentCollections.length === 0 ? (
              <p className="text-muted text-sm">Nenhum ciclo criado ainda.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-th">ID</th>
                    <th className="table-th">Confederação</th>
                    <th className="table-th">Mês Referência</th>
                    <th className="table-th">Status</th>
                    <th className="table-th">Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCollections.map(c => (
                    <tr key={c.id}>
                      <td className="table-td text-muted">#{c.id}</td>
                      <td className="table-td">
                        {confederations.find(cf => cf.id === c.confederation_id)?.acronym || c.confederation_id}
                      </td>
                      <td className="table-td">{formatDate(c.reference_month)}</td>
                      <td className="table-td"><Badge status={c.status} /></td>
                      <td className="table-td text-muted">{formatDate(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  const colors: Record<string, string> = {
    blue: "text-blue-400 bg-blue-400/10",
    green: "text-success bg-success/10",
    red: "text-danger bg-danger/10",
    purple: "text-purple-400 bg-purple-400/10",
  };

  const icons: Record<string, string> = {
    building: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    check: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    money: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    flag: "M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9",
  };

  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icons[icon]} />
          </svg>
        </div>
        <div>
          <p className="text-2xl font-bold text-white">{value}</p>
          <p className="text-xs text-muted">{label}</p>
        </div>
      </div>
    </div>
  );
}
