"use client";
import { useEffect, useState } from "react";
import { getMailbox } from "@/lib/api";

/**
 * Selo que explicita qual caixa de e-mail está integrada/sincronizada
 * (a caixa dedicada de comunicação com os agentes operadores).
 * Usado em toda tela que trate de sincronização com o Microsoft 365.
 */
export default function MailboxBadge({ prefix = "Caixa integrada" }: { prefix?: string }) {
  const [mb, setMb] = useState<{ mailbox?: string; folder_root?: string } | null>(null);
  useEffect(() => { getMailbox().then(r => setMb(r.data)).catch(() => {}); }, []);
  if (!mb?.mailbox) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 bg-surface border border-surface-border rounded-full px-2.5 py-1 whitespace-nowrap max-w-full"
      title={`As respostas são lidas desta caixa e arquivadas por confederação na pasta “${mb.folder_root}”.`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" aria-hidden />
      <span className="text-muted">{prefix}:</span>
      <span className="font-mono text-blue-300 truncate">{mb.mailbox}</span>
    </span>
  );
}
