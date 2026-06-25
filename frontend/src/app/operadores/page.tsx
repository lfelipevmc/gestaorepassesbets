"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import { getOperators, createOperator, syncFromMF } from "@/lib/api";
import { formatDate } from "@/lib/utils";

export default function OperadoresPage() {
  const [operators, setOperators] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({ company_name: "", fantasy_name: "", cnpj: "", website: "", status: "active", notes: "" });

  const fetchOperators = () => {
    setLoading(true);
    getOperators({ search: search || undefined, status: statusFilter || undefined, limit: 200 })
      .then(r => setOperators(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOperators(); }, [search, statusFilter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await createOperator(form);
      setShowCreate(false);
      setForm({ company_name: "", fantasy_name: "", cnpj: "", website: "", status: "active", notes: "" });
      fetchOperators();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao criar operador");
    } finally {
      setCreating(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await syncFromMF();
      alert("Sincronização iniciada em segundo plano");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <AppShell>
      <Header
        title="Agentes Operadores"
        subtitle={`${operators.length} operadores cadastrados`}
        actions={
          <>
            <button onClick={handleSync} disabled={syncing} className="btn-secondary">
              {syncing ? "Sincronizando..." : "Sincronizar MF"}
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              + Novo Operador
            </button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          className="input max-w-xs"
          placeholder="Buscar por nome ou CNPJ..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input max-w-[180px]" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="active">Ativo</option>
          <option value="suspended">Suspenso</option>
          <option value="cancelled">Cancelado</option>
          <option value="pending">Pendente</option>
        </select>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface">
            <tr>
              <th className="table-th">Razão Social</th>
              <th className="table-th">Nome Fantasia</th>
              <th className="table-th">CNPJ</th>
              <th className="table-th">Status</th>
              <th className="table-th">Contatos</th>
              <th className="table-th">Cadastrado</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="table-td text-center text-muted py-8">Carregando...</td></tr>
            ) : operators.length === 0 ? (
              <tr><td colSpan={7} className="table-td text-center text-muted py-8">Nenhum operador encontrado</td></tr>
            ) : operators.map(op => (
              <tr key={op.id} className="hover:bg-surface-light/30 transition-colors">
                <td className="table-td font-medium text-white">{op.company_name}</td>
                <td className="table-td">{op.fantasy_name || "-"}</td>
                <td className="table-td font-mono text-xs">{op.cnpj || "-"}</td>
                <td className="table-td"><Badge status={op.status} /></td>
                <td className="table-td">
                  <span className="text-xs bg-surface px-2 py-1 rounded-full">{op.contacts?.length || 0} contatos</span>
                </td>
                <td className="table-td text-muted">{formatDate(op.created_at)}</td>
                <td className="table-td">
                  <Link href={`/operadores/${op.id}`} className="text-primary text-xs hover:underline">
                    Ver detalhes
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Novo Agente Operador">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Razão Social *</label>
            <input className="input" required value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Nome Fantasia</label>
            <input className="input" value={form.fantasy_name} onChange={e => setForm(f => ({ ...f, fantasy_name: e.target.value }))} />
          </div>
          <div>
            <label className="label">CNPJ</label>
            <input className="input" placeholder="00.000.000/0000-00" value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} />
          </div>
          <div>
            <label className="label">Website</label>
            <input className="input" type="url" placeholder="https://..." value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Ativo</option>
              <option value="pending">Pendente</option>
              <option value="suspended">Suspenso</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <div>
            <label className="label">Observações</label>
            <textarea className="input h-20 resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={creating} className="btn-primary">{creating ? "Criando..." : "Criar Operador"}</button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
