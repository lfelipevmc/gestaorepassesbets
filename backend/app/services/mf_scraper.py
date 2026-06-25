import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session
from ..models.operator import BettingOperator, OperatorStatus
from .audit_service import log_action
import re
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

MF_URL = "https://www.gov.br/fazenda/pt-br/acesso-a-informacao/acoes-e-programas/apostas/agentes-operadores"


def scrape_mf_operators(db: Session) -> dict:
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; GestaoBets/1.0; +legal-compliance)"}
        response = httpx.get(MF_URL, headers=headers, timeout=30, follow_redirects=True)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "lxml")
        operators_found = []
        new_count = 0
        updated_count = 0

        tables = soup.find_all("table")
        for table in tables:
            rows = table.find_all("tr")
            for row in rows[1:]:
                cells = row.find_all(["td", "th"])
                if len(cells) >= 2:
                    company_name = cells[0].get_text(strip=True)
                    cnpj_raw = cells[1].get_text(strip=True) if len(cells) > 1 else None

                    if not company_name or len(company_name) < 3:
                        continue

                    cnpj = format_cnpj(cnpj_raw) if cnpj_raw else None

                    existing = None
                    if cnpj:
                        existing = db.query(BettingOperator).filter(BettingOperator.cnpj == cnpj).first()
                    if not existing:
                        existing = db.query(BettingOperator).filter(
                            BettingOperator.company_name.ilike(company_name)
                        ).first()

                    if existing:
                        existing.updated_at = datetime.utcnow()
                        updated_count += 1
                    else:
                        op = BettingOperator(
                            company_name=company_name,
                            cnpj=cnpj,
                            status=OperatorStatus.active,
                        )
                        db.add(op)
                        new_count += 1

                    operators_found.append(company_name)

        if not operators_found:
            items = soup.find_all(["li", "p"], class_=re.compile(r"operador|operator|bet", re.I))
            for item in items:
                text = item.get_text(strip=True)
                if len(text) > 5:
                    existing = db.query(BettingOperator).filter(
                        BettingOperator.company_name.ilike(text[:50])
                    ).first()
                    if not existing:
                        op = BettingOperator(company_name=text[:200], status=OperatorStatus.active)
                        db.add(op)
                        new_count += 1
                    operators_found.append(text[:50])

        db.commit()

        log_action(
            db=db,
            action="SCRAPE_MF",
            description=f"Sincronização com MF: {new_count} novos, {updated_count} atualizados",
            new_values={"new": new_count, "updated": updated_count, "total_found": len(operators_found)}
        )

        return {
            "success": True,
            "new_operators": new_count,
            "updated_operators": updated_count,
            "total_found": len(operators_found),
            "scraped_at": datetime.utcnow().isoformat()
        }

    except Exception as e:
        logger.error(f"MF scrape error: {e}")
        return {"success": False, "error": str(e)}


def format_cnpj(raw: str) -> str:
    digits = re.sub(r'\D', '', raw)
    if len(digits) == 14:
        return f"{digits[:2]}.{digits[2:5]}.{digits[5:8]}/{digits[8:12]}-{digits[12:14]}"
    return raw if raw else None
