"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import { getTcuLead, updateTcuLead, addTcuLeadNote, enrichTcuLead } from "@/lib/api";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { getUser } from "@/lib/auth";

const ACT_LABELS: Record<string, string> = {
  citacao: "Citação (débito)", audiencia: "Audiência (justificativa)",
  notificacao: "Notificação", acordao_condenatorio: "Acórdão condenatório",
  edital: "Edital / Pauta", outro: "Outro",
};
const TEMA_LABELS: Record<string, string> = {
  educacao_fnde: "Educação / FNDE", saude: "Saúde", assistencia_social: "Assistência Social / FNAS",
  infraestrutura: "Infraestrutura / DNIT", cultura_fnc: "Cultura / FNC", previdencia: "Previdência / INSS",
  licitacoes: "Licitações", convenios: "Convênios", outro: "Outro",
};
const STATUS_OPTIONS = ["novo", "qualificado", "em_analise", "contatado", "em_atendimento", "descartado"];
const STATUS_LABELS: Record<string, string> = {
  novo: "Novo", qualificado: "Qualificado", em_analise: "Em análise",
  contatado: "Contatado", em_atendimento: "Em atendimento", descartado: "Descartado",
};
const SOURCE_LABELS: Record<string, string> = {
  btcu_deliberacoes: "BTCU — Deliberações", acordaos_api: "API de Acórdãos",
  pauta_sessao: "Pauta de sessão", ingestao_manual: "Ingestão manual",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-muted uppercase tracking-wide">{label}</p>
      <div className="text-sm text-slate-200 mt-0.5">{children || <span className="text-muted">—</span>}</div>
    </div>
  );
}

export default function TcuLeadDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = getUser();
  const [lead, setLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [lgpdBasis, setLgpdBasis] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [msg, setMsg] = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

  const load = useCallback(() => {
    setLoading(true);
    getTcuLead(Number(id))
      .then(r => { setLead(r.data); setLgpdBasis(r.data.legitimate_interest_basis || ""); })
      .catch(() => flash("Lead não encontrado."))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function patch(data: any, note?: string) {
    setSaving(true);
    try {
      await updateTcuLead(Number(id), data);
      if (note) flash(note);
      load();
    } catch { flash("Erro ao salvar."); }
    finally { setSaving(false); }
  }

  async function submitNote() {
    if (!noteText.trim()) return;
    await addTcuLeadNote(Number(id), { body: noteText });
    setNoteText("");
    load();
  }

  async function enrich() {
    setSaving(true);
    try {
      await enrichTcuLead(Number(id));
      flash("Enriquecimento concluído.");
      load();
    } catch (e: any) { flash(e.response?.data?.detail || "Falha no enriquecimento."); }
    finally { setSaving(false); }
  }

  if (loading) return <AppShell><div className="text-muted">Carregando...</div></AppShell>;
  if (!lead) return <AppShell><div className="text-muted">Lead não encontrado. <Link href="/tcu" className="text-primary">Voltar</Link></div></AppShell>;

  const enr = lead.enrichment;
  const socios = enr?.socios ? (() => { try { return JSON.parse(enr.socios); } catch { return []; } })() : [];

  return (
    <AppShell>
      <Header
        title={lead.responsavel_nome || lead.numero_processo || `Lead #${lead.id}`}
        subtitle={<>{ACT_LABELS[lead.act_type] || lead.act_type} · {SOURCE_LABELS[lead.source_kind] || lead.source_kind}</>}
        actions={<Link href="/tcu" className="btn-secondary">← Voltar</Link>}
      />

      {msg && <div className="mb-4 bg-primary/10 border border-primary/30 text-primary rounded-lg px-4 py-3 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Resumo + score */}
          <div className="card">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-3">
                <div className={`text-2xl font-bold ${lead.opportunity_score >= 75 ? "text-danger" : lead.opportunity_score >= 50 ? "text-warning" : "text-slate-300"}`}>
                  {lead.opportunity_score ?? "-"}
                </div>
                <div>
                  <p className="text-xs text-muted">Score de oportunidade</p>
                  <p className="text-xs text-slate-400">Confiança: {lead.confidence || "—"} {lead.extracted_by_ai ? "· IA" : "· regex"}</p>
                </div>
              </div>
              {lead.ja_representado && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-muted/10 text-muted border border-surface-border">Parte já representada</span>
              )}
            </div>
            <p className="text-sm text-slate-200">{lead.resumo || "Sem resumo."}</p>
            {lead.rationale && <p className="text-xs text-muted mt-2 italic">{lead.rationale}</p>}
          </div>

          {/* Dados do processo */}
          <div className="card grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Nº do processo">{lead.numero_processo}</Field>
            <Field label="Natureza">{lead.natureza_processo}</Field>
            <Field label="Tema">{lead.tema ? (TEMA_LABELS[lead.tema] || lead.tema) : null}</Field>
            <Field label="Acórdão">{lead.acordao_ref}</Field>
            <Field label="Colegiado">{lead.colegiado}</Field>
            <Field label="Relator">{lead.relator}</Field>
            <Field label="Unid. técnica">{lead.unidade_tecnica}</Field>
            <Field label="Edital SEPROC">{lead.edital_numero}</Field>
            <Field label="Órgão / entidade">{lead.orgao_entidade}</Field>
          </div>

          {/* Responsável */}
          <div className="card">
            <h3 className="font-semibold text-white text-sm mb-3">Responsável (parte)</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Field label="Nome">{lead.responsavel_nome}</Field>
              <Field label={lead.doc_type === "cnpj" ? "CNPJ" : lead.doc_type === "cpf" ? "CPF" : "Documento"}>{lead.responsavel_documento}</Field>
              <Field label="Papel">{lead.papel}</Field>
              <Field label="UF / Município">{[lead.uf, lead.municipio].filter(Boolean).join(" / ")}</Field>
            </div>
          </div>

          {/* Valores e prazos */}
          <div className="card grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Débito">{lead.valor_debito ? formatCurrency(Number(lead.valor_debito)) : null}</Field>
            <Field label="Multa">{lead.valor_multa ? formatCurrency(Number(lead.valor_multa)) : null}</Field>
            <Field label="Ref. do valor">{formatDate(lead.data_referencia_valor)}</Field>
            <Field label="Publicação">{formatDate(lead.data_publicacao)}</Field>
            <Field label="Prazo (dias)">{lead.prazo_dias}</Field>
            <Field label="Prazo final">
              {lead.prazo_final ? <span className="text-warning font-medium">{formatDate(lead.prazo_final)}</span> : null}
            </Field>
          </div>

          {/* Enriquecimento PJ */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white text-sm">Enriquecimento cadastral (CNPJ)</h3>
              {lead.doc_type === "cnpj" && !enr && (
                <button onClick={enrich} disabled={saving} className="btn-secondary text-xs">Enriquecer via BrasilAPI</button>
              )}
            </div>
            {lead.doc_type !== "cnpj" ? (
              <p className="text-xs text-muted">Disponível apenas para responsáveis PJ. Por conformidade LGPD, CPF não é enriquecido — usa-se apenas o que o TCU já publica.</p>
            ) : !enr ? (
              <p className="text-xs text-muted">Ainda não enriquecido.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="Razão social">{enr.razao_social}</Field>
                <Field label="Nome fantasia">{enr.nome_fantasia}</Field>
                <Field label="Situação">{enr.situacao_cadastral}</Field>
                <Field label="Porte">{enr.porte}</Field>
                <Field label="CNAE principal">{enr.cnae_principal}</Field>
                <Field label="Natureza jurídica">{enr.natureza_juridica}</Field>
                <Field label="Endereço">{[enr.logradouro, enr.municipio, enr.uf].filter(Boolean).join(", ")}</Field>
                <Field label="E-mail (cadastro)">{enr.email}</Field>
                <Field label="Telefone (cadastro)">{enr.telefone}</Field>
                {socios.length > 0 && (
                  <div className="col-span-2 md:col-span-3">
                    <p className="text-[11px] text-muted uppercase tracking-wide mb-1">Quadro societário (QSA)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {socios.map((s: any, i: number) => (
                        <span key={i} className="text-xs bg-surface px-2 py-0.5 rounded-full text-slate-300">
                          {s.nome}{s.qualificacao ? <span className="text-muted"> · {s.qualificacao}</span> : null}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Texto bruto */}
          {lead.raw_text && (
            <div className="card">
              <button onClick={() => setShowRaw(!showRaw)} className="text-sm text-primary hover:underline">
                {showRaw ? "Ocultar" : "Ver"} texto original do edital/acórdão
              </button>
              {showRaw && <pre className="mt-3 text-xs text-slate-400 whitespace-pre-wrap font-mono bg-surface p-3 rounded-lg max-h-96 overflow-y-auto">{lead.raw_text}</pre>}
            </div>
          )}
        </div>

        {/* Coluna lateral: CRM + LGPD */}
        <div className="space-y-6">
          {/* CRM */}
          <div className="card">
            <h3 className="font-semibold text-white text-sm mb-3">Qualificação (CRM)</h3>
            <label className="label">Status</label>
            <select className="input mb-3" value={lead.status} disabled={saving}
              onChange={e => patch({ status: e.target.value }, "Status atualizado.")}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>

            <label className="label">Responsável interno</label>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-slate-300 flex-1">
                {lead.assignee_id ? (lead.assignee_id === me?.id ? "Você" : `Usuário #${lead.assignee_id}`) : "Não atribuído"}
              </span>
              {lead.assignee_id !== me?.id && (
                <button onClick={() => patch({ assignee_id: me?.id }, "Lead atribuído a você.")} className="btn-secondary text-xs">Assumir</button>
              )}
            </div>

            <label className="label">É oportunidade?</label>
            <div className="flex gap-2">
              <button onClick={() => patch({ is_opportunity: true })}
                className={`text-xs px-3 py-1.5 rounded-lg border ${lead.is_opportunity ? "bg-success/10 text-success border-success/30" : "border-surface-border text-muted"}`}>Sim</button>
              <button onClick={() => patch({ is_opportunity: false })}
                className={`text-xs px-3 py-1.5 rounded-lg border ${!lead.is_opportunity ? "bg-danger/10 text-danger border-danger/30" : "border-surface-border text-muted"}`}>Não</button>
            </div>
          </div>

          {/* Conformidade LGPD/OAB */}
          <div className="card border-amber-500/20">
            <h3 className="font-semibold text-white text-sm mb-1 flex items-center gap-2">⚖️ Conformidade LGPD/OAB</h3>
            <p className="text-[11px] text-muted mb-3">Uso interno para qualificação. Sem captação/contato ativo (OAB Prov. 205/2021).</p>

            <label className="flex items-center gap-2 text-sm text-slate-300 mb-3">
              <input type="checkbox" checked={lead.lgpd_objection}
                onChange={e => patch({ lgpd_objection: e.target.checked }, "Objeção LGPD registrada.")} />
              Titular exerceu direito de oposição (LGPD)
            </label>
            {lead.lgpd_objection && (
              <div className="mb-3 text-xs bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2">
                Objeção registrada — não utilizar estes dados para prospecção.
              </div>
            )}

            <label className="label">Base de legítimo interesse (teste de balanceamento)</label>
            <textarea className="input h-24 resize-none text-xs" placeholder="Finalidade / necessidade / balanceamento e salvaguardas (ANPD 2024)..."
              value={lgpdBasis} onChange={e => setLgpdBasis(e.target.value)} />
            <button onClick={() => patch({ legitimate_interest_basis: lgpdBasis }, "Base registrada.")}
              disabled={saving} className="btn-secondary text-xs mt-2 w-full">Salvar base</button>
          </div>

          {/* Fonte */}
          <div className="card">
            <h3 className="font-semibold text-white text-sm mb-2">Fonte</h3>
            <p className="text-xs text-muted">{SOURCE_LABELS[lead.source_kind] || lead.source_kind}</p>
            {lead.source_codigo && <p className="text-xs text-muted mt-1">Código: {lead.source_codigo}</p>}
            {lead.source_url && <a href={lead.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Abrir documento original ↗</a>}
          </div>

          {/* Notas / timeline */}
          <div className="card">
            <h3 className="font-semibold text-white text-sm mb-3">Anotações</h3>
            <div className="flex gap-2 mb-3">
              <input className="input" placeholder="Nova anotação..." value={noteText}
                onChange={e => setNoteText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submitNote(); }} />
              <button onClick={submitNote} className="btn-primary text-xs">Add</button>
            </div>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {(lead.notes || []).length === 0 && <p className="text-xs text-muted">Nenhuma anotação.</p>}
              {(lead.notes || []).map((n: any) => (
                <div key={n.id} className="text-xs border-l-2 border-surface-border pl-3">
                  <p className="text-slate-300">{n.body}</p>
                  <p className="text-muted mt-0.5">
                    {n.kind === "status_change" ? "🔄 " : ""}{formatDateTime(n.created_at)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
