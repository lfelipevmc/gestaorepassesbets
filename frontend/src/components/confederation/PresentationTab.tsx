"use client";
import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { getConfPresentation, downloadConfPresentationPdf, updateConfederation } from "@/lib/api";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { toast } from "@/components/ui/Toast";
import PdfLogoModal from "@/components/reports/PdfLogoModal";

/**
 * Aba 📽 Apresentação — dashboard-relatório para as reuniões de monitoramento
 * com cada confederação. Read-only sobre a base central (fonte única); o único
 * dado editável são os "Encaminhamentos combinados" (próximos passos da reunião).
 */

// Paleta validada (dataviz, dark #1a2030): direto azul, ENDR verde
const C_DIRETO = "#3987e5";
const C_ENDR = "#199e70";
const SURFACE = "#1a2030";

const CONC_META: Record<string, { label: string; color: string }> = {
  adimplente: { label: "Adimplentes", color: "#199e70" },
  endr: { label: "via ENDR", color: "#3987e5" },
  consignacao: { label: "Consignação", color: "#c98500" },
  sem_obrigacao: { label: "Sem obrigação", color: "#5b6675" },
  inadimplente: { label: "Inadimplentes", color: "#e66767" },
};

const EV_LABEL: Record<string, string> = {
  notification_sent: "✉ Notificação enviada",
  payment_confirmed: "✓ Recebimento confirmado",
  report_received: "📄 Relatório recebido",
  report_requested: "📄 Relatório solicitado",
  email_read: "↩ Resposta recebida",
  phone_contact: "☎ Contato telefônico",
  check_performed: "✔ Verificação realizada",
  manual_note: "✎ Registro manual",
};

function Stat({ value, label, sub, color = "text-white" }: { value: string | number; label: string; sub?: string; color?: string }) {
  return (
    <div className="card text-center">
      <p className={`text-2xl lg:text-3xl font-bold num ${color}`}>{value}</p>
      <p className="text-xs text-muted mt-1">{label}</p>
      {sub && <p className="text-[11px] text-muted/80 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionTitle({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-3">
      <span className="text-xs font-bold text-primary bg-primary/10 border border-primary/30 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">{n}</span>
      <h3 className="font-semibold text-white text-base lg:text-lg">{title}</h3>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

export default function PresentationTab({ confId }: { confId: number }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [pdfModal, setPdfModal] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [steps, setSteps] = useState("");
  const [savingSteps, setSavingSteps] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getConfPresentation(confId, `${month}-01`)
      .then(r => { setData(r.data); setSteps(r.data.proximos?.next_steps || ""); })
      .catch(() => toast.error("Erro ao carregar a apresentação."))
      .finally(() => setLoading(false));
  }, [confId, month]);
  useEffect(() => { load(); }, [load]);

  // Esc sai do modo apresentação
  useEffect(() => {
    if (!presenting) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setPresenting(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [presenting]);

  async function saveSteps() {
    setSavingSteps(true);
    try {
      await updateConfederation(confId, { next_steps: steps });
      toast.success("Encaminhamentos salvos — ficam registrados para a próxima reunião.");
    } catch { toast.error("Erro ao salvar os encaminhamentos."); }
    finally { setSavingSteps(false); }
  }

  async function exportPdf(logos: any) {
    setPdfBusy(true);
    try {
      const r = await downloadConfPresentationPdf(confId, { month: `${month}-01`, logo_office: logos.logo_office, logo_conf: logos.logo_conf });
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `monitoramento_${data?.confederation?.acronym || confId}_${month.replace("-", "_")}.pdf`; a.click();
      URL.revokeObjectURL(url);
      setPdfModal(false);
    } catch { toast.error("Erro ao gerar o relatório em PDF."); }
    finally { setPdfBusy(false); }
  }

  if (loading && !data) return <div className="text-muted py-12 text-center">Carregando apresentação...</div>;
  if (!data) return null;

  const s = data.summary;
  const t = data.trabalho;
  const chartData = data.monthly.map((m: any) => ({ ...m, total: m.direto + m.endr }));
  const concOrder = ["adimplente", "endr", "consignacao", "sem_obrigacao", "inadimplente"];
  const concTotal = Math.max(s.bets_total, 1);

  const frase = `De ${s.bets_total} bets monitoradas em ${data.month_label}: ` +
    concOrder.filter(k => s.counts[k] > 0).map(k => `${s.counts[k]} ${CONC_META[k].label.toLowerCase()}`).join(", ") + ".";

  const content = (
    <div className={presenting ? "space-y-8" : "space-y-6"}>
      {/* Barra de controles */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <input type="month" className="input w-44" value={month} onChange={e => setMonth(e.target.value)} />
          {loading && <span className="text-xs text-muted">Atualizando…</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPdfModal(true)} className="btn-secondary">⬇ Exportar PDF</button>
          {!presenting
            ? <button onClick={() => setPresenting(true)} className="btn-primary">▶ Modo apresentação</button>
            : <button onClick={() => setPresenting(false)} className="btn-secondary">✕ Sair (Esc)</button>}
        </div>
      </div>

      {/* 1 — RESUMO EXECUTIVO */}
      <section>
        <SectionTitle n={1} title="Resumo Executivo" sub={`competência ${data.month_label}`} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat value={formatCurrency(s.total_acumulado)} label="Total recebido (acumulado)"
            sub={`Direto ${formatCurrency(s.acumulado_direto)} · ENDR ${formatCurrency(s.acumulado_endr)}`} color="text-success" />
          <Stat value={formatCurrency(s.recebido_mes)} label={`Recebido em ${data.month_label}`}
            sub={`Direto ${formatCurrency(s.recebido_mes_direto)} · ENDR ${formatCurrency(s.recebido_mes_endr)}`} color="text-success" />
          <Stat value={`${s.taxa_conformidade}%`} label="Conformidade no mês"
            sub={`${s.em_conformidade} de ${s.bets_total} bets`} color={s.taxa_conformidade >= 80 ? "text-success" : "text-warning"} />
          <Stat value={s.counts.inadimplente} label="Inadimplentes"
            color={s.counts.inadimplente > 0 ? "text-danger" : "text-success"} />
        </div>
        {/* Composição das conclusões */}
        <div className="card mt-4">
          <p className="text-sm text-slate-200 mb-3">{frase}</p>
          <div className="flex h-4 rounded-full overflow-hidden" role="img" aria-label={frase}>
            {concOrder.map(k => s.counts[k] > 0 && (
              <div key={k} style={{ width: `${(s.counts[k] / concTotal) * 100}%`, background: CONC_META[k].color, marginRight: 2 }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {concOrder.map(k => (
              <span key={k} className="flex items-center gap-1.5 text-xs text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: CONC_META[k].color }} />
                {CONC_META[k].label}: <b className="num">{s.counts[k]}</b>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 2 — TRABALHO DESENVOLVIDO */}
      <section>
        <SectionTitle n={2} title="Trabalho Desenvolvido pelo Escritório" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat value={t.notificacoes_total} label="Notificações enviadas" sub={`${t.notificacoes_mes} no mês`} />
          <Stat value={t.respostas_total} label="Respostas recebidas" sub={`${t.respostas_mes} no mês`} />
          <Stat value={t.oficios_spa} label="Ofícios à SPA" />
          <Stat value={t.relatorios_anexados} label="Relatórios arquivados" />
        </div>
        {t.timeline.length > 0 && (
          <div className="card mt-4">
            <p className="text-xs text-muted mb-3">Últimas diligências registradas</p>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {t.timeline.map((ev: any, i: number) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="text-[11px] text-muted num flex-shrink-0 w-28">{ev.date ? formatDateTime(ev.date) : "—"}</span>
                  <span className="text-slate-200 flex-shrink-0">{EV_LABEL[ev.type] || ev.type}</span>
                  <span className="text-xs text-muted truncate">{ev.operator ? `${ev.operator} · ` : ""}{ev.notes}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 3 — RECEBIMENTOS */}
      <section>
        <SectionTitle n={3} title="Recebimentos" sub="repasses diretos × via ENDR, últimos 12 meses (competência)" />
        <div className="card">
          <ResponsiveContainer width="100%" height={presenting ? 340 : 260}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#8b94a3", fontSize: 11 }} axisLine={{ stroke: "#2d3748" }} tickLine={false} />
              <YAxis tick={{ fill: "#8b94a3", fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v)} />
              <Tooltip
                formatter={(v: any, name: any) => [formatCurrency(Number(v)), name === "direto" ? "Repasses diretos" : "via ENDR"]}
                labelStyle={{ color: "#e2e8f0" }}
                contentStyle={{ background: "#0d1526", border: "1px solid #2d3748", borderRadius: 8, fontSize: 12 }}
                cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Legend formatter={(v: string) => <span className="text-xs text-slate-300">{v === "direto" ? "Repasses diretos" : "via ENDR"}</span>} />
              <Bar dataKey="direto" stackId="r" fill={C_DIRETO} stroke={SURFACE} strokeWidth={2} />
              <Bar dataKey="endr" stackId="r" fill={C_ENDR} stroke={SURFACE} strokeWidth={2} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {data.recebimentos_mes.length > 0 && (
          <div className="card p-0 overflow-hidden mt-4">
            <div className="p-3 border-b border-surface-border"><p className="text-sm font-semibold text-white">Recebimentos individualizados em {data.month_label}</p></div>
            <div className="table-wrap"><table className="w-full text-sm">
              <thead className="bg-surface"><tr>
                <th className="table-th">Agente Operador</th><th className="table-th">Valor</th>
                <th className="table-th">Último pagamento</th><th className="table-th">Relatório</th>
              </tr></thead>
              <tbody>
                {data.recebimentos_mes.map((r: any) => (
                  <tr key={r.operator_id} className="border-b border-surface-border/50">
                    <td className="table-td text-white">{r.label}</td>
                    <td className="table-td text-success num">{formatCurrency(r.total)}</td>
                    <td className="table-td text-muted num">{r.last_date ? formatDate(r.last_date) : "—"}</td>
                    <td className="table-td">{r.report_url ? <span className="text-success text-xs">✓ Recebido</span> : <span className="text-muted text-xs">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </section>

      {/* 4 — ENDR */}
      <section>
        <SectionTitle n={4} title="Repasses via ENDR" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <Stat value={formatCurrency(data.endr.total)} label="Total via ENDR" color="text-success" />
          <Stat value={data.endr.count} label="Repasses recebidos" />
          <Stat value={data.endr.associadas_mes} label="Bets associadas no mês" />
          <Stat value={data.endr.pendentes_relatorio} label="Aguardando relatório"
            color={data.endr.pendentes_relatorio > 0 ? "text-warning" : "text-success"} />
        </div>
        {data.endr.ultimos.length > 0 && (
          <div className="card p-0 overflow-hidden">
            <div className="table-wrap"><table className="w-full text-sm">
              <thead className="bg-surface"><tr>
                <th className="table-th">Recebido em</th><th className="table-th">Valor</th>
                <th className="table-th">Competência</th><th className="table-th">Bets no relatório</th><th className="table-th">Relatório</th>
              </tr></thead>
              <tbody>
                {data.endr.ultimos.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-surface-border/50">
                    <td className="table-td num">{r.received_date ? formatDate(r.received_date) : "—"}</td>
                    <td className="table-td text-success num">{formatCurrency(r.amount)}</td>
                    <td className="table-td">{r.competencia}</td>
                    <td className="table-td num">{r.bets || "—"}</td>
                    <td className="table-td">{r.report_url ? <span className="text-success text-xs">✓</span> : <span className="text-warning text-xs">Pendente</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </section>

      {/* 5 — PENDÊNCIAS */}
      <section>
        <SectionTitle n={5} title="Pendências" sub={`inadimplentes em ${data.month_label}`} />
        {data.pendencias.length === 0 ? (
          <div className="card text-center py-6 text-success text-sm">✓ Nenhuma bet inadimplente na competência.</div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="table-wrap"><table className="w-full text-sm">
              <thead className="bg-surface"><tr>
                <th className="table-th">Agente Operador</th><th className="table-th">Valor declarado</th>
                <th className="table-th">Notificações</th><th className="table-th">Última notificação</th><th className="table-th">Resposta</th>
              </tr></thead>
              <tbody>
                {data.pendencias.map((p: any) => (
                  <tr key={p.operator_id} className="border-b border-surface-border/50">
                    <td className="table-td text-white">{p.label}{p.cnpj && <span className="block text-[11px] text-muted font-mono">{p.cnpj}</span>}</td>
                    <td className="table-td num">{p.amount_due ? formatCurrency(p.amount_due) : <span className="text-muted text-xs">não declarado</span>}</td>
                    <td className="table-td num">{p.notif_count}</td>
                    <td className="table-td text-muted num">{p.last_notification_at ? formatDate(p.last_notification_at) : "—"}</td>
                    <td className="table-td">{p.replied
                      ? <span className="text-xs text-success">↩ Respondeu{p.replied_at ? ` (${formatDate(p.replied_at)})` : ""}</span>
                      : <span className="text-xs text-danger">Sem resposta</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </section>

      {/* 6 — PRÓXIMOS PASSOS */}
      <section>
        <SectionTitle n={6} title="Próximos Passos" />
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card">
            <p className="text-sm font-semibold text-white mb-3">Cronograma do ciclo</p>
            {data.proximos.cronograma.length === 0
              ? <p className="text-xs text-muted">Nenhum ciclo ativo — crie o ciclo da competência em Cobranças.</p>
              : (
                <div className="space-y-2">
                  {data.proximos.cronograma.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm border-b border-surface-border/40 pb-2 last:border-0">
                      <span className={c.done ? "text-muted line-through" : "text-slate-200"}>{c.done ? "✓ " : ""}{c.label}</span>
                      <span className="text-xs text-muted num flex-shrink-0 ml-3">{formatDate(c.due)}</span>
                    </div>
                  ))}
                </div>
              )}
          </div>
          <div className="card">
            <p className="text-sm font-semibold text-white mb-1">Encaminhamentos combinados</p>
            <p className="text-xs text-muted mb-2">Registre aqui o que foi acordado na reunião — o texto fica salvo e reaparece no próximo monitoramento (e no PDF).</p>
            <textarea className="input h-32 resize-none text-sm" value={steps} onChange={e => setSteps(e.target.value)}
              placeholder={"Ex.:\n• Aguardar posicionamento da Bet X até 20/08\n• Protocolar ofício à SPA na próxima semana"} />
            <div className="flex justify-end mt-2">
              <button onClick={saveSteps} disabled={savingSteps} className="btn-primary">{savingSteps ? "Salvando..." : "Salvar encaminhamentos"}</button>
            </div>
          </div>
        </div>
      </section>

      <p className="text-[11px] text-muted text-center pb-2">
        Relatório de monitoramento · {data.confederation.acronym} · gerado a partir da base central (fonte única) · {formatDate(data.generated_at)}
      </p>

      <PdfLogoModal open={pdfModal} onClose={() => setPdfModal(false)} busy={pdfBusy}
        onConfirm={exportPdf} showConfederation confederationLabel={data.confederation.acronym} />
    </div>
  );

  if (presenting) {
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto bg-surface p-6 lg:p-10">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            {data.confederation.logo_url && (
              <img src={(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000") + data.confederation.logo_url}
                alt="" className="h-12 w-12 object-contain rounded-lg bg-surface border border-surface-border" />
            )}
            <div>
              <h2 className="text-xl font-bold text-white">Monitoramento — {data.confederation.name}</h2>
              <p className="text-sm text-muted">Competência {data.month_label} · Gestão de Haveres de Bets</p>
            </div>
          </div>
          {content}
        </div>
      </div>
    );
  }
  return content;
}
