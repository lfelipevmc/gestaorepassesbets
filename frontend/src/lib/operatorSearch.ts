/**
 * Busca de agente operador por QUALQUER informação do cadastro (razão social,
 * nome fantasia, CNPJ com ou sem máscara, marcas, contatos, responsáveis,
 * endereço, nº de autorização, observações...). Helper único, reutilizado
 * pelos seletores de operador para evitar divergência entre telas.
 */
export function operatorMatches(o: any, term: string): boolean {
  const t = (term || "").trim().toLowerCase();
  if (!t) return true;
  const digits = t.replace(/\D/g, "");
  const seen = new Set<any>();
  const walk = (v: any): boolean => {
    if (v == null) return false;
    if (typeof v === "string") {
      if (v.toLowerCase().includes(t)) return true;
      if (digits.length >= 4 && v.replace(/\D/g, "").includes(digits)) return true;
      return false;
    }
    if (typeof v === "number") return String(v).includes(t);
    if (Array.isArray(v)) return v.some(walk);
    if (typeof v === "object") {
      if (seen.has(v)) return false;
      seen.add(v);
      return Object.values(v).some(walk);
    }
    return false;
  };
  return walk(o);
}

/** Rótulo padrão: razão social sempre visível, fantasia como complemento. */
export function operatorLabel(o: any): string {
  const razao = o?.company_name || "";
  const fantasia = o?.fantasy_name || "";
  if (fantasia && fantasia.toLowerCase() !== razao.toLowerCase()) return `${razao} (${fantasia})`;
  return razao || fantasia || `#${o?.id ?? "?"}`;
}
