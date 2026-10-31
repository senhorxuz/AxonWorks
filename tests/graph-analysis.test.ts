import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { createMcpServer } from '../server/mcp-tools.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type {
  ProjectGraph,
  DecisionConflictReport,
  StaleContentReport,
  GraphImpactReport,
} from '../shared/graph.js';

describe('Etapa 4 — Grafo de Decisões e Conteúdos, Detecção de Conflitos e Invalidação/Frescor', () => {
  const cleanups: Array<() => void> = [];

  function createTempEnv() {
    const dir = mkdtempSync(path.join(tmpdir(), 'axon-graph-test-'));
    const dbPath = path.join(dir, 'live.sqlite');
    cleanups.push(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });
    return { dir, dbPath };
  }

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()!();
    }
  });

  test('construção do grafo: nós tipados, arestas direcionadas, filtragem e estatísticas', () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const project = store.createProject({
      name: 'Projeto Grafo Alpha',
      objective: 'Validar construção do grafo de conhecimento',
    });

    // 1. Decisões
    const dec1 = store.proposeDecision(project.id, {
      agent: 'Architect',
      title: 'Decisão 1: SQLite com WAL',
      body: 'Utilizar SQLite local como motor de persistência padrão.',
    });
    const acceptedDec1 = store.acceptDecision(project.id, dec1.id, {
      actor: 'Human Lead',
      expectedVersion: dec1.version,
    });

    const dec2 = store.supersedeDecision(project.id, dec1.id, {
      actor: 'Architect',
      expectedVersion: acceptedDec1.version,
      title: 'Decisão 2: SQLite WAL com Chkpt Atômico',
      body: 'Evolução da persistência com checkpoint explícito e vacuum.',
    });

    // 2. Conteúdos da Biblioteca
    const content1 = store.createContent(project.id, {
      title: 'Especificação de Armazenamento',
      kind: 'specification',
      body: 'Documento descrevendo os detalhes de implementação do SQLite WAL.',
      createdBy: 'Tech Writer',
      sourceKind: 'human_directive',
      declaredValidity: 'current',
    });

    const content2 = store.createContent(project.id, {
      title: 'Benchmark de Disco',
      kind: 'research',
      body: 'Resultados de I/O em disco SSD.',
      createdBy: 'Benchmarker',
      sourceKind: 'agent_report',
      declaredValidity: 'current',
    });

    // Relação: content1 apoia dec2
    store.addContentRelation(project.id, {
      sourceRevisionId: content1.revision.id,
      targetType: 'decision',
      targetId: dec2.id,
      kind: 'supports',
      createdBy: 'Tech Writer',
    });

    // Relação: content1 referencia content2
    store.addContentRelation(project.id, {
      sourceRevisionId: content1.revision.id,
      targetType: 'content',
      targetId: content2.item.id,
      kind: 'related',
      createdBy: 'Tech Writer',
    });

    // 3. Tarefas com dependência
    const task1 = store.createTask(project.id, {
      title: 'Implementar Engine de Armazenamento',
      priority: 'high',
    });
    const task2 = store.createTask(project.id, {
      title: 'Configurar Backups Periódicos',
      priority: 'medium',
      dependencyTaskIds: [task1.id],
    });

    // 4. Bloqueio vinculado à tarefa
    const blocker = store.openBlocker(project.id, {
      agent: 'Security Auditor',
      title: 'Permissões de Diretório Insuficientes',
      body: 'Diretório de dados sem permissão de escrita para o serviço.',
      taskId: task1.id,
    });

    // Obter grafo completo
    const graph = store.getProjectGraph(project.id);

    assert.equal(graph.projectId, project.id);
    assert.equal(graph.stats.totalNodes, 7);
    assert.equal(graph.nodes.length, 7);
    assert.equal(graph.stats.nodesByType.decision, 2);
    assert.equal(graph.stats.nodesByType.content, 2);
    assert.equal(graph.stats.nodesByType.task, 2);
    assert.equal(graph.stats.nodesByType.blocker, 1);

    // Validar arestas
    const supersedesEdge = graph.edges.find((e) => e.kind === 'supersedes');
    assert.ok(supersedesEdge);
    assert.equal(supersedesEdge.fromNodeId, dec2.id);
    assert.equal(supersedesEdge.toNodeId, dec1.id);

    const taskDepEdge = graph.edges.find((e) => e.kind === 'depends_on');
    assert.ok(taskDepEdge);
    assert.equal(taskDepEdge.fromNodeId, task2.id);
    assert.equal(taskDepEdge.toNodeId, task1.id);

    const blockerEdge = graph.edges.find((e) => e.kind === 'blocks');
    assert.ok(blockerEdge);
    assert.equal(blockerEdge.fromNodeId, blocker.id);
    assert.equal(blockerEdge.toNodeId, task1.id);

    const supportsEdge = graph.edges.find((e) => e.kind === 'supports');
    assert.ok(supportsEdge);
    assert.equal(supportsEdge.fromNodeId, content1.item.id);
    assert.equal(supportsEdge.toNodeId, dec2.id);

    // Filtrar apenas nós de decisão e conteúdo
    const filteredGraph = store.getProjectGraph(project.id, {
      nodeTypes: ['decision', 'content'],
    });
    assert.equal(filteredGraph.nodes.length, 4);
    assert.ok(filteredGraph.nodes.every((n) => n.type === 'decision' || n.type === 'content'));
    assert.ok(filteredGraph.edges.every((e) => e.toNodeType === 'decision' || e.toNodeType === 'content'));

    // Arquivar conteúdo e testar includeArchived: false
    store.archiveContent(project.id, content2.item.id, { expectedVersion: content2.item.version });
    const graphWithoutArchived = store.getProjectGraph(project.id, {
      includeArchived: false,
    });
    assert.equal(graphWithoutArchived.nodes.find((n) => n.id === content2.item.id), undefined);
  });

  test('detecção de conflitos de decisões: contradições explícitas, sobreposições temáticas e aceites zumbis', () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const project = store.createProject({
      name: 'Projeto Conflitos',
      objective: 'Testar detecção precisa de conflitos em decisões',
    });

    // 1. Duas decisões aceitas com sobreposição temática direta sem substituição mútua
    const decA = store.proposeDecision(project.id, {
      agent: 'Auth Team',
      title: 'Autenticação: Sistema de Sessões com Tokens JWT e Cookies Seguros',
      body: 'Adotar JWT assinado em cookies HTTPOnly para autenticação da aplicação web.',
    });
    store.acceptDecision(project.id, decA.id, { actor: 'Lead', expectedVersion: decA.version });

    const decB = store.proposeDecision(project.id, {
      agent: 'Security Team',
      title: 'Autenticação: Sistema de Sessões com Tokens JWT em Cabeçalho Bearer',
      body: 'Utilizar exclusivamente cabeçalho Authorization Bearer com tokens JWT para autenticação das sessões.',
    });
    store.acceptDecision(project.id, decB.id, { actor: 'Lead', expectedVersion: decB.version });

    // 2. Relação de contradição expressa
    const contentContradict = store.createContent(project.id, {
      title: 'RFC Antítese',
      kind: 'note',
      body: 'Documento expondo contradição na diretiva.',
      createdBy: 'Auditor',
      sourceKind: 'agent_report',
    });
    store.addContentRelation(project.id, {
      sourceRevisionId: contentContradict.revision.id,
      targetType: 'decision',
      targetId: decA.id,
      kind: 'contradicts',
      createdBy: 'Auditor',
    });

    const report = store.detectDecisionConflicts(project.id);

    assert.equal(report.projectId, project.id);
    assert.equal(report.acceptedDecisions, 2);
    assert.ok(report.conflictCount >= 2);

    // Contradição direta
    const directConflict = report.conflicts.find((c) => c.type === 'direct_contradiction');
    assert.ok(directConflict);
    assert.equal(directConflict.severity, 'critical');
    assert.ok(directConflict.decisionIds.includes(decA.id));

    // Sobreposição temática
    const overlapConflict = report.conflicts.find((c) => c.type === 'overlapping_accepted_decisions');
    assert.ok(overlapConflict);
    assert.equal(overlapConflict.severity, 'warning');
    assert.ok(overlapConflict.decisionIds.includes(decA.id));
    assert.ok(overlapConflict.decisionIds.includes(decB.id));
  });

  test('detecção de conteúdos desatualizados (stale): decisão revogada, substituída e validade declarada', () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const project = store.createProject({
      name: 'Projeto Frescor de Conteúdo',
      objective: 'Verificar invalidação inteligente de conteúdos obsoletos',
    });

    // Decisão 1: Será revogada
    const decRevoke = store.proposeDecision(project.id, {
      agent: 'Lead',
      title: 'Usar Servidor FTP Legado',
      body: 'Transferir arquivos usando FTP simples.',
    });
    const acceptedDecRevoke = store.acceptDecision(project.id, decRevoke.id, {
      actor: 'Admin',
      expectedVersion: decRevoke.version,
    });

    // Conteúdo 1: Apoia a decisão que será revogada
    const contentRevokedDep = store.createContent(project.id, {
      title: 'Manual de Configuração FTP',
      kind: 'specification',
      body: 'Passo a passo para conectar no FTP.',
      createdBy: 'DevOps',
      sourceKind: 'agent_report',
      declaredValidity: 'current',
    });
    store.addContentRelation(project.id, {
      sourceRevisionId: contentRevokedDep.revision.id,
      targetType: 'decision',
      targetId: decRevoke.id,
      kind: 'supports',
      createdBy: 'DevOps',
    });

    // Revogar a decisão
    store.revokeDecision(project.id, decRevoke.id, {
      actor: 'Security Officer',
      expectedVersion: acceptedDecRevoke.version,
      note: 'Inseguro; uso de FTP proibido pela política de segurança.',
    });

    // Decisão 2: Será substituída
    const decOld = store.proposeDecision(project.id, {
      agent: 'Arch',
      title: 'Versão da API v1',
      body: 'Manter rotas v1 como padrão.',
    });
    const acceptedDecOld = store.acceptDecision(project.id, decOld.id, {
      actor: 'Lead',
      expectedVersion: decOld.version,
    });

    // Conteúdo 2: Apoia a decisão que será substituída
    const contentSupersededDep = store.createContent(project.id, {
      title: 'Guia da API v1',
      kind: 'specification',
      body: 'Documentação dos endpoints v1.',
      createdBy: 'Writer',
      sourceKind: 'human_directive',
      declaredValidity: 'current',
    });
    store.addContentRelation(project.id, {
      sourceRevisionId: contentSupersededDep.revision.id,
      targetType: 'decision',
      targetId: decOld.id,
      kind: 'supports',
      createdBy: 'Writer',
    });

    // Substituir a decisão 2
    store.supersedeDecision(project.id, decOld.id, {
      actor: 'Arch',
      expectedVersion: acceptedDecOld.version,
      title: 'Migração para API v2',
      body: 'Adoção da especificação v2 com GraphQL.',
    });

    // Conteúdo 3: Declarado expressamente como desatualizado
    const contentExplicitOutdated = store.createContent(project.id, {
      title: 'Notas Antigas do Sprint 0',
      kind: 'note',
      body: 'Anotações temporárias de setup.',
      createdBy: 'Dev',
      sourceKind: 'agent_report',
      declaredValidity: 'outdated',
    });

    // Conteúdo 4: Marcado como precisa de revisão
    const contentNeedsReview = store.createContent(project.id, {
      title: 'Matriz de Compatibilidade',
      kind: 'reference',
      body: 'Lista de navegadores suportados.',
      createdBy: 'QA',
      sourceKind: 'agent_report',
      declaredValidity: 'needs_review',
    });

    // Executar análise de frescor
    const report = store.detectStaleContent(project.id);

    assert.equal(report.projectId, project.id);
    assert.equal(report.staleCount, 4);

    // 1. Dependência de decisão revogada -> crítico
    const revokedItem = report.items.find((i) => i.itemId === contentRevokedDep.item.id);
    assert.ok(revokedItem);
    assert.equal(revokedItem.reasonCode, 'dependency_decision_revoked');
    assert.equal(revokedItem.severity, 'critical');
    assert.equal(revokedItem.relatedEntity?.id, decRevoke.id);

    // 2. Dependência de decisão substituída -> warning
    const supersededItem = report.items.find((i) => i.itemId === contentSupersededDep.item.id);
    assert.ok(supersededItem);
    assert.equal(supersededItem.reasonCode, 'dependency_decision_superseded');
    assert.equal(supersededItem.severity, 'warning');
    assert.equal(supersededItem.relatedEntity?.id, decOld.id);

    // 3. Declarado outdated -> crítico
    const outdatedItem = report.items.find((i) => i.itemId === contentExplicitOutdated.item.id);
    assert.ok(outdatedItem);
    assert.equal(outdatedItem.reasonCode, 'declared_outdated');
    assert.equal(outdatedItem.severity, 'critical');

    // 4. Declarado needs_review -> warning
    const reviewItem = report.items.find((i) => i.itemId === contentNeedsReview.item.id);
    assert.ok(reviewItem);
    assert.equal(reviewItem.reasonCode, 'declared_needs_review');
    assert.equal(reviewItem.severity, 'warning');
  });

  test('análise de impacto (reachability): propagação em cascata e avaliação de risco de alteração', () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const project = store.createProject({
      name: 'Projeto Análise de Impacto',
      objective: 'Calcular alcance de mudanças em cascata',
    });

    // Decisão Central
    const rootDecision = store.proposeDecision(project.id, {
      agent: 'Chief Architect',
      title: 'Estratégia Central de Criptografia',
      body: 'Utilizar AES-256-GCM para todos os dados em repouso.',
    });
    store.acceptDecision(project.id, rootDecision.id, { actor: 'Lead', expectedVersion: rootDecision.version });

    // Conteúdo C1 depende da decisão
    const content1 = store.createContent(project.id, {
      title: 'Módulo de Criptografia de Arquivos',
      kind: 'specification',
      body: 'Detalhes da cifra e geração de chaves.',
      createdBy: 'Sec Team',
      sourceKind: 'human_directive',
    });
    store.addContentRelation(project.id, {
      sourceRevisionId: content1.revision.id,
      targetType: 'decision',
      targetId: rootDecision.id,
      kind: 'supports',
      createdBy: 'Sec Team',
    });

    // Conteúdo C2 referencia C1 (impacto transitivo)
    const content2 = store.createContent(project.id, {
      title: 'Guia de Rotação de Chaves',
      kind: 'reference',
      body: 'Procedimento para rotacionar periodicamente as chaves AES.',
      createdBy: 'Sec Team',
      sourceKind: 'human_directive',
    });
    store.addContentRelation(project.id, {
      sourceRevisionId: content2.revision.id,
      targetType: 'content',
      targetId: content1.item.id,
      kind: 'related',
      createdBy: 'Sec Team',
    });

    // Tarefa 1 (em progresso) vinculada à decisão
    const task1 = store.createTask(project.id, {
      title: 'Implementar Cifra AES-GCM',
      priority: 'urgent',
    });
    store.claimTask(project.id, task1.id, { agent: 'DevAgent', expectedVersion: task1.version });

    // Relação: content1 é insumo de task1
    store.addContentRelation(project.id, {
      sourceRevisionId: content1.revision.id,
      targetType: 'task',
      targetId: task1.id,
      kind: 'required_input',
      createdBy: 'Sec Team',
    });

    // Tarefa 2 depende de Tarefa 1
    const task2 = store.createTask(project.id, {
      title: 'Validar Integridade dos Backups Criptografados',
      priority: 'high',
      dependencyTaskIds: [task1.id],
    });

    // Análise de impacto sobre a Decisão Central
    const impact = store.analyzeGraphImpact(project.id, 'decision', rootDecision.id);

    assert.equal(impact.projectId, project.id);
    assert.equal(impact.targetEntity.id, rootDecision.id);
    assert.equal(impact.targetEntity.type, 'decision');

    // C1 apoia rootDecision (distância 1)
    const impactedC1 = impact.impactedEntities.find((e) => e.id === content1.item.id);
    assert.ok(impactedC1);
    assert.equal(impactedC1.distance, 1);

    // C2 referencia C1 (distância 2 transitiva)
    const impactedC2 = impact.impactedEntities.find((e) => e.id === content2.item.id);
    assert.ok(impactedC2);
    assert.equal(impactedC2.distance, 2);

    // Risco alto devido a tarefa em progresso ou múltiplos dependentes
    assert.equal(impact.riskLevel, 'high');
    assert.ok(impact.impactSummary.totalImpacted >= 2);

    // Erro ao buscar entidade inexistente
    assert.throws(
      () => store.analyzeGraphImpact(project.id, 'decision', 'id-inexistente'),
      /não encontrada no grafo/,
    );
  });

  test('endpoints HTTP REST: GET /graph, GET /graph/conflicts, GET /graph/stale, GET /graph/impact', async () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const project = store.createProject({
      name: 'Projeto HTTP Grafo',
      objective: 'Validar exposição das rotas REST de inteligência de grafo',
    });

    const dec = store.proposeDecision(project.id, {
      agent: 'Lead',
      title: 'Decisão de Protocolo',
      body: 'Adotar REST e JSON estritos.',
    });
    store.acceptDecision(project.id, dec.id, { actor: 'Lead', expectedVersion: dec.version });

    const app = createApp(store);
    const server = app.listen(0);
    cleanups.push(() => server.close());
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const headers = { 'Host': `127.0.0.1:${address.port}`, 'X-Workspace-Client': 'local' };

    // 1. GET /api/projects/:id/graph
    const graphRes = await fetch(`${baseUrl}/api/projects/${project.id}/graph`, { headers });
    assert.equal(graphRes.status, 200);
    const graphData = (await graphRes.json()) as ProjectGraph;
    assert.equal(graphData.projectId, project.id);
    assert.ok(graphData.nodes.length >= 1);
    assert.ok(graphData.stats.totalNodes >= 1);

    // 2. GET /api/projects/:id/graph/conflicts
    const conflictsRes = await fetch(`${baseUrl}/api/projects/${project.id}/graph/conflicts`, { headers });
    assert.equal(conflictsRes.status, 200);
    const conflictsData = (await conflictsRes.json()) as DecisionConflictReport;
    assert.equal(conflictsData.projectId, project.id);
    assert.equal(typeof conflictsData.conflictCount, 'number');

    // 3. GET /api/projects/:id/graph/stale
    const staleRes = await fetch(`${baseUrl}/api/projects/${project.id}/graph/stale`, { headers });
    assert.equal(staleRes.status, 200);
    const staleData = (await staleRes.json()) as StaleContentReport;
    assert.equal(staleData.projectId, project.id);
    assert.equal(typeof staleData.staleCount, 'number');

    // 4. GET /api/projects/:id/graph/impact
    const impactRes = await fetch(
      `${baseUrl}/api/projects/${project.id}/graph/impact?type=decision&id=${dec.id}`,
      { headers },
    );
    assert.equal(impactRes.status, 200);
    const impactData = (await impactRes.json()) as GraphImpactReport;
    assert.equal(impactData.targetEntity.id, dec.id);
    assert.ok(impactData.riskLevel);

    // 5. GET /api/projects/:id/graph/impact sem id obrigatório -> 400
    const badImpactRes = await fetch(`${baseUrl}/api/projects/${project.id}/graph/impact`, { headers });
    assert.equal(badImpactRes.status, 400);
  });

  test('ferramentas MCP: get_project_graph, detect_decision_conflicts, detect_stale_content, analyze_graph_impact', async () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const project = store.createProject({
      name: 'Projeto MCP Grafo',
      objective: 'Validar integração com McpServer',
    });

    const dec = store.proposeDecision(project.id, {
      agent: 'AgentX',
      title: 'Decisão MCP Padrão',
      body: 'Utilizar MCP para interação entre ferramentas.',
    });
    store.acceptDecision(project.id, dec.id, { actor: 'Lead', expectedVersion: dec.version });

    const server = createMcpServer(store);
    const client = new Client({ name: 'test-graph-client', version: '1.0.0' }, { capabilities: {} });
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const toolNames = new Set(tools.tools.map((t) => t.name));
    assert.ok(toolNames.has('get_project_graph'));
    assert.ok(toolNames.has('detect_decision_conflicts'));
    assert.ok(toolNames.has('detect_stale_content'));
    assert.ok(toolNames.has('analyze_graph_impact'));

    // 1. get_project_graph
    const graphCall = await client.callTool({
      name: 'get_project_graph',
      arguments: { projectId: project.id },
    });
    assert.equal(graphCall.isError, undefined);
    const graphResult = JSON.parse((graphCall.content as Array<{ text: string }>)[0]!.text) as ProjectGraph;
    assert.equal(graphResult.projectId, project.id);
    assert.ok(graphResult.nodes.length >= 1);

    // 2. detect_decision_conflicts
    const conflictsCall = await client.callTool({
      name: 'detect_decision_conflicts',
      arguments: { projectId: project.id },
    });
    assert.equal(conflictsCall.isError, undefined);
    const conflictsResult = JSON.parse(
      (conflictsCall.content as Array<{ text: string }>)[0]!.text,
    ) as DecisionConflictReport;
    assert.equal(conflictsResult.projectId, project.id);

    // 3. detect_stale_content
    const staleCall = await client.callTool({
      name: 'detect_stale_content',
      arguments: { projectId: project.id },
    });
    assert.equal(staleCall.isError, undefined);
    const staleResult = JSON.parse(
      (staleCall.content as Array<{ text: string }>)[0]!.text,
    ) as StaleContentReport;
    assert.equal(staleResult.projectId, project.id);

    // 4. analyze_graph_impact
    const impactCall = await client.callTool({
      name: 'analyze_graph_impact',
      arguments: {
        projectId: project.id,
        entityType: 'decision',
        entityId: dec.id,
      },
    });
    assert.equal(impactCall.isError, undefined);
    const impactResult = JSON.parse(
      (impactCall.content as Array<{ text: string }>)[0]!.text,
    ) as GraphImpactReport;
    assert.equal(impactResult.targetEntity.id, dec.id);
  });
});
