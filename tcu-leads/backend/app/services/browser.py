"""
Sessão de navegador headless (Playwright/Chromium) para vencer o desafio
JavaScript do firewall F5/BIG-IP do TCU.

Contexto: um cliente HTTP comum recebe o cookie do firewall ("TS...") mas NÃO
roda o JavaScript que o valida — então as chamadas de API voltam vazias. O
Chromium roda esse JS, valida o cookie, e as chamadas feitas de dentro da
página (via fetch, mesma origem) retornam os dados reais. Foi comprovado que o
IP do servidor funciona; só faltava executar o desafio.

Degrada com segurança: se o Playwright/Chromium não estiver instalado, as
funções retornam indisponível e o chamador cai para o cliente HTTP comum.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx  # usado só para montar a URL com query params

logger = logging.getLogger(__name__)

TCU_HOME = "https://pesquisa.apps.tcu.gov.br/"
# Permite apontar para um Chromium específico (ex.: ambientes com browser fora do
# caminho padrão do Playwright). Em produção normalmente fica vazio.
CHROMIUM_EXECUTABLE = os.environ.get("PW_CHROMIUM_EXECUTABLE") or None


def playwright_available() -> bool:
    try:
        import playwright  # noqa: F401
        return True
    except ImportError:
        return False


class TcuBrowserSession:
    """Navegador headless reutilizável: abre uma vez, passa pelo desafio, e serve
    várias chamadas de API pela mesma página (cookies válidos, mesma origem)."""

    def __init__(self, user_agent: str, home_url: str = TCU_HOME):
        self.user_agent = user_agent
        self.home_url = home_url
        self._pw = None
        self._browser = None
        self._context = None
        self._page = None
        self._primed = False

    # -- ciclo de vida -------------------------------------------------------
    def open(self) -> bool:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            logger.warning("Playwright não instalado — navegador indisponível")
            return False
        try:
            self._pw = sync_playwright().start()
            launch_kwargs = dict(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
                      "--disable-blink-features=AutomationControlled"],
            )
            if CHROMIUM_EXECUTABLE:
                launch_kwargs["executable_path"] = CHROMIUM_EXECUTABLE
            self._browser = self._pw.chromium.launch(**launch_kwargs)
            self._context = self._browser.new_context(
                user_agent=self.user_agent, locale="pt-BR",
                extra_http_headers={"Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"},
            )
            self._page = self._context.new_page()
            return True
        except Exception as e:
            logger.warning(f"Falha ao abrir Chromium: {e}")
            self.close()
            return False

    def prime(self, timeout_ms: int = 45000) -> bool:
        """Carrega a home para o F5 emitir/validar o cookie via JavaScript."""
        if self._page is None:
            return False
        try:
            self._page.goto(self.home_url, wait_until="domcontentloaded", timeout=timeout_ms)
            # dá tempo para o desafio do F5 rodar e recarregar
            try:
                self._page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            self._page.wait_for_timeout(1500)
            self._primed = True
            return True
        except Exception as e:
            logger.warning(f"Prime (navegador) falhou: {e}")
            return False

    def close(self):
        for closer in (self._context, self._browser):
            try:
                if closer:
                    closer.close()
            except Exception:
                pass
        try:
            if self._pw:
                self._pw.stop()
        except Exception:
            pass
        self._pw = self._browser = self._context = self._page = None

    # -- uso -----------------------------------------------------------------
    def cookie_names(self) -> list:
        try:
            return sorted({c["name"] for c in self._context.cookies()})
        except Exception:
            return []

    def get(self, url: str, params: Optional[dict] = None, headers: Optional[dict] = None):
        """GET de dentro da página (mesma origem, cookies válidos, TLS do Chrome).
        Retorna (status, headers_dict, content_bytes) no mesmo formato de
        TcuHttpClient.fetch_raw — ou None se o navegador não estiver pronto."""
        if self._page is None:
            return None
        if not self._primed and not self.prime():
            return None
        full = str(httpx.URL(url, params=params or {}))
        # Referer é definido automaticamente pela página; não pode ir no fetch.
        hdrs = {"Accept": "application/json, text/plain, */*",
                "origem": "angular", "todas-bases": "false"}
        if headers:
            for k in ("uuid",):
                if headers.get(k):
                    hdrs[k] = headers[k]
        try:
            result = self._page.evaluate(
                """async ({url, headers}) => {
                    try {
                        const r = await fetch(url, {headers, credentials: 'include'});
                        const t = await r.text();
                        return {status: r.status, text: t};
                    } catch (e) { return {status: 0, text: 'fetch error: ' + e}; }
                }""",
                {"url": full, "headers": hdrs},
            )
            status = int(result.get("status") or 0)
            text = result.get("text") or ""
            if status == 0:
                logger.warning(f"fetch no navegador falhou: {text[:120]}")
                return None
            return status, {}, text.encode("utf-8")
        except Exception as e:
            logger.warning(f"GET (navegador) falhou: {e}")
            return None
