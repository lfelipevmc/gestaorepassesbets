"""Relatório de Valor Entregue.

Consolida os atendimentos de um cliente num relatório (agregados + HTML) e grava
uma cópia autocontida na PASTA DO CLIENTE (data/pastas/<id>_<nome>/).
"""
import os
import re
from collections import Counter
from datetime import datetime

from sqlalchemy.orm import Session

from ..config import PASTAS_DIR
from ..models import Atendimento, Cliente, Tarefa


def _moeda(v: float) -> str:
    s = f"{v:,.2f}"
    return "R$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def _slug(texto: str) -> str:
    return re.sub(r"[^\w]+", "_", (texto or "").strip()).strip("_")[:40] or "cliente"


def pasta_do_cliente(cliente: Cliente) -> str:
    caminho = os.path.join(PASTAS_DIR, f"{cliente.id}_{_slug(cliente.nome)}")
    os.makedirs(caminho, exist_ok=True)
    return caminho


def agregar(db: Session, cliente: Cliente) -> dict:
    ats = (
        db.query(Atendimento)
        .filter(Atendimento.cliente_id == cliente.id, Atendimento.medido == True)  # noqa: E712
        .order_by(Atendimento.inicio.asc())
        .all()
    )
    tarefas_abertas = (
        db.query(Tarefa)
        .filter(Tarefa.cliente_id == cliente.id, Tarefa.status == "aberta")
        .count()
    )
    minutos = sum(a.minutos_estimados or 0 for a in ats)
    valor = sum(a.valor_equivalente or 0.0 for a in ats)
    temas = Counter(a.tema for a in ats if a.tema)
    contrato_periodo = (cliente.valor_contrato_mensal or 0.0) * 3  # trimestre, referência

    return {
        "cliente": cliente,
        "atendimentos": ats,
        "n_atendimentos": len(ats),
        "minutos": minutos,
        "horas": round(minutos / 60.0, 1),
        "valor_equivalente": valor,
        "valor_equivalente_fmt": _moeda(valor),
        "contrato_mensal": cliente.valor_contrato_mensal or 0.0,
        "contrato_mensal_fmt": _moeda(cliente.valor_contrato_mensal or 0.0),
        "contrato_periodo": contrato_periodo,
        "contrato_periodo_fmt": _moeda(contrato_periodo),
        "temas": temas.most_common(),
        "tarefas_abertas": tarefas_abertas,
        "gerado_em": datetime.utcnow().strftime("%d/%m/%Y"),
    }


def _linhas_temas(temas) -> str:
    if not temas:
        return "<tr><td>—</td><td class='val'>0</td></tr>"
    return "".join(
        f"<tr><td>{t}</td><td class='val'>{n}</td></tr>" for t, n in temas
    )


def _html(ag: dict) -> str:
    c = ag["cliente"]
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relatório de Valor Entregue — {c.nome}</title>
<style>
 body{{font-family:Georgia,'Times New Roman',serif;color:#182029;background:#fff;margin:0;padding:40px;line-height:1.6}}
 .wrap{{max-width:720px;margin:0 auto}}
 .eyebrow{{font-family:ui-monospace,monospace;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#1b6b52}}
 h1{{font-size:1.9rem;margin:.3rem 0 .2rem}}
 .who{{color:#58636d;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.95rem}}
 table{{width:100%;border-collapse:collapse;margin:1.2rem 0;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.95rem}}
 th,td{{text-align:left;padding:.6rem .2rem;border-bottom:1px solid #e0ded4}}
 th{{font-family:ui-monospace,monospace;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:#58636d}}
 td.val{{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,monospace}}
 .gap{{background:#e6efe9;border-radius:12px;padding:1.2rem 1.4rem;margin-top:1.4rem;font-family:ui-sans-serif,system-ui,sans-serif}}
 .gap .big{{font-size:2.1rem;color:#1b6b52;font-weight:700}}
 .gap .lbl{{font-family:ui-monospace,monospace;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#58636d}}
 .foot{{margin-top:2rem;color:#58636d;font-family:ui-monospace,monospace;font-size:.72rem}}
</style></head><body><div class="wrap">
 <p class="eyebrow">Relatório de Valor Entregue</p>
 <h1>{c.nome}</h1>
 <p class="who">{c.empresa or ''} &middot; {c.telefone} &middot; gerado em {ag['gerado_em']}</p>
 <table>
   <tr><th>Indicador</th><th class="val">Total</th></tr>
   <tr><td>Nº de atendimentos</td><td class="val">{ag['n_atendimentos']}</td></tr>
   <tr><td>Esforço estimado</td><td class="val">{ag['horas']} h</td></tr>
   <tr><td>Valor equivalente avulso</td><td class="val">{ag['valor_equivalente_fmt']}</td></tr>
   <tr><td>Providências (tarefas) em aberto</td><td class="val">{ag['tarefas_abertas']}</td></tr>
 </table>
 <table>
   <tr><th>Tema tratado</th><th class="val">Atendimentos</th></tr>
   {_linhas_temas(ag['temas'])}
 </table>
 <div class="gap">
   <div class="lbl">Valor entregue no período</div>
   <div class="big">{ag['valor_equivalente_fmt']}</div>
   <div>Contrato atual: <b>{ag['contrato_mensal_fmt']}/mês</b> &nbsp;&middot;&nbsp; <b>{ag['contrato_periodo_fmt']}</b> no trimestre &rarr; base para reajuste.</div>
 </div>
 <p class="foot">Mensura &middot; valores estimados e auditáveis &middot; documento interno do escritório.</p>
</div></body></html>"""


def gerar_relatorio(db: Session, cliente: Cliente) -> dict:
    """Monta os agregados, grava o HTML na pasta do cliente e retorna tudo."""
    ag = agregar(db, cliente)
    caminho = pasta_do_cliente(cliente)
    nome_arq = f"Relatorio_Valor_Entregue_{datetime.utcnow().strftime('%Y%m%d')}.html"
    destino = os.path.join(caminho, nome_arq)
    with open(destino, "w", encoding="utf-8") as f:
        f.write(_html(ag))
    ag["arquivo"] = destino
    ag["arquivo_rel"] = os.path.relpath(destino, PASTAS_DIR)
    return ag
