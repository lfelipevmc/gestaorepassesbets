"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getAuditLogs, getAuditActions, downloadAuditPdf, getUsers, getConfederations, getOperators } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

const ENTITIES: Record<string, string> = {
  "": "Todas as entidades",
  Confederation: "Confederação",
  BettingOperator: "Agente Operador (Bet)",
  CollectionCycle: "Ciclo de Cobrança",
  Payment: "Pagamento",
  Redistribution: "Repartição",
  User: "Usuário",
  Document: "Documento",
};

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<string[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [confs, setConfs] = useState<any[]>([]);
  const [ops, setOps] = useState<any[]>([]);
  const [exporting, setExporting] = useState(false);

  const [f, setF] = useState({ action: "", entity_type: "", entity_id: "", user_id: "", date_from: "", date_to: "" });

  const params = () => ({
    action: f.action || undefined,
    entity_type: f.entity_type || undefined,
    entity_id: f.entity_id || undefined,
    user_id: f.user_id || undefined,
    date_from: f.date_from || undefined,
    date_to: f.date_to || undefined,
  });

  useEffect(() => {
    getAuditActions().then(r => setActions(r.data)).catch(() => {});
    getUsers().then(r => setUsers(r.data)).catch(() => {});
    getConfederations().then(r => setConfs(r.data)).catch(() => {});
    getOperators({ limit: 300 }).then(r => setOps(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getAuditLogs({ ...params(), limit: 300 }).then(r => setLogs(r.data)).finally(() => setLoading(false));
  }, [f]);

  async function exportPdf() {
    setExporting(true);
    try {
      const r = await downloadAuditPdf(params());
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = "auditoria.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("Erro ao exportar PDF"); }
    finally { setExporting(false); }
  }

  const userName = (id: number) => users.find(u => u.id === id)?.name || `#${id}`;

  // O seletor de entidade específica muda conforme o tipo escolhido
  const entityOptions = f.entity_type === "Confederation"
    ? confs.map(c => ({ id: c.id, label: `${c.acronym} — ${c.name}` }))
    : f.entity_type === "BettingOperator"
    ? ops.map(o => ({ id: o.id, label: o.fantasy_name || o.company_name }))
    : f.entity_type === "User"
    ? users.map(u => ({ id: u.id, label: u.name }))
    : [];

  return (
    <AppShell>
      <Header title="Auditoria" subtitle="Registro completo de ações — filtros combináveis e exportação em PDF"
        actions={<button onClick={exportPdf} disabled={exporting} className="btn-primary">{exporting ? "Gerando..." : "⬇ Exportar PDF"}</button>} />

      <div className="card mb-6">
        <p className="text-xs text-muted mb-3">Os filtros podem ser usados simultaneamente. Datas no formato dia/mês/ano.</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="label">Ação</label>
            <select className="input" value={f.action} onChange={e => setF(s => ({ ...s, action: e.target.value }))}>
              <option value="">Todas as ações</option>
              {actions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Tipo de entidade</label>
            <select className="input" value={f.entity_type} onChange={e => setF(s => ({ ...s, entity_type: e.target.value, entity_id: "" }))}>
              {Object.entries(ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{f.entity_type === "Confederation" ? "Confederação" : f.entity_type === "BettingOperator" ? "Bet" : f.entity_type === "User" ? "Usuário (entidade)" : "Registro específico"}</label>
            <select className="input" disabled={entityOptions.length === 0} value={f.entity_id} onChange={e => setF(s => ({ ...s, entity_id: e.target.value }))}>
              <option value="">Todos</option>
              {entityOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Usuário (autor da ação)</label>
            <select className="input" value={f.user_id} onChange={e => setF(s => ({ ...s, user_id: e.target.value }))}>
              <option value="">Todos os usuários</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Data inicial</label>
            <input type="date" className="input" value={f.date_from} onChange={e => setF(s => ({ ...s, date_from: e.target.value }))} />
          </div>
          <div>
            <label className="label">Data final</label>
            <input type="date" className="input" value={f.date_to} onChange={e => setF(s => ({ ...s, date_to: e.target.value }))} />
          </div>
        </div>
        <div className="mt-3">
          <button onClick={() => setF({ action: "", entity_type: "", entity_id: "", user_id: "", date_from: "", date_to: "" })} className="btn-secondary">Limpar filtros</button>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface">
            <tr>
              <th className="table-th">Data/Hora</th>
              <th className="table-th">Usuário</th>
              <th className="table-th">Ação</th>
              <th className="table-th">Entidade</th>
              <th className="table-th">ID</th>
              <th className="table-th">Descrição</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="table-td text-center text-muted py-8">Carregando...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6} className="table-td text-center text-muted py-8">Nenhum registro encontrado</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className="hover:bg-surface-light/20">
                <td className="table-td text-muted whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                <td className="table-td text-muted">{log.user_id ? userName(log.user_id) : "Sistema"}</td>
                <td className="table-td"><code className="text-xs bg-surface px-2 py-0.5 rounded text-blue-300">{log.action}</code></td>
                <td className="table-td text-muted">{ENTITIES[log.entity_type] || log.entity_type || "—"}</td>
                <td className="table-td text-muted">{log.entity_id || "—"}</td>
                <td className="table-td text-xs text-muted max-w-md truncate">{log.description || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
