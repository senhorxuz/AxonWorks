# Contrato da primeira fatia — v1

Este é o contrato de integração entre implementadores. TypeScript em `shared/types.ts` é a definição executável. Persistir em SQLite com `node:sqlite`; nenhuma leitura/escrita no workspacePath cadastrado nesta fase. Banco independente em `.axon/workspace.sqlite`, sobrescrevível por AXON_DB_PATH para testes.

## Serviço

`server/store.ts` exporta `WorkspaceStore`, construtor `(dbPath: string, options?: {now?: () => Date})`, e `DomainError` com `status: number` e `code: string`. Métodos síncronos:

- close(): void
- listProjects(): Project[]
- createProject(input: CreateProject): Project
- getProject(projectId: string): ProjectDetail (404 se ausente)
- createTask(projectId: string, input: {title: string}): Task
- claimTask(projectId: string, taskId: string, input: {agent: string; expectedVersion: number; leaseSeconds?: number; intent?: WorkIntent | null}): Task
- releaseTask(projectId: string, taskId: string, input: {agent: string; expectedVersion: number}): Task
- saveCheckpoint(projectId: string, input: CheckpointInput): Checkpoint
- postMessage(projectId: string, input: MessageInput): AgentMessage
- getHandoff(projectId: string, options?: {maxChars?: number}): Handoff
- deleteProject(projectId: string, confirmation: string): DeletedProject
- deleteBacklogItem(projectId: string, itemId: string, expectedVersion: number): DeletedBacklogItem

Regras: validar entradas em runtime. Campos textuais obrigatórios trim, limites razoáveis. IDs UUID opacos. Não confiar em projectId, taskId, agent ou expectedRevision do cliente. Task pertence ao projeto solicitado. Identidades de agente nesta versão são declaradas pelo cliente, não autenticadas; não apresentar como identidade comprovada.

O charter nasce na criação do projeto (revisão 1, corpo = objetivo). `saveCharter` grava nova revisão com CAS, atualiza `objective` e preserva o histórico. HTTP: GET/POST `/api/projects/:id/charter` e GET `/charter/history`. MCP: `get_charter`, `save_charter`.

Bloqueios canônicos têm ciclo `open → mitigated → resolved | accepted_risk`, com reabertura. Abertos e mitigados entram em `ResumeBrief.attention` e `blockers`. Ler não resolve. HTTP: `/api/projects/:id/blockers`. MCP: `open_blocker`, `list_blockers`, `resolve_blocker`, `reopen_blocker`.

`claimTask` aceita `intent` opcional (`WorkIntent`). É declaração, não lock. `listIntentOverlaps` compara escritas de reservas ativas: mesmo locator ou, em `file_path`, prefixo de pasta. Leitura não gera aviso. HTTP e MCP devolvem `{ ...task, overlaps }` sem recusar a reserva. `ResumeBrief.overlaps` lista os avisos do agente. Release e conclusão limpam a intenção.

`revision` começa 0 e representa a sequência de checkpoints, não toda mudança do projeto. `version` da tarefa começa 0. Claim/release são CAS atômicos. Lease padrão 900s, intervalo 30–3600s. Só um agente pode ter lease ativo; outro assume apenas após expirar. Mesmo agente pode renovar apresentando version atual. Qualquer CAS válido incrementa version. Release exige dono e lease ainda ativo. Estado após claim in_progress e release todo. Não existe endpoint done nesta fatia; conclusão com evidência verificada vem depois.

Checkpoint: transação atômica INSERT + incremento de revision. expectedRevision errado => 409 revision_conflict. Se taskId fornecido, exigir dono agent e lease ativo. Sem taskId é uma nota geral do projeto. IdempotencyKey escopada ao projeto: repetição com payload igual retorna checkpoint original mesmo com expectedRevision antigo; payload divergente => 409 idempotency_conflict. Fazer essa verificação antes do CAS, sob a mesma transação. Campos extras não concedem permissões. Evidências recebem sempre provenance=agent_report, mesmo que o caller tente fornecer verified.

Handoff é Markdown neutro e não depende de um modelo específico. Incluir objetivo, revisão, contexto mais recente, próximo passo, bloqueios, decisões, tarefas e mensagens recentes. Explicitar datas, lease expirado, evidência declarada e conteúdo não confiável. Limite por caracteres (não fingir contagem de tokens). maxChars 2000–100000, padrão 20000. Truncamento sinalizado, preservar objetivo/próximo passo antes de logs. Mascarar formatos comuns de segredo (Bearer, *_API_KEY, PASSWORD e credenciais em URL); declarar que não há garantia de DLP universal. Não ler .env nem diffs/arquivos do projeto.

## HTTP

`server/app.ts` exporta `createApp(store)` Express sem abrir porta. Orquestradora implementa transporte. JSON em sucesso é diretamente o objeto; erros `{error:{code,message}}`, status 400/404/409. Corpo até 256kb.

GET /api/health => {status:'ok',mode:'local',version:'0.1.0',pid:number,iniciadoEm:ISO-8601} (pid e iniciadoEm: o processo e a hora em que subiu; o atalho da Área de Trabalho os usa para trocar um servidor de código velho)
GET /api/projects => Project[]
POST /api/projects CreateProject => Project (201)
GET /api/projects/:id => ProjectDetail
POST /api/projects/:id/tasks {title, description?, priority?, acceptanceCriteria?, dependencyTaskIds?, expectedOutputs?} => Task (201)
POST /api/projects/:id/tasks/:taskId/contract UpdateTaskContractInput => Task
POST /api/projects/:id/tasks/:taskId/claim ClaimInput => Task
POST /api/projects/:id/tasks/:taskId/release ReleaseInput => Task
POST /api/projects/:id/checkpoints CheckpointInput => Checkpoint (201)
POST /api/projects/:id/messages MessageInput => AgentMessage (201)
GET /api/projects/:id/handoff => Handoff
GET /api/projects/:id/handoff?format=markdown => texto para download .md
DELETE /api/projects/:id {confirmation} => DeletedProject
DELETE /api/projects/:id/backlog/:itemId {expectedVersion} => DeletedBacklogItem

HTTP estritamente loopback 127.0.0.1, mesma origem; rejeitar Origin estrangeira ou null e Host não local. Escritas requerem Content-Type application/json e X-Workspace-Client: local. Isso protege a superfície do navegador, NÃO é autenticação de múltiplos usuários do SO. Não expor na rede ou Internet. MCP stdio roda sob o usuário local e chama o mesmo serviço, nunca shell.

## Rodada 2 — escopo ampliado em 14/09/2026
V1 permanece compatível. Recursos adicionados: busca literal, recibos idempotentes da inbox, bundle versionado importado como projeto novo sob transação, inspeção seletiva de texto opt-in, diário de execuções e adaptadores CLI. Tipos novos separados em shared/continuity.ts, portability.ts, runtime.ts; cada autor respeita exports contratados no briefing.
Runtime desabilitado por padrão; configurações confiáveis vêm do servidor. Nunca aceitar executável/args/env/raízes do request. Processo com exit0 não comprova resultado do trabalho. MCP não recebe execução externa ou leitura de arquivos nesta rodada.
Validação executada em 14/09/2026 após a integração: 160 testes de servidor/domínio, build TypeScript/Vite e 15 jornadas desktop Playwright aprovadas.


## Correção vigente — sem runner na aplicação
createApp recebe apenas WorkspaceStore. Não existem rotas /api/agents ou /runs e server/index.ts não instancia AgentRuntime. GET /api/projects/:id/resume?agent= e MCP get_resume_brief expõem ResumeBrief determinístico. O AXON é uma caixa de continuidade; conteúdo consultado nunca é executado como instrução.

## Exclusão segura

`delete_project`/`DELETE /api/projects/:id` exige o nome salvo exatamente e remove o projeto e suas relações em uma transação. `delete_backlog_item`/`DELETE /api/projects/:id/backlog/:itemId` exige a versão atual e aceita apenas item já arquivado. Checkpoints, mensagens e tarefas permanecem imutáveis individualmente para preservar a cadeia de continuidade.

## Passagens estruturadas — contrato vigente em 14/09/2026

`HandoffDelivery` liga uma mensagem de transição a um checkpoint imutável e deriva a tarefa desse checkpoint. `from` deve coincidir com `checkpoint.agent`; divergência retorna 409 `handoff_author_mismatch`. Destino aceita identidade declarada ou `*`. A mensagem livre tem até 8000 caracteres e pode ficar vazia, usando o próximo passo como orientação. Leitura é idempotente por passagem e identidade; uma entrega direta só pode ser confirmada pelo destinatário.

Store: `createHandoffDelivery`, `getHandoffDeliveries` e `acknowledgeHandoffDelivery`. HTTP: POST/GET `/api/projects/:id/deliveries` e POST `/api/projects/:id/deliveries/:deliveryId/ack`. MCP: `create_handoff_delivery`, `get_handoff_deliveries`, `acknowledge_handoff_delivery`. `ResumeBrief.deliveries` apresenta não lidas primeiro e gera atenção do tipo `handoff`.

O ProjectBundle exportado pela aplicação está na versão 2 e inclui backlog, passagens estruturadas e recibos. O parser continua aceitando o formato v1 exatamente como legado, sem inventar os arrays da v2. Importações criam novos IDs em uma transação e remapeiam todas as referências.

## Retomada com foco explícito — contrato vigente em 14/09/2026

`getResumeBrief(projectId, agent, taskId?, focusMode?)` separa `latestTaskCheckpoint` de `latestProjectCheckpoint`. `latestCheckpoint` permanece como alias compatível do checkpoint efetivo: o da tarefa quando há foco ou o geral na visão do projeto. O retorno também expõe `claimedTasks` para não esconder múltiplas reservas do mesmo nome declarado.

`focusMode` aceita `auto` ou `project`. `auto` é o padrão compatível: um único lease ativo do agente vira foco; zero ou múltiplos leases não são escolhidos silenciosamente. `project` força visão geral mesmo quando há um lease ativo e não pode ser combinado com `taskId`. Um `taskId` explícito pode apontar para tarefa livre ou reservada por outro agente para fins de leitura; isso não assume a tarefa nem altera autoria.

HTTP: `GET /api/projects/:id/resume?agent=...&taskId=...&focusMode=...`. MCP: `get_resume_brief` aceita os mesmos campos. Formato inválido ou combinação ambígua retorna 400 `invalid_input`; tarefa que não pertence ao projeto retorna 404 `not_found`.

O Markdown identifica a tarefa de cada passagem estruturada por título e UUID. Checkpoint geral nunca é apresentado como próximo passo da tarefa quando ela ainda não possui checkpoint próprio.

## Backlog — contrato vigente em 14/09/2026

`BacklogItem` registra trabalho futuro antes de virar tarefa. Estágios ativos são `idea` e `ready`; `promoted` e `archived` são terminais. Atualizações e arquivamento usam versão esperada; promoção cria uma única tarefa `todo` na mesma transação e é idempotente. HTTP e MCP oferecem criar, listar, atualizar, promover e arquivar. Nenhuma operação inicia uma IA.

## Leitura e resolução de mensagens — contrato vigente em 15/09/2026

`InboxItem` expõe separadamente `acknowledgedAt` e `resolution`. Confirmar leitura nunca resolve uma pendência; resolver nunca cria recibo de leitura. Mensagens `question` e `review` continuam em `ResumeBrief.attention` mesmo depois de lidas, até existir resolução explícita para a identidade atual.

`resolveMessageAttention(projectId, messageId, input)` exige destinatário direto ou `*` e pelo menos uma nota não vazia, uma `responseMessageId` ou um `checkpointId`. Referências precisam pertencer ao mesmo projeto e ser declaradas pela identidade que resolve. Somente `question` e `review` são resolvíveis. A chave lógica é `(messageId, agent)`: repetir o mesmo conteúdo devolve o registro original; tentar outro conteúdo retorna 409 `resolution_conflict`.

HTTP: `POST /api/projects/:id/messages/:messageId/resolve`. MCP: `resolve_message_attention`. O ProjectBundle v2 inclui `messageResolutions`; bundles v2 anteriores sem esse campo usam lista vazia. A importação remapeia mensagem, resposta e checkpoint e preserva a separação entre resolução e recibo.

## Rascunho de emergência — contrato vigente em 15/09/2026

`WorkDraft` é um salvamento de emergência. Existe no máximo um rascunho por projeto, ator declarado e tarefa (`taskId` nulo é o rascunho geral). Atualização usa CAS por `version`. `status` é sempre `undelivered`.

O rascunho não incrementa `revision`, não vira checkpoint, não cria passagem e não cria recibo de leitura. `ResumeBrief.workDraft` é o rascunho do foco atual; `workDrafts` lista todos os rascunhos da identidade. O Markdown traz a seção `Rascunho não entregue` depois do próximo passo, para que o texto de emergência nunca apareça como ponto de retomada.

Store: `saveWorkDraft`, `getWorkDraft`, `listWorkDrafts`, `discardWorkDraft`. HTTP: POST/GET `/api/projects/:id/drafts` e POST `/api/projects/:id/drafts/discard`. MCP: `save_work_draft`, `get_work_drafts`, `discard_work_draft`.

## Finalização de trabalho — contrato vigente em 15/09/2026

`finalizeWork(projectId, input)` executa numa transação: checkpoint, passagem opcional, transição explícita da tarefa e descarte opcional do rascunho. Incrementa a revisão uma vez. Nunca cria recibo de leitura.

`taskTransition.kind` aceito: `keep_claimed`, `release`, `declare_blocked` e `declare_done`. `release`, `declare_blocked` e `declare_done` exigem `taskId`. `declare_blocked` exige `reason` e aceita `retainLease`. `declare_done` grava `completionCheckpointId` no checkpoint criado na mesma transação e libera a reserva.

Tarefas `blocked` e `done` não podem ser assumidas: 409 `task_closed`. `reopenTask` volta para `todo` ou `in_progress` se a reserva ainda pertencer a quem reabre, grava evento auditável e exige nota. HTTP: `POST /api/projects/:id/tasks/:taskId/reopen` e `GET /api/projects/:id/tasks/:taskId/events`. MCP: `reopen_task`, `get_task_events`.

HTTP: `POST /api/projects/:id/finalize`. MCP: `finalize_work`.

## Decisões canônicas e linhagem — contrato vigente em 15/09/2026

`Decision` formaliza escolhas de produto e arquitetura com ciclo de vida:
`proposed` → `accepted` → `superseded` / `revoked`.

- **Proposta**: Qualquer IA ou operador pode propor (`agent`, `title`, `body`, `note?`, `source?`). Decisões propostas nascem no estado `proposed` (versão 0) e NÃO são consideradas vigentes nem constam como ativas no briefing (`getResumeBrief`).
- **Aceite**: O operador humano valida a proposta fornecendo `actor` (1-80 caracteres) e `expectedVersion` (CAS). A decisão transiciona para `accepted` com `acceptedBy = actor`, incrementa `version` e torna-se vigente.
- **Revogação**: Decisão vigente (`accepted`) pode ser revogada pelo operador (`actor`, `expectedVersion`, `note?`). Transiciona para `revoked` com `revokedBy = actor` e deixa de constar como vigente.
- **Substituição (supersede)**: O operador humano substitui uma decisão vigente (`accepted`) fornecendo `actor`, `expectedVersion`, novo `title` e novo `body`. Em uma única transação com CAS na versão da anterior:
  1. Uma nova decisão é inserida diretamente no estado `accepted` com `supersedesId` apontando para a anterior;
  2. A decisão anterior transiciona para `superseded` com `supersededById` apontando para a nova decisão.
  A linhagem histórica permanece preservada e navegável.
- **Briefing**: `getResumeBrief` inclui apenas decisões vigentes (`accepted` e não revogadas/substituídas) em `brief.decisions` e na seção Markdown `## Decisões vigentes`. O histórico completo permanece consultável com `includeHistory: true`.
- **Validação & Isolamento**: Todas as operações exigem `projectId` válido e isolam decisões entre projetos. Conflito de versão (CAS) ou transição inválida resulta em 409 `version_conflict` ou 409 `invalid_transition`.

Store: `proposeDecision`, `acceptDecision`, `revokeDecision`, `supersedeDecision`, `listDecisions`, `getDecision`.
HTTP: `GET /api/projects/:id/decisions` (aceita `includeHistory=true`), `POST /api/projects/:id/decisions`, `POST /api/projects/:id/decisions/:decisionId/accept`, `POST /api/projects/:id/decisions/:decisionId/revoke`, `POST /api/projects/:id/decisions/:decisionId/supersede`.
MCP: `propose_decision`, `accept_decision`, `revoke_decision`, `supersede_decision`, `get_decisions`.
UI: Painel dedicado de decisões com lista de vigentes, alternador de histórico completo, distintivos de estado e diálogos em português para propor, aceitar, revogar e substituir sem botões de acionamento de IA.

## Compilador de contexto e ContextEnvelope — contrato vigente em 15/09/2026

`ContextEnvelope` formaliza uma estrutura única, explicável e determinística para UI, HTTP, MCP, Markdown e exportação:

- **Seleção determinística**:
  1. `charter`: revisão vigente do charter com objetivo e diretivas humanas;
  2. `focus_task`: tarefa em foco (quando houver);
  3. `checkpoint`: último checkpoint da tarefa em foco ou último geral do projeto;
  4. `decisions`: decisões vigentes (`accepted` e não revogadas/substituídas);
  5. `blockers`: bloqueios abertos ou mitigados;
  6. `library_content`: materiais da Biblioteca vinculados à tarefa em foco via `content_relations`;
  7. `deliveries`: passagens estruturadas não lidas endereçadas à identidade solicitante;
  8. `attention`: itens de atenção pendentes de resolução (bloqueios, perguntas, revisões);
  9. `work_draft`: rascunho de emergência não entregue correspondente ao foco;
  10. `overlaps`: avisos de sobreposição de escrita entre tarefas paralelas;
  11. `inbox`: mensagens recentes com prioridade para não lidas.

- **Proveniência e autoridade**: Cada item selecionado explica:
  - `sourceId`, `sourceType`, `title`, `body`;
  - `revisionId` e `revisionNo` quando aplicável;
  - `provenance` (`human_directive`, `agent_report`, `authorized_system`, `external_source`);
  - `authority` (`directive`, `reference`, `proposal`);
  - `declaredValidity` e `reason` claro da inclusão.
  Conteúdo relatado por agente carrega `agent_report` e permanece não confiável.

- **Corte por entidades completas**: O orçamento `maxChars` (2000 a 100000, padrão 20000) corta apenas entre entidades completas. Entidades que não cabem são omitidas integralmente (nunca truncadas internamente para fingir completude) e contabilizadas em `omittedCounts` por categoria. Seções inteiras omitidas constam em `cutSections`.

- **Biblioteca vinculada**: Conteúdos da Biblioteca relacionados à tarefa em foco (`target_type = 'task'`) omitem itens arquivados e revisões desatualizadas (`outdated`) por padrão, incrementando `omittedCounts`. O parâmetro `includeOutdatedContent: true` permite incluir revisões com validade desatualizada.

- **Coordenação de foco e conflitos**: Múltiplas reservas ativas da mesma identidade sem `taskId` explícito em modo `auto` não selecionam tarefa em silêncio: `focusTaskId = null`, e um conflito do tipo `ambiguous_focus` é registrado em `conflicts`.

- **Isolamento**: O envelope respeita isolamento estrito entre projetos. Requisitar `taskId` de outro projeto resulta em 404 `not_found`.

Store: `compileContext(projectId: string, request: ContextRequest): ContextEnvelope`.
HTTP: `GET /api/projects/:id/context?agent=...&taskId=...&focusMode=...&maxChars=...&includeOutdatedContent=...`.
MCP: `compile_context`.

## Contrato de Tarefa (Task Contract) — contrato vigente em 15/09/2026

O contrato de tarefa formaliza critérios de aceite verificáveis, mapeamento de dependências acíclicas e saídas esperadas:

- **Campos do contrato**:
  - `description`: especificação textual ou null;
  - `priority`: `'urgent' | 'high' | 'medium' | 'low'`, padrão `'medium'`;
  - `acceptanceCriteria`: lista de `{ id, description, completed }`;
  - `dependencyTaskIds`: lista de IDs de tarefas que devem ser concluídas antes desta;
  - `expectedOutputs`: lista de `{ id, title, kind, locator? }` com tipos permitidos (`file_path`, `content_item`, `artifact`, `design_asset`, `dataset`, `other`).

- **Retrocompatibilidade**: Tarefas criadas apenas com `{ title }` recebem defaults seguros (`priority: 'medium'`, listas vazias). Promoções do backlog transferem `description` e `priority`.

- **Grafo de dependências e detecção de ciclos**:
  - Auto-dependência é proibida: 400 `dependency_cycle`.
  - Dependência transitiva gerando ciclo é rejeitada via travessia de grafo: 400 `dependency_cycle`.
  - Dependência de tarefa inexistente ou pertencente a outro projeto é rejeitada: 404 `not_found`.

- **Impedimento de execução (Claim Guard)**:
  - `claimTask` valida o estado de todas as tarefas declaradas em `dependencyTaskIds`.
  - Se qualquer dependência não possuir status `done` (ex.: `todo`, `in_progress`, `blocked` ou inexistente), a tentativa de assumir a tarefa é bloqueada com status 409 `dependency_unmet`.
  - Apenas após a dependência ser declarada concluída (`declare_done` via `finalizeWork`), a tarefa dependente pode ser reservada.

- **Atualização atômica com CAS (updateTaskContract)**:
  - Exige `expectedVersion` compatível. Divergência de versão retorna 409 `version_conflict`.
  - Sucesso incrementa a `version` da tarefa e atualiza o timestamp do projeto.

- **Integração no compilador de contexto (ContextEnvelope)**:
  - `compileContext` formata prioridade, critérios de aceite com caixas de seleção `[x]` / `[ ]`, dependências e saídas esperadas no corpo do item `focus_task` e no Markdown gerado.

Store: `createTask(projectId, input)`, `updateTaskContract(projectId, taskId, input)`.
HTTP: `POST /api/projects/:id/tasks/:taskId/contract`.
MCP: `update_task_contract`, `create_task`.



