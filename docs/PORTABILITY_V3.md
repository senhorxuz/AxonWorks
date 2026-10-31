# ProjectBundle v3 — Especificação de Portabilidade Canônica Completa

## 1. Visão Geral
O **ProjectBundle v3** é o formato canônico de portabilidade e transporte completo de projetos do **Axon Works**. Ele permite que um projeto com todo o seu histórico, governança e memória seja exportado de uma instância do Axon e importado em outra com fidelidade absoluta de estado, integridade relacional estrita e remapeamento biunívoco de identificadores únicos (UUIDs).

Enquanto o formato v1 transportava apenas tarefas simples, checkpoints e mensagens, e o v2 adicionava itens de backlog, passagens de bastão (`handoff_deliveries`), recibos e resoluções de mensagens, o **v3 eleva a portabilidade ao nível de sistema operacional de projetos completo**, incluindo:

1. **Contratos de Tarefas (Task Contracts)**: Prioridade, descrição rica, critérios de aceite (`acceptanceCriteria`), dependências orientadas entre tarefas (`dependencyTaskIds`) e saídas esperadas (`expectedOutputs`).
2. **Histórico do Charter do Projeto**: Linhagem completa de revisões do documento fundador do projeto (`charter_revisions`), seus autores, tipos de fonte e relacionamentos de substituição (`supersedesId`).
3. **Decisões Canônicas com Linhagem**: Histórico completo de decisões (`decisions`), status (`proposed`, `accepted`, `revoked`), proponente, aceitador, revogador e cadeias de substituição (`supersedesId` / `supersededById`).
4. **Bloqueios Canônicos (Blockers)**: Bloqueios ativos e resolvidos (`blockers`), com suas vinculações opcionais a tarefas, checkpoints de origem, abertos por, atribuídos e resolução explícita.
5. **Biblioteca de Conteúdos (Library)**: Itens documentais (`content_items`), revisões históricas ordenadas e imutáveis (`content_revisions`) e relações polimórficas (`content_relations`) conectando revisões a tarefas, decisões e bloqueios.
6. **Histórico de Transições de Tarefas (Task Events)**: Log de auditoria de transições de status das tarefas (`task_events`), identificando o agente responsável, notas explicativas e checkpoints associados.
7. **Rascunhos de Emergência (Work Drafts)**: Rascunhos de trabalho não entregues (`work_drafts`), preservando o progresso intermediário de agentes (resumos, próximas ações, áreas alteradas, verificações observadas) para recuperação de desastre.

---

## 2. Invariantes e Regras de Integridade

### 2.1 Remapeamento Biunívoco de UUIDs
Na importação de um bundle v3, nenhum UUID de origem é reutilizado diretamente nas tabelas operacionais do destino. É gerado um novo UUID v4 criptográfico para cada entidade:
- ID do projeto
- Tarefas (`tasks`)
- Checkpoints (`checkpoints`)
- Evidências (`checkpoint_evidences`)
- Mensagens (`messages`)
- Itens de backlog (`backlog_items`)
- Passagens de bastão (`handoff_deliveries`)
- Recibos de entrega (`handoff_receipts`)
- Resoluções de mensagens (`message_resolutions`)
- Revisões do charter (`charter_revisions`)
- Decisões (`decisions`)
- Bloqueios (`blockers`)
- Itens de biblioteca (`content_items`) e revisões (`content_revisions`)
- Relações de conteúdo (`content_relations`)
- Eventos de transição de tarefas (`task_events`)
- Rascunhos de trabalho (`work_drafts`)

Todas as chaves estrangeiras entre entidades são devidamente atualizadas com base no mapa biunívoco (`idMap`).

### 2.2 Prevenção de Ciclos em Grafos Dirigidos
O validador `validateV3Integrity` aplica algoritmos de detecção de ciclo em profundidade (DFS com 3 cores: unvisited, visiting, visited):
- **Dependências de Tarefas (`assertAcyclicTaskDependencies`)**: Rejeita qualquer ciclo onde `Task A -> Task B -> Task A`.
- **Substituição de Decisões (`assertAcyclicDecisionSupersession`)**: Rejeita qualquer ciclo onde `Decision A supersedes B -> B supersedes A`.

### 2.3 Inserção em Duas Fases (Two-Phase Insertion) para Decisões
Para evitar deadlocks ou violações de integridade relacional quando decisões referenciam decisões anteriores que ainda não foram inseridas ou quando há referências bidirecionais (`supersedes_id` e `superseded_by_id`), o importador executa a inserção em duas etapas:
1. **Fase 1**: Insere todos os registros de decisões com `supersedes_id = NULL` e `superseded_by_id = NULL`.
2. **Fase 2**: Atualiza em lote as colunas `supersedes_id` e `superseded_by_id` com os IDs remapeados correspondentes.

### 2.4 Sincronização Automática do Índice Full-Text Search (FTS5)
Para que a biblioteca de conteúdos importada esteja imediatamente pesquisável sem requerer uma reindexação manual ou reinicialização do serviço, o importador invoca explicitamente `this.indexCurrentContent(newItemId, newProjectId, item.title, currentRevision.body)` para cada item ativo importado.

### 2.5 Respeito a Triggers de Imutabilidade
O schema do SQLite define triggers como `trg_content_revisions_immutable`. O importador insere as revisões de conteúdo estritamente em ordem crescente de `revision ASC`, garantindo que o `current_revision_id` no `content_items` seja apontado para a revisão correta de forma determinística.

### 2.6 Sanitização de Segredos e Limites de Tamanho
- Todos os campos textuais abertos (títulos, descrições, corpos, resumos, notas, URLs) passam pela função `maskSecrets`, garantindo que credenciais como `API_KEY=...`, `Bearer ...` e `PASSWORD=...` sejam ofuscadas antes da exportação.
- O teto máximo de tamanho para um pacote serializado v3 é de **1 MB** (`MAX_BUNDLE_SERIALIZED_BYTES = 1024 * 1024`), suportado pelo parser do Express configurado para **2 MB** na rota `/api/import`.

---

## 3. Retrocompatibilidade
O motor de importação do Axon Works suporta nativamente todas as três versões:
- **v1**: Importa projeto, tarefas, checkpoints e mensagens, gerando o charter padrão inicial com a revisão 1.
- **v2**: Importa tudo do v1 mais backlog, passagens de bastão, recibos e resoluções de mensagens.
- **v3**: Importa tudo do v2 mais o ecossistema completo de contratos, charter, decisões, bloqueios, biblioteca e rascunhos. Se o bundle v3 trouxer revisões de charter explícitas, a criação do charter default inicial é suprimida para preservar o histórico autêntico exportado.

---

## 4. Endpoints e Ferramentas MCP

| Protocolo | Ação | Endpoint / Tool | Parâmetros / Comportamento |
|---|---|---|---|
| **HTTP** | Exportar | `GET /api/projects/:id/bundle?version=3` | Exporta bundle no formato especificado (v1, v2 ou v3; v2 por padrão se omitido). |
| **HTTP** | Importar | `POST /api/import` | Recebe `{ bundle: ... }` ou o próprio objeto bundle (v1, v2 ou v3), aceitando até 2 MB de payload. |
| **MCP** | Exportar | `export_project_bundle` | Parâmetros: `projectId` (string UUID), `version` (1, 2 ou 3; padrão: 2). Retorna JSON do bundle. |
| **MCP** | Importar | `import_project_bundle` | Parâmetro: `bundle` (objeto ou string JSON). Importa atomicamente e retorna o projeto criado. |
