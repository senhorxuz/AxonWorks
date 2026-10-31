# Axon Works — roadmap de contexto e biblioteca

Status: proposta de evolução, ainda não implementada.  
Objetivo: tornar a retomada entre IAs mais precisa, explicável e fácil de acompanhar pelo usuário.

O protocolo detalhado de entrada, reserva, trabalho, passagem e recuperação está em `docs/AGENT-OPERATING-PROTOCOL.md`.

## Diagnóstico

O núcleo atual é uma boa base de continuidade: checkpoints são imutáveis, escritas importantes usam controle de versão, mensagens e passagens possuem confirmação de leitura e o projeto pode ser exportado.

O principal limite é que quase todo conhecimento ainda vive como texto dentro do último checkpoint. Isso mistura três responsabilidades diferentes:

1. **Memória estável:** objetivo, regras, requisitos e decisões que continuam valendo.
2. **Histórico:** o que uma IA fez em determinado momento.
3. **Materiais:** documentos, referências, imagens, relatórios e entregáveis usados ou produzidos.

O checkpoint deve continuar sendo o diário imutável. A memória canônica deve mostrar o que vale agora. A Biblioteca deve organizar os materiais e suas versões.

## Correções de confiança antes de adicionar inteligência

### 1. Retomada vinculada à tarefa correta

Hoje uma IA pode ter uma tarefa em foco e receber o checkpoint mais recente de outra tarefa. O briefing deve aceitar `taskId` ou apresentar todas as tarefas ativas do agente. Ele deve separar:

- último checkpoint geral do projeto;
- último checkpoint da tarefa em foco;
- próximo passo da tarefa;
- alterações recentes de outras tarefas.

### 2. Ciclo de vida das tarefas

Na primeira evolução, adicionar somente estados com transições completas:

`todo · in_progress · blocked · done`

Uma tarefa concluída deve guardar `completedAt`, `completedBy`, `completionCheckpointId` e deixar claro que a conclusão foi declarada pelo agente. Reabrir deve ser uma ação explícita e auditável. `in_review` e `cancelled` entram depois, quando possuírem responsável, motivo, efeito sobre a reserva e reabertura definidos.

### 3. Broadcast sem ambiguidade

O contrato atual usa `*` e o guia foi corrigido para refletir isso. Numa versão futura, adotar uma estrutura explícita, por exemplo:

```ts
type Audience =
  | { kind: 'broadcast' }
  | { kind: 'agent'; agentId: string }
```

### 4. Leitura não significa resolução

Perguntas, pedidos de revisão e bloqueios não podem desaparecer apenas porque foram lidos. Separar `readAt` de `resolvedAt`, permitir respostas em thread e manter itens abertos na área de atenção.

### 5. Saída atômica do trabalho

Não criar uma entidade de sessão concorrendo com o lease da tarefa. Criar `finalize_work`, uma conveniência de saída que, em uma única transação:

1. salva o checkpoint;
2. cria uma passagem opcional;
3. aplica uma transição explícita da tarefa (`keep_claimed`, `release`, `declare_blocked` ou `declare_done`);
4. relaciona conteúdos já existentes;
5. aceita uma chave de idempotência para repetição segura;
6. pode descartar o rascunho de emergência correspondente.

Confirmações de leitura, resolução de perguntas, aprovação humana e verificação de evidência permanecem operações separadas. Checkpoints incrementais continuam existindo fora da finalização.

### 6. Rascunho de emergência

Manter no máximo um rascunho versionado por projeto, ator e tarefa. Ele não incrementa a revisão, não vira checkpoint automaticamente e aparece sempre como “não entregue”. Serve apenas para recuperar progresso após uma queda.

### 7. Um único contrato de limites

Store, HTTP e MCP precisam usar os mesmos schemas e os mesmos limites de texto. Uma entrada aceita pelo MCP não pode falhar depois no domínio por possuir um limite diferente.

## Memória canônica

### Project Charter

Cada projeto deve possuir um documento vivo e versionado com:

- objetivo;
- resultado esperado;
- escopo incluído e excluído;
- restrições;
- critérios de aceite globais;
- convenções e vocabulário;
- preferências aprovadas pelo usuário;
- riscos conhecidos.

Toda retomada informa qual revisão do Charter foi usada.

### Decisões

Decisões deixam de ser apenas frases dentro de checkpoints e passam a ter identidade própria:

```ts
interface DecisionRecord {
  id: string
  projectId: string
  topic: string
  statement: string
  rationale: string
  status: 'proposed' | 'accepted' | 'superseded' | 'revoked'
  authority: 'user_approved' | 'agent_proposed'
  sourceCheckpointId: string
  supersedesId: string | null
  createdBy: string
  createdAt: string
}
```

A decisão anterior nunca é apagada. A visão geral mostra decisões vigentes; o histórico explica quando e por que cada uma perdeu validade.

### Bloqueios e perguntas

Bloqueios também precisam de ciclo de vida:

`open · mitigated · resolved · accepted_risk`

Cada bloqueio possui origem, tarefa afetada, responsável opcional, resolução e datas. Assim ele não desaparece quando um novo checkpoint deixa de repetir a frase.

### Tarefas mais úteis para outra IA

Além do título, cada tarefa deve registrar:

- descrição e resultado esperado;
- critérios de aceite;
- dependências;
- entradas obrigatórias da Biblioteca;
- saída esperada;
- prioridade;
- responsável atual e prazo da reserva;
- checkpoint de conclusão;
- estado de revisão.

## Biblioteca de Conteúdos

A Biblioteca é uma camada de conhecimento curado e versionado. Um arquivo ou link é apenas uma fonte; o item explica sua finalidade, validade e relação com o trabalho.

### Modelo inicial

```ts
type ContentKind =
  | 'brief'
  | 'specification'
  | 'reference'
  | 'procedure'
  | 'artifact'
  | 'report'
  | 'design'
  | 'research'
  | 'note'

type ContentLifecycle = 'draft' | 'current' | 'superseded' | 'retired'
type ContentSource = 'inline' | 'workspace_file' | 'external_url' | 'uploaded_file'

interface ContentItem {
  id: string
  projectId: string
  title: string
  purpose: string
  kind: ContentKind
  lifecycle: ContentLifecycle
  currentRevisionId: string
  pinnedToBrief: boolean
  sensitivity: 'normal' | 'restricted' | 'human_only'
  createdAt: string
  updatedAt: string
}

interface ContentRevision {
  id: string
  contentItemId: string
  version: number
  summary: string
  body: string | null
  storageRef: string | null
  sourceUrl: string | null
  sourcePath: string | null
  checksum: string | null
  provenance: 'human' | 'agent' | 'authorized_system' | 'external_source'
  authority: 'directive' | 'reference'
  createdBy: string
  createdAt: string
}

type ContentRelationKind =
  | 'supports'
  | 'contradicts'
  | 'supersedes'
  | 'implements'
  | 'validates'
  | 'references'
```

Os vínculos internos devem preservar chaves estrangeiras reais, com tabelas como `task_content_links`, `checkpoint_content_links` e `decision_content_links`.

### Fontes aceitas

- texto escrito dentro do Axon;
- referência a arquivo da pasta do projeto;
- link externo;
- arquivo enviado;
- saída registrada por uma tarefa.

Anexos ficam fora do SQLite, em armazenamento endereçado por hash. O banco guarda metadados, relações, versão e SHA-256. O backup precisa incluir banco e blobs.

### Visões da Biblioteca

Pastas podem existir depois, mas não devem ser a navegação principal. As visões úteis são:

- **Essenciais:** tudo que qualquer IA precisa ler;
- **Vigentes:** conteúdo que vale agora;
- **Precisa revisar:** fonte alterada, validade vencida ou conflito;
- **Produzidos:** entregáveis ligados a tarefas e checkpoints;
- **Histórico:** conteúdos substituídos ou retirados;
- **Todos:** pesquisa e filtros completos.

Cada linha deve responder rapidamente:

- o que é;
- para que serve;
- se continua vigente;
- qual versão vale;
- quem criou ou aprovou;
- em qual tarefa/checkpoint entrou;
- o que o substituiu.

Documentos essenciais podem ser marcados como `pinnedToBrief`. Isso fixa apenas o resumo e a referência da versão vigente no briefing; o corpo completo continua sendo lido sob demanda. Fixar não transforma o conteúdo em diretiva: autoridade, proveniência e aprovação permanecem campos separados.

### Fluxo desktop

A aba fica logo após a visão geral:

`Visão geral · Biblioteca · Backlog · Checkpoints · Mensagens · Retomar`

Na Biblioteca, usar toda a largura disponível:

1. coluna esquerda com busca, filtros e lista densa;
2. painel de leitura à direita;
3. abas internas `Conteúdo · Relações · Versões`;
4. contagens explicáveis no topo: Essenciais, Vigentes, Precisa revisar e Histórico.

Não usar uma nota abstrata de “saúde calculada por IA”. Mostrar problemas concretos, como “2 conteúdos substituídos ainda ligados a tarefas abertas”.

### Integração com o fluxo de trabalho

Ao salvar um checkpoint, a IA declara:

- conteúdos consultados;
- conteúdos ou versões produzidos;
- decisões criadas, mantidas ou substituídas;
- evidências anexadas e o objeto exato que validam.

Ao promover um backlog para tarefa, os conteúdos de base são herdados. A tarefa diferencia `required_input`, `reference` e `expected_output`.

## Compilador de contexto

JSON, UI, Markdown e MCP devem usar o mesmo `ContextEnvelope`.

### Entrada

```ts
interface ContextRequest {
  projectId: string
  actorId: string
  taskId?: string
  maxChars: number
  sinceContextSequence?: number
}
```

### Seleção

1. Incluir objetivo e diretivas aprovadas pelo usuário.
2. Incluir a tarefa em foco, aceite e dependências.
3. Incluir conteúdos essenciais e entradas obrigatórias da tarefa.
4. Incluir decisões vigentes que afetam a tarefa.
5. Incluir passagens não lidas, perguntas abertas e bloqueios.
6. Incluir o checkpoint mais recente da tarefa e mudanças posteriores relevantes.
7. Incluir evidências ligadas às versões selecionadas.
8. Excluir conteúdo substituído por padrão.
9. Remover duplicações e cortar apenas entre itens completos.
10. Informar tudo que foi omitido.

Cada item selecionado precisa carregar:

- `sourceId` e `revisionId`;
- proveniência e autoridade;
- validade;
- motivo da inclusão;
- relação com tarefa, decisão ou checkpoint.

### Saída explicável

```ts
interface ContextEnvelope {
  contextSequence: number
  generatedAt: string
  charterRevisionId: string
  focusTaskId: string | null
  sections: ContextSection[]
  includedSources: Array<{ sourceId: string; revisionId: string; reason: string }>
  omittedCounts: Record<string, number>
  cutSections: string[]
  conflicts: ContextConflict[]
}
```

A IA deve poder responder “de qual versão veio esta informação?”. Similaridade nunca substitui autoridade.

### Busca

Primeiro implementar SQLite FTS5 com filtros por projeto, tipo, estado, tarefa e período. A busca semântica pode entrar depois, sempre mostrando fonte e versão e nunca misturando silenciosamente conteúdo vigente e substituído.

## Evidência e frescor

Uma evidência deve registrar:

- o que foi observado;
- quando e em qual ambiente;
- quem observou;
- nível de verificação;
- resultado e exit code, quando aplicável;
- conteúdo ou artefato validado;
- checksum da versão validada.

Estados úteis:

`reported · independently_verified · stale · invalidated`

Se o hash do artefato mudar, o teste continua no histórico, mas deixa claro que não cobre a versão atual. O Axon não precisa executar o teste para manter essa relação.

## Visão geral do projeto

A visão geral deve responder, sem abrir cinco abas:

- qual é o objetivo vigente;
- o que está em andamento;
- qual é o próximo passo exato;
- o que foi concluído recentemente;
- o que está bloqueado ou esperando resposta;
- quais conteúdos ou decisões mudaram;
- qual passagem ainda não foi lida.

Uma linha do tempo unificada pode combinar tarefas concluídas, checkpoints, decisões, conteúdos produzidos e passagens, sempre com filtros por tipo.

## Portabilidade

A Biblioteca exige `ProjectBundle v3`, mantendo importação de v1 e v2. O pacote JSON leve transporta memória textual e metadados. Uma exportação completa em ZIP transporta também anexos por streaming e manifesto de hashes.

## VPS privada

Uma VPS é uma boa evolução depois dos gates de segurança. Ela torna o correio disponível para ferramentas autorizadas em qualquer máquina, mas não conecta uma IA automaticamente: cada cliente ainda precisa de API ou MCP autenticado.

Topologia recomendada para o primeiro piloto:

```text
Navegador humano ─ HTTPS privado ─ Tailscale Serve
                                      │
                                      ▼
                              Axon em 127.0.0.1
                                      │
                                      ▼
                         SQLite + blobs em disco local

IA autorizada ─ token por projeto ─ API autenticada
```

Antes da VPS:

- identidade humana e tokens de agente;
- autoria derivada da credencial, nunca do campo `from`;
- permissões por projeto;
- auditoria sem registrar o conteúdo completo;
- Host, Origin, proxy confiável e CSRF configuráveis;
- rate limiting;
- migrações versionadas;
- inspeção de workspace desativada ou limitada por raízes do operador;
- backup consistente do SQLite e dos blobs;
- restauração automatizada e testada;
- build de produção que não dependa de `devDependencies`;
- MCP remoto somente por Streamable HTTP autenticado.

SQLite continua adequado para uma VPS e uma instância do Axon. PostgreSQL só passa a fazer sentido quando houver múltiplas instâncias, alto volume de escrita concorrente ou colaboração multiusuário mais complexa.

## Fases recomendadas

### Fase 0 — corrigir continuidade

- marcador geral consistente e audiência explícita planejada;
- retomada por tarefa;
- estados `blocked` e `done` declarado;
- leitura separada de resolução;
- rascunho de emergência com CAS;
- saída atômica e idempotente;
- intenção opcional na reserva e aviso de sobreposição;
- schemas e limites compartilhados.

### Fase 1 — memória canônica

- Charter versionado;
- decisões com validade;
- bloqueios e perguntas com ciclo de vida;
- tarefa com aceite, dependências e entradas;
- um único ContextEnvelope.

### Fase 2 — Biblioteca

- itens, revisões, relações e anexos;
- aba Biblioteca em largura total;
- vínculos com backlog, tarefas e checkpoints;
- FTS5 e navegação do Ctrl+K até o item;
- Bundle v3.

### Fase 3 — confiança e mudança

- evidência ligada a versões e hashes;
- marcação de conteúdo e teste desatualizados;
- registro da revisão de contexto recebida por cada IA;
- visão “o que mudou desde a última vez”.

### Fase 3.5 — linha do tempo operacional

- combinar tarefas, checkpoints, decisões, conteúdos produzidos e passagens em eventos reais;
- mostrar a sequência bastão → checkpoint → passagem → leitura → próximo checkpoint;
- permitir filtrar por tarefa, agente e tipo de evento;
- nunca usar a linha do tempo para sugerir que uma IA executou uma ação que não foi registrada.

### Fase 4 — VPS privada

- autenticação, tokens, escopos, auditoria e backup;
- piloto com Tailscale Serve;
- API remota autenticada;
- MCP Streamable HTTP em etapa posterior.

### Fase 5 — inteligência auxiliar

- detecção explicável de decisões conflitantes;
- busca semântica com citação obrigatória;
- sugestões de conteúdo ausente;
- modelos de Charter por tipo de projeto;
- comparação de retomadas e qualidade do contexto.

## Métricas úteis

- tempo entre abrir a retomada e iniciar uma ação correta;
- número de perguntas repetidas após troca de IA;
- tarefas reabertas por contexto incorreto;
- itens omitidos ou truncados no briefing;
- decisões conflitantes ainda vigentes;
- evidências que não cobrem a versão atual;
- passagens lidas e ainda não resolvidas.

O objetivo dessas métricas é revelar lacunas concretas. Elas não devem virar pontuação decorativa ou promessa de que o sistema “entendeu” o projeto.

## Princípios que não mudam

- O Axon continua sendo correio e memória; não controla modelos.
- Conteúdo recuperado continua sendo dado não confiável.
- Aprovação humana, autoria de agente e verificação do sistema permanecem estados distintos.
- Histórico imutável não é reescrito para combinar com o estado atual.
- Toda inteligência precisa mostrar fonte, versão, validade e motivo da seleção.
