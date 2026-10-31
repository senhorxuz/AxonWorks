# Processo e Estratégia de Testes — Axon Works

Este documento define a estratégia canônica de qualidade, a pirâmide de testes automatizados, os critérios de aceitação e os portões de verificação (quality gates) da **Axon Works**.

---

## 1. Métricas Canônicas Atuais

| Categoria | Suítes | Testes | Status | Tempo Típico |
| :--- | :---: | :---: | :---: | :---: |
| **Testes Unitários & Integração** | 42 | **263** | ✅ 100% Passando | ~18s |
| **Testes E2E (Playwright)** | 1 | **25** | ✅ 100% Passando | ~2.4m |
| **Compilação TypeScript / Vite** | — | — | ✅ 0 Erros / 0 Avisos | ~350ms |
| **Auditoria Judicial de Integridade** | — | — | ✅ Aprovado com Louvor | — |

---

## 2. Pirâmide de Testes e Cobertura por Domínio

A arquitetura de testes da Axon Works é dividida em cinco camadas principais, todas operando de forma 100% local e determinística sobre instâncias isoladas de SQLite em memória ou em diretórios temporários descartáveis.

```
                  ┌──────────────────────┐
                  │    25 Testes E2E     │  Navegador Real (Playwright)
                  │ (Desktop + Mobile)   │  Fluxos completos de ponta a ponta
                  └──────────┬───────────┘
                             │
             ┌───────────────┴───────────────┐
             │    Testes de HTTP REST e MCP  │  Validação de Schemas, Headers,
             │  (Rotas Express + Ferramentas)│  Auth e Não-Vazamento de Erros
             └───────────────┬───────────────┘
                             │
     ┌───────────────────────┴───────────────────────┐
     │         Testes de Domínio e Algoritmos        │  Portabilidade v3 (52 testes)
     │   (Graph BFS, Backup Engine, Scrypt/RBAC,     │  Backups & Drills (8 testes)
     │      Two-Phase Insertion, Cycle Detection)    │  Auth & RBAC (7 testes)
     └───────────────────────┬───────────────────────┘  Grafo & Conflitos (6 testes)
                             │
 ┌───────────────────────────┴───────────────────────────┐
 │            Testes de Persistência SQLite             │  Integridade Relacional,
 │    (WorkspaceStore, WAL Checkpoints, FTS5, CAS)      │  Transações Atômicas, Locks
 └───────────────────────────────────────────────────────┘
```

---

### 2.1. Domínio Central e Persistência
- **Arquivos:** `tests/store.test.ts`, `tests/tasks.test.ts`, `tests/checkpoints.test.ts`, `tests/messages.test.ts`, `tests/content.test.ts`, etc.
- **Cenários Cobertos:**
  - Persistência e integridade relacional ao fechar e reabrir o banco SQLite.
  - Concorrência de posse de tarefas via compare-and-swap (CAS) por `version`. Exatamente um vencedor em disputas simultâneas (conflito 409).
  - Checkpoints imutáveis com CAS por `revision` e chaves de idempotência estáveis.
  - Isolamento entre projetos: tarefas e mensagens de um projeto não são acessíveis por outro.
  - Biblioteca de conteúdos com versionamento imutável e busca full-text SQLite FTS5.

---

### 2.2. Portabilidade e ProjectBundle v3 (52 Testes)
- **Arquivo:** `tests/portability.test.ts`
- **Cenários Cobertos:**
  - **Roundtrips Completos:** Exportação e importação preservando integridade referencial de todos os modelos v1, v2 e v3.
  - **Task Contracts:** Contratos ricos com prioridade (`urgent`, `high`, `normal`, `low`), critérios de aceite estruturados (`id`, `description`, `completed`), saídas esperadas (`locator`) e dependências acíclicas.
  - **Inserção em Duas Fases (`two-phase insertion`):** Resolução de decisões canônicas com substituição mútua sem deadlocks de chave estrangeira no SQLite.
  - **Detecção de Ciclos:** Algoritmo de busca em profundidade (DFS) rejeitando referências cíclicas em dependências de tarefas e substituição de decisões.
  - **Indexação FTS5 Automática:** Reconstrução imediata do índice de busca da Biblioteca ao importar conteúdos.
  - **Sanitização de Segredos:** Mascaramento compulsório (`maskSecrets`) em tokens, chaves de API e URLs com credenciais em todos os campos textuais.
  - **Limites de Tamanho:** Rejeição segura de pacotes serializados que excedam 1 MB (`MAX_BUNDLE_SERIALIZED_BYTES`).
  - **Retrocompatibilidade:** Importação transparente de pacotes legados v1 e v2 com saneamento automático.

---

### 2.3. Backup e Recuperação Automática com Drills (8 Testes)
- **Arquivo:** `tests/backup.test.ts`
- **Cenários Cobertos:**
  - **Snapshot Atômico:** Execução de `store.vacuumInto(...)` com flush prévio `PRAGMA wal_checkpoint(TRUNCATE)`.
  - **Assinatura e Integridade:** Assinatura criptográfica SHA-256 e manifesto de metadados padronizado.
  - **Criptografia Autenticada:** Cifra AES-256-GCM em repouso com IV de 96 bits e tag de autenticação de 128 bits.
  - **Recovery Drills Periódicos:** Validação de recuperação em banco sandbox temporário e isolado (`PRAGMA integrity_check`, `foreign_key_check` e leitura de todos os projetos).
  - **Detecção de Corrupção:** Rejeição imediata de arquivos adulterados ou corrompidos durante o drill.
  - **Restauração com Salvaguarda:** Criação obrigatória de snapshot pré-restauração (`pre-restore-<timestamp>.sqlite`) e substituição atômica do banco de produção.
  - **Retenção Automática:** Política de expurgo de backups antigos sem deixar manifestos órfãos.

---

### 2.4. Autenticação, RBAC e Tokens Revogáveis (7 Testes)
- **Arquivo:** `tests/auth-rbac.test.ts`
- **Cenários Cobertos:**
  - **Segurança de Senhas:** Hashing com Scrypt nativo (salt aleatório de 16 bytes, 64 bytes derivados) e comparação em tempo constante (`crypto.timingSafeEqual`) contra ataques de temporização.
  - **Segredo Zero em Banco:** Tokens gerados com prefixos tipados (`axon_agt_`, `axon_usr_`, `axon_dev_`) e armazenados estritamente como hashes SHA-256 unidirecionais.
  - **RBAC Hierárquico por Projeto:** Validação estrita de permissões (`owner` > `maintainer` > `contributor` > `reader`).
  - **Escopo e Expiração:** Tokens revogáveis com vínculo opcional a um projeto específico e expiração temporal (`expiresAt`).
  - **Auditoria Imutável:** Trilha de eventos sensíveis (`audit_logs`) com mascaramento compulsório de metadados.
  - **Compatibilidade Retroativa:** Suporte a modo loopback local via header `X-Workspace-Client: local` e modo estrito `AXON_REQUIRE_AUTH=1`.

---

### 2.5. Grafo de Decisões, Conteúdos e Análise de Impacto (6 Testes)
- **Arquivo:** `tests/graph-analysis.test.ts`
- **Cenários Cobertos:**
  - **Grafo Unificado:** Extração e consolidação de nós (`decision`, `content`, `task`, `blocker`) e arestas relacionais tipadas (`supersedes`, `contradicts`, `supports`, `implements`, `depends_on`, `blocks`).
  - **Detecção de Conflitos de Decisão:** Identificação determinística de contradições diretas, sobreposição léxica de Jaccard sem substituição formal, decisões zumbis e ciclos de linhagem.
  - **Detecção de Conteúdos Desatualizados:** Diagnóstico de conteúdos que dependem de decisões revogadas ou substituídas, ou que contradizem diretrizes vigentes.
  - **Análise de Alcance e Raio de Impacto (Blast Radius):** Busca em largura (BFS) a jusante calculando caminhos topológicos, distâncias (`d=1`, `d=2`), entidades impactadas e nível de risco global (`high`, `medium`, `low`).
  - **Exposição REST e MCP:** Validação de chamadas HTTP e ferramentas MCP em memória (`get_project_graph`, `detect_decision_conflicts`, `detect_stale_content`, `analyze_graph_impact`).

---

### 2.6. Testes E2E no Navegador Real com Playwright (25 Testes)
- **Arquivo:** `tests/ui.spec.ts`
- **Cenários Cobertos:**
  - Jornada completa de onboarding: criação de projeto, definição de objetivos e charter.
  - Ciclo de trabalho: criação de tarefas, reservas com lease, checkpoints com evidências, passagens entre agentes e mensageria.
  - Gestão de biblioteca: criação de documentos versionados, relações e busca em texto.
  - **Camada Visual do Grafo & Inteligência:**
    - Exibição e atualização dos 4 cartões KPI no topo.
    - Navegação em swimlanes por tipo de nó (`decisions`, `library`, `tasks`, `blockers`).
    - Filtros dinâmicos por tipo e busca textual em tempo real.
    - Inspetor de nós lateral com acionamento sob demanda da Análise de Impacto (BFS).
    - Abas de diagnósticos de Conflitos de Decisão e Frescor de Biblioteca.
  - **Visão Explicável de Mudanças (`OperationalChangelog`):**
    - Renderização da comparação temporal entre revisões ($r_N$ vs $r_{N-1}$).
    - Exibição de tarefas concluídas, decisões formuladas e bloqueios resolvidos.
    - Cópia instantânea do relatório estruturado em Markdown.
  - **Responsividade e Acessibilidade:**
    - Layout Desktop e Mobile (390px) sem quebras ou overflow horizontal.
    - Navegação por teclado, foco visível e fechamento de diálogos com `Escape`.

---

## 3. Portões de Qualidade (Quality Gates)

Todo ciclo de desenvolvimento e commit na Axon Works deve passar pelos três portões de qualidade sem nenhuma exceção:

### 1. Portão de Tipos e Build
```bash
npm run build
```
- Valida tipos TypeScript em modo estrito (`tsc --noEmit`).
- Compila a aplicação frontend com Vite.
- **Critério:** 0 erros de compilação e 0 avisos bloqueantes.

### 2. Portão de Testes Unitários e Integração
```bash
npm test
```
- Executa os 263 testes de lógica de negócio, domínio, persistência, criptografia, grafos e HTTP/MCP.
- **Critério:** 263/263 testes aprovados com 0 falhas e 0 testes pulados.

### 3. Portão de Testes End-to-End
```bash
npm run test:e2e
```
- Dispara os 25 cenários automatizados do Playwright em navegadores headless.
- **Critério:** 25/25 testes aprovados.

### Comando Consolidado de Verificação
```bash
npm run check
```
- Executa a sequência completa (`build` -> `test` -> `test:e2e`).

---

## 4. Princípios Invioláveis dos Testes

1. **Isolamento de Estado:** Jamais executar testes sobre arquivos de banco de dados SQLite de produção ou dados reais do usuário. Todos os testes utilizam `:memory:` ou diretórios temporários criados em tempo de execução e limpos no encerramento (`afterEach` / `afterAll`).
2. **Determinismo Absoluto:** Nenhum teste pode depender de serviços externos, redes públicas, provedores de IA ou relógios imprevisíveis. Datas e latências são controladas por injeção de dependência.
3. **Zero Custo Financeiro:** Nenhuma chamada para provedores proprietários de LLM é realizada durante os testes. A Axon Works é um sistema de governança e memória compartilhada, não um executor de modelos.
4. **Resistência a Timing Attacks:** Testes de autenticação validam explicitamente que a comparação de hashes de senhas e tokens utiliza `crypto.timingSafeEqual`.
5. **Sanitização Compulsória:** Testes de exportação e auditoria garantem que strings com formatos de chaves privadas, segredos ou tokens de autenticação são mascarados antes de qualquer persistência em logs ou bundles portáveis.
