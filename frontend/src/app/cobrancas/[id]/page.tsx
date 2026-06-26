"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import {
  getCollection, getCollectionEvents, getPayments, getConfederation, getOperators,
  confirmPayment, declareValue,
  getNotificationPreview, sendNotificationConfirmed, generateSpaLetter, downloadSpaLetter,
} from "@/lib/api";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";

export default function CollectionDetailPage() {
  const { id } = useParams();
  const numId = Number(id);
  const [cycle, setCycle] = useState<any>(null);
  const [conf, setConf] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState<any>(null);
  const [showDeclare, setShowDeclare] = useState<any>(null);
  const [confirmForm, setConfirmForm] = useState({ amount_paid: "", payment_date: "", notes: "" });
  const [declareForm, setDeclareForm] = useState({ amount_due: "", base_calculo: "", notes: "" });

  // Fluxo de revisão de notificação
  const [review, setReview] = useState<any>(null); // { notification_number, paid, endr, recipients, message, deadline, included:Set }
  const [reviewLoading, setReviewLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Ofício à SPA
  const [spaModal, setSpaModal] = useState(false);
  const [spaForm, setSpaForm] = useState({ city: "Rio de Janeiro", first_notif_date: "", second_notif_date: "", spa_list_date: "", endr_list_date: "" });
  const [spaResult, setSpaResult] = useState<any>(null);
  const [spaBusy, setSpaBusy] = useState(false);

  const fetchAll = () => {
    getCollection(numId).then(r => {
      setCycle(r.data);
      return getConfederation(r.data.confederation_id);
    }).then(r => setConf(r.data));
    Promise.all([
      getCollectionEvents(numId),
      getPayments({ cycle_id: numId, limit: 200 }),
      getOperators({ limit: 300 }),
    ]).then(([ev, pays, ops]) => {
      setEvents(ev.data);
      setPayments(pays.data);
      setOperators(ops.data);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { fetchAll(); }, [numId]);

  async function openReview(num: number) {
    setReviewLoading(true);
    try {
      const r = await getNotificationPreview(numId, num);
      const included = new Set<number>(r.data.recipients.map((x: any) => x.operator_id));
      setReview({ ...r.data, included });
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao carregar pré-visualização");
    } finally { setReviewLoading(false); }
  }

  function toggleInclude(opId: number) {
    setReview((rv: any) => {
      const s = new Set<number>(rv.included);
      if (s.has(opId)) s.delete(opId); else s.add(opId);
      return { ...rv, included: s };
    });
  }

  async function confirmSend() {
    if (!review) return;
    const all = [...review.recipients, ...review.paid, ...review.endr];
    const recipients = all.filter((o: any) => review.included.has(o.operator_id))
      .map((o: any) => ({ operator_id: o.operator_id, email: o.emails?.[0] || null }));
    if (recipients.length === 0) { alert("Selecione ao menos um destinatário."); return; }
    if (!confirm(`Confirmar envio da ${review.notification_number}ª notificação para ${recipients.length} operador(es)?`)) return;
    setSending(true);
    try {
      const r = await sendNotificationConfirmed(numId, {
        notification_number: review.notification_number,
        subject: review.message.subject,
        body: review.message.body,
        recipients,
      });
      alert(`Enviados: ${r.data.sent} · Falhas: ${r.data.failed}`);
      setReview(null);
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao enviar");
    } finally { setSending(false); }
  }

  async function handleGenerateSpa() {
    // inadimplentes = pagamentos não pagos e não ENDR — usa a pré-visualização da 2ª notif para classificar
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
      const a = document.createElement("a");
      a.href = url; a.download = spaResult.file_name || "oficio_spa.docx"; a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Erro ao baixar a minuta.");
    }
  }

  async function handleConfirmPayment(e: React.FormEvent) {
    e.preventDefault();
    try {
      await confirmPayment(showConfirm.id, {
        amount_paid: parseFloat(confirmForm.amount_paid),
        payment_date: confirmForm.payment_date, notes: confirmForm.notes,
      });
      setShowConfirm(null); fetchAll();
    } catch (err: any) { alert(err.response?.data?.detail || "Erro"); }
  }

  async function handleDeclareValue(e: React.FormEvent) {
    e.preventDefault();
    try {
      await declareValue(showDeclare.id, {
        amount_due: parseFloat(declareForm.amount_due),
        base_calculo: declareForm.base_calculo ? parseFloat(declareForm.base_calculo) : null,
        notes: declareForm.notes,
      });
      setShowDeclare(null); fetchAll();
    } catch (err: any) { alert(err.response?.data?.detail || "Erro"); }
  }

  if (loading) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;

  const paid = payments.filter(p => p.status === "paid").length;
  const reportPending = payments.filter(p => p.status === "report_pending").length;
  const total = payments.length;
  const adimplentes = paid + reportPending;
  const rate = total > 0 ? Math.round((adimplentes / total) * 100) : 0;

  const flowSteps = [
    { day: conf?.payment_due_day ?? 10, label: "Vencimento", desc: "Vencimento dos repasses" },
    { day: conf?.first_notification_day ?? 12, label: "1ª Notificação", desc: `Prazo: ${conf?.first_notification_deadline_days ?? 10} dias` },
    { day: conf?.second_notification_day ?? 22, label: "2ª Notificação", desc: `Prazo: ${conf?.second_notification_deadline_days ?? 8} dias` },
    { day: conf?.closing_day ?? 1, label: "Fechamento", desc: "Ofício à SPA" },
  ];

  return (
    <AppShell>
      <Header
        title={`Ciclo #${numId}`}
        subtitle={`${conf?.name} - Referência: ${formatDate(cycle?.reference_month)}`}
        actions={
          <>
            <Badge status={cycle?.status || ""} />
            <button onClick={() => openReview(1)} disabled={reviewLoading} className="btn-secondary">Preparar 1ª Notif.</button>
            <button onClick={() => openReview(2)} disabled={reviewLoading} className="btn-secondary">Preparar 2ª Notif.</button>
            <button onClick={() => { setSpaResult(null); setSpaModal(true); }} className="btn-primary">Gerar Ofício SPA</button>
          </>
        }
      />

      {/* Flow Timeline (datas da confederação) */}
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

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card text-center">
          <p className={`text-3xl font-bold ${rate >= 70 ? "text-success" : rate >= 40 ? "text-warning" : "text-danger"}`}>{rate}%</p>
          <p className="text-xs text-muted">Adimplência</p>
        </div>
        <div className="card text-center"><p className="text-3xl font-bold text-success">{paid}</p><p className="text-xs text-muted">Adimplentes</p></div>
        <div className="card text-center"><p className="text-3xl font-bold text-warning">{reportPending}</p><p className="text-xs text-muted">Pend. de Relatório</p></div>
        <div className="card text-center"><p className="text-3xl font-bold text-danger">{total - adimplentes}</p><p className="text-xs text-muted">Inadimplentes</p></div>
      </div>

      {/* Payments table */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="p-4 border-b border-surface-border flex items-center justify-between">
          <h3 className="font-semibold text-white">Pagamentos por Operador</h3>
        </div>
        <table className="w-full">
          <thead className="bg-surface">
            <tr>
              <th className="table-th">Operador</th>
              <th className="table-th">Valor Devido (operador)</th>
              <th className="table-th">Total Recebido</th>
              <th className="table-th">Repasses</th>
              <th className="table-th">Relatório</th>
              <th className="table-th">Status</th>
              <th className="table-th">Ações</th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => {
              const op = operators.find(o => o.id === p.operator_id);
              const receipts = p.receipts || [];
              return (
                <tr key={p.id} className="hover:bg-surface-light/20 align-top">
                  <td className="table-td">{op?.fantasy_name || op?.company_name || `#${p.operator_id}`}</td>
                  <td className="table-td">{formatCurrency(p.amount_due)}</td>
                  <td className="table-td">{formatCurrency(p.amount_paid)}</td>
                  <td className="table-td">
                    {receipts.length === 0 ? <span className="text-xs text-muted">—</span> : (
                      <div className="space-y-0.5">
                        {receipts.map((r: any) => (
                          <div key={r.id} className="text-xs text-slate-400">{formatCurrency(r.amount)} <span className="text-muted">em {formatDate(r.received_date)}</span></div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="table-td">{p.report_received ? <span className="text-xs text-success">✓</span> : <span className="text-xs text-muted">—</span>}</td>
                  <td className="table-td"><Badge status={p.status} /></td>
                  <td className="table-td">
                    <div className="flex gap-2">
                      <button onClick={() => { setShowDeclare(p); setDeclareForm({ amount_due: "", base_calculo: "", notes: "" }); }} className="text-xs text-blue-400 hover:underline">Registrar Valor</button>
                      <button onClick={() => { setShowConfirm(p); setConfirmForm({ amount_paid: "", payment_date: "", notes: "" }); }} className="text-xs text-success hover:underline">+ Repasse</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Events */}
      <div className="card p-0 overflow-hidden">
        <div className="p-4 border-b border-surface-border">
          <h3 className="font-semibold text-white">Eventos do Ciclo ({events.length})</h3>
        </div>
        <div className="divide-y divide-surface-border">
          {events.length === 0 ? (
            <p className="p-4 text-muted text-sm">Nenhum evento registrado</p>
          ) : events.map(ev => {
            const op = operators.find(o => o.id === ev.operator_id);
            return (
              <div key={ev.id} className="p-4 flex items-start gap-4">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-white">
                    <span className="font-medium">{op?.fantasy_name || op?.company_name || `Op #${ev.operator_id}`}</span>
                    {" "}-{" "}<code className="text-xs bg-surface px-1.5 py-0.5 rounded">{ev.event_type}</code>
                    {" via "}<span className="text-muted">{ev.channel}</span>
                  </p>
                  {ev.notes && <p className="text-xs text-muted mt-1">{ev.notes}</p>}
                  <p className="text-xs text-muted mt-1">{formatDateTime(ev.performed_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== Tela de Revisão de Notificação ===== */}
      {review && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-card border border-surface-border rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-surface-border flex items-center justify-between sticky top-0 bg-surface-card">
              <div>
                <h3 className="font-semibold text-white">Revisar {review.notification_number}ª Notificação</h3>
                <p className="text-xs text-muted">Referência {review.reference_month} · Prazo concedido até {review.deadline} ({review.deadline_days} dias)</p>
              </div>
              <button onClick={() => setReview(null)} className="text-muted hover:text-white text-xl">×</button>
            </div>

            <div className="p-5 space-y-5">
              {/* Resumo */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-success">{review.paid.length}</p><p className="text-xs text-muted">Já pagaram</p>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-400">{review.endr.length}</p><p className="text-xs text-muted">Associados ao ENDR</p>
                </div>
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-warning">{[...review.recipients, ...review.paid, ...review.endr].filter((o: any) => review.included.has(o.operator_id)).length}</p>
                  <p className="text-xs text-muted">Vão receber</p>
                </div>
              </div>

              {/* Destinatários */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">Destinatários da notificação</h4>
                <p className="text-xs text-muted mb-2">Marque/desmarque quem deve receber. Operadores sem e-mail cadastrado aparecem em vermelho.</p>
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

              {/* Listas auxiliares com opção de incluir */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-semibold text-white mb-2">Já pagaram <span className="text-muted font-normal">(excluídos)</span></h4>
                  <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-40 overflow-y-auto">
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
                  <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-40 overflow-y-auto">
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
                <h4 className="text-sm font-semibold text-white mb-2">Mensagem a ser enviada</h4>
                <p className="text-xs text-muted mb-2">Campos entre chaves ({"{bet}"}, {"{confederacao}"}, {"{mes}"}, {"{prazo}"}) são substituídos automaticamente para cada operador.</p>
                <input className="input mb-2" value={review.message.subject}
                  onChange={e => setReview((rv: any) => ({ ...rv, message: { ...rv.message, subject: e.target.value } }))} />
                <textarea className="input h-48 resize-none text-sm" value={review.message.body}
                  onChange={e => setReview((rv: any) => ({ ...rv, message: { ...rv.message, body: e.target.value } }))} />
              </div>
            </div>

            <div className="p-5 border-t border-surface-border flex gap-3 justify-end sticky bottom-0 bg-surface-card">
              <button onClick={() => setReview(null)} className="btn-secondary">Cancelar</button>
              <button onClick={confirmSend} disabled={sending} className="btn-primary">{sending ? "Enviando..." : "Confirmar e Enviar"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Ofício à SPA ===== */}
      <Modal isOpen={spaModal} onClose={() => setSpaModal(false)} title="Gerar Minuta — Ofício à SPA">
        {!spaResult ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">A minuta listará os operadores inadimplentes (não pagaram e não estão no ENDR). Você pode complementar as informações de contexto abaixo.</p>
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
            <div>
              <label className="label">Pré-visualização do texto</label>
              <textarea readOnly className="input h-80 resize-none text-xs font-mono" value={spaResult.text} />
            </div>
            <div className="flex justify-end"><button onClick={() => setSpaModal(false)} className="btn-secondary">Fechar</button></div>
          </div>
        )}
      </Modal>

      {/* Confirm Payment Modal */}
      <Modal isOpen={!!showConfirm} onClose={() => setShowConfirm(null)} title="Registrar Repasse Recebido">
        <form onSubmit={handleConfirmPayment} className="space-y-4">
          <p className="text-sm text-muted">Cada repasse recebido é registrado individualmente. Uma Bet pode repassar em mais de uma oportunidade no mesmo mês.</p>
          <div><label className="label">Valor do Repasse (R$) *</label><input type="number" step="0.01" className="input" required value={confirmForm.amount_paid} onChange={e => setConfirmForm(f => ({ ...f, amount_paid: e.target.value }))} /></div>
          <div><label className="label">Data do Pagamento *</label><input type="date" className="input" required value={confirmForm.payment_date} onChange={e => setConfirmForm(f => ({ ...f, payment_date: e.target.value }))} /></div>
          <div><label className="label">Observações</label><textarea className="input h-20 resize-none" value={confirmForm.notes} onChange={e => setConfirmForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowConfirm(null)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">Confirmar Pagamento</button>
          </div>
        </form>
      </Modal>

      {/* Registrar Valor Devido Modal */}
      <Modal isOpen={!!showDeclare} onClose={() => setShowDeclare(null)} title="Registrar Valor Devido">
        <form onSubmit={handleDeclareValue} className="space-y-4">
          <p className="text-sm text-muted">O valor é apurado pelo próprio agente operador e informado no relatório. O escritório apenas registra o que foi informado.</p>
          <div><label className="label">Valor Devido informado pelo operador (R$) *</label><input type="number" step="0.01" className="input" required value={declareForm.amount_due} onChange={e => setDeclareForm(f => ({ ...f, amount_due: e.target.value }))} /></div>
          <div><label className="label">Base de Cálculo (R$) <span className="text-muted">(opcional)</span></label><input type="number" step="0.01" className="input" value={declareForm.base_calculo} onChange={e => setDeclareForm(f => ({ ...f, base_calculo: e.target.value }))} /></div>
          <div><label className="label">Observações</label><textarea className="input h-16 resize-none" value={declareForm.notes} onChange={e => setDeclareForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowDeclare(null)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">Registrar</button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
