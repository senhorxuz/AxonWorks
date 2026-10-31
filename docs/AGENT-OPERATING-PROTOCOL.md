# AXON Works — protocolo operacional entre IAs

> **Status da Especificação e Entregas do Sistema:**
> 
> **Recursos Entregues e Operacionais no Código (`server/` e `shared/`):**
> - **Charter Versionado:** Governança com revisões imutáveis e verificação CAS.
> - **Decisões Canônicas:** Ciclo completo (propor, aceitar, revogar, substituir via `supersedesId`), detecção de conflitos e validação de ciclos acíclicos.
> - **Bloqueios e Incertezas:** Gestão de bloqueios com resolução, reabertura auditada e linha do tempo de eventos.
> - **Biblioteca de Conteúdo com SQLite FTS5:** Revisões de documentos, relacionamentos polimórficos (`supports`, `contradicts`, `implements`, `references`) e avaliação algorítmica de frescor.
> - **Contratos de Tarefa & Intenção:** Critérios de aceite, dependências acíclicas, saídas esperadas e sobreposição de áreas de intenção.
> - **Rascunhos de Emergência (`work_drafts`):** Salvamento não canônico tolerante a falhas com descarte atômico.
> - **Finalização Composta (`finalize_work`):** Transação atômica que une checkpoint, passagem, transição de tarefa e descarte de rascunho.
> - **Evidências Verificáveis Honestamente:** Três afirmações dissociadas (`agent_reported`, `cross_checked`, `artifact_bound`), rejeição de auto-conferência e advertência explícita de frescor desatualizado.
> 
> **Trabalho Futuro (Roadmap):**
> - Publicação em domínio aberto com federação multi-instância além de rede Tailscale.
> - Assinatura digital por hardware de dispositivos de borda para atestação de proveniência de fatos.
> - Orquestração delegada mantendo o invariante fundamental: o AXON permanece sendo um correio de continuidade, não um executor de modelos.

## Finalidade

O AXON é um correio de continuidade para IAs que trabalham fora dele. Uma IA lê o estado compartilhado, executa o trabalho no ambiente autorizado pelo usuário e deixa um registro durável para a próxima.

O AXON não inicia modelos, não controla terminais, não bloqueia arquivos e não decide sozinho qual IA deve trabalhar. Sua inteligência está em organizar, selecionar e explicar o contexto certo.

O protocolo deve reduzir três falhas:

1. repetir trabalho que já foi feito;
2. continuar a tarefa errada ou a partir de contexto de outra tarefa;
3. perder decisões, bloqueios e resultados quando uma sessão acaba.

## Modelo mental

- **Projeto:** a sala onde todo o contexto vive.
- **Backlog:** ideias e trabalhos futuros ainda não assumidos.
- **Tarefa:** uma unidade de trabalho que pode ser reservada por uma IA.
- **Reserva:** um aviso temporário de que uma IA pretende trabalhar naquela tarefa.
- **Checkpoint:** uma fotografia imutável do estado relatado em um momento.
- **Passagem:** o bilhete preso ao checkpoint para a próxima IA.
- **Rascunho:** um salvamento de emergência ainda não entregue.
- **Biblioteca:** os materiais organizados e versionados do projeto.
- **Atenção:** perguntas, bloqueios e pedidos de revisão que continuam abertos até resolução explícita.

## O núcleo mínimo

O primeiro upgrade não cria uma entidade `WorkSession`. A reserva da tarefa continua sendo o único mecanismo de coordenação de posse. Isso evita dois relógios concorrentes e respostas ambíguas sobre quem está trabalhando.

O núcleo é:

1. tarefa com reserva, prazo e CAS por `version`;
2. checkpoint imutável com CAS por `revision`;
3. passagem vinculada a um checkpoint;
4. confirmação de leitura criada pelo destinatário;
5. briefing específico para a tarefa em foco;
6. rascunho de emergência claramente não canônico;
7. finalização composta, atômica e idempotente.

## Identidade e confiança

No modo local atual, nomes como `Astra`, `Gemini` e `Grok` são declarados pelo cliente. A interface e as exportações devem usar expressões como “relatado por” e nunca apresentar esse nome como identidade comprovada.

Na VPS, o servidor deriva `actorId` da credencial. Campos como `agent`, `from` e `createdBy` não podem conceder autoridade.

Três coisas permanecem separadas:

- **relato do agente:** a IA afirma que fez ou observou algo;
- **aprovação humana:** o usuário aceitou uma decisão ou entrega;
- **verificação autorizada:** um mecanismo autorizado observou um resultado.

Um relato nunca sobe de nível sozinho.

## Fluxo de entrada

### 1. Descobrir o projeto

A IA usa busca ou listagem e escolhe um `projectId` real. IDs nunca são adivinhados.

### 2. Pedir a retomada

O briefing aceita `actorId` e `taskId` opcional.

Se `taskId` for informado, o AXON retorna separadamente:

- objetivo e revisão do Charter;
- tarefa, critérios de aceite e dependências;
- último checkpoint da tarefa;
- último checkpoint geral do projeto;
- mudanças de outras tarefas desde o checkpoint da tarefa;
- passagens destinadas ao ator;
- perguntas, bloqueios e revisões ainda abertos;
- materiais obrigatórios e essenciais da Biblioteca;
- itens omitidos por limite de tamanho.

Se `taskId` não for informado, o AXON oferece tarefas reservadas pelo ator, tarefas disponíveis e visão geral. Ele não escolhe silenciosamente a primeira tarefa.

### 3. Ler e confirmar

A IA confirma apenas mensagens e passagens que realmente leu. Abrir o briefing não cria recibos em lote.

Ler não resolve pergunta, bloqueio ou pedido de revisão.

### 4. Reservar a tarefa

`claim_task` continua usando `expectedVersion` e prazo limitado. Uma reserva:

- comunica intenção;
- impede outra reserva válida durante o prazo;
- não trava o editor;
- não trava o sistema de arquivos;
- não prova que a IA está executando algo;
- não impede uma ferramenta externa de alterar o mesmo recurso.

## Intenção de trabalho

A reserva pode receber um bloco opcional e pequeno:

```ts
interface WorkIntent {
  objective: string
  areas: Array<{
    kind: 'file_path' | 'content_item' | 'design_asset' | 'dataset' | 'external_system' | 'other'
    locator: string
    access: 'read' | 'write'
  }>
  expectedOutputs: string[]
  plannedChecks: string[]
}
```

Isso é uma declaração de intenção, não um lock. O AXON pode avisar quando duas tarefas reservadas declaram escrita em áreas iguais ou sobrepostas. O aviso informa o conflito possível e deixa a decisão para os agentes e para o usuário.

O modelo funciona também em projetos sem Git. Commit, hash e snapshot podem aparecer como referências opcionais, nunca como requisito universal.

## Durante o trabalho

A IA pode:

- renovar a reserva apresentando a versão atual;
- registrar checkpoint incremental sem encerrar o trabalho;
- enviar pergunta ou aviso;
- propor decisão;
- criar ou relacionar material da Biblioteca;
- atualizar o rascunho de emergência.

O AXON não interpreta silêncio como progresso. A única presença operacional é uma reserva válida, e mesmo ela significa apenas intenção declarada.

## Rascunho de emergência

O rascunho protege trabalho longo contra encerramento inesperado da sessão.

```ts
interface WorkDraft {
  projectId: string
  actorId: string
  taskId: string | null
  version: number
  summary: string
  nextAction: string
  changedAreas: string[]
  openIssues: string[]
  observedChecks: Array<{
    commandOrMethod: string
    reportedOutcome: string
  }>
  updatedAt: string
}
```

Regras:

- existe no máximo um rascunho por projeto, ator e tarefa;
- atualização usa CAS por `version`;
- não incrementa a revisão do projeto;
- não vira checkpoint automaticamente;
- não cria passagem nem confirmação de leitura;
- aparece como “rascunho não entregue”;
- nunca substitui `latestCheckpoint`;
- pode ser descartado ou incorporado explicitamente numa finalização.

Na VPS, `actorId` vem da credencial. No modo local, autoria continua declarada.

## Encerramento do trabalho

Checkpoints incrementais continuam disponíveis. Para a saída da IA, existe uma operação de conveniência futura chamada `finalize_work`.

Ela executa numa única transação:

1. cria um checkpoint;
2. incrementa uma vez a revisão do projeto;
3. cria uma passagem opcional vinculada ao checkpoint;
4. aplica uma transição explícita da tarefa;
5. relaciona somente conteúdos que já existem;
6. limpa o rascunho correspondente, quando solicitado.

A transição nunca é inferida:

```ts
type FinalTaskTransition =
  | { kind: 'keep_claimed' }
  | { kind: 'release' }
  | { kind: 'declare_blocked'; reason: string }
  | { kind: 'declare_done' }
```

`declare_done` significa “concluído segundo o agente” e exige `completionCheckpointId`. Isso não representa aprovação humana nem verificação independente.

A passagem é opcional para permitir uma nota final sem destinatário. Quando existe, seu autor precisa coincidir com o autor declarado do checkpoint no modo local ou com a identidade autenticada na VPS.

### Idempotência

A chave cobre checkpoint, passagem, transição da tarefa, relações de conteúdo e descarte do rascunho.

- mesma chave e mesmo payload: devolve os mesmos IDs;
- mesma chave e payload diferente: `409 idempotency_conflict`;
- falha em qualquer escrita: nenhuma parte é persistida.

### Operações que permanecem separadas

Estas ações nunca fazem parte da finalização:

- confirmação de leitura;
- resolução de pergunta, bloqueio ou revisão;
- aprovação humana;
- verificação independente de evidência;
- criação de um novo item ou nova revisão da Biblioteca;
- inspeção de Git ou do workspace.

## Estados de tarefa

### Primeira evolução

```text
todo → in_progress → blocked
                   → done
```

- `todo`: disponível;
- `in_progress`: possui reserva válida ou teve trabalho iniciado;
- `blocked`: impedimento aberto e referenciado;
- `done`: conclusão declarada, sempre ligada ao checkpoint de conclusão.

Reabrir uma tarefa concluída cria evento auditável e nova versão. Bloquear deve declarar se a reserva será mantida ou liberada.

### Evolução posterior

`in_review` e `cancelled` entram somente quando existirem transições completas, responsável pela revisão, motivo, efeito sobre a reserva e reabertura auditável. Até lá, revisão é um pedido de atenção ligado ao checkpoint ou conteúdo.

## Atenção: leitura e resolução

Mensagens simples podem apenas ser lidas. Perguntas, bloqueios e pedidos de revisão possuem ciclo de vida.

```ts
type AttentionStatus = 'open' | 'resolved' | 'withdrawn'

interface AttentionResolution {
  resolvedBy: string
  resolvedAt: string
  responseMessageId?: string
  checkpointId?: string
  contentRevisionId?: string
  note?: string
}
```

Resolver exige uma referência ou explicação concreta. O item continua no histórico depois de sair da lista de atenção.

## Decisões

Decisões propostas por IA não substituem silenciosamente regras anteriores. Cada decisão possui estado, autoridade, fonte e linhagem:

```text
proposed → accepted → superseded
                    → revoked
```

- IA pode propor;
- usuário pode aceitar ou revogar;
- uma nova decisão aponta para a anterior que substitui;
- briefing usa por padrão a decisão vigente e preserva o histórico.

## Compilador de contexto

UI, API, MCP, Markdown e exportação devem usar o mesmo `ContextEnvelope`.

### Ordem determinística

1. objetivo e diretivas humanas vigentes;
2. tarefa em foco, aceite e dependências;
3. último checkpoint da tarefa;
4. passagens não lidas para o ator;
5. perguntas, bloqueios e revisões abertas;
6. conteúdos essenciais e entradas da tarefa;
7. decisões vigentes que afetam a tarefa;
8. mudanças globais posteriores relevantes;
9. evidências relacionadas à versão selecionada;
10. histórico recente que couber no orçamento.

O corte ocorre apenas entre entidades completas. A resposta informa contagem por categoria do que ficou de fora. Nenhum texto é cortado de modo a parecer completo quando não está.

Cada item explica:

- fonte e revisão;
- autoria ou proveniência;
- autoridade;
- validade;
- motivo da inclusão;
- relação com a tarefa em foco.

Conteúdo substituído não aparece como vigente. Similaridade textual nunca supera uma diretiva humana ou uma revisão mais nova.

## Padrões de colaboração

### Passagem sequencial

1. A reserva a tarefa.
2. A trabalha e registra checkpoint.
3. A finaliza, cria passagem para B e libera ou declara conclusão.
4. B lê, confirma a passagem e reserva o próximo trabalho.

### Trabalho paralelo

1. Cada IA reserva uma tarefa diferente.
2. Cada reserva declara áreas de escrita.
3. O AXON avisa sobre sobreposição possível.
4. Cada checkpoint permanece ligado à sua tarefa.
5. Uma passagem de integração reúne dependências entre os resultados.

O aviso de sobreposição não promete isolamento. Quando isolamento real for necessário, o ambiente externo usa branches, worktrees, cópias ou outro mecanismo adequado.

### Implementação e revisão

1. Implementador entrega checkpoint e pede revisão.
2. Revisor lê a revisão exata e registra observações.
3. Pedido continua aberto até resposta ou checkpoint de correção.
4. Aprovação do revisor é autoria declarada no modo local.

### Pesquisa e síntese

Pesquisadores podem produzir conteúdos separados na Biblioteca. O sintetizador referencia as revisões usadas e registra divergências, em vez de fundir afirmações sem origem.

### Arbitragem humana

O usuário decide quando há conflito entre diretivas, mudanças destrutivas, alteração de escopo ou duas soluções incompatíveis. O AXON organiza as opções e suas fontes; não inventa consenso.

## Interface desktop

A visão geral deve mostrar apenas fatos operacionais:

- **Agora:** tarefas reservadas, responsável declarado e prazo;
- **Próxima ação:** próximo passo da tarefa em foco;
- **Atenção:** perguntas, bloqueios e revisões abertos;
- **Chegou para você:** passagens ainda não lidas;
- **Mudou recentemente:** checkpoints, decisões e conteúdos;
- **Rascunho não entregue:** quando existir, com data e autoria;
- **Possível sobreposição:** áreas declaradas por tarefas paralelas.

Não usar indicadores fictícios de “IA online”, progresso automático, compreensão, conexão ou qualidade calculada. Mostrar a causa concreta de cada aviso.

## Falhas e recuperação

| Falha | Detecção | Recuperação |
|---|---|---|
| IA cai antes do checkpoint | rascunho recente e reserva expirada | próxima IA lê o rascunho como não entregue e valida o estado real |
| duas IAs tentam reservar a mesma tarefa | CAS e lease | uma recebe conflito, relê e escolhe outra ação |
| tarefas diferentes declaram a mesma área | comparação de intenções | aviso de sobreposição e coordenação humana/agente |
| retry após timeout | chave de idempotência | devolver resultado anterior ou conflito de payload |
| tarefa recebe checkpoint de outra tarefa | vínculo e seleção por `taskId` | rejeitar vínculo inválido e separar checkpoint da tarefa/global |
| pergunta é lida e esquecida | `readAt` sem `resolvedAt` | manter na atenção até resolução explícita |
| evidência cobre versão antiga | relação com artefato/revisão | marcar como desatualizada sem apagar o histórico |
| cliente assina como outro agente | autoria declarada no local | exibir como relato; na VPS derivar identidade da credencial |

## Invariantes testáveis

1. Uma tarefa possui no máximo uma reserva ativa.
2. Duas tentativas concorrentes com a mesma versão produzem um único vencedor.
3. Cada checkpoint válido incrementa a revisão exatamente uma vez.
4. `finalize_work` persiste tudo ou nada.
5. Retry idempotente não duplica checkpoint, passagem, transição nem revisão.
6. Confirmação de leitura nunca resolve um item de atenção.
7. Rascunho nunca aparece como checkpoint canônico.
8. Contexto de tarefa nunca usa checkpoint de outra tarefa como se fosse dela.
9. Evidência enviada por agente continua `agent_report`.
10. O orçamento de contexto corta somente entre itens e relata omissões.
11. Decisão substituída não aparece como vigente.
12. Operação de finalização nunca cria recibo de leitura.

## TDD e avaliação

Regras de domínio seguem RED, GREEN e refatoração com evidência real da falha anterior.

### Base dos testes

- relógio virtual injetável;
- SQLite temporário novo por teste;
- concorrência real entre duas conexões quando a regra for concorrente;
- pontos de falha injetáveis dentro de transações compostas;
- comparação estrutural, sem LLM como juiz;
- fixtures sem dados reais de usuários.

### Três provas de continuidade

#### C1 — o bastão chega utilizável

A reserva T, grava checkpoint C com próximo passo S, cria passagem D para B e libera T. O briefing de B precisa trazer D não lida, C como último checkpoint de T, S como próxima ação e T disponível. Confirmar D duas vezes produz um único recibo.

#### C2 — o estado antigo não vence

Enquanto a reserva de A estiver válida, B não reserva T. Depois da liberação ou expiração, B reserva usando a versão atual. Uma escrita atrasada de A usando revisão antiga falha com `revision_conflict`.

#### C3 — queda e repetição não duplicam

Uma finalização com chave K cria exatamente um checkpoint, uma passagem opcional, uma transição e um incremento de revisão. Repetir K com o mesmo payload devolve os mesmos IDs. Payload diferente falha. Se apenas o rascunho existir, a revisão permanece inalterada.

### Métricas de produto

- tempo até a primeira ação correta depois da troca;
- perguntas repetidas por falta de contexto;
- tarefas reabertas por contexto incorreto;
- conflitos de área detectados antes da entrega;
- passagens lidas ainda com atenção aberta;
- itens omitidos no briefing;
- evidências ligadas a versões antigas.

Essas métricas revelam lacunas. Elas não viram uma nota decorativa de inteligência.

## Ordem de implementação

### Etapa 0 — reparar a base

1. unificar o destinatário geral (`*` no contrato atual, tipo explícito depois);
2. fazer a retomada aceitar tarefa e separar checkpoint da tarefa/global;
3. alinhar limites e schemas entre domínio, HTTP e MCP;
4. preservar itens de atenção depois da leitura.

### Etapa 1 — saída segura

1. rascunho com CAS;
2. `finalize_work` transacional e idempotente;
3. estados `blocked` e `done` declarado;
4. resolução referenciada;
5. intenção opcional na reserva e aviso de sobreposição.

### Etapa 2 — memória canônica

1. Charter versionado;
2. decisões com linhagem;
3. bloqueios e perguntas persistentes;
4. critérios de aceite, dependências e saídas nas tarefas;
5. `ContextEnvelope` único.

### Etapa 3 — Biblioteca

1. itens, revisões e relações;
2. vínculos com backlog, tarefas e checkpoints;
3. busca FTS5;
4. Bundle v3;
5. anexos endereçados por hash.

### Etapa 4 — VPS privada

1. identidade e permissões por projeto;
2. autoria derivada da credencial;
3. backup e restauração testados;
4. HTTPS privado e rate limiting;
5. API autenticada;
6. MCP remoto autenticado depois do piloto.

### Etapa 5 — inteligência auxiliar

1. “o que mudou desde a última leitura”;
2. conflitos de decisão explicáveis;
3. conteúdo possivelmente desatualizado;
4. busca semântica com fonte e revisão;
5. sugestões de lacunas sem alteração automática do estado.

## O que fica de fora

- chat autônomo entre modelos;
- agentes residentes;
- filas que iniciam IAs;
- controle remoto de execução;
- lock de arquivos pelo AXON;
- presença online inventada;
- conclusão ou teste verificado apenas porque uma IA afirmou;
- busca semântica antes da memória canônica e da busca literal;
- estados de tarefa sem transições completas.

O AXON será inteligente quando entregar menos contexto, porém o contexto certo, com origem, validade e próxima ação claras.

