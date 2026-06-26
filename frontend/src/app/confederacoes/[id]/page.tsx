"use client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import {
  getConfederation, updateConfederation, uploadConfederationLogo, uploadConfederationRegulation,
  getDistributionRules, deleteDistributionRule,
  getCollections, getPayments, getOperators,
  getEndrPayments, createEndrPayment, uploadEndrReport, deleteEndrPayment,
  registerReport, uploadPaymentReport,
  getDocuments, uploadDocument, downloadDocument,
} from "@/lib/api";
import { formatDate, formatCurrency } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TABS = ["Visão Geral", "Cadastro", "Receitas por Mês", "Repasses ENDR", "Regras de Rateio"];

type Conf = {
  id: number; name: string; acronym: string; cnpj?: string; website?: string; phone?: string;
  address?: string; president_name?: string; president_email?: string; president_phone?: string;
  president_term?: string; logo_url?: string; regulation_text?: string; regulation_file_url?: string;
  regulation_online_url?: string; rateio_rules?: string;
  contact_email?: string; finance_email?: string; payment_due_day: number; redistribution_deadline_days?: number;
};
type Payment = {
  id: number; cycle_id: number; operator_id: number; status: string;
  amount_paid?: string; amount_due?: string; base_calculo?: string; report_received: boolean;
  report_reference_month?: string; report_notes?: string; report_file_url?: string;
};
type ENDRPay = {
  id: number; confederation_id: number; reference_month: string;
  amount_received: string; received_date: string; notes?: string;
  report_file_url?: string; bet_links: { id: number; operator_id: number }[];
};
type DistRule = {
  id: number; scenario_code: string; scenario_label: string; article_ref?: string;
  confederation_pct?: string; athlete_pct?: string; entity_pct?: string; federation_pct?: string;
  is_equanime: boolean; description?: string; order_index: number;
};

function toFirstOfMonth(d: Date) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    paid: { label: "Adimplente", cls: "text-success bg-success/10 border-success/30" },
    report_pending: { label: "Pend. Relatório", cls: "text-warning bg-warning/10 border-warning/30" },
    pending: { label: "Inadimplente", cls: "text-slate-400 bg-slate-400/10 border-slate-400/30" },
    overdue: { label: "Em atraso", cls: "text-danger bg-danger/10 border-danger/30" },
    partial: { label: "Parcial", cls: "text-warning bg-warning/10 border-warning/30" },
  };
  const s = map[status] || { label: status, cls: "text-muted bg-surface-border border-surface-border" };
  return <span className={"px-2 py-0.5 rounded text-xs border " + s.cls}>{s.label}</span>;
}

export default function ConfederationDetailPage() {
  const { id } = useParams();
  const numId = Number(id);
  const [conf, setConf] = useState<Conf | null>(null);
  const [cycles, setCycles] = useState<any[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [endrPayments, setEndrPayments] = useState<ENDRPay[]>([]);
  const [rules, setRules] = useState<DistRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [msg, setMsg] = useState("");

  const [editConf, setEditConf] = useState(false);
  const [confForm, setConfForm] = useState<Partial<Conf>>({});
  const [savingConf, setSavingConf] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const today = new Date();
  const [filterMonth, setFilterMonth] = useState(toFirstOfMonth(today));
  const [monthPayments, setMonthPayments] = useState<Payment[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(false);

  const [showEndrForm, setShowEndrForm] = useState(false);
  const [endrForm, setEndrForm] = useState({ reference_month: toFirstOfMonth(today), amount_received: "", received_date: "", notes: "", operator_ids: [] as number[] });
  const [savingEndr, setSavingEndr] = useState(false);

  const [reportModal, setReportModal] = useState<{ payId: number } | null>(null);
  const [reportForm, setReportForm] = useState({ report_reference_month: "", report_notes: "" });
  const reportFileRef = useRef<HTMLInputElement>(null);

  // Regulamento
  const regulationFileRef = useRef<HTMLInputElement>(null);
  const [regulationOnlineUrl, setRegulationOnlineUrl] = useState("");
  const [savingRegulationUrl, setSavingRegulationUrl] = useState(false);

  // Documentos da confederação (cadastro)
  const [confDocs, setConfDocs] = useState<any[]>([]);
  const [showDocForm, setShowDocForm] = useState(false);
  const [docForm, setDocForm] = useState({ title: "", document_type: "contract", category: "documento_oficial" });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);


  useEffect(() => {
    Promise.all([
      getConfederation(numId),
      getCollections({ confederation_id: numId }),
      getPayments({ confederation_id: numId, limit: 500 }),
      getOperators({ limit: 300 }),
      getEndrPayments({ confederation_id: numId }),
      getDistributionRules(numId),
      getDocuments({ confederation_id: numId }),
    ]).then(([c, cols, pays, ops, endr, rls, docs]) => {
      setConf(c.data);
      setConfForm(c.data);
      setRegulationOnlineUrl(c.data.regulation_online_url || "");
      setCycles(cols.data);
      setPayments(pays.data);
      setOperators(ops.data);
      setEndrPayments(endr.data);
      setRules(rls.data);
      setConfDocs(docs.data);
    }).finally(() => setLoading(false));
  }, [numId]);

  useEffect(() => {
    setLoadingMonth(true);
    getPayments({ confederation_id: numId, month: filterMonth, limit: 300 })
      .then(r => setMonthPayments(r.data))
      .finally(() => setLoadingMonth(false));
  }, [numId, filterMonth]);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 4000); }

  async function saveConf() {
    setSavingConf(true);
    try { const r = await updateConfederation(numId, confForm); setConf(r.data); setEditConf(false); flash("Cadastro salvo."); }
    catch { flash("Erro ao salvar."); }
    setSavingConf(false);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try { const r = await uploadConfederationLogo(numId, fd); setConf(c => c ? { ...c, logo_url: r.data.logo_url } : c); flash("Logomarca atualizada."); }
    catch { flash("Erro ao enviar logomarca."); }
  }

  async function saveEndr() {
    if (!endrForm.amount_received || !endrForm.received_date) return;
    setSavingEndr(true);
    try {
      const r = await createEndrPayment({ confederation_id: numId, reference_month: endrForm.reference_month, amount_received: parseFloat(endrForm.amount_received), received_date: endrForm.received_date, notes: endrForm.notes || null, operator_ids: endrForm.operator_ids });
      setEndrPayments(p => [r.data, ...p]);
      setShowEndrForm(false);
      setEndrForm({ reference_month: toFirstOfMonth(today), amount_received: "", received_date: "", notes: "", operator_ids: [] });
      flash("Repasse ENDR registrado.");
    } catch { flash("Erro ao registrar."); }
    setSavingEndr(false);
  }

  async function handleEndrFileUpload(endrId: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    await uploadEndrReport(endrId, fd);
    const r = await getEndrPayments({ confederation_id: numId }); setEndrPayments(r.data);
    flash("Arquivo enviado.");
  }

  async function handleDeleteEndr(endrId: number) {
    if (!confirm("Excluir este repasse ENDR?")) return;
    await deleteEndrPayment(endrId);
    setEndrPayments(p => p.filter(e => e.id !== endrId));
  }

  async function saveReport() {
    if (!reportModal) return;
    try {
      await registerReport(reportModal.payId, { report_reference_month: reportForm.report_reference_month + "-01" || null, report_notes: reportForm.report_notes || null });
      if (reportFileRef.current?.files?.[0]) {
        const fd = new FormData(); fd.append("file", reportFileRef.current.files[0]);
        await uploadPaymentReport(reportModal.payId, fd);
      }
      const r = await getPayments({ confederation_id: numId, limit: 500 }); setPayments(r.data);
      const rm = await getPayments({ confederation_id: numId, month: filterMonth, limit: 300 }); setMonthPayments(rm.data);
      setReportModal(null); flash("Relatório registrado.");
    } catch { flash("Erro ao registrar relatório."); }
  }

  async function handleDeleteRule(ruleId: number) {
    if (!confirm("Remover esta regra de rateio?")) return;
    await deleteDistributionRule(numId, ruleId);
    setRules(p => p.filter(x => x.id !== ruleId));
  }

  async function handleRegulationUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await uploadConfederationRegulation(numId, fd);
      setConf(c => c ? { ...c, regulation_file_url: r.data.regulation_file_url } : c);
      flash("Regulamento enviado com sucesso.");
    } catch { flash("Erro ao enviar regulamento."); }
  }

  async function handleSaveRegulationUrl() {
    setSavingRegulationUrl(true);
    try {
      const r = await updateConfederation(numId, { regulation_online_url: regulationOnlineUrl });
      setConf(r.data);
      flash("Link do regulamento salvo.");
    } catch { flash("Erro ao salvar link."); }
    setSavingRegulationUrl(false);
  }

  async function handleUploadDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!docFile) return;
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append("file", docFile);
      fd.append("title", docForm.title);
      fd.append("document_type", docForm.document_type);
      fd.append("category", docForm.category);
      fd.append("confederation_id", String(numId));
      await uploadDocument(fd);
      const r = await getDocuments({ confederation_id: numId });
      setConfDocs(r.data);
      setShowDocForm(false);
      setDocForm({ title: "", document_type: "contract", category: "documento_oficial" });
      setDocFile(null);
      flash("Documento enviado.");
    } catch { flash("Erro ao enviar documento."); }
    setUploadingDoc(false);
  }

  async function handleDownloadDoc(docId: number, fileName: string) {
    const r = await downloadDocument(docId);
    const url = window.URL.createObjectURL(new Blob([r.data]));
    const a = document.createElement("a"); a.href = url; a.download = fileName; a.click();
    window.URL.revokeObjectURL(url);
  }

  if (loading) return <AppShell><div className="text-muted p-8">Carregando...</div></AppShell>;
  if (!conf) return <AppShell><div className="text-muted p-8">Não encontrado</div></AppShell>;

  const paid = payments.filter(p => p.status === "paid").length;
  const reportPending = payments.filter(p => p.status === "report_pending").length;
  const overdue = payments.filter(p => p.status === "overdue" || p.status === "pending").length;
  const totalReceived = payments.reduce((s, p) => s + parseFloat(p.amount_paid || "0"), 0);
  const monthPaid = monthPayments.filter(p => p.status === "paid").length;
  const monthRptPend = monthPayments.filter(p => p.status === "report_pending").length;
  const monthOverdue = monthPayments.filter(p => p.status === "overdue" || p.status === "pending").length;
  const monthTotal = monthPayments.reduce((s, p) => s + parseFloat(p.amount_paid || "0"), 0);
  const opMap = Object.fromEntries(operators.map(o => [o.id, o]));
  const displayMonth = new Date(filterMonth + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <AppShell>
      <Header title={conf.acronym} subtitle={conf.name} />
      {msg && (
        <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          {msg}<button onClick={() => setMsg("")} className="ml-4 text-muted">✕</button>
        </div>
      )}

      <div className="flex gap-1 border-b border-surface-border mb-6">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={"px-4 py-2.5 text-sm font-medium border-b-2 transition-colors " + (tab === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-slate-200")}>
            {t}
          </button>
        ))}
      </div>

      {/* TAB 0: VISÃO GERAL */}
      {tab === 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <div className="card text-center"><p className="text-3xl font-bold text-success mb-1">{paid}</p><p className="text-xs text-muted">Adimplentes</p></div>
            <div className="card text-center"><p className="text-3xl font-bold text-warning mb-1">{reportPending}</p><p className="text-xs text-muted">Pend. de Relatório</p></div>
            <div className="card text-center"><p className="text-3xl font-bold text-danger mb-1">{overdue}</p><p className="text-xs text-muted">Inadimplentes</p></div>
            <div className="card text-center"><p className="text-xl font-bold text-success mb-1">{formatCurrency(totalReceived)}</p><p className="text-xs text-muted">Total Recebido</p></div>
          </div>
          <div className="card">
            <h3 className="font-semibold text-white mb-4">Ciclos de Cobrança ({cycles.length})</h3>
            {cycles.length === 0 ? <p className="text-muted text-sm">Nenhum ciclo criado</p> : (
              <div className="space-y-2">
                {cycles.slice(0, 8).map(c => (
                  <div key={c.id} className="flex items-center justify-between p-2 bg-surface rounded-lg">
                    <span className="text-sm text-slate-300">{formatDate(c.reference_month)}</span>
                    <span className="text-xs text-muted capitalize">{c.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 1: CADASTRO */}
      {tab === 1 && (
        <div className="space-y-6">
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-white">Dados Cadastrais</h3>
            {!editConf ? (
              <button onClick={() => setEditConf(true)} className="px-4 py-1.5 text-sm bg-primary/15 text-primary border border-primary/30 rounded-lg hover:bg-primary/25 transition-colors">Editar</button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setEditConf(false)} className="px-4 py-1.5 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">Cancelar</button>
                <button onClick={saveConf} disabled={savingConf} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors">{savingConf ? "Salvando..." : "Salvar"}</button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-surface-border">
            {conf.logo_url
              ? <img src={API_URL + conf.logo_url} alt="Logo" className="h-16 w-16 object-contain rounded-lg border border-surface-border bg-surface" />
              : <div className="h-16 w-16 rounded-lg border border-surface-border bg-surface flex items-center justify-center text-muted text-xs">Logo</div>}
            <div>
              <p className="text-sm text-white font-medium mb-1">Logomarca</p>
              <button onClick={() => logoInputRef.current?.click()} className="px-3 py-1.5 text-xs bg-surface-border border border-surface-border rounded-lg hover:bg-surface text-slate-300 transition-colors">
                {conf.logo_url ? "Trocar logo" : "Enviar logo"}
              </button>
              <input ref={logoInputRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden" onChange={handleLogoUpload} />
              <p className="text-xs text-muted mt-1">PNG, JPG, SVG ou WebP</p>
            </div>
          </div>

          {editConf ? (
            <div className="grid grid-cols-2 gap-4">
              {([
                ["Nome Completo", "name"], ["CNPJ", "cnpj"], ["Website", "website"], ["Telefone", "phone"],
                ["E-mail Contato", "contact_email"], ["E-mail Financeiro", "finance_email"],
                ["Presidente", "president_name"], ["E-mail Presidente", "president_email"],
                ["Telefone Presidente", "president_phone"], ["Mandato", "president_term"],
              ] as [string, string][]).map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs text-muted mb-1">{label}</label>
                  <input className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                    value={(confForm as any)[key] || ""} onChange={e => setConfForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
              <div className="col-span-2">
                <label className="block text-xs text-muted mb-1">Endereço</label>
                <input className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  value={confForm.address || ""} onChange={e => setConfForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-muted mb-1">Texto do Regulamento</label>
                <textarea rows={4} className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  value={confForm.regulation_text || ""} onChange={e => setConfForm(f => ({ ...f, regulation_text: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-muted mb-1">Regras de Rateio (regulamento interno)</label>
                <textarea rows={5} placeholder="Descreva as regras de rateio conforme regulamento interno aprovado..."
                  className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  value={confForm.rateio_rules || ""} onChange={e => setConfForm(f => ({ ...f, rateio_rules: e.target.value }))} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {([
                ["CNPJ", conf.cnpj], ["Website", conf.website], ["Telefone", conf.phone],
                ["E-mail Contato", conf.contact_email], ["E-mail Financeiro", conf.finance_email], ["Endereço", conf.address],
                ["Presidente", conf.president_name], ["E-mail Presidente", conf.president_email],
                ["Telefone Presidente", conf.president_phone], ["Mandato", conf.president_term],
              ] as [string, string | undefined][]).map(([label, val]) => (
                <div key={label}>
                  <p className="text-xs text-muted">{label}</p>
                  <p className="text-sm text-white mt-0.5">{val || <span className="text-slate-500 italic">—</span>}</p>
                </div>
              ))}
              {conf.regulation_text && <div className="col-span-3"><p className="text-xs text-muted mb-1">Regulamento</p><p className="text-sm text-slate-300 whitespace-pre-line">{conf.regulation_text}</p></div>}
              {conf.rateio_rules && <div className="col-span-3"><p className="text-xs text-muted mb-1">Regras de Rateio</p><p className="text-sm text-slate-300 whitespace-pre-line">{conf.rateio_rules}</p></div>}
            </div>
          )}
        </div>

        {/* Documentos da Confederação */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-white">Documentos</h3>
              <p className="text-xs text-muted mt-0.5">Procuração, estatuto social, atas e outros documentos da confederação.</p>
            </div>
            <button className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors" onClick={() => setShowDocForm(true)}>+ Enviar Documento</button>
          </div>

          {showDocForm && (
            <form onSubmit={handleUploadDoc} className="border border-surface-border rounded-lg p-4 mb-4 space-y-3 bg-surface">
              <h4 className="text-sm font-semibold text-white">Novo Documento</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-muted mb-1">Título *</label>
                  <input required className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                    placeholder="Ex: Estatuto Social — CBTM 2023"
                    value={docForm.title} onChange={e => setDocForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Tipo</label>
                  <select className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                    value={docForm.document_type} onChange={e => setDocForm(f => ({ ...f, document_type: e.target.value }))}>
                    <option value="contract">Contrato / Procuração</option>
                    <option value="regulation">Regulamento / Estatuto</option>
                    <option value="correspondence">Correspondência / Ata</option>
                    <option value="other">Outro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Categoria</label>
                  <select className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                    value={docForm.category} onChange={e => setDocForm(f => ({ ...f, category: e.target.value }))}>
                    <option value="documento_oficial">Documento Oficial</option>
                    <option value="minuta">Minuta</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-muted mb-1">Arquivo *</label>
                  <input required type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.png,.jpg,.jpeg"
                    className="text-sm text-slate-300"
                    onChange={e => setDocFile(e.target.files?.[0] || null)} />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" className="px-4 py-1.5 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border" onClick={() => setShowDocForm(false)}>Cancelar</button>
                <button type="submit" disabled={uploadingDoc || !docFile} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50">{uploadingDoc ? "Enviando..." : "Enviar"}</button>
              </div>
            </form>
          )}

          {confDocs.length === 0 && !showDocForm ? (
            <p className="text-muted text-sm text-center py-6">Nenhum documento cadastrado.</p>
          ) : (
            <div className="space-y-2">
              {confDocs.map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between p-3 bg-surface rounded-lg border border-surface-border">
                  <div>
                    <p className="text-sm text-white font-medium">{doc.title}</p>
                    <div className="flex gap-2 mt-0.5">
                      <span className="text-xs text-muted capitalize">{doc.document_type}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${doc.category === "minuta" ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                        {doc.category === "minuta" ? "Minuta" : "Doc. Oficial"}
                      </span>
                      {doc.file_size && <span className="text-xs text-muted">{Math.round(doc.file_size / 1024)} KB</span>}
                    </div>
                  </div>
                  <button onClick={() => handleDownloadDoc(doc.id, doc.file_name)}
                    className="px-3 py-1.5 text-xs text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors">
                    Baixar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      )}

      {/* TAB 2: RECEITAS POR MÊS */}
      {tab === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="text-sm text-muted">Mês de referência:</label>
            <input type="month" value={filterMonth.slice(0, 7)}
              onChange={e => setFilterMonth(e.target.value + "-01")}
              className="bg-surface-border border border-surface-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary" />
            <span className="text-sm text-muted capitalize">{displayMonth}</span>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div className="card text-center"><p className="text-3xl font-bold text-success mb-1">{monthPaid}</p><p className="text-xs text-muted">Adimplentes</p></div>
            <div className="card text-center"><p className="text-3xl font-bold text-warning mb-1">{monthRptPend}</p><p className="text-xs text-muted">Pend. Relatório</p></div>
            <div className="card text-center"><p className="text-3xl font-bold text-danger mb-1">{monthOverdue}</p><p className="text-xs text-muted">Inadimplentes</p></div>
            <div className="card text-center"><p className="text-xl font-bold text-success mb-1">{formatCurrency(monthTotal)}</p><p className="text-xs text-muted">Recebido no Mês</p></div>
          </div>
          {loadingMonth ? <p className="text-muted text-sm">Carregando...</p> : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-surface">
                    <th className="table-th">Operador</th>
                    <th className="table-th">Valor Recebido</th>
                    <th className="table-th">Valor Devido (operador)</th>
                    <th className="table-th">Status</th>
                    <th className="table-th">Relatório</th>
                    <th className="table-th">Mês Competência</th>
                    <th className="table-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {monthPayments.length === 0 && <tr><td colSpan={7} className="table-td text-center text-muted py-8">Nenhum pagamento no mês selecionado.</td></tr>}
                  {monthPayments.map(p => {
                    const op = opMap[p.operator_id];
                    return (
                      <tr key={p.id} className="border-b border-surface-border/50 hover:bg-surface-border/30">
                        <td className="table-td text-white">{op?.fantasy_name || op?.company_name || ("#" + p.operator_id)}</td>
                        <td className="table-td">{formatCurrency(parseFloat(p.amount_paid || "0"))}</td>
                        <td className="table-td">{p.amount_due ? formatCurrency(parseFloat(p.amount_due)) : "—"}</td>
                        <td className="table-td"><StatusBadge status={p.status} /></td>
                        <td className="table-td">{p.report_received ? <span className="text-xs text-success">✓ Recebido</span> : <span className="text-xs text-warning">Pendente</span>}</td>
                        <td className="table-td text-muted text-xs">{p.report_reference_month ? new Date(p.report_reference_month + "T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : "—"}</td>
                        <td className="table-td text-right flex gap-1 justify-end">
                          {!p.report_received && p.amount_paid && (
                            <button onClick={() => { setReportModal({ payId: p.id }); setReportForm({ report_reference_month: "", report_notes: "" }); }}
                              className="px-2 py-1 text-xs bg-primary/15 text-primary border border-primary/30 rounded hover:bg-primary/25 transition-colors">Registrar Relat.</button>
                          )}
                          {p.report_file_url && (
                            <a href={API_URL + p.report_file_url} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs text-muted border border-surface-border rounded hover:bg-surface-border transition-colors">Ver arquivo</a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: REPASSES ENDR */}
      {tab === 3 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted">O ENDR faz um repasse único cobrindo múltiplas bets. Registre cada repasse recebido e indique as bets cobertas.</p>
            <button onClick={() => setShowEndrForm(true)} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors">+ Registrar Repasse</button>
          </div>
          {showEndrForm && (
            <div className="card space-y-4">
              <h4 className="font-semibold text-white">Novo Repasse ENDR</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-muted mb-1">Mês de Referência</label>
                  <input type="month" value={endrForm.reference_month.slice(0, 7)}
                    onChange={e => setEndrForm(f => ({ ...f, reference_month: e.target.value + "-01" }))}
                    className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Valor Recebido (R$)</label>
                  <input type="number" step="0.01" placeholder="0.00" value={endrForm.amount_received}
                    onChange={e => setEndrForm(f => ({ ...f, amount_received: e.target.value }))}
                    className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Data de Recebimento</label>
                  <input type="date" value={endrForm.received_date}
                    onChange={e => setEndrForm(f => ({ ...f, received_date: e.target.value }))}
                    className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-2">Bets que pagaram via ENDR neste mês</label>
                <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto p-2 bg-surface-border rounded-lg">
                  {operators.filter(o => o.status === "active").map(op => (
                    <label key={op.id} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={endrForm.operator_ids.includes(op.id)}
                        onChange={e => setEndrForm(f => ({ ...f, operator_ids: e.target.checked ? [...f.operator_ids, op.id] : f.operator_ids.filter(x => x !== op.id) }))} />
                      <span className="text-xs text-slate-300 truncate">{op.fantasy_name || op.company_name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted mt-1">{endrForm.operator_ids.length} bet(s) selecionada(s)</p>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Observações</label>
                <input value={endrForm.notes} onChange={e => setEndrForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowEndrForm(false)} className="px-4 py-2 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">Cancelar</button>
                <button onClick={saveEndr} disabled={savingEndr || !endrForm.amount_received || !endrForm.received_date}
                  className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors">{savingEndr ? "Salvando..." : "Registrar"}</button>
              </div>
            </div>
          )}
          {endrPayments.length === 0 && !showEndrForm && <p className="text-muted text-sm text-center py-8">Nenhum repasse ENDR registrado.</p>}
          {endrPayments.map(ep => (
            <div key={ep.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-white">
                    {new Date(ep.reference_month + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })} — {formatCurrency(parseFloat(ep.amount_received))}
                  </p>
                  <p className="text-xs text-muted mt-0.5">Recebido em {formatDate(ep.received_date)} · {ep.bet_links.length} bet(s)</p>
                </div>
                <div className="flex gap-2">
                  {ep.report_file_url
                    ? <a href={API_URL + ep.report_file_url} target="_blank" rel="noreferrer" className="px-3 py-1.5 text-xs text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors">Ver relatório</a>
                    : <label className="px-3 py-1.5 text-xs text-muted border border-surface-border rounded-lg hover:bg-surface-border cursor-pointer transition-colors">
                        Anexar relatório<input type="file" className="hidden" onChange={e => handleEndrFileUpload(ep.id, e)} />
                      </label>}
                  <button onClick={() => handleDeleteEndr(ep.id)} className="px-3 py-1.5 text-xs text-danger border border-danger/30 rounded-lg hover:bg-danger/10 transition-colors">Excluir</button>
                </div>
              </div>
              {ep.notes && <p className="text-xs text-muted mb-2">{ep.notes}</p>}
              <div className="flex flex-wrap gap-1.5">
                {ep.bet_links.map(bl => { const op = opMap[bl.operator_id]; return <span key={bl.id} className="px-2 py-0.5 text-xs bg-surface-border rounded text-slate-300">{op?.fantasy_name || op?.company_name || ("#" + bl.operator_id)}</span>; })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 4: REGRAS DE RATEIO */}
      {tab === 4 && (
        <div className="space-y-4">
          <div className="card bg-primary/5 border-primary/20">
            <p className="text-sm text-slate-300">
              O rateio <strong>não é um percentual fixo por bet</strong>. Conforme o regulamento, o valor é apurado
              <strong> pelo próprio agente operador</strong> (1ª fase de rateios) e depende do <strong>tipo de competição</strong>
              {" "}e da participação de integrantes do Sinesp, sendo apurado por partida. A matriz abaixo documenta como
              esta confederação redistribui as Contrapartidas recebidas aos beneficiários finais.
            </p>
            {conf.redistribution_deadline_days && (
              <p className="text-xs text-muted mt-2">Prazo para repasse aos beneficiários finais: <strong>{conf.redistribution_deadline_days} dias</strong> do recebimento.</p>
            )}
          </div>

          {/* Documento do Regulamento */}
          <div className="card">
            <h4 className="font-semibold text-white mb-3">Documento do Regulamento</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted mb-2">Arquivo do regulamento (upload)</p>
                {conf.regulation_file_url ? (
                  <div className="flex items-center gap-2">
                    <a href={API_URL + conf.regulation_file_url} target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 text-xs text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors">
                      Ver regulamento
                    </a>
                    <button onClick={() => regulationFileRef.current?.click()}
                      className="px-3 py-1.5 text-xs text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">
                      Substituir
                    </button>
                  </div>
                ) : (
                  <button onClick={() => regulationFileRef.current?.click()}
                    className="px-3 py-1.5 text-xs bg-surface-border border border-surface-border rounded-lg hover:bg-surface text-slate-300 transition-colors">
                    Enviar arquivo (PDF, DOCX...)
                  </button>
                )}
                <input ref={regulationFileRef} type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.png,.jpg" className="hidden" onChange={handleRegulationUpload} />
              </div>
              <div>
                <p className="text-xs text-muted mb-2">Link do regulamento online (DOU, site oficial etc.)</p>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-surface-border border border-surface-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
                    placeholder="https://..."
                    value={regulationOnlineUrl}
                    onChange={e => setRegulationOnlineUrl(e.target.value)}
                  />
                  <button onClick={handleSaveRegulationUrl} disabled={savingRegulationUrl}
                    className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors">
                    {savingRegulationUrl ? "..." : "Salvar"}
                  </button>
                </div>
                {conf.regulation_online_url && (
                  <a href={conf.regulation_online_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline mt-1 block truncate">
                    {conf.regulation_online_url}
                  </a>
                )}
              </div>
            </div>
          </div>

          {rules.length === 0 ? (
            <p className="text-muted text-sm text-center py-6">Nenhuma regra de rateio cadastrada.</p>
          ) : (
            <div className="space-y-3">
              {rules.map(r => (
                <div key={r.id} className="card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-white">{r.scenario_label}</h4>
                        {r.article_ref && <span className="px-2 py-0.5 text-xs bg-surface-border rounded text-muted">{r.article_ref}</span>}
                      </div>
                      {r.description && <p className="text-xs text-slate-400 mb-3">{r.description}</p>}
                      <div className="flex flex-wrap gap-2">
                        {r.is_equanime ? (
                          <span className="px-2.5 py-1 text-xs bg-warning/10 text-warning border border-warning/30 rounded">Rateio equânime entre participantes (variável)</span>
                        ) : (
                          <>
                            {r.confederation_pct && <span className="px-2.5 py-1 text-xs bg-primary/10 text-primary border border-primary/30 rounded">Confederação: {(parseFloat(r.confederation_pct) * 100).toFixed(0)}%</span>}
                            {r.athlete_pct && <span className="px-2.5 py-1 text-xs bg-success/10 text-success border border-success/30 rounded">Atleta(s): {(parseFloat(r.athlete_pct) * 100).toFixed(0)}%</span>}
                            {r.entity_pct && <span className="px-2.5 py-1 text-xs bg-blue-400/10 text-blue-400 border border-blue-400/30 rounded">Entidade/Clube: {(parseFloat(r.entity_pct) * 100).toFixed(0)}%</span>}
                            {r.federation_pct && <span className="px-2.5 py-1 text-xs bg-purple-400/10 text-purple-400 border border-purple-400/30 rounded">Federação Estadual: {(parseFloat(r.federation_pct) * 100).toFixed(0)}%</span>}
                          </>
                        )}
                      </div>
                    </div>
                    <button onClick={() => handleDeleteRule(r.id)}
                      className="px-2 py-1 text-xs text-danger border border-danger/30 rounded hover:bg-danger/10 transition-colors flex-shrink-0">Remover</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: Registrar Relatório */}
      {reportModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-card border border-surface-border rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-white">Registrar Relatório do Operador</h3>
            <p className="text-xs text-muted">O sistema mantém regime de caixa. Informe aqui o mês de competência declarado no relatório recebido.</p>
            <div>
              <label className="block text-xs text-muted mb-1">Mês de Competência (do relatório)</label>
              <input type="month" value={reportForm.report_reference_month}
                onChange={e => setReportForm(f => ({ ...f, report_reference_month: e.target.value }))}
                className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Informações do Relatório</label>
              <textarea rows={3} value={reportForm.report_notes}
                onChange={e => setReportForm(f => ({ ...f, report_notes: e.target.value }))}
                placeholder="Informações relevantes do relatório recebido..."
                className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Anexar Relatório (opcional)</label>
              <input type="file" ref={reportFileRef} accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.png,.jpg" className="text-sm text-slate-300" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setReportModal(null)} className="px-4 py-2 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">Cancelar</button>
              <button onClick={saveReport} className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors">Registrar</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
