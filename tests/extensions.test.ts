import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createApp } from '../server/app.js';
import { WorkspaceStore } from '../server/store.js';
import { createMcpServer } from '../server/mcp-tools.js';

async function fixture(t: { after: (fn: () => void | Promise<void>) => void }) {
  const store = new WorkspaceStore(':memory:');
  const server = createServer(createApp(store));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });
  const get = (urlPath: string, headers = {}) =>
    fetch(base + urlPath, {
      headers: {
        Host: `127.0.0.1:${address.port}`,
        Origin: `http://127.0.0.1:${address.port}`,
        ...headers,
      },
    });
  const post = (urlPath: string, body: unknown, headers = {}) =>
    fetch(base + urlPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Client': 'local',
        Host: `127.0.0.1:${address.port}`,
        Origin: `http://127.0.0.1:${address.port}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { store, base, get, post };
}

test('Search API: literal matching across projects, tasks, checkpoints and messages', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', {
    name: 'Projeto de Pesquisa Neural',
    objective: 'Análise de redes profundas com memória confiável',
  });
  assert.equal(created.status, 201);
  const project = await created.json();

  await post(`/api/projects/${project.id}/tasks`, { title: 'Implementar camada convolucional' });
  await post(`/api/projects/${project.id}/messages`, {
    from: 'Gemini',
    to: 'Grok',
    kind: 'note',
    body: 'Revisão do otimizador AdamW concluída com sucesso.',
  });

  // Busca que encontra o projeto pelo objetivo
  const resProj = await get('/api/search?q=profundas');
  assert.equal(resProj.status, 200);
  const resultsProj = await resProj.json();
  assert.ok(resultsProj.length > 0);
  assert.equal(resultsProj[0].kind, 'project');
  assert.equal(resultsProj[0].projectId, project.id);

  // Busca que encontra a mensagem
  const resMsg = await get('/api/search?q=AdamW');
  assert.equal(resMsg.status, 200);
  const resultsMsg = await resMsg.json();
  assert.ok(resultsMsg.some((r: { kind: string; recordId: string }) => r.kind === 'message'));

  // Validação: busca vazia deve retornar 400
  const resEmpty = await get('/api/search?q=');
  assert.equal(resEmpty.status, 400);

  // Validação: busca com mais de 200 caracteres deve retornar 400
  const resTooLong = await get(`/api/search?q=${'a'.repeat(201)}`);
  assert.equal(resTooLong.status, 400);
});

test('Inbox & Ack API: isolated per agent, unread filtering, idempotent acknowledgement', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', {
    name: 'Comunicação Interagente',
    objective: 'Validar entrega de mensagens e recibos idempotentes',
  });
  const project = await created.json();

  // Mensagem direta para Gemini
  const msgDirectRes = await post(`/api/projects/${project.id}/messages`, {
    from: 'Grok',
    to: 'Gemini',
    kind: 'review',
    body: 'Por favor, revise o contrato do store.',
  });
  const msgDirect = await msgDirectRes.json();

  // Mensagem broadcast para todos
  const msgBroadcastRes = await post(`/api/projects/${project.id}/messages`, {
    from: 'Astra',
    to: '*',
    kind: 'note',
    body: 'Aviso geral: congelamento de interface.',
  });
  const msgBroadcast = await msgBroadcastRes.json();

  // Mensagem direta para outro agente (não deve constar na inbox de Gemini)
  await post(`/api/projects/${project.id}/messages`, {
    from: 'Astra',
    to: 'Grok',
    kind: 'note',
    body: 'Aviso exclusivo para Grok.',
  });

  // Consulta da inbox do Gemini
  const inboxRes = await get(`/api/projects/${project.id}/inbox?agent=Gemini`);
  assert.equal(inboxRes.status, 200);
  const inboxItems = await inboxRes.json();
  assert.equal(inboxItems.length, 2);
  assert.ok(inboxItems.every((item: { acknowledgedAt: string | null }) => item.acknowledgedAt === null));

  // Confirmação de recebimento (Ack)
  const ackRes = await post(`/api/projects/${project.id}/messages/${msgDirect.id}/ack`, { agent: 'Gemini' });
  assert.equal(ackRes.status, 200);
  const ackData = await ackRes.json();
  assert.equal(ackData.messageId, msgDirect.id);
  assert.equal(ackData.agent, 'Gemini');
  assert.ok(ackData.acknowledgedAt);

  // Idempotência: repetir ack com mesmo agente deve retornar mesmo timestamp
  const ackRetry = await post(`/api/projects/${project.id}/messages/${msgDirect.id}/ack`, { agent: 'Gemini' });
  assert.equal(ackRetry.status, 200);
  const ackRetryData = await ackRetry.json();
  assert.equal(ackRetryData.acknowledgedAt, ackData.acknowledgedAt);

  // Filtro unreadOnly deve retornar apenas a mensagem broadcast ainda não confirmada
  const unreadRes = await get(`/api/projects/${project.id}/inbox?agent=Gemini&unreadOnly=true`);
  assert.equal(unreadRes.status, 200);
  const unreadItems = await unreadRes.json();
  assert.equal(unreadItems.length, 1);
  assert.equal(unreadItems[0].message.id, msgBroadcast.id);

  // Agente não destinatário tentando dar ack recebe 409 recipient_mismatch
  const forbiddenAck = await post(`/api/projects/${project.id}/messages/${msgDirect.id}/ack`, { agent: 'OutroAgente' });
  assert.equal(forbiddenAck.status, 409);
  const errJson = await forbiddenAck.json();
  assert.equal(errJson.error.code, 'recipient_mismatch');
});

test('Resolução HTTP fecha pergunta sem inventar leitura e preserva idempotência', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', {
    name: 'Atenção HTTP',
    objective: 'Resolver perguntas de modo explícito',
  });
  const project = await created.json();
  const questionRes = await post(`/api/projects/${project.id}/messages`, {
    from: 'Astra',
    to: 'Gemini',
    kind: 'question',
    body: 'O contrato está pronto?',
  });
  const question = await questionRes.json();

  const resolvedRes = await post(
    `/api/projects/${project.id}/messages/${question.id}/resolve`,
    { agent: 'Gemini', note: 'Sim, o contrato foi conferido.' },
  );
  assert.equal(resolvedRes.status, 200);
  const resolved = await resolvedRes.json();
  assert.equal(resolved.messageId, question.id);
  assert.equal(resolved.agent, 'Gemini');
  assert.equal(resolved.note, 'Sim, o contrato foi conferido.');
  assert.ok(resolved.resolvedAt);

  const retryRes = await post(
    `/api/projects/${project.id}/messages/${question.id}/resolve`,
    { agent: 'Gemini', note: 'Sim, o contrato foi conferido.' },
  );
  assert.equal(retryRes.status, 200);
  assert.deepEqual(await retryRes.json(), resolved);

  const divergent = await post(
    `/api/projects/${project.id}/messages/${question.id}/resolve`,
    { agent: 'Gemini', note: 'Resposta diferente.' },
  );
  assert.equal(divergent.status, 409);
  assert.equal((await divergent.json()).error.code, 'resolution_conflict');

  const inbox = await (await get(`/api/projects/${project.id}/inbox?agent=Gemini`)).json();
  const resolvedItem = inbox.find(
    (item: { message: { id: string } }) => item.message.id === question.id,
  );
  assert.equal(resolvedItem.acknowledgedAt, null);
  assert.equal(resolvedItem.resolution.resolvedAt, resolved.resolvedAt);

  const resume = await (await get(`/api/projects/${project.id}/resume?agent=Gemini`)).json();
  assert.equal(
    resume.attention.some((item: { sourceId: string }) => item.sourceId === question.id),
    false,
  );

  const wrongRecipientRes = await post(`/api/projects/${project.id}/messages`, {
    from: 'Astra',
    to: 'Grok',
    kind: 'review',
    body: 'Revise a integração.',
  });
  const wrongRecipient = await wrongRecipientRes.json();
  const forbidden = await post(
    `/api/projects/${project.id}/messages/${wrongRecipient.id}/resolve`,
    { agent: 'Gemini', note: 'Não sou o destinatário.' },
  );
  assert.equal(forbidden.status, 409);
  assert.equal((await forbidden.json()).error.code, 'recipient_mismatch');

  const noteRes = await post(`/api/projects/${project.id}/messages`, {
    from: 'Astra',
    to: 'Gemini',
    kind: 'note',
    body: 'Mensagem informativa.',
  });
  const note = await noteRes.json();
  const notResolvable = await post(
    `/api/projects/${project.id}/messages/${note.id}/resolve`,
    { agent: 'Gemini', note: 'Tentativa inválida.' },
  );
  assert.equal(notResolvable.status, 409);
  assert.equal((await notResolvable.json()).error.code, 'attention_not_resolvable');

  const unresolvedRes = await post(`/api/projects/${project.id}/messages`, {
    from: 'Astra',
    to: 'Gemini',
    kind: 'question',
    body: 'Qual evidência comprova a decisão?',
  });
  const unresolved = await unresolvedRes.json();
  const missingPayload = await post(
    `/api/projects/${project.id}/messages/${unresolved.id}/resolve`,
    { agent: 'Gemini' },
  );
  assert.equal(missingPayload.status, 400);
  assert.equal((await missingPayload.json()).error.code, 'invalid_input');

  const invalidReference = await post(
    `/api/projects/${project.id}/messages/${unresolved.id}/resolve`,
    { agent: 'Gemini', responseMessageId: randomUUID() },
  );
  assert.equal(invalidReference.status, 404);
  assert.equal((await invalidReference.json()).error.code, 'not_found');

  const invalidCheckpointReference = await post(
    `/api/projects/${project.id}/messages/${unresolved.id}/resolve`,
    { agent: 'Gemini', checkpointId: randomUUID() },
  );
  assert.equal(invalidCheckpointReference.status, 404);
  assert.equal((await invalidCheckpointReference.json()).error.code, 'not_found');

  const responseRes = await post(`/api/projects/${project.id}/messages`, {
    from: 'Gemini',
    to: 'Astra',
    kind: 'note',
    body: 'A evidência está no checkpoint vinculado.',
  });
  const responseMessage = await responseRes.json();
  const checkpointRes = await post(`/api/projects/${project.id}/checkpoints`, {
    expectedRevision: 0,
    idempotencyKey: 'resolve-http-reference',
    agent: 'Gemini',
    summary: 'Evidência conferida para responder à pergunta.',
    nextStep: 'Prosseguir com a passagem.',
  });
  const checkpoint = await checkpointRes.json();
  const resolvedByReferences = await post(
    `/api/projects/${project.id}/messages/${unresolved.id}/resolve`,
    {
      agent: 'Gemini',
      responseMessageId: responseMessage.id,
      checkpointId: checkpoint.id,
    },
  );
  assert.equal(resolvedByReferences.status, 200);
  const referencedResolution = await resolvedByReferences.json();
  assert.equal(referencedResolution.responseMessageId, responseMessage.id);
  assert.equal(referencedResolution.checkpointId, checkpoint.id);
});

test('Portability Bundle API: export canonical format and atomic import with ID remapping', async (t) => {
  const { post, get } = await fixture(t);
  const projRes = await post('/api/projects', {
    name: 'Projeto Exportável',
    objective: 'Testar criação canônica de pacote e importação sob transação',
    workspacePath: 'D:\\projetos\\fake',
  });
  const proj = await projRes.json();

  const taskRes = await post(`/api/projects/${proj.id}/tasks`, { title: 'Tarefa de Teste' });
  const task = await taskRes.json();
  await post(`/api/projects/${proj.id}/tasks/${task.id}/claim`, { agent: 'Gemini', expectedVersion: 0 });

  await post(`/api/projects/${proj.id}/checkpoints`, {
    expectedRevision: 0,
    idempotencyKey: 'cp-export-1',
    taskId: task.id,
    agent: 'Gemini',
    summary: 'Resumo inicial com segredo API_KEY=supersecret123',
    nextStep: 'Importar em outro ambiente',
    evidence: [{ command: 'npm test', outcome: 'passed', details: 'OK', provenance: 'agent_report' }],
  });

  // Exportar bundle
  const bundleRes = await get(`/api/projects/${proj.id}/bundle`);
  assert.equal(bundleRes.status, 200);
  const bundle = await bundleRes.json();

  assert.equal(bundle.format, 'axon-project');
  // O padrao e a v3: exportar sem declarar versao nao pode perder charter,
  // decisoes, bloqueios, Biblioteca, rascunhos, eventos nem contratos de tarefa.
  assert.equal(bundle.version, 3);
  assert.ok(Array.isArray(bundle.omissions) && bundle.omissions.length > 0);
  assert.ok(bundle.exportedAt);
  assert.ok(Array.isArray(bundle.backlogItems));
  assert.ok(Array.isArray(bundle.deliveries));
  assert.ok(Array.isArray(bundle.deliveryReceipts));
  // Segredos devem estar mascarados
  assert.ok(!bundle.project.checkpoints[0].summary.includes('supersecret123'));
  assert.ok(bundle.project.checkpoints[0].summary.includes('API_KEY=***'));

  // Importar o pacote como novo projeto
  const importRes = await post('/api/import', { bundle });
  assert.equal(importRes.status, 201);
  const importResult = await importRes.json();

  assert.ok(importResult.project.id);
  assert.notEqual(importResult.project.id, proj.id);
  assert.equal(importResult.sourceProjectId, proj.id);
  assert.ok(importResult.idMap[task.id]);

  // Verificar que tarefas foram redefinidas para 'todo' e sem lease ativo
  const importedDetailRes = await get(`/api/projects/${importResult.project.id}`);
  const importedDetail = await importedDetailRes.json();
  assert.equal(importedDetail.tasks.length, 1);
  assert.equal(importedDetail.tasks[0].status, 'todo');
  assert.equal(importedDetail.tasks[0].assignee, null);
  assert.equal(importedDetail.tasks[0].leaseUntil, null);

  // Invariante de evidência: provenance é forçado a agent_report
  assert.equal(importedDetail.checkpoints[0].evidence[0].provenance, 'agent_report');

  // Rejeição de pacote malformado
  const badImport = await post('/api/import', { bundle: { format: 'wrong-format', version: 99 } });
  assert.equal(badImport.status, 400);
});

test('Inspect API: selective file inspection strictly using registered workspacePath', async (t) => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'axon-inspect-test-'));
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  // Criar arquivo seguro e arquivo proibido no workspace
  writeFileSync(path.join(tmpDir, 'info.txt'), 'Linha 1 do arquivo de teste.\nLinha 2 com texto normal.');
  writeFileSync(path.join(tmpDir, '.env'), 'SECRET_KEY=123456');

  const { post } = await fixture(t);
  const projRes = await post('/api/projects', {
    name: 'Projeto Inspecionável',
    objective: 'Inspecionar arquivos no workspace seguro',
    workspacePath: tmpDir,
  });
  const proj = await projRes.json();

  // Inspeção de arquivo permitido
  const inspectRes = await post(`/api/projects/${proj.id}/inspect`, {
    files: ['info.txt'],
    maxChars: 4000,
    workspacePath: 'C:\\tentativa\\de\\spoofing', // Deve ser categoricamente ignorado
  });
  assert.equal(inspectRes.status, 200);
  const inspection = await inspectRes.json();

  assert.equal(inspection.workspacePath, tmpDir);
  assert.equal(inspection.files.length, 1);
  assert.equal(inspection.files[0].relativePath, 'info.txt');
  assert.match(inspection.files[0].content, /Linha 1 do arquivo de teste/);
  assert.ok(inspection.markdown.includes('Relatório de Inspeção Seletiva de Contexto'));
  assert.ok(inspection.disclaimer.includes('AVISO DE SEGURANÇA'));

  // Tentativa de path traversal ou leitura de arquivo na blacklist
  const inspectBlacklist = await post(`/api/projects/${proj.id}/inspect`, {
    files: ['.env', '../fora.txt'],
    maxChars: 4000,
  });
  assert.equal(inspectBlacklist.status, 200);
  const blacklistResult = await inspectBlacklist.json();
  assert.ok(blacklistResult.warnings.length >= 2);
  assert.equal(blacklistResult.files[0].content, null);

  // Projeto sem workspacePath cadastrado deve retornar erro 400
  const noWsProj = await post('/api/projects', { name: 'Sem WS', objective: 'Sem workspace' });
  const noWsData = await noWsProj.json();
  const noWsInspect = await post(`/api/projects/${noWsData.id}/inspect`, { files: ['info.txt'] });
  assert.equal(noWsInspect.status, 400);
  const noWsErr = await noWsInspect.json();
  assert.equal(noWsErr.error.code, 'workspace_path_missing');
});

test('HTTP não expõe descoberta de provedores nem rotas de execução', async (t) => {
  const { post, get } = await fixture(t);
  const projRes = await post('/api/projects', { name: 'P1', objective: 'Obj1' });
  const proj = await projRes.json();

  const notFound = async (response: Response) => {
    assert.equal(response.status, 404);
    // route_not_found prova que a rota não existe (e não só que um registro não foi achado).
    assert.equal((await response.json()).error.code, 'route_not_found');
  };

  await notFound(await get('/api/agents'));
  await notFound(await get(`/api/projects/${proj.id}/runs`));
  await notFound(await post(`/api/projects/${proj.id}/runs`, {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    instruction: 'Faça algo',
    executable: 'C:\\falso\\grok.exe',
  }));
  await notFound(await get(`/api/projects/${proj.id}/runs/run-999`));
  await notFound(await post(`/api/projects/${proj.id}/runs/run-999/cancel`, {}));
});

test('createApp e index não recebem nem instanciam runtime de execução', () => {
  const appSrc = readFileSync(new URL('../server/app.ts', import.meta.url), 'utf8');
  const indexSrc = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
  assert.equal(appSrc.includes('options.runtime'), false);
  assert.equal(appSrc.includes('/api/agents'), false);
  assert.equal(appSrc.includes('/runs'), false);
  assert.match(appSrc, /export function createApp\(store: WorkspaceStore\)/);
  assert.equal(indexSrc.includes('AgentRuntime'), false);
  assert.equal(indexSrc.includes('axonEnableRunner'), false);
  assert.equal(indexSrc.includes('getRunnerRoots'), false);
  assert.equal(indexSrc.includes('getRunnerExecutables'), false);
  assert.equal(createApp.length, 1);

  const archivedInvariant =
    'foi arquivado deliberadamente em 040d97b: a Axon não inicia, cancela, agenda nem monitora modelos. ' +
    'Recuperar esse código exige ordem explícita do usuário.';
  assert.equal(
    existsSync(new URL('../server/runtime', import.meta.url)),
    false,
    `server/runtime ${archivedInvariant}`,
  );
  assert.equal(
    existsSync(new URL('../shared/runtime.ts', import.meta.url)),
    false,
    `shared/runtime.ts ${archivedInvariant}`,
  );
  assert.equal(
    existsSync(new URL('../server/extensions.ts', import.meta.url)),
    false,
    `server/extensions.ts ${archivedInvariant}`,
  );
});

test('HTTP finalize_work salva checkpoint, passagem e libera a tarefa sem criar leitura', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', { name: 'Saída HTTP', objective: 'Encerrar numa transação' });
  const project = await created.json();
  const taskRes = await post(`/api/projects/${project.id}/tasks`, { title: 'Fechar' });
  const task = await taskRes.json();
  await post(`/api/projects/${project.id}/tasks/${task.id}/claim`, { agent: 'Gemini', expectedVersion: 0 });
  const finalized = await post(`/api/projects/${project.id}/finalize`, {
    agent: 'Gemini',
    expectedRevision: 0,
    idempotencyKey: 'http-finalize-1',
    taskId: task.id,
    summary: 'Sessão encerrada',
    nextStep: 'Ler a passagem',
    delivery: { to: 'Grok', message: 'Siga o próximo passo.' },
    taskTransition: { kind: 'release' },
  });
  assert.equal(finalized.status, 201);
  const body = await finalized.json();
  assert.equal(body.checkpoint.revision, 1);
  assert.equal(body.delivery.to, 'Grok');
  assert.equal(body.task.assignee, null);
  const retry = await post(`/api/projects/${project.id}/finalize`, {
    agent: 'Gemini',
    expectedRevision: 0,
    idempotencyKey: 'http-finalize-1',
    taskId: task.id,
    summary: 'Sessão encerrada',
    nextStep: 'Ler a passagem',
    delivery: { to: 'Grok', message: 'Siga o próximo passo.' },
    taskTransition: { kind: 'release' },
  });
  assert.equal(retry.status, 201);
  const retried = await retry.json();
  assert.equal(retried.checkpoint.id, body.checkpoint.id);
  const closed = await post(`/api/projects/${project.id}/finalize`, {
    agent: 'Gemini',
    expectedRevision: 1,
    idempotencyKey: 'http-finalize-done',
    summary: 'Feito',
    nextStep: 'Nada',
    taskTransition: { kind: 'declare_done' },
  });
  assert.equal(closed.status, 400);
  const inbox = await (await get(`/api/projects/${project.id}/inbox?agent=Grok`)).json();
  assert.equal(inbox.length, 0);
});

test('HTTP charter e bloqueio: revisão com CAS e resolução explícita', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', { name: 'Diretrizes', objective: 'Objetivo inicial do charter.' });
  const project = await created.json();
  const charter = await (await get(`/api/projects/${project.id}/charter`)).json();
  assert.equal(charter.revision, 1);
  const saved = await post(`/api/projects/${project.id}/charter`, {
    actor: 'humano',
    expectedRevision: 1,
    body: 'Objetivo revisado do charter.',
  });
  assert.equal(saved.status, 200);
  const next = await saved.json();
  assert.equal(next.revision, 2);
  const opened = await post(`/api/projects/${project.id}/blockers`, {
    agent: 'Gemini',
    title: 'Sem backup',
    body: 'Ainda não há cópia remota.',
  });
  assert.equal(opened.status, 201);
  const blocker = await opened.json();
  const resume = await (await get(`/api/projects/${project.id}/resume?agent=Gemini`)).json();
  assert.equal(resume.charter.revision, 2);
  assert.equal(resume.blockers.length, 1);
  const resolved = await post(`/api/projects/${project.id}/blockers/${blocker.id}/resolve`, {
    agent: 'humano',
    expectedVersion: 0,
    note: 'Backup local foi feito.',
  });
  assert.equal(resolved.status, 200);
  const after = await (await get(`/api/projects/${project.id}/resume?agent=Gemini`)).json();
  assert.equal(after.blockers.length, 0);
});

test('HTTP claim com intenção avisa sobreposição de escrita e não recusa a reserva', async (t) => {
  const { post } = await fixture(t);
  const created = await post('/api/projects', { name: 'Paralelo HTTP', objective: 'Avisar sem lock' });
  const project = await created.json();
  const a = await (await post(`/api/projects/${project.id}/tasks`, { title: 'Núcleo' })).json();
  const b = await (await post(`/api/projects/${project.id}/tasks`, { title: 'Testes' })).json();
  const intent = {
    objective: 'Editar o store',
    areas: [{ kind: 'file_path', locator: 'server/store.ts', access: 'write' }],
    expectedOutputs: ['aviso visível'],
    plannedChecks: ['npm test'],
  };
  const first = await post(`/api/projects/${project.id}/tasks/${a.id}/claim`, {
    agent: 'Gemini',
    expectedVersion: 0,
    intent,
  });
  assert.equal(first.status, 200);
  const second = await post(`/api/projects/${project.id}/tasks/${b.id}/claim`, {
    agent: 'Grok',
    expectedVersion: 0,
    intent,
  });
  assert.equal(second.status, 200);
  const body = await second.json();
  assert.equal(body.status, 'in_progress');
  assert.equal(body.overlaps.length, 1);
  assert.match(body.overlaps[0].explanation, /não é um lock/i);
});

test('HTTP reabre tarefa concluída e recusa claim enquanto estiver fechada', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', { name: 'Estados HTTP', objective: 'Blocked e done' });
  const project = await created.json();
  const taskRes = await post(`/api/projects/${project.id}/tasks`, { title: 'Fechar fatia' });
  const task = await taskRes.json();
  await post(`/api/projects/${project.id}/tasks/${task.id}/claim`, { agent: 'Gemini', expectedVersion: 0 });
  const done = await post(`/api/projects/${project.id}/finalize`, {
    agent: 'Gemini',
    expectedRevision: 0,
    idempotencyKey: 'http-done-1',
    taskId: task.id,
    summary: 'Concluído segundo o agente',
    nextStep: 'Só reabrir se precisar',
    taskTransition: { kind: 'declare_done' },
  });
  assert.equal(done.status, 201);
  const body = await done.json();
  assert.equal(body.task.status, 'done');
  const claim = await post(`/api/projects/${project.id}/tasks/${task.id}/claim`, {
    agent: 'Grok',
    expectedVersion: body.task.version,
  });
  assert.equal(claim.status, 409);
  const reopened = await post(`/api/projects/${project.id}/tasks/${task.id}/reopen`, {
    agent: 'Grok',
    expectedVersion: body.task.version,
    note: 'A revisão pediu um ajuste.',
  });
  assert.equal(reopened.status, 200);
  const opened = await reopened.json();
  assert.equal(opened.status, 'todo');
  const events = await (await get(`/api/projects/${project.id}/tasks/${task.id}/events`)).json();
  assert.equal(events.length, 2);
  assert.equal(events[1].toStatus, 'todo');
});

test('HTTP e MCP expõem rascunho de emergência sem virar checkpoint', async (t) => {
  const { post, get, store } = await fixture(t);
  const created = await post('/api/projects', {
    name: 'Rascunho HTTP',
    objective: 'Salvar emergência sem entregar',
  });
  const project = await created.json();
  const saved = await post(`/api/projects/${project.id}/drafts`, {
    agent: 'Gemini',
    expectedVersion: 0,
    summary: 'Sessão caiu no meio da edição',
    nextAction: 'Reabrir o arquivo e conferir o teste',
  });
  assert.equal(saved.status, 200);
  const draft = await saved.json();
  assert.equal(draft.status, 'undelivered');
  assert.equal(store.getProject(project.id).project.revision, 0);

  const listed = await get(`/api/projects/${project.id}/drafts?agent=Gemini`);
  assert.equal(listed.status, 200);
  const drafts = await listed.json();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, draft.id);

  const resume = await (await get(`/api/projects/${project.id}/resume?agent=Gemini`)).json();
  assert.equal(resume.workDraft.id, draft.id);
  assert.equal(resume.latestCheckpoint, null);
  assert.match(resume.markdown, /Rascunho não entregue/);
  assert.match(resume.markdown, /não é um checkpoint/);

  const discarded = await post(`/api/projects/${project.id}/drafts/discard`, {
    agent: 'Gemini',
    expectedVersion: 0,
  });
  assert.equal(discarded.status, 200);
  const after = await (await get(`/api/projects/${project.id}/resume?agent=Gemini`)).json();
  assert.equal(after.workDraft, null);
});

test('GET /api/projects/:id/resume devolve o brief do store e valida o agente', async (t) => {
  const { post, get, store } = await fixture(t);
  const created = await post('/api/projects', {
    name: 'Retomada HTTP',
    objective: 'Expor brief sem executar modelo',
  });
  const project = await created.json();
  const taskRes = await post(`/api/projects/${project.id}/tasks`, { title: 'Ler a caixa' });
  const task = await taskRes.json();
  await post(`/api/projects/${project.id}/tasks/${task.id}/claim`, { agent: 'Gemini', expectedVersion: 0 });
  await post(`/api/projects/${project.id}/messages`, {
    from: 'Grok',
    to: 'Gemini',
    kind: 'question',
    body: 'Pode retomar a partir do checkpoint?',
  });

  const missingAgent = await get(`/api/projects/${project.id}/resume`);
  assert.equal(missingAgent.status, 400);
  assert.equal((await missingAgent.json()).error.code, 'invalid_input');

  const response = await get(`/api/projects/${project.id}/resume?agent=Gemini`);
  assert.equal(response.status, 200);
  const body = await response.json();
  const fromStore = store.getResumeBrief(project.id, 'Gemini');
  assert.equal(body.project.id, project.id);
  assert.equal(body.focusTask.id, task.id);
  assert.equal(fromStore.focusTask?.id, task.id);
  assert.equal(body.inbox.length, 1);
  assert.equal(body.inbox[0].message.body, 'Pode retomar a partir do checkpoint?');
  assert.equal(body.attention[0].kind, 'question');
  assert.equal(body.revision, fromStore.revision);
  assert.match(body.markdown, /não confiável/i);
  assert.match(body.markdown, /Ler a caixa/);
});

test('GET /api/projects/:id/resume encaminha taskId opcional e preserva erros do domínio', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', {
    name: 'Retomada HTTP por tarefa',
    objective: 'Fixar o contexto na tarefa solicitada',
  });
  const project = await created.json();
  await post(`/api/projects/${project.id}/tasks`, { title: 'Tarefa sem foco' });
  const targetRes = await post(`/api/projects/${project.id}/tasks`, { title: 'Tarefa solicitada' });
  const target = await targetRes.json();

  const legacy = await get(`/api/projects/${project.id}/resume?agent=Gemini`);
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json()).focusTask, null);

  const focused = await get(
    `/api/projects/${project.id}/resume?agent=Gemini&taskId=${encodeURIComponent(target.id)}`,
  );
  assert.equal(focused.status, 200);
  assert.equal((await focused.json()).focusTask.id, target.id);

  const empty = await get(`/api/projects/${project.id}/resume?agent=Gemini&taskId=`);
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error.code, 'invalid_input');

  const repeated = await get(
    `/api/projects/${project.id}/resume?agent=Gemini&taskId=${target.id}&taskId=${target.id}`,
  );
  assert.equal(repeated.status, 400);
  assert.equal((await repeated.json()).error.code, 'invalid_input');

  const otherProjectRes = await post('/api/projects', {
    name: 'Outro projeto HTTP',
    objective: 'Comprovar isolamento de tarefas',
  });
  const otherProject = await otherProjectRes.json();
  const foreignTaskRes = await post(`/api/projects/${otherProject.id}/tasks`, {
    title: 'Tarefa estrangeira',
  });
  const foreignTask = await foreignTaskRes.json();
  const foreign = await get(
    `/api/projects/${project.id}/resume?agent=Gemini&taskId=${encodeURIComponent(foreignTask.id)}`,
  );
  assert.equal(foreign.status, 404);
  assert.equal((await foreign.json()).error.code, 'not_found');
});

test('GET /api/projects/:id/resume permite visão geral explícita sem perder o foco automático', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', {
    name: 'Modo de foco HTTP',
    objective: 'Alternar entre tarefa reservada e visão geral',
  });
  const project = await created.json();
  const taskRes = await post(`/api/projects/${project.id}/tasks`, {
    title: 'Tarefa reservada automaticamente',
  });
  const task = await taskRes.json();
  await post(`/api/projects/${project.id}/tasks/${task.id}/claim`, {
    agent: 'Gemini',
    expectedVersion: 0,
  });

  const automatic = await get(`/api/projects/${project.id}/resume?agent=Gemini`);
  assert.equal(automatic.status, 200);
  assert.equal((await automatic.json()).focusTask.id, task.id);

  const explicitAutomatic = await get(
    `/api/projects/${project.id}/resume?agent=Gemini&focusMode=auto`,
  );
  assert.equal(explicitAutomatic.status, 200);
  assert.equal((await explicitAutomatic.json()).focusTask.id, task.id);

  const overview = await get(
    `/api/projects/${project.id}/resume?agent=Gemini&focusMode=project`,
  );
  assert.equal(overview.status, 200);
  assert.equal((await overview.json()).focusTask, null);

  const conflicting = await get(
    `/api/projects/${project.id}/resume?agent=Gemini&taskId=${task.id}&focusMode=project`,
  );
  assert.equal(conflicting.status, 400);
  assert.equal((await conflicting.json()).error.code, 'invalid_input');

  const invalidMode = await get(
    `/api/projects/${project.id}/resume?agent=Gemini&focusMode=automatico`,
  );
  assert.equal(invalidMode.status, 400);
  assert.equal((await invalidMode.json()).error.code, 'invalid_input');
});

test('HandoffDelivery HTTP: cria, lista direta+broadcast, rejeita autor e confirma leitura', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', {
    name: 'Passagem HTTP',
    objective: 'Entregar checkpoint sem executar modelo',
  });
  const project = await created.json();
  const taskRes = await post(`/api/projects/${project.id}/tasks`, { title: 'Assumir listagem' });
  const task = await taskRes.json();
  await post(`/api/projects/${project.id}/tasks/${task.id}/claim`, { agent: 'Astra', expectedVersion: 0 });
  const checkpointRes = await post(`/api/projects/${project.id}/checkpoints`, {
    expectedRevision: 0,
    idempotencyKey: 'http-handoff-1',
    taskId: task.id,
    agent: 'Astra',
    summary: 'Contrato HTTP pronto.',
    nextStep: 'Confirmar a passagem no destinatário.',
  });
  const checkpoint = await checkpointRes.json();

  const createdDelivery = await post(`/api/projects/${project.id}/deliveries`, {
    checkpointId: checkpoint.id,
    from: 'Astra',
    to: 'Grok',
    message: 'Continue pela listagem e confirme a leitura.',
  });
  assert.equal(createdDelivery.status, 201);
  const delivery = await createdDelivery.json();
  assert.equal(delivery.checkpointId, checkpoint.id);
  assert.equal(delivery.taskId, task.id);
  assert.equal(delivery.from, 'Astra');
  assert.equal(delivery.to, 'Grok');
  assert.equal(delivery.message, 'Continue pela listagem e confirme a leitura.');
  assert.equal(delivery.checkpoint.summary, 'Contrato HTTP pronto.');
  assert.equal(delivery.task.title, 'Assumir listagem');
  assert.equal(delivery.acknowledgedAt, null);

  const mismatch = await post(`/api/projects/${project.id}/deliveries`, {
    checkpointId: checkpoint.id,
    from: 'Grok',
    to: 'Astra',
    message: 'Autor errado.',
  });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).error.code, 'handoff_author_mismatch');

  const other = await post('/api/projects', { name: 'Outro', objective: 'Isolar checkpoint' });
  const otherProject = await other.json();
  const foreign = await post(`/api/projects/${otherProject.id}/deliveries`, {
    checkpointId: checkpoint.id,
    from: 'Astra',
    to: 'Grok',
    message: 'Checkpoint de outro projeto.',
  });
  assert.equal(foreign.status, 404);

  const broadcastRes = await post(`/api/projects/${project.id}/deliveries`, {
    checkpointId: checkpoint.id,
    from: 'Astra',
    to: '*',
    message: 'Aviso geral da passagem.',
  });
  assert.equal(broadcastRes.status, 201);
  const broadcast = await broadcastRes.json();

  const listedRes = await get(`/api/projects/${project.id}/deliveries?agent=Grok`);
  assert.equal(listedRes.status, 200);
  const listed = await listedRes.json();
  assert.equal(listed.length, 2);
  assert.deepEqual(listed.map((item: { id: string }) => item.id), [delivery.id, broadcast.id]);

  const missingAgent = await get(`/api/projects/${project.id}/deliveries`);
  assert.equal(missingAgent.status, 400);

  const forbiddenAck = await post(`/api/projects/${project.id}/deliveries/${delivery.id}/ack`, { agent: 'Outro' });
  assert.equal(forbiddenAck.status, 409);
  assert.equal((await forbiddenAck.json()).error.code, 'recipient_mismatch');

  const ackRes = await post(`/api/projects/${project.id}/deliveries/${delivery.id}/ack`, { agent: 'Grok' });
  assert.equal(ackRes.status, 200);
  const ack = await ackRes.json();
  assert.equal(ack.deliveryId, delivery.id);
  const ackRetry = await post(`/api/projects/${project.id}/deliveries/${delivery.id}/ack`, { agent: 'Grok' });
  assert.equal((await ackRetry.json()).acknowledgedAt, ack.acknowledgedAt);

  const unreadRes = await get(`/api/projects/${project.id}/deliveries?agent=Grok&unreadOnly=true`);
  const unread = await unreadRes.json();
  assert.equal(unread.length, 1);
  assert.equal(unread[0].id, broadcast.id);

  const resumeRes = await get(`/api/projects/${project.id}/resume?agent=Grok`);
  assert.equal(resumeRes.status, 200);
  const resume = await resumeRes.json();
  assert.equal(resume.deliveries.length, 2);
  assert.ok(resume.attention.some((item: { kind: string; sourceId: string }) => item.kind === 'handoff' && item.sourceId === broadcast.id));
  assert.match(resume.markdown, /Passagens de trabalho/);
});

test('MCP Server: registers search, inbox, ack, bundle, resume tools, excludes inspect and runner', async (t) => {
  const store = new WorkspaceStore(':memory:');
  const server = createMcpServer(store);
  const client = new Client({ name: 'axon-tool-list-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await server.close();
    store.close();
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listing = await client.listTools();
  const names = listing.tools.map(tool => tool.name);
  for (const name of ['search_projects', 'get_inbox', 'acknowledge_message', 'resolve_message_attention', 'export_project_bundle', 'import_project_bundle', 'get_resume_brief', 'create_handoff_delivery', 'get_handoff_deliveries', 'acknowledge_handoff_delivery', 'save_work_draft', 'get_work_drafts', 'discard_work_draft', 'finalize_work', 'reopen_task', 'get_task_events', 'create_backlog_item', 'get_backlog', 'update_backlog_item', 'promote_backlog_item', 'archive_backlog_item', 'propose_decision', 'accept_decision', 'revoke_decision', 'supersede_decision', 'get_decisions']) {
    assert.ok(names.includes(name), name + ' deve estar registrado');
  }
  for (const name of ['inspect_workspace', 'inspect', 'create_run', 'list_runs', 'start_run', 'cancel_run']) {
    assert.ok(!names.includes(name), name + ' nao deve estar no MCP');
  }

  const project = store.createProject({ name: 'MCP brief', objective: 'Consultar caixa sem executar' });
  const called = await client.callTool({ name: 'get_resume_brief', arguments: { projectId: project.id, agent: 'Gemini' } });
  assert.equal(called.isError, undefined);
  const content = called.content as Array<{ type: string; text: string }>;
  const brief = JSON.parse(content[0].text);
  assert.equal(brief.project.id, project.id);
  assert.equal(brief.focusTask, null);
  assert.match(brief.markdown, /não confiável/i);

  const target = store.createTask(project.id, { title: 'Foco explícito MCP' });
  const focused = await client.callTool({
    name: 'get_resume_brief',
    arguments: { projectId: project.id, agent: 'Gemini', taskId: target.id },
  });
  assert.equal(focused.isError, undefined);
  const focusedContent = focused.content as Array<{ type: string; text: string }>;
  const focusedBrief = JSON.parse(focusedContent[0].text);
  assert.equal(focusedBrief.focusTask.id, target.id);

  const invalid = await client.callTool({
    name: 'get_resume_brief',
    arguments: { projectId: project.id, agent: 'Gemini', taskId: '' },
  });
  assert.equal(invalid.isError, true);
  const invalidContent = invalid.content as Array<{ type: string; text: string }>;
  assert.equal(JSON.parse(invalidContent[0].text).error.code, 'invalid_input');

  const otherProject = store.createProject({
    name: 'Outro projeto MCP',
    objective: 'Comprovar isolamento de tarefas',
  });
  const foreignTask = store.createTask(otherProject.id, { title: 'Tarefa estrangeira MCP' });
  const foreign = await client.callTool({
    name: 'get_resume_brief',
    arguments: { projectId: project.id, agent: 'Gemini', taskId: foreignTask.id },
  });
  assert.equal(foreign.isError, true);
  const foreignContent = foreign.content as Array<{ type: string; text: string }>;
  assert.equal(JSON.parse(foreignContent[0].text).error.code, 'not_found');

  const claimed = store.claimTask(project.id, target.id, {
    agent: 'Gemini',
    expectedVersion: target.version,
  });
  assert.equal(claimed.assignee, 'Gemini');
  const projectOverview = await client.callTool({
    name: 'get_resume_brief',
    arguments: { projectId: project.id, agent: 'Gemini', focusMode: 'project' },
  });
  assert.equal(projectOverview.isError, undefined);
  const overviewContent = projectOverview.content as Array<{ type: string; text: string }>;
  assert.equal(JSON.parse(overviewContent[0].text).focusTask, null);

  const conflictingFocus = await client.callTool({
    name: 'get_resume_brief',
    arguments: {
      projectId: project.id,
      agent: 'Gemini',
      taskId: target.id,
      focusMode: 'project',
    },
  });
  assert.equal(conflictingFocus.isError, true);
  const conflictContent = conflictingFocus.content as Array<{ type: string; text: string }>;
  assert.equal(JSON.parse(conflictContent[0].text).error.code, 'invalid_input');

  const invalidFocus = await client.callTool({
    name: 'get_resume_brief',
    arguments: { projectId: project.id, agent: 'Gemini', focusMode: 'automatico' },
  });
  assert.equal(invalidFocus.isError, true);
  const invalidFocusContent = invalidFocus.content as Array<{ type: string; text: string }>;
  assert.equal(JSON.parse(invalidFocusContent[0].text).error.code, 'invalid_input');

  const question = store.postMessage(project.id, {
    from: 'Astra',
    to: 'Gemini',
    kind: 'review',
    body: 'A retomada está bem separada?',
  });
  const resolution = await client.callTool({
    name: 'resolve_message_attention',
    arguments: {
      projectId: project.id,
      messageId: question.id,
      agent: 'Gemini',
      note: 'Sim, a tarefa e o projeto estão separados.',
    },
  });
  assert.equal(resolution.isError, undefined);
  const resolutionContent = resolution.content as Array<{ type: string; text: string }>;
  const resolutionData = JSON.parse(resolutionContent[0].text);
  assert.equal(resolutionData.messageId, question.id);

  const resolutionRetry = await client.callTool({
    name: 'resolve_message_attention',
    arguments: {
      projectId: project.id,
      messageId: question.id,
      agent: 'Gemini',
      note: 'Sim, a tarefa e o projeto estão separados.',
    },
  });
  assert.equal(resolutionRetry.isError, undefined);
  const retryContent = resolutionRetry.content as Array<{ type: string; text: string }>;
  assert.deepEqual(JSON.parse(retryContent[0].text), resolutionData);

  const resolutionConflict = await client.callTool({
    name: 'resolve_message_attention',
    arguments: {
      projectId: project.id,
      messageId: question.id,
      agent: 'Gemini',
      note: 'Texto divergente.',
    },
  });
  assert.equal(resolutionConflict.isError, true);
  const resolutionConflictContent = resolutionConflict.content as Array<{ type: string; text: string }>;
  assert.equal(
    JSON.parse(resolutionConflictContent[0].text).error.code,
    'resolution_conflict',
  );

  const inboxAfterResolution = store.getInbox(project.id, 'Gemini');
  const resolvedInboxItem = inboxAfterResolution.find((item) => item.message.id === question.id);
  assert.equal(resolvedInboxItem?.acknowledgedAt, null);
  assert.equal(resolvedInboxItem?.resolution?.resolvedAt, resolutionData.resolvedAt);
  assert.equal(
    store
      .getResumeBrief(project.id, 'Gemini')
      .attention.some((item) => item.sourceId === question.id),
    false,
  );

  const reviewForOther = store.postMessage(project.id, {
    from: 'Astra',
    to: 'Grok',
    kind: 'review',
    body: 'Revisão destinada ao Grok.',
  });
  const wrongResolver = await client.callTool({
    name: 'resolve_message_attention',
    arguments: {
      projectId: project.id,
      messageId: reviewForOther.id,
      agent: 'Gemini',
      note: 'Destinatário incorreto.',
    },
  });
  assert.equal(wrongResolver.isError, true);
  const wrongResolverContent = wrongResolver.content as Array<{ type: string; text: string }>;
  assert.equal(JSON.parse(wrongResolverContent[0].text).error.code, 'recipient_mismatch');

  const plainNote = store.postMessage(project.id, {
    from: 'Astra',
    to: 'Gemini',
    kind: 'note',
    body: 'Nota não possui ciclo de resolução.',
  });
  const wrongKind = await client.callTool({
    name: 'resolve_message_attention',
    arguments: {
      projectId: project.id,
      messageId: plainNote.id,
      agent: 'Gemini',
      note: 'Não deve resolver.',
    },
  });
  assert.equal(wrongKind.isError, true);
  const wrongKindContent = wrongKind.content as Array<{ type: string; text: string }>;
  assert.equal(JSON.parse(wrongKindContent[0].text).error.code, 'attention_not_resolvable');

  const unresolvedQuestion = store.postMessage(project.id, {
    from: 'Astra',
    to: 'Gemini',
    kind: 'question',
    body: 'Qual referência fecha esta pergunta?',
  });
  const emptyResolution = await client.callTool({
    name: 'resolve_message_attention',
    arguments: {
      projectId: project.id,
      messageId: unresolvedQuestion.id,
      agent: 'Gemini',
    },
  });
  assert.equal(emptyResolution.isError, true);
  const emptyResolutionContent = emptyResolution.content as Array<{ type: string; text: string }>;
  assert.equal(JSON.parse(emptyResolutionContent[0].text).error.code, 'invalid_input');

  const unknownReference = await client.callTool({
    name: 'resolve_message_attention',
    arguments: {
      projectId: project.id,
      messageId: unresolvedQuestion.id,
      agent: 'Gemini',
      checkpointId: randomUUID(),
    },
  });
  assert.equal(unknownReference.isError, true);
  const unknownReferenceContent = unknownReference.content as Array<{ type: string; text: string }>;
  assert.equal(JSON.parse(unknownReferenceContent[0].text).error.code, 'not_found');

  const responseByOther = store.postMessage(project.id, {
    from: 'Grok',
    to: 'Astra',
    kind: 'note',
    body: 'Resposta de outro agente.',
  });
  const mismatchedReference = await client.callTool({
    name: 'resolve_message_attention',
    arguments: {
      projectId: project.id,
      messageId: unresolvedQuestion.id,
      agent: 'Gemini',
      responseMessageId: responseByOther.id,
    },
  });
  assert.equal(mismatchedReference.isError, true);
  const mismatchedReferenceContent = mismatchedReference.content as Array<{
    type: string;
    text: string;
  }>;
  assert.equal(
    JSON.parse(mismatchedReferenceContent[0].text).error.code,
    'resolution_reference_author_mismatch',
  );
});

test('Backlog HTTP: CRUD, CAS, promoção idempotente e isolamento', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', {
    name: 'Backlog HTTP',
    objective: 'Capturar ideias antes da tarefa',
  });
  const project = await created.json();
  const otherRes = await post('/api/projects', { name: 'Outro', objective: 'Isolar backlog' });
  const other = await otherRes.json();

  const createRes = await post(`/api/projects/${project.id}/backlog`, {
    title: '  Preparar handoff  ',
    createdBy: 'Astra',
    description: 'Ainda é ideia.',
    priority: 'high',
  });
  assert.equal(createRes.status, 201);
  const item = await createRes.json();
  assert.equal(item.title, 'Preparar handoff');
  assert.equal(item.stage, 'idea');
  assert.equal(item.priority, 'high');
  assert.equal(item.version, 0);

  const listed = await (await get(`/api/projects/${project.id}/backlog`)).json();
  assert.equal(listed.length, 1);
  const foreign = await post(`/api/projects/${other.id}/backlog/${item.id}/update`, {
    expectedVersion: 0,
    title: 'Invasão',
  });
  assert.equal(foreign.status, 404);

  const stale = await post(`/api/projects/${project.id}/backlog/${item.id}/update`, {
    expectedVersion: 9,
    stage: 'ready',
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, 'backlog_version_conflict');

  const readyRes = await post(`/api/projects/${project.id}/backlog/${item.id}/update`, {
    expectedVersion: 0,
    stage: 'ready',
  });
  assert.equal(readyRes.status, 200);
  const ready = await readyRes.json();
  assert.equal(ready.stage, 'ready');
  assert.equal(ready.version, 1);

  const promoteRes = await post(`/api/projects/${project.id}/backlog/${item.id}/promote`, {});
  assert.equal(promoteRes.status, 200);
  const promoted = await promoteRes.json();
  assert.equal(promoted.item.stage, 'promoted');
  assert.equal(promoted.task.title, 'Preparar handoff');
  const promoteAgain = await post(`/api/projects/${project.id}/backlog/${item.id}/promote`, {});
  assert.equal(promoteAgain.status, 200);
  const replay = await promoteAgain.json();
  assert.equal(replay.task.id, promoted.task.id);

  const closed = await (await get(`/api/projects/${project.id}/backlog`)).json();
  assert.equal(closed.length, 0);
  const withClosed = await (await get(`/api/projects/${project.id}/backlog?includeClosed=true`)).json();
  assert.equal(withClosed.length, 1);

  const archiveRes = await post(`/api/projects/${project.id}/backlog/${item.id}/archive`, { expectedVersion: promoted.item.version });
  assert.equal(archiveRes.status, 409);
});

test('Portability Bundle API v2: exporta backlog e passagem e importa com recibos remapeados', async (t) => {
  const { post, get } = await fixture(t);
  const projRes = await post('/api/projects', {
    name: 'Bundle v2 HTTP',
    objective: 'Exportar passagem e backlog',
  });
  const proj = await projRes.json();
  const taskRes = await post(`/api/projects/${proj.id}/tasks`, { title: 'Tarefa viva' });
  const task = await taskRes.json();
  await post(`/api/projects/${proj.id}/tasks/${task.id}/claim`, { agent: 'Astra', expectedVersion: 0 });
  const checkpointRes = await post(`/api/projects/${proj.id}/checkpoints`, {
    expectedRevision: 0,
    idempotencyKey: 'http-v2-cp',
    taskId: task.id,
    agent: 'Astra',
    summary: 'Resumo com API_KEY=supersecret-v2',
    nextStep: 'Seguir no destino',
  });
  const checkpoint = await checkpointRes.json();
  const deliveryRes = await post(`/api/projects/${proj.id}/deliveries`, {
    checkpointId: checkpoint.id,
    from: 'Astra',
    to: 'Grok',
    message: 'PASSWORD=nao-vazar',
  });
  const delivery = await deliveryRes.json();
  await post(`/api/projects/${proj.id}/deliveries/${delivery.id}/ack`, { agent: 'Grok' });
  await post(`/api/projects/${proj.id}/backlog`, {
    title: 'Ideia portátil',
    createdBy: 'Astra',
    priority: 'urgent',
  });

  const bundleRes = await get(`/api/projects/${proj.id}/bundle?version=2`);
  assert.equal(bundleRes.status, 200);
  const bundle = await bundleRes.json();
  assert.equal(bundle.version, 2);
  // A v2 e o formato mais pobre: ela precisa declarar o que deixou de levar.
  const omitidas = (bundle.omissions ?? []).map((o: { entity: string }) => o.entity);
  for (const entidade of ['charterRevisions', 'decisions', 'blockers', 'library']) {
    assert.ok(omitidas.includes(entidade), `v2 deve declarar que omite ${entidade}`);
  }
  assert.equal(bundle.backlogItems.length, 1);
  assert.equal(bundle.deliveries.length, 1);
  assert.equal(bundle.deliveryReceipts.length, 1);
  assert.equal(bundle.backlogItems[0].title, 'Ideia portátil');
  assert.equal(String(bundle.project.checkpoints[0].summary).includes('supersecret-v2'), false);
  assert.equal(String(bundle.deliveries[0].message).includes('nao-vazar'), false);

  const importRes = await post('/api/import', { bundle });
  assert.equal(importRes.status, 201);
  const imported = await importRes.json();
  const copyBacklog = await (await get(`/api/projects/${imported.project.id}/backlog`)).json();
  assert.equal(copyBacklog.length, 1);
  assert.equal(copyBacklog[0].title, 'Ideia portátil');
  const copyDeliveries = await (await get(`/api/projects/${imported.project.id}/deliveries?agent=Grok`)).json();
  assert.equal(copyDeliveries.length, 1);
  assert.ok(copyDeliveries[0].acknowledgedAt);
  assert.notEqual(copyDeliveries[0].id, delivery.id);
  assert.notEqual(copyDeliveries[0].checkpointId, checkpoint.id);
});

test('Decisões canônicas HTTP: propor, listar vigentes/histórico, aceitar, substituir com CAS e revogar', async (t) => {
  const { post, get } = await fixture(t);
  const projRes = await post('/api/projects', {
    name: 'Decisões HTTP',
    objective: 'Testar ciclo HTTP de decisões canônicas',
  });
  const proj = await projRes.json();

  // Propor decisão
  const propRes = await post(`/api/projects/${proj.id}/decisions`, {
    agent: 'Gemini',
    title: 'Adotar SQLite WAL',
    body: 'Usar modo WAL para leituras concorrentes.',
    note: 'Nota inicial',
  });
  assert.equal(propRes.status, 201);
  const d1 = await propRes.json();
  assert.equal(d1.status, 'proposed');
  assert.equal(d1.proposedBy, 'Gemini');
  assert.equal(d1.version, 0);

  // Não aparece como vigente
  const listVigenteRes = await get(`/api/projects/${proj.id}/decisions`);
  assert.equal(listVigenteRes.status, 200);
  const vigentes = await listVigenteRes.json();
  assert.equal(vigentes.length, 0);

  // Aparece no histórico
  const listHistRes = await get(`/api/projects/${proj.id}/decisions?includeHistory=true`);
  const history = await listHistRes.json();
  assert.equal(history.length, 1);
  assert.equal(history[0].id, d1.id);

  // Aceitar decisão
  const acceptRes = await post(`/api/projects/${proj.id}/decisions/${d1.id}/accept`, {
    actor: 'operador-teste',
    expectedVersion: 0,
  });
  assert.equal(acceptRes.status, 200);
  const accepted = await acceptRes.json();
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.acceptedBy, 'operador-teste');
  assert.equal(accepted.version, 1);

  // Agora é vigente
  const vigentes2 = await (await get(`/api/projects/${proj.id}/decisions`)).json();
  assert.equal(vigentes2.length, 1);
  assert.equal(vigentes2[0].id, d1.id);

  // Substituir (supersede) com CAS
  const supersedeRes = await post(`/api/projects/${proj.id}/decisions/${d1.id}/supersede`, {
    actor: 'operador-teste',
    expectedVersion: 1,
    title: 'Adotar WAL2',
    body: 'Atualizar para WAL2.',
    note: 'Substituição motivada por escala',
  });
  assert.equal(supersedeRes.status, 201);
  const d2 = await supersedeRes.json();
  assert.equal(d2.status, 'accepted');
  assert.equal(d2.supersedesId, d1.id);
  assert.equal(d2.proposedBy, 'operador-teste');
  assert.equal(d2.acceptedBy, 'operador-teste');

  // Somente d2 é vigente
  const vigentes3 = await (await get(`/api/projects/${proj.id}/decisions`)).json();
  assert.equal(vigentes3.length, 1);
  assert.equal(vigentes3[0].id, d2.id);

  // Revogar d2
  const revokeRes = await post(`/api/projects/${proj.id}/decisions/${d2.id}/revoke`, {
    actor: 'operador-teste',
    expectedVersion: 0,
    note: 'Revogada temporariamente',
  });
  assert.equal(revokeRes.status, 200);
  const revoked = await revokeRes.json();
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revokedBy, 'operador-teste');

  // Nenhuma vigente
  const vigentes4 = await (await get(`/api/projects/${proj.id}/decisions`)).json();
  assert.equal(vigentes4.length, 0);

  // Histórico completo tem as duas
  const historyFinal = await (await get(`/api/projects/${proj.id}/decisions?includeHistory=true`)).json();
  assert.equal(historyFinal.length, 2);
});

test('HTTP Biblioteca: cria, revisa, busca só a vigente e arquiva', async (t) => {
  const { post, get } = await fixture(t);
  const created = await post('/api/projects', { name: 'Memória', objective: 'Guardar fontes' });
  const project = await created.json();
  const made = await post(`/api/projects/${project.id}/content`, {
    title: 'Contrato',
    kind: 'specification',
    body: 'Usar o mecanismo aurora',
    createdBy: 'Astra',
    sourceKind: 'agent_report',
  });
  assert.equal(made.status, 201);
  const entry = await made.json();
  assert.equal(entry.item.status, 'active');
  assert.equal(entry.revision.revision, 1);

  const revised = await post(`/api/projects/${project.id}/content/${entry.item.id}/revise`, {
    expectedVersion: 0,
    body: 'A decisão vigente usa prisma',
    createdBy: 'Humano',
    sourceKind: 'human_directive',
    sourceLabel: 'Revisão manual',
  });
  assert.equal(revised.status, 200);
  const next = await revised.json();
  assert.equal(next.item.version, 1);
  assert.equal(next.revision.body, 'A decisão vigente usa prisma');

  const searchOld = await (await get(`/api/projects/${project.id}/content/search?q=aurora`)).json();
  assert.equal(searchOld.length, 0);
  const searchNew = await (await get(`/api/projects/${project.id}/content/search?q=prisma`)).json();
  assert.equal(searchNew.length, 1);
  assert.equal(searchNew[0].source.kind, 'human_directive');

  const archived = await post(`/api/projects/${project.id}/content/${entry.item.id}/archive`, { expectedVersion: 1 });
  assert.equal(archived.status, 200);
  const listed = await (await get(`/api/projects/${project.id}/content`)).json();
  assert.equal(listed.length, 0);
});

test('MCP Server: registra propose_decision, accept_decision, revoke_decision, supersede_decision e get_decisions', async (t) => {
  const store = new WorkspaceStore(':memory:');
  const server = createMcpServer(store);
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  t.after(async () => {
    await client.close();
    await server.close();
    store.close();
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map((item) => item.name));
  assert.ok(toolNames.has('propose_decision'));
  assert.ok(toolNames.has('accept_decision'));
  assert.ok(toolNames.has('revoke_decision'));
  assert.ok(toolNames.has('supersede_decision'));
  assert.ok(toolNames.has('get_decisions'));
  assert.ok(toolNames.has('create_content'));
  assert.ok(toolNames.has('search_content'));
  assert.ok(toolNames.has('revise_content'));
  assert.ok(toolNames.has('archive_content'));

  const project = store.createProject({ name: 'MCP Decisões', objective: 'Testar MCP' });

  // 1. Propose
  const propCall = await client.callTool({
    name: 'propose_decision',
    arguments: {
      projectId: project.id,
      agent: 'Astra',
      title: 'Decisão MCP',
      body: 'Definição via protocolo MCP.',
    },
  });
  assert.equal(propCall.isError, undefined);
  const d1 = JSON.parse((propCall.content as Array<{ text: string }>)[0].text);
  assert.equal(d1.status, 'proposed');

  // 2. Get decisions (vigentes = vazio)
  const getCall1 = await client.callTool({
    name: 'get_decisions',
    arguments: { projectId: project.id },
  });
  const list1 = JSON.parse((getCall1.content as Array<{ text: string }>)[0].text);
  assert.equal(list1.length, 0);

  // 3. Accept
  const accCall = await client.callTool({
    name: 'accept_decision',
    arguments: {
      projectId: project.id,
      decisionId: d1.id,
      actor: 'Ana',
      expectedVersion: 0,
    },
  });
  assert.equal(accCall.isError, undefined);
  const acc = JSON.parse((accCall.content as Array<{ text: string }>)[0].text);
  assert.equal(acc.status, 'accepted');
  assert.equal(acc.acceptedBy, 'Ana');

  // 4. Supersede
  const supCall = await client.callTool({
    name: 'supersede_decision',
    arguments: {
      projectId: project.id,
      decisionId: d1.id,
      actor: 'Ana',
      expectedVersion: 1,
      title: 'Decisão MCP Substituta',
      body: 'Nova definição.',
    },
  });
  assert.equal(supCall.isError, undefined);
  const sup = JSON.parse((supCall.content as Array<{ text: string }>)[0].text);
  assert.equal(sup.status, 'accepted');
  assert.equal(sup.supersedesId, d1.id);

  // 5. Revoke
  const revCall = await client.callTool({
    name: 'revoke_decision',
    arguments: {
      projectId: project.id,
      decisionId: sup.id,
      actor: 'Ana',
      expectedVersion: 0,
    },
  });
  assert.equal(revCall.isError, undefined);
  const rev = JSON.parse((revCall.content as Array<{ text: string }>)[0].text);
  assert.equal(rev.status, 'revoked');
});

