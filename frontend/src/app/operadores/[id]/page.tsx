"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import {
  getOperator, updateOperator,
  addContact, deleteContact, findContactsAI,
  getPayments, getDocuments, getAuditLogs,
  addBrand, updateBrand, deleteBrand,
  addEndrAssociation, deleteEndrAssociation,
  researchContacts, getContactSuggestions, approveSuggestion, rejectSuggestion,
} from "@/lib/api";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";

const TABS = ["Dados Cadastrais", "Marcas Vinculadas", "ENDR", "Contatos", "Pesquisa de Contatos", "Histórico de Pagamentos", "Documentos", "Auditoria"];

const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function toDateInput(val: string | null | undefined) {
  if (!val) return "";
  return val.split("T")[0];
}

function formatDateBR(val: string | null | undefined) {
  if (!val) return "-";
  const d = new Date(val);
  return d.toLocaleDateString("pt-BR");
}

function formatMonthBR(val: string | null | undefined) {
  if (!val) return "-";
  const [year, month] = val.split("-");
  return `${MONTHS_PT[parseInt(month) - 1]}/${year}`;
}

export default function OperatorDetailPage() {
  const { id } = useParams();
  const numId = Number(id);

  const [operator, setOperator] = useState<any>(null);
  const [tab, setTab] = useState(0);
  const [payments, setPayments] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Contacts
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState({ type: "email", value: "", label: "", source: "", is_primary: false });
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [addingContact, setAddingContact] = useState(false);

  // Edit operator
  const [editForm, setEditForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  // Brands
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [editingBrand, setEditingBrand] = useState<any>(null);
  const [brandForm, setBrandForm] = useState({ name: "", website: "", instagram: "", twitter: "", facebook: "", other_social: "" });
  const [savingBrand, setSavingBrand] = useState(false);

  // ENDR
  const [showEndrModal, setShowEndrModal] = useState(false);
  const [endrForm, setEndrForm] = useState({ month: String(new Date().getMonth() + 1).padStart(2, "0"), year: String(new Date().getFullYear()), is_associated: true, notes: "" });
  const [savingEndr, setSavingEndr] = useState(false);

  // Contact Research
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestionsFilter, setSuggestionsFilter] = useState<string>("pending");
  const [researching, setResearching] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      getOperator(numId),
      getPayments({ operator_id: numId }),
      getDocuments({ operator_id: numId }),
      getAuditLogs({ entity_type: "BettingOperator" }),
    ]).then(([op, pays, docs, auditData]) => {
      setOperator(op.data);
      initEditForm(op.data);
      setPayments(pays.data);
      setDocuments(docs.data);
      setAudit(auditData.data.filter((a: any) => a.entity_id === numId));
    }).finally(() => setLoading(false));
  };

  function initEditForm(op: any) {
    setEditForm({
      company_name: op.company_name || "",
      fantasy_name: op.fantasy_name || "",
      cnpj: op.cnpj || "",
      website: op.website || "",
      status: op.status || "active",
      notes: op.notes || "",
      address_street: op.address_street || "",
      address_number: op.address_number || "",
      address_complement: op.address_complement || "",
      address_neighborhood: op.address_neighborhood || "",
      address_city: op.address_city || "",
      address_state: op.address_state || "",
      address_zip: op.address_zip || "",
      authorization_number: op.authorization_number || "",
      authorization_date: toDateInput(op.authorization_date),
    });
  }

  useEffect(() => { fetchData(); }, [numId]);

  useEffect(() => {
    if (tab === 4) fetchSuggestions();
  }, [tab]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: any = { ...editForm };
      if (!payload.authorization_date) delete payload.authorization_date;
      await updateOperator(numId, payload);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    setAddingContact(true);
    try {
      await addContact(numId, contactForm);
      setShowAddContact(false);
      setContactForm({ type: "email", value: "", label: "", source: "", is_primary: false });
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao adicionar contato");
    } finally {
      setAddingContact(false);
    }
  }

  async function handleDeleteContact(contactId: number) {
    if (!confirm("Remover este contato?")) return;
    await deleteContact(numId, contactId);
    fetchData();
  }

  async function handleFindContacts() {
    setAiLoading(true);
    try {
      const r = await findContactsAI(numId);
      setAiResult(r.data);
    } finally {
      setAiLoading(false);
    }
  }

  function openNewBrand() {
    setEditingBrand(null);
    setBrandForm({ name: "", website: "", instagram: "", twitter: "", facebook: "", other_social: "" });
    setShowBrandModal(true);
  }

  function openEditBrand(brand: any) {
    setEditingBrand(brand);
    setBrandForm({
      name: brand.name || "",
      website: brand.website || "",
      instagram: brand.instagram || "",
      twitter: brand.twitter || "",
      facebook: brand.facebook || "",
      other_social: brand.other_social || "",
    });
    setShowBrandModal(true);
  }

  async function handleSaveBrand(e: React.FormEvent) {
    e.preventDefault();
    setSavingBrand(true);
    try {
      if (editingBrand) {
        await updateBrand(numId, editingBrand.id, brandForm);
      } else {
        await addBrand(numId, brandForm);
      }
      setShowBrandModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao salvar marca");
    } finally {
      setSavingBrand(false);
    }
  }

  async function handleDeleteBrand(brandId: number) {
    if (!confirm("Remover esta marca?")) return;
    await deleteBrand(numId, brandId);
    fetchData();
  }

  async function handleAddEndr(e: React.FormEvent) {
    e.preventDefault();
    setSavingEndr(true);
    try {
      const reference_month = `${endrForm.year}-${endrForm.month}-01`;
      await addEndrAssociation(numId, {
        reference_month,
        is_associated: endrForm.is_associated,
        notes: endrForm.notes || undefined,
      });
      setShowEndrModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao salvar associação ENDR");
    } finally {
      setSavingEndr(false);
    }
  }

  async function handleDeleteEndr(assocId: number) {
    if (!confirm("Remover esta associação ENDR?")) return;
    await deleteEndrAssociation(numId, assocId);
    fetchData();
  }

  async function fetchSuggestions(filter?: string) {
    setSuggestionsLoading(true);
    try {
      const f = filter !== undefined ? filter : suggestionsFilter;
      const r = await getContactSuggestions(numId, f || undefined);
      setSuggestions(r.data);
    } finally {
      setSuggestionsLoading(false);
    }
  }

  async function handleResearchContacts() {
    setResearching(true);
    try {
      await researchContacts(numId);
      alert("Pesquisa iniciada! Os resultados aparecerão em instantes. Clique em 'Pendentes' para atualizar.");
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao iniciar pesquisa");
    } finally {
      setResearching(false);
    }
  }

  async function handleApproveSuggestion(suggestionId: number) {
    await approveSuggestion(numId, suggestionId);
    fetchSuggestions();
  }

  async function handleRejectSuggestion(suggestionId: number) {
    await rejectSuggestion(numId, suggestionId);
    fetchSuggestions();
  }

  if (loading) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;
  if (!operator) return <AppShell><div className="text-muted">Operador não encontrado</div></AppShell>;

  const brands = operator.brands || [];
  const endrAssocs = (operator.endr_associations || []).slice().sort((a: any, b: any) => b.reference_month.localeCompare(a.reference_month));

  return (
    <AppShell>
      <Header
        title={operator.fantasy_name || operator.company_name}
        subtitle={operator.company_name}
        actions={<Badge status={operator.status} />}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-surface-border overflow-x-auto">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              tab === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab 0: Dados Cadastrais */}
      {tab === 0 && editForm && (
        <form onSubmit={handleSave} className="space-y-6 max-w-3xl">
          {/* Identificação */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-white">Identificação</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Razão Social *</label>
                <input className="input" required value={editForm.company_name} onChange={e => setEditForm((f: any) => ({ ...f, company_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Nome Fantasia</label>
                <input className="input" value={editForm.fantasy_name} onChange={e => setEditForm((f: any) => ({ ...f, fantasy_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">CNPJ</label>
                <input className="input font-mono" placeholder="00.000.000/0000-00" value={editForm.cnpj} onChange={e => setEditForm((f: any) => ({ ...f, cnpj: e.target.value }))} />
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={editForm.status} onChange={e => setEditForm((f: any) => ({ ...f, status: e.target.value }))}>
                  <option value="active">Ativo</option>
                  <option value="pending">Pendente</option>
                  <option value="suspended">Suspenso</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
              <div>
                <label className="label">Última atualização</label>
                <input className="input opacity-60 cursor-not-allowed" readOnly value={formatDateTime(operator.updated_at)} />
              </div>
            </div>
          </div>

          {/* Autorização MF */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-white">Autorização MF</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Número da Autorização/Portaria</label>
                <input className="input" placeholder="Ex: Portaria SPA 2024/..." value={editForm.authorization_number} onChange={e => setEditForm((f: any) => ({ ...f, authorization_number: e.target.value }))} />
              </div>
              <div>
                <label className="label">Data da Autorização</label>
                <input className="input" type="date" value={editForm.authorization_date} onChange={e => setEditForm((f: any) => ({ ...f, authorization_date: e.target.value }))} />
                {!editForm.authorization_date && (
                  <p className="text-xs text-warning mt-1">Atenção: sem data de autorização, a cobrança não pode ser iniciada.</p>
                )}
              </div>
            </div>
          </div>

          {/* Endereço */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-white">Endereço (CNPJ)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">CEP</label>
                <input className="input" placeholder="00000-000" value={editForm.address_zip} onChange={e => setEditForm((f: any) => ({ ...f, address_zip: e.target.value }))} />
              </div>
              <div>
                <label className="label">Estado (UF)</label>
                <input className="input" maxLength={2} placeholder="SP" value={editForm.address_state} onChange={e => setEditForm((f: any) => ({ ...f, address_state: e.target.value.toUpperCase() }))} />
              </div>
              <div className="col-span-2">
                <label className="label">Logradouro</label>
                <input className="input" value={editForm.address_street} onChange={e => setEditForm((f: any) => ({ ...f, address_street: e.target.value }))} />
              </div>
              <div>
                <label className="label">Número</label>
                <input className="input" value={editForm.address_number} onChange={e => setEditForm((f: any) => ({ ...f, address_number: e.target.value }))} />
              </div>
              <div>
                <label className="label">Complemento</label>
                <input className="input" value={editForm.address_complement} onChange={e => setEditForm((f: any) => ({ ...f, address_complement: e.target.value }))} />
              </div>
              <div>
                <label className="label">Bairro</label>
                <input className="input" value={editForm.address_neighborhood} onChange={e => setEditForm((f: any) => ({ ...f, address_neighborhood: e.target.value }))} />
              </div>
              <div>
                <label className="label">Cidade</label>
                <input className="input" value={editForm.address_city} onChange={e => setEditForm((f: any) => ({ ...f, address_city: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* Website */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-white">Website</h3>
            <div>
              <label className="label">Site oficial</label>
              <input className="input" type="url" placeholder="https://..." value={editForm.website} onChange={e => setEditForm((f: any) => ({ ...f, website: e.target.value }))} />
            </div>
          </div>

          {/* Observações */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-white">Observações</h3>
            <textarea className="input h-28 resize-none" value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))} />
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Salvando..." : "Salvar Alterações"}
            </button>
          </div>
        </form>
      )}

      {/* Tab 1: Marcas Vinculadas */}
      {tab === 1 && (
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted">Até 3 marcas por agente operador. {brands.length}/3 cadastradas.</p>
            <button
              onClick={openNewBrand}
              disabled={brands.length >= 3}
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Adicionar Marca
            </button>
          </div>

          {brands.length === 0 ? (
            <div className="card text-center py-8 text-muted text-sm">Nenhuma marca cadastrada</div>
          ) : (
            <div className="space-y-4">
              {brands.map((brand: any) => (
                <div key={brand.id} className="card space-y-3">
                  <div className="flex items-start justify-between">
                    <h4 className="font-semibold text-white">{brand.name}</h4>
                    <div className="flex gap-2">
                      <button onClick={() => openEditBrand(brand)} className="text-primary text-xs hover:underline">Editar</button>
                      <button onClick={() => handleDeleteBrand(brand.id)} className="text-danger text-xs hover:underline">Remover</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {brand.website && <div><span className="text-muted">Site: </span><a href={brand.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{brand.website}</a></div>}
                    {brand.instagram && <div><span className="text-muted">Instagram: </span><span className="text-slate-300">{brand.instagram}</span></div>}
                    {brand.twitter && <div><span className="text-muted">Twitter/X: </span><span className="text-slate-300">{brand.twitter}</span></div>}
                    {brand.facebook && <div><span className="text-muted">Facebook: </span><span className="text-slate-300">{brand.facebook}</span></div>}
                    {brand.other_social && <div><span className="text-muted">Outros: </span><span className="text-slate-300">{brand.other_social}</span></div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Modal isOpen={showBrandModal} onClose={() => setShowBrandModal(false)} title={editingBrand ? "Editar Marca" : "Nova Marca Vinculada"}>
            <form onSubmit={handleSaveBrand} className="space-y-4">
              <div>
                <label className="label">Nome da Marca *</label>
                <input className="input" required value={brandForm.name} onChange={e => setBrandForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Site</label>
                <input className="input" type="url" placeholder="https://..." value={brandForm.website} onChange={e => setBrandForm(f => ({ ...f, website: e.target.value }))} />
              </div>
              <div>
                <label className="label">Instagram</label>
                <input className="input" placeholder="@usuario" value={brandForm.instagram} onChange={e => setBrandForm(f => ({ ...f, instagram: e.target.value }))} />
              </div>
              <div>
                <label className="label">Twitter/X</label>
                <input className="input" placeholder="@usuario" value={brandForm.twitter} onChange={e => setBrandForm(f => ({ ...f, twitter: e.target.value }))} />
              </div>
              <div>
                <label className="label">Facebook</label>
                <input className="input" placeholder="@pagina" value={brandForm.facebook} onChange={e => setBrandForm(f => ({ ...f, facebook: e.target.value }))} />
              </div>
              <div>
                <label className="label">Outras Redes</label>
                <input className="input" placeholder="Ex: TikTok @usuario" value={brandForm.other_social} onChange={e => setBrandForm(f => ({ ...f, other_social: e.target.value }))} />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowBrandModal(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={savingBrand} className="btn-primary">{savingBrand ? "Salvando..." : "Salvar"}</button>
              </div>
            </form>
          </Modal>
        </div>
      )}

      {/* Tab 2: ENDR */}
      {tab === 2 && (
        <div className="max-w-3xl">
          <div className="mb-4 p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg text-sm text-slate-300">
            <p className="font-medium text-white mb-1">Sobre o ENDR</p>
            <p>Se o agente operador estiver associado ao ENDR (Escritório Nacional de Rateios) em determinado mês, não será cobrado naquele mês. As notificações automáticas serão suspensas para os meses marcados como associado.</p>
          </div>

          <div className="flex justify-end mb-4">
            <button onClick={() => setShowEndrModal(true)} className="btn-primary">+ Registrar Associação</button>
          </div>

          {endrAssocs.length === 0 ? (
            <div className="card text-center py-8 text-muted text-sm">Nenhuma associação ENDR registrada</div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full">
                <thead className="bg-surface">
                  <tr>
                    <th className="table-th">Mês/Ano</th>
                    <th className="table-th">Status</th>
                    <th className="table-th">Observações</th>
                    <th className="table-th">Registrado em</th>
                    <th className="table-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {endrAssocs.map((assoc: any) => (
                    <tr key={assoc.id}>
                      <td className="table-td font-medium text-white">{formatMonthBR(assoc.reference_month)}</td>
                      <td className="table-td">
                        {assoc.is_associated ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400 border border-green-700/40">Associado ENDR</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-muted border border-surface-border">Não associado</span>
                        )}
                      </td>
                      <td className="table-td text-muted">{assoc.notes || "-"}</td>
                      <td className="table-td text-muted">{formatDate(assoc.created_at)}</td>
                      <td className="table-td">
                        <button onClick={() => handleDeleteEndr(assoc.id)} className="text-danger text-xs hover:underline">Remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Modal isOpen={showEndrModal} onClose={() => setShowEndrModal(false)} title="Registrar Associação ENDR">
            <form onSubmit={handleAddEndr} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Mês *</label>
                  <select className="input" value={endrForm.month} onChange={e => setEndrForm(f => ({ ...f, month: e.target.value }))}>
                    {MONTHS_PT.map((m, i) => (
                      <option key={i} value={String(i + 1).padStart(2, "0")}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Ano *</label>
                  <select className="input" value={endrForm.year} onChange={e => setEndrForm(f => ({ ...f, year: e.target.value }))}>
                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                      <option key={y} value={String(y)}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Status</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={endrForm.is_associated} onChange={() => setEndrForm(f => ({ ...f, is_associated: true }))} />
                    <span className="text-sm text-slate-300">Associado</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={!endrForm.is_associated} onChange={() => setEndrForm(f => ({ ...f, is_associated: false }))} />
                    <span className="text-sm text-slate-300">Não associado</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="label">Observações</label>
                <textarea className="input h-20 resize-none" value={endrForm.notes} onChange={e => setEndrForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowEndrModal(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={savingEndr} className="btn-primary">{savingEndr ? "Salvando..." : "Registrar"}</button>
              </div>
            </form>
          </Modal>
        </div>
      )}

      {/* Tab 3: Contacts */}
      {tab === 3 && (
        <div>
          <div className="flex gap-3 mb-4">
            <button onClick={() => setShowAddContact(true)} className="btn-primary">+ Adicionar Contato</button>
            <button onClick={handleFindContacts} disabled={aiLoading} className="btn-secondary">
              {aiLoading ? "Pesquisando..." : "Pesquisar com IA"}
            </button>
          </div>

          {aiResult && (
            <div className="card mb-4 border-primary/20 bg-primary/5">
              <h3 className="font-semibold text-white mb-2">Sugestões da IA</h3>
              {aiResult.error ? (
                <p className="text-danger text-sm">{aiResult.error}</p>
              ) : (
                <>
                  {aiResult.search_suggestions?.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted uppercase mb-1">Onde buscar</p>
                      <ul className="text-sm text-slate-300 list-disc list-inside space-y-1">
                        {aiResult.search_suggestions.map((s: string, i: number) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                  {aiResult.inferred_contacts?.length > 0 && (
                    <div>
                      <p className="text-xs text-muted uppercase mb-1">Contatos inferidos</p>
                      <ul className="text-sm space-y-1">
                        {aiResult.inferred_contacts.map((c: any, i: number) => (
                          <li key={i} className="text-slate-300">
                            <span className="text-muted">[{c.type}]</span> {c.value} - confiança: {c.confidence}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {aiResult.notes && <p className="text-xs text-muted mt-2">{aiResult.notes}</p>}
                </>
              )}
            </div>
          )}

          {operator.contacts?.length === 0 ? (
            <div className="card text-center py-8 text-muted text-sm">Nenhum contato cadastrado</div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full">
                <thead className="bg-surface">
                  <tr>
                    <th className="table-th">Tipo</th>
                    <th className="table-th">Valor</th>
                    <th className="table-th">Label</th>
                    <th className="table-th">Fonte</th>
                    <th className="table-th">Principal</th>
                    <th className="table-th">Cadastrado</th>
                    <th className="table-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {operator.contacts.map((c: any) => (
                    <tr key={c.id}>
                      <td className="table-td capitalize">{c.type}</td>
                      <td className="table-td font-mono text-xs">{c.value}</td>
                      <td className="table-td">{c.label || "-"}</td>
                      <td className="table-td text-muted">{c.source || "-"}</td>
                      <td className="table-td">{c.is_primary ? <span className="text-success text-xs">Sim</span> : "-"}</td>
                      <td className="table-td text-muted">{formatDate(c.created_at)}</td>
                      <td className="table-td">
                        <button onClick={() => handleDeleteContact(c.id)} className="text-danger text-xs hover:underline">Remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Modal isOpen={showAddContact} onClose={() => setShowAddContact(false)} title="Adicionar Contato">
            <form onSubmit={handleAddContact} className="space-y-4">
              <div>
                <label className="label">Tipo *</label>
                <select className="input" required value={contactForm.type} onChange={e => setContactForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="email">Email</option>
                  <option value="phone">Telefone</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="social_media">Redes Sociais</option>
                  <option value="other">Outro</option>
                </select>
              </div>
              <div>
                <label className="label">Valor *</label>
                <input className="input" required value={contactForm.value} onChange={e => setContactForm(f => ({ ...f, value: e.target.value }))} placeholder="contato@empresa.com" />
              </div>
              <div>
                <label className="label">Label</label>
                <input className="input" value={contactForm.label} onChange={e => setContactForm(f => ({ ...f, label: e.target.value }))} placeholder="Ex: Financeiro" />
              </div>
              <div>
                <label className="label">Fonte</label>
                <input className="input" value={contactForm.source} onChange={e => setContactForm(f => ({ ...f, source: e.target.value }))} placeholder="Ex: Site oficial" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={contactForm.is_primary} onChange={e => setContactForm(f => ({ ...f, is_primary: e.target.checked }))} />
                <span className="text-sm text-slate-300">Contato principal</span>
              </label>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowAddContact(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={addingContact} className="btn-primary">{addingContact ? "Adicionando..." : "Adicionar"}</button>
              </div>
            </form>
          </Modal>
        </div>
      )}

      {/* Tab 4: Contact Research */}
      {tab === 4 && (
        <div className="max-w-5xl">
          <div className="flex items-start justify-between mb-4 gap-4">
            <div className="text-sm text-muted max-w-xl">
              O sistema pesquisa automaticamente contatos nas seguintes fontes: <span className="text-slate-300">Receita Federal (BrasilAPI)</span>, <span className="text-slate-300">DuckDuckGo</span>, <span className="text-slate-300">Claude AI</span>. Resultados ficam pendentes até revisão humana.
            </div>
            <button onClick={handleResearchContacts} disabled={researching} className="btn-primary whitespace-nowrap">
              {researching ? "Pesquisando..." : "Iniciar Pesquisa"}
            </button>
          </div>

          {/* Filter buttons */}
          <div className="flex gap-2 mb-4">
            {[
              { label: "Pendentes", value: "pending" },
              { label: "Aprovados", value: "approved" },
              { label: "Rejeitados", value: "rejected" },
              { label: "Todos", value: "" },
            ].map(f => (
              <button
                key={f.value}
                onClick={() => { setSuggestionsFilter(f.value); fetchSuggestions(f.value); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  suggestionsFilter === f.value
                    ? "bg-primary text-white border-primary"
                    : "border-surface-border text-muted hover:text-slate-300"
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              onClick={() => fetchSuggestions()}
              className="px-3 py-1.5 text-xs font-medium rounded-full border border-surface-border text-muted hover:text-slate-300 transition-colors ml-auto"
            >
              Atualizar
            </button>
          </div>

          {suggestionsLoading ? (
            <div className="card text-center py-8 text-muted text-sm">Carregando...</div>
          ) : suggestions.length === 0 ? (
            <div className="card text-center py-8 text-muted text-sm">
              Nenhuma sugestão encontrada. Clique em &ldquo;Iniciar Pesquisa&rdquo; para buscar contatos automaticamente.
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full">
                <thead className="bg-surface">
                  <tr>
                    <th className="table-th">Tipo</th>
                    <th className="table-th">Valor</th>
                    <th className="table-th">Fonte</th>
                    <th className="table-th">Vínculo</th>
                    <th className="table-th">Confiança</th>
                    <th className="table-th">Encontrado em</th>
                    <th className="table-th">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s: any) => (
                    <tr key={s.id} className="hover:bg-surface-light/20 transition-colors">
                      <td className="table-td">
                        {s.type === "email" && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/40 text-blue-300 border border-blue-700/40">Email</span>}
                        {(s.type === "phone" || s.type === "whatsapp") && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400 border border-green-700/40">{s.type === "whatsapp" ? "WhatsApp" : "Telefone"}</span>}
                        {s.type === "social_media" && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-900/40 text-purple-300 border border-purple-700/40">Rede Social</span>}
                        {s.type === "other" && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-muted border border-surface-border">Outro</span>}
                      </td>
                      <td className="table-td font-mono text-xs max-w-xs truncate" title={s.value}>{s.value}</td>
                      <td className="table-td text-muted text-xs">{s.source}</td>
                      <td className="table-td text-muted text-xs">{s.relationship_label || "-"}</td>
                      <td className="table-td">
                        {s.confidence === "high" && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400 border border-green-700/40">Alta</span>}
                        {s.confidence === "medium" && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-900/40 text-yellow-400 border border-yellow-700/40">Média</span>}
                        {s.confidence === "low" && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-muted border border-surface-border">Baixa</span>}
                        {!s.confidence && "-"}
                      </td>
                      <td className="table-td text-muted text-xs whitespace-nowrap">
                        {s.found_at ? new Date(s.found_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}
                      </td>
                      <td className="table-td">
                        {s.status === "pending" && (
                          <div className="flex gap-2">
                            <button onClick={() => handleApproveSuggestion(s.id)} className="text-xs px-2 py-1 bg-green-900/40 text-green-400 border border-green-700/40 rounded hover:bg-green-800/40 transition-colors">
                              Aprovar
                            </button>
                            <button onClick={() => handleRejectSuggestion(s.id)} className="text-xs px-2 py-1 bg-red-900/40 text-danger border border-red-700/40 rounded hover:bg-red-800/40 transition-colors">
                              Rejeitar
                            </button>
                          </div>
                        )}
                        {s.status === "approved" && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400 border border-green-700/40">Aprovado</span>}
                        {s.status === "rejected" && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/40 text-danger border border-red-700/40">Rejeitado</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Payments */}
      {tab === 5 && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="table-th">Ciclo</th>
                <th className="table-th">Confederação</th>
                <th className="table-th">GGR Declarado</th>
                <th className="table-th">Valor Calculado</th>
                <th className="table-th">Valor Pago</th>
                <th className="table-th">Data Pagamento</th>
                <th className="table-th">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={7} className="table-td text-center text-muted py-8">Nenhum pagamento registrado</td></tr>
              ) : payments.map(p => (
                <tr key={p.id}>
                  <td className="table-td text-muted">#{p.cycle_id}</td>
                  <td className="table-td">#{p.confederation_id}</td>
                  <td className="table-td">{formatCurrency(p.ggr_declared)}</td>
                  <td className="table-td">{formatCurrency(p.calculated_amount)}</td>
                  <td className="table-td">{formatCurrency(p.amount_paid)}</td>
                  <td className="table-td">{formatDate(p.payment_date)}</td>
                  <td className="table-td"><Badge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 6: Documents */}
      {tab === 6 && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="table-th">Título</th>
                <th className="table-th">Tipo</th>
                <th className="table-th">Arquivo</th>
                <th className="table-th">Tamanho</th>
                <th className="table-th">Enviado em</th>
              </tr>
            </thead>
            <tbody>
              {documents.length === 0 ? (
                <tr><td colSpan={5} className="table-td text-center text-muted py-8">Nenhum documento</td></tr>
              ) : documents.map((d: any) => (
                <tr key={d.id}>
                  <td className="table-td text-white">{d.title}</td>
                  <td className="table-td capitalize">{d.document_type}</td>
                  <td className="table-td text-xs font-mono">{d.file_name}</td>
                  <td className="table-td text-muted">{d.file_size ? `${Math.round(d.file_size / 1024)} KB` : "-"}</td>
                  <td className="table-td text-muted">{formatDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 7: Audit */}
      {tab === 7 && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="table-th">Ação</th>
                <th className="table-th">Descrição</th>
                <th className="table-th">Usuário</th>
                <th className="table-th">Data/Hora</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 ? (
                <tr><td colSpan={4} className="table-td text-center text-muted py-8">Nenhum registro</td></tr>
              ) : audit.map((a: any) => (
                <tr key={a.id}>
                  <td className="table-td"><code className="text-xs bg-surface px-2 py-0.5 rounded">{a.action}</code></td>
                  <td className="table-td text-muted">{a.description || "-"}</td>
                  <td className="table-td text-muted">#{a.user_id}</td>
                  <td className="table-td text-muted">{formatDateTime(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
