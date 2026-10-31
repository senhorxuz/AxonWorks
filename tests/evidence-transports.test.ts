import assert from 'node:assert/strict'
import { describe, it, test } from 'node:test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { renderHandoff } from '../server/handoff.ts'
import { createApp } from '../server/app.ts'
import { WorkspaceStore } from '../server/store.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import type { AgentMessage, Checkpoint, Project, ProjectDetail, Task } from '../shared/types.ts'
import type { EvidenceView } from '../shared/evidence.ts'

function sha256Of(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function httpFixture(t: { after: (fn: () => void | Promise<void>) => void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'axon-evidence-transports-'))
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
    rmSync(dir, { recursive: true, force: true })
  })
  const post = (p: string, body: unknown) =>
    fetch(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' },
      body: JSON.stringify(body),
    })
  const get = (p: string) => fetch(base + p)
  return { store, base, post, get, workspaceDir: dir }
}

const T0 = new Date('2026-09-16T02:00:00.000Z')

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Projeto de teste',
    objective: 'Validar seção de evidências desatualizadas',
    workspacePath: '',
    createdAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    revision: 1,
    ...overrides,
  }
}

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'cp-1',
    projectId: 'proj-1',
    taskId: null,
    agent: 'alfa',
    summary: 'Resumo do checkpoint',
    nextStep: 'Próximo passo do checkpoint',
    blockers: [],
    decisions: [],
    evidence: [],
    revision: 1,
    createdAt: T0.toISOString(),
    ...overrides,
  }
}

function makeDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    project: makeProject(),
    tasks: [] as Task[],
    checkpoints: [makeCheckpoint()],
    messages: [] as AgentMessage[],
    ...overrides,
  }
}

function makeEvidenceView(overrides: Partial<EvidenceView> = {}): EvidenceView {
  return {
    id: 'ev-1',
    projectId: 'proj-1',
    checkpointId: 'cp-1',
    position: 0,
    command: 'npm test',
    outcome: 'passed',
    details: '263/263 aprovados',
    reportedBy: 'alfa',
    provenance: 'agent_report',
    createdAt: T0.toISOString(),
    artifacts: [
      {
        id: 'art-1',
        evidenceId: 'ev-1',
        path: 'server/store.ts',
        sha256: 'a'.repeat(64),
        sizeBytes: 1234,
        observedAt: T0.toISOString(),
        freshness: 'stale',
        currentSha256: 'b'.repeat(64),
        checkedAt: T0.toISOString(),
        reason: 'Esta evidência não cobre a versão atual: server/store.ts mudou desde a medição.',
      },
    ],
    verifications: [],
    assertions: ['agent_reported'],
    freshness: 'stale',
    explanation: 'Esta evidência não cobre a versão atual: server/store.ts mudou desde a medição.',
    ...overrides,
  }
}

describe('renderHandoff — seção de evidências desatualizadas', () => {
  it('inclui fonte e motivo por item quando há evidências stale', () => {
    const detail = makeDetail()
    const staleEvidence = [
      makeEvidenceView(),
      makeEvidenceView({
        id: 'ev-2',
        command: 'npx tsc --noEmit',
        reportedBy: 'beta',
        explanation: 'Esta evidência não cobre a versão atual: shared/evidence.ts mudou desde a medição.',
      }),
    ]
    const rendered = renderHandoff(detail, {
      generatedAt: T0.toISOString(),
      now: T0,
      maxChars: 20000,
      deliveries: [],
      staleEvidence,
    })
    assert.match(rendered.markdown, /## Evidências que não cobrem mais a versão atual/)
    assert.ok(rendered.markdown.includes('npm test'))
    assert.ok(rendered.markdown.includes('alfa'))
    assert.ok(rendered.markdown.includes('server/store.ts mudou desde a medição'))
    assert.ok(rendered.markdown.includes('npx tsc --noEmit'))
    assert.ok(rendered.markdown.includes('beta'))
    assert.ok(rendered.markdown.includes('shared/evidence.ts mudou desde a medição'))
    assert.equal(rendered.truncated, false)
  })

  it('mostra texto de ausência quando não há evidências desatualizadas', () => {
    const detail = makeDetail()
    const rendered = renderHandoff(detail, {
      generatedAt: T0.toISOString(),
      now: T0,
      maxChars: 20000,
      deliveries: [],
      staleEvidence: [],
    })
    assert.match(rendered.markdown, /## Evidências que não cobrem mais a versão atual/)
    assert.match(rendered.markdown, /Nenhuma evidência desatualizada/)
  })

  it('funciona sem staleEvidence informado (compatibilidade com chamador que ainda não envia o campo)', () => {
    const detail = makeDetail()
    const rendered = renderHandoff(detail, {
      generatedAt: T0.toISOString(),
      now: T0,
      maxChars: 20000,
      deliveries: [],
    })
    assert.match(rendered.markdown, /## Evidências que não cobrem mais a versão atual/)
    assert.match(rendered.markdown, /Nenhuma evidência desatualizada/)
  })

  it('corta apenas entre entidades completas: nunca inclui um item parcialmente', () => {
    const detail = makeDetail()
    const staleEvidence = Array.from({ length: 30 }, (_, i) =>
      makeEvidenceView({
        id: `ev-${i}`,
        command: `comando-${i}`,
        explanation: `MARCA-UNICA-${i}-` + 'x'.repeat(200),
      }),
    )
    const rendered = renderHandoff(detail, {
      generatedAt: T0.toISOString(),
      now: T0,
      maxChars: 2500,
      deliveries: [],
      staleEvidence,
    })
    assert.ok(rendered.markdown.length <= 2500)
    assert.equal(rendered.truncated, true)
    // Para cada item, ou a marca inteira aparece, ou não aparece nada dela — nunca cortada no meio.
    for (let i = 0; i < 30; i += 1) {
      const marker = `MARCA-UNICA-${i}-`
      const fullBlock = marker + 'x'.repeat(200)
      const idx = rendered.markdown.indexOf(marker)
      if (idx === -1) continue
      assert.ok(rendered.markdown.includes(fullBlock), `item ${i} apareceu cortado no meio`)
    }
  })
})

test('HTTP: ciclo de evidência — frescor covers_current → stale, staleOnly, artefatos adicionais e conferência cruzada', async (t) => {
  const { post, get, workspaceDir } = await httpFixture(t)
  const created = await post('/api/projects', {
    name: 'Projeto com pasta',
    objective: 'Validar frescor de evidência',
    workspacePath: workspaceDir,
  })
  assert.equal(created.status, 201)
  const project = await created.json()

  const filePath = path.join(workspaceDir, 'foo.txt')
  writeFileSync(filePath, 'conteudo original')
  const originalSha = sha256Of('conteudo original')

  const taskRes = await post(`/api/projects/${project.id}/tasks`, { title: 'Rodar suíte' })
  const task = await taskRes.json()
  await post(`/api/projects/${project.id}/tasks/${task.id}/claim`, { agent: 'alfa', expectedVersion: 0 })

  const cpRes = await post(`/api/projects/${project.id}/checkpoints`, {
    expectedRevision: 0,
    idempotencyKey: 'ev-1',
    taskId: task.id,
    agent: 'alfa',
    summary: 'Suíte executada',
    nextStep: 'Aguardar conferência',
    evidence: [
      {
        command: 'npm test',
        outcome: 'passed',
        details: '1/1 aprovado',
        artifacts: [{ path: 'foo.txt', sha256: originalSha }],
      },
    ],
  })
  assert.equal(cpRes.status, 201)

  const listed = await get(`/api/projects/${project.id}/evidence`)
  assert.equal(listed.status, 200)
  const evidenceList = await listed.json()
  assert.equal(Array.isArray(evidenceList), true)
  assert.equal(evidenceList.length, 1)
  const evidenceId = evidenceList[0].id
  assert.equal(evidenceList[0].freshness, 'covers_current')
  assert.equal(evidenceList[0].artifacts[0].freshness, 'covers_current')
  assert.deepEqual(evidenceList[0].assertions.includes('agent_reported'), true)

  const gotOne = await get(`/api/projects/${project.id}/evidence/${evidenceId}`)
  assert.equal(gotOne.status, 200)
  assert.equal((await gotOne.json()).id, evidenceId)

  // Arquivo muda de conteúdo depois da medição: frescor deve virar stale na leitura seguinte.
  writeFileSync(filePath, 'conteudo alterado depois do checkpoint')
  const afterChange = await get(`/api/projects/${project.id}/evidence`)
  const afterChangeList = await afterChange.json()
  assert.equal(afterChangeList[0].freshness, 'stale')
  assert.equal(afterChangeList[0].artifacts[0].freshness, 'stale')
  assert.notEqual(afterChangeList[0].artifacts[0].currentSha256, null)
  assert.notEqual(afterChangeList[0].artifacts[0].currentSha256, originalSha)
  assert.ok(afterChangeList[0].explanation.length > 0)

  const staleOnly = await get(`/api/projects/${project.id}/evidence?staleOnly=true`)
  const staleOnlyList = await staleOnly.json()
  assert.equal(staleOnlyList.length, 1)
  assert.equal(staleOnlyList[0].id, evidenceId)

  // Registrar artefato adicional
  const secondFile = path.join(workspaceDir, 'bar.txt')
  writeFileSync(secondFile, 'segundo arquivo')
  const secondSha = sha256Of('segundo arquivo')
  const registered = await post(`/api/projects/${project.id}/evidence/${evidenceId}/artifacts`, {
    actor: 'alfa',
    artifacts: [{ path: 'bar.txt', sha256: secondSha }],
  })
  assert.equal(registered.status, 200)
  const registeredBody = await registered.json()
  assert.equal(registeredBody.artifacts.length, 2)

  // Auto-conferência é recusada
  const selfCheck = await post(`/api/projects/${project.id}/evidence/${evidenceId}/cross-check`, {
    verifiedBy: 'alfa',
    note: 'Eu mesmo conferi',
  })
  assert.equal(selfCheck.status, 409)
  const selfCheckBody = await selfCheck.json()
  assert.equal(selfCheckBody.error.code, 'self_verification_rejected')

  // Conferência cruzada por outra identidade é aceita
  const crossCheck = await post(`/api/projects/${project.id}/evidence/${evidenceId}/cross-check`, {
    verifiedBy: 'beta',
    note: 'Conferido de forma independente',
  })
  assert.equal(crossCheck.status, 200)
  const crossCheckBody = await crossCheck.json()
  assert.ok(crossCheckBody.assertions.includes('cross_checked'))
  assert.ok(crossCheckBody.verifications.some((v: { verifiedBy: string }) => v.verifiedBy === 'beta'))
})

test('HTTP: linha do tempo de bloqueio preserva transições anteriores ao reabrir', async (t) => {
  const { post, get } = await httpFixture(t)
  const created = await post('/api/projects', { name: 'Projeto bloqueio', objective: 'Testar timeline' })
  const project = await created.json()
  const opened = await post(`/api/projects/${project.id}/blockers`, {
    agent: 'alfa',
    title: 'Dependência externa indisponível',
    body: 'API de terceiros fora do ar',
  })
  assert.equal(opened.status, 201)
  const blocker = await opened.json()

  const mitigated = await post(`/api/projects/${project.id}/blockers/${blocker.id}/mitigate`, {
    agent: 'alfa',
    expectedVersion: blocker.version,
    note: 'Fallback temporário aplicado',
  })
  assert.equal(mitigated.status, 200)
  const mitigatedBody = await mitigated.json()

  const resolved = await post(`/api/projects/${project.id}/blockers/${blocker.id}/resolve`, {
    agent: 'alfa',
    expectedVersion: mitigatedBody.version,
    note: 'API voltou ao ar',
  })
  assert.equal(resolved.status, 200)
  const resolvedBody = await resolved.json()

  const reopened = await post(`/api/projects/${project.id}/blockers/${blocker.id}/reopen`, {
    agent: 'alfa',
    expectedVersion: resolvedBody.version,
    note: 'Regrediu de novo',
  })
  assert.equal(reopened.status, 200)

  const timeline = await get(`/api/projects/${project.id}/blockers/${blocker.id}/timeline`)
  assert.equal(timeline.status, 200)
  const timelineBody = await timeline.json()
  assert.equal(timelineBody.entityId, blocker.id)
  const transitions = timelineBody.events.map((e: { transition: string }) => e.transition)
  assert.deepEqual(transitions, ['opened', 'mitigated', 'resolved', 'reopened'])
  // A resolução anterior não deve ter sido apagada pela reabertura: continua na linha do tempo.
  const resolvedEvent = timelineBody.events.find((e: { transition: string }) => e.transition === 'resolved')
  assert.equal(resolvedEvent.note, 'API voltou ao ar')
})

test('HTTP: linha do tempo de decisão não sobrescreve a origem da proposta com a nota de revogação', async (t) => {
  const { post, get } = await httpFixture(t)
  const created = await post('/api/projects', { name: 'Projeto decisão', objective: 'Testar timeline de decisão' })
  const project = await created.json()
  const proposed = await post(`/api/projects/${project.id}/decisions`, {
    agent: 'alfa',
    title: 'Usar SQLite nativo',
    body: 'Persistência local sem dependências externas',
  })
  assert.equal(proposed.status, 201)
  const decision = await proposed.json()

  const accepted = await post(`/api/projects/${project.id}/decisions/${decision.id}/accept`, {
    actor: 'Humano',
    expectedVersion: decision.version,
  })
  assert.equal(accepted.status, 200)
  const acceptedBody = await accepted.json()

  const revoked = await post(`/api/projects/${project.id}/decisions/${decision.id}/revoke`, {
    actor: 'Humano',
    expectedVersion: acceptedBody.version,
    note: 'Requisito mudou',
  })
  assert.equal(revoked.status, 200)

  const timeline = await get(`/api/projects/${project.id}/decisions/${decision.id}/timeline`)
  assert.equal(timeline.status, 200)
  const timelineBody = await timeline.json()
  const transitions = timelineBody.events.map((e: { transition: string }) => e.transition)
  assert.deepEqual(transitions, ['proposed', 'accepted', 'revoked'])
  const revokedEvent = timelineBody.events.find((e: { transition: string }) => e.transition === 'revoked')
  assert.equal(revokedEvent.note, 'Requisito mudou')
})

describe('MCP — ferramentas de evidência e linhas do tempo', () => {
  it('registra as seis ferramentas novas com readOnlyHint correto nas de leitura', async () => {
    const store = new WorkspaceStore(':memory:')
    const server = createMcpServer(store)
    const client = new Client({ name: 'test-evidence-client', version: '1.0.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const tools = await client.listTools()
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]))
      for (const name of [
        'list_evidence',
        'get_evidence',
        'register_evidence_artifacts',
        'cross_check_evidence',
        'get_blocker_timeline',
        'get_decision_timeline',
      ]) {
        assert.ok(byName.has(name), `ferramenta ${name} não registrada`)
      }
      for (const name of ['list_evidence', 'get_evidence', 'get_blocker_timeline', 'get_decision_timeline']) {
        assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, `${name} deveria ter readOnlyHint true`)
      }
      for (const name of ['register_evidence_artifacts', 'cross_check_evidence']) {
        assert.equal(byName.get(name)?.annotations?.readOnlyHint, false, `${name} deveria ter readOnlyHint false`)
      }
    } finally {
      await client.close()
      await server.close()
      store.close()
    }
  })

  it('percorre o ciclo de evidência e linhas do tempo via chamadas MCP', async () => {
    const store = new WorkspaceStore(':memory:')
    const server = createMcpServer(store)
    const client = new Client({ name: 'test-evidence-client-2', version: '1.0.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args })
        const content = response.content as Array<{ type: string; text: string }>
        return { response, data: JSON.parse(content[0].text) }
      };
      const { data: project } = await call('create_project', { name: 'Projeto MCP evidência', objective: 'Testar MCP' })
      const { data: task } = await call('create_task', { projectId: project.id, title: 'Tarefa MCP' })
      await call('claim_task', { projectId: project.id, taskId: task.id, agent: 'alfa', expectedVersion: 0 })
      const checkpoint = await call('save_checkpoint', {
        projectId: project.id,
        expectedRevision: 0,
        idempotencyKey: 'mcp-ev-1',
        taskId: task.id,
        agent: 'alfa',
        summary: 'Rodada MCP',
        nextStep: 'Conferir',
        evidence: [{ command: 'npm test', outcome: 'passed', details: 'ok' }],
      })
      assert.equal(checkpoint.response.isError, undefined, JSON.stringify(checkpoint.data))

      const list = await call('list_evidence', { projectId: project.id });
      assert.equal(list.response.isError, undefined, JSON.stringify(list.data))
      assert.equal(list.data.length, 1)
      const evidenceId = list.data[0].id

      const got = await call('get_evidence', { projectId: project.id, evidenceId })
      assert.equal(got.response.isError, undefined, JSON.stringify(got.data))
      assert.equal(got.data.id, evidenceId)

      const registered = await call('register_evidence_artifacts', {
        projectId: project.id,
        evidenceId,
        actor: 'alfa',
        artifacts: [{ path: 'arquivo.txt', sha256: 'a'.repeat(64) }],
      })
      assert.equal(registered.response.isError, undefined, JSON.stringify(registered.data))

      const selfCheck = await call('cross_check_evidence', {
        projectId: project.id,
        evidenceId,
        verifiedBy: 'alfa',
        note: 'auto',
      })
      assert.equal(selfCheck.response.isError, true)
      assert.equal(selfCheck.data.error.code, 'self_verification_rejected')

      const crossCheck = await call('cross_check_evidence', {
        projectId: project.id,
        evidenceId,
        verifiedBy: 'beta',
        note: 'conferido',
      })
      assert.equal(crossCheck.response.isError, undefined, JSON.stringify(crossCheck.data))

      const blocker = await call('open_blocker', {
        projectId: project.id,
        agent: 'alfa',
        title: 'Bloqueio MCP',
        body: 'Detalhe do bloqueio',
      })
      const blockerTimeline = await call('get_blocker_timeline', { projectId: project.id, blockerId: blocker.data.id })
      assert.equal(blockerTimeline.response.isError, undefined, JSON.stringify(blockerTimeline.data))
      assert.equal(blockerTimeline.data.events[0].transition, 'opened')

      const decision = await call('propose_decision', {
        projectId: project.id,
        agent: 'alfa',
        title: 'Decisão MCP',
        body: 'Corpo da decisão',
      })
      const decisionTimeline = await call('get_decision_timeline', { projectId: project.id, decisionId: decision.data.id })
      assert.equal(decisionTimeline.response.isError, undefined, JSON.stringify(decisionTimeline.data))
      assert.equal(decisionTimeline.data.events[0].transition, 'proposed')
    } finally {
      await client.close()
      await server.close()
      store.close()
    }
  })
})
