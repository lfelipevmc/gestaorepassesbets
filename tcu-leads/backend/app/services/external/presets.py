"""
Fontes sugeridas (presets) do Radar Externo, para o escritório começar já.

Cobre os alvos pedidos: DOU (palavras-chave jurídicas), portais de contratação
pública (onde saem os RFPs de serviços jurídicos), embaixadas em Brasília e
grandes estatais. As URLs são pontos de partida — cada fonte deve ser conferida
com o botão "Testar" (algumas páginas de licitação exigem ajustar a URL/seletor).

Foco temático (direito público): licitação/contratação de serviços advocatícios,
assessoria e consultoria jurídica, patrocínio de causa, inexigibilidade por
notória especialização (art. 74, III, Lei 14.133/2021).
"""

# Palavras-chave jurídicas para o DOU e para fontes sem categoria fixa
DOU_KEYWORDS_JURIDICO = [
    "serviços advocatícios", "serviços de advocacia", "assessoria jurídica",
    "consultoria jurídica", "patrocínio de causa", "escritório de advocacia",
    "notória especialização", "inexigibilidade de licitação", "serviços jurídicos",
    "representação judicial", "parecer jurídico", "contencioso",
]

# categoria_padrao: licitacao | sancao | nomeacao | palavra_chave | "" (auto)
PRESETS = [
    # --- Portais de contratação pública (maior volume de RFP jurídico) ---
    {"name": "PNCP — Contratações Públicas (Brasil)", "kind": "webpage",
     "url": "https://pncp.gov.br/app/editais?q=servi%C3%A7os%20advocat%C3%ADcios",
     "categoria_padrao": "licitacao",
     "keywords": "advocatícios, assessoria jurídica, consultoria jurídica, serviços jurídicos",
     "notes": "Portal Nacional de Contratações Públicas — agrega licitações de todo o país."},
    {"name": "Compras.gov.br — Contratações federais", "kind": "webpage",
     "url": "https://www.gov.br/compras/pt-br",
     "categoria_padrao": "licitacao",
     "keywords": "advocatícios, assessoria jurídica, serviços jurídicos",
     "notes": "Ajuste para a página/consulta de contratações de serviços jurídicos."},

    # --- Embaixadas em Brasília (contratam serviços jurídicos no Brasil) ---
    {"name": "Embaixada dos EUA — Brasília", "kind": "webpage",
     "url": "https://br.usembassy.gov/",
     "categoria_padrao": "licitacao",
     "keywords": "procurement, tender, solicitation, legal services, serviços jurídicos, RFP",
     "notes": "Procure a seção 'Business/Procurement'. Confira a URL exata da página de licitações."},
    {"name": "Embaixada da China — Brasília", "kind": "webpage",
     "url": "http://br.china-embassy.gov.cn/por/",
     "categoria_padrao": "licitacao",
     "keywords": "licitação, procurement, tender, serviços jurídicos, legal services",
     "notes": "Verificar página de avisos/procurement."},
    {"name": "Embaixada da Itália — Brasília", "kind": "webpage",
     "url": "https://ambbrasilia.esteri.it/pt/",
     "categoria_padrao": "licitacao",
     "keywords": "bando, gara, avviso, licitação, serviços jurídicos, procurement",
     "notes": "Seção 'Bandi di gara' / avisos."},
    {"name": "Embaixada da Espanha — Brasília", "kind": "webpage",
     "url": "https://www.exteriores.gob.es/Embajadas/brasilia/pt/",
     "categoria_padrao": "licitacao",
     "keywords": "licitación, contratación, licitação, serviços jurídicos, procurement",
     "notes": "Seção de contratación/perfil del contratante."},
    {"name": "Embaixada de Portugal — Brasília", "kind": "webpage",
     "url": "https://brasilia.embaixadaportugal.mne.gov.pt/pt/",
     "categoria_padrao": "licitacao",
     "keywords": "concurso, procedimento, licitação, serviços jurídicos, aviso",
     "notes": "Avisos/concursos públicos."},
    {"name": "Embaixada do Chile — Brasília", "kind": "webpage",
     "url": "https://chile.gob.cl/brasil/pt-br/",
     "categoria_padrao": "licitacao",
     "keywords": "licitación, licitação, serviços jurídicos, procurement, aviso",
     "notes": "Verificar seção de licitações/compras."},

    # --- Grandes estatais / empresas (licitações de serviços jurídicos) ---
    {"name": "Petrobras — Canal de Fornecedores", "kind": "webpage",
     "url": "https://www.petrobras.com.br/quem-somos/canal-fornecedor/",
     "categoria_padrao": "licitacao",
     "keywords": "serviços jurídicos, advocatícios, assessoria jurídica, contratação",
     "notes": "Página de oportunidades/licitações a fornecedores."},
    {"name": "BNDES — Licitações", "kind": "webpage",
     "url": "https://www.bndes.gov.br/wps/portal/site/home/transparencia/licitacoes-contratos",
     "categoria_padrao": "licitacao",
     "keywords": "serviços jurídicos, advocatícios, assessoria jurídica",
     "notes": "Licitações e contratos."},
    {"name": "Caixa — Licitações e Contratos", "kind": "webpage",
     "url": "https://www.caixa.gov.br/sobre-a-caixa/licitacoes-contratos/",
     "categoria_padrao": "licitacao",
     "keywords": "serviços jurídicos, advocatícios, assessoria jurídica",
     "notes": "Licitações e contratos da CAIXA."},
    {"name": "Correios — Licitações", "kind": "webpage",
     "url": "https://www.correios.com.br/acesso-a-informacao/licitacoes-e-contratos",
     "categoria_padrao": "licitacao",
     "keywords": "serviços jurídicos, advocatícios, assessoria jurídica",
     "notes": "Licitações e contratos dos Correios."},
]


def apply_presets(db, MonitoredSource) -> dict:
    """Adiciona as fontes sugeridas que ainda não existem (dedupe por URL)."""
    existentes = {s.url for s in db.query(MonitoredSource.url).all()}
    # (query acima retorna tuplas em algumas versões; normaliza)
    existentes = {u[0] if isinstance(u, tuple) else u for u in existentes}
    criadas = 0
    for p in PRESETS:
        if p["url"] in existentes:
            continue
        db.add(MonitoredSource(
            name=p["name"], kind=p["kind"], url=p["url"], enabled=True,
            keywords=p.get("keywords"), categoria_padrao=p.get("categoria_padrao") or None,
            notes=p.get("notes"),
        ))
        criadas += 1
    db.commit()
    return {"criadas": criadas, "total_presets": len(PRESETS)}
