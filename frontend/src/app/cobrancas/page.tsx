"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import { getCollections, createCollection, getConfederations } from "@/lib/api";
import { formatDate } from "@/lib/utils";

export default function CobrancasPage() {
  const [cycles, setCycles] = useState<any[]>([]);
  const [confederations, setConfederations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ confederation_id: "", reference_month: "" });

  const fetchAll = () => {
    Promise.all([getCollections(), getConfederations()])
      .then(([c, confs]) => { setCycles(c.data); setConfederations(confs.data); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await createCollection({ confederation_id: parseInt(form.confederation_id), reference_month: form.reference_month + "-01" });
      setShowCreate(false);
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao criar ciclo");
    } finally {
      setCreating(false);
    }
  }

  // Group by confederation
  const byCconf: Record<string, any[]> = {};
  cycles.forEach(c => {
    const key = c.confederation_id.toString();
    if (!byCconf[key]) byCconf[key] = [];
    byCconf[key].push(c);
  });

  return (
    <AppShell>
      <Header
        title="Cobranças"
        subtitle="Ciclos mensais de cobrança por confederação"
        actions={<button onClick={() => setShowCreate(true)} className="btn-primary">+ Novo Ciclo</button>}
      />

      {loading ? <div className="text-muted">Carregando...</div> : (
        <div className="space-y-8">
          {Object.entries(byCconf).map(([confId, confCycles]) => {
            const conf = confederations.find(c => c.id.toString() === confId);
            return (
              <div key={confId}>
                <h2 className="font-semibold text-white mb-3">{conf?.name || `Confederação #${confId}`} <span className="text-muted text-sm">({conf?.acronym})</span></h2>
                <div className="card p-0 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-surface">
                      <tr>
                        <th className="table-th">ID</th>
                        <th className="table-th">Mês Referência</th>
                        <th className="table-th">Status</th>
                        <th className="table-th">Criado em</th>
                        <th className="table-th"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {confCycles.map(c => (
                        <tr key={c.id} className="hover:bg-surface-light/30">
                          <td className="table-td text-muted">#{c.id}</td>
                          <td className="table-td font-medium text-white">{formatDate(c.reference_month)}</td>
                          <td className="table-td"><Badge status={c.status} /></td>
                          <td className="table-td text-muted">{formatDate(c.created_at)}</td>
                          <td className="table-td">
                            <Link href={`/cobrancas/${c.id}`} className="text-primary text-xs hover:underline">Ver ciclo</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {cycles.length === 0 && <div className="card text-center py-12 text-muted">Nenhum ciclo de cobrança criado ainda</div>}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Novo Ciclo de Cobrança">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Confederação *</label>
            <select className="input" required value={form.confederation_id} onChange={e => setForm(f => ({ ...f, confederation_id: e.target.value }))}>
              <option value="">Selecione...</option>
              {confederations.map(c => <option key={c.id} value={c.id}>{c.name} ({c.acronym})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Mês de Referência *</label>
            <input type="month" className="input" required value={form.reference_month} onChange={e => setForm(f => ({ ...f, reference_month: e.target.value }))} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={creating} className="btn-primary">{creating ? "Criando..." : "Criar Ciclo"}</button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
