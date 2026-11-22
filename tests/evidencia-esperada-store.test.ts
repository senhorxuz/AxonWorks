import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../server/mcp-tools.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import type { CheckpointInput } from '../shared/types.ts'

const entrada = {
  expectedRevision: 0, idempotencyKey: 'evidencia-e2', agent: 'Codex',
  summary: 'Resultado relatado', nextStep: 'Conferência independente',
}
const relato = { command: 'npm test', outcome: 'failed', details: 'Cenário executado' } as const
const campos = { esperado: 'falhar', versao: 'a1b2c3d', ambiente: 'prévia' } as const
const legado = { ...entrada, evidence: [relato] }
const nova = { ...entrada, evidence: [{ ...relato, ...campos }] }

function projeto(store: WorkspaceStore) {
  return store.createProject({ name: 'Evidência esperada', objective: 'Conferir registros' }).id
}

function conferir(store: WorkspaceStore, id: string, checkpointId: string) {
  const [evidencia] = store.listEvidence(id, { checkpointId })
  assert.ok(evidencia)
  const { esperado, versao, ambiente } = evidencia
  assert.deepEqual({ esperado, versao, ambiente }, campos)
  assert.equal(evidencia.outcome, 'failed')
  assert.deepEqual(evidencia.assertions, ['agent_reported'])
  assert.equal(evidencia.provenance, 'agent_report')
  assert.deepEqual(store.getEvidence(id, evidencia.id), evidencia)
}

test('saveCheckpoint grava e relê a evidência e o replay preserva uma linha', (t) => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const id = projeto(store)
  const cp = store.saveCheckpoint(id, nova)
  conferir(store, id, cp.id)
  assert.deepEqual(store.saveCheckpoint(id, nova), cp)
  assert.equal(store.listEvidence(id).length, 1)
})

test('finalizeWork grava e relê a evidência e o replay preserva uma linha', (t) => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const id = projeto(store)
  const input = { ...nova, taskTransition: { kind: 'keep_claimed' } } as const
  const resultado = store.finalizeWork(id, input)
  conferir(store, id, resultado.checkpoint.id)
  assert.deepEqual(store.finalizeWork(id, input).checkpoint, resultado.checkpoint)
  assert.equal(store.listEvidence(id).length, 1)
})

test('cada campo novo integra a identidade do checkpoint e da finalização', (t) => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const checkpoint = projeto(store)
  const entrega = projeto(store)
  const transicao = { taskTransition: { kind: 'keep_claimed' } } as const
  store.saveCheckpoint(checkpoint, nova)
  store.finalizeWork(entrega, { ...nova, ...transicao })
  for (const mudanca of [{ esperado: 'passar' }, { versao: 'd4e5f6a' }, { ambiente: 'staging' }] as const) {
    const input = { ...nova, evidence: [{ ...nova.evidence[0]!, ...mudanca }] }
    const gravacoes = [
      () => store.saveCheckpoint(checkpoint, input),
      () => store.finalizeWork(entrega, { ...input, ...transicao }),
    ]
    for (const gravar of gravacoes) {
      assert.throws(gravar, { status: 409, code: 'idempotency_conflict' })
    }
  }
})

test('migra banco legado, mantém o relato e reproduz o checkpoint com o canônico anterior à E2', (t) => {
  const pasta = mkdtempSync(join(tmpdir(), 'axon-e2-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  const caminho = join(pasta, 'teste.sqlite')
  const inicial = new WorkspaceStore(caminho)
  const id = projeto(inicial)
  const salvo = inicial.saveCheckpoint(id, legado)
  const listaOriginal = inicial.listEvidence(id)
  inicial.close()

  using banco = new DatabaseSync(caminho)
  const canonicoAnterior = '{"agent":"Codex","blockers":[],"decisions":[],"evidence":[{"artifacts":[],"command":"npm test","details":"Cenário executado","outcome":"failed"}],"nextStep":"Conferência independente","summary":"Resultado relatado","taskId":null}'
  const row = banco.prepare('SELECT payload_canonical FROM checkpoints WHERE id = ?').get(salvo.id)
  assert.equal(row?.payload_canonical, canonicoAnterior)
  const colunas = banco.prepare('PRAGMA table_info(evidence_records)').all().map((item) => item.name)
  for (const campo of Object.keys(campos)) {
    if (colunas.includes(campo)) banco.exec(`ALTER TABLE evidence_records DROP COLUMN ${campo}`)
  }

  for (let abertura = 0; abertura < 2; abertura++) {
    const store = new WorkspaceStore(caminho)
    try {
      assert.deepEqual({ ...banco.prepare('SELECT esperado, versao, ambiente FROM evidence_records').get() }, {
        esperado: null, versao: null, ambiente: null,
      })
      assert.deepEqual(store.saveCheckpoint(id, legado), salvo)
      assert.deepEqual(store.listEvidence(id), listaOriginal)
      assert.equal(banco.prepare('SELECT COUNT(*) AS total FROM evidence_records').get()?.total, 1)
      for (const campo of Object.keys(campos)) assert.equal(Object.hasOwn(listaOriginal[0]!, campo), false)
    } finally {
      store.close()
    }
  }
})

test('o store rejeita valores inválidos e mantém a revisão e as evidências intactas', (t) => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const id = projeto(store)
  const invalidos = [
    ['esperado', 'passed'], ['versao', 123], ['ambiente', null],
    ['versao', ' '], ['ambiente', ' '], ['versao', 'a'.repeat(201)], ['ambiente', 'a'.repeat(201)],
  ] as const
  for (const [campo, valor] of invalidos) {
    const input = { ...nova, evidence: [{ ...relato, [campo]: valor }] }
    assert.throws(() => store.saveCheckpoint(id, input as CheckpointInput), (erro) => {
      assert.ok(erro instanceof DomainError)
      assert.equal(erro.status, 400)
      assert.equal(erro.code, 'invalid_input')
      assert.match(erro.message, new RegExp(`^Campo evidence\\.${campo} inválido\\.`))
      return true
    })
  }
  assert.deepEqual(store.listEvidence(id), [])
  const versao = 'v'.repeat(200)
  const ambiente = 'a'.repeat(200)
  const cp = store.saveCheckpoint(id, {
    ...nova,
    evidence: [{ ...relato, versao, ambiente }, { ...relato, versao: 'a', ambiente: 'a' }],
  })
  assert.equal(cp.revision, 1)
  assert.deepEqual(store.listEvidence(id).map(({ versao, ambiente }) => ({ versao, ambiente })), [
    { versao, ambiente }, { versao: 'a', ambiente: 'a' },
  ])
})

test('as duas escritas MCP anunciam os campos opcionais e os repassam ao store', async (t) => {
  const store = new WorkspaceStore(':memory:')
  const server = createMcpServer(store)
  const client = new Client({ name: 'teste-e2', version: '1.0.0' })
  const [transporteCliente, transporteServidor] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
    store.close()
  })
  await server.connect(transporteServidor)
  await client.connect(transporteCliente)

  const { tools } = await client.listTools()
  for (const name of ['save_checkpoint', 'finalize_work']) {
    const tool = tools.find((item) => item.name === name)
    const evidence = tool?.inputSchema.properties?.evidence as {
      items: { properties: Record<string, { description?: string }>; required: string[] }
    }
    for (const campo of Object.keys(campos)) {
      assert.ok(evidence.items.properties[campo]?.description, `${name}: ${campo}`)
      assert.equal(evidence.items.required.includes(campo), false)
    }
    const id = projeto(store)
    const taskTransition = name === 'finalize_work' ? { kind: 'keep_claimed' } : undefined
    const resposta = await client.callTool({ name, arguments: { projectId: id, ...nova, taskTransition } })
    assert.equal(resposta.isError, undefined, JSON.stringify(resposta))
    const [evidencia] = store.listEvidence(id)
    assert.ok(evidencia)
    conferir(store, id, evidencia.checkpointId)
  }
})
