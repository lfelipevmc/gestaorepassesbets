"""Instância única do Jinja2 usada pelas páginas, com filtros de formatação."""
import os

from fastapi.templating import Jinja2Templates

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
templates = Jinja2Templates(directory=TEMPLATES_DIR)


def _moeda(v) -> str:
    try:
        v = float(v or 0)
    except (TypeError, ValueError):
        v = 0.0
    s = f"{v:,.2f}"
    return "R$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def _dt(v) -> str:
    return v.strftime("%d/%m/%Y %H:%M") if v else "—"


templates.env.filters["moeda"] = _moeda
templates.env.filters["dt"] = _dt
