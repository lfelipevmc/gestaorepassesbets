FROM python:3.12-slim
WORKDIR /app
# Fuso horário de Brasília: datas/horas gravadas, logs e agendador em America/Sao_Paulo
ENV TZ=America/Sao_Paulo
RUN apt-get update && apt-get install -y libpq-dev gcc tzdata \
    && ln -sf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime \
    && echo "America/Sao_Paulo" > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /app/uploads
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
