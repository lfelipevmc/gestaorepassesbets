"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Modal from "@/components/ui/Modal";
import { getUsers, createUser, updateUser, deleteUser, getConfederations } from "@/lib/api";
import { getUser } from "@/lib/auth";

const ROLES: Record<string, string> = {
  admin: "Administrador",
  office_staff: "Escritório",
  confederation_viewer: "Confederação (leitor)",
};

export default function UsuariosPage() {
  const me = getUser();
  const [users, setUsers] = useState<any[]>([]);
  const [confs, setConfs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () => {
    Promise.all([getUsers({ include_inactive: true }), getConfederations()])
      .then(([u, c]) => { setUsers(u.data); setConfs(c.data); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 3500); }

  function newUser() {
    setEditing({ name: "", email: "", phone: "", password: "", role: "office_staff", confederation_id: null, is_active: true, _isNew: true });
  }

  async function save() {
    if (!editing.name || !editing.email) { flash("Preencha nome e e-mail."); return; }
    if (editing._isNew && !editing.password) { flash("Defina uma senha para o novo usuário."); return; }
    if (editing.role === "confederation_viewer" && !editing.confederation_id) { flash("Selecione a confederação do usuário leitor."); return; }
    setSaving(true);
    try {
      const payload: any = {
        name: editing.name, phone: editing.phone || null, role: editing.role,
        confederation_id: editing.role === "confederation_viewer" ? editing.confederation_id : null,
      };
      if (editing._isNew) {
        await createUser({ ...payload, email: editing.email, password: editing.password });
      } else {
        if (editing.password) payload.password = editing.password;
        payload.is_active = editing.is_active;
        await updateUser(editing.id, payload);
      }
      setEditing(null); load(); flash("Usuário salvo.");
    } catch (err: any) {
      flash(err.response?.data?.detail || "Erro ao salvar usuário.");
    } finally { setSaving(false); }
  }

  async function remove(u: any) {
    if (!confirm(`Desativar o usuário ${u.name}? Ele perderá o acesso, mas o histórico é preservado.`)) return;
    try { await deleteUser(u.id); load(); flash("Usuário desativado."); }
    catch (err: any) { flash(err.response?.data?.detail || "Erro."); }
  }

  if (me?.role !== "admin") {
    return <AppShell><div className="card text-center py-12 text-muted">Acesso restrito ao administrador.</div></AppShell>;
  }

  return (
    <AppShell>
      <Header title="Usuários" subtitle="Gerencie acessos: administrador, escritório e leitores de confederação"
        actions={<button onClick={newUser} className="btn-primary">+ Novo Usuário</button>} />

      {msg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{msg}</div>}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-sm"><p className="font-semibold text-white mb-1">Administrador</p><p className="text-muted text-xs">Acesso total, inclusive gestão de usuários.</p></div>
        <div className="card text-sm"><p className="font-semibold text-white mb-1">Escritório</p><p className="text-muted text-xs">Acesso a todas as funções operacionais (sem gestão de usuários).</p></div>
        <div className="card text-sm"><p className="font-semibold text-white mb-1">Confederação (leitor)</p><p className="text-muted text-xs">Somente leitura, restrito aos dados da própria confederação.</p></div>
      </div>

      {loading ? <div className="text-muted">Carregando...</div> : (
        <div className="card p-0 overflow-hidden">
          <div className="table-wrap"><table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="table-th">Nome</th><th className="table-th">E-mail</th><th className="table-th">Telefone</th>
                <th className="table-th">Perfil</th><th className="table-th">Confederação</th><th className="table-th">Situação</th><th className="table-th">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="hover:bg-surface-light/20">
                  <td className="table-td text-white font-medium">{u.name}</td>
                  <td className="table-td text-muted">{u.email}</td>
                  <td className="table-td text-muted">{u.phone || "—"}</td>
                  <td className="table-td">{ROLES[u.role] || u.role}</td>
                  <td className="table-td text-muted">{confs.find(c => c.id === u.confederation_id)?.acronym || "—"}</td>
                  <td className="table-td">{u.is_active ? <span className="text-success text-xs">Ativo</span> : <span className="text-danger text-xs">Inativo</span>}</td>
                  <td className="table-td">
                    <div className="flex gap-2">
                      <button onClick={() => setEditing({ ...u, password: "" })} className="text-xs text-primary hover:underline">Editar</button>
                      {u.id !== me?.id && <button onClick={() => remove(u)} className="text-xs text-danger hover:underline">Desativar</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing?._isNew ? "Novo Usuário" : "Editar Usuário"}>
        {editing && (
          <div className="space-y-4">
            <div>
              <label className="label">Nome completo *</label>
              <input className="input" placeholder="Ex.: João da Silva" value={editing.name} onChange={e => setEditing((s: any) => ({ ...s, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">E-mail *</label>
              <input className="input" type="email" placeholder="Ex.: joao@escritorio.com.br" disabled={!editing._isNew}
                value={editing.email} onChange={e => setEditing((s: any) => ({ ...s, email: e.target.value }))} />
              {!editing._isNew && <p className="text-xs text-muted mt-1">O e-mail não pode ser alterado após a criação.</p>}
            </div>
            <div>
              <label className="label">Telefone</label>
              <input className="input" placeholder="Formato: (11) 99999-9999" value={editing.phone || ""} onChange={e => setEditing((s: any) => ({ ...s, phone: e.target.value }))} />
            </div>
            <div>
              <label className="label">{editing._isNew ? "Senha *" : "Nova senha (deixe em branco para manter)"}</label>
              <input className="input" type="password" placeholder="Mínimo de 6 caracteres" value={editing.password || ""} onChange={e => setEditing((s: any) => ({ ...s, password: e.target.value }))} />
            </div>
            <div>
              <label className="label">Perfil de acesso *</label>
              <select className="input" value={editing.role} onChange={e => setEditing((s: any) => ({ ...s, role: e.target.value }))}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {editing.role === "confederation_viewer" && (
              <div>
                <label className="label">Confederação vinculada *</label>
                <select className="input" value={editing.confederation_id ?? ""} onChange={e => setEditing((s: any) => ({ ...s, confederation_id: e.target.value ? Number(e.target.value) : null }))}>
                  <option value="">Selecione...</option>
                  {confs.map(c => <option key={c.id} value={c.id}>{c.acronym} — {c.name}</option>)}
                </select>
                <p className="text-xs text-muted mt-1">O leitor verá somente os dados desta confederação.</p>
              </div>
            )}
            {!editing._isNew && (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={editing.is_active} onChange={e => setEditing((s: any) => ({ ...s, is_active: e.target.checked }))} /> Usuário ativo
              </label>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setEditing(null)} className="btn-secondary">Cancelar</button>
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Salvar"}</button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
