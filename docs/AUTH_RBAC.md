# Autenticação, Dispositivos Pareados, RBAC por Projeto, Tokens Revogáveis e Logs de Auditoria

## 1. Visão Geral e Arquitetura

O Axon Works evolui de um modelo puramente declarativo local para uma arquitetura com **identidade forte, controle de acesso baseado em papéis (RBAC), tokens de agentes revogáveis e trilha de auditoria imutável**.

Essa estrutura atende aos requisitos de **prontidão para VPS privada** descritos em `docs/VPS.md`, permitindo:
1. **Contas de Usuário**: Gestão de operadores com senhas protegidas por **scrypt** com salt aleatório de 16 bytes e verificação em tempo constante (`timingSafeEqual`) contra ataques de temporização (*timing attacks*).
2. **Dispositivos Pareados**: Registro de máquinas clientes autorizadas (`paired_devices`) com *fingerprint* de dispositivo, código de pareamento e capacidade de revogação remota instantânea.
3. **Controle de Acesso Baseado em Papéis (RBAC)**:
   - **Papéis Globais de Conta (`AccountRole`)**:
     - **`admin`**: Gestão administrativa do sistema e listagem global de contas.
     - **`user`**: Operador padrão do sistema.
   - **Papéis de Membro do Projeto (`ProjectRole`)**:
     - **`owner`**: Controle total do projeto (exclusão, gestão de membros, importação, exportação e configurações).
     - **`collaborator`**: Permissão de escrita operacional (reserva de tarefas, marcos de checkpoints, biblioteca, propostas e aceite de decisões, bloqueios).
     - **`observer`**: Acesso somente leitura (consultas, busca e inspeção).
   - **Papéis de Tokens de Acesso (`TokenRole`)**:
     - **`owner`**, **`collaborator`**, **`agent`** (escopo estrito de IA para ciclo de execução) e **`observer`**.
4. **Tokens Revogáveis de Alta Entropia**:
   - Prefixos tipados claros: `axon_usr_` (sessões humanas), `axon_agt_` (agentes de IA) e `axon_dev_` (dispositivos).
   - **Armazenamento Seguro de Segredos**: O token em texto plano é entregue **apenas uma vez** no momento da geração. O banco de dados SQLite armazena unicamente o digest criptográfico **SHA-256** (`token_hash`) e o prefixo visível.
   - **Escopo e Validade**: Suporte a limitação estrita por projeto (`projectId`), expiração temporal (`expiresAt`) e revogação imediata auditada (`revokedAt`, `revokedBy`).
5. **Trilha de Auditoria Imutável (`audit_logs`)**:
   - Registro estruturado de todas as operações sensíveis (login, emissão de tokens, revogação, pareamento de dispositivos, alterações de membros, exclusão de projetos, backups).
   - **Sanitização Compulsória**: Todos os metadados passam por `maskSecrets` antes da persistência, garantindo que senhas, Bearer tokens e chaves de API nunca sejam registrados na auditoria.
6. **Transparência e Retrocompatibilidade Local**:
   - Requisições originadas em loopback (`127.0.0.1` / `localhost`) portando `X-Workspace-Client: local` continuam operando de forma transparente em modo anônimo local, preservando 100% da compatibilidade com os scripts e suítes existentes.
   - Quando o modo estrito é exigido (`AXON_REQUIRE_AUTH=1`), qualquer acesso sem Bearer token válido é bloqueado com `401 unauthorized`.

---

## 2. Hierarquia de Papéis e Permissões de Tokens (`ROLE_HIERARCHY`)

| Papel (`TokenRole`) | Nível | Capacidades Principais |
|---|:---:|---|
| **`owner`** | 4 | Excluir projeto, adicionar/remover membros, gerenciar tokens, exportar/importar, escrever e ler. |
| **`collaborator`** | 3 | Criar e concluir tarefas, gravar checkpoints, editar biblioteca, propor/substituir decisões, resolver bloqueios. |
| **`agent`** | 2 | Foco estrito no ciclo de execução: assumir tarefas delegadas, reportar checkpoints e rascunhos de trabalho. |
| **`observer`** | 1 | Somente leitura de dados de briefing, busca e listagens. Nenhuma mutação autorizada. |

---

## 3. Endpoints REST da API

### 3.1. Autenticação e Contas
- `POST /api/auth/register`: Cadastra um novo operador. Retorna os dados da conta sem o hash de senha.
- `POST /api/auth/login`: Autentica com usuário e senha. Retorna a sessão com Bearer token ativo.
- `GET /api/auth/me`: Retorna a identidade do operador ou agente autenticado.
- `GET /api/auth/accounts`: Lista operadores cadastrados (para gestão administrativa).

### 3.2. Tokens Revogáveis
- `POST /api/auth/tokens`: Emite um novo token com papel, escopo de projeto e validade.

> **O papel por projeto ainda não é aplicado nas rotas.** A regra existe (`requireProjectRole` em `server/auth/middleware.ts`), mas não está ligada a nenhuma rota. No modo local padrão isso não expõe nada, porque o app só aceita acesso deste computador e não pede login. Com `AXON_REQUIRE_AUTH=1`, porém, qualquer token válido consegue ler e escrever em qualquer projeto. Ligar a regra em todas as rotas está no backlog.
- `GET /api/auth/tokens`: Lista tokens emitidos e seus status (ativo / revogado).
- `POST /api/auth/tokens/:id/revoke`: Revoga imediatamente o token especificado.

### 3.3. Dispositivos Pareados
- `GET /api/devices`: Lista dispositivos vinculados à conta autenticada.
- `POST /api/devices/pair`: Solicita pareamento de novo dispositivo via fingerprint.
- `POST /api/devices/:id/revoke`: Revoga o acesso de um dispositivo pareado.

### 3.4. Controle de Acesso ao Projeto (RBAC)
- `GET /api/projects/:id/members`: Lista membros do projeto e seus papéis.
- `POST /api/projects/:id/members`: Adiciona ou atualiza o papel de um membro (`owner`, `collaborator`, `observer`).
- `DELETE /api/projects/:id/members/:accountId`: Remove um membro do projeto.

### 3.5. Trilha de Auditoria
- `GET /api/audit-logs`: Consulta registros de auditoria com filtros opcionais por `projectId`, `action`, `actorId` e `limit`.

---

## 4. Ferramentas MCP para Agentes

| Ferramenta MCP | Descrição |
|---|---|
| `create_auth_token` | Gera token revogável para outro agente ou dispositivo com escopo restrito. |
| `list_auth_tokens` | Lista tokens ativos ou revogados vinculados a um projeto. |
| `revoke_auth_token` | Revoga um token de acesso imediatamente. |
| `list_project_members` | Consulta os membros e papéis de governança do projeto. |
| `list_audit_logs` | Consulta eventos na trilha de auditoria para fins de verificação de segurança. |
