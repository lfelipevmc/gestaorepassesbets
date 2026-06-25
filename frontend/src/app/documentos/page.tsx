"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Modal from "@/components/ui/Modal";
import { getDocuments, uploadDocument, downloadDocument, getOperators, getConfederations } from "@/lib/api";
import { formatDate } from "@/lib/utils";

const DOC_TYPES = [
  { value: "notification", label: "Notificação" },
  { value: "receipt", label: "Recibo" },
  { value: "report", label: "Relatório" },
  { value: "regulation", label: "Regulamento" },
  { value: "correspondence", label: "Correspondência" },
  { value: "ggr_report", label: "Relatório GGR" },
  { value: "other", label: "Outro" },
];

export default function DocumentosPage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [confederations, setConfederations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: "", document_type: "other", operator_id: "", confederation_id: "", description: "" });

  const fetchAll = () => {
    Promise.all([getDocuments(), getOperators({ limit: 200 }), getConfederations()])
      .then(([d, ops, confs]) => { setDocuments(d.data); setOperators(ops.data); setConfederations(confs.data); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", form.title);
    fd.append("document_type", form.document_type);
    if (form.operator_id) fd.append("operator_id", form.operator_id);
    if (form.confederation_id) fd.append("confederation_id", form.confederation_id);
    if (form.description) fd.append("description", form.description);
    try {
      await uploadDocument(fd);
      setShowUpload(false);
      setFile(null);
      setForm({ title: "", document_type: "other", operator_id: "", confederation_id: "", description: "" });
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao fazer upload");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: any) {
    const r = await downloadDocument(doc.id);
    const url = URL.createObjectURL(new Blob([r.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.file_name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const getDocTypeLabel = (type: string) => DOC_TYPES.find(t => t.value === type)?.label || type;

  return (
    <AppShell>
      <Header
        title="Documentos"
        subtitle="Repositório de documentos e correspondências"
        actions={<button onClick={() => setShowUpload(true)} className="btn-primary">+ Enviar Documento</button>}
      />

      {loading ? <div className="text-muted">Carregando...</div> : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="table-th">Título</th>
                <th className="table-th">Tipo</th>
                <th className="table-th">Operador</th>
                <th className="table-th">Confederação</th>
                <th className="table-th">Arquivo</th>
                <th className="table-th">Tamanho</th>
                <th className="table-th">Data</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {documents.length === 0 ? (
                <tr><td colSpan={8} className="table-td text-center text-muted py-12">Nenhum documento enviado</td></tr>
              ) : documents.map((d: any) => {
                const op = operators.find(o => o.id === d.operator_id);
                const conf = confederations.find(c => c.id === d.confederation_id);
                return (
                  <tr key={d.id} className="hover:bg-surface-light/20">
                    <td className="table-td font-medium text-white">{d.title}</td>
                    <td className="table-td">{getDocTypeLabel(d.document_type)}</td>
                    <td className="table-td text-muted text-xs">{op?.fantasy_name || op?.company_name || "-"}</td>
                    <td className="table-td text-muted">{conf?.acronym || "-"}</td>
                    <td className="table-td font-mono text-xs text-muted">{d.file_name}</td>
                    <td className="table-td text-muted">{d.file_size ? `${Math.round(d.file_size / 1024)} KB` : "-"}</td>
                    <td className="table-td text-muted">{formatDate(d.created_at)}</td>
                    <td className="table-td">
                      <button onClick={() => handleDownload(d)} className="text-primary text-xs hover:underline">Baixar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
          <div>
            <label className="label">Tipo de Documento *</label>
            <select className="input" value={form.document_type} onChange={e => setForm(f => ({ ...f, document_type: e.target.value }))}>
              {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Agente Operador</label>
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
