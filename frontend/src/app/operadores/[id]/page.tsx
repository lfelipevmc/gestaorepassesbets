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
  addResponsible, updateResponsible, deleteResponsible,
  addEndrAssociation, deleteEndrAssociation,
  researchContacts, getContactSuggestions, approveSuggestion, rejectSuggestion,
  getDirectPayments, createDirectPayment, deleteDirectPayment, updateDirectPayment,
  getConfederations, uploadDocument, downloadDocument,
  getOperatorMonthlyHistory, getOperatorComplianceScore, getOperatorConfSummary,
} from "@/lib/api";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";

const TABS = ["Dados Cadastrais", "Marcas Vinculadas", "Responsáveis", "ENDR", "Contatos", "Pesquisa de Contatos", "Histórico de Pagamentos", "Documentos", "Auditoria"];

const ROLE_LABELS: Record<string, string> = {
  legal: "Responsável Legal",
  financeiro: "Responsável Financeiro",
  juridico: "Responsável Jurídico",
};

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

  // Histórico (12 meses, janela navegável desde jan/2025) + score + consolidado por confederação
  const [monthlyHistory, setMonthlyHistory] = useState<any[]>([]);
  const [histEnd, setHistEnd] = useState<string>("");  // "YYYY-MM" (vazio = mês atual)
  const [complianceScore, setComplianceScore] = useState<any>(null);
  const [confSummary, setConfSummary] = useState<any[]>([]);

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
  const [brandForm, setBrandForm] = useState({ name: "", domain: "", website: "", instagram: "", twitter: "", facebook: "", other_social: "" });
  const [savingBrand, setSavingBrand] = useState(false);

  // Responsáveis
  const [showRespModal, setShowRespModal] = useState(false);
  const [editingResp, setEditingResp] = useState<any>(null);
  const [respForm, setRespForm] = useState({ role: "legal", name: "", email: "", phone: "", notes: "" });
  const [savingResp, setSavingResp] = useState(false);

  // ENDR

  // Contact Research
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestionsFilter, setSuggestionsFilter] = useState<string>("pending");
  const [researching, setResearching] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Direct Payments (Lançamentos Avulsos)
  const [directPayments, setDirectPayments] = useState<any[]>([]);
  const [confederations, setConfederations] = useState<any[]>([]);
  const [showDirectModal, setShowDirectModal] = useState(false);
  const [directForm, setDirectForm] = useState({
    confederation_id: "",
    reference_month: new Date().toISOString().slice(0, 7),
    amount_received: "",
    received_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [savingDirect, setSavingDirect] = useState(false);
  const [defineMonth, setDefineMonth] = useState<any>(null);  // { payment, value } — definir mês de competência depois

  // Upload de documentos do operador
  const [showDocUpload, setShowDocUpload] = useState(false);
  const [docForm, setDocForm] = useState({ title: "", document_type: "other", description: "" });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  async function handleUploadDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!docFile) { alert("Selecione um arquivo."); return; }
    if (docFile.size > 25 * 1024 * 1024) { alert("Arquivo maior que 25 MB. Compacte ou divida o documento."); return; }
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append("file", docFile);
      fd.append("title", docForm.title || docFile.name);
      fd.append("document_type", docForm.document_type);
      fd.append("operator_id", String(numId));
      if (docForm.description) fd.append("description", docForm.description);
      await uploadDocument(fd);
      setShowDocUpload(false);
      setDocForm({ title: "", document_type: "other", description: "" });
      setDocFile(null);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao enviar documento");
    } finally { setUploadingDoc(false); }
  }

  async function handleDownloadDoc(d: any) {
    try {
      const r = await downloadDocument(d.id);
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a"); a.href = url; a.download = d.file_name || "documento"; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("Erro ao baixar documento."); }
  }

  async function handleSaveDefineMonth(e: React.FormEvent) {
    e.preventDefault();
    if (!defineMonth?.value) { alert("Selecione o mês."); return; }
    try {
      await updateDirectPayment(numId, defineMonth.payment.id, { reference_month: defineMonth.value + "-01" });
      setDefineMonth(null);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao definir o mês");
    }
  }

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      getOperator(numId),
      getPayments({ operator_id: numId }),
      getDocuments({ operator_id: numId }),
      getAuditLogs({ entity_type: "BettingOperator" }),
      getDirectPayments({ operator_id: numId }),
      getConfederations(),
    ]).then(([op, pays, docs, auditData, direct, confs]) => {
      setOperator(op.data);
      initEditForm(op.data);
      setPayments(pays.data);
      setDocuments(docs.data);
      setAudit(auditData.data.filter((a: any) => a.entity_id === numId));
      setDirectPayments(direct.data);
      setConfederations(confs.data);
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
  useEffect(() => { getOperatorComplianceScore(numId).then(r => setComplianceScore(r.data)).catch(() => {}); }, [numId]);

  useEffect(() => {
    if (tab === 5) fetchSuggestions();
    if (tab === 6) {
      loadHistory(histEnd);
      getOperatorComplianceScore(numId).then(r => setComplianceScore(r.data)).catch(() => {});
      getOperatorConfSummary(numId).then(r => setConfSummary(r.data)).catch(() => {});
    }
  }, [tab]);

  function loadHistory(end: string) {
    getOperatorMonthlyHistory(numId, 12, end || undefined)
      .then(r => setMonthlyHistory(r.data.history || []))
      .catch(() => {});
  }

  function shiftHistory(deltaMonths: number) {
    // calcula nova janela a partir do fim atual
    const base = histEnd || new Date().toISOString().slice(0, 7);
    const [y, m] = base.split("-").map(Number);
    let ny = y, nm = m + deltaMonths;
    while (nm <= 0) { nm += 12; ny -= 1; }
    while (nm > 12) { nm -= 12; ny += 1; }
    const minY = 2025, maxD = new Date();
    let next = `${ny}-${String(nm).padStart(2, "0")}`;
    const maxS = `${maxD.getFullYear()}-${String(maxD.getMonth() + 1).padStart(2, "0")}`;
    if (next > maxS) next = maxS;
    if (ny < minY || (ny === minY && nm < 12)) next = "2025-12";  // janela mínima termina em dez/2025 (12 meses desde jan/2025)
    setHistEnd(next);
    loadHistory(next);
  }

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
    setBrandForm({ name: "", domain: "", website: "", instagram: "", twitter: "", facebook: "", other_social: "" });
    setShowBrandModal(true);
  }

  function openEditBrand(brand: any) {
    setEditingBrand(brand);
    setBrandForm({
      name: brand.name || "",
      domain: brand.domain || "",
      website: brand.website || "",
      instagram: brand.instagram || "",
      twitter: brand.twitter || "",
      facebook: brand.facebook || "",
      other_social: brand.other_social || "",
    });
    setShowBrandModal(true);
  }

  function openNewResp() {
    setEditingResp(null);
    setRespForm({ role: "legal", name: "", email: "", phone: "", notes: "" });
    setShowRespModal(true);
  }

  function openEditResp(r: any) {
    setEditingResp(r);
    setRespForm({ role: r.role, name: r.name || "", email: r.email || "", phone: r.phone || "", notes: r.notes || "" });
    setShowRespModal(true);
  }

  async function handleSaveResp(e: React.FormEvent) {
    e.preventDefault();
    setSavingResp(true);
    try {
      if (editingResp) await updateResponsible(numId, editingResp.id, respForm);
      else await addResponsible(numId, respForm);
      setShowRespModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao salvar responsável");
    } finally { setSavingResp(false); }
  }

  async function handleDeleteResp(respId: number) {
    if (!confirm("Remover este responsável?")) return;
    await deleteResponsible(numId, respId);
    fetchData();
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



  async function handleSaveDirectPayment(e: React.FormEvent) {
    e.preventDefault();
    setSavingDirect(true);
    try {
      await createDirectPayment(numId, {
        confederation_id: Number(directForm.confederation_id),
        reference_month: directForm.reference_month ? directForm.reference_month + "-01" : null,
        amount_received: parseFloat(directForm.amount_received),
        received_date: directForm.received_date,
        notes: directForm.notes || undefined,
      });
      setShowDirectModal(false);
      setDirectForm({ confederation_id: "", reference_month: "", amount_received: "", received_date: new Date().toISOString().slice(0, 10), notes: "" });
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao registrar lançamento");
    } finally { setSavingDirect(false); }
  }

  async function handleDeleteDirect(paymentId: number) {
    if (!confirm("Excluir este lançamento avulso?")) return;
    await deleteDirectPayment(numId, paymentId);
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
      const r = await researchContacts(numId);
      const novas = r.data?.new_suggestions ?? 0;
      const erros = r.data?.errors || [];
      setSuggestionsFilter("pending");
      await fetchSuggestions("pending");
      if (novas > 0) alert(`Pesquisa concluída: ${novas} nova(s) sugestão(ões) encontrada(s). Revise abaixo.`);
      else alert("Pesquisa concluída, mas nenhuma sugestão nova foi encontrada." + (erros.length ? `\n\nObservações: ${erros.join("; ")}` : "\n\nVerifique se o CNPJ/site estão preenchidos e se a chave de IA está configurada."));
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao pesquisar contatos");
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
        actions={
          <div className="flex items-center gap-2">
            {complianceScore && complianceScore.score !== null && (
              <span className={`text-xs px-3 py-1 rounded-full border font-medium ${
                complianceScore.score >= 70 ? "bg-success/10 text-success border-success/30" :
                complianceScore.score >= 40 ? "bg-warning/10 text-warning border-warning/30" :
                "bg-danger/10 text-danger border-danger/30"}`}
                title={`Adimplência ${complianceScore.score}% — ${complianceScore.paid}/${complianceScore.total} pagamentos`}>
                {complianceScore.score >= 70 ? "★ Bom pagador" : complianceScore.label} · {complianceScore.score}%
              </span>
            )}
            <Badge status={operator.status} />
          </div>
        }
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
            <p className="text-sm text-muted">{brands.length} marca(s) cadastrada(s) — sem limite de quantidade.</p>
            <button
              onClick={openNewBrand}
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
                    {brand.domain && <div><span className="text-muted">Domínio: </span><span className="text-slate-300 font-mono text-xs">{brand.domain}</span></div>}
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
                <label className="label">Domínio de apostas</label>
                <input className="input" placeholder="Ex: betano.bet.br" value={brandForm.domain} onChange={e => setBrandForm(f => ({ ...f, domain: e.target.value }))} />
              </div>
              <div>
                <label className="label">Site institucional</label>
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

      {/* Tab 2: Responsáveis */}
      {tab === 2 && (
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted">Responsável Legal, Financeiro e Jurídico da Bet com dados de contato.</p>
            <button onClick={openNewResp} className="btn-primary">+ Adicionar Responsável</button>
          </div>

          {(operator.responsibles || []).length === 0 ? (
            <div className="card text-center py-8 text-muted text-sm">Nenhum responsável cadastrado</div>
          ) : (
            <div className="space-y-4">
              {(operator.responsibles || []).map((r: any) => (
                <div key={r.id} className="card">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-primary">{ROLE_LABELS[r.role] || r.role}</span>
                      <h4 className="font-semibold text-white mt-0.5">{r.name}</h4>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openEditResp(r)} className="text-primary text-xs hover:underline">Editar</button>
                      <button onClick={() => handleDeleteResp(r.id)} className="text-danger text-xs hover:underline">Remover</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                    {r.email && <div><span className="text-muted">E-mail: </span><span className="text-slate-300">{r.email}</span></div>}
                    {r.phone && <div><span className="text-muted">Telefone: </span><span className="text-slate-300">{r.phone}</span></div>}
                    {r.notes && <div className="col-span-2"><span className="text-muted">Obs: </span><span className="text-slate-300">{r.notes}</span></div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Modal isOpen={showRespModal} onClose={() => setShowRespModal(false)} title={editingResp ? "Editar Responsável" : "Novo Responsável"}>
            <form onSubmit={handleSaveResp} className="space-y-4">
              <div>
                <label className="label">Função *</label>
                <select className="input" value={respForm.role} onChange={e => setRespForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="legal">Responsável Legal</option>
                  <option value="financeiro">Responsável Financeiro</option>
                  <option value="juridico">Responsável Jurídico</option>
                </select>
              </div>
              <div>
                <label className="label">Nome *</label>
                <input className="input" required value={respForm.name} onChange={e => setRespForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">E-mail</label>
                  <input className="input" type="email" value={respForm.email} onChange={e => setRespForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Telefone</label>
                  <input className="input" value={respForm.phone} onChange={e => setRespForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Observações</label>
                <textarea className="input h-20 resize-none" value={respForm.notes} onChange={e => setRespForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowRespModal(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={savingResp} className="btn-primary">{savingResp ? "Salvando..." : "Salvar"}</button>
              </div>
            </form>
          </Modal>
        </div>
      )}

      {/* Tab 3: ENDR */}
      {tab === 3 && (
        <div className="max-w-3xl">
          <div className="mb-4 p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg text-sm text-slate-300">
            <p className="font-medium text-white mb-1">Sobre o ENDR</p>
            <p>Se o agente operador estiver associado ao ENDR (Escritório Nacional de Rateios) em determinado mês, não será cobrado naquele mês. As notificações automáticas serão suspensas para os meses marcados como associado.</p>
          </div>

          <div className="flex items-center justify-between gap-2 mb-4">
            <p className="text-xs text-muted">Consulta — as associações ENDR são gerenciadas exclusivamente na <span className="text-slate-200">aba ENDR</span> (fonte única).</p>
            <a href="/endr" className="btn-primary">Gerenciar na aba ENDR</a>
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

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}

      {/* Tab 4: Contacts */}
      {tab === 4 && (
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

      {/* Tab 5: Contact Research */}
      {tab === 5 && (
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

      {/* Tab 6: Payments */}
      {tab === 6 && (
        <div className="space-y-6">
          {/* Painel: Score + Histórico 12 meses */}
          <div className="card">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-white">Histórico de 12 Meses</h3>
                  <div className="flex items-center gap-1">
                    <button onClick={() => shiftHistory(-12)} className="px-2 py-0.5 text-xs border border-surface-border rounded hover:bg-surface text-slate-300" title="12 meses anteriores">«</button>
                    <button onClick={() => shiftHistory(-1)} className="px-2 py-0.5 text-xs border border-surface-border rounded hover:bg-surface text-slate-300" title="Mês anterior">‹</button>
                    <button onClick={() => shiftHistory(1)} className="px-2 py-0.5 text-xs border border-surface-border rounded hover:bg-surface text-slate-300" title="Próximo mês">›</button>
                    <button onClick={() => { setHistEnd(""); loadHistory(""); }} className="px-2 py-0.5 text-xs border border-surface-border rounded hover:bg-surface text-slate-300" title="Voltar para hoje">Hoje</button>
                  </div>
                </div>
                <p className="text-xs text-muted mt-0.5">Situação mês a mês — navegue no histórico desde janeiro/2025.{histEnd ? ` Janela terminando em ${histEnd.split("-")[1]}/${histEnd.split("-")[0]}.` : ""}</p>
              </div>
              {complianceScore && complianceScore.score !== null && (
                <div className="text-right">
                  <div className={`text-3xl font-bold ${
                    complianceScore.score >= 90 ? "text-success" :
                    complianceScore.score >= 70 ? "text-success" :
                    complianceScore.score >= 40 ? "text-warning" : "text-danger"
                  }`}>{complianceScore.score}%</div>
                  <div className="text-xs text-muted">Adimplência · {complianceScore.label}</div>
                  <div className="text-xs text-muted mt-0.5">{complianceScore.paid}/{complianceScore.total} pagamentos</div>
                </div>
              )}
            </div>

            {monthlyHistory.length === 0 ? (
              <p className="text-muted text-sm py-4">Sem histórico de pagamentos registrado.</p>
            ) : (
              <>
                <div className="grid grid-cols-6 lg:grid-cols-12 gap-2">
                  {monthlyHistory.map((h, i) => {
                    const colors: Record<string, string> = {
                      paid: "bg-success/20 border-success/40 text-success",
                      overdue: "bg-danger/20 border-danger/40 text-danger",
                      pending: "bg-warning/20 border-warning/40 text-warning",
                      none: "bg-surface border-surface-border text-muted",
                    };
                    const labels: Record<string, string> = {
                      paid: "Pago", overdue: "Inadimplente", pending: "Pendente", none: "Sem cobrança",
                    };
                    return (
                      <div key={i} className={`rounded-lg border p-2 text-center ${colors[h.situation]}`} title={labels[h.situation]}>
                        <div className="text-[10px] font-medium opacity-80">{h.month}</div>
                        <div className="text-xs font-bold mt-1">
                          {h.received > 0 ? formatCurrency(h.received).replace("R$", "").trim() : "—"}
                        </div>
                        {h.has_report && <div className="text-[9px] mt-0.5">📄</div>}
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-4 mt-4 text-xs text-muted">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-success/40 inline-block"></span> Pago</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-warning/40 inline-block"></span> Pendente</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-danger/40 inline-block"></span> Inadimplente</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-surface-border inline-block"></span> Sem cobrança</span>
                  <span className="flex items-center gap-1">📄 Relatório de GGR recebido</span>
                </div>
              </>
            )}
          </div>

          {/* Lançamentos Avulsos */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-white">Lançamentos Avulsos</h3>
                <p className="text-xs text-muted mt-0.5">Valores recebidos registrados manualmente, sem vínculo com ciclo de cobrança.</p>
              </div>
              <button className="btn-primary text-sm" onClick={() => {
                setDirectForm({ confederation_id: confederations[0]?.id?.toString() || "", reference_month: "", amount_received: "", received_date: new Date().toISOString().slice(0, 10), notes: "" });
                setShowDirectModal(true);
              }}>+ Novo Lançamento</button>
            </div>
            <div className="overflow-hidden rounded-lg border border-surface-border">
              <table className="w-full">
                <thead className="bg-surface">
                  <tr>
                    <th className="table-th">Confederação</th>
                    <th className="table-th">Mês Referência</th>
                    <th className="table-th">Valor Recebido</th>
                    <th className="table-th">Data Recebimento</th>
                    <th className="table-th">Observações</th>
                    <th className="table-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {directPayments.length === 0 ? (
                    <tr><td colSpan={6} className="table-td text-center text-muted py-8">Nenhum lançamento avulso registrado</td></tr>
                  ) : directPayments.map((dp: any) => {
                    const conf = confederations.find((c: any) => c.id === dp.confederation_id);
                    return (
                      <tr key={dp.id}>
                        <td className="table-td font-medium">{conf?.acronym || `#${dp.confederation_id}`}</td>
                        <td className="table-td">
                          {dp.reference_month ? formatMonthBR(dp.reference_month) : (
                            <span className="text-xs text-warning bg-warning/10 px-2 py-0.5 rounded">A definir</span>
                          )}
                          <button type="button" onClick={() => setDefineMonth({ payment: dp, value: (dp.reference_month || "").slice(0, 7) })} className="block text-[11px] text-primary hover:underline mt-0.5">{dp.reference_month ? "Alterar mês" : "Definir mês"}</button>
                        </td>
                        <td className="table-td text-success font-medium">{formatCurrency(dp.amount_received)}</td>
                        <td className="table-td">{formatDate(dp.received_date)}</td>
                        <td className="table-td text-muted text-xs">{dp.notes || "—"}</td>
                        <td className="table-td">
                          <button className="text-danger hover:text-red-400 text-xs" onClick={() => handleDeleteDirect(dp.id)}>Excluir</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Visão consolidada por confederação (substitui a segmentação por ciclo de cobrança) */}
          <div className="card">
            <h3 className="font-semibold text-white mb-1">Pagamentos por Confederação</h3>
            <p className="text-xs text-muted mb-4">Visão consolidada do relacionamento financeiro deste operador com cada confederação (sem segmentação por ciclo).</p>
            <div className="overflow-hidden rounded-lg border border-surface-border">
              <table className="w-full">
                <thead className="bg-surface">
                  <tr>
                    <th className="table-th">Confederação</th>
                    <th className="table-th">Valor Recebido (total)</th>
                    <th className="table-th">Último Pagamento</th>
                    <th className="table-th">Valor do Último</th>
                    <th className="table-th">Relatório</th>
                    <th className="table-th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {confSummary.length === 0 ? (
                    <tr><td colSpan={6} className="table-td text-center text-muted py-8">Carregando...</td></tr>
                  ) : confSummary.map((c: any) => {
                    const cls: Record<string, string> = {
                      adimplente: "text-success bg-success/10", inadimplente: "text-danger bg-danger/10",
                      endr: "text-green-400 bg-green-900/30", consignacao: "text-warning bg-warning/10",
                      sem_obrigacao: "text-slate-300 bg-slate-500/10",
                    };
                    return (
                      <tr key={c.confederation_id}>
                        <td className="table-td font-medium text-white">{c.acronym}</td>
                        <td className="table-td text-success font-medium">{formatCurrency(c.received_total)}</td>
                        <td className="table-td">{c.last_payment_date ? formatDate(c.last_payment_date) : "—"}</td>
                        <td className="table-td">{c.last_payment_amount ? formatCurrency(c.last_payment_amount) : "—"}</td>
                        <td className="table-td">
                          {c.report_url
                            ? <a href={(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000") + c.report_url} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">Ver / Baixar</a>
                            : <span className="text-xs text-muted">—</span>}
                        </td>
                        <td className="table-td"><span className={"px-2 py-0.5 rounded-full text-xs " + (cls[c.status] || "text-muted bg-surface")}>{c.status_label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Novo Lançamento Avulso */}
      {showDirectModal && (
        <Modal isOpen={showDirectModal} title="Registrar Lançamento Avulso" onClose={() => setShowDirectModal(false)}>
          <form onSubmit={handleSaveDirectPayment} className="space-y-4">
            <div>
              <label className="label">Confederação *</label>
              <select className="input" required value={directForm.confederation_id} onChange={e => setDirectForm(f => ({ ...f, confederation_id: e.target.value }))}>
                <option value="">Selecione...</option>
                {confederations.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.acronym} — {c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Mês de Referência *</label>
                <input className="input" type="month" value={directForm.reference_month} onChange={e => setDirectForm(f => ({ ...f, reference_month: e.target.value }))} />
                <p className="text-xs text-muted mt-1">Opcional — se ainda não souber (aguardando o relatório da Bet), deixe em branco e defina depois.</p>
              </div>
              <div>
                <label className="label">Data do Recebimento *</label>
                <input className="input" type="date" required value={directForm.received_date} onChange={e => setDirectForm(f => ({ ...f, received_date: e.target.value }))} />
                <p className="text-xs text-muted mt-1">Data em que o valor entrou no caixa</p>
              </div>
            </div>
            <div>
              <label className="label">Valor Recebido (R$) *</label>
              <input className="input" type="number" step="0.01" min="0.01" required placeholder="0,00" value={directForm.amount_received} onChange={e => setDirectForm(f => ({ ...f, amount_received: e.target.value }))} />
            </div>
            <div>
              <label className="label">Observações</label>
              <textarea className="input" rows={3} placeholder="Ex: Repasse referente a abril/2026 – TED recebido em 15/05" value={directForm.notes} onChange={e => setDirectForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => setShowDirectModal(false)}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={savingDirect}>{savingDirect ? "Salvando..." : "Registrar Lançamento"}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: definir mês de competência do lançamento avulso */}
      <Modal isOpen={!!defineMonth} onClose={() => setDefineMonth(null)} title="Definir mês de competência">
        {defineMonth && (
          <form onSubmit={handleSaveDefineMonth} className="space-y-4">
            <p className="text-sm text-muted">Informe a que mês se refere o repasse de {formatCurrency(defineMonth.payment.amount_received)} recebido em {formatDate(defineMonth.payment.received_date)} (conforme o relatório da Bet).</p>
            <div>
              <label className="label">Mês de competência *</label>
              <input className="input" type="month" required value={defineMonth.value} onChange={e => setDefineMonth((s: any) => ({ ...s, value: e.target.value }))} />
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setDefineMonth(null)} className="btn-secondary">Cancelar</button>
              <button type="submit" className="btn-primary">Salvar</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Tab 7: Documents */}
      {tab === 7 && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowDocUpload(true)} className="btn-primary">+ Enviar Documento</button>
          </div>
          <div className="card p-0 overflow-hidden">
            <table className="w-full">
              <thead className="bg-surface">
                <tr>
                  <th className="table-th">Título</th>
                  <th className="table-th">Tipo</th>
                  <th className="table-th">Arquivo</th>
                  <th className="table-th">Tamanho</th>
                  <th className="table-th">Enviado em</th>
                  <th className="table-th"></th>
                </tr>
              </thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr><td colSpan={6} className="table-td text-center text-muted py-8">Nenhum documento</td></tr>
                ) : documents.map((d: any) => (
                  <tr key={d.id}>
                    <td className="table-td text-white">{d.title}</td>
                    <td className="table-td capitalize">{d.document_type}</td>
                    <td className="table-td text-xs font-mono">{d.file_name}</td>
                    <td className="table-td text-muted">{d.file_size ? `${Math.round(d.file_size / 1024)} KB` : "-"}</td>
                    <td className="table-td text-muted">{formatDate(d.created_at)}</td>
                    <td className="table-td"><button onClick={() => handleDownloadDoc(d)} className="text-primary text-xs hover:underline">Baixar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Modal isOpen={showDocUpload} onClose={() => setShowDocUpload(false)} title="Enviar Documento">
            <form onSubmit={handleUploadDoc} className="space-y-4">
              <div>
                <label className="label">Arquivo * <span className="text-muted font-normal">(qualquer formato, até 25 MB)</span></label>
                <input type="file" className="input" onChange={e => setDocFile(e.target.files?.[0] || null)} />
              </div>
              <div>
                <label className="label">Título</label>
                <input className="input" placeholder="Ex.: Procuração 2026 (vazio = nome do arquivo)" value={docForm.title} onChange={e => setDocForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <label className="label">Tipo</label>
                <select className="input" value={docForm.document_type} onChange={e => setDocForm(f => ({ ...f, document_type: e.target.value }))}>
                  <option value="other">Outro</option>
                  <option value="contract">Contrato</option>
                  <option value="correspondence">Correspondência</option>
                  <option value="ggr_report">Relatório GGR</option>
                  <option value="receipt">Comprovante</option>
                  <option value="regulation">Regulamento</option>
                  <option value="notification">Notificação</option>
                  <option value="report">Relatório</option>
                </select>
              </div>
              <div>
                <label className="label">Descrição</label>
                <textarea className="input h-16 resize-none" value={docForm.description} onChange={e => setDocForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowDocUpload(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={uploadingDoc} className="btn-primary">{uploadingDoc ? "Enviando..." : "Enviar"}</button>
              </div>
            </form>
          </Modal>
        </div>
      )}

      {/* Tab 8: Audit */}
      {tab === 8 && (
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
