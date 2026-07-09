"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getOffice, updateOffice, uploadOfficeLogo } from "@/lib/api";
import { getUser } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function EscritorioPage() {
  const me = getUser();
  const [office, setOffice] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 3500); }

  function load() { getOffice().then(r => setOffice(r.data)).catch(() => {}); }
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      await updateOffice({
        name: office.name, legal_name: office.legal_name, cnpj: office.cnpj,
        email: office.email, phone: office.phone, website: office.website,
        address: office.address, city: office.city, signature_name: office.signature_name,
        notes: office.notes,
      });
      flash("Dados do escritório salvos.");
    } catch { flash("Erro ao salvar."); }
    finally { setSaving(false); }
  }

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await uploadOfficeLogo(fd);
      setOffice(r.data);
      flash("Logomarca atualizada.");
    } catch { flash("Erro ao enviar logomarca."); }
    finally { setUploading(false); }
  }

  if (me?.role !== "admin") {
    return <AppShell><div className="card text-center py-12 text-muted">Acesso restrito ao administrador.</div></AppShell>;
  }
  if (!office) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;

  const set = (k: string, v: any) => setOffice((s: any) => ({ ...s, [k]: v }));

  return (
    <AppShell>
      <Header title="Escritório" icon="🏛️"
        help="Dados do escritório usados nas assinaturas de e-mail, ofícios e relatórios (nome, OAB, endereço, e-mail de revisão). O e-mail cadastrado aqui recebe os dossiês mensais para revisão interna antes do envio às confederações. Também define as colunas padrão da tabela de operadores."
        subtitle="Dados cadastrais do escritório usados nas comunicações e relatórios"
        actions={<button onClick={save} disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Salvar"}</button>} />

      {msg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Logo */}
        <div className="card">
          <h3 className="font-semibold text-white mb-3 text-sm">Logomarca</h3>
          <div className="aspect-video bg-surface rounded-lg flex items-center justify-center overflow-hidden mb-3 border border-surface-border">
            {office.logo_url
              ? <img src={`${API_BASE}${office.logo_url}`} alt="Logomarca" className="max-h-full max-w-full object-contain" />
              : <span className="text-muted text-sm">Nenhuma logomarca</span>}
          </div>
          <label className="btn-secondary cursor-pointer inline-block">
            {uploading ? "Enviando..." : "Enviar logomarca"}
            <input type="file" accept="image/*" className="hidden" onChange={onLogo} />
          </label>
          <p className="text-xs text-muted mt-2">PNG ou JPG. Aparecerá nos relatórios e comunicações.</p>
        </div>

        {/* Dados */}
        <div className="card lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Nome do escritório *</label>
              <input className="input" placeholder="Ex.: Vascav Advocacia" value={office.name || ""} onChange={e => set("name", e.target.value)} />
            </div>
            <div>
              <label className="label">Razão social</label>
              <input className="input" placeholder="Ex.: Vascav Sociedade de Advogados" value={office.legal_name || ""} onChange={e => set("legal_name", e.target.value)} />
            </div>
            <div>
              <label className="label">CNPJ</label>
              <input className="input" placeholder="00.000.000/0000-00" value={office.cnpj || ""} onChange={e => set("cnpj", e.target.value)} />
            </div>
            <div>
              <label className="label">Cidade</label>
              <input className="input" placeholder="Ex.: Rio de Janeiro" value={office.city || ""} onChange={e => set("city", e.target.value)} />
            </div>
            <div>
              <label className="label">E-mail</label>
              <input className="input" type="email" placeholder="contato@vascav.com.br" value={office.email || ""} onChange={e => set("email", e.target.value)} />
            </div>
            <div>
              <label className="label">Telefone</label>
              <input className="input" placeholder="(11) 99999-9999" value={office.phone || ""} onChange={e => set("phone", e.target.value)} />
            </div>
            <div>
              <label className="label">Site</label>
              <input className="input" placeholder="www.vascav.com.br" value={office.website || ""} onChange={e => set("website", e.target.value)} />
            </div>
            <div>
              <label className="label">Assinatura das comunicações</label>
              <input className="input" placeholder="Nome que assina os e-mails de cobrança" value={office.signature_name || ""} onChange={e => set("signature_name", e.target.value)} />
              <p className="text-xs text-muted mt-1">Substitui a chave {"{escritorio}"} nos modelos de cobrança.</p>
            </div>
          </div>
          <div>
            <label className="label">Endereço</label>
            <input className="input" placeholder="Rua, número, bairro" value={office.address || ""} onChange={e => set("address", e.target.value)} />
          </div>
          <div>
            <label className="label">Observações</label>
            <textarea className="input" rows={2} value={office.notes || ""} onChange={e => set("notes", e.target.value)} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
