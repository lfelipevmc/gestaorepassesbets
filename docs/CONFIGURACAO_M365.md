# Configuração da Integração com o Microsoft 365
### Sistema de Gestão de Haveres de Bets — Vascav Advocacia

**Versão:** 1.0 · **Última atualização:** julho/2026

Este documento descreve como o sistema se integra ao Microsoft 365 para enviar
cobranças aos agentes operadores (Bets) e ler as respostas, e como o acesso foi
**restringido a uma única caixa** por segurança (princípio do menor privilégio,
boas práticas de compliance e LGPD).

> ⚠️ **Nunca** registre neste documento (nem no git) o *client secret* do
> aplicativo, senhas ou tokens. O ID do aplicativo (AppId) e o ID do grupo
> **não** são segredos e podem constar aqui para referência.

---

## 1. Visão geral

| Item | Valor |
|------|-------|
| Caixa dedicada (toda comunicação com as Bets) | **gestaorepasses@vascav.com.br** |
| Caixa de revisão interna (dossiês mensais) | definida em `OFFICE_EMAIL` |
| Aplicativo (Azure App Registration) | **Gestão Repasses Bets** |
| AppId (Client ID) | `30f8e66e-a9bc-4a92-948a-05b4c2b48177` |
| Pasta-mãe de organização na caixa | **Gestão de Repasses** |
| Subpastas automáticas | uma por confederação (CBTM, CBT, CBW, CBH) |

**Princípio:** toda a comunicação com os agentes operadores sai e é lida
**exclusivamente** da caixa `gestaorepasses@vascav.com.br`, isolada dos e-mails
pessoais do escritório. As respostas recebidas são arquivadas automaticamente na
subpasta da confederação correspondente.

---

## 2. Registro de aplicativo no Azure (Microsoft Entra ID)

Portal: **portal.azure.com → Microsoft Entra ID → Registros de aplicativo →
Gestão Repasses Bets**.

### 2.1 Permissões de API (tipo **Aplicativo**, com consentimento do administrador)

| Permissão | Tipo | Para quê |
|-----------|------|----------|
| `Mail.Send` | Aplicativo | Enviar cobranças/contatos pela caixa dedicada |
| `Mail.ReadWrite` | Aplicativo | Ler respostas, criar as pastas e mover mensagens |

Após adicionar, clicar em **"Conceder consentimento do administrador"** (as duas
devem ficar com o selo verde *Concedido*).

### 2.2 Credenciais

- **Client ID (AppId)** e **Tenant ID**: usados no `.env` do servidor.
- **Client Secret**: gerado em *Certificados e segredos*. Fica **apenas** no
  `.env` do servidor, nunca no git. Tem validade — anotar a data de expiração
  para renovar antes de vencer (senão o envio de e-mails para de funcionar).

### 2.3 Variáveis no `.env` do servidor

```env
AZURE_CLIENT_ID=30f8e66e-a9bc-4a92-948a-05b4c2b48177
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_SECRET=<segredo — nunca versionar>
OFFICE_EMAIL=<caixa de revisão interna dos dossiês>
REPASSES_MAILBOX=gestaorepasses@vascav.com.br
REPASSES_FOLDER_ROOT=Gestão de Repasses
```

Se `REPASSES_MAILBOX` estiver vazia, o sistema usa `OFFICE_EMAIL` como caixa de
comunicação (retrocompatibilidade).

---

## 3. Restrição de acesso a UMA única caixa (Application Access Policy)

Por padrão, as permissões de aplicativo (`Mail.Send` / `Mail.ReadWrite`) dão
acesso a **todas** as caixas do tenant ("all mailboxes" / "as any user"). Para
limitar o aplicativo a acessar **somente** a caixa `gestaorepasses`, aplica-se
uma **Application Access Policy** no Exchange Online.

Isso é feito via **PowerShell** com o módulo *ExchangeOnlineManagement*
(a Microsoft não oferece essa configuração por tela). Requer conta de
**Administrador Global** ou **Administrador do Exchange**.

### 3.1 Conectar ao Exchange Online

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force
Connect-ExchangeOnline -UserPrincipalName <admin>@vascav.com.br
```

### 3.2 Criar um grupo de segurança contendo só a caixa dedicada

```powershell
New-DistributionGroup -Name "App Repasses - Caixas Permitidas" `
  -Alias "app-repasses-permitidas" `
  -Type Security `
  -Members gestaorepasses@vascav.com.br
```

> ⚠️ O grupo pode ser criado com endereço `@<tenant>.onmicrosoft.com` em vez do
> domínio principal. Isso **não é problema** — use o `ExternalDirectoryObjectId`
> (passo 3.3) para referenciá-lo, que é à prova de erro.

### 3.3 Descobrir o identificador interno do grupo

```powershell
Get-DistributionGroup -Identity "app-repasses-permitidas" |
  Format-List DisplayName,PrimarySmtpAddress,ExternalDirectoryObjectId,Guid
```

Anotar o **`ExternalDirectoryObjectId`** (formato `xxxxxxxx-xxxx-...`).

> Valor usado nesta instalação: `9e0830ae-be36-44db-b6e2-c76c1bdbf4fc`

### 3.4 Criar a política de restrição

```powershell
New-ApplicationAccessPolicy `
  -AppId 30f8e66e-a9bc-4a92-948a-05b4c2b48177 `
  -PolicyScopeGroupId 9e0830ae-be36-44db-b6e2-c76c1bdbf4fc `
  -AccessRight RestrictAccess `
  -Description "Sistema de Repasses so acessa a caixa gestaorepasses"
```

`RestrictAccess` = o app **só** pode acessar as caixas do grupo; todas as outras
ficam bloqueadas para ele.

### 3.5 Testar (obrigatório)

```powershell
# Deve retornar AccessCheckResult: Granted
Test-ApplicationAccessPolicy -AppId 30f8e66e-a9bc-4a92-948a-05b4c2b48177 -Identity gestaorepasses@vascav.com.br

# Deve retornar AccessCheckResult: Denied
Test-ApplicationAccessPolicy -AppId 30f8e66e-a9bc-4a92-948a-05b4c2b48177 -Identity felipe@vascav.com.br
```

> A política pode levar **até ~30 minutos** para propagar em todo o tenant. Se o
> teste ainda mostrar "Granted" para outra caixa logo após criar, aguardar e
> testar de novo.

**Resultado desta instalação (confirmado):** `gestaorepasses` → *Granted*;
demais caixas → *Denied*. ✅

### 3.6 Observações de manutenção

- Só existe **uma** política com `RestrictAccess` por app. Para liberar outra
  caixa no futuro (ex.: uma segunda caixa de repasses), basta **adicioná-la ao
  mesmo grupo** — não é preciso criar outra política:
  ```powershell
  Add-DistributionGroupMember -Identity "app-repasses-permitidas" -Member outra-caixa@vascav.com.br
  ```
- Para listar as políticas existentes: `Get-ApplicationAccessPolicy`.
- Para remover a política (reverter a restrição): `Remove-ApplicationAccessPolicy -Identity <id>`.

---

## 4. Como o sistema usa a caixa

- **Envio de cobrança/notificação:** a mensagem é criada na subpasta da
  confederação (dentro de "Gestão de Repasses") e enviada a partir dela,
  deixando a cópia arquivada organizada por confederação.
- **Leitura de respostas:** o sistema lê a caixa `gestaorepasses`, casa cada
  resposta ao operador (pelo remetente e pelo fio da conversa do envio),
  identifica a confederação e **move** a mensagem para a subpasta dela.
- **Pastas:** criadas automaticamente na primeira necessidade — pasta-mãe
  "Gestão de Repasses" e uma subpasta por confederação (CBTM, CBT, CBW, CBH).

---

## 5. Solução de problemas

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| E-mails não são enviados | Client secret expirado | Gerar novo segredo no Azure e atualizar `.env` |
| "policy scope could not be resolved" ao criar a política | Grupo recém-criado ainda não sincronizou, ou endereço errado | Usar o `ExternalDirectoryObjectId` (passo 3.3); aguardar alguns minutos |
| Teste mostra "Granted" para caixas que deveriam ser negadas | Propagação | Aguardar até ~30 min e testar de novo |
| Respostas não aparecem no sistema | Sincronização não executada, ou remetente não cadastrado como contato | Rodar a sincronização em Financeiro → E-mails; conferir contatos do operador |
| Pastas por confederação não criadas | Falta `Mail.ReadWrite` | Conferir permissão no Azure (seção 2.1) |

---

*Responsável técnico: administrador do sistema / TI do escritório. Este documento
descreve apenas configuração — nenhum segredo deve ser incluído aqui.*
