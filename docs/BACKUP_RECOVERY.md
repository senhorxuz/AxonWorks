# Backup, Restauração Automática e Teste Periódico de Recuperação (Disaster Recovery)

## 1. Visão Geral e Arquitetura

O Axon Works adota SQLite com WAL (Write-Ahead Logging) como motor de persistência transacional durável. Em sistemas com escrita concorrente de agentes e usuários humanos, copiar o arquivo `.sqlite` diretamente por comandos de sistema operacional durante a operação pode capturar páginas em transição e corromper o arquivo de destino ou omitir transações presentes no arquivo WAL (`.sqlite-wal`).

Para garantir **RPO (Recovery Point Objective)** e **RTO (Recovery Time Objective)** compatíveis com ambientes de missão crítica e prontidão para VPS privada, o subsistema de backup do Axon Works (`server/backup/engine.ts`) adota os seguintes pilares:

1. **Snapshot Consistente On-line (`VACUUM INTO`)**:
   Utiliza a API oficial de snapshot do SQLite (`VACUUM INTO '...'`). Esse comando cria uma cópia compactada e matematicamente consistente do banco de dados completo, incorporando todas as transações ativas do WAL sem bloquear leituras nem corromper escritas simultâneas.
2. **Checagem de Integridade Imediata**:
   Todo snapshot gerado é imediatamente submetido a `PRAGMA integrity_check` e `PRAGMA foreign_key_check` antes de ser aceito como válido.
3. **Assinatura Criptográfica SHA-256 e Criptografia em Repouso**:
   Cada backup recebe um manifesto com hash SHA-256 e contagem de projetos. Se configurada uma chave `AXON_BACKUP_KEY`, o arquivo é cifrado com **AES-256-GCM** (criptografia autenticada com IV aleatório de 96 bits e Authentication Tag de 128 bits).
4. **Política de Retenção e Rotação Automática**:
   Ao concluir com êxito um novo backup, o motor avalia o limite configurado (`maxCopies`, padrão: 10) e expurga os backups excedentes mais antigos e seus respectivos manifestos, evitando exaustão de disco.
5. **Teste Periódico de Recuperação (Recovery Drill)**:
   Mecanismo automatizado que restaura o backup em um banco temporário isolado, valida `PRAGMA integrity_check`, `foreign_key_check`, instancia o `WorkspaceStore` de teste e verifica a legibilidade de todos os projetos cadastrados. O resultado é auditado em relatórios `DrillReport`.
6. **Restauração Segura com Salvaguarda Prévia (Pre-Restore Snapshot)**:
   Antes de restaurar um backup sobre a base de produção, o sistema executa um drill no backup, salva uma cópia de segurança prévia da base atual (`pre-restore-<timestamp>.sqlite`), fecha ordenadamente as conexões WAL (`checkpointAndClose`), faz o swap atômico de arquivos e reabre a base (`reopen`).

---

## 2. Variáveis de Configuração de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `AXON_BACKUP_DIR` | `<projectRoot>/.axon/backups` | Diretório onde os arquivos de backup e manifestos são armazenados. |
| `AXON_BACKUP_KEY` | *Nenhum (desativado)* | Chave de 32 bytes (hex, base64 ou passphrase) para criptografia AES-256-GCM. |
| `AXON_BACKUP_MAX_COPIES` | `10` | Quantidade máxima de backups preservados pela política de retenção. |

---

## 3. Endpoints REST da API de Backup

Todas as rotas exigem cabeçalhos de segurança padrão (`X-Workspace-Client: local` para mutações) e restringem-se ao loopback.

### `POST /api/backups`
Dispara a criação de um backup imediato.
- **Corpo (JSON opcional)**: `{ "label": "Rotina Diária" }`
- **Retorno (201 Created)**: Objeto `BackupManifest`.

### `GET /api/backups`
Lista todos os backups disponíveis no disco, ordenados do mais recente para o mais antigo.
- **Retorno (200 OK)**: `BackupManifest[]`.

### `GET /api/backups/:id`
Consulta os detalhes e integridade de um backup específico.
- **Retorno (200 OK)**: `BackupManifest` ou `404 backup_not_found`.

### `POST /api/backups/drill` e `POST /api/backups/:id/drill`
Executa o teste de recuperação (drill) sobre o backup mais recente ou sobre o ID especificado.
- **Retorno (200 OK)**: Objeto `DrillReport` com status `passed` ou `failed` e contagem de projetos validados.

### `GET /api/backups/drills`
Consulta o histórico dos testes periódicos de recuperação realizados.
- **Retorno (200 OK)**: `DrillReport[]`.

### `POST /api/backups/:id/restore`
Restaura o backup especificado com salvaguarda da base atual.
- **Corpo (JSON obrigatório)**: `{ "confirm": true }` (se omitido ou falso, retorna `400 confirm_required`).
- **Retorno (200 OK)**: Objeto `RestoreResult` contendo o caminho da cópia pre-restore.

---

## 4. Ferramentas MCP para Agentes e Automações

| Ferramenta | Descrição | Parâmetros |
|---|---|---|
| `create_backup` | Cria snapshot consistente via `VACUUM INTO` com integridade verificada. | `{ label?: string }` |
| `list_backups` | Lista backups existentes no disco com hashes e status. | *(Nenhum)* |
| `run_recovery_drill` | Executa drill de recuperação em base isolada. | `{ backupId?: string }` |
| `get_backup_drills` | Consulta histórico de testes de recuperação. | *(Nenhum)* |
| `restore_backup` | Restaura backup sobre a base com verificação prévia. | `{ backupId: string, confirm: true }` |

---

## 5. Procedimento Operacional de Emergência (Runbook de Desastre)

Em caso de falha catastrófica de hardware ou corrupção de sistema:
1. **Identificar o último backup íntegro**:
   Consulte `GET /api/backups` ou verifique os arquivos `manifest-*.json` no diretório de backups.
2. **Executar teste de recuperação (Drill)**:
   Submeta o backup selecionado ao endpoint `POST /api/backups/:id/drill`. Certifique-se de que o retorno indique `status: "passed"`.
3. **Disparar Restauração**:
   Envie `POST /api/backups/:id/restore` com `{ "confirm": true }`.
4. **Verificação Pós-Restauração**:
   O sistema gera automaticamente o arquivo `pre-restore-<timestamp>.sqlite` da base anterior antes de aplicar o novo banco. Verifique via `GET /api/projects` se todos os projetos, tarefas e bibliotecas foram restabelecidos com fidelidade.
