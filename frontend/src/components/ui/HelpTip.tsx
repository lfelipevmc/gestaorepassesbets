"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Ícone de ajuda "?" que abre um balão explicativo ao passar o mouse
 * (desktop) ou ao tocar (celular). Usado nas abas e títulos para explicar
 * como cada funcionalidade do sistema funciona.
 *
 * Uso: <HelpTip title="Ciclos" text="Um ciclo agrupa a cobrança do mês..." />
 */
export default function HelpTip({
  title,
  text,
  wide = false,
  align = "center",
}: {
  title?: string;
  text: React.ReactNode;
  wide?: boolean;
  align?: "left" | "center" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // fecha ao tocar fora (celular)
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("touchstart", h);
    };
  }, [open]);

  const pos =
    align === "left" ? "left-0" :
    align === "right" ? "right-0" :
    "left-1/2 -translate-x-1/2";

  return (
    <span ref={ref} className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`Ajuda: ${title || "informações"}`}
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
        className={`w-[18px] h-[18px] rounded-full text-[11px] font-bold leading-none inline-flex items-center justify-center transition-all cursor-help select-none
          ${open ? "bg-primary text-white scale-110" : "bg-surface-border text-slate-400 hover:bg-primary hover:text-white"}`}
      >?</button>
      {open && (
        <span
          className={`absolute z-[90] top-[26px] ${pos} ${wide ? "w-80" : "w-64"} max-w-[86vw] rounded-xl border border-primary/30 bg-[#0d1526] shadow-2xl shadow-black/60 p-3.5 animate-tip-in text-left normal-case tracking-normal whitespace-normal cursor-default`}
          onClick={e => e.stopPropagation()}
        >
          {title && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-white mb-1.5">
              <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center">?</span>
              {title}
            </span>
          )}
          <span className="block text-xs text-slate-300 leading-relaxed font-normal">{text}</span>
        </span>
      )}
    </span>
  );
}
