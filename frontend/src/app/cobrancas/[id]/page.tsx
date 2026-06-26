"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import {
  getCollection, getCollectionEvents, getPayments, getConfederation, getOperators,
  confirmPayment, declareValue, addCollectionEvent,
  getNotificationPreview, sendNotificationConfirmed, generateSpaLetter, downloadSpaLetter,
  getTemplates, getOffice, setPaymentStatus, registerPaymentReport, uploadPaymentReport,
  getCycleEmails, syncCycleEmails, getEmailProof, downloadCycleActivityPdf,
  suggestEmailOperator, linkEmailOperator,
} from "@/lib/api";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
function monthLabel(iso?: string) {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  return `${MESES[parseInt(m) - 1]} de ${y}`;
}
function monthShort(iso?: string) { if (!iso) return ""; const [y, m] = iso.split("-"); return `${String(m).padStart(2, "0")}/${y}`; }

const STATUS_LABELS: Record<string, string> = {
  paid: "Adimplente", report_pending: "Pago (aguarda relatório)", pending: "Pendente",
  overdue: "Inadimplente", partial: "Parcial", not_sports: "Não explora esporte", judicialized: "Judicializado",
};

export default function CollectionDetailPage() {
  const { id } = useParams();
  const numId = Number(id);
  const [cycle, setCycle] = useState<any>(null);
  const [conf, setConf] = useState<any>(null);
  const [office, setOffice] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);

  // Modais de pagamento
  const [showConfirm, setShowConfirm] = useState<any>(null);
  const [showDeclare, setShowDeclare] = useState<any>(null);
  const [showReport, setShowReport] = useState<any>(null);
  const [showPhone, setShowPhone] = useState<any>(null);
  const [showContact, setShowContact] = useState<any>(null);
  const [confirmForm, setConfirmForm] = useState({ amount_paid: "", payment_date: "", notes: "" });
  const [declareForm, setDeclareForm] = useState({ amount_due: "", base_calculo: "", notes: "" });
  const [reportForm, setReportForm] = useState({ report_reference_month: "", report_notes: "" });
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [phoneNotes, setPhoneNotes] = useState("");

  // Fluxo de revisão de notificação
  const [review, setReview] = useState<any>(null);
  const [reviewStage, setReviewStage] = useState<"edit" | "confirm" | "result">("edit");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<any>(null);
  const [proof, setProof] = useState<any>(null);

  // Ofício à SPA
  const [spaModal, setSpaModal] = useState(false);
  const [spaForm, setSpaForm] = useState({ city: "Rio de Janeiro", first_notif_date: "", second_notif_date: "", spa_list_date: "", endr_list_date: "" });
  const [spaResult, setSpaResult] = useState<any>(null);
  const [spaBusy, setSpaBusy] = useState(false);

  // E-mails
  const [emails, setEmails] = useState<any[]>([]);
  const [emailStats, setEmailStats] = useState({ sent: 0, received: 0 });
  const [syncing, setSyncing] = useState(false);

  const fetchAll = () => {
    getCollection(numId).then(r => {
      setCycle(r.data);
      return getConfederation(r.data.confederation_id);
    }).then(r => setConf(r.data));
    Promise.all([
      getCollectionEvents(numId),
      getPayments({ cycle_id: numId, limit: 300 }),
      getOperators({ limit: 300 }),
      getTemplates(),
      getOffice(),
    ]).then(([ev, pays, ops, tmpls, off]) => {
      setEvents(ev.data);
      setPayments(pays.data);
      setOperators(ops.data);
      setTemplates(tmpls.data);
      setOffice(off.data);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { fetchAll(); }, [numId]);

  function loadEmails() {
    getCycleEmails(numId).then(r => { setEmails(r.data.emails); setEmailStats({ sent: r.data.sent, received: r.data.received }); }).catch(() => {});
  }
  useEffect(() => { if (tab === 1) loadEmails(); }, [tab]);

  // ---------- Revisão de notificação ----------
  async function openReview(num: number) {
    setReviewLoading(true);
    setReviewStage("edit");
    setSendResult(null);
    try {
      const r = await getNotificationPreview(numId, num);
      const included = new Set<number>(r.data.recipients.map((x: any) => x.operator_id));
      setReview({ ...r.data, included, deadline_text: `${r.data.deadline_days} (dias) — vencimento em ${r.data.deadline}`, template_id: "" });
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao carregar pré-visualização");
    } finally { setReviewLoading(false); }
  }

  function changeNotifNumber(num: number) { openReview(num); }

  function applyTemplate(tid: string) {
    if (!tid) { setReview((rv: any) => ({ ...rv, template_id: "" })); return; }
    const t = templates.find(x => String(x.id) === tid);
    if (t) setReview((rv: any) => ({ ...rv, template_id: tid, message: { subject: t.subject, body: t.body } }));
  }

  function toggleInclude(opId: number) {
    setReview((rv: any) => {
      const s = new Set<number>(rv.included);
      if (s.has(opId)) s.delete(opId); else s.add(opId);
      return { ...rv, included: s };
    });
  }

  // Pré-visualização preenchida (exemplo com o primeiro destinatário incluído)
  function renderPreview(text: string) {
    if (!text || !review) return "";
    const all = [...review.recipients, ...review.paid, ...review.endr];
    const sample = all.find((o: any) => review.included.has(o.operator_id)) || all[0];
    const betName = sample?.label || "[Agente Operador]";
    const [mes, ano] = (review.reference_month || "/").split("/");
    return text
      .replace(/\{bet\}/g, betName)
      .replace(/\{confederacao\}/g, conf?.name || "")
      .replace(/\{confederacaosigla\}/g, conf?.acronym || "")
      .replace(/\{mes\}/g, mes || "")
      .replace(/\{ano\}/g, ano || "")
      .replace(/\{prazo\}/g, review.deadline_text || "10 (dez) dias")
      .replace(/\{valor\}/g, "valor a ser apurado pelo agente operador")
      .replace(/\{escritorio\}/g, office?.signature_name || office?.name || "Escritório");
  }

  const includedRecipients = () => {
    if (!review) return [];
    const all = [...review.recipients, ...review.paid, ...review.endr];
    return all.filter((o: any) => review.included.has(o.operator_id));
  };

  async function doSend() {
    const recipients = includedRecipients().map((o: any) => ({ operator_id: o.operator_id, email: o.emails?.[0] || null }));
    if (recipients.length === 0) { alert("Selecione ao menos um destinatário."); return; }
    setSending(true);
    try {
      const r = await sendNotificationConfirmed(numId, {
        notification_number: review.notification_number,
        subject: review.message.subject,
        body: review.message.body,
        deadline: review.deadline_text,
        recipients,
      });
      setSendResult(r.data);
      setReviewStage("result");
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao enviar");
    } finally { setSending(false); }
  }

  async function openProof(emailId: number) {
    try { const r = await getEmailProof(numId, emailId); setProof(r.data); }
    catch { alert("Comprovante indisponível."); }
  }

  // ---------- Ofício SPA ----------
  async function handleGenerateSpa() {
    setSpaBusy(true);
    try {
      const prev = await getNotificationPreview(numId, 2);
      const ids = prev.data.recipients.map((x: any) => x.operator_id);
      if (ids.length === 0) { alert("Não há operadores inadimplentes para o ofício."); setSpaBusy(false); return; }
      const r = await generateSpaLetter(numId, { inadimplente_operator_ids: ids, ...spaForm });
      setSpaResult(r.data);
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao gerar minuta");
    } finally { setSpaBusy(false); }
  }
  async function handleDownloadSpa() {
    try {
      const r = await downloadSpaLetter(numId, spaResult.document_id);
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      const a = document.createElement("a"); a.href = url; a.download = spaResult.file_name || "oficio_spa.docx"; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("Erro ao baixar a minuta."); }
  }

  // ---------- Pagamentos ----------
  async function handleConfirmPayment(e: React.FormEvent) {
    e.preventDefault();
    try {
      await confirmPayment(showConfirm.id, { amount_paid: parseFloat(confirmForm.amount_paid), payment_date: confirmForm.payment_date, notes: confirmForm.notes });
      setShowConfirm(null); fetchAll();
    } catch (err: any) { alert(err.response?.data?.detail || "Erro"); }
  }
  async function handleDeclareValue(e: React.FormEvent) {
    e.preventDefault();
    try {
      await declareValue(showDeclare.id, { amount_due: parseFloat(declareForm.amount_due), base_calculo: declareForm.base_calculo ? parseFloat(declareForm.base_calculo) : null, notes: declareForm.notes });
      setShowDeclare(null); fetchAll();
    } catch (err: any) { alert(err.response?.data?.detail || "Erro"); }
  }
  async function handleSaveReport(e: React.FormEvent) {
    e.preventDefault();
    try {
      await registerPaymentReport(showReport.id, {
        report_reference_month: reportForm.report_reference_month ? reportForm.report_reference_month + "-01" : null,
        report_notes: reportForm.report_notes,
      });
      if (reportFile) { const fd = new FormData(); fd.append("file", reportFile); await uploadPaymentReport(showReport.id, fd); }
      setShowReport(null); setReportFile(null); fetchAll();
    } catch (err: any) { alert(err.response?.data?.detail || "Erro ao registrar relatório"); }
  }
  async function handlePhone(e: React.FormEvent) {
    e.preventDefault();
    try {
      await addCollectionEvent(numId, { operator_id: showPhone.operator_id, event_type: "phone_contact", channel: "phone", notes: phoneNotes });
      setShowPhone(null); setPhoneNotes(""); fetchAll();
    } catch (err: any) { alert(err.response?.data?.detail || "Erro ao registrar contato"); }
  }
  async function changeStatus(p: any, status: string) {
    const labels: Record<string, string> = { not_sports: "não explora esporte", judicialized: "judicializado", pending: "pendente" };
    if (!confirm(`Marcar ${opName(p.operator_id)} como "${labels[status]}"?`)) return;
    try { await setPaymentStatus(p.id, { status }); fetchAll(); }
    catch (err: any) { alert(err.response?.data?.detail || "Erro"); }
  }

  // ---------- E-mails ----------
  async function doSyncEmails() {
    setSyncing(true);
    try {
      const r = await syncCycleEmails(numId);
      if (!r.data.configured) alert("Integração de e-mail (M365) não configurada no .env.");
      loadEmails();
    } catch { alert("Erro ao sincronizar e-mails."); }
    finally { setSyncing(false); }
  }

  async function downloadActivity() {
    try {
      const r = await downloadCycleActivityPdf(numId);
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = `atividades_${conf?.acronym}_${monthShort(cycle?.reference_month).replace("/", "_")}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("Erro ao gerar relatório de atividades."); }
  }

  const opName = (opId: number) => { const o = operators.find(x => x.id === opId); return o?.fantasy_name || o?.company_name || `#${opId}`; };

  if (loading) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;

  // Resumo com quantidade + percentual
  const total = payments.length;
  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;
  const cnt = (s: string) => payments.filter(p => p.status === s).length;
  const paid = cnt("paid"); const reportPending = cnt("report_pending");
  const adimplentes = paid + reportPending;
  const inadimplentes = cnt("overdue"); const pendentes = cnt("pending");
  const notSports = cnt("not_sports"); const judicial = cnt("judicialized");
  const rate = pct(adimplentes);

  const summaryBoxes = [
    { label: "Adimplência", value: `${rate}%`, sub: `${adimplentes} de ${total}`, color: rate >= 70 ? "success" : rate >= 40 ? "warning" : "danger" },
    { label: "Adimplentes", value: adimplentes, sub: `${pct(adimplentes)}%`, color: "success" },
    { label: "Pend. Relatório", value: reportPending, sub: `${pct(reportPending)}%`, color: "warning" },
    { label: "Inadimplentes", value: inadimplentes, sub: `${pct(inadimplentes)}%`, color: "danger" },
    { label: "Pendentes", value: pendentes, sub: `${pct(pendentes)}%`, color: "muted" },
    { label: "Não explora esp.", value: notSports, sub: `${pct(notSports)}%`, color: "muted" },
    { label: "Judicializados", value: judicial, sub: `${pct(judicial)}%`, color: "muted" },
  ];
  const colorClass: Record<string, string> = {
    success: "text-success", warning: "text-warning", danger: "text-danger", muted: "text-slate-300",
  };

  const flowSteps = [
    { day: conf?.payment_due_day ?? 10, label: "Vencimento", desc: "Vencimento dos repasses" },
    { day: conf?.first_notification_day ?? 12, label: "1ª Notificação", desc: `Prazo: ${conf?.first_notification_deadline_days ?? 10} dias` },
    { day: conf?.second_notification_day ?? 22, label: "2ª Notificação", desc: `Prazo: ${conf?.second_notification_deadline_days ?? 8} dias` },
    { day: conf?.closing_day ?? 1, label: "Fechamento", desc: "Ofício à SPA" },
  ];

  return (
    <AppShell>
      <Header
        title={`Ciclo #${numId} — ${conf?.acronym || ""}`}
        subtitle={`${conf?.name} · Competência: ${monthLabel(cycle?.reference_month)}`}
        actions={
          <>
            <Badge status={cycle?.status || ""} />
            <button onClick={() => openReview(1)} disabled={reviewLoading} className="btn-secondary">Preparar Notificação</button>
            <button onClick={downloadActivity} className="btn-secondary">Relatório de Atividades</button>
            <button onClick={() => { setSpaResult(null); setSpaModal(true); }} className="btn-primary">Gerar Ofício SPA</button>
          </>
        }
      />

      {/* Fluxo */}
      <div className="card mb-6">
        <h3 className="font-semibold text-white mb-4">Fluxo de Cobrança <span className="text-xs text-muted font-normal">(configurável no cadastro da confederação)</span></h3>
        <div className="flex items-center gap-0 overflow-x-auto">
          {flowSteps.map((step, i) => (
            <div key={i} className="flex items-center flex-shrink-0">
              <div className="text-center w-36">
                <div className="w-10 h-10 rounded-full bg-primary/15 border-2 border-primary/30 flex items-center justify-center mx-auto mb-2">
                  <span className="text-xs font-bold text-primary">Dia {step.day}</span>
                </div>
                <p className="text-xs font-semibold text-white">{step.label}</p>
                <p className="text-xs text-muted mt-0.5">{step.desc}</p>
              </div>
              {i < flowSteps.length - 1 && <div className="h-0.5 bg-surface-border flex-shrink-0 w-4 mx-1" />}
            </div>
          ))}
        </div>
      </div>

      {/* Resumo: quantidade + percentual juntos */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {summaryBoxes.map((b, i) => (
          <div key={i} className="card text-center py-3">
            <p className={`text-2xl font-bold ${colorClass[b.color]}`}>{b.value}</p>
            <p className="text-xs text-muted mt-0.5">{b.label}</p>
            <p className="text-[11px] text-muted">{b.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-border mb-6">
        {["Pagamentos", `Comunicações (${emailStats.sent + emailStats.received || ""})`, `Linha do Tempo (${events.length})`].map((t, i) => (
          <button key={i} onClick={() => setTab(i)}
            className={"px-4 py-2.5 text-sm font-medium border-b-2 transition-colors " + (tab === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-slate-200")}>
            {t}
          </button>
        ))}
      </div>

      {/* TAB 0 — Pagamentos */}
      {tab === 0 && (
        <div className="card p-0 overflow-hidden mb-6">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="table-th">Operador</th>
                <th className="table-th">Valor Devido</th>
                <th className="table-th">Recebido</th>
                <th className="table-th">Relatório</th>
                <th className="table-th">Situação</th>
                <th className="table-th">Ações</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => {
                const receipts = p.receipts || [];
                return (
                  <tr key={p.id} className="hover:bg-surface-light/20 align-top">
                    <td className="table-td font-medium text-white">{opName(p.operator_id)}</td>
                    <td className="table-td">{p.amount_due ? formatCurrency(p.amount_due) : <span className="text-muted">—</span>}</td>
                    <td className="table-td">
                      {p.amount_paid ? formatCurrency(p.amount_paid) : <span className="text-muted">—</span>}
                      {receipts.length > 1 && <span className="text-[11px] text-muted block">{receipts.length} repasses</span>}
                    </td>
                    <td className="table-td">{p.report_received ? <span className="text-xs text-success">✓ recebido</span> : <span className="text-xs text-muted">—</span>}</td>
                    <td className="table-td"><Badge status={p.status} /></td>
                    <td className="table-td">
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        <button onClick={() => { setShowDeclare(p); setDeclareForm({ amount_due: "", base_calculo: "", notes: "" }); }} className="text-xs text-blue-400 hover:underline">Valor devido</button>
                        <button onClick={() => { setShowConfirm(p); setConfirmForm({ amount_paid: "", payment_date: new Date().toISOString().slice(0, 10), notes: "" }); }} className="text-xs text-success hover:underline">Repasse recebido</button>
                        <button onClick={() => { setShowReport(p); setReportForm({ report_reference_month: (cycle?.reference_month || "").slice(0, 7), report_notes: "" }); setReportFile(null); }} className="text-xs text-amber-400 hover:underline">Relatório</button>
                        <button onClick={() => setShowContact(operators.find(o => o.id === p.operator_id))} className="text-xs text-purple-300 hover:underline">Contatar</button>
                        <StatusMenu p={p} onChange={changeStatus} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 1 — Comunicações (e-mails) */}
      {tab === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">E-mails de cobrança enviados por este ciclo e respostas conciliadas. {emailStats.sent} enviados · {emailStats.received} recebidos.</p>
            <button onClick={doSyncEmails} disabled={syncing} className="btn-primary">{syncing ? "Sincronizando..." : "Sincronizar Caixa de Entrada"}</button>
          </div>
          <CycleEmailQueue emails={emails.filter(e => e.direction === "inbound" && !e.matched)} operators={operators} onLinked={loadEmails} />
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface"><tr>
                <th className="table-th">Tipo</th><th className="table-th">Data</th><th className="table-th">Bet</th>
                <th className="table-th">Assunto</th><th className="table-th">Endereço</th><th className="table-th"></th>
              </tr></thead>
              <tbody>
                {emails.map(e => (
                  <tr key={e.id} className="border-b border-surface-border/50">
                    <td className="table-td">{e.direction === "outbound" ? <span className="text-xs text-blue-300">Enviado</span> : <span className="text-xs text-success">Recebido</span>}</td>
                    <td className="table-td text-muted text-xs">{e.sent_at ? formatDate(e.sent_at) : e.received_at ? formatDate(e.received_at) : "—"}</td>
                    <td className="table-td text-xs">{e.operator_label || "—"}</td>
                    <td className="table-td">{e.subject || "(sem assunto)"}</td>
                    <td className="table-td text-xs text-muted">{e.direction === "outbound" ? e.to_addr : e.from_addr}</td>
                    <td className="table-td">{e.direction === "outbound" && <button onClick={() => openProof(e.id)} className="text-xs text-primary hover:underline">Comprovante</button>}</td>
                  </tr>
                ))}
                {emails.length === 0 && <tr><td colSpan={6} className="table-td text-center text-muted py-8">Nenhum e-mail vinculado a este ciclo ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2 — Linha do tempo */}
      {tab === 2 && (
        <div className="card p-0 overflow-hidden">
          <div className="divide-y divide-surface-border">
            {events.length === 0 ? <p className="p-4 text-muted text-sm">Nenhum evento registrado</p> : events.map(ev => (
              <div key={ev.id} className="p-4 flex items-start gap-4">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-white">
                    <span className="font-medium">{opName(ev.operator_id)}</span>{" — "}
                    <code className="text-xs bg-surface px-1.5 py-0.5 rounded">{ev.event_type}</code>{" via "}
                    <span className="text-muted">{ev.channel}</span>
                  </p>
                  {ev.notes && <p className="text-xs text-muted mt-1">{ev.notes}</p>}
                  <p className="text-xs text-muted mt-1">{formatDateTime(ev.performed_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== Revisão de Notificação ===== */}
      {review && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-card border border-surface-border rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-surface-border flex items-center justify-between sticky top-0 bg-surface-card z-10">
              <div>
                <h3 className="font-semibold text-white">Preparar Notificação — {conf?.acronym} · {monthLabel(cycle?.reference_month)}</h3>
                <p className="text-xs text-muted">Revise os destinatários e a mensagem antes de disparar.</p>
              </div>
              <button onClick={() => setReview(null)} className="text-muted hover:text-white text-xl">×</button>
            </div>

            {/* ETAPA EDIÇÃO */}
            {reviewStage === "edit" && (
              <>
                <div className="p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="label">Tipo de notificação</label>
                      <select className="input" value={review.notification_number} onChange={e => changeNotifNumber(Number(e.target.value))}>
                        <option value={1}>1ª Notificação</option>
                        <option value={2}>2ª Notificação</option>
                        <option value={3}>3ª Notificação (final)</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Modelo de cobrança</label>
                      <select className="input" value={review.template_id} onChange={e => applyTemplate(e.target.value)}>
                        <option value="">— Padrão do sistema —</option>
                        {templates.filter(t => !t.confederation_id || t.confederation_id === conf?.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Prazo concedido</label>
                      <input className="input" value={review.deadline_text} onChange={e => setReview((rv: any) => ({ ...rv, deadline_text: e.target.value }))} />
                    </div>
                  </div>

                  {/* Resumo */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-success">{review.paid.length}</p><p className="text-xs text-muted">Já pagaram</p></div>
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-blue-400">{review.endr.length}</p><p className="text-xs text-muted">ENDR (suspensos)</p></div>
                    <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-warning">{includedRecipients().length}</p><p className="text-xs text-muted">Vão receber</p></div>
                  </div>

                  {/* Destinatários */}
                  <div>
                    <h4 className="text-sm font-semibold text-white mb-2">Destinatários (pré-selecionados)</h4>
                    <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-52 overflow-y-auto">
                      {review.recipients.map((o: any) => (
                        <label key={o.operator_id} className="flex items-center gap-3 p-2.5 hover:bg-surface-light/20 cursor-pointer">
                          <input type="checkbox" checked={review.included.has(o.operator_id)} onChange={() => toggleInclude(o.operator_id)} />
                          <span className="text-sm text-white flex-1">{o.label}</span>
                          <span className={`text-xs ${o.emails?.length ? "text-muted" : "text-danger"}`}>{o.emails?.[0] || "sem e-mail"}</span>
                        </label>
                      ))}
                      {review.recipients.length === 0 && <p className="p-3 text-xs text-muted">Nenhum operador pendente.</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-semibold text-white mb-2">Já pagaram <span className="text-muted font-normal">(incluir?)</span></h4>
                      <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-36 overflow-y-auto">
                        {review.paid.map((o: any) => (
                          <label key={o.operator_id} className="flex items-center gap-2 p-2 text-xs hover:bg-surface-light/20 cursor-pointer">
                            <input type="checkbox" checked={review.included.has(o.operator_id)} onChange={() => toggleInclude(o.operator_id)} />
                            <span className="text-slate-300 flex-1">{o.label}</span>
                          </label>
                        ))}
                        {review.paid.length === 0 && <p className="p-2 text-xs text-muted">—</p>}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white mb-2">ENDR <span className="text-muted font-normal">(suspensos)</span></h4>
                      <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-36 overflow-y-auto">
                        {review.endr.map((o: any) => (
                          <label key={o.operator_id} className="flex items-center gap-2 p-2 text-xs hover:bg-surface-light/20 cursor-pointer">
                            <input type="checkbox" checked={review.included.has(o.operator_id)} onChange={() => toggleInclude(o.operator_id)} />
                            <span className="text-slate-300 flex-1">{o.label}</span>
                          </label>
                        ))}
                        {review.endr.length === 0 && <p className="p-2 text-xs text-muted">—</p>}
                      </div>
                    </div>
                  </div>

                  {/* Mensagem editável */}
                  <div>
                    <h4 className="text-sm font-semibold text-white mb-2">Mensagem</h4>
                    <p className="text-xs text-muted mb-2">Chaves ({"{bet}"}, {"{confederacaosigla}"}, {"{mes}"}, {"{ano}"}, {"{prazo}"}, {"{escritorio}"}) são preenchidas automaticamente.</p>
                    <input className="input mb-2" value={review.message.subject} onChange={e => setReview((rv: any) => ({ ...rv, message: { ...rv.message, subject: e.target.value } }))} />
                    <textarea className="input h-40 resize-none text-sm" value={review.message.body} onChange={e => setReview((rv: any) => ({ ...rv, message: { ...rv.message, body: e.target.value } }))} />
                  </div>

                  {/* Pré-visualização preenchida */}
                  <div>
                    <h4 className="text-sm font-semibold text-white mb-2">Pré-visualização (exemplo preenchido)</h4>
                    <div className="border border-surface-border rounded-lg p-4 bg-surface text-sm">
                      <p className="text-xs text-muted mb-1">Assunto:</p>
                      <p className="text-white font-medium mb-3">{renderPreview(review.message.subject)}</p>
                      <p className="text-xs text-muted mb-1">Corpo:</p>
                      <p className="text-slate-200 whitespace-pre-line">{renderPreview(review.message.body)}</p>
                    </div>
                  </div>
                </div>
                <div className="p-5 border-t border-surface-border flex gap-3 justify-end sticky bottom-0 bg-surface-card">
                  <button onClick={() => setReview(null)} className="btn-secondary">Cancelar</button>
                  <button onClick={() => setReviewStage("confirm")} className="btn-primary">Revisar envio →</button>
                </div>
              </>
            )}

            {/* ETAPA CONFIRMAÇÃO */}
            {reviewStage === "confirm" && (
              <div className="p-6 space-y-5">
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                  <p className="text-warning font-semibold text-sm mb-1">⚠ Atenção — disparo de e-mails</p>
                  <p className="text-sm text-slate-200">Ao confirmar, o sistema enviará imediatamente a <b>{review.notification_number}ª notificação</b> para <b>{includedRecipients().length}</b> agente(s) operador(es). Esta ação não pode ser desfeita.</p>
                </div>
                <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-60 overflow-y-auto">
                  {includedRecipients().map((o: any) => (
                    <div key={o.operator_id} className="flex items-center justify-between p-2.5 text-sm">
                      <span className="text-white">{o.label}</span>
                      <span className={`text-xs ${o.emails?.length ? "text-muted" : "text-danger"}`}>{o.emails?.[0] || "sem e-mail — não receberá"}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => setReviewStage("edit")} className="btn-secondary">← Voltar e editar</button>
                  <button onClick={doSend} disabled={sending} className="btn-primary">{sending ? "Disparando..." : `Confirmar disparo (${includedRecipients().length})`}</button>
                </div>
              </div>
            )}

            {/* ETAPA RESULTADO — extrato de envio */}
            {reviewStage === "result" && sendResult && (
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-success">{sendResult.sent}</p><p className="text-xs text-muted">Enviados</p></div>
                  <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-danger">{sendResult.failed}</p><p className="text-xs text-muted">Falhas</p></div>
                  <div className="bg-surface border border-surface-border rounded-lg p-3 text-center"><p className="text-2xl font-bold text-white">{sendResult.total}</p><p className="text-xs text-muted">Total</p></div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white mb-2">Extrato de envio</h4>
                  <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-72 overflow-y-auto">
                    {sendResult.results?.map((r: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2.5 text-sm">
                        <div>
                          <span className="text-white">{r.label}</span>
                          <span className="text-xs text-muted ml-2">{r.email || "—"}</span>
                          {!r.ok && r.reason && <span className="text-xs text-danger block">{r.reason}</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          {r.ok ? <span className="text-xs text-success">✓ enviado</span> : <span className="text-xs text-danger">✗ falhou</span>}
                          {r.ok && r.email_id && <button onClick={() => openProof(r.email_id)} className="text-xs text-primary hover:underline">Comprovante</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end"><button onClick={() => setReview(null)} className="btn-primary">Concluir</button></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Comprovante de envio */}
      <Modal isOpen={!!proof} onClose={() => setProof(null)} title="Comprovante de Envio">
        {proof && (
          <div className="space-y-3 text-sm">
            <div className="border border-surface-border rounded-lg p-4 bg-surface space-y-1">
              {proof.protocol && <p><span className="text-muted">Protocolo:</span> <span className="text-primary font-mono font-semibold">{proof.protocol}</span></p>}
              <p><span className="text-muted">Agente Operador:</span> <span className="text-white">{proof.operator}</span></p>
              <p><span className="text-muted">Confederação:</span> <span className="text-white">{proof.confederation}</span></p>
              <p><span className="text-muted">Competência:</span> <span className="text-white">{proof.reference_month}</span></p>
              <p><span className="text-muted">Enviado para:</span> <span className="text-white">{proof.to_addr}</span></p>
              <p><span className="text-muted">Data/Hora:</span> <span className="text-white">{proof.sent_at ? formatDateTime(proof.sent_at) : "—"}</span></p>
              <p><span className="text-muted">Assunto:</span> <span className="text-white">{proof.subject}</span></p>
            </div>
            <div>
              <p className="text-xs text-muted mb-1">Conteúdo enviado:</p>
              <div className="border border-surface-border rounded-lg p-3 bg-surface text-slate-200 whitespace-pre-line text-xs max-h-60 overflow-y-auto">{proof.body}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => window.print()} className="btn-secondary">Imprimir</button>
              <button onClick={() => setProof(null)} className="btn-primary">Fechar</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Ofício à SPA */}
      <Modal isOpen={spaModal} onClose={() => setSpaModal(false)} title="Gerar Minuta — Ofício à SPA">
        {!spaResult ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">A minuta listará os operadores inadimplentes (não pagaram e não estão no ENDR).</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Cidade</label><input className="input" value={spaForm.city} onChange={e => setSpaForm(f => ({ ...f, city: e.target.value }))} /></div>
              <div><label className="label">Data da 1ª notificação</label><input className="input" placeholder="ex: 15/05" value={spaForm.first_notif_date} onChange={e => setSpaForm(f => ({ ...f, first_notif_date: e.target.value }))} /></div>
              <div><label className="label">Data da 2ª notificação</label><input className="input" placeholder="ex: 29/05" value={spaForm.second_notif_date} onChange={e => setSpaForm(f => ({ ...f, second_notif_date: e.target.value }))} /></div>
              <div><label className="label">Data da lista SPA</label><input className="input" placeholder="ex: 13/05/2026" value={spaForm.spa_list_date} onChange={e => setSpaForm(f => ({ ...f, spa_list_date: e.target.value }))} /></div>
              <div className="col-span-2"><label className="label">Data da lista ENDR</label><input className="input" placeholder="ex: 29/04/2026" value={spaForm.endr_list_date} onChange={e => setSpaForm(f => ({ ...f, endr_list_date: e.target.value }))} /></div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setSpaModal(false)} className="btn-secondary">Cancelar</button>
              <button onClick={handleGenerateSpa} disabled={spaBusy} className="btn-primary">{spaBusy ? "Gerando..." : "Gerar Minuta"}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-success/10 border border-success/30 text-success rounded-lg px-4 py-3 text-sm">Minuta gerada e arquivada como documento do ciclo.</div>
            <button onClick={handleDownloadSpa} className="btn-primary inline-block">⬇ Baixar minuta (.docx)</button>
            <div><label className="label">Pré-visualização do texto</label><textarea readOnly className="input h-80 resize-none text-xs font-mono" value={spaResult.text} /></div>
            <div className="flex justify-end"><button onClick={() => setSpaModal(false)} className="btn-secondary">Fechar</button></div>
          </div>
        )}
      </Modal>

      {/* Repasse recebido */}
      <Modal isOpen={!!showConfirm} onClose={() => setShowConfirm(null)} title="Registrar Repasse Recebido">
        <form onSubmit={handleConfirmPayment} className="space-y-4">
          <p className="text-sm text-muted">Cada repasse é registrado individualmente. Uma Bet pode repassar mais de uma vez no mesmo mês.</p>
          <div><label className="label">Valor do Repasse (R$) *</label><input type="number" step="0.01" className="input" placeholder="0,00" required value={confirmForm.amount_paid} onChange={e => setConfirmForm(f => ({ ...f, amount_paid: e.target.value }))} /></div>
          <div><label className="label">Data do Pagamento *</label><input type="date" className="input" required value={confirmForm.payment_date} onChange={e => setConfirmForm(f => ({ ...f, payment_date: e.target.value }))} /></div>
          <div><label className="label">Observações</label><textarea className="input h-20 resize-none" value={confirmForm.notes} onChange={e => setConfirmForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3 justify-end"><button type="button" onClick={() => setShowConfirm(null)} className="btn-secondary">Cancelar</button><button type="submit" className="btn-primary">Registrar Repasse</button></div>
        </form>
      </Modal>

      {/* Valor devido */}
      <Modal isOpen={!!showDeclare} onClose={() => setShowDeclare(null)} title="Registrar Valor Devido">
        <form onSubmit={handleDeclareValue} className="space-y-4">
          <p className="text-sm text-muted">O valor é apurado pelo próprio agente operador e informado no relatório. O escritório apenas registra o que foi informado.</p>
          <div><label className="label">Valor Devido informado pelo operador (R$) *</label><input type="number" step="0.01" className="input" placeholder="0,00" required value={declareForm.amount_due} onChange={e => setDeclareForm(f => ({ ...f, amount_due: e.target.value }))} /></div>
          <div><label className="label">Base de Cálculo (R$) <span className="text-muted">(opcional)</span></label><input type="number" step="0.01" className="input" placeholder="0,00" value={declareForm.base_calculo} onChange={e => setDeclareForm(f => ({ ...f, base_calculo: e.target.value }))} /></div>
          <div><label className="label">Observações</label><textarea className="input h-16 resize-none" value={declareForm.notes} onChange={e => setDeclareForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3 justify-end"><button type="button" onClick={() => setShowDeclare(null)} className="btn-secondary">Cancelar</button><button type="submit" className="btn-primary">Registrar</button></div>
        </form>
      </Modal>

      {/* Relatório (com upload) */}
      <Modal isOpen={!!showReport} onClose={() => setShowReport(null)} title="Registrar Relatório de GGR">
        <form onSubmit={handleSaveReport} className="space-y-4">
          <p className="text-sm text-muted">Registre o recebimento do relatório de apuração (GGR) e anexe o documento.</p>
          <div><label className="label">Mês de competência do relatório</label><input type="month" className="input" value={reportForm.report_reference_month} onChange={e => setReportForm(f => ({ ...f, report_reference_month: e.target.value }))} /></div>
          <div><label className="label">Anexar documento</label><input type="file" accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.png,.jpg,.jpeg" className="input" onChange={e => setReportFile(e.target.files?.[0] || null)} /><p className="text-xs text-muted mt-1">PDF, Excel, CSV, Word ou imagem.</p></div>
          <div><label className="label">Observações</label><textarea className="input h-16 resize-none" value={reportForm.report_notes} onChange={e => setReportForm(f => ({ ...f, report_notes: e.target.value }))} /></div>
          <div className="flex gap-3 justify-end"><button type="button" onClick={() => setShowReport(null)} className="btn-secondary">Cancelar</button><button type="submit" className="btn-primary">Registrar Relatório</button></div>
        </form>
      </Modal>

      {/* Contato telefônico */}
      <Modal isOpen={!!showPhone} onClose={() => setShowPhone(null)} title="Registrar Contato Telefônico">
        <form onSubmit={handlePhone} className="space-y-4">
          <p className="text-sm text-muted">Registre o teor do contato com {showPhone ? opName(showPhone.operator_id) : ""}. Vários contatos podem ser registrados no mesmo mês.</p>
          <div><label className="label">Resumo do contato *</label><textarea className="input h-28 resize-none" required placeholder="Ex.: Falei com o financeiro; informaram que o repasse será feito até dia 20." value={phoneNotes} onChange={e => setPhoneNotes(e.target.value)} /></div>
          <div className="flex gap-3 justify-end"><button type="button" onClick={() => setShowPhone(null)} className="btn-secondary">Cancelar</button><button type="submit" className="btn-primary">Registrar Contato</button></div>
        </form>
      </Modal>

      {/* Contato multicanal */}
      {showContact && (
        <ContactModal
          operator={showContact} conf={conf} office={office} cycleId={numId}
          referenceMonth={monthShort(cycle?.reference_month)}
          onClose={() => setShowContact(null)}
          onLogged={() => fetchAll()}
        />
      )}
    </AppShell>
  );
}

/* Contato multicanal: e-mail, WhatsApp, telefone e redes sociais, com registro automático */
function ContactModal({ operator, conf, office, cycleId, referenceMonth, onClose, onLogged }: any) {
  const [logged, setLogged] = useState<string[]>([]);
  const sig = office?.signature_name || office?.name || "Escritório";
  const [mes, ano] = (referenceMonth || "/").split("/");
  const msg = `Prezados representantes de ${operator.fantasy_name || operator.company_name},\n\nReferente à contrapartida de direito de imagem (${conf?.acronym || ""}) da competência ${mes}/${ano}, solicitamos gentilmente a regularização do repasse e o envio do relatório de apuração.\n\nAtenciosamente,\n${sig}`;
  const subject = `${conf?.acronym || ""} - Contrapartida Direito de Imagem ${mes}/${ano}`;

  // Agrega canais disponíveis
  const emails: string[] = [];
  (operator.contacts || []).forEach((c: any) => { if (c.type === "email" && c.value) emails.push(c.value); });
  (operator.responsibles || []).forEach((r: any) => { if (r.email) emails.push(r.email); });
  const phones: { label: string; value: string }[] = [];
  (operator.contacts || []).forEach((c: any) => { if ((c.type === "phone" || c.type === "whatsapp") && c.value) phones.push({ label: c.label || c.type, value: c.value }); });
  (operator.responsibles || []).forEach((r: any) => { if (r.phone) phones.push({ label: r.role, value: r.phone }); });
  const socials: { label: string; url: string }[] = [];
  (operator.brands || []).forEach((b: any) => {
    if (b.instagram) socials.push({ label: `Instagram (${b.name})`, url: b.instagram.startsWith("http") ? b.instagram : `https://instagram.com/${b.instagram.replace("@", "")}` });
    if (b.facebook) socials.push({ label: `Facebook (${b.name})`, url: b.facebook });
    if (b.twitter) socials.push({ label: `X/Twitter (${b.name})`, url: b.twitter });
    if (b.website) socials.push({ label: `Site (${b.name})`, url: b.website.startsWith("http") ? b.website : `https://${b.website}` });
  });

  const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");
  function waLink(phone: string) {
    let d = onlyDigits(phone);
    if (d.length <= 11) d = "55" + d; // assume Brasil
    return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
  }

  async function log(channel: string, note: string) {
    try {
      const evMap: Record<string, { event_type: string; channel: string }> = {
        email: { event_type: "manual_note", channel: "email" },
        whatsapp: { event_type: "manual_note", channel: "whatsapp" },
        phone: { event_type: "phone_contact", channel: "phone" },
        social: { event_type: "manual_note", channel: "manual" },
      };
      const e = evMap[channel];
      await addCollectionEvent(cycleId, { operator_id: operator.id, event_type: e.event_type, channel: e.channel, notes: note });
      setLogged(l => [...l, channel + note]);
      onLogged();
    } catch { /* noop */ }
  }

  function copyMsg() { navigator.clipboard?.writeText(msg); }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Contatar — ${operator.fantasy_name || operator.company_name}`}>
      <div className="space-y-4">
        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted">Mensagem padrão (editável ao enviar)</p><button onClick={copyMsg} className="text-xs text-primary hover:underline">Copiar</button></div>
          <p className="text-xs text-slate-300 whitespace-pre-line">{msg}</p>
        </div>

        {/* E-mail */}
        <div>
          <p className="text-sm font-semibold text-white mb-1">E-mail</p>
          {emails.length === 0 ? <p className="text-xs text-muted">Nenhum e-mail cadastrado.</p> : (
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set(emails)).map((em, i) => (
                <a key={i} href={`mailto:${em}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`} onClick={() => log("email", `E-mail aberto para ${em}`)} className="text-xs bg-blue-500/10 text-blue-300 px-3 py-1.5 rounded-lg hover:bg-blue-500/20">✉ {em}</a>
              ))}
            </div>
          )}
        </div>

        {/* WhatsApp / Telefone */}
        <div>
          <p className="text-sm font-semibold text-white mb-1">WhatsApp e Telefone</p>
          {phones.length === 0 ? <p className="text-xs text-muted">Nenhum telefone cadastrado.</p> : (
            <div className="space-y-2">
              {phones.map((ph, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted w-28 truncate">{ph.label}: {ph.value}</span>
                  <a href={waLink(ph.value)} target="_blank" rel="noreferrer" onClick={() => log("whatsapp", `WhatsApp acionado (${ph.value})`)} className="text-xs bg-green-500/10 text-green-300 px-3 py-1.5 rounded-lg hover:bg-green-500/20">WhatsApp</a>
                  <a href={`tel:${onlyDigits(ph.value)}`} onClick={() => log("phone", `Ligação iniciada (${ph.value})`)} className="text-xs bg-purple-500/10 text-purple-300 px-3 py-1.5 rounded-lg hover:bg-purple-500/20">Ligar</a>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Redes sociais */}
        <div>
          <p className="text-sm font-semibold text-white mb-1">Redes sociais</p>
          {socials.length === 0 ? <p className="text-xs text-muted">Nenhuma rede cadastrada.</p> : (
            <div className="flex flex-wrap gap-2">
              {socials.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" onClick={() => log("social", `Acesso a ${s.label}`)} className="text-xs bg-surface-border text-slate-200 px-3 py-1.5 rounded-lg hover:bg-surface">{s.label}</a>
              ))}
            </div>
          )}
        </div>

        {logged.length > 0 && <p className="text-xs text-success">✓ {logged.length} contato(s) registrado(s) na linha do tempo do ciclo.</p>}
        <div className="flex justify-end"><button onClick={onClose} className="btn-secondary">Fechar</button></div>
      </div>
    </Modal>
  );
}

/* Menu de categorização de status */
function StatusMenu({ p, onChange }: { p: any; onChange: (p: any, status: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen(o => !o)} className="text-xs text-muted hover:text-slate-200">Categorizar ▾</button>
      {open && (
        <div className="absolute right-0 mt-1 bg-surface-card border border-surface-border rounded-lg shadow-lg z-20 w-48 py-1" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => { setOpen(false); onChange(p, "not_sports"); }} className="block w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-surface">Não explora esporte</button>
          <button onClick={() => { setOpen(false); onChange(p, "judicialized"); }} className="block w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-surface">Judicializado</button>
          {(p.status === "not_sports" || p.status === "judicialized") && (
            <button onClick={() => { setOpen(false); onChange(p, "pending"); }} className="block w-full text-left px-3 py-1.5 text-xs text-warning hover:bg-surface">Reverter p/ pendente</button>
          )}
        </div>
      )}
    </div>
  );
}

/* Fila de conciliação de e-mails não casados (dentro do ciclo) */
function CycleEmailQueue({ emails, operators, onLinked }: any) {
  const [suggestions, setSuggestions] = useState<Record<number, any>>({});
  const [sel, setSel] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  async function suggest(emailId: number) {
    setBusy(emailId);
    try { const r = await suggestEmailOperator(emailId); setSuggestions(s => ({ ...s, [emailId]: r.data })); if (r.data.operator_id) setSel(s => ({ ...s, [emailId]: String(r.data.operator_id) })); }
    catch { /* noop */ } finally { setBusy(null); }
  }
  async function link(emailId: number) {
    if (!sel[emailId]) return;
    setBusy(emailId);
    try { await linkEmailOperator(emailId, { operator_id: Number(sel[emailId]), add_as_contact: true }); onLinked(); }
    catch { /* noop */ } finally { setBusy(null); }
  }
  if (emails.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-white mb-2">Fila de conciliação <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded-full">{emails.length}</span></h4>
      <div className="space-y-2">
        {emails.map((e: any) => (
          <div key={e.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{e.subject || "(sem assunto)"}</p>
                <p className="text-xs text-muted">De: <span className="font-mono">{e.from_addr}</span></p>
              </div>
              <button onClick={() => suggest(e.id)} disabled={busy === e.id} className="btn-secondary text-xs whitespace-nowrap">{busy === e.id ? "..." : "✨ Sugerir IA"}</button>
            </div>
            {suggestions[e.id]?.operator_label && <p className="text-xs text-success mt-2">Sugestão: {suggestions[e.id].operator_label} ({suggestions[e.id].confidence})</p>}
            <div className="flex items-end gap-2 mt-2">
              <select className="input flex-1" value={sel[e.id] || ""} onChange={ev => setSel(s => ({ ...s, [e.id]: ev.target.value }))}>
                <option value="">Vincular ao operador...</option>
                {operators.map((o: any) => <option key={o.id} value={o.id}>{o.fantasy_name || o.company_name}</option>)}
              </select>
              <button onClick={() => link(e.id)} disabled={!sel[e.id] || busy === e.id} className="btn-primary text-sm">Vincular</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
