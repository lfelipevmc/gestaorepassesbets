"use client";
import { useState, useEffect } from "react";
import AppShell from "@/components/AppShell";
import { toast } from "@/components/ui/Toast";
import {
  getEndrEntity, updateEndrEntity,
  getEndrMonthly, getEndrAvailableOperators,
  addEndrMonthly, removeEndrMonthly,
  getEndrAcompanhamento, uploadEndrDocument, deleteEndrDocument,
} from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const SITUACAO: Record<string, { label: string; cls: string }> = {
  regular: { label: "Regular", cls: "bg-success/15 text-success border-success/30" },
  aguardando_relatorio: { label: "Aguardando relatório", cls: "bg-warning/15 text-warning border-warning/30" },
  sem_repasse: { label: "Sem repasse", cls: "bg-surface text-muted border-surface-border" },
};

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtMonth(ym?: string | null) {
  if (!ym) return "—";
  return new Date(ym.slice(0, 7) + "-15T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
}

type ENDREntity = {
  id: number; name: string; cnpj?: string; website?: string;
  phone?: string; email?: string; address?: string; notes?: string;
};
type AssocRow = {
  assoc_id: number; operator_id: number; company_name: string;
  fantasy_name?: string; cnpj?: string; reference_month: string; notes?: string;
};
type OpOption = { id: number; company_name: string; fantasy_name?: string; cnpj?: string };

function toFirstOfMonth(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function EndrPage() {
  const today = new Date();
  const [month, setMonth] = useState(toFirstOfMonth(today));
  const [entity, setEntity] = useState<ENDREntity | null>(null);
  const [editEntity, setEditEntity] = useState(false);
  const [entityForm, setEntityForm] = useState<Partial<ENDREntity>>({});
  const [assocs, setAssocs] = useState<AssocRow[]>([]);
  const [available, setAvailable] = useState<OpOption[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<{ operator_ids: number[]; months: string[]; notes: string; opFilter: string }>({ operator_ids: [], months: [], notes: "", opFilter: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"acomp" | "mensal">("acomp");
  const [acomp, setAcomp] = useState<any>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [docForm, setDocForm] = useState<{ file: File | null; title: string; month: string; conf: string; description: string }>({ file: null, title: "", month: "", conf: "", description: "" });
  const [uploading, setUploading] = useState(false);

  useEffect(() => { loadEntity(); loadAcomp(); }, []);
  useEffect(() => { loadMonthly(); }, [month]);

  async function loadAcomp() {
    try { const r = await getEndrAcompanhamento(); setAcomp(r.data); } catch { /* ignore */ }
  }

  async function handleUploadDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!docForm.file) { toast.warn("Selecione um arquivo."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", docForm.file);
      fd.append("title", docForm.title || docForm.file.name);
      if (docForm.month) fd.append("reference_month", docForm.month + "-01");
      if (docForm.conf) fd.append("confederation_id", docForm.conf);
      if (docForm.description) fd.append("description", docForm.description);
      await uploadEndrDocument(fd);
      setShowUpload(false);
      setDocForm({ file: null, title: "", month: "", conf: "", description: "" });
      loadAcomp();
      setMsg("Documento ENDR salvo com sucesso.");
    } catch (err: any) { toast.error(err.response?.data?.detail || "Erro ao enviar documento"); }
    finally { setUploading(false); }
  }

  async function loadEntity() {
    try { const r = await getEndrEntity(); setEntity(r.data); setEntityForm(r.data); }
    catch { /* ignore */ }
  }

  async function loadMonthly() {
    try {
      const [ra, rv] = await Promise.all([getEndrMonthly(month), getEndrAvailableOperators(month)]);
      setAssocs(ra.data);
      setAvailable(rv.data);
    } catch { /* ignore */ }
  }

  async function saveEntity() {
    setSaving(true);
    try {
      const r = await updateEndrEntity(entityForm);
      setEntity(r.data);
      setEditEntity(false);
      setMsg("Cadastro salvo com sucesso.");
    } catch { setMsg("Erro ao salvar."); }
    setSaving(false);
  }

  async function handleAdd() {
    if (addForm.operator_ids.length === 0) return;
    // Se nenhum mês extra foi marcado, usa o mês em exibição
    const months = addForm.months.length > 0 ? addForm.months : [month.slice(0, 7)];
    setSaving(true);
    let ok = 0, fail = 0;
    for (const opId of addForm.operator_ids) {
      for (const ym of months) {
        try {
          await addEndrMonthly({ operator_id: opId, reference_month: `${ym}-01`, notes: addForm.notes || null });
          ok++;
        } catch { fail++; }
      }
    }
    setShowAdd(false);
    setAddForm({ operator_ids: [], months: [], notes: "", opFilter: "" });
    loadMonthly();
    setMsg(`${ok} associação(ões) registrada(s)${fail ? ` · ${fail} falhou(aram) (possivelmente já existiam)` : ""}.`);
    setSaving(false);
  }

  function toggleOp(id: number) {
    setAddForm(f => ({ ...f, operator_ids: f.operator_ids.includes(id) ? f.operator_ids.filter(x => x !== id) : [...f.operator_ids, id] }));
  }
  function toggleMonth(ym: string) {
    setAddForm(f => ({ ...f, months: f.months.includes(ym) ? f.months.filter(m => m !== ym) : [...f.months, ym] }));
  }

  async function handleRemove(assocId: number) {
    if (!confirm("Remover esta bet da lista ENDR do mês?")) return;
    await removeEndrMonthly(assocId);
    loadMonthly();
  }

  const displayMonth = new Date(month + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <AppShell>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">ENDR</h1>
          <p className="text-muted text-sm mt-1">Escritório Nacional de Direitos de Rateio</p>
        </div>
      </div>

      {msg && (
        <div className="bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          {msg}
          <button onClick={() => setMsg("")} className="ml-4 text-muted hover:text-white">✕</button>
        </div>
      )}

      {/* Cadastro ENDR */}
      <div className="bg-surface-card border border-surface-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Dados Cadastrais</h2>
          {!editEntity ? (
            <button onClick={() => setEditEntity(true)} className="px-4 py-1.5 text-sm bg-primary/15 text-primary border border-primary/30 rounded-lg hover:bg-primary/25 transition-colors">
              Editar
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditEntity(false)} className="px-4 py-1.5 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">Cancelar</button>
              <button onClick={saveEntity} disabled={saving} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors disabled:opacity-50">
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          )}
        </div>

        {editEntity ? (
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Nome", key: "name" },
              { label: "CNPJ", key: "cnpj" },
              { label: "Website", key: "website" },
              { label: "Telefone", key: "phone" },
              { label: "E-mail", key: "email" },
              { label: "Endereço", key: "address" },
            ].map(({ label, key }) => (
              <div key={key} className={key === "address" ? "col-span-2" : ""}>
                <label className="block text-xs text-muted mb-1">{label}</label>
                <input
                  className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  value={(entityForm as any)[key] || ""}
                  onChange={e => setEntityForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="col-span-2">
              <label className="block text-xs text-muted mb-1">Observações</label>
              <textarea
                rows={3}
                className="w-full bg-surface-border border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                value={entityForm.notes || ""}
                onChange={e => setEntityForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Nome", val: entity?.name },
              { label: "CNPJ", val: entity?.cnpj },
              { label: "Website", val: entity?.website },
              { label: "Telefone", val: entity?.phone },
              { label: "E-mail", val: entity?.email },
              { label: "Endereço", val: entity?.address },
            ].map(({ label, val }) => (
              <div key={label}>
                <p className="text-xs text-muted">{label}</p>
                <p className="text-sm text-white mt-0.5">{val || <span className="text-slate-500 italic">—</span>}</p>
              </div>
            ))}
            {entity?.notes && (
              <div className="col-span-3">
                <p className="text-xs text-muted">Observações</p>
                <p className="text-sm text-white mt-0.5">{entity.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Abas */}
      <div className="flex gap-2 border-b border-surface-border">
        {[{ id: "acomp", label: "📊 Acompanhamento" }, { id: "mensal", label: "📋 Bets Associadas (mensal)" }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition-colors ${tab === t.id ? "border-primary text-primary font-semibold" : "border-transparent text-muted hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "acomp" && (
        <div className="space-y-6">
          {/* Resumo por confederação — consolidado automaticamente */}
          <div className="bg-surface-card border border-surface-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-white">Repasses ENDR por Confederação</h2>
              {acomp && <span className="text-sm text-muted">Total geral: <span className="text-white font-semibold">{fmtBRL(acomp.total_geral || 0)}</span></span>}
            </div>
            <p className="text-xs text-muted mb-4">Consolidação automática dos repasses registrados na aba "Repasses ENDR" de cada confederação — não é necessário lançar novamente aqui.</p>
            {!acomp ? <p className="text-muted text-sm">Carregando...</p> : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {acomp.confederations.map((c: any) => {
                  const sit = SITUACAO[c.situacao] || SITUACAO.sem_repasse;
                  return (
                    <div key={c.confederation_id} className="bg-surface border border-surface-border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <a href={`/confederacoes/${c.confederation_id}`} className="font-semibold text-white hover:text-primary">{c.acronym}</a>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${sit.cls}`}>{sit.label}</span>
                      </div>
                      <p className="text-xl font-bold text-white">{fmtBRL(c.total_received)}</p>
                      <p className="text-[11px] text-muted mt-1">{c.count} repasse(s){c.pending_reports ? ` · ${c.pending_reports} sem relatório` : ""}</p>
                      <p className="text-[11px] text-muted">Último: {c.last_date ? new Date(c.last_date + "T12:00:00").toLocaleDateString("pt-BR") : "—"}{c.last_amount != null ? ` · ${fmtBRL(c.last_amount)}` : ""}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Histórico de repasses */}
          {acomp && acomp.payments.length > 0 && (
            <div className="bg-surface-card border border-surface-border rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Histórico de Repasses</h2>
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border text-left text-xs text-muted">
                      <th className="py-2 px-3">Confederação</th>
                      <th className="py-2 px-3">Data recebimento</th>
                      <th className="py-2 px-3">Valor</th>
                      <th className="py-2 px-3">Competência</th>
                      <th className="py-2 px-3">Operadores no relatório</th>
                      <th className="py-2 px-3">Relatório</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acomp.payments.map((p: any) => (
                      <tr key={p.id} className="border-b border-surface-border/50 hover:bg-surface-border/30">
                        <td className="py-2 px-3 text-white font-medium">{p.acronym}</td>
                        <td className="py-2 px-3 text-slate-300">{new Date(p.received_date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                        <td className="py-2 px-3 text-slate-200">{fmtBRL(p.amount_received)}</td>
                        <td className="py-2 px-3 capitalize">{p.reference_month ? fmtMonth(p.reference_month) : <span className="text-warning text-xs">a definir</span>}</td>
                        <td className="py-2 px-3 text-slate-400 text-xs">{p.operators.length > 0 ? `${p.operators.length} bet(s)` : "—"}</td>
                        <td className="py-2 px-3">{p.report_file_url ? <a href={API_BASE + p.report_file_url} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">Ver</a> : <span className="text-muted text-xs">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Gestão documental */}
          <div className="bg-surface-card border border-surface-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Documentos ENDR</h2>
                <p className="text-xs text-muted mt-0.5">Relatórios, listas e ofícios do ENDR, vinculados à competência.</p>
              </div>
              <button onClick={() => setShowUpload(v => !v)} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors">
                {showUpload ? "Cancelar" : "+ Documento"}
              </button>
            </div>
            {showUpload && (
              <form onSubmit={handleUploadDoc} className="mb-4 bg-surface-border rounded-lg p-4 grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-muted mb-1">Arquivo *</label>
                  <input type="file" className="text-sm text-slate-300" onChange={e => setDocForm(f => ({ ...f, file: e.target.files?.[0] || null }))} />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Título</label>
                  <input className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white" value={docForm.title} onChange={e => setDocForm(f => ({ ...f, title: e.target.value }))} placeholder="ex: Relatório ENDR mai/2025" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Competência</label>
                  <input type="month" className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white" value={docForm.month} onChange={e => setDocForm(f => ({ ...f, month: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Confederação (opcional)</label>
                  <select className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white" value={docForm.conf} onChange={e => setDocForm(f => ({ ...f, conf: e.target.value }))}>
                    <option value="">— Geral / todas —</option>
                    {(acomp?.confederations || []).map((c: any) => <option key={c.confederation_id} value={c.confederation_id}>{c.acronym}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Descrição (opcional)</label>
                  <input className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white" value={docForm.description} onChange={e => setDocForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <button type="submit" disabled={uploading} className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50">{uploading ? "Enviando..." : "Salvar documento"}</button>
                </div>
              </form>
            )}
            {(!acomp || acomp.documents.length === 0) ? (
              <p className="text-muted text-sm">Nenhum documento ENDR cadastrado.</p>
            ) : (
              <div className="table-wrap"><table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-left text-xs text-muted">
                    <th className="py-2 px-3">Título</th>
                    <th className="py-2 px-3">Competência</th>
                    <th className="py-2 px-3">Confederação</th>
                    <th className="py-2 px-3">Enviado em</th>
                    <th className="py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {acomp.documents.map((d: any) => (
                    <tr key={d.id} className="border-b border-surface-border/50 hover:bg-surface-border/30">
                      <td className="py-2 px-3 text-white">{d.title}{d.description ? <span className="block text-[11px] text-muted">{d.description}</span> : null}</td>
                      <td className="py-2 px-3 capitalize">{fmtMonth(d.reference_month)}</td>
                      <td className="py-2 px-3 text-slate-300">{d.acronym || "Geral"}</td>
                      <td className="py-2 px-3 text-slate-400 text-xs">{d.created_at ? new Date(d.created_at).toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <a href={API_BASE + d.file_path} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline mr-3">Baixar</a>
                        <button onClick={async () => { if (confirm("Excluir este documento?")) { await deleteEndrDocument(d.id); loadAcomp(); } }} className="text-danger text-xs hover:underline">Excluir</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>

          {/* Linha do tempo */}
          <div className="bg-surface-card border border-surface-border rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-1">Linha do Tempo — desde jan/2025</h2>
            <p className="text-xs text-muted mb-4">Entradas e saídas de agentes do ENDR e competências cobertas por relatório, mês a mês.</p>
            {!acomp ? <p className="text-muted text-sm">Carregando...</p> : (
              <div className="space-y-3 max-h-[520px] overflow-y-auto pr-2">
                {acomp.timeline.map((t: any) => (
                  <div key={t.month} className="flex gap-4 items-start">
                    <div className="w-24 flex-shrink-0 text-right">
                      <p className="text-sm text-white font-medium capitalize">{fmtMonth(t.month)}</p>
                      <p className="text-[11px] text-muted">{t.associated_count} associada(s)</p>
                    </div>
                    <div className="flex-1 border-l-2 border-surface-border pl-4 pb-2 min-w-0">
                      {t.entered.length === 0 && t.left.length === 0 && t.reports.length === 0 && (
                        <p className="text-xs text-muted italic">Sem movimentação.</p>
                      )}
                      {t.entered.length > 0 && (
                        <p className="text-xs text-success mb-1">▲ Entraram: <span className="text-slate-300">{t.entered.join(", ")}</span></p>
                      )}
                      {t.left.length > 0 && (
                        <p className="text-xs text-danger mb-1">▼ Saíram: <span className="text-slate-300">{t.left.join(", ")}</span></p>
                      )}
                      {t.reports.map((r: any, i: number) => (
                        <p key={i} className="text-xs text-primary">📄 Relatório {r.acronym}: {fmtBRL(r.amount)} · {r.operators_count} bet(s) nesta competência</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Visão Mensal */}
      {tab === "mensal" && (
      <div className="bg-surface-card border border-surface-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-white">Bets Associadas</h2>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted">Mês:</label>
              <input
                type="month"
                value={month.slice(0, 7)}
                onChange={e => setMonth(e.target.value + "-01")}
                className="bg-surface-border border border-surface-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
              />
            </div>
            <span className="text-sm text-muted capitalize">{displayMonth} — {assocs.length} bet{assocs.length !== 1 ? "s" : ""}</span>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
          >
            + Adicionar Bet
          </button>
        </div>

        {showAdd && (
          <div className="mb-4 bg-surface-border border border-surface-border rounded-lg p-4 space-y-4">
            <div>
              <label className="block text-xs text-muted mb-1">Agentes Operadores <span className="text-slate-400">(marque um ou vários)</span></label>
              <input
                className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary mb-2"
                placeholder="Filtrar por nome ou CNPJ..."
                value={addForm.opFilter}
                onChange={e => setAddForm(f => ({ ...f, opFilter: e.target.value }))}
              />
              <div className="max-h-48 overflow-y-auto border border-surface-border rounded-lg divide-y divide-surface-border bg-surface-card">
                {available
                  .filter(op => {
                    const t = addForm.opFilter.toLowerCase();
                    if (!t) return true;
                    return op.company_name.toLowerCase().includes(t) || (op.fantasy_name || "").toLowerCase().includes(t) || (op.cnpj || "").includes(t);
                  })
                  .map(op => (
                    <label key={op.id} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-surface cursor-pointer">
                      <input type="checkbox" checked={addForm.operator_ids.includes(op.id)} onChange={() => toggleOp(op.id)} />
                      <span className="flex-1">{op.company_name}{op.fantasy_name ? ` (${op.fantasy_name})` : ""}</span>
                      <span className="text-xs text-muted font-mono">{op.cnpj || ""}</span>
                    </label>
                  ))}
                {available.length === 0 && <p className="px-3 py-2 text-xs text-muted">Todas as bets já estão associadas neste mês.</p>}
              </div>
              {addForm.operator_ids.length > 0 && <p className="text-xs text-primary mt-1">{addForm.operator_ids.length} selecionada(s)</p>}
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Meses <span className="text-slate-400">(vazio = apenas {displayMonth}; marque para incluir vários meses do ano)</span></label>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 12 }, (_, i) => {
                  const y = month.slice(0, 4);
                  const ym = `${y}-${String(i + 1).padStart(2, "0")}`;
                  const label = new Date(`${ym}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short" });
                  const checked = addForm.months.includes(ym);
                  return (
                    <label key={ym} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border cursor-pointer capitalize ${checked ? "bg-primary/15 text-primary border-primary/30" : "border-surface-border text-slate-300 hover:bg-surface"}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleMonth(ym)} />
                      {label}/{y.slice(2)}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1">Observação (opcional)</label>
                <input
                  className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  placeholder="ex: lista ENDR de 29/04..."
                  value={addForm.notes}
                  onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <button onClick={handleAdd} disabled={saving || addForm.operator_ids.length === 0} className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors">
                {saving ? "Registrando..." : "Adicionar"}
              </button>
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted border border-surface-border rounded-lg hover:bg-surface-border transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {assocs.length === 0 ? (
          <div className="text-center py-10 text-muted text-sm">
            Nenhuma bet associada ao ENDR em {displayMonth}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left py-2 px-3 text-xs text-muted font-medium">Razão Social</th>
                  <th className="text-left py-2 px-3 text-xs text-muted font-medium">Nome Fantasia</th>
                  <th className="text-left py-2 px-3 text-xs text-muted font-medium">CNPJ</th>
                  <th className="text-left py-2 px-3 text-xs text-muted font-medium">Observação</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {assocs.map(a => (
                  <tr key={a.assoc_id} className="border-b border-surface-border/50 hover:bg-surface-border/30 transition-colors">
                    <td className="py-2.5 px-3 text-white font-medium">
                      <a href={`/operadores/${a.operator_id}`} className="hover:text-primary transition-colors">
                        {a.company_name}
                      </a>
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">{a.fantasy_name || "—"}</td>
                    <td className="py-2.5 px-3 text-slate-400 font-mono text-xs">{a.cnpj || "—"}</td>
                    <td className="py-2.5 px-3 text-slate-400">{a.notes || "—"}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => handleRemove(a.assoc_id)}
                        className="px-3 py-1 text-xs text-danger border border-danger/30 rounded hover:bg-danger/10 transition-colors"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
    </AppShell>
  );
}
