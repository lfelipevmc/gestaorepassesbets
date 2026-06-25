"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getConfederations, getPayments } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export default function ConfederacoesPage() {
  const [confederations, setConfederations] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getConfederations(), getPayments({ limit: 1000 })])
      .then(([c, p]) => { setConfederations(c.data); setPayments(p.data); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <Header title="Confederações" subtitle="CBTM, CBT, CBW, CBH" />
      {loading ? <div className="text-muted">Carregando...</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {confederations.map(conf => {
            const confPays = payments.filter(p => p.confederation_id === conf.id);
            const paid = confPays.filter(p => p.status === "paid").length;
            const reportPending = confPays.filter(p => p.status === "report_pending").length;
            const overdue = confPays.filter(p => p.status === "overdue" || p.status === "pending").length;
            const adimplentes = paid + reportPending;
            const rate = confPays.length > 0 ? Math.round((adimplentes / confPays.length) * 100) : 0;
            const totalReceived = confPays.reduce((s, p) => s + parseFloat(p.amount_paid || 0), 0);

            return (
              <div key={conf.id} className="card">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="w-12 h-12 bg-primary/15 rounded-xl flex items-center justify-center mb-3">
                      <span className="text-primary font-bold text-sm">{conf.acronym}</span>
                    </div>
                    <h2 className="font-bold text-white">{conf.name}</h2>
                    <p className="text-muted text-sm">{conf.acronym}</p>
                  </div>
                  <div className={`text-2xl font-bold ${rate >= 70 ? "text-success" : rate >= 40 ? "text-warning" : "text-danger"}`}>
                    {rate}%
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 mb-4">
                  <div className="bg-success/10 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-success">{paid}</p>
                    <p className="text-xs text-muted">Adimpl.</p>
                  </div>
                  <div className="bg-warning/10 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-warning">{reportPending}</p>
                    <p className="text-xs text-muted">Pend. Rel.</p>
                  </div>
                  <div className="bg-danger/10 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-danger">{overdue}</p>
                    <p className="text-xs text-muted">Inadimpl.</p>
                  </div>
                  <div className="bg-surface rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-white">{confPays.length}</p>
                    <p className="text-xs text-muted">Total</p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm mb-4">
                  <span className="text-muted">Total Recebido:</span>
                  <span className="font-semibold text-success">{formatCurrency(totalReceived)}</span>
                </div>

                <Link href={`/confederacoes/${conf.id}`} className="btn-secondary block text-center">
                  Ver Detalhes
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
