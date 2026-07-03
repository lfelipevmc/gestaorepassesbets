"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Modal from "@/components/ui/Modal";
import { getUsers, createUser } from "@/lib/api";
import { formatDate } from "@/lib/utils";

export default function UsuariosPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "membro" });
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };
  const load = () => { getUsers().then(r => setUsers(r.data)).catch(() => flash("Sem permissão para listar usuários.")).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createUser(form);
      setShow(false); setForm({ name: "", email: "", password: "", role: "membro" });
      flash("Usuário criado."); load();
    } catch (e: any) { flash(e.response?.data?.detail || "Erro ao criar usuário."); }
    finally { setSaving(false); }
  }

  return (
    <AppShell>
      <Header title="Usuários" subtitle="Equipe com acesso ao TCU Leads"
        actions={<button onClick={() => setShow(true)} className="btn-primary">+ Novo usuário</button>} />
      {msg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{msg}</div>}

      {loading ? <div className="text-muted">Carregando...</div> : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead className="bg-surface"><tr>
              <th className="table-th">Nome</th><th className="table-th">E-mail</th>
              <th className="table-th">Papel</th><th className="table-th">Ativo</th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td className="table-td text-slate-200 font-medium">{u.name}</td>
                  <td className="table-td">{u.email}</td>
                  <td className="table-td capitalize">{u.role}</td>
                  <td className="table-td">{u.is_active ? "Sim" : "Não"}</td>
                </tr>
              ))}
              {users.length === 0 && <tr><td className="table-td text-muted" colSpan={4}>Nenhum usuário.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={show} onClose={() => setShow(false)} title="Novo usuário">
        <form onSubmit={submit} className="space-y-4">
          <div><label className="label">Nome</label><input className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">E-mail</label><input type="email" className="input" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label">Senha</label><input type="password" className="input" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
          <div>
            <label className="label">Papel</label>
            <select className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option value="membro">Membro</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => setShow(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Criando..." : "Criar"}</button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
