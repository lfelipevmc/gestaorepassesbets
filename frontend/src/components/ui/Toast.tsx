"use client";
import { useEffect, useState } from "react";

/**
 * Sistema de notificações (toasts) do sistema — substitui os alert() nativos.
 * Uso: import { toast } from "@/components/ui/Toast";
 *      toast.success("Salvo!"); toast.error("Falhou"); toast.warn("Preencha o campo"); toast.info("...");
 * O <Toaster /> é montado uma única vez no AppShell.
 */

type ToastType = "success" | "error" | "warn" | "info";
type ToastItem = { id: number; type: ToastType; msg: string };

let pushToast: ((t: { type: ToastType; msg: string }) => void) | null = null;
let seq = 1;

function emit(type: ToastType, msg: string) {
  if (pushToast) pushToast({ type, msg });
  else if (typeof window !== "undefined") window.alert(msg); // fallback (fora do AppShell)
}

export const toast = {
  success: (m: string) => emit("success", m),
  error: (m: string) => emit("error", m),
  warn: (m: string) => emit("warn", m),
  info: (m: string) => emit("info", m),
};

const STYLES: Record<ToastType, { icon: string; ring: string; bar: string }> = {
  success: { icon: "✓", ring: "border-success/40", bar: "bg-success" },
  error:   { icon: "✕", ring: "border-danger/40",  bar: "bg-danger" },
  warn:    { icon: "!", ring: "border-warning/40", bar: "bg-warning" },
  info:    { icon: "i", ring: "border-primary/40", bar: "bg-primary-light" },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    pushToast = ({ type, msg }) => {
      const id = seq++;
      setItems(list => [...list, { id, type, msg }].slice(-4));
      const ttl = type === "error" ? 6500 : 4200;
      setTimeout(() => setItems(list => list.filter(i => i.id !== id)), ttl);
    };
    return () => { pushToast = null; };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="fixed z-[120] bottom-4 right-4 left-4 sm:left-auto sm:w-[380px] space-y-2 pointer-events-none">
      {items.map(i => {
        const s = STYLES[i.type];
        return (
          <div key={i.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border ${s.ring} bg-slate-900/95 backdrop-blur shadow-2xl px-4 py-3 animate-toast-in`}
            role="status">
            <span className={`mt-0.5 w-5 h-5 rounded-full ${s.bar} text-slate-900 text-[11px] font-black flex items-center justify-center flex-shrink-0`}>{s.icon}</span>
            <p className="flex-1 text-sm text-slate-100 leading-snug break-words">{i.msg}</p>
            <button onClick={() => setItems(list => list.filter(x => x.id !== i.id))}
              aria-label="Fechar aviso"
              className="text-slate-500 hover:text-white text-xs mt-0.5 flex-shrink-0">✕</button>
          </div>
        );
      })}
    </div>
  );
}
