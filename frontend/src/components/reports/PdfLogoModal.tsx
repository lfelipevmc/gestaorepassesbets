"use client";
import { useState } from "react";
import Modal from "@/components/ui/Modal";

/**
 * Popup ÚNICO de geração de PDF: pergunta quais logomarcas incluir no cabeçalho.
 * Reutilizado por Relatórios (consolidado/evidências) e pela exportação de Operadores.
 * As logomarcas são as cadastradas em cada cadastro (Escritório, Confederação, ENDR, Marcas).
 */
export type PdfLogoOptions = {
  logo_office: number;
  logo_conf: number;
  logo_endr: number;
  logo_brands: number;
};

export default function PdfLogoModal({
  open, onClose, onConfirm, busy,
  showConfederation = false, showEndr = false, showBrands = false,
  confederationLabel,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (opts: PdfLogoOptions) => void;
  busy?: boolean;
  showConfederation?: boolean;
  showEndr?: boolean;
  showBrands?: boolean;
  confederationLabel?: string;
}) {
  const [office, setOffice] = useState(true);
  const [conf, setConf] = useState(false);
  const [endr, setEndr] = useState(false);
  const [brands, setBrands] = useState(false);

  if (!open) return null;
  return (
    <Modal isOpen={open} onClose={onClose} title="Gerar PDF — logomarcas do cabeçalho">
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Escolha quais logomarcas incluir no documento. Cada logomarca é a cadastrada no respectivo
          cadastro (Configurações → Escritório, Confederação, ENDR e Marcas da Bet) — se não houver
          logomarca cadastrada, o cabeçalho sai apenas com o texto.
        </p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
            <input type="checkbox" checked={office} onChange={e => setOffice(e.target.checked)} />
            Logomarca do escritório
          </label>
          {showConfederation && (
            <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
              <input type="checkbox" checked={conf} onChange={e => setConf(e.target.checked)} />
              Logomarca da confederação{confederationLabel ? ` (${confederationLabel})` : ""}
            </label>
          )}
          {showEndr && (
            <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
              <input type="checkbox" checked={endr} onChange={e => setEndr(e.target.checked)} />
              Logomarca do ENDR
            </label>
          )}
          {showBrands && (
            <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
              <input type="checkbox" checked={brands} onChange={e => setBrands(e.target.checked)} />
              Logomarcas das marcas (uma por marca da Bet)
            </label>
          )}
        </div>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="button" disabled={busy} className="btn-primary"
            onClick={() => onConfirm({ logo_office: office ? 1 : 0, logo_conf: conf ? 1 : 0, logo_endr: endr ? 1 : 0, logo_brands: brands ? 1 : 0 })}>
            {busy ? "Gerando..." : "⬇ Gerar PDF"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
