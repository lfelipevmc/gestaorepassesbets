FROM python:3.12-slim-bookworm

WORKDIR /app

# Dependências de sistema:
#  - build-essential/libffi: para PyMuPDF/pdfplumber;
#  - libs do Chromium headless (lista fixa do Debian bookworm) — instaladas
#    aqui em vez de "playwright install --with-deps", que tenta pacotes de fonte
#    com nomes antigos (ttf-unifont) inexistentes no Debian atual.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libffi-dev \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxcb1 libxkbcommon0 libatspi2.0-0 libx11-6 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libxrender1 libgbm1 \
    libglib2.0-0 libxshmfence1 libpango-1.0-0 libcairo2 libasound2 \
    libfontconfig1 fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Baixa apenas o binário do Chromium (as libs de sistema já foram instaladas acima).
RUN playwright install chromium

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
