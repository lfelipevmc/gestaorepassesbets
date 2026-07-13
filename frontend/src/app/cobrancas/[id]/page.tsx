"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import {
  getCollection, getCollectionEvents, getConfederation, getOperators,
  getCycleBoard, registerCycleReceipt, uploadCycleReceiptReport, archiveCycle,
  getNotificationPreview, sendNotificationConfirmed, generateSpaLetter, downloadSpaLetter,
  getTemplates, getOffice, addCollectionEvent,
  getCycleEmails, syncCycleEmails, getEmailProof, downloadCycleActivityPdf,
  suggestEmailOperator, linkEmailOperator,
} from "@/lib/api";
import { getUser } from "@/lib/auth";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";
import { toast } from "@/components/ui/Toast";
import HelpTip from "@/components/ui/HelpTip";
import MailboxBadge from "@/components/ui/MailboxBadge";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
function monthLabel(iso?: string) {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  return `${MESES[parseInt(m) - 1]} de ${y}`;
}
function monthShort(iso?: string) { if (!iso) return ""; const [y, m] = iso.split("-"); return `${String(m).padStart(2, "0")}/${y}`; }

/* Paleta de STATUS (semântica de estado — sempre acompanhada de rótulo textual):
   adimplente=verde, inadimplente=vermelho, ENDR=azul (informacional, distinto do
   verde de "pago"), consignação=âmbar, sem obrigação=cinza. */
const CONC: Record<string, { label: string; short: string; cls: string; dot: string; bar: string }> = {
  adimplente:    { label: "Adimplente", short: "Adimplentes", cls: "text-success bg-success/10 border-success/30", dot: "bg-success", bar: "#22c55e" },
  inadimplente:  { label: "Inadimplente", short: "Inadimplentes", cls: "text-danger bg-danger/10 border-danger/30", dot: "bg-danger", bar: "#ef4444" },
  endr:          { label: "ENDR", short: "ENDR", cls: "text-blue-300 bg-blue-500/10 border-blue-500/30", dot: "bg-blue-400", bar: "#3b82f6" },
  consignacao:   { label: "Consignação em Pagamento", short: "Consignação", cls: "text-warning bg-warning/10 border-warning/30", dot: "bg-warning", bar: "#f59e0b" },
  sem_obrigacao: { label: "Sem Obrigação Corrente", short: "Sem Obrigação", cls: "text-slate-300 bg-slate-500/10 border-slate-500/40", dot: "bg-slate-400", bar: "#64748b" },
};
const CONC_ORDER = ["adimplente", "inadimplente", "endr", "consignacao", "sem_obrigacao"];

/* Iniciais do operador para o avatar (duas letras estáveis) */
function initials(label: string) {
  const parts = (label || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || parts[0]?.[1] || "")).toUpperCase();
}
const AVATAR_HUES = ["from-blue-500/30 to-indigo-500/20 text-blue-300", "from-emerald-500/25 to-teal-500/15 text-emerald-300",
  "from-amber-500/25 to-orange-500/15 text-amber-300", "from-fuchsia-500/25 to-purple-500/15 text-fuchsia-300",
  "from-cyan-500/25 to-sky-500/15 text-cyan-300"];
const avatarCls = (id: number) => AVATAR_HUES[id % AVATAR_HUES.length];

/* Anel de progresso (adimplência sobre cobráveis) */
function ProgressRing({ pct, size = 72 }: { pct: number; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const color = pct >= 70 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Adimplência ${pct}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2d3748" strokeWidth={7} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-bold text-white num leading-none">{pct}%</span>
      </div>
    </div>
  );
}

export default function CollectionDetailPage() {
  const { id } = useParams();
  const numId = Number(id);
  const me = getUser();
  const [cycle, setCycle] = useState<any>(null);
  const [conf, setConf] = useState<any>(null);
  const [office, setOffice] = useState<any>(null);
  const [board, setBoard] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");
  const [concFilter, setConcFilter] = useState<string>("");   // filtro pela legenda da barra

  // Ações da linha
  const [showContact, setShowContact] = useState<any>(null);
  const [showReceipt, setShowReceipt] = useState<any>(null);
  const [receiptForm, setReceiptForm] = useState({ amount: "", received_date: new Date().toISOString().slice(0, 10), notes: "" });
  const [reportRow, setReportRow] = useState<any>(null);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  // Notificação
  const [review, setReview] = useState<any>(null);
  const [reviewStage, setReviewStage] = useState<"edit" | "confirm" | "result">("edit");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<any>(null);
  const [proof, setProof] = useState<any>(null);

  // SPA
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
      getCycleBoard(numId),
      getCollectionEvents(numId),
      getOperators({ limit: 300 }),
      getTemplates(),
      getOffice(),
    ]).then(([bd, ev, ops, tmpls, off]) => {
      setBoard(bd.data);
      setEvents(ev.data);
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

  // ---------- Recebimento / relatório (gravados na BASE CENTRAL) ----------
  async function saveReceipt(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await registerCycleReceipt(numId, {
        operator_id: showReceipt.operator_id,
        amount: parseFloat(receiptForm.amount),
        received_date: receiptForm.received_date,
        notes: receiptForm.notes || null,
      });
      setShowReceipt(null);
      setReceiptForm({ amount: "", received_date: new Date().toISOString().slice(0, 10), notes: "" });
      fetchAll();
    } catch (err: any) { toast.error(err.response?.data?.detail || "Erro ao registrar recebimento"); }
    finally { setBusy(false); }
  }

  async function saveReport(e: React.FormEvent) {
    e.preventDefault();
    if (!reportFile) { toast.warn("Selecione o arquivo do relatório."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", reportFile);
      await uploadCycleReceiptReport(numId, reportRow.operator_id, fd);
      setReportRow(null); setReportFile(null);
      fetchAll();
    } catch (err: any) { toast.error(err.response?.data?.detail || "Erro ao anexar relatório"); }
    finally { setBusy(false); }
  }

  // ---------- Notificação ----------
  async function openReview(num: number) {
    setReviewLoading(true);
    setReviewStage("edit");
    setSendResult(null);
    try {
      const r = await getNotificationPreview(numId, num);
      const included = new Set<number>(r.data.recipients.map((x: any) => x.operator_id));
      setReview({ ...r.data, included, deadline_text: `${r.data.deadline_days} (dias) — vencimento em ${r.data.deadline}`, template_id: "" });
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Erro ao carregar pré-visualização");
    } finally { setReviewLoading(false); }
  }

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

  const allGroups = () => review ? [
    ...review.recipients, ...(review.paid || []), ...(review.endr || []),
    ...(review.consignacao || []), ...(review.sem_obrigacao || []),
  ] : [];
  const includedRecipients = () => allGroups().filter((o: any) => review.included.has(o.operator_id));

  function renderPreview(text: string) {
    if (!text || !review) return "";
    const sample = includedRecipients()[0] || allGroups()[0];
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

  async function doSend() {
    const recipients = includedRecipients().map((o: any) => ({ operator_id: o.operator_id, email: o.emails?.[0] || null }));
    if (recipients.length === 0) { toast.warn("Selecione ao menos um destinatário."); return; }
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
      toast.error(err.response?.data?.detail || "Erro ao enviar");
    } finally { setSending(false); }
  }

  async function openProof(emailId: number) {
    try { const r = await getEmailProof(numId, emailId); setProof(r.data); }
    catch { toast.warn("Comprovante indisponível."); }
  }

  // ---------- SPA / atividades / arquivar ----------
  async function handleGenerateSpa() {
    setSpaBusy(true);
    try {
      const ids = (board?.rows || []).filter((r: any) => r.conclusion === "inadimplente").map((r: any) => r.operator_id);
      if (ids.length === 0) { toast.warn("Não há operadores inadimplentes para o ofício."); setSpaBusy(false); return; }
      const r = await generateSpaLetter(numId, { inadimplente_operator_ids: ids, ...spaForm });
      setSpaResult(r.data);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Erro ao gerar minuta");
    } finally { setSpaBusy(false); }
  }
  async function handleDownloadSpa() {
    try {
      const r = await downloadSpaLetter(numId, spaResult.document_id);
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      const a = document.createElement("a"); a.href = url; a.download = spaResult.file_name || "oficio_spa.docx"; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("Erro ao baixar a minuta."); }
  }
  async function downloadActivity() {
    try {
      const r = await downloadCycleActivityPdf(numId);
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = `atividades_${conf?.acronym}_${monthShort(cycle?.reference_month).replace("/", "_")}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("Erro ao gerar relatório de atividades."); }
  }
  async function doArchive() {
    if (!confirm(`Arquivar o ciclo de ${monthShort(cycle?.reference_month)} da ${conf?.acronym}? Ele some das listas, mas o histórico fica preservado.`)) return;
    try { await archiveCycle(numId); toast.success("Ciclo arquivado."); window.location.href = "/cobrancas"; }
    catch (err: any) { toast.error(err.response?.data?.detail || "Erro ao arquivar"); }
  }

  async function doSyncEmails() {
    setSyncing(true);
    try {
      const r = await syncCycleEmails(numId);
      if (!r.data.configured) toast.warn("Integração de e-mail (M365) não configurada no .env.");
      loadEmails();
    } catch { toast.error("Erro ao sincronizar e-mails."); }
    finally { setSyncing(false); }
  }

  const opName = (opId: number) => { const o = operators.find(x => x.id === opId); return o?.fantasy_name || o?.company_name || `#${opId}`; };

  if (loading) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;

  const rows = (board?.rows || []).filter((r: any) => {
    if (concFilter && r.conclusion !== concFilter) return false;
    if (!search) return true;
    const t = search.toLowerCase();
    return r.label?.toLowerCase().includes(t) || r.company_name?.toLowerCase().includes(t) || (r.cnpj || "").includes(t);
  });
  const counts = board?.counts || {};
  const total = board?.total || 0;
  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;
  const cobraveis = total - (counts.endr || 0) - (counts.sem_obrigacao || 0) - (counts.consignacao || 0);
  const rate = cobraveis > 0 ? Math.round(((counts.adimplente || 0) / cobraveis) * 100) : 0;
  const receivedMonth = (board?.rows || []).reduce((s: number, r: any) => s + (Number(r.received_total) || 0), 0);

  return (
    <AppShell>
      {/* ===== Hero da competência ===== */}
      <div className="animate-fade-up mb-6">
        <nav className="flex items-center gap-1.5 text-xs text-muted mb-3" aria-label="Navegação">
          <a href="/cobrancas" className="hover:text-slate-200 transition-colors">Cobranças</a>
          <span aria-hidden>/</span>
          <span className="text-slate-300">{conf?.acronym}</span>
        </nav>

        <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6 justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <ProgressRing pct={rate} />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-[28px] font-bold text-white tracking-tight flex items-center gap-2.5 flex-wrap">
                {monthLabel(cycle?.reference_month)}
                <Badge status={cycle?.status || ""} />
                <HelpTip title="Como funciona o ciclo" wide align="left"
                  text="O ciclo é o espelho da base central para esta competência: a lista de operadores e as conclusões vêm da confederação — nada é duplicado. Prepare a notificação (somente inadimplentes vêm pré-selecionados), registre recebimentos e relatórios (gravados na base central), gere o Ofício SPA e acompanhe a linha do tempo. O administrador pode arquivar o ciclo preservando o histórico." />
              </h1>
              <p className="text-sm text-muted mt-1">
                {conf?.name} · <span className="text-slate-300 num">{counts.adimplente || 0}</span> de{" "}
                <span className="text-slate-300 num">{cobraveis}</span> cobráveis em dia
                {receivedMonth > 0 && <> · <span className="text-success font-medium num whitespace-nowrap">{formatCurrency(receivedMonth)}</span> no mês</>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => openReview(1)} disabled={reviewLoading} className="btn-primary">
              ✉ Preparar Notificação
            </button>
            <button onClick={() => { setSpaResult(null); setSpaModal(true); }} className="btn-secondary">Ofício SPA</button>
            <button onClick={downloadActivity} className="btn-secondary">Atividades</button>
            {me?.role === "admin" && (
              <button onClick={doArchive} className="btn-ghost text-muted hover:text-danger" title="Somente admin — histórico preservado">Arquivar</button>
            )}
          </div>
        </div>
      </div>

      {/* ===== Composição da carteira (barra segmentada + legenda-filtro) ===== */}
      <div className="card mb-6 animate-fade-up">
        <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <p className="text-sm font-semibold text-white">
            Situação da carteira <span className="text-muted font-normal">— {total} operadores</span>
          </p>
          {concFilter && (
            <button onClick={() => setConcFilter("")} className="text-xs text-primary hover:underline">
              Limpar filtro ({CONC[concFilter]?.short})
            </button>
          )}
        </div>

        {/* barra 100% empilhada — separação de 2px entre segmentos; rótulos na legenda */}
        <div className="flex h-3 rounded-full overflow-hidden animate-bar" role="img"
          aria-label={CONC_ORDER.map(k => `${CONC[k].short}: ${counts[k] || 0}`).join(", ")}>
          {CONC_ORDER.filter(k => (counts[k] || 0) > 0).map((k, i, arr) => (
            <div key={k}
              style={{ width: `${(counts[k] / total) * 100}%`, background: CONC[k].bar, marginLeft: i > 0 ? 2 : 0 }}
              className={`transition-all duration-300 ${concFilter && concFilter !== k ? "opacity-25" : ""} ${i === 0 ? "rounded-l-full" : ""} ${i === arr.length - 1 ? "rounded-r-full" : ""}`} />
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mt-3.5">
          {CONC_ORDER.map(k => {
            const n = counts[k] || 0;
            const active = concFilter === k;
            return (
              <button key={k}
                onClick={() => setConcFilter(active ? "" : k)}
                disabled={n === 0}
                aria-pressed={active}
                className={`pill transition-all duration-150 active:scale-[0.97] ${
                  n === 0 ? "opacity-35 cursor-default border-surface-border text-muted" :
                  active ? `${CONC[k].cls} ring-2 ring-offset-2 ring-offset-surface-light ring-primary/60` :
                  `${CONC[k].cls} hover:brightness-110 cursor-pointer`}`}
                title={n > 0 ? `Filtrar a lista por ${CONC[k].label}` : undefined}
              >
                <span className={`pill-dot ${CONC[k].dot}`} />
                {CONC[k].short}
                <span className="num font-semibold">{n}</span>
                <span className="text-[10px] opacity-70 num">{pct(n)}%</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-border mb-6 overflow-x-auto items-center">
        {["Operadores", emailStats.sent + emailStats.received > 0 ? `Comunicações (${emailStats.sent + emailStats.received})` : "Comunicações", events.length > 0 ? `Linha do Tempo (${events.length})` : "Linha do Tempo"].map((t, i) => (
          <button key={i} onClick={() => setTab(i)}
            className={"px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap " + (tab === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-slate-200")}>
            {t}
          </button>
        ))}
        <span className="ml-auto pl-2 pr-1 flex-shrink-0">
          <HelpTip
            title={["Operadores", "Comunicações", "Linha do Tempo"][tab]}
            text={[
              "Espelho da relação da confederação na competência: Conclusão (editada na aba da confederação), recebido no mês, último pagamento e relatório. Ações por linha: Contactar (e-mail/WhatsApp/telefone), Registrar recebimento e anexar Relatório — tudo gravado na base central, sem duplicação.",
              "E-mails enviados e respostas recebidas neste ciclo, com protocolo de envio. A fila de e-mails aguarda revisão antes do disparo; respostas são conciliadas automaticamente pela conversa do Outlook.",
              "Cronologia completa do ciclo: notificações, contatos, confirmações de pagamento e eventos administrativos, com autor e data — útil como evidência do acompanhamento.",
            ][tab]}
            align="right" wide />
        </span>
      </div>

      {/* TAB 0 — Espelho da relação da confederação */}
      {tab === 0 && (
        <div className="space-y-3 animate-fade-up">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="relative max-w-xs w-full">
              <svg className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              <input className="input !pl-9" placeholder="Buscar operador ou CNPJ..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <p className="text-xs text-muted hidden md:block">A Conclusão é editada na aba da confederação; recebimentos registrados aqui vão para a base central.</p>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="table-wrap">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="bg-surface/80">
                  <tr>
                    <th className="table-th">Operador</th>
                    <th className="table-th">Conclusão</th>
                    <th className="table-th text-right">Recebido no mês</th>
                    <th className="table-th">Último pagamento</th>
                    <th className="table-th text-center">Relatório</th>
                    <th className="table-th text-right pr-5">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => {
                    const c = CONC[r.conclusion] || CONC.inadimplente;
                    return (
                      <tr key={r.operator_id} className="group hover:bg-surface-light/30 transition-colors">
                        <td className="table-td">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${avatarCls(r.operator_id)} border border-white/5 flex items-center justify-center text-[11px] font-bold flex-shrink-0`} aria-hidden>
                              {initials(r.label)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-white truncate">{r.label}</p>
                              {r.cnpj && <p className="text-[11px] text-muted font-mono num">{r.cnpj}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="table-td">
                          <span className={`pill ${c.cls}`}>
                            <span className={`pill-dot ${c.dot}`} />{c.label}
                            {r.conclusion_manual && <span className="text-[9px] opacity-70 border-l border-current/30 pl-1.5 ml-0.5">manual</span>}
                          </span>
                        </td>
                        <td className="table-td text-right">
                          {r.received_total
                            ? <span className="text-success font-semibold num">{formatCurrency(r.received_total)}</span>
                            : <span className="text-muted/60">—</span>}
                        </td>
                        <td className="table-td text-xs text-muted num">
                          {r.last_payment_date ? <>{formatDate(r.last_payment_date)}{r.last_payment_amount ? <span className="text-slate-400"> · {formatCurrency(r.last_payment_amount)}</span> : ""}</> : <span className="text-muted/60">—</span>}
                        </td>
                        <td className="table-td text-center">
                          {r.report_url
                            ? <a href={API_BASE + r.report_url} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary bg-primary/10 border border-primary/25 px-2 py-1 rounded-md hover:bg-primary/20 transition-colors">
                                📄 Ver
                              </a>
                            : <span className="text-xs text-muted/60">—</span>}
                        </td>
                        <td className="table-td text-right pr-4">
                          <div className="inline-flex gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setShowContact(operators.find(o => o.id === r.operator_id))}
                              className="text-[11px] text-purple-300 px-2 py-1 rounded-md hover:bg-purple-500/15 transition-colors" title="E-mail, WhatsApp ou telefone">
                              Contactar
                            </button>
                            <button onClick={() => setShowReceipt(r)}
                              className="text-[11px] text-success px-2 py-1 rounded-md hover:bg-success/15 transition-colors" title="Registrar recebimento na base central">
                              Recebimento
                            </button>
                            <button onClick={() => { setReportRow(r); setReportFile(null); }}
                              className="text-[11px] text-amber-400 px-2 py-1 rounded-md hover:bg-amber-500/15 transition-colors" title="Anexar relatório de apuração">
                              Relatório
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="table-td text-center text-muted py-10">
                      Nenhum operador encontrado{concFilter ? <> para o filtro <b>{CONC[concFilter]?.short}</b> — <button onClick={() => setConcFilter("")} className="text-primary hover:underline">limpar</button></> : ""}.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1 — Comunicações */}
      {tab === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm text-muted">E-mails deste ciclo. {emailStats.sent} enviados · {emailStats.received} recebidos.</p>
              <div className="mt-2"><MailboxBadge prefix="Sincronizando a caixa" /></div>
            </div>
            <button onClick={doSyncEmails} disabled={syncing} className="btn-primary">{syncing ? "Sincronizando..." : "Sincronizar Caixa de Entrada"}</button>
          </div>
          <CycleEmailQueue emails={emails.filter(e => e.direction === "inbound" && !e.matched)} operators={operators} onLinked={loadEmails} />
          <div className="card p-0 overflow-hidden">
            <div className="table-wrap"><table className="w-full text-sm">
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
            </table></div>
          </div>
        </div>
      )}

      {/* TAB 2 — Linha do tempo */}
      {tab === 2 && (() => {
        const EV: Record<string, { icon: string; label: string; cls: string }> = {
          notification_sent: { icon: "✉", label: "Notificação enviada", cls: "bg-primary/15 text-primary border-primary/30" },
          payment_confirmed: { icon: "✓", label: "Recebimento confirmado", cls: "bg-success/15 text-success border-success/30" },
          email_read: { icon: "↩", label: "Resposta recebida", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
          phone_contact: { icon: "☎", label: "Contato telefônico", cls: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
          manual_note: { icon: "✎", label: "Registro manual", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
        };
        return (
          <div className="card p-0 overflow-hidden animate-fade-up">
            {events.length === 0 ? (
              <p className="p-6 text-muted text-sm text-center">Nenhum evento registrado nesta competência ainda.</p>
            ) : (
              <div className="relative pl-2">
                {/* trilho vertical */}
                <div className="absolute left-[27px] top-4 bottom-4 w-px bg-surface-border" aria-hidden />
                <div className="divide-y divide-surface-border/50">
                  {events.map(ev => {
                    const e = EV[ev.event_type] || EV.manual_note;
                    return (
                      <div key={ev.id} className="p-4 flex items-start gap-3.5 relative">
                        <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-sm flex-shrink-0 relative z-10 bg-surface-light ${e.cls}`} aria-hidden>
                          {e.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-white">
                            <span className="font-medium">{opName(ev.operator_id)}</span>
                            <span className="text-muted"> — {e.label}</span>
                            {ev.channel && <span className="text-[10px] text-muted uppercase tracking-wide border border-surface-border rounded px-1.5 py-px ml-2 align-middle">{ev.channel}</span>}
                          </p>
                          {ev.notes && <p className="text-xs text-slate-400 mt-1 leading-relaxed">{ev.notes}</p>}
                          <p className="text-[11px] text-muted mt-1 num">{formatDateTime(ev.performed_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ===== Revisão de Notificação ===== */}
      {review && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-card border border-surface-border rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-surface-border sticky top-0 bg-surface-card z-10">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-white">Preparar Notificação — {conf?.acronym} · <span className="capitalize">{monthLabel(cycle?.reference_month)}</span></h3>
                  <p className="text-xs text-muted">Somente inadimplentes vêm pré-selecionados; os demais grupos podem ser incluídos manualmente.</p>
                </div>
                <button onClick={() => setReview(null)} aria-label="Fechar" className="text-muted hover:text-white text-xl leading-none px-1">×</button>
              </div>
              {/* Indicador de etapas */}
              <div className="flex items-center gap-2 mt-3" aria-label="Etapas do envio">
                {[["edit", "1 · Redigir"], ["confirm", "2 · Conferir"], ["result", "3 · Comprovantes"]].map(([st, lb], i) => {
                  const order = ["edit", "confirm", "result"];
                  const done = order.indexOf(reviewStage) > i;
                  const active = reviewStage === st;
                  return (
                    <div key={st} className="flex items-center gap-2">
                      {i > 0 && <div className={`w-6 h-px ${done || active ? "bg-primary/60" : "bg-surface-border"}`} aria-hidden />}
                      <span className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                        active ? "bg-primary/15 text-primary border-primary/40 font-semibold" :
                        done ? "text-success border-success/30 bg-success/10" : "text-muted border-surface-border"}`}>
                        {done ? "✓ " : ""}{lb}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {reviewStage === "edit" && (
              <>
                <div className="p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="label">Tipo de notificação</label>
                      <select className="input" value={review.notification_number} onChange={e => openReview(Number(e.target.value))}>
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

                  <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-center">
                    <span className="text-2xl font-bold text-warning">{includedRecipients().length}</span>
                    <span className="text-sm text-slate-200 ml-2">destinatário(s) selecionado(s)</span>
                  </div>

                  {/* Inadimplentes (pré-selecionados) */}
                  <div>
                    <h4 className="text-sm font-semibold text-white mb-2">Inadimplentes <span className="text-muted font-normal">(pré-selecionados)</span></h4>
                    <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-52 overflow-y-auto">
                      {review.recipients.map((o: any) => (
                        <label key={o.operator_id} className="flex items-center gap-3 p-2.5 hover:bg-surface-light/20 cursor-pointer">
                          <input type="checkbox" checked={review.included.has(o.operator_id)} onChange={() => toggleInclude(o.operator_id)} />
                          <span className="text-sm text-white flex-1">{o.label}</span>
                          <span className={`text-xs ${o.emails?.length ? "text-muted" : "text-danger"}`}>{o.emails?.[0] || "sem e-mail"}</span>
                        </label>
                      ))}
                      {review.recipients.length === 0 && <p className="p-3 text-xs text-muted">Nenhum inadimplente na competência. 🎉</p>}
                    </div>
                  </div>

                  {/* Demais grupos (inclusão manual) */}
                  <div className="grid grid-cols-2 gap-4">
                    {[["Adimplentes", review.paid], ["ENDR (suspensos)", review.endr], ["Consignação em Pagamento", review.consignacao], ["Sem Obrigação Corrente", review.sem_obrigacao]].map(([title, list]: any, gi: number) => (
                      <div key={gi}>
                        <h4 className="text-sm font-semibold text-white mb-2">{title} <span className="text-muted font-normal">({(list || []).length} — incluir?)</span></h4>
                        <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-36 overflow-y-auto">
                          {(list || []).map((o: any) => (
                            <label key={o.operator_id} className="flex items-center gap-2 p-2 text-xs hover:bg-surface-light/20 cursor-pointer">
                              <input type="checkbox" checked={review.included.has(o.operator_id)} onChange={() => toggleInclude(o.operator_id)} />
                              <span className="text-slate-300 flex-1">{o.label}</span>
                            </label>
                          ))}
                          {(list || []).length === 0 && <p className="p-2 text-xs text-muted">—</p>}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Mensagem */}
                  <div>
                    <h4 className="text-sm font-semibold text-white mb-2">Mensagem</h4>
                    <p className="text-xs text-muted mb-2">Chaves ({"{bet}"}, {"{confederacaosigla}"}, {"{mes}"}, {"{ano}"}, {"{prazo}"}, {"{escritorio}"}) são preenchidas automaticamente.</p>
                    <input className="input mb-2" value={review.message.subject} onChange={e => setReview((rv: any) => ({ ...rv, message: { ...rv.message, subject: e.target.value } }))} />
                    <textarea className="input h-40 resize-none text-sm" value={review.message.body} onChange={e => setReview((rv: any) => ({ ...rv, message: { ...rv.message, body: e.target.value } }))} />
                  </div>

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

      {/* Comprovante */}
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

      {/* Ofício SPA */}
      <Modal isOpen={spaModal} onClose={() => setSpaModal(false)} title="Gerar Minuta — Ofício à SPA">
        {!spaResult ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">A minuta listará os operadores com Conclusão “Inadimplente” nesta competência.</p>
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

      {/* Registrar recebimento (base central) */}
      <Modal isOpen={!!showReceipt} onClose={() => setShowReceipt(null)} title={`Registrar Recebimento — ${showReceipt?.label || ""}`}>
        <form onSubmit={saveReceipt} className="space-y-4">
          <p className="text-sm text-muted">O recebimento é gravado na base central (operador × {conf?.acronym} × competência {monthShort(cycle?.reference_month)}), sem duplicar dados no ciclo.</p>
          <div><label className="label">Valor (R$) *</label><input type="number" step="0.01" min="0.01" className="input" placeholder="0,00" required value={receiptForm.amount} onChange={e => setReceiptForm(f => ({ ...f, amount: e.target.value }))} /></div>
          <div><label className="label">Data do recebimento *</label><input type="date" className="input" required value={receiptForm.received_date} onChange={e => setReceiptForm(f => ({ ...f, received_date: e.target.value }))} /></div>
          <div><label className="label">Observações</label><textarea className="input h-20 resize-none" value={receiptForm.notes} onChange={e => setReceiptForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3 justify-end"><button type="button" onClick={() => setShowReceipt(null)} className="btn-secondary">Cancelar</button><button type="submit" disabled={busy} className="btn-primary">{busy ? "Salvando..." : "Registrar"}</button></div>
        </form>
      </Modal>

      {/* Anexar relatório da competência */}
      <Modal isOpen={!!reportRow} onClose={() => setReportRow(null)} title={`Relatório — ${reportRow?.label || ""}`}>
        <form onSubmit={saveReport} className="space-y-4">
          <p className="text-sm text-muted">Anexe o relatório de apuração enviado pelo operador para a competência {monthShort(cycle?.reference_month)} ({conf?.acronym}).</p>
          <div><label className="label">Arquivo *</label><input type="file" className="input" onChange={e => setReportFile(e.target.files?.[0] || null)} /></div>
          <div className="flex gap-3 justify-end"><button type="button" onClick={() => setReportRow(null)} className="btn-secondary">Cancelar</button><button type="submit" disabled={busy} className="btn-primary">{busy ? "Enviando..." : "Anexar"}</button></div>
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
  const msg = `Prezados representantes de ${operator?.fantasy_name || operator?.company_name},\n\nReferente à contrapartida de direito de imagem (${conf?.acronym || ""}) da competência ${mes}/${ano}, solicitamos gentilmente a regularização do repasse e o envio do relatório de apuração.\n\nAtenciosamente,\n${sig}`;
  const subject = `${conf?.acronym || ""} - Contrapartida Direito de Imagem ${mes}/${ano}`;

  const emails: string[] = [];
  (operator?.contacts || []).forEach((c: any) => { if (c.type === "email" && c.value) emails.push(c.value); });
  (operator?.responsibles || []).forEach((r: any) => { if (r.email) emails.push(r.email); });
  const phones: { label: string; value: string }[] = [];
  (operator?.contacts || []).forEach((c: any) => { if ((c.type === "phone" || c.type === "whatsapp") && c.value) phones.push({ label: c.label || c.type, value: c.value }); });
  (operator?.responsibles || []).forEach((r: any) => { if (r.phone) phones.push({ label: r.role, value: r.phone }); });
  const socials: { label: string; url: string }[] = [];
  (operator?.brands || []).forEach((b: any) => {
    if (b.instagram) socials.push({ label: `Instagram (${b.name})`, url: b.instagram.startsWith("http") ? b.instagram : `https://instagram.com/${b.instagram.replace("@", "")}` });
    if (b.facebook) socials.push({ label: `Facebook (${b.name})`, url: b.facebook });
    if (b.twitter) socials.push({ label: `X/Twitter (${b.name})`, url: b.twitter });
    if (b.website) socials.push({ label: `Site (${b.name})`, url: b.website.startsWith("http") ? b.website : `https://${b.website}` });
  });

  const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");
  function waLink(phone: string) {
    let d = onlyDigits(phone);
    if (d.length <= 11) d = "55" + d;
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
    <Modal isOpen={true} onClose={onClose} title={`Contatar — ${operator?.fantasy_name || operator?.company_name}`}>
      <div className="space-y-4">
        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted">Mensagem padrão (editável ao enviar)</p><button onClick={copyMsg} className="text-xs text-primary hover:underline">Copiar</button></div>
          <p className="text-xs text-slate-300 whitespace-pre-line">{msg}</p>
        </div>

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

/* Fila de conciliação de e-mails não casados */
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
