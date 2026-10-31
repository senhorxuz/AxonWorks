# Grafo de Decisões e Conteúdos, Detecção de Conflitos e Invalidação de Frescor (P3)

## 1. Visão Geral e Fundamentação Arquitetural

No Axon Works, os checkpoints funcionam como diários de bordo imutáveis e auditáveis do trabalho realizado pelos agentes. Contudo, em projetos de média e longa duração com múltiplos agentes autônomos e intervenções humanas, a retenção de conhecimento exclusivamente em blocos de texto corrido acarreta três problemas críticos:

1. **Decisões Zumbi e Contraditórias:** Duas IAs em turnos distintos podem tomar decisões conflitantes sobre o mesmo domínio sem que uma substitua expressamente a outra, ou uma decisão antiga já substituída continua sendo lida como válida.
2. **Conteúdos Desatualizados (Stale Content):** Documentos de especificação, notas de arquitetura ou referências na biblioteca continuam sendo consultados mesmo após a diretiva ou decisão em que se fundamentavam ter sido revogada ou substituída.
3. **Falta de Análise de Impacto:** Antes de revogar uma decisão ou arquivar um artefato da biblioteca, o operador ou agente não tem visibilidade de quais tarefas em andamento, critérios de aceite ou outros documentos serão impactados a jusante.

O **Grafo de Decisões e Conteúdos do Axon** unifica a memória canônica em um modelo estruturado e direcionado de nós e arestas com suporte a:
- **Montagem dinâmica de grafo de entidades** (`decisions`, `content_items`, `tasks`, `blockers`).
- **Detecção algorítmica de conflitos de decisões** (contradições explícitas, sobreposições temáticas sem substituição, aceites zumbis e ciclos de linhagem).
- **Detecção de conteúdos obsoletos/desatualizados** (dependências de decisões revogadas/substituídas, referências a itens arquivados, validade vencida ou contradição com decisões vigentes).
- **Análise de alcance e impacto a jusante (reachability analysis)** para mensuração precisa de risco de alterações antes de sua aplicação.

---

## 2. Modelo Canônico do Grafo (`shared/graph.ts`)

O modelo tipado é formalizado em [`shared/graph.ts`](shared/graph.ts):

### Tipos de Nós (`GraphNode`)
- `decision`: Decisões canônicas versionadas com status (`proposed`, `accepted`, `superseded`, `revoked`), autoria e linhagem (`supersedesId` / `supersededById`).
- `content`: Itens da biblioteca com versão vigente, tipo (`note`, `specification`, `research`, `reference`, `artifact`), validade declarada (`current`, `needs_review`, `outdated`) e status (`active`, `archived`).
- `task`: Tarefas do projeto com prioridade (`urgent`, `high`, `medium`, `low`), estado de execução (`todo`, `in_progress`, `blocked`, `done`), responsável e lista de dependências.
- `blocker`: Bloqueios canônicos ativos ou resolvidos (`open`, `mitigated`, `resolved`, `accepted_risk`), com vínculo opcional a tarefas.

### Tipos de Arestas Direcionadas (`GraphEdge`)
- `supersedes`: Relação de substituição entre decisões (ou revisões de conteúdo).
- `contradicts`: Relação explícita de contradição ou conflito identificado.
- `supports`: Item de conteúdo que fundamenta ou apoia uma decisão ou outro conteúdo.
- `implements`: Tarefa que implementa diretiva ou especificação.
- `references`: Vínculos informacionais, insumos obrigatórios (`required_input`) ou saídas produzidas (`produced_output`).
- `depends_on`: Dependência estrita acíclica entre tarefas.
- `blocks`: Bloqueio que impede a progressão de uma tarefa.

### Proveniência da Aresta (`EdgeProvenance`)
- `explicit_relation`: Relação registrada formalmente na tabela `content_relations`.
- `structural_lineage`: Linhagem herdada via `supersedes_id` em decisões ou charter.
- `task_dependency`: Dependência formal declarada no contrato de tarefa (`dependency_task_ids`).
- `blocker_link`: Vínculo formal de bloqueio com chave estrangeira na tabela `blockers`.

---

## 3. Motor de Detecção de Conflitos de Decisões (`server/graph/analyzer.ts`)

O analisador examina o conjunto de decisões do projeto e classifica anomalias em três níveis de severidade (`critical`, `warning`, `info`):

1. **Contradições Expressas (`direct_contradiction` — Critical):**
   - Detecta quando uma relação com `kind: 'contradicts'` conecta uma decisão vigente (status `accepted`) a outra decisão ou conteúdo ativo.
   - *Recomendação:* Revogar ou reformular uma das decisões conflitantes para restaurar a coerência do briefing dos agentes.

2. **Aceites Zumbi e Linhagem Inconsistente (`unresolved_supersession` — Critical):**
   - Identifica decisões que foram formalmente substituídas por outra decisão aceita (`newer.supersedesId === old.id`), mas cujo status permaneceu incorretamente como `accepted` em vez de transicionar para `superseded`.
   - Identifica decisões com `supersededById` preenchido que ainda constam como `accepted`.
   - *Recomendação:* Transicionar formalmente a decisão obsoleta para `superseded`.

3. **Ciclos de Substituição (`circular_supersession` — Critical):**
   - Executa detecção de ciclos em grafo direcionado (DFS com pilha de rastreio de recursão) para garantir que a cadeia de substituição não contenha laços (ex: A substitui B, B substitui A).
   - *Recomendação:* Romper o ciclo redefinindo o ponteiro `supersedesId`.

4. **Sobreposição Temática sem Substituição (`overlapping_accepted_decisions` — Warning):**
   - Aplica tokenização de texto, normalização NFD sem diacríticos e expurgo de stopwords (PT/EN).
   - Calcula a similaridade léxica de Jaccard sobre títulos e corpos das decisões vigentes (`accepted`).
   - Se duas decisões ativas compartilham prefixo temático comum (ex: `Autenticação: ...`) e similaridade temática relevante sem que nenhuma possua vínculo de substituição com a outra, um alerta preventivo é gerado.
   - *Recomendação:* Avaliar se uma decisão deve substituir formalmente a outra ou se os escopos devem ser clarificados.

---

## 4. Motor de Frescor e Invalidação de Conteúdos (`server/graph/analyzer.ts`)

Garante que documentos da biblioteca reflitam fielmente o estado das decisões e do código:

1. **Dependência de Decisão Revogada (`dependency_decision_revoked` — Critical):**
   - Um item de conteúdo ativo possui relação `supports` ou `related` apontando para uma decisão cujo status é `revoked`.
   - Evita que agentes continuem implementando instruções cujo respaldo foi anulado.

2. **Dependência de Decisão Substituída (`dependency_decision_superseded` — Warning):**
   - Um item de conteúdo ativo baseia-se em uma decisão que foi substituída por uma diretiva mais nova.
   - Alerta a necessidade de atualização para refletir os novos parâmetros aprovados.

3. **Contradição com Decisão Vigente (`contradicts_accepted_decision` — Critical):**
   - O conteúdo possui relação de contradição direta com uma decisão aceita e em vigor.

4. **Referência a Conteúdo Arquivado ou Desatualizado (`referenced_content_archived_or_outdated` — Warning):**
   - Um conteúdo ativo referencia outro item cujo status é `archived` ou cuja revisão atual está marcada com `declaredValidity === 'outdated'`.

5. **Validade Declarada Vencida ou Pendente:**
   - Marcação explícita de `declaredValidity === 'outdated'` (Critical) ou `'needs_review'` (Warning).

---

## 5. Análise de Alcance e Impacto (`analyzeGraphImpact`)

Permite avaliar as repercussões de alterar, revogar ou arquivar qualquer entidade antes de efetivar a mudança:

- **Algoritmo:** Busca em Largura (BFS) bidirecional sobre a malha de relacionamentos do projeto.
- **Rastreamento:** Registra o caminho relacional percorrido (`relationPath`), a distância topológica (`distance`), e o motivo do impacto.
- **Severidade e Risco:**
  - `Risk Level: high`: Se houver tarefas em andamento (`status === 'in_progress'`) impactadas, ou se o número de entidades afetadas for $\ge 4$.
  - `Risk Level: medium`: Se houver tarefas pendentes (`todo`) ou itens ativos de biblioteca afetados ($\ge 1$).
  - `Risk Level: low`: Nenhuma entidade crítica dependente identificada.

---

## 6. Endpoints HTTP REST

### `GET /api/projects/:id/graph`
Retorna o grafo estruturado de entidades e relacionamentos com estatísticas.
- **Query Params:**
  - `nodeTypes`: Filtro opcional separado por vírgula (ex: `?nodeTypes=decision,content`).
  - `includeArchived`: Booleano (`true` por padrão; se `false`, oculta conteúdos arquivados).
- **Resposta:** `ProjectGraph`

### `GET /api/projects/:id/graph/conflicts`
Executa o diagnóstico de integridade e retorna o relatório de conflitos entre decisões.
- **Resposta:** `DecisionConflictReport` contendo contagens por severidade e array de conflitos detalhados com recomendações acionáveis.

### `GET /api/projects/:id/graph/stale`
Examina a biblioteca e retorna conteúdos potencialmente desatualizados com a causa raiz.
- **Resposta:** `StaleContentReport` com diagnósticos de decisões revogadas, substituídas, referências obsoletas e validade declarada.

### `GET /api/projects/:id/graph/impact`
Calcula o alcance e o risco de impacto caso uma entidade específica seja modificada ou revogada.
- **Query Params:**
  - `type` ou `entityType`: `decision` | `content` | `task` | `blocker` (obrigatório).
  - `id` ou `entityId`: UUID da entidade alvo (obrigatório).
- **Resposta:** `GraphImpactReport` com nível de risco (`high`, `medium`, `low`), resumo quantitativo e entidades impactadas ordenadas por distância.

---

## 7. Ferramentas MCP (Model Context Protocol)

As ferramentas estão registradas em [`server/mcp-tools.ts`](server/mcp-tools.ts) com `readOnlyHint: true`:

1. `get_project_graph`:
   - Argumentos: `{ projectId: string, nodeTypes?: string[], includeArchived?: boolean }`
2. `detect_decision_conflicts`:
   - Argumentos: `{ projectId: string }`
3. `detect_stale_content`:
   - Argumentos: `{ projectId: string }`
4. `analyze_graph_impact`:
   - Argumentos: `{ projectId: string, entityType: "decision" | "content" | "task" | "blocker", entityId: string }`

---

## 8. Verificação e Evidências Automatizadas

Os testes dedicados em [`tests/graph-analysis.test.ts`](tests/graph-analysis.test.ts) validam:
- Construção de grafo com 4 tipos de nós e 7 tipos de arestas com contagens estatísticas exatas.
- Filtragem por tipos de nó e isolamento de arestas órfãs.
- Detecção de contradições diretas com decisões aceitas.
- Detecção de sobreposições temáticas léxicas entre decisões ativas.
- Identificação de conteúdos que dependem de decisões revogadas ou substituídas.
- Invalidação de conteúdos apontando para itens arquivados.
- Análise de impacto BFS propagando por cadeias de suporte, dependência e insumos de tarefas.
- Elevação do nível de risco para `high` na presença de tarefas `in_progress`.
- Execução transparente via HTTP REST e MCP em memória.

---

## 9. Interface Visual, Topologia & Visão Explicável de Mudanças

A camada visual foi completamente implementada no frontend em React 19 + TypeScript:

1. **Painel do Grafo (`src/GraphPanel.tsx`):**
   - **Cartões de KPI no Topo:** Total de nós por tipo, relações ativas, conflitos de decisão (com contagem de críticos e alertas) e conteúdos desatualizados.
   - **Filtros e Busca em Tempo Real:** Filtragem por tipo de nó (`Todos`, `Decisões`, `Biblioteca`, `Tarefas`, `Bloqueios`), busca de texto e alternador para itens arquivados.
   - **Lanes Topológicas (Swimlanes):** Distribuição visual em colunas temáticas para Decisões Canônicas, Biblioteca & Documentos, Tarefas & Contratos e Bloqueios.
   - **Inspetor de Nós & Gaveta de Impacto a Jusante:**
     - Exibe metadados de status, versão, responsáveis e datas.
     - Detalha conexões imediatas de precedência (entradas) e impacto direto (saídas).
     - Executa sob demanda a **Análise de Alcance e Impacto**, calculando o nível de risco (`high`, `medium`, `low`), estatísticas de nós alcançados e o caminho relacional topológico (`A -(supports)-> B -(depends_on)-> C`).
   - **Subvisão de Inteligência de Conflitos:** Diagnósticos explicativos de contradições, sobreposições léxicas de decisões aceitas e anomalias de ciclo com recomendações de mitigação.
   - **Subvisão de Frescor de Biblioteca:** Diagnósticos de itens de conteúdo cuja validade foi comprometida por decisões revogadas ou alteradas, com botões para abertura direta na Biblioteca.

2. **Visão Explicável de Mudanças ("O que mudou desde a última vez" — `src/OperationalChangelog.tsx`):**
   - Comparativo temporal automático entre o ponto de retomada atual ($r_N$) e o ciclo anterior ($r_{N-1}$ ou início do projeto).
   - Destaques consolidados em três eixos:
     - **Tarefas e Entregas:** Tarefas concluídas no período e tarefas em andamento.
     - **Diretrizes & Decisões:** Decisões aceitas ou propostas no intervalo.
     - **Bloqueios & Passagens:** Bloqueios abertos/resolvidos e passagens de trabalho trocadas entre agentes.
   - Ação rápida de **Copiar Mudanças em Markdown**, permitindo passar um resumo operacional limpo para outras IAs ou atas de trabalho.

3. **Testes E2E com Playwright (`tests/ui.spec.ts`):**
   - Teste automatizado completo (`grafo & inteligência: topologia, inspeção de nós, análise de impacto e changelog operacional`) validando a renderização dos componentes, transições de abas, inspeção de nós, cálculo de risco e navegação entre subvisões.

