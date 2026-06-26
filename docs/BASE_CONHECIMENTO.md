# Base de Conhecimento — Sistema de Gestão de Haveres de Bets

> Documento de referência para futuras alterações. Descreve o enquadramento jurídico,
> o modelo operacional **correto** (revisado a partir dos regulamentos das confederações)
> e as decisões de arquitetura. **Leia antes de mexer em pagamentos, rateio ou cobrança.**

Última revisão: 2026-06 (revisão a partir dos regulamentos CBW, CBT e CBTM).

---

## 1. Enquadramento jurídico

- **Base legal:** art. 30, §1º-A, III, alínea "a", da Lei nº 13.756/2018 (alterada pela Lei
  nº 14.790/2023) e Portaria SPA/MF nº 41/2025.
- **Natureza:** "Contrapartidas" = contraprestação civil pelo uso de imagem, apelidos
  esportivos, marcas, símbolos etc. em apostas de quota fixa (art. 87-A da Lei nº 9.615/1998).
- **Escritório:** advogado contratado por 4 confederações (CBTM, CBT, CBW, CBH) para **receber e
  controlar** os repasses das ~85 operadoras (Bets) autorizadas pelo MF.

## 2. O MODELO CORRETO (o ponto mais importante)

### 2.0 As DUAS FASES do repasse (Manual de Destinações SPA/MF + Regulamento)

O repasse da destinação de imagem (art. 30, §1º-A, III, "a") ocorre em **duas fases**:

**FASE 1 — Cálculo da receita por competição (Manual de Destinações SPA/MF).**
- O agente operador calcula, **por competição esportiva** objeto de aposta, o valor da contrapartida.
- **Base de Cálculo** = Arrecadação Total com Apostas − prêmios pagos − IR incidente.
- A destinação de imagem às entidades do Sinesp é **7,30% das Destinações Totais (12%)**, o que
  equivale a **0,876% da Base de Cálculo** (0,073 × 0,12 = 0,00876). É a "1ª fase de rateios".
- Resultado: o operador sabe o valor a repassar **a cada competição** → é a **receita** que a
  confederação recebe. **Quem calcula é o operador, não o escritório.**

**FASE 2 — Reversão aos beneficiários finais (Regulamento da Confederação).**
- O valor recebido por competição é **revertido aos beneficiários**: confederação, organizações de
  prática esportiva (clubes) e atletas, conforme a **matriz de rateio do regulamento** (ver §3).
- A confederação executa essa repartição (é o "motor de redistribuição" do sistema — ver §3.3).
- Portaria SPA/MF 41/2025, art. 3º: o rateio segue o regulamento da competição; §4º trata de
  competição internacional (rateio equânime por partida entre confederação e entidades de prática).

> Resumindo: **Fase 1 = receita** (operador calcula e paga a confederação). **Fase 2 = repartição**
> (confederação distribui aos beneficiários finais). O escritório controla as duas, mas **não
> calcula** a Fase 1.

### 2.1 Quem calcula o valor? O AGENTE OPERADOR — nunca o escritório.

Os três regulamentos são unânimes:

- **CBT/CBTM, Art. 4º:** a repartição ocorre "após a realização da **primeira fase de rateios
  pelo agente operador**".
- **CBT/CBTM, Art. 8º, §2º:** "Compete **exclusivamente ao agente operador** a apuração dos
  eventos elegíveis, dos integrantes do Sinesp beneficiários e seus respectivos valores devidos."
- **CBW, Art. 10, §único:** "A distribuição das Contrapartidas pela CBW será realizada de boa-fé,
  com base nos **relatórios fornecidos pelos agentes operadores**. A responsabilidade pela
  apuração... caberá **exclusivamente às operadoras**."

**Consequência prática:**
> ❌ NÃO existe fórmula `GGR × 12% × 7,3% × %` aplicada pelo escritório.
> O escritório **não conhece o GGR** e **não calcula** a contrapartida.
> ✅ A operadora apura, paga e envia relatório. O sistema **registra** o valor recebido (regime
> de caixa) e **concilia** com o relatório.

Esse foi o principal erro corrigido: a antiga tela "Declarar GGR" virou **"Registrar Valor
Devido"** (valor informado pela operadora) e o campo `GGR_MULTIPLIER` foi removido.

### 2.2 Regime de caixa

- Controla-se pela **data de recebimento** do dinheiro.
- O valor recebido no mês X pode, segundo o relatório, referir-se à competência do mês Y.
  Por isso o pagamento tem `report_reference_month` (mês de competência do relatório) separado da
  data de recebimento.

### 2.3 Status de adimplência (3 estados, não 2)

| Status            | Significado                                                        |
|-------------------|-------------------------------------------------------------------|
| `paid`            | Pagou **e** enviou relatório → **Adimplente**                     |
| `report_pending`  | Pagou, mas **relatório ainda não chegou** → **Pendente de Relatório** |
| `pending`/`overdue` | Não pagou → **Inadimplente**                                     |

Fundamento do `report_pending`: a operadora pode pagar e individualizar depois — o CBW Art. 8º dá
até **180 dias** para o operador individualizar os valores após o repasse. A taxa de adimplência
considera `paid + report_pending` como adimplentes (pagaram).

## 3. Rateio (distribuição aos beneficiários finais)

A confederação **recebe e redistribui** as Contrapartidas a atletas, entidades de prática
esportiva (clubes) e federações estaduais. O rateio **não é um percentual fixo por bet** — depende
do **tipo de competição** e é apurado **por partida** pela operadora.

> ❌ Erro corrigido: a tabela "% por bet" (`OperatorConfederationRule`) foi removida.
> ✅ Substituída por `DistributionRule` — matriz de rateio por **cenário de competição**, por
> confederação, fiel ao regulamento.

### 3.1 Matriz CBW (percentuais fixos)

| Cenário | Art. | Rateio |
|---|---|---|
| Internacional sem atleta brasileiro | 3º | 100% CBW |
| Internacional com atleta brasileiro | 4º | 50% CBW / 50% atleta |
| Nacional — só atleta | 5º | 50% CBW / 50% atleta |
| Nacional — atleta + clube | 6º | 50% CBW / 30% clube / 20% atleta |
| Nacional — atleta + federação | 7º | 50% CBW / 20% federação / 30% atleta |

> CBW Art. 8º: se a operadora não individualizar em até 180 dias, aplica-se rateio igualitário
> por categoria (interclubes / entre federações / atletas em nome próprio).
> CBW Art. 13: repasse aos beneficiários em até **90 dias** do recebimento (`redistribution_deadline_days`).

### 3.2 Matriz CBT e CBTM (rateio equânime)

| Cenário | Art. | Rateio |
|---|---|---|
| Internacional sem integrantes do Sinesp | 5º | 100% à confederação |
| Internacional com integrantes do Sinesp | 6º | **Equânime** entre confederação, entidade e/ou atleta cujos direitos foram explorados, por partida. Duplas/equipes dividem igualmente. |
| Nacional com integrantes do Sinesp | 7º | **Equânime** entre todos os integrantes do Sinesp participantes do jogo/partida |

"Equânime" = percentuais idênticos entre os participantes → o número de partes **varia** por
partida. Por isso `DistributionRule.is_equanime = true` (sem percentuais fixos).

## 4. ENDR (Escritório Nacional de Direitos de Rateio)

- O ENDR congrega várias bets e faz **um repasse único**, sem individualizar valores por bet —
  apenas informa **quais bets** repassaram em cada mês.
- Modelado por `ENDRPayment` (1 repasse: valor, data, mês) + `ENDRPaymentBetLink` (bets cobertas).
- Bet associada ao ENDR num mês **não é cobrada** naquele mês (`EndrAssociation`, checado no
  scheduler antes de notificar).
- `ENDREntity` guarda o cadastro institucional do ENDR (CNPJ, contatos).

## 5. Modelo de dados (campos-chave)

### `Payment` (regime de caixa)
- `base_calculo` — Base de Cálculo apurada pela operadora (do relatório), opcional.
- `amount_due` — Valor devido **informado pela operadora** (não calculado).
- `amount_paid` — Valor efetivamente recebido.
- `report_received`, `report_reference_month`, `report_notes`, `report_file_url` — relatório.
- `status` — ver §2.3.
- ⚠️ Removidos: `ggr_declared`, `calculated_amount`, `operator_percentage` (modelo antigo, errado).

### `Confederation` (cadastro)
- Empresariais: `cnpj`, `website`, `phone`, `address`.
- Presidente: `president_name/email/phone/term`.
- `logo_url`, `regulation_text`, `rateio_rules` (texto livre), `redistribution_deadline_days`.
- ⚠️ `ggr_percentage` foi descontinuado (não há percentual único — ver §3).

### `DistributionRule`
- `scenario_code`, `scenario_label`, `article_ref`.
- `confederation_pct`, `athlete_pct`, `entity_pct`, `federation_pct` (nulos quando equânime).
- `is_equanime` (bool), `description`, `order_index`.
- Semeado em `main.py::_seed_distribution_rules()` a partir dos regulamentos.

## 6. Endpoints relevantes
- `POST /api/payments/{id}/declare-value` — registra `amount_due` (+ `base_calculo`). **Sem fórmula.**
- `POST /api/payments/{id}/confirm` — registra recebimento (caixa) → `report_pending` ou `paid`.
- `POST /api/payments/{id}/register-report` + `/upload-report` — concilia relatório.
- `GET/POST /api/payments/endr` — repasses consolidados do ENDR.
- `GET/POST/PATCH/DELETE /api/confederations/{id}/distribution-rules` — matriz de rateio.

## 6.1 Cobranças, Financeiro e Motor de Redistribuição (IMPLEMENTADO)

### Cobranças
- **Múltiplos repasses por Bet/mês/confederação:** `PaymentReceipt` (filho de `Payment`). Cada
  repasse recebido é um receipt; `Payment.amount_paid` = soma dos receipts. Uma Bet pode repassar
  para uma confederação e não para outra (cada `Payment` é por confederação).
- **Modelos de cobrança (`MessageTemplate`):** textos padrão por ocasião (1ª/2ª notificação, final,
  solicitação de relatório). Placeholders `{bet} {confederacao} {mes} {valor} {prazo} {escritorio}`
  substituídos no envio (`notification_service.render_placeholders`). Template específico da
  confederação tem prioridade sobre o global. Página `/modelos`.
- **Conciliação de respostas (`EmailMessage`):** e-mails enviados são registrados (outbound) e a
  caixa de entrada é lida via Graph (`email_matcher.sync_inbox`, job 3x/dia), casando respostas ao
  operador pelo endereço do remetente. Endpoint `POST /api/finance/sync-emails`. Aba E-mails no
  Financeiro.

### Financeiro (`/financeiro`) e Redistribuição (Fase 2)
- **`Beneficiary`** — atleta/clube/federação/confederação, com dados bancários (CBW Art. 12).
- **`Redistribution`** — um valor recebido (Fase 1) a redistribuir; `deadline_date` = received_date +
  `Confederation.redistribution_deadline_days` (CBW Art. 13 = 90 dias). Status pending/partial/completed.
- **`RedistributionItem`** — parcela por beneficiário; marcar como repassado (paid) + comprovante.
- Frontend pode pré-preencher itens a partir da matriz `DistributionRule` (percentuais fixos);
  cenários equânimes são preenchidos manualmente (nº de participantes varia).
- Endpoints: `/api/beneficiaries`, `/api/redistributions` (+ items/pay/proof),
  `/api/finance/summary`, `/api/finance/by-confederation`.
- Job diário `job_redistribution_deadline_alerts` registra alerta de prazos vencidos.

## 7. Trabalho futuro recomendado (ainda NÃO implementado)
- **Parser automático de relatórios** das operadoras (nome do evento, base de cálculo por partida,
  beneficiários) — hoje o relatório é anexado como arquivo e os campos preenchidos à mão; a
  redistribuição (Fase 2) é criada manualmente a partir do valor recebido.
- **Geração de redistribuição direto do recebimento:** botão "criar redistribuição" a partir de um
  `Payment`/`ENDRPayment` já conciliado (hoje cria-se manualmente no Financeiro).
- **Threading completo de e-mail** por `conversationId` (hoje casa-se por remetente).

## 8. Princípios para futuras alterações
1. **O escritório registra e concilia; nunca calcula a contrapartida.** Qualquer fórmula de GGR
   está errada.
2. **Regime de caixa** é o método oficial — não migrar para competência; apenas anotar a
   competência informada no relatório.
3. **Rateio depende do tipo de competição e da participação do Sinesp**, é por partida e varia por
   confederação. Não criar percentual fixo por bet.
4. Toda operação financeira gera **log de auditoria imutável** (`AuditLog`).
