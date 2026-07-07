"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getSettings, updateSettings, getRuns, cleanupNoise, clearAutuadosSource, testSourceProcessos, testDou } from "@/lib/api";
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
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [testDate, setTestDate] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [douResult, setDouResult] = useState<any>(null);
  const [douTesting, setDouTesting] = useState(false);

  async function handleTestDou() {
    setDouTesting(true);
    setDouResult(null);
    try {
      const r = await testDou();
      setDouResult(r.data);
    } catch (e: any) {
      setDouResult({ status: "erro", error: e.response?.data?.detail || "Falha ao testar o DOU." });
    } finally { setDouTesting(false); }
  }

  async function handleClearCustom() {
    if (!confirm("Remover a fonte customizada antiga e voltar à Pesquisa Integrada padrão do TCU?")) return;
    try {
      const r = await clearAutuadosSource();
      flash(r.data.message || "Fonte customizada removida.");
      load();
    } catch { flash("Erro ao remover fonte customizada."); }
  }

  async function handleCleanup() {
    if (!confirm("Remover os leads de acórdãos antigos sem parte identificada? (não afeta editais nem processos)")) return;
    setCleaning(true);
    try {
      const r = await cleanupNoise();
      flash(r.data.message || "Limpeza concluída.");
    } catch { flash("Erro na limpeza."); }
    finally { setCleaning(false); }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testSourceProcessos(testDate ? { data: testDate } : undefined);
      setTestResult(r.data);
    } catch (e: any) {
      setTestResult({ error: e.response?.data?.detail || "Falha ao testar." });
    } finally { setTesting(false); }
  }

  const [loadError, setLoadError] = useState(false);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };
  const load = () => {
    setLoading(true);
    setLoadError(false);
    Promise.all([getSettings(), getRuns(20)])
      .then(([a, b]) => { setS(a.data); setRuns(b.data); })
      .catch(() => setLoadError(true))
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

  if (loading) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;
  if (loadError || !s) return (
    <AppShell>
      <div className="card text-center py-10">
        <p className="text-danger mb-3">Não foi possível carregar as configurações.</p>
        <button onClick={load} className="btn-primary">Tentar novamente</button>
      </div>
    </AppShell>
  );
  const up = (k: string, v: any) => setS({ ...s, [k]: v });

  return (
    <AppShell>
      <Header
        title="Configuração"
        subtitle="Fontes do TCU e do Radar Externo (DOU), agendamento e detecção de autuados"
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
          <Toggle label="API de Acórdãos" hint="Consulta a base de acórdãos. Atenção: esses registros raramente têm responsável/órgão." checked={s.acordaos_enabled} onChange={v => up("acordaos_enabled", v)} />
          <div className="pl-7">
            <Toggle label="Transformar acórdãos em leads" hint="Desligado por padrão — evita inundar a lista com milhares de acórdãos antigos sem parte identificada." checked={s.acordaos_create_leads} onChange={v => up("acordaos_create_leads", v)} />
          </div>
          <Toggle label="Pautas das sessões" hint="Early-warning: processos prestes a julgar." checked={s.pautas_enabled} onChange={v => up("pautas_enabled", v)} />
          <Toggle label="BTCU — Deliberações (editais SEPROC)" hint="Requer o endpoint de listagem configurado abaixo." checked={s.btcu_enabled} onChange={v => up("btcu_enabled", v)} />
          <div className="mt-3 pt-3 border-t border-surface-border">
            <button onClick={handleCleanup} disabled={cleaning} className="btn-secondary text-xs">
              {cleaning ? "Limpando..." : "🧹 Limpar acórdãos antigos sem parte"}
            </button>
            <p className="text-xs text-muted mt-1">Remove os leads de acórdão sem responsável/órgão que poluem a lista de Oportunidades.</p>
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-white text-sm mb-1">Processos autuados (Pesquisa Integrada do TCU)</h3>
          <p className="text-xs text-muted mb-3">Fonte <strong>já integrada</strong> — não precisa configurar endereço. Busca diariamente os processos do dia direto no TCU.</p>
          <Toggle label="Detectar processos autuados do dia" hint="Consulta a Pesquisa Integrada por data e registra os processos inéditos." checked={s.autuados_enabled} onChange={v => up("autuados_enabled", v)} />
          <Toggle label="Criar oportunidade para cada processo novo" hint="Gera um lead (com órgão e assunto) para cada processo detectado." checked={s.autuados_create_leads} onChange={v => up("autuados_create_leads", v)} />
          <Toggle label="Capturar responsáveis / interessados" hint="Busca o registro completo do processo, trazendo nome e CPF mascarado dos responsáveis — os possíveis clientes. Um pouco mais lento." checked={s.autuados_fetch_responsaveis} onChange={v => up("autuados_fetch_responsaveis", v)} />
          <Toggle label="Usar navegador headless (recomendado no servidor)" hint="O firewall do TCU exige um desafio em JavaScript que só um navegador resolve. Ligado, as consultas passam por um Chromium interno. Desligue apenas se rodar localmente numa rede que já acessa o TCU." checked={s.autuados_use_browser} onChange={v => up("autuados_use_browser", v)} />

          <label className="label mt-3">O que detectar</label>
          <select className="input max-w-md" value={s.autuados_filtro_campo || "DTAUTUACAO"} onChange={e => up("autuados_filtro_campo", e.target.value)}>
            <option value="DTAUTUACAO">Processos autuados (abertos) no dia — recomendado</option>
            <option value="DTATUALIZACAO">Processos com qualquer movimentação no dia</option>
          </select>
          <p className="text-xs text-muted mt-1">"Autuados no dia" traz exatamente os processos abertos naquela data — o momento ideal de aproximação.</p>

          {s.autuados_listing_url && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              <p>⚠️ Há uma <strong>fonte customizada antiga</strong> configurada que está impedindo o uso da Pesquisa Integrada padrão.</p>
              <button onClick={handleClearCustom} className="btn-secondary text-xs mt-2">Limpar fonte customizada</button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={handleTest} disabled={testing} className="btn-secondary text-xs">
              {testing ? "Testando..." : "🔌 Testar fonte (a partir do servidor)"}
            </button>
            <input type="date" className="input max-w-[11rem] text-xs" value={testDate}
                   onChange={e => setTestDate(e.target.value)} />
            <span className="text-xs text-muted">Vazio = hoje. Para conferir, escolha um dia com processos (ex.: um dia útil recente).</span>
          </div>
          {testResult && (
            <div className={`mt-2 rounded-lg p-3 text-xs border ${testResult.status === "erro" || (testResult.error && !testResult.count) ? "border-danger/30 bg-danger/5 text-danger" : "border-success/30 bg-success/5 text-success"}`}>
              <p><strong>Status:</strong> {testResult.status || "—"}{testResult.endpoint && ` · via ${testResult.endpoint}`} · <strong>Processos:</strong> {testResult.count ?? 0}{testResult.total != null && ` (total no TCU: ${testResult.total})`}</p>
              {testResult.cookies_firewall != null && (
                <p className="text-slate-400">Cookies do firewall obtidos: <strong>{testResult.cookies_firewall}</strong> {testResult.cookies_firewall > 0 ? "✓" : "(nenhum)"}{testResult.cookies_nomes?.length > 0 && ` — ${testResult.cookies_nomes.join(", ")}`}</p>
              )}
              {testResult.error && <p className="mt-1 text-danger">{testResult.error}</p>}
              {testResult.sample && (
                <div className="mt-1 text-slate-300">
                  Exemplo: <strong>{testResult.sample.numero}</strong> — {testResult.sample.natureza || "—"} · {testResult.sample.orgao_entidade || "órgão não informado"}
                </div>
              )}
              <div className="mt-1 text-slate-300">
                <strong>Com responsáveis:</strong> {testResult.com_responsaveis ?? 0} processo(s)
              </div>
              {testResult.exemplo_responsaveis?.responsaveis?.length > 0 && (
                <div className="mt-1 text-slate-300">
                  Responsáveis de <strong>{testResult.exemplo_responsaveis.numero}</strong>: {testResult.exemplo_responsaveis.responsaveis.join("; ")}
                </div>
              )}
              {testResult.count > 0 && !testResult.com_responsaveis && (
                <div className="mt-1 text-warning">
                  Nenhum responsável capturado nesta amostra.
                </div>
              )}
              {testResult.diagnostics?.length > 0 && (
                <details className="mt-2" open>
                  <summary className="cursor-pointer text-muted">Diagnóstico detalhado (cada tentativa)</summary>
                  <div className="mt-1 space-y-2">
                    {testResult.diagnostics.map((d: any, i: number) => (
                      <div key={i} className="rounded border border-surface-border p-2 bg-surface/50">
                        <p className="text-slate-200">{d.label}</p>
                        <p className="text-slate-400">
                          status: <strong>{d.status || "—"}</strong>
                          {d.http_status != null && ` · HTTP ${d.http_status}`}
                          {` · itens: ${d.count ?? 0}`}
                          {d.total != null && ` · total TCU: ${d.total}`}
                          {` · responsáveis: ${d.com_responsaveis ?? 0}`}
                        </p>
                        {(d.body_len != null || d.content_encoding) && (
                          <p className="text-slate-500">corpo: {d.body_len ?? "?"} bytes · encoding: {d.content_encoding || "nenhum"}</p>
                        )}
                        {d.error && <p className="text-danger">{d.error}</p>}
                        {d.campos?.length > 0 && <p className="text-slate-500 break-words">campos: {d.campos.join(", ")}</p>}
                        {d.raw_sample && <p className="text-slate-500 break-words mt-1">corpo (início): {typeof d.raw_sample === "string" ? d.raw_sample.slice(0, 300) : JSON.stringify(d.raw_sample).slice(0, 300)}</p>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          <p className="text-xs text-muted mt-3">
            Observação: a Pesquisa Integrada informa nº do processo, natureza, assunto, órgão (unidade jurisdicionada) e relator.
            Os <strong>responsáveis nominais</strong> costumam aparecer depois, no edital de citação (fonte BTCU) — que o sistema também captura.
          </p>
        </div>

        <div className="card">
          <h3 className="font-semibold text-white text-sm mb-1">Radar Externo — DOU (Diário Oficial da União)</h3>
          <p className="text-xs text-muted mb-3">Varre o DOU do dia e cria oportunidades quando encontra sinais (licitações, sanções, nomeações) ou suas palavras-chave. As demais fontes (embaixadas, estatais, empresas) ficam em <Link href="/fontes" className="text-primary">Radar Externo</Link>.</p>
          <Toggle label="Monitorar o DOU diariamente" hint="Lê as seções escolhidas na leitura do jornal da Imprensa Nacional." checked={s.dou_enabled} onChange={v => up("dou_enabled", v)} />
          <Toggle label="Monitorar sites e feeds cadastrados" hint="Liga a varredura das fontes web/RSS da página Radar Externo." checked={s.fontes_web_enabled} onChange={v => up("fontes_web_enabled", v)} />

          <label className="label mt-3">Seções do DOU (separadas por vírgula)</label>
          <input className="input max-w-md" placeholder="do1,do3" value={s.dou_secoes || ""} onChange={e => up("dou_secoes", e.target.value)} />
          <p className="text-xs text-muted mt-1">do1 = atos normativos · do2 = pessoal · do3 = contratos/licitações. Recomendado: <code className="text-slate-300">do1,do3</code>.</p>

          <label className="label mt-3">Palavras-chave adicionais (uma por linha)</label>
          <textarea className="input h-20 text-xs" placeholder={"nome de cliente\nórgão de interesse\ntema específico"} value={s.dou_keywords || ""} onChange={e => up("dou_keywords", e.target.value)} />
          <p className="text-xs text-muted mt-1">Além dos sinais automáticos, qualquer item do DOU que contenha um destes termos vira oportunidade.</p>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={handleTestDou} disabled={douTesting} className="btn-secondary text-xs">
              {douTesting ? "Testando..." : "🔌 Testar DOU (a partir do servidor)"}
            </button>
            <span className="text-xs text-muted">Salve antes de testar. Lê o DOU de hoje.</span>
          </div>
          {douResult && (
            <div className={`mt-2 rounded-lg p-3 text-xs border ${douResult.status === "erro" ? "border-danger/30 bg-danger/5 text-danger" : douResult.status === "vazio" ? "border-warning/30 bg-warning/5 text-warning" : "border-success/30 bg-success/5 text-success"}`}>
              {douResult.status === "erro" ? <p>{douResult.error}</p> : douResult.status === "vazio" ? (
                <p>{douResult.error || "Nenhum item lido hoje (pode não haver edição ou a estrutura mudou)."}</p>
              ) : (
                <>
                  <p><strong>Itens lidos:</strong> {douResult.total_itens} · <strong>oportunidades na amostra:</strong> {douResult.oportunidades_na_amostra}</p>
                  <div className="mt-1 space-y-0.5 text-slate-300 max-h-40 overflow-y-auto">
                    {(douResult.amostra || []).filter((a: any) => a.is_opportunity).slice(0, 8).map((a: any, i: number) => (
                      <div key={i}>• <span className="text-amber-300">[{a.categoria}]</span> {a.title}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
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
