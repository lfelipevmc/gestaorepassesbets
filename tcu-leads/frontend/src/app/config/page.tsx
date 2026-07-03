"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getSettings, updateSettings, getRuns } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

const RUN_STATUS: Record<string, string> = {
  running: "text-blue-300 bg-blue-500/10", success: "text-success bg-success/10",
  partial: "text-warning bg-warning/10", error: "text-danger bg-danger/10",
};

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div>
        <p className="text-sm text-slate-200">{label}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </label>
  );
}

export default function ConfigPage() {
  const [s, setS] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };
  const load = () => {
    setLoading(true);
    Promise.all([getSettings(), getRuns(20)])
      .then(([a, b]) => { setS(a.data); setRuns(b.data); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      const payload = { ...s };
      delete payload.id; delete payload.updated_at;
      await updateSettings(payload);
      flash("Configuração salva."); load();
    } catch { flash("Erro ao salvar."); }
    finally { setSaving(false); }
  }

  if (loading || !s) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;
  const up = (k: string, v: any) => setS({ ...s, [k]: v });

  return (
    <AppShell>
      <Header
        title="Configuração"
        subtitle="Fontes, agendamento, detecção de autuados e captura de endpoints do TCU"
        actions={<button onClick={save} disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Salvar"}</button>}
      />
      {msg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold text-white text-sm mb-3">Coleta automática</h3>
          <Toggle label="Habilitar coleta diária" hint="Executa o pipeline uma vez por dia no horário abaixo." checked={s.enabled} onChange={v => up("enabled", v)} />
          <div className="grid grid-cols-2 gap-3 my-3 max-w-xs">
            <div><label className="label">Hora</label><input type="number" min={0} max={23} className="input" value={s.run_hour} onChange={e => up("run_hour", Number(e.target.value))} /></div>
            <div><label className="label">Minuto</label><input type="number" min={0} max={59} className="input" value={s.run_minute} onChange={e => up("run_minute", Number(e.target.value))} /></div>
          </div>
          <p className="text-xs text-muted mb-3">A janela de manutenção do TCU (20h–21h) já é respeitada automaticamente.</p>

          <h4 className="text-xs text-muted uppercase tracking-wide mt-4 mb-1">Fontes de oportunidades</h4>
          <Toggle label="API de Acórdãos" hint="Fonte confirmada. Detecta acórdãos condenatórios (débito/multa)." checked={s.acordaos_enabled} onChange={v => up("acordaos_enabled", v)} />
          <Toggle label="Pautas das sessões" hint="Early-warning: processos prestes a julgar." checked={s.pautas_enabled} onChange={v => up("pautas_enabled", v)} />
          <Toggle label="BTCU — Deliberações (editais SEPROC)" hint="Requer o endpoint de listagem configurado abaixo." checked={s.btcu_enabled} onChange={v => up("btcu_enabled", v)} />
        </div>

        <div className="card">
          <h3 className="font-semibold text-white text-sm mb-3">Processos autuados (comparação diária)</h3>
          <Toggle label="Detectar processos autuados do dia" hint="Compara a lista de processos de hoje com a já conhecida; os inéditos = autuados do dia." checked={s.autuados_enabled} onChange={v => up("autuados_enabled", v)} />
          <Toggle label="Criar oportunidade para cada autuado inédito" hint="Gera um lead de baixo score para acompanhamento de cada processo novo." checked={s.autuados_create_leads} onChange={v => up("autuados_create_leads", v)} />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
            <div className="md:col-span-3">
              <label className="label">URL da listagem de processos</label>
              <input className="input" placeholder="https://...  (use {data_inicio}/{data_fim} se filtrar por data)"
                value={s.autuados_listing_url || ""} onChange={e => up("autuados_listing_url", e.target.value)} />
            </div>
            <div>
              <label className="label">Método</label>
              <select className="input" value={s.autuados_listing_method} onChange={e => up("autuados_listing_method", e.target.value)}>
                <option>GET</option><option>POST</option>
              </select>
            </div>
          </div>
          {s.autuados_listing_method === "POST" && (
            <div className="mt-3">
              <label className="label">Corpo (JSON, se POST)</label>
              <textarea className="input h-20 font-mono text-xs" value={s.autuados_listing_body || ""} onChange={e => up("autuados_listing_body", e.target.value)} />
            </div>
          )}
          <p className="text-xs text-muted mt-2">
            Enquanto a URL de listagem não é configurada, a detecção se apoia nos números de processo vistos nas demais fontes.
            A captura do endpoint segue o mesmo procedimento do BTCU (abaixo).
          </p>
        </div>

        <div className="card">
          <h3 className="font-semibold text-white text-sm mb-3">Enriquecimento e rede</h3>
          <Toggle label="Enriquecer CNPJ (BrasilAPI)" hint="Somente PJ. CPF nunca é enriquecido (LGPD)." checked={s.enrich_cnpj} onChange={v => up("enrich_cnpj", v)} />
          <div className="grid grid-cols-2 gap-3 my-3">
            <div><label className="label">Cache do CNPJ (dias)</label><input type="number" className="input" value={s.enrich_cache_days} onChange={e => up("enrich_cache_days", Number(e.target.value))} /></div>
            <div><label className="label">Delay entre requisições (s)</label><input type="number" step="0.5" className="input" value={s.request_delay_seconds} onChange={e => up("request_delay_seconds", Number(e.target.value))} /></div>
          </div>
          <label className="label">User-Agent</label>
          <input className="input mb-3" value={s.user_agent || ""} onChange={e => up("user_agent", e.target.value)} />
          <label className="label">E-mail de contato (no User-Agent)</label>
          <input className="input" value={s.contact_email || ""} placeholder="escritorio@dominio.com.br" onChange={e => up("contact_email", e.target.value)} />
        </div>

        <div className="card">
          <h3 className="font-semibold text-white text-sm mb-1">Endpoint de listagem do BTCU (a capturar)</h3>
          <p className="text-xs text-muted mb-3">O TCU não documenta a listagem de edições por data/caderno. Capture-a do front-end e cole aqui. Enquanto isso, use <Link href="/leads" className="text-primary">Ingerir Diário</Link>.</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div className="md:col-span-3">
              <label className="label">URL de listagem</label>
              <input className="input" placeholder="https://btcu.apps.tcu.gov.br/api/... (use {data_inicio}/{data_fim})"
                value={s.btcu_listing_url || ""} onChange={e => up("btcu_listing_url", e.target.value)} />
            </div>
            <div>
              <label className="label">Método</label>
              <select className="input" value={s.btcu_listing_method} onChange={e => up("btcu_listing_method", e.target.value)}>
                <option>GET</option><option>POST</option>
              </select>
            </div>
          </div>
          {s.btcu_listing_method === "POST" && (
            <div className="mb-3">
              <label className="label">Corpo (JSON, se POST)</label>
              <textarea className="input h-20 font-mono text-xs" value={s.btcu_listing_body || ""} onChange={e => up("btcu_listing_body", e.target.value)} />
            </div>
          )}
          <div className="bg-surface rounded-lg p-4 text-xs text-slate-400 space-y-1">
            <p className="text-slate-300 font-medium">Como capturar (DevTools):</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Abra o portal do TCU no Chrome e vá à página de consulta.</li>
              <li>DevTools (F12) → aba <strong>Network</strong> → filtro <strong>Fetch/XHR</strong>.</li>
              <li>Aplique os filtros (caderno/data) na página.</li>
              <li>Localize a chamada à API do TCU; copie a URL (e o corpo, se POST).</li>
              <li>Troque a data pelos marcadores <code className="text-slate-300">{"{data_inicio}"}</code> / <code className="text-slate-300">{"{data_fim}"}</code> e cole acima.</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="card mt-6 p-0 overflow-x-auto">
        <div className="p-4"><h3 className="font-semibold text-white text-sm">Execuções recentes</h3></div>
        <table className="w-full min-w-[720px]">
          <thead className="bg-surface">
            <tr>
              <th className="table-th">Início</th><th className="table-th">Origem</th><th className="table-th">Status</th>
              <th className="table-th text-right">Edições</th><th className="table-th text-right">Blocos</th>
              <th className="table-th text-right">Leads</th><th className="table-th text-right">Dup.</th><th className="table-th">Erro</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && <tr><td className="table-td text-muted" colSpan={8}>Nenhuma execução ainda.</td></tr>}
            {runs.map(r => (
              <tr key={r.id}>
                <td className="table-td">{formatDateTime(r.started_at)}</td>
                <td className="table-td text-muted">{r.trigger}</td>
                <td className="table-td"><span className={`px-2 py-0.5 rounded-full text-xs ${RUN_STATUS[r.status] || "text-muted bg-muted/10"}`}>{r.status}</span></td>
                <td className="table-td text-right">{r.editions_processed}</td>
                <td className="table-td text-right">{r.blocks_parsed}</td>
                <td className="table-td text-right text-slate-200 font-medium">{r.leads_created}</td>
                <td className="table-td text-right text-muted">{r.leads_duplicated}</td>
                <td className="table-td text-danger text-xs max-w-[200px] truncate">{r.error || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
