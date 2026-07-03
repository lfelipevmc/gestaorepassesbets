const COLORS: Record<string, string> = {
  novo: "text-blue-300 bg-blue-500/10",
  qualificado: "text-primary bg-primary/10",
  em_analise: "text-warning bg-warning/10",
  contatado: "text-cyan-300 bg-cyan-500/10",
  em_atendimento: "text-success bg-success/10",
  descartado: "text-muted bg-muted/10",
};
const LABELS: Record<string, string> = {
  novo: "Novo", qualificado: "Qualificado", em_analise: "Em análise",
  contatado: "Contatado", em_atendimento: "Em atendimento", descartado: "Descartado",
};

export default function Badge({ status, className = "" }: { status: string; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${COLORS[status] || "text-muted bg-muted/10"} ${className}`}>
      {LABELS[status] || status}
    </span>
  );
}
