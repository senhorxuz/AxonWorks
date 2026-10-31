import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { WorkspaceStore } from '../server/store.ts'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'

/**
 * Liga `computeInsights` (server/insights/**, pronto por outro agente) aos
 * transportes. Nenhuma lógica aqui: só GET /api/projects/:id/insights (HTTP)
 * e a ferramenta MCP somente-leitura get_project_insights. As regras em si —
 * nextActions, stalledTasks, signals, momentum, agentActivity — já estão
 * cobertas por tests/insights.test.ts; este arquivo cobre só a fiação.
 */

async function httpFixture(t: { after: (fn: () => void | Promise<void>) => void }) {
  const store = new WorkspaceStore(':memory:')
  const server = createServer(createApp(store))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  })
  const headers = {
    'Content-Type': 'application/json',
    'X-Workspace-Client': 'local',
    Host: `127.0.0.1:${address.port}`,
    Origin: `http://127.0.0.1:${address.port}`,
  }
  const post = (urlPath: string, body: unknown) =>
    fetch(base + urlPath, { method: 'POST', headers, body: JSON.stringify(body) })
  const get = (urlPath: string) => fetch(base + urlPath, { headers: { Host: headers.Host, Origin: headers.Origin } })
  return { store, post, get }
}

test('HTTP GET /api/projects/:id/insights devolve a estrutura completa', async (t) => {
  const { post, get } = await httpFixture(t)
  const createdProject = await post('/api/projects', { name: 'Com insights', objective: 'Objetivo' })
  const project = await createdProject.json()
  const createdTask = await post(`/api/projects/${project.id}/tasks`, { title: 'Tarefa' })
  const task = await createdTask.json()
  await post(`/api/projects/${project.id}/tasks/${task.id}/claim`, { agent: 'alfa', expectedVersion: 0 })
  await post(`/api/projects/${project.id}/checkpoints`, {
    expectedRevision: 0,
    idempotencyKey: 'insights-1',
    agent: 'alfa',
    summary: 'Progrediu',
    nextStep: 'Seguir',
  })

  const res = await get(`/api/projects/${project.id}/insights`)
  assert.equal(res.status, 200)
  const insights = await res.json()
  assert.equal(insights.projectId, project.id)
  assert.ok(typeof insights.generatedAt === 'string')
  assert.ok(Array.isArray(insights.nextActions))
  assert.ok(Array.isArray(insights.stalledTasks))
  assert.ok(insights.signals && typeof insights.signals === 'object')
  assert.ok(typeof insights.signals.openBlockers?.count === 'number')
  assert.ok(insights.momentum && typeof insights.momentum === 'object')
  assert.ok(typeof insights.momentum.tasksCompletedLast24h === 'number')
  assert.ok(Array.isArray(insights.agentActivity))
  assert.equal(insights.agentActivity[0]?.agent, 'alfa')
})

test('HTTP GET /api/projects/:id/insights: projeto inexistente se comporta como as rotas vizinhas (404)', async (t) => {
  const { get } = await httpFixture(t)
  const res = await get('/api/projects/00000000-0000-4000-8000-000000000000/insights')
  assert.equal(res.status, 404)
  const body = await res.json()
  assert.equal(body.error.code, 'not_found')
})

test('HTTP GET /api/projects/:id/insights: projetos diferentes não vazam fatos um para o outro', async (t) => {
  const { post, get } = await httpFixture(t)
  const createdA = await post('/api/projects', { name: 'A', objective: 'Objetivo A' })
  const projectA = await createdA.json()
  const createdB = await post('/api/projects', { name: 'B', objective: 'Objetivo B' })
  const projectB = await createdB.json()

  await post(`/api/projects/${projectA.id}/checkpoints`, {
    expectedRevision: 0,
    idempotencyKey: 'isolamento-a',
    agent: 'alfa',
    summary: 'Só no projeto A',
    nextStep: 'Seguir',
  })

  const resA = await get(`/api/projects/${projectA.id}/insights`)
  const insightsA = await resA.json()
  const resB = await get(`/api/projects/${projectB.id}/insights`)
  const insightsB = await resB.json()

  assert.equal(insightsA.projectId, projectA.id)
  assert.equal(insightsB.projectId, projectB.id)
  assert.equal(insightsA.momentum.checkpointsLast24h, 1)
  assert.equal(insightsB.momentum.checkpointsLast24h, 0)
  assert.equal(insightsB.agentActivity.length, 0)
})

test('MCP: get_project_insights é registrada como somente leitura e devolve os mesmos dados', async (t) => {
  const store = new WorkspaceStore(':memory:')
  const server = createMcpServer(store)
  const client = new Client({ name: 'insights-mcp-test', version: '1.0.0' })
  t.after(async () => {
    await client.close()
    await server.close()
    store.close()
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const listing = await client.listTools()
  const byName = new Map(listing.tools.map((tool) => [tool.name, tool]))
  assert.ok(byName.has('get_project_insights'), 'get_project_insights deve estar registrada')
  const tool = byName.get('get_project_insights')!
  assert.equal(tool.annotations?.readOnlyHint, true, 'get_project_insights deve ter readOnlyHint true')
  assert.equal(tool.annotations?.destructiveHint, false)

  const created = await client.callTool({
    name: 'create_project',
    arguments: { name: 'MCP insights', objective: 'Objetivo' },
  })
  const projectContent = created.content as Array<{ type: string; text: string }>
  const project = JSON.parse(projectContent[0]!.text)

  await client.callTool({
    name: 'save_checkpoint',
    arguments: {
      projectId: project.id,
      expectedRevision: 0,
      idempotencyKey: 'mcp-insights-1',
      agent: 'Grok',
      summary: 'Progrediu via MCP',
      nextStep: 'Seguir',
    },
  })

  const called = await client.callTool({ name: 'get_project_insights', arguments: { projectId: project.id } })
  assert.equal(called.isError, undefined)
  const content = called.content as Array<{ type: string; text: string }>
  const insights = JSON.parse(content[0]!.text)
  assert.equal(insights.projectId, project.id)
  assert.equal(insights.momentum.checkpointsLast24h, 1)
  assert.equal(insights.agentActivity[0]?.agent, 'Grok')
})

test('MCP: get_project_insights devolve erro de domínio (não stack trace) para projeto inexistente', async (t) => {
  const store = new WorkspaceStore(':memory:')
  const server = createMcpServer(store)
  const client = new Client({ name: 'insights-mcp-404-test', version: '1.0.0' })
  t.after(async () => {
    await client.close()
    await server.close()
    store.close()
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const called = await client.callTool({
    name: 'get_project_insights',
    arguments: { projectId: '00000000-0000-4000-8000-000000000000' },
  })
  assert.equal(called.isError, true)
  const content = called.content as Array<{ type: string; text: string }>
  assert.equal(JSON.parse(content[0]!.text).error.code, 'not_found')
})
