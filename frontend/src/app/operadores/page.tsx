"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import { getOperators, createOperator, importOperators, getSyncStatus, researchAllOperators, getOffice, updateOffice } from "@/lib/api";
import { getUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 50;

// Colunas disponíveis na tabela (o admin define quais aparecem, em Colunas)
const COLUMN_DEFS: { key: string; label: string; width: number }[] = [
  { key: "razao", label: "Razão Social", width: 220 },
  { key: "fantasia", label: "Nome Fantasia", width: 160 },
  { key: "cnpj", label: "CNPJ", width: 150 },
  { key: "status", label: "Status", width: 100 },
  { key: "autorizacao", label: "Autorização", width: 120 },
  { key: "contatos", label: "Contatos", width: 130 },
  { key: "marcas", label: "Marcas", width: 180 },
  { key: "endr", label: "ENDR mês atual", width: 130 },
];
const DEFAULT_COLS = COLUMN_DEFS.map(c => c.key);

function currentMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export default function OperadoresPage() {
  const [operators, setOperators] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [endrFilter, setEndrFilter] = useState("");
  const [contactsFilter, setContactsFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [researchingAll, setResearchingAll] = useState(false);
  const [page, setPage] = useState(0);
  const [syncInfo, setSyncInfo] = useState<any>(null);
  const me = getUser();
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_COLS);
  const [showColsModal, setShowColsModal] = useState(false);
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("opColWidths") || "{}"); } catch { /* noop */ }
    }
    return {};
  });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importCategory, setImportCategory] = useState("autorizada");
  const [form, setForm] = useState({
    company_name: "", fantasy_name: "", cnpj: "", website: "", status: "active", notes: ""
  });

  const fetchOperators = () => {
    setLoading(true);
    getOperators({ search: search || undefined, status: statusFilter || undefined, limit: 500 })
      .then(r => setOperators(r.data))
      .finally(() => setLoading(false));
  };

  const fetchSyncInfo = () => {
    getSyncStatus().then(r => setSyncInfo(r.data)).catch(() => {});
  };

  useEffect(() => { fetchOperators(); }, [search, statusFilter]);
  useEffect(() => { fetchSyncInfo(); }, []);

  // Client-side ENDR/contacts filtering
  const today = new Date();
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];

  const filtered = operators.filter(op => {
    if (endrFilter) {
      const isEndr = op.endr_associations?.some(
        (a: any) => a.reference_month === thisMonthStart && a.is_associated
      );
      if (endrFilter === "endr" && !isEndr) return false;
      if (endrFilter === "no_endr" && isEndr) return false;
    }
    if (contactsFilter) {
      const hasContacts = (op.contacts?.length || 0) > 0;
      if (contactsFilter === "has" && !hasContacts) return false;
      if (contactsFilter === "none" && hasContacts) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await createOperator(form);
      setShowCreate(false);
      setForm({ company_name: "", fantasy_name: "", cnpj: "", website: "", status: "active", notes: "" });
      fetchOperators();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao criar operador");
    } finally {
      setCreating(false);
    }
  }

  // Colunas visíveis: definidas pelo admin, valem para todos (salvas no cadastro do Escritório)
  useEffect(() => {
    getOffice().then(r => {
      const csv = r.data?.operators_table_columns;
      if (csv) setVisibleCols(csv.split(",").map((s: string) => s.trim()).filter((k: string) => DEFAULT_COLS.includes(k)));
    }).catch(() => {});
  }, []);

  async function saveCols(cols: string[]) {
    setVisibleCols(cols);
    setShowColsModal(false);
    try { await updateOffice({ operators_table_columns: cols.join(",") }); } catch { /* noop */ }
  }

  // Redimensionamento de colunas (arrastar a borda direita do cabeçalho)
  function startResize(e: React.MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest("th");
    const startX = e.clientX;
    const startW = th ? th.offsetWidth : (colWidths[key] || 150);
    function onMove(ev: MouseEvent) {
      const w = Math.max(70, startW + (ev.clientX - startX));
      setColWidths(prev => {
        const next = { ...prev, [key]: w };
        try { localStorage.setItem("opColWidths", JSON.stringify(next)); } catch { /* noop */ }
        return next;
      });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const colWidth = (key: string) => colWidths[key] || COLUMN_DEFS.find(c => c.key === key)?.width || 150;

  async function handleResearchAll() {
    if (!confirm("Pesquisar contatos de TODOS os operadores ativos? A pesquisa roda em segundo plano e pode levar vários minutos. As sugestões aparecem na aba 'Pesquisa de Contatos' de cada operador.")) return;
    setResearchingAll(true);
    try {
      await researchAllOperators();
      alert("Pesquisa em andamento (segundo plano). Abra um operador → 'Pesquisa de Contatos' → Pendentes para revisar as sugestões conforme forem chegando.");
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro ao iniciar pesquisa");
    } finally {
      setResearchingAll(false);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importFile) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("category", importCategory);
      const r = await importOperators(fd);
      alert(`Importação concluída: ${r.data.new_operators ?? r.data.created ?? 0} criados, ${r.data.updated_operators ?? r.data.updated ?? 0} atualizados, ${r.data.errors?.length || 0} erros`);
      setShowImport(false);
      setImportFile(null);
      fetchOperators();
      fetchSyncInfo();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Erro na importação");
    } finally {
      setImporting(false);
    }
  }

  function getEndrBadge(op: any) {
    const isEndr = op.endr_associations?.some(
      (a: any) => a.reference_month === thisMonthStart && a.is_associated
    );
    if (isEndr) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400 border border-green-700/40">Associado ENDR</span>;
    }
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-muted border border-surface-border">Não associado</span>;
  }

  return (
    <AppShell>
      <Header
        title="Agentes Operadores"
        subtitle={
          <span>
            {filtered.length} operador{filtered.length !== 1 ? "es" : ""} encontrado{filtered.length !== 1 ? "s" : ""}
            {syncInfo && (
              <span className="ml-3 text-xs text-muted">
                Última atualização:{" "}
                {syncInfo.last_sync ? formatDateTime(syncInfo.last_sync) : "Nunca atualizado"}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {me?.role === "admin" && (
              <button onClick={() => setShowColsModal(true)} className="btn-secondary" title="Definir as colunas da tabela">
                ⚙ Colunas
              </button>
            )}
            <button onClick={handleResearchAll} disabled={researchingAll} className="btn-secondary" title="Pesquisa contatos de todos os operadores (Receita Federal, web e IA)">
              {researchingAll ? "Iniciando..." : "Pesquisar Contatos (todos)"}
            </button>
            <button onClick={() => setShowImport(true)} className="btn-secondary">
              Importar Planilha
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              + Novo Operador
            </button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          className="input max-w-xs"
          placeholder="Buscar por razão social, fantasia ou CNPJ..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
        />
        <select className="input max-w-[180px]" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}>
          <option value="">Todos os status</option>
          <option value="active">Ativo</option>
          <option value="suspended">Suspenso</option>
          <option value="cancelled">Cancelado</option>
          <option value="pending">Pendente</option>
        </select>
        <select className="input max-w-[200px]" value={endrFilter} onChange={e => { setEndrFilter(e.target.value); setPage(0); }}>
          <option value="">ENDR — todos</option>
          <option value="endr">Associado ENDR</option>
          <option value="no_endr">Não associado ENDR</option>
        </select>
        <select className="input max-w-[200px]" value={contactsFilter} onChange={e => { setContactsFilter(e.target.value); setPage(0); }}>
          <option value="">Contatos — todos</option>
          <option value="has">Com contatos</option>
          <option value="none">Sem contatos</option>
        </select>
      </div>

      {/* Table (colunas configuráveis e redimensionáveis) */}
      <div className="card p-0 overflow-x-auto">
        <table style={{ tableLayout: "fixed", minWidth: "100%" }}>
          <thead className="bg-surface">
            <tr>
              {COLUMN_DEFS.filter(c => visibleCols.includes(c.key)).map(c => (
                <th key={c.key} className="table-th relative select-none" style={{ width: colWidth(c.key) }}>
                  <span className="block truncate pr-2">{c.label}</span>
                  <span
                    onMouseDown={e => startResize(e, c.key)}
                    title="Arraste para ajustar a largura"
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50"
                  />
                </th>
              ))}
              <th className="table-th" style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={visibleCols.length + 1} className="table-td text-center text-muted py-8">Carregando...</td></tr>
            ) : paginated.length === 0 ? (
              <tr><td colSpan={visibleCols.length + 1} className="table-td text-center text-muted py-8">Nenhum operador encontrado</td></tr>
            ) : paginated.map(op => (
              <tr key={op.id} className="hover:bg-surface-light/30 transition-colors align-top">
                {visibleCols.includes("razao") && <td className="table-td font-medium text-white break-words">{op.company_name}</td>}
                {visibleCols.includes("fantasia") && <td className="table-td break-words">{op.fantasy_name || "-"}</td>}
                {visibleCols.includes("cnpj") && <td className="table-td font-mono text-xs">{op.cnpj || "-"}</td>}
                {visibleCols.includes("status") && <td className="table-td"><Badge status={op.status} /></td>}
                {visibleCols.includes("autorizacao") && (
                  <td className="table-td">
                    {(op.authorization_number || op.mf_license_number) ? (
                      <span className="text-xs text-slate-300">{op.authorization_number || op.mf_license_number}</span>
                    ) : (
                      <span className="text-xs text-warning bg-warning/10 px-2 py-0.5 rounded">Sem autorização</span>
                    )}
                  </td>
                )}
                {visibleCols.includes("contatos") && (
                  <td className="table-td">
                    {(() => {
                      const hasEmail =
                        op.contacts?.some((c: any) => c.type === "email" && c.value) ||
                        op.responsibles?.some((r: any) => r.email);
                      const total = (op.contacts?.length || 0) + (op.responsibles?.length || 0);
                      return hasEmail ? (
                        <span className="text-xs bg-surface px-2 py-1 rounded-full">{total} contato{total !== 1 ? "s" : ""}</span>
                      ) : total > 0 ? (
                        <span className="text-xs bg-warning/10 text-warning px-2 py-1 rounded-full" title="Nenhum e-mail cadastrado (contatos ou responsáveis)">⚠ sem e-mail</span>
                      ) : (
                        <span className="text-xs bg-danger/10 text-danger px-2 py-1 rounded-full">sem contato</span>
                      );
                    })()}
                  </td>
                )}
                {visibleCols.includes("marcas") && (
                  <td className="table-td">
                    {op.brands?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {op.brands.map((b: any) => (
                          <span key={b.id} className="text-xs bg-surface px-2 py-1 rounded-full text-slate-300">{b.name}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                )}
                {visibleCols.includes("endr") && <td className="table-td">{getEndrBadge(op)}</td>}
                <td className="table-td">
                  <Link href={`/operadores/${op.id}`} className="text-primary text-xs hover:underline">
                    Ver detalhes
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal: configurar colunas (admin) */}
      <Modal isOpen={showColsModal} onClose={() => setShowColsModal(false)} title="Colunas da tabela">
        <ColsConfig current={visibleCols} onSave={saveCols} onCancel={() => setShowColsModal(false)} />
      </Modal>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted">
            Página {page + 1} de {totalPages} ({filtered.length} operadores)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-secondary text-xs px-3 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="btn-secondary text-xs px-3 py-1 disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {/* Import Modal */}
      <Modal isOpen={showImport} onClose={() => setShowImport(false)} title="Importar Planilha de Operadores">
        <div className="mb-4 p-3 bg-blue-900/20 border border-blue-700/30 rounded-lg text-sm text-slate-300">
          <p className="font-medium text-white mb-1">Instruções</p>
          <p>Baixe o arquivo em <a href="https://www.gov.br/fazenda/pt-br/composicao/orgaos/secretaria-de-premios-e-apostas/lista-de-empresas" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">www.gov.br/fazenda — Lista de Empresas</a> e importe aqui.</p>
          <p className="mt-1 text-muted text-xs">Formatos aceitos: CSV, XLSX</p>
        </div>
        <form onSubmit={handleImport} className="space-y-4">
          <div>
            <label className="label">Categoria</label>
            <select className="input" value={importCategory} onChange={e => setImportCategory(e.target.value)}>
              <option value="autorizada">Autorizada</option>
              <option value="judicial">Decisão Judicial</option>
            </select>
          </div>
          <div>
            <label className="label">Arquivo (CSV ou XLSX) *</label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              required
              className="input"
              onChange={e => setImportFile(e.target.files?.[0] || null)}
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowImport(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={importing || !importFile} className="btn-primary">
              {importing ? "Importando..." : "Importar"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Novo Agente Operador">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Razão Social *</label>
            <input className="input" required value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Nome Fantasia</label>
            <input className="input" value={form.fantasy_name} onChange={e => setForm(f => ({ ...f, fantasy_name: e.target.value }))} />
          </div>
          <div>
            <label className="label">CNPJ</label>
            <input className="input" placeholder="00.000.000/0000-00" value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} />
          </div>
          <div>
            <label className="label">Website</label>
            <input className="input" type="url" placeholder="https://..." value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Ativo</option>
              <option value="pending">Pendente</option>
              <option value="suspended">Suspenso</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <div>
            <label className="label">Observações</label>
            <textarea className="input h-20 resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={creating} className="btn-primary">{creating ? "Criando..." : "Criar Operador"}</button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}

/* Configuração das colunas visíveis (definida pelo admin, vale para todos os usuários) */
function ColsConfig({ current, onSave, onCancel }: { current: string[]; onSave: (cols: string[]) => void; onCancel: () => void }) {
  const [sel, setSel] = useState<string[]>(current);
  function toggle(key: string) {
    setSel(s => s.includes(key) ? s.filter(k => k !== key) : [...s, key]);
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Marque as informações que devem aparecer na tabela de Agentes Operadores. A configuração vale para todos os usuários.</p>
      <div className="grid grid-cols-2 gap-2">
        {COLUMN_DEFS.map(c => (
          <label key={c.key} className="flex items-center gap-2 text-sm text-slate-200 p-2 rounded-lg border border-surface-border hover:bg-surface cursor-pointer">
            <input type="checkbox" checked={sel.includes(c.key)} onChange={() => toggle(c.key)} />
            {c.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted">Dica: a largura de cada coluna pode ser ajustada arrastando a borda direita do cabeçalho.</p>
      <div className="flex gap-3 justify-end">
        <button onClick={onCancel} className="btn-secondary">Cancelar</button>
        <button onClick={() => onSave(sel.length ? COLUMN_DEFS.map(c => c.key).filter(k => sel.includes(k)) : COLUMN_DEFS.map(c => c.key))} className="btn-primary">Salvar</button>
      </div>
    </div>
  );
}
