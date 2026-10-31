import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApp } from '../server/app.js';
import { createMcpServer } from '../server/mcp-tools.js';
import { WorkspaceStore, DomainError } from '../server/store.js';

// U+FFFD e o "replacement character": o que sobra quando bytes invalidos sao
// decodificados como UTF-8. Texto legitimo praticamente nunca o contem, entao a
// presenca dele e sinal confiavel de que os acentos foram destruidos em transito.
// Foi exatamente o que aconteceu em uso real: um agente escreveu via curl num
// shell do Windows e "asserções" chegou como "asser��es" — perda
// irreversivel, gravada sem nenhum aviso.
const CORROMPIDO = 'asser��es novas no teste';

function projetoComTarefa(store: WorkspaceStore) {
  const project = store.createProject({ name: 'Integridade', objective: 'Guardar texto sem corromper' });
  const task = store.createTask(project.id, { title: 'Tarefa base' });
  return { project, task };
}

test('domínio recusa texto com U+FFFD em vez de gravar memória corrompida', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const { project } = projetoComTarefa(store);

    assert.throws(
      () => store.createTask(project.id, { title: CORROMPIDO }),
      (err: unknown) => {
        assert.ok(err instanceof DomainError);
        assert.equal(err.status, 400);
        assert.equal(err.code, 'corrupted_text');
        assert.match(err.message, /acentos|caracteres/i);
        return true;
      },
    );

    const detail = store.getProject(project.id);
    assert.throws(() =>
      store.saveCheckpoint(project.id, {
        expectedRevision: detail.project.revision,
        idempotencyKey: 'integridade-1',
        agent: 'Astra',
        summary: CORROMPIDO,
        nextStep: 'seguir',
      }),
    );

    // Nada corrompido pode ter sido gravado.
    const depois = store.getProject(project.id);
    assert.equal(depois.checkpoints.length, 0);
    assert.ok(depois.tasks.every(t => !t.title.includes('�')));
  } finally {
    store.close();
  }
});

test('domínio continua aceitando e preservando acentos normais do português', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const { project } = projetoComTarefa(store);
    const texto = 'Revisão de asserções: coração, ação, pão, avô, é, ü e ç preservados';
    const task = store.createTask(project.id, { title: texto });
    assert.equal(task.title, texto);
    assert.equal(store.getProject(project.id).tasks.find(t => t.id === task.id)?.title, texto);
  } finally {
    store.close();
  }
});

test('HTTP devolve 400 explicável quando o texto chega corrompido', async t => {
  const store = new WorkspaceStore(':memory:');
  const server = createServer(createApp(store));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
  });

  const { project } = projetoComTarefa(store);
  const res = await fetch(`${base}/api/projects/${project.id}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' },
    body: JSON.stringify({ title: CORROMPIDO }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'corrupted_text');
  assert.match(body.error.message, /acentos|caracteres/i);
});

test('MCP recusa texto corrompido com o mesmo código de erro do domínio', async t => {
  const store = new WorkspaceStore(':memory:');
  const server = createMcpServer(store);
  const client = new Client({ name: 'integridade-texto', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await server.close();
    store.close();
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const { project } = projetoComTarefa(store);
  const called = await client.callTool({
    name: 'create_task',
    arguments: { projectId: project.id, title: CORROMPIDO },
  });
  assert.equal(called.isError, true);
  const content = called.content as Array<{ type: string; text: string }>;
  assert.equal(JSON.parse(content[0].text).error.code, 'corrupted_text');
});
