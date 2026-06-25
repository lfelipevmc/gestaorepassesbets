export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR");
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleString("pt-BR");
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatMonth(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  suspended: "Suspenso",
  cancelled: "Cancelado",
  pending: "Inadimplente",
  paid: "Adimplente",
  report_pending: "Pend. de Relatório",
  overdue: "Em Atraso",
  partial: "Parcial",
  open: "Aberto",
  collecting: "Cobrando",
  checking: "Verificando",
  closed: "Fechado",
};

export const STATUS_COLORS: Record<string, string> = {
  active: "text-success bg-success/10",
  paid: "text-success bg-success/10",
  report_pending: "text-warning bg-warning/10",
  open: "text-blue-400 bg-blue-400/10",
  collecting: "text-primary bg-primary/10",
  suspended: "text-warning bg-warning/10",
  partial: "text-warning bg-warning/10",
  checking: "text-warning bg-warning/10",
  cancelled: "text-danger bg-danger/10",
  overdue: "text-danger bg-danger/10",
  pending: "text-muted bg-muted/10",
  closed: "text-muted bg-muted/10",
};
