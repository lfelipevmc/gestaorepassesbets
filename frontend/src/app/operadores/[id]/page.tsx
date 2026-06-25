"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import { getOperator, addContact, deleteContact, findContactsAI, getPayments, getDocuments, getAuditLogs } from "@/lib/api";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";

const TABS = ["Informações", "Contatos", "Pagamentos", "Documentos", "Auditoria"];

export default function OperatorDetailPage() {
  const { id } = useParams();
  const [operator, setOperator] = useState<any>(null);
  const [tab, setTab] = useState(0);
  const [payments, setPayments] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState({ type: "email", value: "", label: "", source: "", is_primary: false });
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [addingContact, setAddingContact] = useState(false);

  const numId = Number(id);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      getOperator(numId),
      getPayments({ operator_id: numId }),
      getDocuments({ operator_id: numId }),
      getAuditLogs({ entity_type: "BettingOperator" }),
    ]).then(([op, pays, docs, audit]) => {
      setOperator(op.data);
      setPayments(pays.data);
      setDocuments(docs.data);
      setAudit(audit.data.filter((a: any) => a.entity_id === numId));
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [numId]);

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

  if (loading) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;
  if (!operator) return <AppShell><div className="text-muted">Operador não encontrado</div></AppShell>;

  return (
    <AppShell>
      <Header
        title={operator.fantasy_name || operator.company_name}
        subtitle={operator.company_name}
        actions={<Badge status={operator.status} />}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-surface-border">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab 0: Info */}
      {tab === 0 && (
        <div className="grid grid-cols-2 gap-6">
          <div className="card space-y-4">
            <h3 className="font-semibold text-white">Dados Cadastrais</h3>
            <Field label="Razão Social" value={operator.company_name} />
            <Field label="Nome Fantasia" value={operator.fantasy_name} />
            <Field label="CNPJ" value={operator.cnpj} mono />
            <Field label="Nº Licença MF" value={operator.mf_license_number} />
            <Field label="Website" value={operator.website} link />
            <Field label="Status" value={<Badge status={operator.status} />} />
            <Field label="Cadastrado em" value={formatDate(operator.created_at)} />
            <Field label="Atualizado em" value={formatDate(operator.updated_at)} />
          </div>
          {operator.notes && (
            <div className="card">
              <h3 className="font-semibold text-white mb-3">Observações</h3>
              <p className="text-sm text-slate-300 whitespace-pre-wrap">{operator.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Tab 1: Contacts */}
      {tab === 1 && (
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

      {/* Tab 2: Payments */}
      {tab === 2 && (
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

      {/* Tab 3: Documents */}
      {tab === 3 && (
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

      {/* Tab 4: Audit */}
      {tab === 4 && (
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

function Field({ label, value, mono = false, link = false }: { label: string; value: any; mono?: boolean; link?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted uppercase tracking-wide mb-0.5">{label}</p>
      {value == null || value === "" ? (
        <p className="text-sm text-muted">-</p>
      ) : link ? (
        <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">{value}</a>
      ) : typeof value === "string" || typeof value === "number" ? (
        <p className={`text-sm text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</p>
      ) : (
        <div>{value}</div>
      )}
    </div>
  );
}
