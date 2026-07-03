"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getTcuSettings, updateTcuSettings, getTcuRuns } from "@/lib/api";
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

export default function TcuConfigPage() {
  const [s, setS] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };
  const load = () => {
    setLoading(true);
    Promise.all([getTcuSettings(), getTcuRuns(20)])
      .then(([a, b]) => { setS(a.data); setRuns(b.data); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      const payload = { ...s };
      delete payload.id; delete payload.updated_at;
      await updateTcuSettings(payload);
      flash("Configuração salva.");
      load();
    } catch { flash("Erro ao salvar."); }
    finally { setSaving(false); }
  }

  if (loading || !s) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;
  const up = (k: string, v: any) => setS({ ...s, [k]: v });

  return (
    <AppShell>
      <Header
        title="Configuração — Radar TCU"
        subtitle="Fontes, agendamento e captura do endpoint de listagem do BTCU"
        actions={
          <div className="flex gap-2">
            <Link href="/tcu" className="btn-secondary">← Voltar</Link>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Salvar"}</button>
          </div>
        }
      />
      {msg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agendamento + fontes */}
        <div className="card">
          <h3 className="font-semibold text-white text-sm mb-3">Coleta automática</h3>
          <Toggle label="Habilitar coleta diária" hint="Executa o pipeline uma vez por dia no horário abaixo." checked={s.enabled} onChange={v => up("enabled", v)} />
          <div className="grid grid-cols-2 gap-3 my-3 max-w-xs">
            <div>
              <label className="label">Hora</label>
              <input type="number" min={0} max={23} className="input" value={s.run_hour} onChange={e => up("run_hour", Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Minuto</label>
              <input type="number" min={0} max={59} className="input" value={s.run_minute} onChange={e => up("run_minute", Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-muted mb-3">Evite a janela de manutenção do TCU (20h–21h); o sistema já a respeita automaticamente.</p>

          <h4 className="text-xs text-muted uppercase tracking-wide mt-4 mb-1">Fontes</h4>
          <Toggle label="API de Acórdãos" hint="Fonte confirmada. Detecta acórdãos condenatórios (débito/multa)." checked={s.acordaos_enabled} onChange={v => up("acordaos_enabled", v)} />
          <Toggle label="Pautas das sessões" hint="Early-warning: processos prestes a serem julgados." checked={s.pautas_enabled} onChange={v => up("pautas_enabled", v)} />
          <Toggle label="BTCU — Deliberações (editais SEPROC)" hint="Requer o endpoint de listagem configurado ao lado." checked={s.btcu_enabled} onChange={v => up("btcu_enabled", v)} />
        </div>

        {/* Enriquecimento + rede */}
        <div className="card">
          <h3 className="font-semibold text-white text-sm mb-3">Enriquecimento e rede</h3>
          <Toggle label="Enriquecer CNPJ (BrasilAPI)" hint="Somente PJ. CPF nunca é enriquecido (LGPD)." checked={s.enrich_cnpj} onChange={v => up("enrich_cnpj", v)} />
          <div className="grid grid-cols-2 gap-3 my-3">
            <div>
              <label className="label">Cache do CNPJ (dias)</label>
              <input type="number" className="input" value={s.enrich_cache_days} onChange={e => up("enrich_cache_days", Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Delay entre requisições (s)</label>
              <input type="number" step="0.5" className="input" value={s.request_delay_seconds} onChange={e => up("request_delay_seconds", Number(e.target.value))} />
            </div>
          </div>
          <label className="label">User-Agent</label>
          <input className="input mb-3" value={s.user_agent || ""} onChange={e => up("user_agent", e.target.value)} />
          <label className="label">E-mail de contato (no User-Agent)</label>
          <input className="input" value={s.contact_email || ""} placeholder="escritorio@dominio.com.br" onChange={e => up("contact_email", e.target.value)} />
        </div>

        {/* BTCU listing endpoint + guia */}
        <div className="card lg:col-span-2">
          <h3 className="font-semibold text-white text-sm mb-1">Endpoint de listagem do BTCU (a capturar)</h3>
          <p className="text-xs text-muted mb-3">
            O TCU <strong>não documenta</strong> um endpoint público que liste as edições do BTCU por data/caderno (o WAF bloqueia sondagem).
            Capture-o do próprio front-end e cole aqui. Enquanto não configurado, use <Link href="/tcu" className="text-primary">Ingerir Diário</Link> (colar texto/PDF).
          </p>
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
              <textarea className="input h-24 font-mono text-xs" placeholder='{"caderno":"Deliberações","dataInicio":"{data_inicio}","dataFim":"{data_fim}"}'
                value={s.btcu_listing_body || ""} onChange={e => up("btcu_listing_body", e.target.value)} />
            </div>
          )}
          <div className="bg-surface rounded-lg p-4 text-xs text-slate-400 space-y-1">
            <p className="text-slate-300 font-medium">Como capturar (DevTools):</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Abra <code className="text-slate-300">portal.tcu.gov.br/transparencia/btcu/</code> no Chrome.</li>
              <li>Abra o DevTools (F12) → aba <strong>Network</strong> → filtro <strong>Fetch/XHR</strong>.</li>
              <li>Filtre por <strong>Caderno = Deliberações</strong> e por intervalo de datas na página.</li>
              <li>Localize a chamada a <code className="text-slate-300">btcu.apps.tcu.gov.br/api/…</code>; copie a URL (e o corpo, se POST).</li>
              <li>Substitua a data pelos marcadores <code className="text-slate-300">{"{data_inicio}"}</code> / <code className="text-slate-300">{"{data_fim}"}</code> e cole acima.</li>
            </ol>
            <p className="mt-2">Os itens da resposta devem conter um campo de código (<code>codigo</code>/<code>codigoAutenticidade</code>/<code>key</code>) usado no download do PDF via <code>obterDocumentoPdf</code>.</p>
          </div>
        </div>
      </div>

      {/* Execuções */}
      <div className="card mt-6 p-0 overflow-x-auto">
        <div className="p-4"><h3 className="font-semibold text-white text-sm">Execuções recentes</h3></div>
        <table className="w-full min-w-[720px]">
          <thead className="bg-surface">
            <tr>
              <th className="table-th">Início</th>
              <th className="table-th">Origem</th>
              <th className="table-th">Status</th>
              <th className="table-th text-right">Edições</th>
              <th className="table-th text-right">Blocos</th>
              <th className="table-th text-right">Leads</th>
              <th className="table-th text-right">Dup.</th>
              <th className="table-th">Erro</th>
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
