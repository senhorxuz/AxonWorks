import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { WorkspaceStore } from '../server/store.js';

async function fixture(t: { after: (fn: () => void | Promise<void>) => void }) {
  const store = new WorkspaceStore(':memory:');
  const server = createServer(createApp(store));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); });
  const post = (path: string, body: unknown, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local', ...headers }, body: JSON.stringify(body) });
  return { store, base, post };
}

test('HTTP: project → claim → checkpoint → inbox → neutral Markdown', async t => {
  const { base, post } = await fixture(t);
  const created = await post('/api/projects', { name: 'Pesquisa visual', objective: 'Construir um acervo documentado' });
  assert.equal(created.status, 201);
  const project = await created.json();
  const taskResponse = await post(`/api/projects/${project.id}/tasks`, { title: 'Revisar fontes' });
  const task = await taskResponse.json();
  const claim = await post(`/api/projects/${project.id}/tasks/${task.id}/claim`, { agent: 'Grok', expectedVersion: 0 });
  assert.equal(claim.status, 200);
  const checkpoint = { expectedRevision: 0, idempotencyKey: 'http-checkpoint-1', taskId: task.id, agent: 'Grok', summary: 'Fontes identificadas', nextStep: 'Conferir fontes primárias' };
  assert.equal((await post(`/api/projects/${project.id}/checkpoints`, checkpoint)).status, 201);
  const retry = await post(`/api/projects/${project.id}/checkpoints`, checkpoint);
  assert.equal(retry.status, 201);
  const conflict = await post(`/api/projects/${project.id}/checkpoints`, { ...checkpoint, idempotencyKey: 'http-checkpoint-2' });
  assert.equal(conflict.status, 409);
  assert.equal(typeof (await conflict.json()).error.code, 'string');
  assert.equal((await post(`/api/projects/${project.id}/messages`, { from: 'Grok', to: 'Gemini', kind: 'review', body: 'Revise as fontes antes de prosseguir.' })).status, 201);
  const response = await fetch(`${base}/api/projects/${project.id}/handoff?format=markdown`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /text\/markdown/);
  assert.match(response.headers.get('content-disposition')!, /attachment/);
  assert.match(await response.text(), /Conferir fontes primárias/);
  const detail = await (await fetch(`${base}/api/projects/${project.id}`)).json();
  assert.equal(detail.checkpoints.length, 1);
  assert.equal(detail.messages.length, 1);
});

test('HTTP rejects foreign/null origins, spoofed Host and missing write header', async t => {
  const { base, post } = await fixture(t);
  for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:1']) {
    assert.equal((await fetch(base + '/api/projects', { headers: { Origin: origin } })).status, 403);
    assert.equal((await post('/api/projects', { name: 'blocked', objective: 'blocked' }, { Origin: origin })).status, 403);
  }
  const spoofed = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const req = httpRequest(base + '/api/projects', { headers: { Host: 'attacker.example' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(spoofed.status, 403);
  assert.equal(JSON.parse(spoofed.body).error.code, 'host_forbidden');
  assert.equal((await fetch(base + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/projects', { headers: { Origin: base } })).status, 200);
  assert.deepEqual(await (await fetch(base + '/api/projects')).json(), []);
});

test('HTTP bounds input and returns explicit errors without stack traces', async t => {
  const { base, post } = await fixture(t);
  assert.equal((await post('/api/projects', { name: '', objective: 'x' })).status, 400);
  assert.equal((await post('/api/projects', null)).status, 400);
  const badJson = await fetch(base + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' }, body: '{' });
  assert.equal(badJson.status, 400);
  assert.equal((await post('/api/projects', { name: 'x'.repeat(300000), objective: 'x' })).status, 413);
  const malformed = await fetch(base + '/api/projects/missing');
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'invalid_input');
  const absent = await fetch(base + '/api/projects/' + randomUUID());
  assert.equal(absent.status, 404);
  const error = await absent.json();
  assert.equal(typeof error.error.message, 'string');
  assert.equal(JSON.stringify(error).includes('at WorkspaceStore'), false);
  assert.equal((await fetch(base + '/api/not-a-route')).status, 404);
});
