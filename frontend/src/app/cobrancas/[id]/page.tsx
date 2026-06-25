"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import {
  getCollection, getCollectionEvents, getPayments, getConfederation, getOperators,
  sendNotifications, confirmPayment, declareValue, addCollectionEvent
} from "@/lib/api";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";

const FLOW_STEPS = [
  { day: 10, label: "Vencimento", desc: "Data de vencimento dos pagamentos" },
  { day: 12, label: "1ª Notificação", desc: "Envio de cobrança inicial" },
  { day: 20, label: "Verificação", desc: "Checagem de confirmações por email" },
  { day: 22, label: "2ª Notificação", desc: "Cobrança aos inadimplentes" },
  { day: 1, label: "Fechamento", desc: "Relatório final do ciclo" },
];

export default function CollectionDetailPage() {
  const { id } = useParams();
  const numId = Number(id);
  const [cycle, setCycle] = useState<any>(null);
  const [conf, setConf] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showConfirm, setShowConfirm] = useState<any>(null);
  const [showDeclare, setShowDeclare] = useState<any>(null);
  const [showEvent, setShowEvent] = useState<any>(null);
  const [confirmForm, setConfirmForm] = useState({ amount_paid: "", payment_date: "", notes: "" });
  const [declareForm, setDeclareForm] = useState({ amount_due: "", base_calculo: "", notes: "" });
  const [eventForm, setEventForm] = useState({ event_type: "manual_note", channel: "manual", notes: "" });

  const fetchAll = () => {
    getCollection(numId).then(r => {
      setCycle(r.data);
      return getConfederation(r.data.confederation_id);
    }).then(r => setConf(r.data));
    Promise.all([
      getCollectionEvents(numId),
      getPayments({ cycle_id: numId, limit: 200 }),
      getOperators({ limit: 200 }),
    ]).then(([ev, pays, ops]) => {
      setEvents(ev.data);
      setPayments(pays.data);
      setOperators(ops.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, [numId]);

  async function handleSendNotifications(num: number) {
    setSending(true);
    try {
      const r = await sendNotifications(numId, num);
      alert(`Enviado: ${r.data.sent}, Falhou: ${r.data.failed}`);
      fetchAll();
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmPayment(e: React.FormEvent) {
    e.preventDefault();
    try {
      await confirmPayment(showConfirm.id, {
        amount_paid: parseFloat(confirmForm.amount_paid),
        payment_date: confirmForm.payment_date,
        notes: confirmForm.notes,
      });
      setShowConfirm(null);
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro");
    }
  }

  async function handleDeclareValue(e: React.FormEvent) {
    e.preventDefault();
    try {
      await declareValue(showDeclare.id, {
        amount_due: parseFloat(declareForm.amount_due),
        base_calculo: declareForm.base_calculo ? parseFloat(declareForm.base_calculo) : null,
        notes: declareForm.notes,
      });
      setShowDeclare(null);
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro");
    }
  }

  async function handleAddEvent(e: React.FormEvent) {
    e.preventDefault();
    try {
      await addCollectionEvent(numId, { ...eventForm, operator_id: showEvent.operator_id || 1 });
      setShowEvent(null);
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro");
    }
  }

  if (loading) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;

  const paid = payments.filter(p => p.status === "paid").length;
  const reportPending = payments.filter(p => p.status === "report_pending").length;
  const total = payments.length;
  const adimplentes = paid + reportPending;
  const rate = total > 0 ? Math.round((adimplentes / total) * 100) : 0;

  return (
    <AppShell>
      <Header
        title={`Ciclo #${numId}`}
        subtitle={`${conf?.name} - Referência: ${formatDate(cycle?.reference_month)}`}
        actions={
          <>
            <Badge status={cycle?.status || ""} />
            <button onClick={() => handleSendNotifications(1)} disabled={sending} className="btn-secondary">
              Enviar 1ª Notif.
            </button>
            <button onClick={() => handleSendNotifications(2)} disabled={sending} className="btn-secondary">
              Enviar 2ª Notif.
            </button>
          </>
        }
      />

      {/* Flow Timeline */}
      <div className="card mb-6">
        <h3 className="font-semibold text-white mb-4">Fluxo de Cobrança</h3>
        <div className="flex items-center gap-0 overflow-x-auto">
          {FLOW_STEPS.map((step, i) => (
            <div key={i} className="flex items-center flex-shrink-0">
              <div className="text-center w-32">
                <div className="w-10 h-10 rounded-full bg-primary/15 border-2 border-primary/30 flex items-center justify-center mx-auto mb-2">
                  <span className="text-xs font-bold text-primary">Dia {step.day}</span>
                </div>
                <p className="text-xs font-semibold text-white">{step.label}</p>
                <p className="text-xs text-muted mt-0.5">{step.desc}</p>
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <div className="h-0.5 bg-surface-border flex-shrink-0 w-4 mx-1" />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card text-center">
          <p className={`text-3xl font-bold ${rate >= 70 ? "text-success" : rate >= 40 ? "text-warning" : "text-danger"}`}>{rate}%</p>
          <p className="text-xs text-muted">Adimplência</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-success">{paid}</p>
          <p className="text-xs text-muted">Adimplentes</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-warning">{reportPending}</p>
          <p className="text-xs text-muted">Pend. de Relatório</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-danger">{total - adimplentes}</p>
          <p className="text-xs text-muted">Inadimplentes</p>
        </div>
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
              <th className="table-th">Valor Recebido</th>
              <th className="table-th">Relatório</th>
              <th className="table-th">Status</th>
              <th className="table-th">Ações</th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => {
              const op = operators.find(o => o.id === p.operator_id);
              return (
                <tr key={p.id} className="hover:bg-surface-light/20">
                  <td className="table-td">{op?.fantasy_name || op?.company_name || `#${p.operator_id}`}</td>
                  <td className="table-td">{formatCurrency(p.amount_due)}</td>
                  <td className="table-td">{formatCurrency(p.amount_paid)}</td>
                  <td className="table-td">{p.report_received ? <span className="text-xs text-success">✓</span> : <span className="text-xs text-muted">—</span>}</td>
                  <td className="table-td"><Badge status={p.status} /></td>
                  <td className="table-td">
                    <div className="flex gap-2">
                      <button onClick={() => { setShowDeclare(p); setDeclareForm({ amount_due: "", base_calculo: "", notes: "" }); }} className="text-xs text-blue-400 hover:underline">Registrar Valor</button>
                      {p.status !== "paid" && (
                        <button onClick={() => { setShowConfirm(p); setConfirmForm({ amount_paid: "", payment_date: "", notes: "" }); }} className="text-xs text-success hover:underline">Confirmar</button>
                      )}
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
                    {" "}-{" "}
                    <code className="text-xs bg-surface px-1.5 py-0.5 rounded">{ev.event_type}</code>
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

      {/* Confirm Payment Modal */}
      <Modal isOpen={!!showConfirm} onClose={() => setShowConfirm(null)} title="Confirmar Pagamento">
        <form onSubmit={handleConfirmPayment} className="space-y-4">
          <div>
            <label className="label">Valor Pago (R$) *</label>
            <input type="number" step="0.01" className="input" required value={confirmForm.amount_paid} onChange={e => setConfirmForm(f => ({ ...f, amount_paid: e.target.value }))} />
          </div>
          <div>
            <label className="label">Data do Pagamento *</label>
            <input type="date" className="input" required value={confirmForm.payment_date} onChange={e => setConfirmForm(f => ({ ...f, payment_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">Observações</label>
            <textarea className="input h-20 resize-none" value={confirmForm.notes} onChange={e => setConfirmForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowConfirm(null)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">Confirmar Pagamento</button>
          </div>
        </form>
      </Modal>

      {/* Registrar Valor Devido Modal */}
      <Modal isOpen={!!showDeclare} onClose={() => setShowDeclare(null)} title="Registrar Valor Devido">
        <form onSubmit={handleDeclareValue} className="space-y-4">
          <p className="text-sm text-muted">O valor é apurado pelo próprio agente operador e informado no relatório. O escritório apenas registra o que foi informado — não há cálculo a partir do GGR.</p>
          <div>
            <label className="label">Valor Devido informado pelo operador (R$) *</label>
            <input type="number" step="0.01" className="input" required value={declareForm.amount_due} onChange={e => setDeclareForm(f => ({ ...f, amount_due: e.target.value }))} />
          </div>
          <div>
            <label className="label">Base de Cálculo (R$) <span className="text-muted">(opcional, do relatório)</span></label>
            <input type="number" step="0.01" className="input" value={declareForm.base_calculo} onChange={e => setDeclareForm(f => ({ ...f, base_calculo: e.target.value }))} />
          </div>
          <div>
            <label className="label">Observações</label>
            <textarea className="input h-16 resize-none" value={declareForm.notes} onChange={e => setDeclareForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowDeclare(null)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">Registrar</button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
