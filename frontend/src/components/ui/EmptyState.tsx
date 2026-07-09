"use client";

/**
 * Estado vazio ilustrado — usado quando uma lista/tabela não tem dados,
 * orientando o usuário sobre o que fazer em seguida.
 */
export default function EmptyState({
  icon = "📭",
  title,
  hint,
  action,
  compact = false,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`text-center ${compact ? "py-8" : "py-14"} px-4`}>
      <div className={`${compact ? "w-14 h-14 text-2xl" : "w-20 h-20 text-4xl"} mx-auto mb-4 rounded-2xl bg-surface-border/40 border border-surface-border flex items-center justify-center`}>
        <span aria-hidden>{icon}</span>
      </div>
      <p className="text-white font-semibold text-sm">{title}</p>
      {hint && <p className="text-muted text-xs mt-1.5 max-w-md mx-auto leading-relaxed">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
