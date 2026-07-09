"use client";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Modal from "@/components/ui/Modal";
import { getDocuments, uploadDocument, downloadDocument, getOperators, getConfederations, getEmailHistory, downloadEmailHistory } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/Toast";
import HelpTip from "@/components/ui/HelpTip";
import EmptyState from "@/components/ui/EmptyState";

const DOC_TYPES = [
  { value: "notification", label: "Notificação" },
  { value: "receipt", label: "Recibo" },
  { value: "report", label: "Relatório" },
  { value: "regulation", label: "Regulamento" },
  { value: "correspondence", label: "Correspondência" },
  { value: "contract", label: "Contrato / Convênio" },
  { value: "ggr_report", label: "Relatório GGR" },
  { value: "other", label: "Outro" },
];
const CATEGORIES = [
  { value: "documento_oficial", label: "Documento Oficial" },
  { value: "minuta", label: "Minuta" },
];

export default function DocumentosPage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [confederations, setConfederations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [groupBy, setGroupBy] = useState<"confederation" | "operator">("confederation");
  const [filters, setFilters] = useState({ confederation_id: "", operator_id: "", category: "", document_type: "" });
  const [form, setForm] = useState({ title: "", document_type: "other", category: "documento_oficial", operator_id: "", confederation_id: "", description: "" });
  const [tab, setTab] = useState<"arquivos" | "emails">("arquivos");

  const fetchAll = () => {
    setLoading(true);
    const params: any = {};
    if (filters.confederation_id) params.confederation_id = filters.confederation_id;
    if (filters.operator_id) params.operator_id = filters.operator_id;
    if (filters.category) params.category = filters.category;
    if (filters.document_type) params.document_type = filters.document_type;
    Promise.all([getDocuments(params), getOperators({ limit: 300 }), getConfederations()])
      .then(([d, ops, confs]) => { setDocuments(d.data); setOperators(ops.data); setConfederations(confs.data); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, [filters]); // eslint-disable-line

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", form.title);
    fd.append("document_type", form.document_type);
    fd.append("category", form.category);
    if (form.operator_id) fd.append("operator_id", form.operator_id);
    if (form.confederation_id) fd.append("confederation_id", form.confederation_id);
    if (form.description) fd.append("description", form.description);
    try {
      await uploadDocument(fd);
      setShowUpload(false);
      setFile(null);
      setForm({ title: "", document_type: "other", category: "documento_oficial", operator_id: "", confederation_id: "", description: "" });
      fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Erro ao fazer upload");
    } finally { setUploading(false); }
  }

  async function handleDownload(doc: any) {
    const r = await downloadDocument(doc.id);
    const url = URL.createObjectURL(new Blob([r.data]));
    const a = document.createElement("a");
    a.href = url; a.download = doc.file_name; a.click();
    URL.revokeObjectURL(url);
  }

  const docType = (t: string) => DOC_TYPES.find(x => x.value === t)?.label || t;
  const opName = (id: number) => { const o = operators.find(o => o.id === id); return o?.fantasy_name || o?.company_name; };
  const confAcr = (id: number) => confederations.find(c => c.id === id)?.acronym;

  // Agrupamento
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const d of documents) {
      let key: string;
      if (groupBy === "confederation") key = confAcr(d.confederation_id) || "Sem confederação";
      else key = opName(d.operator_id) || "Sem Bet vinculada";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [documents, groupBy, operators, confederations]);

  return (
    <AppShell>
      <Header
        title="Documentos"
        icon="📁"
        help="Repositório central: arquivos enviados manualmente e gerados pelo sistema, organizados por confederação ou por Bet, separando minutas de documentos oficiais. Na aba Histórico de E-mails você consulta e baixa o dossiê completo de comunicações de cada Bet para auditoria."
        subtitle="Repositório organizado por confederação e por Bet — minutas e documentos oficiais"
        actions={<button onClick={() => setShowUpload(true)} className="btn-primary">+ Enviar Documento</button>}
      />

      <div className="flex gap-2 mb-6 items-center">
        <button onClick={() => setTab("arquivos")} className={tab === "arquivos" ? "btn-primary" : "btn-secondary"}>📄 Arquivos</button>
        <button onClick={() => setTab("emails")} className={tab === "emails" ? "btn-primary" : "btn-secondary"}>✉️ Histórico de E-mails</button>
        <span className="ml-auto">
          <HelpTip
            title={tab === "arquivos" ? "Arquivos" : "Histórico de E-mails"}
            text={tab === "arquivos"
              ? "Todos os documentos do sistema, agrupados por confederação ou por Bet e filtráveis por categoria (minuta × documento oficial) e tipo. Relatórios anexados nos ciclos e nos Relatórios também aparecem aqui automaticamente."
              : "Auditoria de comunicação: selecione uma Bet para ver todos os e-mails enviados e respostas recebidas, com protocolo. O botão ⬇ Baixar dossiê gera um arquivo HTML com o histórico completo para arquivamento externo."}
            align="right" wide />
        </span>
      </div>

      {tab === "emails" && <EmailHistory operators={operators} confederations={confederations} />}

      {tab === "arquivos" && (<>
      {/* Filtros */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="label">Agrupar por</label>
            <select className="input" value={groupBy} onChange={e => setGroupBy(e.target.value as any)}>
              <option value="confederation">Confederação</option>
              <option value="operator">Bet</option>
            </select>
          </div>
          <div>
            <label className="label">Confederação</label>
            <select className="input" value={filters.confederation_id} onChange={e => setFilters(f => ({ ...f, confederation_id: e.target.value }))}>
              <option value="">Todas</option>
              {confederations.map(c => <option key={c.id} value={c.id}>{c.acronym}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Bet</label>
            <select className="input" value={filters.operator_id} onChange={e => setFilters(f => ({ ...f, operator_id: e.target.value }))}>
              <option value="">Todas</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.fantasy_name || o.company_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Categoria</label>
            <select className="input" value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
              <option value="">Todas</option>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Tipo</label>
            <select className="input" value={filters.document_type} onChange={e => setFilters(f => ({ ...f, document_type: e.target.value }))}>
              <option value="">Todos</option>
              {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? <div className="text-muted">Carregando...</div> : documents.length === 0 ? (
        <div className="card p-0"><EmptyState icon="📁" title="Nenhum documento encontrado" hint="Ajuste os filtros acima ou clique em + Enviar Documento para adicionar o primeiro arquivo." /></div>
      ) : (
        <div className="space-y-6">
          {groups.map(([groupName, docs]) => (
            <div key={groupName} className="card p-0 overflow-hidden">
              <div className="p-4 border-b border-surface-border bg-surface flex items-center justify-between">
                <h3 className="font-semibold text-white">{groupName}</h3>
                <span className="text-xs text-muted">{docs.length} documento(s)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-surface">
                    <tr>
                      <th className="table-th">Título</th>
                      <th className="table-th">Categoria</th>
                      <th className="table-th">Tipo</th>
                      <th className="table-th">{groupBy === "confederation" ? "Bet" : "Confederação"}</th>
                      <th className="table-th">Arquivo</th>
                      <th className="table-th">Data</th>
                      <th className="table-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d: any) => (
                      <tr key={d.id} className="hover:bg-surface-light/20">
                        <td className="table-td font-medium text-white">{d.title}</td>
                        <td className="table-td"><CategoryBadge value={d.category} /></td>
                        <td className="table-td text-muted">{docType(d.document_type)}</td>
                        <td className="table-td text-muted text-xs">
                          {groupBy === "confederation" ? (opName(d.operator_id) || "-") : (confAcr(d.confederation_id) || "-")}
                        </td>
                        <td className="table-td font-mono text-xs text-muted">{d.file_name}</td>
                        <td className="table-td text-muted">{formatDate(d.created_at)}</td>
                        <td className="table-td">
                          <button onClick={() => handleDownload(d)} className="text-primary text-xs hover:underline">Baixar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
      </>)}

      <Modal isOpen={showUpload} onClose={() => setShowUpload(false)} title="Enviar Documento" size="lg">
        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="label">Arquivo *</label>
            <input type="file" className="input" required onChange={e => setFile(e.target.files?.[0] || null)} />
          </div>
          <div>
            <label className="label">Título *</label>
            <input className="input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Categoria *</label>
              <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Tipo de Documento *</label>
              <select className="input" value={form.document_type} onChange={e => setForm(f => ({ ...f, document_type: e.target.value }))}>
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Agente Operador (Bet)</label>
              <select className="input" value={form.operator_id} onChange={e => setForm(f => ({ ...f, operator_id: e.target.value }))}>
                <option value="">Nenhum</option>
                {operators.map(o => <option key={o.id} value={o.id}>{o.fantasy_name || o.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Confederação</label>
              <select className="input" value={form.confederation_id} onChange={e => setForm(f => ({ ...f, confederation_id: e.target.value }))}>
                <option value="">Nenhuma</option>
                {confederations.map(c => <option key={c.id} value={c.id}>{c.acronym}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Descrição</label>
            <textarea className="input h-20 resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowUpload(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={uploading} className="btn-primary">{uploading ? "Enviando..." : "Enviar Documento"}</button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}

/* --------------------- Histórico de E-mails (item 14) --------------------- */
function EmailHistory({ operators, confederations }: { operators: any[]; confederations: any[] }) {
  const [opId, setOpId] = useState("");
  const [msgs, setMsgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function load(id: string) {
    if (!id) { setMsgs([]); return; }
    setLoading(true);
    try { const r = await getEmailHistory(parseInt(id)); setMsgs(r.data); }
    catch { setMsgs([]); }
    finally { setLoading(false); }
  }

  async function handleDownload() {
    if (!opId) return;
    setDownloading(true);
    try {
      const r = await downloadEmailHistory(parseInt(opId));
      const op = operators.find(o => String(o.id) === opId);
      const url = URL.createObjectURL(new Blob([r.data], { type: "text/html" }));
      const a = document.createElement("a");
      a.href = url; a.download = `emails_${(op?.fantasy_name || op?.company_name || "operador").replace(/ /g, "_")}.html`; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  }

  const confAcr = (id?: number) => confederations.find(c => c.id === id)?.acronym;
  const outbound = msgs.filter(m => m.direction === "outbound").length;
  const inbound = msgs.length - outbound;

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="text-xs text-muted mb-3">Todo o histórico de e-mails enviados pelo sistema e respostas recebidas, separado por Bet — baixe o dossiê para auditoria futura.</p>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="min-w-[280px]">
            <label className="label">Agente Operador (Bet) *</label>
            <select className="input" value={opId} onChange={e => { setOpId(e.target.value); load(e.target.value); }}>
              <option value="">Selecione...</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.fantasy_name || o.company_name}</option>)}
            </select>
          </div>
          <button onClick={handleDownload} disabled={!opId || msgs.length === 0 || downloading} className="btn-secondary">
            {downloading ? "Gerando..." : "⬇ Baixar dossiê (HTML)"}
          </button>
          {opId && !loading && (
            <span className="text-xs text-muted pb-2">{msgs.length} mensagem(ns) · {outbound} enviada(s) · {inbound} resposta(s)</span>
          )}
        </div>
      </div>

      {loading ? <div className="text-muted">Carregando...</div> : !opId ? (
        <div className="card text-center text-muted py-12">Selecione uma Bet para ver o histórico.</div>
      ) : msgs.length === 0 ? (
        <div className="card p-0"><EmptyState icon="✉️" title="Nenhum e-mail registrado para esta Bet" hint="Os envios feitos pelos ciclos de cobrança e as respostas sincronizadas do Microsoft 365 aparecerão aqui automaticamente." /></div>
      ) : (
        <div className="space-y-3">
          {msgs.map(m => {
            const out = m.direction === "outbound";
            const when = m.sent_at || m.received_at || m.created_at;
            return (
              <div key={m.id} className={`card border-l-4 ${out ? "border-l-primary" : "border-l-success"}`}>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${out ? "bg-primary/15 text-primary" : "bg-success/15 text-success"}`}>{out ? "ENVIADO" : "RESPOSTA RECEBIDA"}</span>
                  {confAcr(m.confederation_id) && <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface text-muted">{confAcr(m.confederation_id)}</span>}
                  {m.protocol && <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface text-muted font-mono">Protocolo {m.protocol}</span>}
                  <span className="text-[11px] text-muted ml-auto">{when ? new Date(when).toLocaleString("pt-BR") : "—"}</span>
                </div>
                <p className="text-sm font-medium text-white">{m.subject || "(sem assunto)"}</p>
                <p className="text-[11px] text-muted mt-0.5">De: {m.from_addr || "—"} · Para: {m.to_addr || "—"}</p>
                {m.body_preview && <p className="text-xs text-slate-300 mt-2 whitespace-pre-wrap line-clamp-4">{m.body_preview}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CategoryBadge({ value }: { value: string }) {
  if (value === "minuta")
    return <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning">Minuta</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">Doc. Oficial</span>;
}
