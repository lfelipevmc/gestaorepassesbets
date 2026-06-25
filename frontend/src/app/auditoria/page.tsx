"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getAuditLogs } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    getAuditLogs({ action: actionFilter || undefined, entity_type: entityFilter || undefined, limit: 200 })
      .then(r => setLogs(r.data))
      .finally(() => setLoading(false));
  }, [actionFilter, entityFilter]);

  const actions = ["LOGIN", "CREATE", "UPDATE", "DELETE", "SEND_NOTIFICATION", "CONFIRM_PAYMENT", "DECLARE_GGR", "UPLOAD_DOCUMENT", "SCRAPE_MF", "AI_FIND_CONTACTS"];
  const entities = ["User", "Confederation", "BettingOperator", "CollectionCycle", "Payment", "Document"];

  return (
    <AppShell>
      <Header title="Auditoria" subtitle="Registro completo de ações no sistema" />

      <div className="flex gap-3 mb-6">
        <select className="input max-w-[220px]" value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
          <option value="">Todas as ações</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input max-w-[220px]" value={entityFilter} onChange={e => setEntityFilter(e.target.value)}>
          <option value="">Todas as entidades</option>
          {entities.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface">
            <tr>
              <th className="table-th">ID</th>
              <th className="table-th">Ação</th>
              <th className="table-th">Entidade</th>
              <th className="table-th">ID Entidade</th>
              <th className="table-th">Usuário</th>
              <th className="table-th">Descrição</th>
              <th className="table-th">Data/Hora</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="table-td text-center text-muted py-8">Carregando...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={7} className="table-td text-center text-muted py-8">Nenhum registro encontrado</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className="hover:bg-surface-light/20">
                <td className="table-td text-muted">{log.id}</td>
                <td className="table-td">
                  <code className="text-xs bg-surface px-2 py-0.5 rounded text-blue-300">{log.action}</code>
                </td>
                <td className="table-td text-muted">{log.entity_type || "-"}</td>
                <td className="table-td text-muted">{log.entity_id || "-"}</td>
                <td className="table-td text-muted">{log.user_id ? `#${log.user_id}` : "Sistema"}</td>
                <td className="table-td text-xs text-muted max-w-xs truncate">{log.description || "-"}</td>
                <td className="table-td text-muted whitespace-nowrap">{formatDateTime(log.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
