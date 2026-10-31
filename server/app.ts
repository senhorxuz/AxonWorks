import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import type { WorkspaceStore } from './store.js';
import { createProjectBundle, createProjectBundleV2, createProjectBundleV3, inspectWorkspace, parseProjectBundle } from './portability/index.js';
import type { ResumeFocusMode } from '../shared/continuity.js';
import type { ApprovalStatus } from '../shared/approvals.js';
import { projectRoot, backupDir, backupEncryptionKey, backupMaxCopies } from './config.js';
import { BackupEngine } from './backup/index.js';
import { createAuthMiddleware, verifyPassword } from './auth/index.js';
import { conexaoMcpPeloSsh, hostPermitido, lerHostsPermitidos, lerModo, origemPermitida } from './rede.js';
import { cookieApagado, cookieDeSessao, FreioDeLogin, HORAS_DE_SESSAO } from './sessao.js';
import type { GraphNodeType } from '../shared/graph.js';
import { computeInsights } from './insights/index.js';
import { lerDadosDaCarta } from './carta/ler.js';
import { montarCarta } from './carta/montar.js';
import { quemApaga } from './store/apagamento.js';

// Quando este processo subiu. Vai na resposta de saúde: o atalho da Área de Trabalho compara com a data do código montado
// para saber se o servidor que está de pé roda código mais velho que o atual (scripts/abrir-axon-decisao.ts).
const INICIADO_EM = new Date(Date.now() - process.uptime() * 1000).toISOString();

export function createApp(store: WorkspaceStore) {
  const backupEngine = new BackupEngine(store, {
    backupDir: process.env.AXON_BACKUP_DIR ?? backupDir,
    maxCopies: backupMaxCopies,
    encryptionKey: backupEncryptionKey,
  });
  // Lidos uma vez: um valor inválido derruba o servidor ao subir, em vez de falhar em silêncio.
  const modo = lerModo();
  const hostsExtras = lerHostsPermitidos();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host ?? '';
    if (!hostPermitido(host, hostsExtras)) {
      res.status(403).json({ error: { code: 'host_forbidden', message: 'O AXON aceita somente acesso local.' } }); return;
    }
    const origin = req.headers.origin;
    if (origin && !origemPermitida(origin, host)) {
      res.status(403).json({ error: { code: 'origin_forbidden', message: 'Origem não permitida.' } }); return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers['x-workspace-client'] !== 'local') {
          res.status(403).json({ error: { code: 'client_header_required', message: 'Requisição de escrita não autorizada nesta origem.' } }); return;
        }
        if (!req.is('application/json')) {
          res.status(415).json({ error: { code: 'json_required', message: 'Envie o conteúdo como JSON.' } }); return;
        }
      }
    }
    next();
  });
  app.use('/api/import', express.json({ limit: '2mb', strict: true }));
  app.use('/api', express.json({ limit: '256kb', strict: true }));
  // No servidor o login é obrigatório: é a única porta entre a internet e os seus projetos.
  const exigirLogin = modo === 'servidor' || process.env.AXON_REQUIRE_AUTH === '1';
  const cookieSeguro = modo === 'servidor';
  const freio = new FreioDeLogin();
  app.use('/api', createAuthMiddleware(store, hostsExtras, exigirLogin));
  app.get('/api/auth/status', (_req, res) => res.json({ temConta: store.listAccounts().length > 0, exigeLogin: exigirLogin }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: modo, version: '0.1.0', pid: process.pid, iniciadoEm: INICIADO_EM }));
  app.get('/api/connectors', (_req, res) => {
    const tsxLoader = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
    const mcpScript = path.join(projectRoot, 'server', 'mcp.ts');
    const nodeExecutable = process.execPath;
    // No servidor a IA está em outro computador e abre o MCP pelo SSH.
    // Com a Cloudflare na frente, o endereço do site não leva à VPS: AXON_SSH_HOST diz o caminho direto.
    const enderecoSsh = process.env.AXON_SSH_HOST?.trim().toLowerCase() || hostsExtras[0];
    const remoto = modo === 'servidor' && enderecoSsh ? conexaoMcpPeloSsh(enderecoSsh, projectRoot) : null;
    res.json({
      projectRoot,
      nodeExecutable,
      mcpCommand: remoto?.command ?? nodeExecutable,
      mcpArgs: remoto?.args ?? ['--import', tsxLoader, mcpScript],
      port: Number(process.env.AXON_PORT ?? '4317'),
      platform: process.platform,
    });
  });
  app.get('/api/projects', (_req, res) => res.json(store.listProjects()));
  app.post('/api/projects', (req, res) => res.status(201).json(store.createProject(req.body)));
  app.get('/api/projects/:id', (req, res) => res.json(store.getProject(req.params.id)));
  app.post('/api/projects/:id/tasks', (req, res) => res.status(201).json(store.createTask(req.params.id, req.body)));
  app.post('/api/projects/:id/tasks/:taskId/claim', (req, res) => {
    const task = store.claimTask(req.params.id, req.params.taskId, req.body);
    res.json({ ...task, overlaps: store.listIntentOverlaps(req.params.id, req.params.taskId) });
  });
  app.post('/api/projects/:id/tasks/:taskId/contract', (req, res) => res.json(store.updateTaskContract(req.params.id, req.params.taskId, req.body)));
  app.post('/api/projects/:id/tasks/:taskId/release', (req, res) => res.json(store.releaseTask(req.params.id, req.params.taskId, req.body)));
  app.post('/api/projects/:id/checkpoints', (req, res) => res.status(201).json(store.saveCheckpoint(req.params.id, req.body)));
  // O dono apaga trecho ou registro inteiro, só pela tela (regra em server/store/apagamento.ts). Token de IA recebe 403.
  app.post('/api/projects/:id/checkpoints/:checkpointId/apagar-trecho/contar', (req, res) => {
    quemApaga(req.auth);
    res.json(store.contarTrechoNoRegistro(req.params.id, req.params.checkpointId, req.body));
  });
  app.post('/api/projects/:id/checkpoints/:checkpointId/apagar-trecho', (req, res) => {
    res.json(store.apagarTrechoDoRegistro(req.params.id, req.params.checkpointId, req.body, quemApaga(req.auth)));
  });
  app.post('/api/projects/:id/checkpoints/:checkpointId/apagar-registro', (req, res) => {
    res.json(store.apagarRegistroInteiro(req.params.id, req.params.checkpointId, req.body, quemApaga(req.auth)));
  });
  app.post('/api/projects/:id/messages', (req, res) => res.status(201).json(store.postMessage(req.params.id, req.body)));
  app.get('/api/projects/:id/handoff', (req, res) => {
    const maxChars = req.query.maxChars === undefined ? undefined : Number(req.query.maxChars);
    const handoff = store.getHandoff(req.params.id, { maxChars });
    if (req.query.format === 'markdown') {
      res.setHeader('Content-Disposition', 'attachment; filename="axon-contexto.md"');
      res.type('text/markdown').send(handoff.markdown);
    } else res.json(handoff);
  });

  // Continuidade & Busca
  app.get('/api/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(store.searchProjects(q));
  });

  app.get('/api/projects/:id/inbox', (req, res) => {
    const agent = typeof req.query.agent === 'string' ? req.query.agent : '';
    const unreadOnly = req.query.unreadOnly === 'true';
    res.json(store.getInbox(req.params.id, agent, { unreadOnly }));
  });

  app.post('/api/projects/:id/messages/:messageId/ack', (req, res) => {
    res.json(store.acknowledgeMessage(req.params.id, req.params.messageId, req.body));
  });

  app.post('/api/projects/:id/messages/:messageId/resolve', (req, res) => {
    res.json(store.resolveMessageAttention(req.params.id, req.params.messageId, req.body));
  });

  app.get('/api/projects/:id/resume', (req, res) => {
    const agent = typeof req.query.agent === 'string' ? req.query.agent : '';
    const taskId =
      req.query.taskId === undefined
        ? undefined
        : typeof req.query.taskId === 'string'
          ? req.query.taskId
          : '';
    const focusMode =
      req.query.focusMode === undefined
        ? undefined
        : typeof req.query.focusMode === 'string'
          ? req.query.focusMode
          : '';
    res.json(
      store.getResumeBrief(
        req.params.id,
        agent,
        taskId,
        focusMode as ResumeFocusMode | undefined,
      ),
    );
  });

  app.get('/api/projects/:id/context', (req, res) => {
    const agent = typeof req.query.agent === 'string' ? req.query.agent : '';
    const taskId =
      req.query.taskId === undefined
        ? undefined
        : typeof req.query.taskId === 'string'
          ? req.query.taskId
          : '';
    const focusMode =
      req.query.focusMode === undefined
        ? undefined
        : typeof req.query.focusMode === 'string'
          ? req.query.focusMode
          : '';
    const maxChars =
      req.query.maxChars !== undefined
        ? Number(req.query.maxChars)
        : undefined;
    const includeOutdatedContent =
      req.query.includeOutdatedContent === 'true';

    res.json(
      store.compileContext(req.params.id, {
        agent,
        taskId: taskId || null,
        focusMode: (focusMode as ResumeFocusMode) || undefined,
        maxChars,
        includeOutdatedContent,
      }),
    );
  });

  app.post('/api/projects/:id/deliveries', (req, res) => {
    res.status(201).json(store.createHandoffDelivery(req.params.id, req.body));
  });

  app.get('/api/projects/:id/deliveries', (req, res) => {
    const agent = typeof req.query.agent === 'string' ? req.query.agent : '';
    const unreadOnly = req.query.unreadOnly === 'true';
    res.json(store.getHandoffDeliveries(req.params.id, agent, { unreadOnly }));
  });

  app.post('/api/projects/:id/deliveries/:deliveryId/ack', (req, res) => {
    res.json(store.acknowledgeHandoffDelivery(req.params.id, req.params.deliveryId, req.body));
  });

  app.get('/api/projects/:id/drafts', (req, res) => {
    const agent = typeof req.query.agent === 'string' ? req.query.agent : '';
    const taskId =
      req.query.taskId === undefined
        ? undefined
        : typeof req.query.taskId === 'string'
          ? req.query.taskId
          : '';
    if (taskId !== undefined) {
      res.json(store.getWorkDraft(req.params.id, agent, taskId || null));
      return;
    }
    res.json(store.listWorkDrafts(req.params.id, agent));
  });

  app.post('/api/projects/:id/drafts', (req, res) => {
    res.json(store.saveWorkDraft(req.params.id, req.body));
  });

  app.post('/api/projects/:id/drafts/discard', (req, res) => {
    res.json(store.discardWorkDraft(req.params.id, req.body));
  });

  app.post('/api/projects/:id/finalize', (req, res) => {
    res.status(201).json(store.finalizeWork(req.params.id, req.body));
  });

  app.post('/api/projects/:id/tasks/:taskId/reopen', (req, res) => {
    res.json(store.reopenTask(req.params.id, req.params.taskId, req.body));
  });

  app.get('/api/projects/:id/tasks/:taskId/events', (req, res) => {
    res.json(store.listTaskEvents(req.params.id, req.params.taskId));
  });

  app.get('/api/projects/:id/backlog', (req, res) => {
    const includeClosed = req.query.includeClosed === 'true';
    res.json(store.listBacklog(req.params.id, { includeClosed }));
  });

  app.post('/api/projects/:id/backlog', (req, res) => {
    res.status(201).json(store.createBacklogItem(req.params.id, req.body));
  });

  app.post('/api/projects/:id/backlog/:itemId/update', (req, res) => {
    res.json(store.updateBacklogItem(req.params.id, req.params.itemId, req.body));
  });

  app.post('/api/projects/:id/backlog/:itemId/promote', (req, res) => {
    res.json(store.promoteBacklogItem(req.params.id, req.params.itemId));
  });

  app.post('/api/projects/:id/backlog/:itemId/archive', (req, res) => {
    res.json(store.archiveBacklogItem(req.params.id, req.params.itemId, req.body));
  });

  app.delete('/api/projects/:id/backlog/:itemId', (req, res) => {
    const expectedVersion = req.body && typeof req.body === 'object' ? req.body.expectedVersion : undefined;
    res.json(store.deleteBacklogItem(req.params.id, req.params.itemId, expectedVersion));
  });

  // Decisões canônicas
  app.get('/api/projects/:id/decisions', (req, res) => {
    const includeHistory = req.query.includeHistory === 'true';
    res.json(store.listDecisions(req.params.id, { includeHistory }));
  });

  app.post('/api/projects/:id/decisions', (req, res) => {
    res.status(201).json(store.proposeDecision(req.params.id, req.body));
  });

  app.post('/api/projects/:id/decisions/:decisionId/accept', (req, res) => {
    res.json(store.acceptDecision(req.params.id, req.params.decisionId, req.body));
  });

  app.post('/api/projects/:id/decisions/:decisionId/revoke', (req, res) => {
    res.json(store.revokeDecision(req.params.id, req.params.decisionId, req.body));
  });

  app.post('/api/projects/:id/decisions/:decisionId/supersede', (req, res) => {
    res.status(201).json(store.supersedeDecision(req.params.id, req.params.decisionId, req.body));
  });

  app.get('/api/projects/:id/decisions/:decisionId/timeline', (req, res) => {
    res.json(store.getDecisionTimeline(req.params.id, req.params.decisionId));
  });

  app.get('/api/projects/:id/charter', (req, res) => {
    res.json(store.getCharter(req.params.id));
  });

  app.get('/api/projects/:id/charter/history', (req, res) => {
    res.json(store.listCharterHistory(req.params.id));
  });

  app.post('/api/projects/:id/charter', (req, res) => {
    res.json(store.saveCharter(req.params.id, req.body));
  });

  // Fila de aprovações (Parte 5). Propor/listar/retirar também existem no MCP
  // (server/mcp-tools.ts). Aprovar e recusar são decisão do dono e existem
  // SÓ aqui — nunca como ferramenta MCP, para que uma IA não possa aprovar a
  // própria proposta.
  app.get('/api/projects/:id/approvals', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(store.listApprovals(req.params.id, status ? { status: status as ApprovalStatus } : undefined));
  });

  app.post('/api/projects/:id/approvals', (req, res) => {
    res.status(201).json(store.proposeApproval(req.params.id, req.body));
  });

  app.post('/api/projects/:id/approvals/:approvalId/withdraw', (req, res) => {
    res.json(store.withdrawApproval(req.params.id, req.params.approvalId, req.body));
  });

  app.post('/api/projects/:id/approvals/:approvalId/approve', (req, res) => {
    res.json(store.approveApproval(req.params.id, req.params.approvalId, req.body));
  });

  app.post('/api/projects/:id/approvals/:approvalId/reject', (req, res) => {
    res.json(store.rejectApproval(req.params.id, req.params.approvalId, req.body));
  });

  // Quadro do projeto (Parte 14).
  // Excluir de vez é só do dono, pela tela (HTTP) — nunca existe no MCP.
  app.get('/api/projects/:id/board', (req, res) => {
    res.json(store.getBoard(req.params.id));
  });

  app.get('/api/projects/:id/board/cards/:cardId/events', (req, res) => {
    res.json(store.listBoardCardEvents(req.params.id, req.params.cardId));
  });

  app.post('/api/projects/:id/board/cards', (req, res) => {
    res.status(201).json(store.createBoardCard(req.params.id, req.body));
  });

  app.post('/api/projects/:id/board/cards/:cardId/update', (req, res) => {
    res.json(store.updateBoardCard(req.params.id, req.params.cardId, req.body));
  });

  app.post('/api/projects/:id/board/cards/:cardId/move', (req, res) => {
    res.json(store.moveBoardCard(req.params.id, req.params.cardId, req.body));
  });

  app.post('/api/projects/:id/board/cards/:cardId/delete', (req, res) => {
    res.json(store.deleteBoardCard(req.params.id, req.params.cardId, req.body));
  });

  app.get('/api/projects/:id/blockers', (req, res) => {
    const includeClosed = req.query.includeClosed === 'true';
    res.json(store.listBlockers(req.params.id, { includeClosed }));
  });

  app.post('/api/projects/:id/blockers', (req, res) => {
    res.status(201).json(store.openBlocker(req.params.id, req.body));
  });

  app.post('/api/projects/:id/blockers/:blockerId/mitigate', (req, res) => {
    res.json(store.mitigateBlocker(req.params.id, req.params.blockerId, req.body));
  });

  app.post('/api/projects/:id/blockers/:blockerId/resolve', (req, res) => {
    res.json(store.resolveBlocker(req.params.id, req.params.blockerId, req.body));
  });

  app.post('/api/projects/:id/blockers/:blockerId/accept-risk', (req, res) => {
    res.json(store.acceptBlockerRisk(req.params.id, req.params.blockerId, req.body));
  });

  app.post('/api/projects/:id/blockers/:blockerId/reopen', (req, res) => {
    res.json(store.reopenBlocker(req.params.id, req.params.blockerId, req.body));
  });

  app.get('/api/projects/:id/blockers/:blockerId/timeline', (req, res) => {
    res.json(store.getBlockerTimeline(req.params.id, req.params.blockerId));
  });

  // Evidência verificável: relato, artefatos com frescor, conferência cruzada
  app.get('/api/projects/:id/evidence', (req, res) => {
    const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;
    const checkpointId = typeof req.query.checkpointId === 'string' ? req.query.checkpointId : undefined;
    const staleOnly = req.query.staleOnly === 'true';
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    res.json(store.listEvidence(req.params.id, { taskId, checkpointId, staleOnly, limit }));
  });

  app.get('/api/projects/:id/evidence/:evidenceId', (req, res) => {
    res.json(store.getEvidence(req.params.id, req.params.evidenceId));
  });

  app.post('/api/projects/:id/evidence/:evidenceId/artifacts', (req, res) => {
    res.json(store.registerEvidenceArtifacts(req.params.id, req.params.evidenceId, req.body));
  });

  app.post('/api/projects/:id/evidence/:evidenceId/cross-check', (req, res) => {
    res.json(store.crossCheckEvidence(req.params.id, req.params.evidenceId, req.body));
  });

  app.get('/api/projects/:id/content/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(store.searchContent(req.params.id, q));
  });

  app.get('/api/projects/:id/content', (req, res) => {
    const includeArchived = req.query.includeArchived === 'true';
    res.json(store.listContent(req.params.id, { includeArchived }));
  });

  app.post('/api/projects/:id/content', (req, res) => {
    res.status(201).json(store.createContent(req.params.id, req.body));
  });

  app.get('/api/projects/:id/content/:itemId', (req, res) => {
    res.json(store.getContent(req.params.id, req.params.itemId));
  });

  app.post('/api/projects/:id/content/:itemId/revise', (req, res) => {
    res.json(store.reviseContent(req.params.id, req.params.itemId, req.body));
  });

  app.post('/api/projects/:id/content/:itemId/archive', (req, res) => {
    res.json(store.archiveContent(req.params.id, req.params.itemId, req.body));
  });

  app.post('/api/projects/:id/content/:itemId/relations', (req, res) => {
    res.status(201).json(store.addContentRelation(req.params.id, req.body));
  });

  app.delete('/api/projects/:id', (req, res) => {
    const confirmation = req.body && typeof req.body === 'object' ? req.body.confirmation : undefined;
    res.json(store.deleteProject(req.params.id, confirmation));
  });

  // Portabilidade & Inspeção Seletiva
  app.get('/api/projects/:id/bundle', (req, res) => {
    // Sem versao declarada entrega a v3, a memoria completa. v1 e v2 continuam
    // disponiveis sob pedido explicito, e a v2 declara o que deixa de levar.
    const versionQuery = req.query.version ?? req.query.v;
    if (versionQuery === '1') {
      const bundle = createProjectBundle(store.exportProject(req.params.id));
      res.json(bundle);
      return;
    }
    if (versionQuery === '2') {
      const bundle = createProjectBundleV2(store.exportProjectBundleData(req.params.id));
      res.json(bundle);
      return;
    }
    const bundle = createProjectBundleV3(store.exportProjectBundleData(req.params.id));
    res.json(bundle);
  });

  app.post('/api/import', (req, res) => {
    const bundleInput = req.body && typeof req.body === 'object' && 'bundle' in req.body ? req.body.bundle : req.body;
    const parsed = parseProjectBundle(bundleInput);
    const imported = store.importProjectBundleData(parsed);
    res.status(201).json(imported);
  });

  app.post('/api/projects/:id/inspect', async (req, res, next) => {
    try {
      const detail = store.getProject(req.params.id);
      const workspacePath = detail.project.workspacePath;
      if (!workspacePath) {
        res.status(400).json({ error: { code: 'workspace_path_missing', message: 'O projeto não possui workspacePath configurado no cadastro.' } });
        return;
      }
      const { files, maxChars } = req.body ?? {};
      const inspection = await inspectWorkspace({
        workspacePath,
        files,
        maxChars: maxChars !== undefined ? Number(maxChars) : undefined,
      });
      res.json(inspection);
    } catch (error) {
      next(error);
    }
  });

  // Grafo de Decisões e Conteúdos, Conflitos e Frescor
  app.get('/api/projects/:id/graph', (req, res, next) => {
    try {
      const nodeTypesParam = typeof req.query.nodeTypes === 'string'
        ? (req.query.nodeTypes.split(',').map((s) => s.trim()) as GraphNodeType[])
        : undefined;
      const includeArchived = req.query.includeArchived !== 'false';
      const graph = store.getProjectGraph(req.params.id, {
        nodeTypes: nodeTypesParam,
        includeArchived,
      });
      res.json(graph);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/projects/:id/graph/conflicts', (req, res, next) => {
    try {
      const report = store.detectDecisionConflicts(req.params.id);
      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/projects/:id/graph/stale', (req, res, next) => {
    try {
      const report = store.detectStaleContent(req.params.id);
      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/projects/:id/graph/impact', (req, res, next) => {
    try {
      const entityType = String(req.query.type ?? req.query.entityType ?? 'decision') as GraphNodeType;
      const entityId = String(req.query.id ?? req.query.entityId ?? '');
      if (!entityId) {
        res.status(400).json({
          error: {
            code: 'bad_request',
            message: 'Parâmetro id ou entityId é obrigatório para análise de impacto.',
          },
        });
        return;
      }
      const report = store.analyzeGraphImpact(req.params.id, entityType, entityId);
      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  // Inteligência sem IA (Parte 6): só chama computeInsights com o relógio
  // real. Nenhuma lógica aqui — erros de projeto inexistente/inválido vêm do
  // próprio store (via exportProjectBundleData dentro de computeInsights) e
  // caem no middleware de erros abaixo, igual às rotas vizinhas.
  app.get('/api/projects/:id/insights', (req, res, next) => {
    try {
      const insights = computeInsights(store, req.params.id, { now: new Date() });
      res.json(insights);
    } catch (err) {
      next(err);
    }
  });

  // Carta "Onde paramos": só liga a regra (server/carta/) ao relógio real. Nenhuma lógica aqui; projeto
  // inexistente ou inválido vem do próprio store e cai no middleware de erros, como nas rotas vizinhas.
  app.get('/api/projects/:id/carta', (req, res) => {
    res.json(montarCarta(lerDadosDaCarta(store, req.params.id), new Date()));
  });

  // Backups & Disaster Recovery
  app.post('/api/backups', async (req, res, next) => {
    try {
      const label = typeof req.body?.label === 'string' ? req.body.label : undefined;
      const manifest = await backupEngine.createBackup({ label });
      res.status(201).json(manifest);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/backups', (_req, res) => {
    res.json(backupEngine.listBackups());
  });

  app.get('/api/backups/drills', (_req, res) => {
    res.json(backupEngine.listDrillReports());
  });

  app.get('/api/backups/:id', (req, res) => {
    const manifest = backupEngine.getBackup(req.params.id);
    if (!manifest) {
      res.status(404).json({ error: { code: 'backup_not_found', message: 'Backup não encontrado.' } });
      return;
    }
    res.json(manifest);
  });

  app.post('/api/backups/drill', async (_req, res, next) => {
    try {
      const report = await backupEngine.runRecoveryDrill();
      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/backups/:id/drill', async (req, res, next) => {
    try {
      const report = await backupEngine.runRecoveryDrill(req.params.id);
      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/backups/:id/restore', async (req, res, next) => {
    try {
      const confirm = req.body?.confirm === true;
      const result = await backupEngine.restoreBackup(req.params.id, { confirm });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // --- Autenticação & Contas (Etapa 3) ---
  app.post('/api/auth/register', (req, res, next) => {
    try {
      // Cadastro aberto só existe para criar a primeira conta (o dono). Depois disso, fica fechado.
      if (store.listAccounts().length > 0) {
        res.status(403).json({ error: { code: 'registration_closed', message: 'O cadastro está fechado: esta Axon já tem dono.' } });
        return;
      }
      const { username, displayName, password, role } = req.body ?? {};
      const account = store.createAccount({ username, displayName, password, role });
      res.status(201).json(account);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', (req, res, next) => {
    try {
      const { username, password } = req.body ?? {};
      if (typeof username !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: { code: 'invalid_credentials', message: 'Informe usuário e senha.' } });
        return;
      }
      const minutos = freio.minutosBloqueado(username);
      if (minutos > 0) {
        res.status(429).json({
          error: { code: 'too_many_attempts', message: `Muitas tentativas. Tente de novo em ${minutos} minutos.` },
        });
        return;
      }
      const accountWithHash = store.getAccountByUsername(username);
      // Mesma resposta para usuário inexistente e senha errada: não entrega quem existe.
      if (!accountWithHash || !verifyPassword(password, accountWithHash.passwordHash)) {
        freio.registrarErro(username);
        res.status(401).json({ error: { code: 'invalid_credentials', message: 'Usuário ou senha incorretos.' } });
        return;
      }
      if (accountWithHash.status === 'suspended') {
        res.status(403).json({ error: { code: 'account_suspended', message: 'Esta conta está suspensa.' } });
        return;
      }
      const tokenResult = store.createAuthToken({
        accountId: accountWithHash.id,
        name: 'Sessão Web',
        tokenType: 'user_session',
        role: accountWithHash.role === 'admin' ? 'owner' : 'collaborator',
        expiresInHours: HORAS_DE_SESSAO,
      });
      freio.limpar(username);
      const { passwordHash: _, ...account } = accountWithHash;
      // A sessão vai no cookie, nunca no corpo: assim nenhum script da página consegue copiá-la.
      res.setHeader('Set-Cookie', cookieDeSessao(tokenResult.token, cookieSeguro));
      res.json({ account, tokenInfo: tokenResult.tokenInfo });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', (req, res, next) => {
    try {
      if (req.auth?.tokenId) store.revokeAuthToken(req.auth.tokenId, req.auth.actorId);
      res.setHeader('Set-Cookie', cookieApagado(cookieSeguro));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Não autenticado.' } });
      return;
    }
    const account = req.auth.accountId ? store.getAccount(req.auth.accountId) : null;
    res.json({ account, auth: req.auth });
  });

  app.get('/api/auth/accounts', (_req, res) => {
    res.json(store.listAccounts());
  });

  // --- Tokens Revogáveis ---
  app.post('/api/auth/tokens', (req, res, next) => {
    try {
      const { name, tokenType, role, projectId, agentName, expiresInHours, prefix } = req.body ?? {};
      const result = store.createAuthToken({
        accountId: req.auth?.accountId,
        name,
        tokenType,
        role,
        projectId,
        agentName,
        expiresInHours,
        prefix,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/tokens', (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const includeRevoked = req.query.includeRevoked === 'true';
    res.json(store.listAuthTokens({ projectId, includeRevoked }));
  });

  app.post('/api/auth/tokens/:id/revoke', (req, res, next) => {
    try {
      const revoked = store.revokeAuthToken(req.params.id, req.auth?.actorId ?? 'system');
      res.json(revoked);
    } catch (err) {
      next(err);
    }
  });

  // --- Dispositivos Pareados ---
  app.get('/api/devices', (req, res) => {
    const accountId = req.auth?.accountId;
    if (!accountId) {
      res.json([]);
      return;
    }
    res.json(store.listPairedDevices(accountId));
  });

  app.post('/api/devices/pair', (req, res, next) => {
    try {
      const accountId = req.auth?.accountId;
      if (!accountId) {
        res.status(401).json({ error: { code: 'unauthorized', message: 'Autenticação necessária para parear dispositivo.' } });
        return;
      }
      const { deviceName, deviceFingerprint } = req.body ?? {};
      const device = store.pairDevice({ accountId, deviceName, deviceFingerprint, ipAddress: req.ip });
      res.status(201).json(device);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/devices/:id/revoke', (req, res, next) => {
    try {
      const device = store.revokeDevice(req.params.id);
      res.json(device);
    } catch (err) {
      next(err);
    }
  });

  // --- RBAC por Projeto ---
  app.get('/api/projects/:id/members', (req, res) => {
    res.json(store.listProjectMembers(req.params.id));
  });

  app.post('/api/projects/:id/members', (req, res, next) => {
    try {
      const { accountId, role } = req.body ?? {};
      const member = store.addProjectMember(req.params.id, { accountId, role });
      res.status(201).json(member);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/projects/:id/members/:accountId', (req, res, next) => {
    try {
      store.removeProjectMember(req.params.id, req.params.accountId);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // --- Trilha de Auditoria ---
  app.get('/api/audit-logs', (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(store.listAuditLogs({ projectId, action, actorId, limit }));
  });

  app.use('/api', (_req, res) => { res.status(404).json({ error: { code: 'route_not_found', message: 'Rota não encontrada.' } }); });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const value = error as { status?: number; code?: string; message?: string; type?: string };
    if (value?.type === 'entity.too.large') { res.status(413).json({ error: { code: 'body_too_large', message: 'Conteúdo excede o limite de 256 KB.' } }); return; }
    if (value?.type === 'entity.parse.failed') { res.status(400).json({ error: { code: 'invalid_json', message: 'JSON inválido.' } }); return; }
    if (value && [400, 403, 404, 409].includes(value.status ?? 0) && value.code) {
      res.status(value.status!).json({ error: { code: value.code, message: value.message } }); return;
    }
    // Detailed payloads and stack traces must not enter responses or logs.
    res.status(500).json({ error: { code: 'internal_error', message: 'Não foi possível concluir a operação. Seus dados não foram substituídos.' } });
  };
  app.use(errors);
  return app;
}
