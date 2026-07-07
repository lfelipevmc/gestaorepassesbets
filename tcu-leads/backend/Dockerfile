FROM python:3.12-slim

WORKDIR /app

# Dependências de sistema para PyMuPDF/pdfplumber
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Navegador headless (Chromium) para vencer o desafio JavaScript do firewall F5
# do TCU. --with-deps instala também as bibliotecas de sistema necessárias.
RUN playwright install --with-deps chromium

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
