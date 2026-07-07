// Constantes e helpers compartilhados do TCU Leads (rótulos, cores, formatação).
// Centralizados aqui para consistência entre a lista, o detalhe, o quadro e o painel.

export const ACT_LABELS: Record<string, string> = {
  citacao: "Citação (débito)", audiencia: "Audiência", notificacao: "Notificação",
  acordao_condenatorio: "Acórdão condenatório", edital: "Edital / Pauta", outro: "Outro",
};
export const ACT_COLORS: Record<string, string> = {
  citacao: "text-danger bg-danger/10 border-danger/30",
  audiencia: "text-warning bg-warning/10 border-warning/30",
  acordao_condenatorio: "text-purple-300 bg-purple-500/10 border-purple-500/30",
  notificacao: "text-blue-300 bg-blue-500/10 border-blue-500/30",
  edital: "text-slate-300 bg-slate-500/10 border-slate-500/30",
  outro: "text-muted bg-muted/10 border-surface-border",
};

export const TEMA_LABELS: Record<string, string> = {
  educacao_fnde: "Educação / FNDE", saude: "Saúde", assistencia_social: "Assistência Social / FNAS",
  infraestrutura: "Infraestrutura / DNIT", cultura_fnc: "Cultura / FNC", previdencia: "Previdência / INSS",
  licitacoes: "Licitações", convenios: "Convênios", outro: "Outro",
};

// Fluxo do CRM (ordem importa para o quadro Kanban)
export const LEAD_STATUS_ORDER = [
  "novo", "qualificado", "em_analise", "contatado", "em_atendimento", "descartado",
] as const;
export const LEAD_STATUS_LABELS: Record<string, string> = {
  novo: "Novo", qualificado: "Qualificado", em_analise: "Em análise",
  contatado: "Contatado", em_atendimento: "Em atendimento", descartado: "Descartado",
};
export const LEAD_STATUS_COLORS: Record<string, string> = {
  novo: "text-blue-300 bg-blue-500/10", qualificado: "text-primary bg-primary/10",
  em_analise: "text-warning bg-warning/10", contatado: "text-cyan-300 bg-cyan-500/10",
  em_atendimento: "text-success bg-success/10", descartado: "text-muted bg-muted/10",
};
// Cor de destaque (borda superior das colunas do quadro)
export const LEAD_STATUS_ACCENT: Record<string, string> = {
  novo: "border-blue-400", qualificado: "border-primary", em_analise: "border-warning",
  contatado: "border-cyan-400", em_atendimento: "border-success", descartado: "border-slate-600",
};

// Origem do lead (de onde veio o sinal)
export const ORIGEM_LABELS: Record<string, string> = {
  btcu_deliberacoes: "TCU · Diário", acordaos_api: "TCU · Acórdão", pauta_sessao: "TCU · Pauta",
  processo_autuado: "TCU · Autuado", ingestao_manual: "TCU · Manual",
  dou: "DOU", fonte_web: "Radar web",
};
const ORIGEM_COLORS: Record<string, string> = {
  dou: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  fonte_web: "text-sky-300 bg-sky-500/10 border-sky-500/30",
};
export function origemBadge(sk: string): string {
  return ORIGEM_COLORS[sk] || "text-slate-300 bg-slate-500/10 border-slate-500/30";
}

// Categoria do sinal (Radar Externo)
export const CATEGORIA_LABELS: Record<string, string> = {
  tcu: "TCU", licitacao: "Licitação", sancao: "Sanção",
  nomeacao: "Nomeação", palavra_chave: "Palavra-chave", outro: "Outro",
};
export const CATEGORIA_COLORS: Record<string, string> = {
  licitacao: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  sancao: "text-red-300 bg-red-500/10 border-red-500/30",
  nomeacao: "text-violet-300 bg-violet-500/10 border-violet-500/30",
  palavra_chave: "text-cyan-300 bg-cyan-500/10 border-cyan-500/30",
};

export function scoreColor(s: number | null | undefined): string {
  if (s == null) return "text-muted";
  if (s >= 75) return "text-danger font-bold";
  if (s >= 50) return "text-warning font-semibold";
  return "text-slate-400";
}

// Nomes dos responsáveis, separados por "; "
export function responsaveisNomes(l: any): string {
  const lista = (l?.responsaveis || []).map((r: any) => r?.nome).filter(Boolean);
  if (lista.length) return lista.join("; ");
  return l?.responsavel_nome || "";
}

// Rótulo compacto do valor do lead (débito ou multa)
export function valorLabel(l: any): { texto: string; multa: boolean } | null {
  if (l?.valor_debito) return { texto: String(l.valor_debito), multa: false };
  if (l?.valor_multa) return { texto: String(l.valor_multa), multa: true };
  return null;
}
