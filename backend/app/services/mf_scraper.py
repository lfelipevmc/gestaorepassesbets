import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session
from ..models.operator import BettingOperator, OperatorStatus
from ..models.audit import AuditLog
from .audit_service import log_action
import re
import io
import csv
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

MF_BASE_URL = "https://www.gov.br/fazenda/pt-br/composicao/orgaos/secretaria-de-premios-e-apostas/lista-de-empresas"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}


def scrape_mf_operators(db: Session) -> dict:
    """
    Busca a lista de agentes operadores na página da SPA/MF.
    Tenta encontrar e baixar arquivos CSV/XLSX linkados na página.
    """
    new_count = 0
    updated_count = 0
    errors = []

    try:
        response = httpx.get(MF_BASE_URL, headers=HEADERS, timeout=30, follow_redirects=True)

        if response.status_code == 403:
            return {
                "success": False,
                "error": "Acesso bloqueado pelo servidor do governo (403). Use a importação manual por planilha.",
                "url": MF_BASE_URL,
                "scraped_at": datetime.utcnow().isoformat()
            }

        response.raise_for_status()
        soup = BeautifulSoup(response.text, "lxml")

        # Busca links para arquivos CSV, XLSX na página
        file_links = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            text = a.get_text(strip=True).lower()
            if any(ext in href.lower() for ext in [".csv", ".xlsx", ".xls"]):
                full_url = href if href.startswith("http") else f"https://www.gov.br{href}"
                category = "judicial" if any(w in text for w in ["judicial", "decisão", "liminar"]) else "autorizada"
                file_links.append({"url": full_url, "text": a.get_text(strip=True), "category": category})

        if not file_links:
            result = _parse_html_table(soup, db)
            new_count = result["new"]
            updated_count = result["updated"]
            if new_count + updated_count == 0:
                return {
                    "success": False,
                    "error": "Nenhum arquivo CSV/XLSX ou tabela encontrada na página do governo. Use a importação manual.",
                    "url": MF_BASE_URL,
                    "scraped_at": datetime.utcnow().isoformat()
                }
        else:
            for file_info in file_links:
                try:
                    file_resp = httpx.get(file_info["url"], headers=HEADERS, timeout=60, follow_redirects=True)
                    file_resp.raise_for_status()
                    url_lower = file_info["url"].lower()
                    if ".csv" in url_lower:
                        result = _parse_csv_content(file_resp.text, db, file_info["category"])
                    elif ".xlsx" in url_lower or ".xls" in url_lower:
                        result = _parse_excel_bytes(file_resp.content, db, file_info["category"])
                    else:
                        result = {"new": 0, "updated": 0}
                    new_count += result["new"]
                    updated_count += result["updated"]
                except Exception as e:
                    errors.append(f"Erro ao baixar {file_info['url']}: {str(e)}")

        log_action(
            db=db,
            action="SCRAPE_MF",
            description=f"Sincronização MF: {new_count} novos, {updated_count} atualizados",
            new_values={"new": new_count, "updated": updated_count, "errors": errors}
        )

        return {
            "success": True,
            "new_operators": new_count,
            "updated_operators": updated_count,
            "files_found": len(file_links),
            "errors": errors,
            "scraped_at": datetime.utcnow().isoformat()
        }

    except Exception as e:
        logger.error(f"MF scrape error: {e}")
        return {"success": False, "error": str(e), "scraped_at": datetime.utcnow().isoformat()}


def import_from_file(db: Session, content: bytes, filename: str, category: str = "autorizada", user_id: int = None) -> dict:
    """
    Importa operadores de um arquivo CSV ou XLSX enviado pelo usuário.
    Colunas esperadas (flexível): Razão Social, Nome Fantasia, CNPJ, Website, Licença
    """
    filename_lower = filename.lower()
    try:
        if filename_lower.endswith(".csv"):
            text = content.decode("utf-8-sig", errors="replace")
            result = _parse_csv_content(text, db, category)
        elif filename_lower.endswith((".xlsx", ".xls")):
            result = _parse_excel_bytes(content, db, category)
        else:
            return {"success": False, "error": "Formato não suportado. Use CSV ou XLSX."}

        log_action(
            db=db,
            action="IMPORT_FILE",
            description=f"Importação manual '{filename}': {result['new']} novos, {result['updated']} atualizados",
            new_values=result,
            user_id=user_id
        )

        return {
            "success": True,
            "new_operators": result["new"],
            "updated_operators": result["updated"],
            "errors": result.get("errors", []),
            "imported_at": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Import error: {e}")
        return {"success": False, "error": str(e)}


def get_last_sync_info(db: Session) -> dict:
    """Retorna informações da última sincronização ou importação."""
    last = db.query(AuditLog).filter(
        AuditLog.action.in_(["SCRAPE_MF", "IMPORT_FILE"])
    ).order_by(AuditLog.created_at.desc()).first()

    if not last:
        return {"last_sync": None, "last_sync_action": None, "details": None}

    return {
        "last_sync": last.created_at.isoformat(),
        "last_sync_action": "Sincronização automática (MF)" if last.action == "SCRAPE_MF" else "Importação manual de arquivo",
        "details": last.new_values
    }


def _parse_csv_content(text: str, db: Session, category: str) -> dict:
    new_count = 0
    updated_count = 0
    errors = []
    separator = ";" if text.count(";") > text.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=separator)
    for row in reader:
        try:
            company_name = _find_field(row, ["razão social", "razao social", "empresa", "nome", "company_name", "nome empresarial"])
            fantasy_name = _find_field(row, ["nome fantasia", "fantasy_name", "marca", "nome comercial"])
            cnpj_raw = _find_field(row, ["cnpj"])
            website = _find_field(row, ["site", "website", "url", "endereço eletrônico", "dominio", "domínio"])
            license_num = _find_field(row, ["licença", "licenca", "autorização", "autorizacao", "número", "numero", "portaria"])
            if not company_name:
                continue
            cnpj = format_cnpj(cnpj_raw) if cnpj_raw else None
            res = _upsert_operator(db, company_name, fantasy_name, cnpj, website, license_num, category)
            if res == "new":
                new_count += 1
            elif res == "updated":
                updated_count += 1
        except Exception as e:
            errors.append(str(e))
    db.commit()
    return {"new": new_count, "updated": updated_count, "errors": errors}


def _parse_excel_bytes(content: bytes, db: Session, category: str) -> dict:
    import pandas as pd
    import unicodedata

    def norm(s: str) -> str:
        """Normaliza unicode e strip — para comparação segura de cabeçalhos."""
        return unicodedata.normalize("NFC", s).lower().strip()

    new_count = 0
    updated_count = 0
    errors = []
    try:
        # Tenta ler a primeira aba com dados (sheet_name=None lê todas; usamos a primeira não-vazia)
        all_sheets = pd.read_excel(io.BytesIO(content), dtype=str, sheet_name=None)
        df = None
        for name, sheet in all_sheets.items():
            if sheet.dropna(how="all").shape[0] > 1:  # pelo menos 1 linha de dados além do header
                df = sheet
                logger.info(f"Importando aba '{name}' com {len(sheet)} linhas")
                break
        if df is None:
            return {"new": 0, "updated": 0, "errors": ["Nenhuma aba com dados encontrada"]}

        df.columns = [norm(str(c)) for c in df.columns]
        df = df.fillna("")

        for _, row in df.iterrows():
            try:
                row_dict = {norm(k): str(v) for k, v in row.items()}
                company_name = _find_field(row_dict, ["razão social", "razao social", "empresa", "nome", "company_name", "nome empresarial"])
                fantasy_name = _find_field(row_dict, ["nome fantasia", "fantasy_name", "nome comercial"])
                cnpj_raw = _find_field(row_dict, ["cnpj"])
                website = _find_field(row_dict, ["site", "website", "url", "endereço eletrônico", "dominio", "domínio"])
                license_num = _find_field(row_dict, ["licença", "licenca", "autorização", "autorizacao", "número", "numero", "portaria"])
                city_raw = _find_field(row_dict, ["cidade", "município", "municipio", "localidade"])
                emails_raw = _find_field(row_dict, ["e-mail", "email", "e mail", "emails", "contato"])
                phones_raw = _find_field(row_dict, ["telefone", "fone", "celular", "whatsapp", "tel"])
                brands_raw = _find_field(row_dict, ["marcas", "marca", "brands"])

                if not company_name:
                    continue

                cnpj = format_cnpj(cnpj_raw) if cnpj_raw else None
                op_id, res = _upsert_operator_ex(db, company_name, fantasy_name, cnpj, website, license_num, category, city_raw)

                # Importa contatos (e-mails e telefones) se presentes
                if op_id:
                    _import_contacts(db, op_id, emails_raw, phones_raw, brands_raw)

                if res == "new":
                    new_count += 1
                elif res == "updated":
                    updated_count += 1
            except Exception as e:
                errors.append(str(e))
        db.commit()
    except Exception as e:
        errors.append(f"Erro ao ler arquivo: {str(e)}")
    return {"new": new_count, "updated": updated_count, "errors": errors}


def _upsert_operator_ex(db, company_name, fantasy_name, cnpj, website, license_num, category, city_raw):
    """Versão estendida que retorna (operator_id, 'new'/'updated'/'skip')."""
    from ..models.operator import BettingOperator, OperatorStatus
    existing = None
    if cnpj:
        existing = db.query(BettingOperator).filter(BettingOperator.cnpj == cnpj).first()
    if not existing:
        existing = db.query(BettingOperator).filter(
            BettingOperator.company_name.ilike(company_name.strip()[:100])
        ).first()

    prefix = "[Decisão Judicial] " if category == "judicial" else ""

    if existing:
        if fantasy_name:
            existing.fantasy_name = fantasy_name.strip()[:200]
        if website:
            existing.website = website.strip()[:500]
        if license_num:
            existing.mf_license_number = license_num.strip()
        if city_raw:
            parts = city_raw.split("/")
            existing.address_city = parts[0].strip()
            if len(parts) > 1:
                existing.address_state = parts[1].strip()[:2]
        return existing.id, "updated"
    else:
        city_field = state_field = None
        if city_raw:
            parts = city_raw.split("/")
            city_field = parts[0].strip()
            if len(parts) > 1:
                state_field = parts[1].strip()[:2]
        op = BettingOperator(
            company_name=(prefix + company_name.strip())[:500],
            fantasy_name=fantasy_name.strip()[:200] if fantasy_name else None,
            cnpj=cnpj,
            website=website.strip()[:500] if website else None,
            mf_license_number=license_num.strip() if license_num else None,
            status=OperatorStatus.active,
            address_city=city_field,
            address_state=state_field,
        )
        db.add(op)
        db.flush()
        return op.id, "new"


def _import_contacts(db, operator_id: int, emails_raw: str, phones_raw: str, brands_raw: str):
    """Importa e-mails e telefones de campos multi-valor (separados por \n ou ,)."""
    from ..models.operator import OperatorContact, OperatorBrand, ContactType

    existing_emails = {c.value for c in db.query(OperatorContact).filter_by(operator_id=operator_id, type=ContactType.email).all()}
    existing_phones = {c.value for c in db.query(OperatorContact).filter_by(operator_id=operator_id, type=ContactType.phone).all()}
    existing_brands = {b.name for b in db.query(OperatorBrand).filter_by(operator_id=operator_id).all()}

    if emails_raw:
        for email in [e.strip() for e in emails_raw.replace("\n", ",").split(",") if "@" in e]:
            if email and email not in existing_emails:
                db.add(OperatorContact(operator_id=operator_id, type=ContactType.email, value=email, source="planilha"))
                existing_emails.add(email)

    if phones_raw:
        for phone in [p.strip() for p in phones_raw.replace("\n", ",").split(",") if p.strip()]:
            if len(phone) >= 8 and phone not in existing_phones:
                db.add(OperatorContact(operator_id=operator_id, type=ContactType.phone, value=phone, source="planilha"))
                existing_phones.add(phone)

    if brands_raw:
        for brand in [b.strip() for b in brands_raw.replace("\n", ",").split(",") if b.strip()]:
            if brand and brand not in existing_brands:
                db.add(OperatorBrand(operator_id=operator_id, name=brand[:200]))
                existing_brands.add(brand)


def _parse_html_table(soup: BeautifulSoup, db: Session) -> dict:
    new_count = 0
    updated_count = 0
    for table in soup.find_all("table"):
        rows = table.find_all("tr")[1:]
        for row in rows:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) < 1:
                continue
            company_name = cells[0]
            cnpj_raw = cells[1] if len(cells) > 1 else None
            if not company_name or len(company_name) < 3:
                continue
            cnpj = format_cnpj(cnpj_raw) if cnpj_raw else None
            res = _upsert_operator(db, company_name, None, cnpj, None, None, "autorizada")
            if res == "new":
                new_count += 1
            elif res == "updated":
                updated_count += 1
    if new_count + updated_count > 0:
        db.commit()
    return {"new": new_count, "updated": updated_count}


def _upsert_operator(db: Session, company_name: str, fantasy_name, cnpj, website, license_num, category: str) -> str:
    _, res = _upsert_operator_ex(db, company_name, fantasy_name, cnpj, website, license_num, category, None)
    return res


def _find_field(row: dict, possible_keys: list) -> str:
    row_lower = {k.lower().strip(): v for k, v in row.items()}
    for key in possible_keys:
        val = row_lower.get(key.lower())
        if val and str(val).strip() and str(val).strip() not in ("nan", "none", "-", ""):
            return str(val).strip()
    return ""


def format_cnpj(raw: str) -> str:
    if not raw:
        return None
    digits = re.sub(r'\D', '', str(raw))
    if len(digits) == 14:
        return f"{digits[:2]}.{digits[2:5]}.{digits[5:8]}/{digits[8:12]}-{digits[12:14]}"
    return str(raw).strip() if raw else None
