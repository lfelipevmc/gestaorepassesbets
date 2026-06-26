# Manual Detalhado — Sistema de Gestão de Haveres de Bets

**Versão completa para a equipe operacional do escritório**

Sistema de gestão da cobrança e do repasse das contrapartidas de **direito de imagem**
devidas pelas casas de apostas (Bets) às confederações esportivas, nos termos da
**Lei nº 13.756/2018** e da regulamentação da SPA/MF.

**Acesso:** https://repasses.vascav.com.br

---

## Como ler este manual

Cada módulo é explicado em quatro camadas:
- **O que é / para que serve** — o objetivo da tela.
- **A lógica por trás** — as regras de negócio e jurídicas que o sistema aplica.
- **Como usar (passo a passo)** — a operação prática.
- **Interligações** — como aquela tela conversa com o resto do sistema.

> Símbolo 🔗 indica uma **interligação sistêmica** importante.
> Símbolo ⚖️ indica uma **regra jurídica/de negócio** que o sistema automatiza.
> Símbolo 💡 indica uma **boa prática** de uso.

---

## Sumário
1. Conceitos fundamentais (leia primeiro)
2. Acesso, perfis e segurança
3. Dashboard — Central de Controle
4. A Fazer Hoje
5. Agentes Operadores (Bets)
6. Confederações
7. ENDR
8. Cobranças
9. Financeiro
10. Relatórios
11. Documentos
12. Auditoria
13. Usuários e Escritório
14. O ciclo de vida completo de uma cobrança (visão integrada)
15. Perguntas frequentes

---

## 1. Conceitos fundamentais (leia primeiro)

Entender estes cinco conceitos faz todo o resto do sistema fazer sentido.

### 1.1. O escritório NÃO calcula o valor devido
⚖️ A apuração do valor da contrapartida é **exclusiva do agente operador** (a Bet), com
base no seu GGR (Gross Gaming Revenue). A base legal é a própria sistemática da
Lei 13.756/2018 e dos regulamentos das confederações (ex.: CBT/CBTM e CBW). O escritório
**registra** o valor informado pela Bet e **concilia** com o relatório recebido — nunca
inventa um número. Por isso, no sistema, o campo de valor se chama "valor devido **informado
pelo operador**".

### 1.2. Regime de caixa
⚖️ O sistema trabalha em **regime de caixa**: o que importa é **quando o dinheiro entrou**.
Por isso todo recebimento tem duas datas distintas:
- **Data de recebimento** — quando o valor efetivamente caiu (regime de caixa).
- **Mês de competência (referência)** — a que mês aquele repasse se refere.
Um valor recebido em maio pode se referir à competência de março. O sistema trata os dois
separadamente para que os relatórios fiquem corretos.

### 1.3. Duas fases do dinheiro
🔗 O dinheiro percorre **duas fases**, e o sistema as mantém ligadas:
- **Fase 1 — Recebimento:** o dinheiro entra (da Bet para a confederação).
- **Fase 2 — Repartição:** o dinheiro sai (da confederação para os beneficiários finais —
  atletas, clubes, federações — conforme o regulamento de rateio).
Toda repartição da Fase 2 nasce **vinculada** a um recebimento da Fase 1.

### 1.4. O ENDR suspende a cobrança
⚖️ Se uma Bet está associada ao **ENDR** (Escritório Nacional de Rateio) em determinado mês,
ela **não deve ser cobrada** naquele mês — o repasse é feito de forma consolidada pelo ENDR.
O sistema verifica isso automaticamente e **exclui** essas Bets das notificações daquele mês.

### 1.5. Tudo é rastreável (compliance)
🔗 Cada ação relevante gera um **registro de auditoria** e, na cobrança, um **evento** na
linha do tempo do ciclo. Isso alimenta os relatórios de evidências (ISO 9001) e a
transparência ao cliente. **Pode operar com segurança** — o sistema documenta o trabalho.

---

## 2. Acesso, perfis e segurança

### O que é
Controle de quem entra e o que cada um pode ver/fazer.

### A lógica por trás
Há **3 perfis**, com escopos diferentes:

| Perfil | Vê | Pode fazer |
|---|---|---|
| **Administrador** | Tudo | Tudo + gerenciar usuários e dados do escritório |
| **Escritório** | Tudo operacional | Cobrança, financeiro, relatórios, cadastros (sem gestão de usuários) |
| **Confederação (leitor)** | **Apenas a própria confederação** | Somente leitura (portal do cliente) |

🔗 O perfil **leitor** é o que viabiliza o **Portal do Cliente**: ao logar, a confederação
vê o dashboard, os alertas, os números financeiros e a transparência **filtrados
automaticamente** só para ela — sem enxergar dados de outras confederações.

### Boas práticas
- 💡 Troque a senha padrão no primeiro acesso (em Usuários).
- 💡 Crie um usuário **leitor** por confederação cliente quando quiser dar transparência.
- 💡 Nunca compartilhe login — cada pessoa deve ter o seu, pois a auditoria registra **quem** fez cada ação.

---

## 3. Dashboard — Central de Controle

### O que é
A tela inicial: um raio-x do estado do sistema e do que exige atenção.

### A lógica por trás
O dashboard **não é estático** — ele calcula em tempo real:
- **Alertas priorizados**, em três níveis:
  - 🔴 *Crítico*: repartições com prazo legal vencido; pagamentos pendentes em ciclos com mais de 60 dias.
  - 🟡 *Atenção*: repartições vencendo em 7 dias; operadores ativos **sem e-mail primário**.
  - 🔵 *Informativo*: relatórios de GGR pendentes (pago, mas falta o relatório).
- **"O que realizamos este mês"** — bloco de transparência: nº de notificações, contatos,
  respostas conciliadas e valor recebido no mês corrente.
- **KPIs** — total recebido (Fase 1), total repassado (Fase 2), a repassar e a adimplência geral.
- **Evolução da adimplência** — percentual de adimplentes nos últimos 6 meses.
- **Por confederação** — comparativo de desempenho entre clientes.

### Como usar
- Comece o dia por aqui. Os alertas são **clicáveis** e levam direto ao ponto de ação.
- O bloco de transparência é o mesmo que o cliente vê — é a "vitrine" do trabalho.

### Interligações
🔗 Os números vêm de **todos** os módulos: alertas da cobrança e do financeiro; KPIs do
financeiro; transparência dos eventos de cobrança. Se um número parecer errado, ele reflete
um dado real em outro módulo (ex.: "a repassar" alto = há Fase 2 pendente).

---

## 4. A Fazer Hoje

### O que é
Uma **lista de tarefas priorizada**, gerada automaticamente, do que precisa ser feito hoje.

### A lógica por trás
O sistema varre o estado atual e monta a fila por prioridade:
- **Urgente (🔴):** repartições com prazo vencido.
- **Hoje (🟡):** ciclos que chegaram ao **dia da 1ª notificação** (conforme a data
  configurada na confederação) e ainda têm pendentes; e-mails recebidos a conciliar.
- **Em breve (🔵):** ciclos no dia da 2ª notificação; repartições vencendo em 7 dias.
- **Acompanhar:** Bets pendentes **sem contato nos últimos 7 dias**.

⚖️ **Cadência inteligente:** para as Bets a cobrar, o sistema sugere **o melhor canal**:
- tem e-mail primário → sugere **e-mail**;
- não tem e-mail mas tem telefone → sugere **WhatsApp**;
- só tem redes/sem dados → sugere **telefone/redes**.

### Como usar
Use como ponto de partida do dia. Cada item leva direto à tela da ação (ciclo, financeiro, etc.).

### Interligações
🔗 As datas de notificação vêm do **cadastro da confederação**; os contatos recentes vêm dos
**eventos do ciclo** (inclusive os registrados pela função "Contatar"); os e-mails a conciliar
vêm da **sincronização de e-mail**.

---

## 5. Agentes Operadores (Bets)

### O que é
O cadastro completo de cada casa de apostas. É a base de toda a cobrança.

### A lógica por trás
Quanto mais rico e atualizado o cadastro, mais eficaz a cobrança. O cadastro alimenta
diretamente as notificações (e-mails), o contato multicanal e a exclusão automática (ENDR).

⚖️ **Elegibilidade de cobrança:** uma Bet só deve ser cobrada a partir da sua **data de
autorização** pela SPA. O campo de autorização existe para esse controle.

### As abas do cadastro

**Dados Cadastrais** — razão social, nome fantasia, CNPJ, endereço, nº e data de autorização,
site, status (ativo/suspenso/cancelado/pendente). Só Bets **ativas** entram nos novos ciclos.

**Marcas Vinculadas** — as marcas comerciais da Bet (cada uma com site, domínio e redes:
Instagram, Facebook, X). 🔗 As redes aqui alimentam os botões de **contato por rede social**.

**Responsáveis** — pessoas de contato por área: **Legal, Financeiro, Jurídico** (nome, e-mail,
telefone). 🔗 Esses e-mails e telefones alimentam o **contato multicanal** e os destinatários.

**ENDR** — em quais **meses** a Bet esteve associada ao ENDR. 🔗 Define a suspensão automática
da cobrança naquele mês.

**Contatos** — e-mails e telefones avulsos. O **e-mail primário** é o usado por padrão nas
notificações. ⚠️ Bet sem e-mail primário gera alerta no dashboard.

**Pesquisa de Contatos** — busca **automática** de contatos. Ver detalhe abaixo.

**Histórico de Pagamentos** — grade dos **últimos 12 meses** (verde = pago, amarelo = pendente,
vermelho = inadimplente, cinza = sem cobrança), o **selo de conformidade** e os lançamentos
avulsos. 🔗 Mesma base do selo que aparece no topo do cadastro.

**Documentos** e **Auditoria** — arquivos e histórico de ações daquela Bet.

### Pesquisa de Contatos (detalhe)
O sistema busca contatos em **quatro fontes**, em ordem de confiabilidade:
1. **Receita Federal (BrasilAPI)** — a partir do CNPJ, traz e-mail, telefone e o quadro de
   sócios (QSA). *Confiança alta.*
2. **Dedução por domínio** — gera e-mails prováveis (contato@, juridico@, financeiro@,
   compliance@…) a partir do site/marca. *Confiança baixa — confirmar.*
3. **Busca web (DuckDuckGo)** — varre resultados públicos. *Confiança baixa.*
4. **Inteligência Artificial (Claude)** — deduz e sugere contatos prováveis. *Confiança variável.*

💡 Toda sugestão fica **pendente de aprovação humana** — você **aprova** (vira contato oficial)
ou **rejeita**. Nada é cadastrado automaticamente.

### O selo de conformidade
⚖️ Score de adimplência de 0 a 100% (pagamentos confirmados ÷ total no histórico):
**★ Bom pagador (≥70%)**, **Regular (40–69%)**, **Crítico (<40%)**. É um incentivo reputacional
e ajuda a priorizar a cobrança.

### Interligações
🔗 O cadastro da Bet é a origem de quase tudo: e-mails e telefones → notificações e contato;
status ativo → entra nos ciclos; autorização → elegibilidade; ENDR → suspensão; pagamentos →
selo e histórico.

---

## 6. Confederações

### O que é
Os **clientes** do escritório. Cada confederação é tratada como uma estrutura independente.

### A lógica por trás
Cada confederação tem suas próprias regras de prazo, seu regulamento de rateio e seus
beneficiários. O sistema parametriza tudo por confederação.

### Campos e abas importantes
- **Sigla** — ⚖️ é a chave `{confederacaosigla}`, usada automaticamente no assunto e corpo
  das notificações (ex.: "CBTM - Contrapartida Direito de Imagem 05/2026").
- **Presidente** — nome usado na assinatura do **Ofício à SPA**.
- **Datas do fluxo de cobrança** — dia de vencimento, dia da 1ª notificação e seu prazo,
  dia da 2ª notificação e seu prazo, dia de fechamento. 🔗 Essas datas controlam o **A Fazer
  Hoje** e o agendamento automático.
- **Prazo de repasse aos beneficiários** — ⚖️ prazo legal da Fase 2 (ex.: CBW Art. 13 = 90
  dias do efetivo recebimento). 🔗 Define o vencimento de cada repartição.
- **Regras de Rateio** — regulamento (texto, arquivo e link online) e a matriz de distribuição.

### Como usar
- **+ Nova Confederação** para cadastrar um novo cliente (basta nome e sigla).
- Mantenha as **datas do fluxo** corretas — elas dirigem a automação.

### Interligações
🔗 Sigla → notificações; datas → A Fazer Hoje e scheduler; prazo de repasse → Fase 2;
regras de rateio → distribuição aos beneficiários; logo/dados → relatórios.

---

## 7. ENDR

### O que é
Cadastro do ENDR e o controle **mensal** de quais Bets estão associadas a ele.

### A lógica por trás
⚖️ Bet associada ao ENDR em um mês = repasse consolidado pelo ENDR = **não cobrar**
individualmente naquele mês. O sistema aplica isso sozinho.

### Como usar
A cada mês, marque as Bets associadas. 🔗 Ao preparar uma notificação, essas Bets aparecem
na lista "ENDR (suspensos)" e já saem dos destinatários.

---

## 8. Cobranças

O módulo central. Duas abas: **Ciclos** e **Modelos de Cobrança**.

### 8.1. O que é um ciclo
Um **ciclo** representa a cobrança de **uma confederação em um mês de competência**. Ao criar
um ciclo, o sistema gera automaticamente um registro de cobrança para **cada Bet ativa**.

⚖️ **Status do ciclo:** Aberto → Cobrando (após o 1º envio) → Verificando → Fechado.

### 8.2. Criar um ciclo
**+ Novo Ciclo** → confederação + **mês/ano** (por seleção, nunca digitado) + modelo opcional.
💡 Crie um ciclo por confederação no início de cada mês.

### 8.3. A tela do ciclo

**Resumo colorido** — cada caixa mostra **quantidade + percentual**:
adimplentes, pendentes de relatório, inadimplentes, pendentes, **não explora esporte**,
**judicializado**.

⚖️ **Significado dos status:**
- *Adimplente* — pagou e enviou o relatório.
- *Pago (aguarda relatório)* — repassou o valor, mas falta o relatório de GGR.
- *Pendente / Inadimplente* — ainda não repassou.
- *Não explora esporte* — a Bet não opera apostas esportivas → não deve contrapartida.
- *Judicializado* — questão sub judice → cobrança suspensa.

**Ações por operador (Bet):**
- **Valor devido** — registra o valor **informado pela Bet** (lembre: o escritório não calcula).
- **Repasse recebido** — registra cada repasse. ⚖️ Uma Bet pode repassar **várias vezes** no mês;
  cada repasse é somado. O sistema usa a data de recebimento (regime de caixa).
- **Relatório** — registra o recebimento do relatório de GGR e **anexa o arquivo**. Você pode
  informar o **mês de competência** do relatório (que pode diferir do mês do recebimento).
- **Contatar** — central multicanal (ver 8.5).
- **GGR** — análise de divergência (ver 8.6).
- **Categorizar** — marcar como "não explora esporte" ou "judicializado" (ou reverter).

### 8.4. Preparar e enviar notificação
Botão **Preparar Notificação** abre o fluxo guiado:
1. **Tipo** — 1ª, 2ª ou 3ª notificação (cada uma pode ter um modelo próprio).
2. **Modelo** — escolha um modelo (editável na hora) ou use o padrão.
3. **Prazo** — concedido ao operador (entra na chave `{prazo}`).
4. **Destinatários** — ⚖️ já vêm **pré-selecionados**: quem **pagou** é excluído, quem está no
   **ENDR** é suspenso, e os **pendentes** são marcados. Você pode incluir/excluir manualmente.
5. **Mensagem** — assunto e corpo com chaves automáticas:
   `{bet}`, `{confederacao}`, `{confederacaosigla}`, `{mes}`, `{ano}`, `{prazo}`, `{escritorio}`.
6. **Pré-visualização preenchida** — mostra como o e-mail ficará, já com os dados reais.
7. **Revisar envio → Confirmar disparo** — ⚖️ há um **aviso explícito** antes de enviar
   (o disparo é real e não pode ser desfeito).
8. **Extrato de envio** — status de cada Bet (enviado/falhou) e, para cada envio, um
   **comprovante com número de protocolo** único (formato SIGLA-AAAAMM-Nº).

🔗 Cada envio: dispara o e-mail (Microsoft 365), registra um **evento** no ciclo, cria um
**e-mail de saída** (para conciliação futura) e muda o ciclo para "Cobrando".

### 8.5. Contato multicanal ("Contatar")
Central que reúne **todos os canais** da Bet:
- **E-mail** (abre com assunto/mensagem prontos),
- **WhatsApp** (link direto com a mensagem),
- **Telefone** (discagem),
- **Redes sociais** (Instagram/Facebook/X das marcas).

🔗 Cada clique **registra automaticamente** o contato na linha do tempo do ciclo — o que
alimenta o "A Fazer Hoje", o relatório de atividades e a transparência.

💡 Use o WhatsApp para Bets que não respondem e-mail; o sistema já monta a mensagem.

### 8.6. Análise de GGR
⚖️ Quando você registra o valor/recebimento, o botão **GGR** compara com a **média histórica**
daquela Bet naquela confederação e sinaliza:
- *Dentro do padrão* (desvio < 20%),
- *Divergência moderada* (≥ 20%),
- *Divergência alta* (≥ 40%) — recomenda pedir o relatório detalhado.
Ajuda a detectar valores subdeclarados quando o GGR é desconhecido.

### 8.7. Ofício à SPA
Botão **Gerar Ofício SPA** cria a **minuta em Word (.docx)** comunicando à Secretaria de
Prêmios e Apostas a relação de **inadimplentes** (autorização, CNPJ, razão social), já
excluindo pagantes e associados ao ENDR. O arquivo é **arquivado como documento** do ciclo
e pode ser baixado e editado.

### 8.8. Aba Comunicações (e-mails do ciclo)
- **Sincronizar Caixa de Entrada** — importa as respostas das Bets (Microsoft 365).
- **Fila de conciliação** — para respostas cujo remetente não está cadastrado: a **IA sugere**
  a qual Bet pertence e você confirma o vínculo (pode cadastrar o remetente como contato).
- Lista de enviados/recebidos, com **comprovante** dos enviados.

### 8.9. Relatório de Atividades
Botão que gera um **PDF do trabalho do mês** (notificações, contatos, respostas, valores,
situação por Bet). 🔗 É o mesmo relatório disponível em Relatórios → Por Ciclo. Evidencia o
esforço do escritório.

### 8.10. Modelos de Cobrança (aba)
Textos padrão por ocasião (1ª/2ª/final notificação, etc.), globais ou específicos por
confederação. Use as chaves (botões) para inserir os campos automáticos.

### Interligações do módulo Cobrança
🔗 Cria pagamentos para as Bets → 🔗 recebimentos vão para o **Financeiro (Fase 1)** →
🔗 eventos e e-mails alimentam **A Fazer Hoje**, **relatórios** e **transparência** →
🔗 ações entram na **Auditoria** → 🔗 inadimplentes geram o **Ofício à SPA**.

---

## 9. Financeiro

### O que é
O "ERP" dos repasses, **organizado por confederação** (cada cliente é uma estrutura própria).

### A lógica por trás
Reflete as **duas fases** do dinheiro (ver conceito 1.3) e mantém a ligação entre elas.
No topo, selecione o **cliente** (ou "Visão Geral" para o consolidado) — tudo abaixo passa a
mostrar apenas aquele cliente.

### Abas
**Resumo** — receita recebida e situação dos repasses do cliente selecionado.

**Repasses (Fase 1)** — todos os valores **recebidos** (de ciclos de cobrança + lançamentos
avulsos). 🔗 É a fonte das repartições da Fase 2. Botão **+ Novo Lançamento Avulso** para
registrar um recebimento sem ciclo (ex.: repasse espontâneo).

**Repartição (Fase 2)** — a distribuição dos valores recebidos aos beneficiários finais.
- ⚖️ Cada repartição **deve estar vinculada a um recebimento da Fase 1** (origem do dinheiro).
- ⚖️ Tem um **prazo legal** (vem do cadastro da confederação) — o sistema alerta quando vence.
- Cada item é um beneficiário com seu valor; ao pagar, registra-se a data e o **comprovante**.
- Sub-aba **Beneficiários** — cadastro de atletas/clubes/federações com dados bancários e PIX.

**E-mails** — respostas das Bets e fila de conciliação, filtradas pelo cliente.

### Boas práticas
- 💡 Registre o recebimento na **Fase 1** assim que o dinheiro entrar; depois crie a **Fase 2**
  a partir dele — assim a ligação fica correta e o prazo legal é controlado.
- 💡 Acompanhe "A Repassar" e os prazos vencidos no dashboard.

### Interligações
🔗 Fase 1 recebe da Cobrança e dos lançamentos avulsos → Fase 2 nasce da Fase 1 →
beneficiários vêm do cadastro da confederação → tudo entra nos relatórios e na auditoria.

---

## 10. Relatórios

### O que é
A camada de **comprovação e prestação de contas**.

### Tipos
- **Consolidado / Cruzado** — adimplência por confederação, mês e Bet, com filtros
  combináveis (mês por **botões**, sem digitar) e exportação em **Excel** e **PDF**.
- **Por Ciclo** — relatório de um ciclo (Excel) e o **Relatório de Atividades (PDF)**, que
  evidencia o trabalho do escritório de forma profissional.
- **Evidências (ISO 9001)** — o **dossiê mensal** consolidado (notificações enviadas, respostas,
  valores declarados × recebidos, relatórios de GGR, repartições). Pode **baixar em PDF** ou
  **enviar ao e-mail do escritório** para revisão antes de encaminhar à confederação.

### A lógica por trás
⚖️ Os relatórios são montados a partir dos **registros reais** (eventos, e-mails, pagamentos) —
não são digitados à mão. Isso garante a rastreabilidade exigida pela ISO 9001.

🔗 **Automação:** todo dia 1º, o sistema gera o dossiê do mês anterior por confederação e
**envia automaticamente ao e-mail do escritório** para revisão.

---

## 11. Documentos

Repositório central e pesquisável de todos os documentos: ofícios gerados, comprovantes,
regulamentos, respostas de e-mail arquivadas, anexos de relatórios. 🔗 Muitos documentos
chegam aqui **automaticamente** (ex.: ofício SPA gerado, resposta de e-mail conciliada).

---

## 12. Auditoria

### O que é
O registro **completo e imutável** de todas as ações do sistema — a espinha dorsal do compliance.

### A lógica por trás
⚖️ Cada ação relevante (criar ciclo, enviar notificação, registrar pagamento, gerar ofício,
alterar usuário…) grava **quem fez, o quê, quando e sobre qual registro**. Quando a ação é
ligada a um cliente, ela fica **vinculada à confederação**.

### Como usar
Filtros combináveis: **Cliente (Confederação)**, ação, tipo de registro, registro específico,
usuário e período. Exportável em **PDF**. 💡 Use para comprovar diligências ou investigar
qualquer histórico.

---

## 13. Usuários e Escritório (admin)

**Usuários** — criar/editar, definir perfil e (para leitores) a confederação vinculada.
⚖️ Ao **desativar** um usuário, ele **some de todas as seleções** do sistema, mas o histórico
dele é **preservado** na auditoria.

**Escritório** — dados do escritório e **logomarca**. 🔗 O nome/assinatura cadastrado preenche
a chave `{escritorio}` nas notificações; o e-mail recebe o relatório mensal automático; a logo
e os dados aparecem nos relatórios.

---

## 14. O ciclo de vida completo de uma cobrança (visão integrada)

Para amarrar tudo, veja o caminho de ponta a ponta:

1. **Cadastro** — a Bet está cadastrada, ativa, autorizada, com contatos e responsáveis
   (Módulo 5). A confederação tem sigla, datas e regras (Módulo 6).
2. **Abertura do ciclo** — cria-se o ciclo do mês; o sistema gera a cobrança de cada Bet ativa
   (Módulo 8.2). 🔗 As Bets no ENDR já serão tratadas como suspensas (Módulo 7).
3. **1ª notificação** — no dia configurado, prepara-se e dispara-se a notificação aos pendentes
   (8.4). 🔗 Cada envio gera evento, e-mail de saída e protocolo.
4. **Acompanhamento** — registra-se valor informado, repasses e relatórios (8.3); usa-se o
   **Contatar** para cobrar por vários canais (8.5); sincronizam-se e concilia-se as respostas
   (8.8). A análise de **GGR** sinaliza divergências (8.6).
5. **2ª/3ª notificação** — repete-se para quem segue inadimplente (8.4).
6. **Recebimento** — o dinheiro recebido aparece no **Financeiro Fase 1** (Módulo 9).
7. **Repartição** — cria-se a **Fase 2** a partir do recebido, dentro do prazo legal, pagando
   os beneficiários (Módulo 9).
8. **Fechamento** — gera-se o **Ofício à SPA** dos inadimplentes (8.7), o **Relatório de
   Atividades** e o **dossiê de Evidências** (Módulo 10).
9. **Transparência e compliance** — o cliente vê o que foi feito (Dashboard/portal), e tudo
   fica registrado na **Auditoria** (Módulos 3 e 12).

---

## 15. Perguntas frequentes

**O sistema calcula quanto a Bet deve?** Não. Quem apura é a Bet; o escritório registra e
concilia (conceito 1.1).

**Recebi um valor de um mês mas referente a outro. O que faço?** Registre a **data de
recebimento** real e informe o **mês de competência** do relatório — o sistema separa os dois
(conceito 1.2).

**Uma Bet pagou em duas parcelas no mês.** Registre **dois repasses**; o sistema soma.

**Uma Bet não responde e-mail.** Use **Contatar** → WhatsApp/telefone/redes; o contato fica
registrado.

**Por que uma Bet não apareceu na notificação?** Ou já pagou, ou está no **ENDR** naquele mês,
ou não está **ativa**.

**O e-mail de envio/relatório mensal não saiu.** Verifique se as credenciais do **Microsoft
365** estão configuradas (responsabilidade do administrador).

**Posso desfazer um disparo de notificação?** Não — por isso há a etapa de confirmação antes.
Mas tudo fica registrado (extrato + protocolo).

---

*Este manual reflete o funcionamento atual do sistema. Cada tela traz textos de orientação
contextuais. Em caso de dúvida sobre uma regra de negócio, consulte os "Conceitos
fundamentais" (seção 1) — eles explicam o "porquê" por trás de quase tudo.*
