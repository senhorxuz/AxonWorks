import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it, test } from 'node:test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { createProjectBundleV2, createProjectBundleV3, parseProjectBundle } from '../server/portability/index.ts'

/**
 * Parte 4 — humanSummary: frase simples e opcional em cada checkpoint, para o
 * dono do projeto (que não é programador). `summary` continua em jargão
 * técnico, para outras IAs.
 *
 * Cobre: domínio (saveCheckpoint/finalizeWork), a armadilha de idempotência
 * (o campo só entra na carga canônica quando presente, nos dois sentidos), a
 * armadilha de imutabilidade (coluna nova via ALTER TABLE, nunca UPDATE em
 * checkpoint existente), HTTP e MCP.
 */

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

function makeStore(): WorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'axon-human-summary-'))
  const store = new WorkspaceStore(join(dir, 'workspace.sqlite'))
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* já fechado no próprio teste */
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

function expectDomain(fn: () => unknown, status: number, code: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof DomainError, `esperado DomainError, recebido ${String(err)}`)
    assert.equal(err.status, status)
    assert.equal(err.code, code)
    return true
  })
}

describe('humanSummary (Parte 4) — domínio', () => {
  it('saveCheckpoint aceita humanSummary opcional e devolve o campo', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'P', objective: 'O' })
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'k1',
      agent: 'alfa',
      summary: 'Refatorei o índice FTS5 e adicionei cache LRU no loadContentEntry.',
      humanSummary: 'Os relatórios agora carregam mais rápido.',
      nextStep: 'Medir o tempo de busca em produção.',
    })
    assert.equal(checkpoint.humanSummary, 'Os relatórios agora carregam mais rápido.')
    assert.equal(checkpoint.summary, 'Refatorei o índice FTS5 e adicionei cache LRU no loadContentEntry.')
  })

  it('saveCheckpoint sem humanSummary não inclui o campo no checkpoint devolvido', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'P', objective: 'O' })
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'k1',
      agent: 'alfa',
      summary: 'Sem frase para o dono.',
      nextStep: 'Seguir.',
    })
    assert.equal(checkpoint.humanSummary, undefined)
    assert.ok(!('humanSummary' in checkpoint))
  })

  it('recusa humanSummary acima de 280 caracteres', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'P', objective: 'O' })
    expectDomain(
      () =>
        store.saveCheckpoint(project.id, {
          expectedRevision: 0,
          idempotencyKey: 'k1',
          agent: 'alfa',
          summary: 'Resumo técnico',
          humanSummary: 'x'.repeat(281),
          nextStep: 'Seguir',
        }),
      400,
      'invalid_input',
    )
  })

  it('recusa humanSummary com texto corrompido, pela validação compartilhada', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'P', objective: 'O' })
    expectDomain(
      () =>
        store.saveCheckpoint(project.id, {
          expectedRevision: 0,
          idempotencyKey: 'k1',
          agent: 'alfa',
          summary: 'Resumo técnico',
          humanSummary: 'Acentos destru�dos',
          nextStep: 'Seguir',
        }),
      400,
      'corrupted_text',
    )
  })

  it('finalizeWork também aceita humanSummary e devolve no checkpoint resultante', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'P', objective: 'O' })
    const result = store.finalizeWork(project.id, {
      agent: 'alfa',
      expectedRevision: 0,
      idempotencyKey: 'fin-1',
      summary: 'Fechei a tarefa X.',
      humanSummary: 'A tarefa X está pronta.',
      nextStep: 'Nada pendente.',
      taskTransition: { kind: 'keep_claimed' },
    })
    assert.equal(result.checkpoint.humanSummary, 'A tarefa X está pronta.')
  })
})

describe('humanSummary (Parte 4) — armadilha de idempotência', () => {
  it('mesma chave, os dois SEM o campo: não conflita (replay idempotente normal)', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'P', objective: 'O' })
    const first = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'sem-campo',
      agent: 'alfa',
      summary: 'Mesmo resumo',
      nextStep: 'Mesmo próximo passo',
    })
    const replay = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'sem-campo',
      agent: 'alfa',
      summary: 'Mesmo resumo',
      nextStep: 'Mesmo próximo passo',
    })
    assert.equal(replay.id, first.id)
    assert.equal(replay.humanSummary, undefined)
    // só um checkpoint foi de fato gravado — a revisão do projeto não avançou duas vezes
    assert.equal(store.getProject(project.id).project.revision, 1)
  })

  it('mesma chave, frases diferentes: conflita', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'P', objective: 'O' })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'frases-diferentes',
      agent: 'alfa',
      summary: 'Mesmo resumo',
      humanSummary: 'Frase A para o dono',
      nextStep: 'Mesmo próximo passo',
    })
    expectDomain(
      () =>
        store.saveCheckpoint(project.id, {
          expectedRevision: 0,
          idempotencyKey: 'frases-diferentes',
          agent: 'alfa',
          summary: 'Mesmo resumo',
          humanSummary: 'Frase B para o dono',
          nextStep: 'Mesmo próximo passo',
        }),
      409,
      'idempotency_conflict',
    )
  })

  it('mesma chave, um com o campo e outro sem: também conflita (o campo pesa na carga canônica)', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'P', objective: 'O' })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'com-e-sem',
      agent: 'alfa',
      summary: 'Mesmo resumo',
      nextStep: 'Mesmo próximo passo',
    })
    expectDomain(
      () =>
        store.saveCheckpoint(project.id, {
          expectedRevision: 0,
          idempotencyKey: 'com-e-sem',
          agent: 'alfa',
          summary: 'Mesmo resumo',
          humanSummary: 'Agora com frase',
          nextStep: 'Mesmo próximo passo',
        }),
      409,
      'idempotency_conflict',
    )
  })
})

describe('humanSummary (Parte 4) — armadilha de imutabilidade', () => {
  it('reabre banco gravado antes da Parte 4 (sem a coluna human_summary): ALTER TABLE, nunca UPDATE em checkpoint existente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axon-human-summary-legacy-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const dbPath = join(dir, 'legado.sqlite')

    // Simula um banco criado por uma versão da Axon anterior à Parte 4: a
    // tabela checkpoints existe, com o trigger BEFORE UPDATE de sempre, mas
    // sem a coluna human_summary.
    const raw = new DatabaseSync(dbPath)
    raw.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, objective TEXT NOT NULL,
        workspace_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL
      );
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        task_id TEXT,
        agent TEXT NOT NULL,
        summary TEXT NOT NULL,
        next_step TEXT NOT NULL,
        blockers_json TEXT NOT NULL,
        decisions_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_canonical TEXT NOT NULL,
        UNIQUE (project_id, idempotency_key)
      );
      CREATE TRIGGER trg_checkpoints_immutable
      BEFORE UPDATE ON checkpoints
      BEGIN
        SELECT RAISE(ABORT, 'checkpoints are immutable');
      END;
    `)
    const pid = randomUUID()
    const ts = '2026-01-01T00:00:00.000Z'
    raw
      .prepare(
        `INSERT INTO projects (id, name, objective, workspace_path, created_at, updated_at, revision)
         VALUES (?, 'Legado', 'Objetivo antigo', '', ?, ?, 1)`,
      )
      .run(pid, ts, ts)
    const cid = randomUUID()
    raw
      .prepare(
        `INSERT INTO checkpoints (
           id, project_id, task_id, agent, summary, next_step, blockers_json, decisions_json,
           evidence_json, revision, created_at, idempotency_key, payload_canonical
         ) VALUES (?, ?, NULL, 'alfa', 'Resumo antigo', 'Próximo passo antigo', '[]', '[]', '[]', 1, ?, 'legado-1', '{}')`,
      )
      .run(cid, pid, ts)
    raw.close()

    // Reabrir com a Axon atual não pode lançar (a migração usa ALTER TABLE
    // ADD COLUMN, nunca UPDATE — o trigger BEFORE UPDATE não dispara).
    const store = new WorkspaceStore(dbPath)
    cleanups.push(() => {
      try {
        store.close()
      } catch {
        /* já fechado */
      }
    })
    const detail = store.getProject(pid)
    assert.equal(detail.checkpoints.length, 1)
    assert.equal(detail.checkpoints[0]!.id, cid)
    assert.equal(detail.checkpoints[0]!.summary, 'Resumo antigo')
    assert.equal(detail.checkpoints[0]!.humanSummary, undefined)

    // E continua gravando checkpoints novos normalmente, agora com a coluna.
    const withHuman = store.saveCheckpoint(pid, {
      expectedRevision: 1,
      idempotencyKey: 'novo-1',
      agent: 'beta',
      summary: 'Resumo novo',
      humanSummary: 'Frase para o dono',
      nextStep: 'Seguir',
    })
    assert.equal(withHuman.humanSummary, 'Frase para o dono')
  })
})

describe('humanSummary (Parte 4) — resume brief e ContextEnvelope', () => {
  it('aparece no get_resume_brief, rotulado para humanos, e some quando ausente', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'P', objective: 'O' })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'brief-1',
      agent: 'alfa',
      summary: 'Detalhe técnico interno',
      humanSummary: 'O painel ficou mais rápido para o time.',
      nextStep: 'Seguir',
    })
    const brief = store.getResumeBrief(project.id, 'alfa')
    assert.equal(brief.latestProjectCheckpoint?.humanSummary, 'O painel ficou mais rápido para o time.')
    assert.match(brief.markdown, /## Para o dono do projeto/)
    assert.match(brief.markdown, /O painel ficou mais rápido para o time\./)
  })

  it('aparece no ContextEnvelope (compileContext), no item de checkpoint', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'P', objective: 'O' })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'ctx-1',
      agent: 'alfa',
      summary: 'Detalhe técnico interno',
      humanSummary: 'Frase simples para o dono.',
      nextStep: 'Seguir',
    })
    const envelope = store.compileContext(project.id, { agent: 'alfa' })
    const checkpointSection = envelope.sections.find((s) => s.kind === 'checkpoint')
    assert.ok(checkpointSection, 'seção de checkpoint deve existir')
    const item = checkpointSection!.items[0]!
    assert.match(item.body, /Frase simples para o dono\./)
    assert.equal((item.meta as Record<string, unknown> | undefined)?.humanSummary, 'Frase simples para o dono.')
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
  const post = (urlPath: string, body: unknown) =>
    fetch(base + urlPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Client': 'local',
        Host: `127.0.0.1:${address.port}`,
        Origin: `http://127.0.0.1:${address.port}`,
      },
      body: JSON.stringify(body),
    })
  const get = (urlPath: string) =>
    fetch(base + urlPath, {
      headers: { Host: `127.0.0.1:${address.port}`, Origin: `http://127.0.0.1:${address.port}` },
    })
  return { post, get }
}

test('humanSummary (Parte 4) — HTTP: POST /checkpoints grava e devolve o campo', async (t) => {
  const { post } = await httpFixture(t)
  const created = await post('/api/projects', { name: 'HTTP', objective: 'Objetivo' })
  const project = await created.json()
  const res = await post(`/api/projects/${project.id}/checkpoints`, {
    expectedRevision: 0,
    idempotencyKey: 'http-1',
    agent: 'alfa',
    summary: 'Resumo técnico',
    humanSummary: 'Frase para o dono via HTTP.',
    nextStep: 'Seguir',
  })
  assert.equal(res.status, 201)
  const checkpoint = await res.json()
  assert.equal(checkpoint.humanSummary, 'Frase para o dono via HTTP.')
})

test('humanSummary (Parte 4) — MCP: save_checkpoint aceita e devolve o campo', async (t) => {
  const store = new WorkspaceStore(':memory:')
  const server = createMcpServer(store)
  const client = new Client({ name: 'human-summary-mcp-test', version: '1.0.0' })
  t.after(async () => {
    await client.close()
    await server.close()
    store.close()
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const created = await client.callTool({
    name: 'create_project',
    arguments: { name: 'MCP', objective: 'Objetivo' },
  })
  const projectContent = created.content as Array<{ type: string; text: string }>
  const project = JSON.parse(projectContent[0]!.text)

  const called = await client.callTool({
    name: 'save_checkpoint',
    arguments: {
      projectId: project.id,
      expectedRevision: 0,
      idempotencyKey: 'mcp-human-1',
      agent: 'Gemini',
      summary: 'Resumo técnico via MCP',
      humanSummary: 'Frase simples para o dono via MCP.',
      nextStep: 'Seguir',
    },
  })
  assert.equal(called.isError, undefined)
  const content = called.content as Array<{ type: string; text: string }>
  const checkpoint = JSON.parse(content[0]!.text)
  assert.equal(checkpoint.humanSummary, 'Frase simples para o dono via MCP.')
})

/**
 * Extensão pedida pela orquestradora depois da revisão das Partes 4 e 5:
 * "toda informação que a Axon guarda sobre um registro ou viaja no pacote,
 * ou é declarada em omissions. Nada some em silêncio." — aplicado a
 * humanSummary: viaja na v3 (ida e volta), some com omissão declarada na v2.
 */
describe('humanSummary — pacote de portabilidade (extensão)', () => {
  it('viaja na v3: exporta, importa, e a frase chega idêntica', () => {
    const storeA = makeStore()
    const project = storeA.createProject({ name: 'Origem', objective: 'Objetivo' })
    storeA.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'bundle-v3-1',
      agent: 'alfa',
      summary: 'Resumo técnico',
      humanSummary: 'Frase que precisa sobreviver à viagem.',
      nextStep: 'Seguir',
    })

    const bundleData = storeA.exportProjectBundleData(project.id)
    const bundleV3 = createProjectBundleV3(bundleData)
    assert.equal(bundleV3.project.checkpoints[0]!.humanSummary, 'Frase que precisa sobreviver à viagem.')

    const parsed = parseProjectBundle(bundleV3)
    const storeB = makeStore()
    const imported = storeB.importProjectBundleData(parsed)
    const detail = storeB.getProject(imported.project.id)
    assert.equal(detail.checkpoints[0]!.humanSummary, 'Frase que precisa sobreviver à viagem.')
  })

  it('pacote v3 antigo, sem o campo, continua importando normalmente', () => {
    const storeA = makeStore()
    const project = storeA.createProject({ name: 'Origem', objective: 'Objetivo' })
    storeA.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'bundle-v3-legado',
      agent: 'alfa',
      summary: 'Resumo técnico, sem frase para o dono',
      nextStep: 'Seguir',
    })

    const bundleV3 = createProjectBundleV3(storeA.exportProjectBundleData(project.id))
    assert.ok(!('humanSummary' in bundleV3.project.checkpoints[0]!), 'checkpoint não deve ter a chave humanSummary')

    const parsed = parseProjectBundle(bundleV3)
    const storeB = makeStore()
    const imported = storeB.importProjectBundleData(parsed)
    const detail = storeB.getProject(imported.project.id)
    assert.equal(detail.checkpoints[0]!.humanSummary, undefined)
  })

  it('v2 declara em omissions que a frase simples só viaja na v3, e não a carrega', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'Origem', objective: 'Objetivo' })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'bundle-v2-1',
      agent: 'alfa',
      summary: 'Resumo técnico',
      humanSummary: 'Esta frase não pode ir para a v2.',
      nextStep: 'Seguir',
    })

    const bundleV2 = createProjectBundleV2(store.exportProjectBundleData(project.id))
    assert.ok(!('humanSummary' in bundleV2.project.checkpoints[0]!), 'checkpoint v2 não deve carregar humanSummary')
    assert.ok(
      bundleV2.omissions?.some((o) => o.entity === 'checkpoints[].humanSummary'),
      'omissions da v2 deve declarar checkpoints[].humanSummary',
    )
  })
})
