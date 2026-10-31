import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const T0 = new Date('2026-09-14T18:00:00.000Z')
const T1 = new Date('2026-09-14T18:05:00.000Z')

let cleanups: Array<() => void> = []

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) {
    try {
      dispose()
    } catch {
      /* limpeza de arquivo temporário não deve mascarar a falha do teste */
    }
  }
})

function expectDomain(fn: () => unknown, status: number, code: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof DomainError, `esperado DomainError, recebido ${String(err)}`)
    assert.equal(err.status, status)
    assert.equal(err.code, code)
    return true
  })
}

function makeStore(now?: () => Date): { store: WorkspaceStore; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'axon-delete-'))
  const dbPath = join(dir, 'workspace.sqlite')
  const store = new WorkspaceStore(dbPath, now ? { now } : undefined)
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* já fechado no próprio teste */
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return { store, dbPath }
}

function seedContinuity(store: WorkspaceStore, name: string) {
  const project = store.createProject({ name, objective: 'Preservar isolamento entre exclusões' })
  const task = store.createTask(project.id, { title: `Tarefa de ${name}` })
  const claimed = store.claimTask(project.id, task.id, { agent: 'Astra', expectedVersion: 0 })
  const checkpoint = store.saveCheckpoint(project.id, {
    expectedRevision: 0,
    idempotencyKey: `cp-${name}`,
    taskId: claimed.id,
    agent: 'Astra',
    summary: `Avanço de ${name}`,
    nextStep: 'Continuar no outro projeto',
  })
  const message = store.postMessage(project.id, {
    from: 'Astra',
    to: 'Grok',
    kind: 'note',
    body: `Recado em ${name}`,
  })
  store.acknowledgeMessage(project.id, message.id, { agent: 'Grok' })
  const delivery = store.createHandoffDelivery(project.id, {
    checkpointId: checkpoint.id,
    from: 'Astra',
    to: 'Grok',
    message: `Passe ${name}`,
  })
  store.acknowledgeHandoffDelivery(project.id, delivery.id, { agent: 'Grok' })
  const idea = store.createBacklogItem(project.id, {
    title: `Ideia de ${name}`,
    createdBy: 'Astra',
  })
  const archived = store.createBacklogItem(project.id, {
    title: `Arquivo de ${name}`,
    createdBy: 'Astra',
  })
  store.archiveBacklogItem(project.id, archived.id, { expectedVersion: 0 })
  return { project, task: claimed, checkpoint, message, delivery, idea, archived }
}

describe('deleteProject', () => {
  it('remove o projeto e todas as linhas dependentes quando a confirmação é o nome salvo', () => {
    const { store } = makeStore(() => T0)
    const target = seedContinuity(store, 'Arquivo orbital')
    const neighbor = seedContinuity(store, 'Arquivo vizinho')

    const deleted = store.deleteProject(target.project.id, 'Arquivo orbital')
    assert.equal(deleted.projectId, target.project.id)
    assert.equal(deleted.deletedAt, T0.toISOString())
    assert.match(deleted.projectId, UUID_RE)

    expectDomain(() => store.getProject(target.project.id), 404, 'not_found')
    expectDomain(() => store.listBacklog(target.project.id), 404, 'not_found')
    const remaining = store.listProjects()
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0]?.id, neighbor.project.id)

    const kept = store.getProject(neighbor.project.id)
    assert.equal(kept.tasks.length, 1)
    assert.equal(kept.checkpoints.length, 1)
    assert.equal(kept.messages.length, 1)
    assert.equal(store.listBacklog(neighbor.project.id, { includeClosed: true }).length, 2)
    assert.equal(store.getHandoffDeliveries(neighbor.project.id, 'Grok').length, 1)
    assert.equal(store.getInbox(neighbor.project.id, 'Grok').length, 1)
  })

  it('rejeita confirmação diferente do nome salvo e não apaga nada', () => {
    const { store } = makeStore(() => T0)
    const target = seedContinuity(store, 'Nome exato')

    expectDomain(() => store.deleteProject(target.project.id, 'nome exato'), 409, 'confirmation_mismatch')
    expectDomain(() => store.deleteProject(target.project.id, 'Nome exato '), 409, 'confirmation_mismatch')
    expectDomain(() => store.deleteProject(target.project.id, ' Nome exato'), 409, 'confirmation_mismatch')
    expectDomain(() => store.deleteProject(target.project.id, ''), 400, 'invalid_input')
    expectDomain(() => store.deleteProject(target.project.id, undefined as unknown as string), 400, 'invalid_input')

    const still = store.getProject(target.project.id)
    assert.equal(still.project.name, 'Nome exato')
    assert.equal(still.tasks.length, 1)
    assert.equal(still.checkpoints.length, 1)
    assert.equal(still.messages.length, 1)
    assert.equal(store.listBacklog(target.project.id, { includeClosed: true }).length, 2)
  })

  it('distingue projeto inexistente de identificador inválido', () => {
    const { store } = makeStore(() => T0)
    expectDomain(() => store.deleteProject('nao-e-uuid', 'Qualquer'), 400, 'invalid_input')
    expectDomain(() => store.deleteProject(randomUUID(), 'Qualquer'), 404, 'not_found')
  })
})

describe('deleteBacklogItem', () => {
  it('remove somente item arquivado com CAS e preserva o restante', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Backlog morto', objective: 'Excluir só o arquivado' })
    const idea = store.createBacklogItem(project.id, { title: 'Ideia viva', createdBy: 'Grok' })
    const ready = store.createBacklogItem(project.id, {
      title: 'Pronta',
      createdBy: 'Grok',
      stage: 'ready',
    })
    const toPromote = store.createBacklogItem(project.id, {
      title: 'Vira tarefa',
      createdBy: 'Grok',
      stage: 'ready',
    })
    const promoted = store.promoteBacklogItem(project.id, toPromote.id)
    const archived = store.createBacklogItem(project.id, { title: 'Descartada', createdBy: 'Grok' })
    const closed = store.archiveBacklogItem(project.id, archived.id, { expectedVersion: 0 })
    const other = store.createProject({ name: 'Outro backlog', objective: 'Isolar exclusão' })
    const otherArchived = store.createBacklogItem(other.id, { title: 'Arquivo alheio', createdBy: 'Grok' })
    store.archiveBacklogItem(other.id, otherArchived.id, { expectedVersion: 0 })

    expectDomain(
      () => store.deleteBacklogItem(project.id, idea.id, idea.version),
      409,
      'backlog_stage_not_archived',
    )
    expectDomain(
      () => store.deleteBacklogItem(project.id, ready.id, ready.version),
      409,
      'backlog_stage_not_archived',
    )
    expectDomain(
      () => store.deleteBacklogItem(project.id, promoted.item.id, promoted.item.version),
      409,
      'backlog_stage_not_archived',
    )
    expectDomain(
      () => store.deleteBacklogItem(project.id, closed.id, closed.version + 1),
      409,
      'backlog_version_conflict',
    )
    expectDomain(
      () => store.deleteBacklogItem(other.id, closed.id, closed.version),
      404,
      'not_found',
    )

    now = T1
    const deleted = store.deleteBacklogItem(project.id, closed.id, closed.version)
    assert.equal(deleted.projectId, project.id)
    assert.equal(deleted.itemId, closed.id)
    assert.equal(deleted.deletedAt, T1.toISOString())

    const remaining = store.listBacklog(project.id, { includeClosed: true })
    assert.equal(remaining.some((item) => item.id === closed.id), false)
    assert.equal(remaining.some((item) => item.id === idea.id), true)
    assert.equal(remaining.some((item) => item.id === ready.id), true)
    assert.equal(remaining.some((item) => item.id === promoted.item.id), true)
    assert.equal(store.getProject(project.id).tasks.some((task) => task.id === promoted.task.id), true)
    assert.equal(store.listBacklog(other.id, { includeClosed: true }).length, 1)

    expectDomain(() => store.deleteBacklogItem(project.id, closed.id, closed.version), 404, 'not_found')
    expectDomain(() => store.deleteBacklogItem(randomUUID(), closed.id, 0), 404, 'not_found')
    expectDomain(() => store.deleteBacklogItem('x', closed.id, 0), 400, 'invalid_input')
    expectDomain(() => store.deleteBacklogItem(project.id, 'x', 0), 400, 'invalid_input')
    expectDomain(
      () => store.deleteBacklogItem(project.id, closed.id, 1.5 as unknown as number),
      400,
      'invalid_input',
    )
  })
})

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
  const del = (urlPath: string, body: unknown) =>
    fetch(base + urlPath, { method: 'DELETE', headers, body: JSON.stringify(body) })
  const get = (urlPath: string) => fetch(base + urlPath, { headers: { Host: headers.Host, Origin: headers.Origin } })
  return { store, post, del, get }
}

test('HTTP DELETE projeto e backlog arquivado seguem o contrato de erros', async (t) => {
  const { post, del, get } = await httpFixture(t)
  const created = await post('/api/projects', { name: 'Projeto HTTP', objective: 'Excluir via API' })
  assert.equal(created.status, 201)
  const project = await created.json()
  const otherRes = await post('/api/projects', { name: 'Outro HTTP', objective: 'Sobreviver' })
  const other = await otherRes.json()

  const mismatch = await del(`/api/projects/${project.id}`, { confirmation: 'projeto http' })
  assert.equal(mismatch.status, 409)
  assert.equal((await mismatch.json()).error.code, 'confirmation_mismatch')

  const missingHeader = await fetch((await get('/api/health')).url.replace('/api/health', `/api/projects/${project.id}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'Projeto HTTP' }),
  })
  assert.equal(missingHeader.status, 403)

  const ideaRes = await post(`/api/projects/${project.id}/backlog`, {
    title: 'Não apague ativa',
    createdBy: 'Astra',
  })
  const idea = await ideaRes.json()
  const activeDelete = await del(`/api/projects/${project.id}/backlog/${idea.id}`, { expectedVersion: 0 })
  assert.equal(activeDelete.status, 409)
  assert.equal((await activeDelete.json()).error.code, 'backlog_stage_not_archived')

  const archivedRes = await post(`/api/projects/${project.id}/backlog`, {
    title: 'Pode apagar',
    createdBy: 'Astra',
  })
  const archived = await archivedRes.json()
  await post(`/api/projects/${project.id}/backlog/${archived.id}/archive`, { expectedVersion: 0 })
  const stale = await del(`/api/projects/${project.id}/backlog/${archived.id}`, { expectedVersion: 0 })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error.code, 'backlog_version_conflict')

  const removedItem = await del(`/api/projects/${project.id}/backlog/${archived.id}`, { expectedVersion: 1 })
  assert.equal(removedItem.status, 200)
  const itemBody = await removedItem.json()
  assert.equal(itemBody.projectId, project.id)
  assert.equal(itemBody.itemId, archived.id)
  assert.equal(typeof itemBody.deletedAt, 'string')

  const goneItem = await del(`/api/projects/${project.id}/backlog/${archived.id}`, { expectedVersion: 1 })
  assert.equal(goneItem.status, 404)

  const removedProject = await del(`/api/projects/${project.id}`, { confirmation: 'Projeto HTTP' })
  assert.equal(removedProject.status, 200)
  const projectBody = await removedProject.json()
  assert.equal(projectBody.projectId, project.id)
  assert.equal(typeof projectBody.deletedAt, 'string')

  assert.equal((await get(`/api/projects/${project.id}`)).status, 404)
  const remaining = await (await get('/api/projects')).json()
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].id, other.id)
})

test('MCP delete_project e delete_backlog_item são destrutivas e não controlam IA', async (t) => {
  const store = new WorkspaceStore(':memory:')
  const server = createMcpServer(store)
  const client = new Client({ name: 'axon-delete-mcp', version: '1.0.0' })
  t.after(async () => {
    await client.close()
    await server.close()
    store.close()
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const listing = await client.listTools()
  const projectTool = listing.tools.find((tool) => tool.name === 'delete_project')
  const itemTool = listing.tools.find((tool) => tool.name === 'delete_backlog_item')
  assert.ok(projectTool)
  assert.ok(itemTool)
  assert.match(projectTool.description ?? '', /destrutiv/i)
  assert.match(projectTool.description ?? '', /não (inicia|controla|executa)/i)
  assert.match(itemTool.description ?? '', /destrutiv/i)
  assert.match(itemTool.description ?? '', /não (inicia|controla|executa)/i)
  assert.equal(projectTool.annotations?.destructiveHint, true)
  assert.equal(itemTool.annotations?.destructiveHint, true)

  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args })
    const content = response.content as Array<{ type: string; text: string }>
    return { response, data: JSON.parse(content[0].text) }
  }

  const project = store.createProject({ name: 'MCP destrutivo', objective: 'Apagar pelo correio' })
  const archived = store.createBacklogItem(project.id, { title: 'Ideia morta', createdBy: 'Grok' })
  store.archiveBacklogItem(project.id, archived.id, { expectedVersion: 0 })
  const live = store.createBacklogItem(project.id, { title: 'Ideia viva', createdBy: 'Grok' })

  const blocked = await call('delete_backlog_item', {
    projectId: project.id,
    itemId: live.id,
    expectedVersion: 0,
  })
  assert.equal(blocked.response.isError, true)
  assert.equal(blocked.data.error.code, 'backlog_stage_not_archived')

  const itemDeleted = await call('delete_backlog_item', {
    projectId: project.id,
    itemId: archived.id,
    expectedVersion: 1,
  })
  assert.equal(itemDeleted.response.isError, undefined)
  assert.equal(itemDeleted.data.itemId, archived.id)

  const mismatch = await call('delete_project', { projectId: project.id, confirmation: 'mcp destrutivo' })
  assert.equal(mismatch.response.isError, true)
  assert.equal(mismatch.data.error.code, 'confirmation_mismatch')

  const projectDeleted = await call('delete_project', { projectId: project.id, confirmation: 'MCP destrutivo' })
  assert.equal(projectDeleted.response.isError, undefined)
  assert.equal(projectDeleted.data.projectId, project.id)
  expectDomain(() => store.getProject(project.id), 404, 'not_found')
})
