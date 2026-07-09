"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Modal from "@/components/ui/Modal";
import {
  getSources, createSource, updateSource, deleteSource,
  testSavedSource, testSourceAdhoc, runExternal, addPresets,
} from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

const KIND_LABELS: Record<string, string> = { rss: "Feed RSS/Atom", webpage: "Página (HTML)" };
const CATEGORIA_LABELS: Record<string, string> = {
  "": "Detectar automaticamente", licitacao: "Licitação / contratação",
  sancao: "Sanção / investigação", nomeacao: "Nomeação / gestão", palavra_chave: "Palavra-chave",
};

const EMPTY = {
  id: 0, name: "", kind: "rss", url: "", enabled: true,
  keywords: "", categoria_padrao: "", item_selector: "", notes: "",
};

const EXEMPLOS = [
  { t: "Embaixada (licitações/tenders)", d: "Cadastre a página de 'procurement/tenders' ou o feed RSS da embaixada. Categoria padrão: Licitação." },
  { t: "Estatal / empresa pública", d: "Página de 'licitações' ou 'fornecedores', ou a sala de imprensa. Deixe a categoria automática." },
  { t: "Grande empresa privada", d: "Sala de imprensa / 'notícias' — sinais de investigação, mudança de gestão, contratações." },
];

export default function FontesPage() {
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testId, setTestId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  const flash = (m: string) => toast(m, /erro|falha|inválid|informe|não/i.test(m) ? "error" : "success");

  const load = useCallback(() => {
    setLoading(true);
    getSources().then(r => setSources(r.data)).catch(() => flash("Erro ao carregar fontes.")).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  function openNew() { setForm(EMPTY); setTestResult(null); setShowForm(true); }
  function openEdit(s: any) {
    setForm({ ...EMPTY, ...s, categoria_padrao: s.categoria_padrao || "" });
    setTestResult(null); setShowForm(true);
  }

  async function save() {
    if (!form.name.trim() || !form.url.trim()) { flash("Informe nome e URL."); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name, kind: form.kind, url: form.url, enabled: form.enabled,
        keywords: form.keywords || null, categoria_padrao: form.categoria_padrao || null,
        item_selector: form.item_selector || null, notes: form.notes || null,
      };
      if (form.id) await updateSource(form.id, payload);
      else await createSource(payload);
      flash("Fonte salva."); setShowForm(false); load();
    } catch (e: any) { flash(e.response?.data?.detail || "Erro ao salvar."); }
    finally { setSaving(false); }
  }

  async function remove(s: any) {
    if (!confirm(`Remover a fonte "${s.name}"?`)) return;
    try { await deleteSource(s.id); flash("Fonte removida."); load(); }
    catch { flash("Erro ao remover."); }
  }

  async function toggleEnabled(s: any) {
    try { await updateSource(s.id, { enabled: !s.enabled }); load(); }
    catch { flash("Erro ao alterar."); }
  }

  async function testSaved(s: any) {
    setTestId(s.id); setTestResult(null);
    try { const r = await testSavedSource(s.id); setTestResult({ ...r.data, _for: s.id }); }
    catch (e: any) { setTestResult({ status: "erro", error: e.response?.data?.detail || "Falha ao testar.", _for: s.id }); }
    finally { setTestId(null); }
  }

  async function testInForm() {
    if (!form.url.trim()) { flash("Informe a URL para testar."); return; }
    setTestId(-1); setTestResult(null);
    try {
      const r = await testSourceAdhoc({ kind: form.kind, url: form.url, item_selector: form.item_selector, keywords: form.keywords, categoria_padrao: form.categoria_padrao || null });
      setTestResult({ ...r.data, _for: -1 });
    } catch (e: any) { setTestResult({ status: "erro", error: e.response?.data?.detail || "Falha ao testar.", _for: -1 }); }
    finally { setTestId(null); }
  }

  async function handleRun() {
    setRunning(true);
    try { const r = await runExternal(); flash(r.data.message || "Coleta iniciada."); }
    catch { flash("Erro ao iniciar."); }
    finally { setRunning(false); }
  }

  async function handlePresets() {
    if (!confirm("Adicionar as fontes sugeridas (embaixadas, estatais, portais de contratação) e as palavras-chave jurídicas do DOU?")) return;
    try { const r = await addPresets(); flash(r.data.message || "Fontes adicionadas."); load(); }
    catch { flash("Erro ao adicionar sugeridas."); }
  }

  function TestBox({ result }: { result: any }) {
    if (!result) return null;
    if (result.status === "erro" || result.status === "vazio")
      return <div className={`mt-2 rounded-lg p-3 text-xs border ${result.status === "erro" ? "border-danger/30 bg-danger/5 text-danger" : "border-warning/30 bg-warning/5 text-warning"}`}>{result.error}</div>;
    const opp = (result.amostra || []).filter((a: any) => a.is_opportunity);
    return (
      <div className="mt-2 rounded-lg p-3 text-xs border border-success/30 bg-success/5">
        <p className="text-success"><strong>{result.total_itens}</strong> itens lidos · <strong>{result.oportunidades_na_amostra}</strong> viraria(m) oportunidade na amostra.</p>
        <div className="mt-1 space-y-0.5 text-slate-300 max-h-44 overflow-y-auto">
          {(opp.length ? opp : result.amostra || []).slice(0, 10).map((a: any, i: number) => (
            <div key={i}>
              {a.is_opportunity ? <span className="text-amber-300">[{a.categoria}]</span> : <span className="text-muted">[—]</span>} {a.title}
            </div>
          ))}
          {!(result.amostra || []).length && <p className="text-muted">Sem itens na amostra.</p>}
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <Header
        title="Radar Externo"
        subtitle="Monitore DOU, embaixadas, estatais e empresas — os achados entram em Oportunidades"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handlePresets} className="btn-secondary">✨ Adicionar sugeridas</button>
            <button onClick={openNew} className="btn-secondary">+ Nova fonte</button>
            <button onClick={handleRun} disabled={running} className="btn-primary">{running ? "Coletando..." : "Executar radar agora"}</button>
          </div>
        }
      />

      <div className="mb-5 bg-sky-500/5 border border-sky-500/25 rounded-lg px-4 py-3 text-xs text-sky-200/90 flex items-start gap-2">
        <span className="text-sky-400 mt-0.5">🛰️</span>
        <p><strong>Como funciona.</strong> Cada fonte é lida periodicamente; itens novos são classificados (licitação, sanção, nomeação ou suas palavras-chave) e os relevantes viram oportunidades na lista, com selo de origem.
        O DOU é configurado em <Link href="/config" className="underline">Configuração</Link>. Ferramenta interna de inteligência a partir de fontes públicas — sem contato automático com terceiros.</p>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="card h-20 animate-pulse" />)}</div>
      ) : sources.length === 0 ? (
        <div className="card">
          <p className="text-center py-6 text-muted">Nenhuma fonte cadastrada. Clique em <strong className="text-slate-300">Nova fonte</strong> para começar.</p>
          <div className="grid md:grid-cols-3 gap-3 mt-2">
            {EXEMPLOS.map((e, i) => (
              <div key={i} className="bg-surface rounded-lg p-3 text-xs">
                <p className="text-slate-200 font-medium mb-1">{e.t}</p>
                <p className="text-muted">{e.d}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map(s => (
            <div key={s.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`w-2 h-2 rounded-full ${s.enabled ? "bg-success" : "bg-muted"}`}></span>
                    <span className="font-medium text-white">{s.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-surface-border text-muted">{KIND_LABELS[s.kind] || s.kind}</span>
                    {s.categoria_padrao && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30 text-amber-300 bg-amber-500/10">{CATEGORIA_LABELS[s.categoria_padrao] || s.categoria_padrao}</span>}
                  </div>
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">{s.url}</a>
                  {s.keywords && <p className="text-xs text-muted mt-1">Palavras-chave: {s.keywords.split(/[\n,;]+/).filter(Boolean).join(", ")}</p>}
                  <p className="text-[11px] text-muted mt-1">
                    {s.last_checked_at ? `Última leitura: ${formatDateTime(s.last_checked_at)}` : "Ainda não lida"}
                    {s.last_status ? ` · ${s.last_status}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => testSaved(s)} disabled={testId === s.id} className="btn-secondary text-xs">{testId === s.id ? "..." : "Testar"}</button>
                  <button onClick={() => toggleEnabled(s)} className="btn-secondary text-xs">{s.enabled ? "Pausar" : "Ativar"}</button>
                  <button onClick={() => openEdit(s)} className="btn-secondary text-xs">Editar</button>
                  <button onClick={() => remove(s)} className="text-xs px-3 py-1.5 rounded-lg text-danger hover:bg-danger/10">Excluir</button>
                </div>
              </div>
              {testResult?._for === s.id && <TestBox result={testResult} />}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={form.id ? "Editar fonte" : "Nova fonte"}>
        <div className="space-y-3">
          <div>
            <label className="label">Nome</label>
            <input className="input" placeholder="Ex.: Embaixada da França — Licitações" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Tipo</label>
              <select className="input" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                <option value="rss">Feed RSS/Atom</option>
                <option value="webpage">Página (HTML)</option>
              </select>
            </div>
            <div>
              <label className="label">Categoria padrão</label>
              <select className="input" value={form.categoria_padrao} onChange={e => setForm({ ...form, categoria_padrao: e.target.value })}>
                {Object.entries(CATEGORIA_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">URL</label>
            <input className="input" placeholder="https://..." value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
          </div>
          {form.kind === "webpage" && (
            <div>
              <label className="label">Seletor CSS dos itens (opcional)</label>
              <input className="input font-mono text-xs" placeholder="ex.: .lista-noticias a  (vazio = detecção automática)" value={form.item_selector} onChange={e => setForm({ ...form, item_selector: e.target.value })} />
              <p className="text-xs text-muted mt-1">Se a detecção automática não pegar bem os itens, informe um seletor CSS (peça ajuda pelo botão Testar).</p>
            </div>
          )}
          <div>
            <label className="label">Palavras-chave (uma por linha ou separadas por vírgula)</label>
            <textarea className="input h-20 text-xs" placeholder={"nome de cliente\ntema de interesse"} value={form.keywords} onChange={e => setForm({ ...form, keywords: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> Fonte ativa
          </label>

          <div className="pt-1">
            <button onClick={testInForm} disabled={testId === -1} className="btn-secondary text-xs">{testId === -1 ? "Testando..." : "🔌 Testar esta fonte agora"}</button>
            {testResult?._for === -1 && <TestBox result={testResult} />}
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Salvar fonte"}</button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
