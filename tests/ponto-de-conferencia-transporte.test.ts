import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../server/app.js'
import { createMcpServer } from '../server/mcp-tools.js'
import { WorkspaceStore } from '../server/store.js'
import { DomainError } from '../server/store/errors.js'

const ponto = {
  commit: 'a1b2c3d',
  ambiente: 'staging',
  onde: '#citações',
  comoConferir: 'Percorrer os oito relatos.',
  seNaoBater: 'Registrar a divergência.',
}
const texto = [
  'Ponto de partida: commit a1b2c3d · staging · #citações.',
  'Para conferir: Percorrer os oito relatos.',
  'Se não bater: Registrar a divergência.',
].join('\n')
const relogio = { now: () => new Date('2026-11-21T12:00:00.000Z') }

function criarProjeto(store: WorkspaceStore) {
  const { id: projectId } = store.createProject({ name: 'Projeto E5', objective: 'Conferir a entrega' })
  const relato = { agent: 'Codex', summary: 'Trabalho concluído.', nextStep: 'Retomar a revisão.' }
  const checkpoint = store.saveCheckpoint(projectId, { ...relato, expectedRevision: 0, idempotencyKey: 'início' })
  const criar = { checkpointId: checkpoint.id, from: relato.agent, to: 'Claude', message: 'Narrativa da passagem.' }
  const finalizar = {
    ...relato, expectedRevision: 1, idempotencyKey: 'fim',
    taskTransition: { kind: 'keep_claimed' as const },
  }
  return { projectId, criar, finalizar }
}

test('MCP preserva a passagem antiga e antepõe o ponto à narrativa nas três leituras', async () => {
  const store = new WorkspaceStore(':memory:', relogio)
  const mcp = createMcpServer(store)
  const client = new Client({ name: 'ponto-de-conferencia-teste', version: '1.0.0' })
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair()
  try {
    await mcp.connect(ladoServidor)
    await client.connect(ladoCliente)
    async function chamar(name: string, args: Record<string, unknown>, erro = false) {
      const resposta = await client.callTool({ name, arguments: args })
      assert.equal(Boolean(resposta.isError), erro, JSON.stringify(resposta))
      const conteudo = resposta.content as Array<{ type: string; text: string }>
      return JSON.parse(conteudo[0].text)
    }

    const { projectId, criar, finalizar } = criarProjeto(store)
    const leitura = { projectId, agent: criar.to }
    const antiga = await chamar('create_handoff_delivery', { projectId, ...criar })
    assert.deepEqual(await chamar('get_handoff_deliveries', leitura), [antiga])
    assert.equal(Object.hasOwn(antiga, 'pontoDeConferencia'), false)
    const handoffAntigo = await chamar('get_handoff', { projectId })
    assert.ok(handoffAntigo.markdown.includes('- de Codex para Claude (revisão 1): Narrativa da passagem.\n  Trabalho concluído: Trabalho concluído.. Próximo passo: Retomar a revisão.'))
    const contextoAntigo = await chamar('compile_context', leitura)
    assert.equal(contextoAntigo.sections.find((secao: { kind: string }) => secao.kind === 'deliveries').items[0].body, criar.message)

    for (const [nome, entrada] of [
      ['create_handoff_delivery', { ...criar, pontoDeConferencia: {} }],
      ['finalize_work', { ...finalizar, delivery: { to: criar.to, pontoDeConferencia: { onde: '#citações' } } }],
    ] as const) {
      const recusada = await chamar(nome, { projectId, ...entrada }, true)
      assert.equal(recusada.error.code, 'como_conferir_obrigatorio')
    }
    assert.equal(store.getProject(projectId).project.revision, 1)
    assert.deepEqual(await chamar('get_handoff_deliveries', leitura), [antiga])

    const criada = await chamar('create_handoff_delivery', { projectId, ...criar, pontoDeConferencia: ponto })
    assert.deepEqual(criada.pontoDeConferencia, ponto)
    assert.equal(criada.message, criar.message)
    const entradaFinal = { projectId, ...finalizar, delivery: { to: criar.to, pontoDeConferencia: ponto } }
    const finalizada = await chamar('finalize_work', entradaFinal)
    assert.deepEqual(finalizada.delivery.pontoDeConferencia, ponto)
    assert.deepEqual(await chamar('finalize_work', entradaFinal), finalizada)
    const conflitante = await chamar('finalize_work', {
      ...entradaFinal, delivery: { to: criar.to, pontoDeConferencia: { ...ponto, commit: 'e4f5a6b' } },
    }, true)
    assert.equal(conflitante.error.code, 'idempotency_conflict')

    const passagens = await chamar('get_handoff_deliveries', leitura)
    const esperadas = new Map([
      [criada.id, `${texto}\n\n${criar.message}`],
      [finalizada.delivery.id, `${texto}\n\n${finalizar.nextStep}`],
    ])
    assert.equal(passagens.length, 3)
    assert.deepEqual(passagens.find((item: { id: string }) => item.id === antiga.id), antiga)
    for (const [id, narrativa] of esperadas) {
      const passagem = passagens.find((item: { id: string }) => item.id === id)
      assert.deepEqual(passagem.pontoDeConferencia, ponto)
      assert.equal(passagem.message, narrativa)
    }
    const handoff = await chamar('get_handoff', { projectId })
    assert.ok(handoff.markdown.includes(`- de Codex para Claude (revisão 1): ${esperadas.get(criada.id)}`))
    assert.ok(handoff.markdown.includes(`- de Codex para Claude (revisão 2): ${esperadas.get(finalizada.delivery.id)}`))
    const contexto = await chamar('compile_context', leitura)
    const secao = contexto.sections.find((item: { kind: string }) => item.kind === 'deliveries')
    for (const [id, narrativa] of esperadas) {
      assert.equal(secao.items.find((item: { id: string }) => item.id === id).body, narrativa)
    }
  } finally {
    await client.close()
    await mcp.close()
    store.close()
  }
})

test('recusa comoConferir ausente com status 400 antes de gravar nas duas entradas', () => {
  const store = new WorkspaceStore(':memory:', relogio)
  try {
    const { projectId, criar, finalizar } = criarProjeto(store)
    const falta = (erro: unknown) => erro instanceof DomainError && erro.status === 400 && erro.code === 'como_conferir_obrigatorio'
    assert.throws(() => store.createHandoffDelivery(projectId, { ...criar, pontoDeConferencia: {} as typeof ponto }), falta)
    assert.throws(() => store.finalizeWork(projectId, {
      ...finalizar, delivery: { to: criar.to, pontoDeConferencia: { ...ponto, comoConferir: '   ' } },
    }), falta)
    assert.equal(store.getProject(projectId).project.revision, 1)
    assert.deepEqual(store.getHandoffDeliveries(projectId, criar.to), [])
  } finally {
    store.close()
  }
})

test('HTTP devolve 400 como_conferir_obrigatorio nas duas rotas existentes', async () => {
  const store = new WorkspaceStore(':memory:', relogio)
  const http = createServer(createApp(store))
  try {
    const { projectId, criar, finalizar } = criarProjeto(store)
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    const endereco = http.address()
    assert.ok(endereco && typeof endereco !== 'string')
    for (const [rota, corpo] of [
      ['deliveries', { ...criar, pontoDeConferencia: {} }],
      ['finalize', { ...finalizar, delivery: { to: criar.to, pontoDeConferencia: {} } }],
    ] as const) {
      const resposta: Response = await fetch(`http://127.0.0.1:${endereco.port}/api/projects/${projectId}/${rota}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' },
        body: JSON.stringify(corpo),
      })
      assert.equal(resposta.status, 400)
      const erro = await resposta.json()
      assert.equal(erro.error.code, 'como_conferir_obrigatorio')
    }
    assert.equal(store.getProject(projectId).project.revision, 1)
    assert.deepEqual(store.getHandoffDeliveries(projectId, criar.to), [])
  } finally {
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
    store.close()
  }
})

test('migração aditiva reabre a passagem antiga e persiste a nova após outra abertura', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'axon-ponto-'))
  const arquivo = join(pasta, 'teste.sqlite')
  function abrir<T>(conferir: (store: WorkspaceStore) => T): T {
    const store = new WorkspaceStore(arquivo, relogio)
    try {
      return conferir(store)
    } finally {
      store.close()
    }
  }
  try {
    const { projectId, criar, antiga, antes } = abrir((original) => {
      const { projectId, criar } = criarProjeto(original)
      const antiga = original.createHandoffDelivery(projectId, criar)
      return { projectId, criar, antiga, antes: original.getHandoff(projectId) }
    })
    const sqlite = new DatabaseSync(arquivo)
    try {
      const colunas = sqlite.prepare('PRAGMA table_info(handoff_deliveries)').all()
      if (colunas.some((coluna) => coluna.name === 'ponto_de_conferencia_json')) {
        sqlite.exec('ALTER TABLE handoff_deliveries DROP COLUMN ponto_de_conferencia_json')
      }
    } finally {
      sqlite.close()
    }
    abrir((migrado) => {
      assert.deepEqual(migrado.getHandoffDeliveries(projectId, criar.to), [antiga])
      assert.deepEqual(migrado.getHandoff(projectId), antes)
      migrado.createHandoffDelivery(projectId, { ...criar, pontoDeConferencia: ponto })
    })
    abrir((reaberto) => {
      assert.deepEqual(reaberto.getHandoffDeliveries(projectId, criar.to)
        .find((passagem) => passagem.id !== antiga.id)?.pontoDeConferencia, ponto)
    })
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})
