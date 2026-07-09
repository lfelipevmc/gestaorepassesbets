# Política de Backup e Recuperação de Dados
### Sistema de Gestão de Haveres de Bets — Vascav Advocacia

**Versão:** 1.0 · **Vigência:** a partir de julho/2026

Este documento descreve a rotina de cópias de segurança do sistema, em atendimento
às boas práticas de controle de riscos, à ISO 9001 (7.5 — informação documentada) e
à LGPD (Lei 13.709/2018, Art. 37 — registro das operações de tratamento e Art. 46 —
medidas de segurança).

---

## 1. O que é protegido

| Dado | Origem | Incluído no backup |
|------|--------|:---:|
| Banco de dados completo (operadores, confederações, cobranças, pagamentos, conclusões, e-mails, auditoria) | PostgreSQL | ✅ (`pg_dump`) |
| Arquivos enviados (relatórios GGR, comprovantes, documentos, ENDR) | Volume `uploads` | ✅ |

## 2. Estratégia — Regra 3-2-1

São mantidas **3 cópias** dos dados, em **2 locais** distintos, sendo **1 externa (offsite)**:

1. **Banco em produção** — no servidor (DigitalOcean Droplet).
2. **Dump diário criptografado** — gerado no servidor.
3. **Cópia externa** — enviada ao **DigitalOcean Spaces** (`haveres-repasses-backups`, região NYC3),
   infraestrutura separada do servidor de aplicação.

## 3. Frequência e retenção (esquema GFS — Avô/Pai/Filho)

O backup roda **automaticamente todos os dias às 02:00** (horário do servidor).

| Nível | Quando é gerado | Retenção |
|-------|-----------------|----------|
| **Diário** | Todo dia | 30 dias |
| **Semanal** | Todo domingo | 12 semanas (~3 meses) |
| **Mensal** | Todo dia 1º | 12 meses |

Cobertura efetiva: **1 ano completo**. Cópias vencidas são removidas automaticamente.

## 4. Segurança (LGPD)

- **Criptografia em repouso:** cada pacote é cifrado com **GPG AES-256** antes de sair
  do servidor. Um arquivo de backup vazado é ilegível sem a senha.
- **Senha de criptografia (`BACKUP_GPG_PASSPHRASE`):** guardada no `.env` do servidor
  **e também** em cofre de senhas offline do escritório. ⚠️ **Se essa senha for perdida,
  os backups não podem ser restaurados.**
- **Credenciais de acesso ao Spaces:** chave de escopo limitado (só este bucket),
  armazenada apenas no `.env` do servidor — nunca versionada no git.
- **Bucket privado:** não acessível publicamente.
- **Alerta de falha:** se qualquer etapa falhar, o sistema envia e-mail automático ao
  escritório (via Microsoft 365), evitando "backup que parou silenciosamente".

## 5. Restauração

Procedimento documentado em `infra/restaurar.sh`:

```bash
cd /opt/gestaorepassesbets
./infra/restaurar.sh                                   # lista os backups disponíveis
./infra/restaurar.sh daily/backup-AAAA-MM-DD.tar.gz.gpg  # restaura a data escolhida
```

A restauração exige confirmação explícita e substitui o banco e os arquivos atuais
pelos do backup selecionado.

## 6. Teste periódico (obrigatório)

> *"Um backup que nunca foi restaurado não é um backup."*

Recomenda-se um **teste de restauração trimestral** em ambiente separado, registrando
a data e o responsável. O primeiro teste é feito na própria instalação.

| Data do teste | Backup testado | Responsável | Resultado |
|---------------|----------------|-------------|-----------|
| 09/07/2026    | Sim            | Luís Felipe | Positivo  |

## 7. Camada adicional recomendada

Ativar os **Backups automáticos do Droplet** no painel DigitalOcean (~20% do valor da
máquina) — recupera o servidor *inteiro* (SO + configuração), complementando o backup
dos dados descrito aqui.

---

*Responsável técnico pela rotina: administrador do sistema. Dúvidas ou incidentes de
segurança devem ser tratados conforme o plano de resposta do escritório.*
