# Manual do Sistema — Gestão de Haveres de Bets

Sistema de gestão de cobrança e repasse de contrapartidas de direito de imagem
(Lei nº 13.756/2018) das casas de apostas (Bets) às confederações.

**Endereço de acesso:** https://repasses.vascav.com.br

---

## Sumário
1. [Acesso e perfis de usuário](#1-acesso-e-perfis-de-usuário)
2. [Dashboard (Central de Controle)](#2-dashboard-central-de-controle)
3. [A Fazer Hoje](#3-a-fazer-hoje)
4. [Agentes Operadores (Bets)](#4-agentes-operadores-bets)
5. [Confederações](#5-confederações)
6. [ENDR](#6-endr)
7. [Cobranças](#7-cobranças)
8. [Financeiro](#8-financeiro)
9. [Relatórios](#9-relatórios)
10. [Documentos](#10-documentos)
11. [Auditoria](#11-auditoria)
12. [Usuários e Escritório (admin)](#12-usuários-e-escritório-admin)
13. [Rotina mensal recomendada](#13-rotina-mensal-recomendada)

---

## 1. Acesso e perfis de usuário

Acesse https://repasses.vascav.com.br e faça login com e-mail e senha.

Existem **3 perfis**:
- **Administrador** — acesso total, incluindo gestão de usuários e dados do escritório.
- **Escritório** — todas as funções operacionais (cobrança, financeiro, relatórios), sem gestão de usuários.
- **Confederação (leitor)** — somente leitura, restrito aos dados da própria confederação (portal do cliente).

> Ao primeiro acesso, troque a senha padrão em **Usuários** (admin).

---

## 2. Dashboard (Central de Controle)

É a tela inicial. Mostra:
- **Alertas priorizados** — repartições vencidas, operadores sem e-mail, pagamentos atrasados. Clique para ir direto ao item.
- **"O que realizamos este mês"** — notificações enviadas, contatos, respostas e valor recebido (visão de transparência).
- **Indicadores (KPIs)** — total recebido, total repassado, a repassar e adimplência geral.
- **Evolução da adimplência** — gráfico dos últimos 6 meses.
- **Por confederação** — desempenho de cada cliente.

---

## 3. A Fazer Hoje

Fila **priorizada** de tarefas operacionais do dia:
- Notificações a enviar (1ª/2ª no prazo configurado);
- Repartições vencendo ou vencidas;
- E-mails de resposta a conciliar;
- Bets sem contato recente — com **canal de contato sugerido** (e-mail/WhatsApp/telefone).

Cada item é clicável e leva direto à ação. Use esta tela como ponto de partida do dia.

---

## 4. Agentes Operadores (Bets)

Lista de todas as casas de apostas. Cada Bet tem um cadastro completo, organizado em abas:

- **Dados Cadastrais** — razão social, CNPJ, endereço, autorização da SPA, etc.
- **Marcas Vinculadas** — marcas comerciais (sites, Instagram, etc.).
- **Responsáveis** — contatos Legal, Financeiro e Jurídico (nome, e-mail, telefone).
- **ENDR** — meses em que a Bet está associada ao ENDR (cobrança suspensa).
- **Contatos** — e-mails e telefones cadastrados.
- **Pesquisa de Contatos** — busca automática de contatos (Receita Federal/CNPJ,
  dedução por domínio, web e IA). Clique em **Iniciar Pesquisa**, aguarde, e
  **aprove ou rejeite** cada sugestão encontrada.
- **Histórico de Pagamentos** — grade dos últimos 12 meses + **selo de conformidade**
  (★ Bom pagador / Regular / Crítico) e lançamentos avulsos.
- **Documentos** — arquivos anexados à Bet.
- **Auditoria** — registro de todas as ações sobre aquela Bet.

No topo do cadastro aparece o **selo de adimplência** da Bet.

---

## 5. Confederações

Os clientes do escritório (CBTM, CBT, CBW, CBH e novas que vierem). Botão **+ Nova
Confederação** para cadastrar novos clientes.

Em cada confederação:
- **Cadastro** — nome, **Sigla** (usada nas notificações pela chave `{confederacaosigla}`),
  presidente, e-mails, logomarca, documentos.
- **Receitas por Mês**, **Repasses ENDR**.
- **Regras de Rateio** — regulamento e regras de distribuição aos beneficiários,
  com upload do regulamento e link online.
- **Datas do fluxo de cobrança** — dia de vencimento, dias das notificações e prazos
  (configuráveis por confederação).

---

## 6. ENDR

Cadastro do ENDR (Escritório Nacional de Rateio) e o controle **mensal** de quais Bets
estão associadas. Bet associada ao ENDR em determinado mês **não é cobrada** naquele mês —
o sistema já a exclui automaticamente das notificações.

---

## 7. Cobranças

Coração do sistema. Tem duas abas: **Ciclos** e **Modelos de Cobrança**.

### Criar um ciclo
**+ Novo Ciclo** → escolha a confederação, o **mês/ano** de referência (por seleção, sem
digitar) e, opcionalmente, um modelo de cobrança. O sistema cria a cobrança para todas as
Bets ativas.

### Dentro do ciclo
- **Resumo colorido** — quantidade e percentual de adimplentes, inadimplentes, pendentes
  de relatório, "não explora esporte" e "judicializado".
- **Pagamentos por operador** — para cada Bet, as ações:
  - **Valor devido** — registra o valor informado pela Bet (o escritório não calcula).
  - **Repasse recebido** — registra cada repasse (pode haver mais de um no mês).
  - **Relatório** — registra e **anexa** o relatório de GGR.
  - **Contatar** — central multicanal: e-mail, WhatsApp, telefone e redes sociais, com
    mensagem pronta. Cada contato é **registrado automaticamente** na linha do tempo.
  - **GGR** — análise que compara o valor com a média histórica da Bet e sinaliza desvios.
  - **Categorizar** — marcar como "não explora esporte" ou "judicializado".

### Enviar notificação
Botão **Preparar Notificação**:
1. Escolha 1ª, 2ª ou 3ª notificação;
2. Escolha/edite o **modelo** e o **prazo**;
3. Veja os **destinatários pré-selecionados** (já exclui quem pagou e quem está no ENDR);
4. Confira a **pré-visualização preenchida** (exemplo real);
5. Clique em **Revisar envio** → **confirme o disparo** (aviso antes de enviar);
6. Veja o **extrato de envio** com o status de cada Bet e baixe o **comprovante**
   (com número de protocolo) de cada envio.

### Aba Comunicações (dentro do ciclo)
- **Sincronizar Caixa de Entrada** — importa as respostas das Bets;
- **Fila de conciliação** — vincular respostas ao operador correto (com sugestão de IA);
- Lista de e-mails enviados/recebidos, com **comprovante** dos enviados.

### Outras ações do ciclo
- **Gerar Ofício SPA** — gera a minuta (.docx) à Secretaria de Prêmios e Apostas com a
  relação de inadimplentes.
- **Relatório de Atividades** — PDF com o panorama do mês de trabalho.

---

## 8. Financeiro

Estruturado **por confederação** (cada cliente é uma empresa distinta). Selecione o
cliente no topo (ou "Visão Geral" para o consolidado). Abas:

- **Resumo** — receita recebida e situação dos repasses.
- **Repasses (Fase 1)** — todos os valores recebidos das Bets (de ciclos ou avulsos).
  Botão **+ Novo Lançamento Avulso** para registrar um repasse sem ciclo.
- **Repartição (Fase 2)** — distribuição dos valores recebidos aos beneficiários finais,
  conforme o regulamento, com controle de **prazo legal**. Sub-aba **Beneficiários** para
  cadastrar atletas/clubes/federações e seus dados bancários.
- **E-mails** — respostas das Bets e fila de conciliação.

> **Fase 1 = dinheiro que entrou** (da Bet). **Fase 2 = dinheiro que sai** (aos beneficiários).

---

## 9. Relatórios

- **Consolidado / Cruzado** — adimplência por confederação, mês e Bet, com filtros e
  exportação em **Excel** e **PDF**.
- **Por Ciclo** — relatório de um ciclo específico (Excel) e o **Relatório de Atividades (PDF)**.
- **Evidências (ISO 9001)** — dossiê mensal consolidado (notificações, respostas, valores,
  repartições). Pode **baixar em PDF** ou **enviar ao e-mail do escritório** para revisão
  antes de encaminhar à confederação.

---

## 10. Documentos

Repositório central de todos os documentos do sistema (ofícios, comprovantes, regulamentos,
respostas arquivadas), pesquisável.

---

## 11. Auditoria

Registro completo e imutável de **todas as ações** realizadas no sistema, com filtros
combináveis (cliente/confederação, ação, tipo de registro, usuário, período) e exportação
em PDF. É a base da rastreabilidade e da conformidade (ISO 9001).

---

## 12. Usuários e Escritório (admin)

- **Usuários** — criar/editar usuários, definir perfil e (para leitores) a confederação
  vinculada. Usuário desativado **some das seleções** mas mantém o histórico.
- **Escritório** — dados do escritório e **logomarca**, usados nas comunicações e relatórios.
  O nome/assinatura cadastrado preenche a chave `{escritorio}` nos modelos.

---

## 13. Rotina mensal recomendada

1. **Início do mês** — confira o **Dashboard** e **A Fazer Hoje**.
2. **Criar os ciclos** do mês (um por confederação) em **Cobranças**.
3. **Dia da 1ª notificação** — abrir cada ciclo → **Preparar Notificação** → revisar → enviar.
4. **Ao longo do mês** — registrar **repasses recebidos** e **relatórios**; usar **Contatar**
   para cobrar pelos vários canais; **sincronizar e-mails** e conciliar respostas.
5. **Dia da 2ª/3ª notificação** — repetir o envio para quem segue inadimplente.
6. **Fechamento** — **Gerar Ofício SPA** dos inadimplentes; gerar **Relatório de Atividades**
   e o **dossiê de Evidências**; lançar e acompanhar as **repartições (Fase 2)** dentro do prazo.
7. **Sempre** — manter os contatos das Bets atualizados (aba **Pesquisa de Contatos**).

---

*Dúvidas sobre uma funcionalidade específica? Consulte a aba correspondente — cada tela traz
textos de orientação. Este sistema registra tudo em auditoria, então pode explorar com segurança.*
