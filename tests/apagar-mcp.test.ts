import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../server/mcp-tools.ts'
import { WorkspaceStore } from '../server/store.ts'
import { agenteDaMarca, entradaDeAuditoria, marcaDoRegistro, marcaDoTrecho, quemApagaPelaIa } from '../server/store/apagamento.ts'

/**
 * As IAs apagam trecho ou registro a pedido do dono, pelas ferramentas MCP (27/10/2026).
 * Tudo em memória, pelo cliente MCP de verdade; nenhum teste toca o banco real.
 */

const AGORA = new Date('2026-10-27T15:00:00.000Z')
const SEGREDO = 'senha-do-banco-123'
const PEDIDO = 'Apague a senha que eu colei sem querer no registro de hoje.'

const abertos: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fechar of abertos.splice(0)) await fechar()
})

async function cenario() {
  const store = new WorkspaceStore(':memory:', { now: () => AGORA })
  const server = createMcpServer(store)
  const client = new Client({ name: 'apagar-mcp', version: '1.0.0' })
  abertos.push(async () => {
    await client.close()
    await server.close()
    store.close()
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const projeto = store.createProject({ name: 'Projeto', objective: 'Apagar pelo MCP' })
  const registro = store.saveCheckpoint(projeto.id, {
    expectedRevision: 0,
    idempotencyKey: 'cp-1',
    agent: 'Claude',
    summary: `Resumo com ${SEGREDO}`,
    nextStep: 'Passo limpo',
    decisions: [`Decisão ${SEGREDO}`],
    blockers: [],
    evidence: [{ command: 'npm test', outcome: 'passed', details: `Saída ${SEGREDO}` }],
  })
  const chamar = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args })
    const texto = (r.content as Array<{ text: string }>)[0].text
    return { erro: r.isError === true, corpo: JSON.parse(texto) as Record<string, any> }
  }
  return { store, client, projeto, registro, chamar }
}

function lerRegistro(store: WorkspaceStore, projectId: string, id: string) {
  return store.getProject(projectId).checkpoints.find((c) => c.id === id)!
}

describe('IA apaga pelo MCP', () => {
  it('as duas ferramentas existem, são destrutivas e dizem em português que só o dono pede', async () => {
    const { client } = await cenario()
    const tools = (await client.listTools()).tools
    for (const nome of ['redact_checkpoint_excerpt', 'redact_checkpoint']) {
      const tool = tools.find((t) => t.name === nome)!
      assert.equal(tool.annotations?.destructiveHint, true)
      assert.equal(tool.annotations?.readOnlyHint, false)
      assert.match(tool.description ?? '', /Só use quando o dono pedir/)
    }
  })

  it('apaga o trecho, marca com o nome do agente e audita com o pedido (sem o texto apagado)', async () => {
    const { store, projeto, registro, chamar } = await cenario()
    const r = await chamar('redact_checkpoint_excerpt', {
      projectId: projeto.id, checkpointId: registro.id, trecho: SEGREDO, agent: 'Codex', pedidoDoDono: PEDIDO,
    })
    assert.equal(r.erro, false)
    const marca = '[trecho apagado pelo Codex a pedido do dono em 27/10/2026]'
    assert.deepEqual(r.corpo, { checkpointId: registro.id, modo: 'trecho', ocorrencias: 3, marca })
    const gravado = lerRegistro(store, projeto.id, registro.id)
    assert.equal(gravado.summary, `Resumo com ${marca}`)
    assert.equal(gravado.evidence[0].details, `Saída ${marca}`)
    const [log] = store.listAuditLogs({ projectId: projeto.id, action: 'checkpoint.apagar_trecho' })
    assert.equal(log.actorType, 'agent')
    assert.equal(log.actorId, 'Codex')
    assert.deepEqual(log.details, { modo: 'trecho', ocorrencias: 3, agente: 'Codex', pedidoDoDono: PEDIDO })
    assert.doesNotMatch(JSON.stringify(log), new RegExp(SEGREDO))
  })

  it('apaga o registro inteiro com confirmar, marca com o agente e audita com o pedido', async () => {
    const { store, projeto, registro, chamar } = await cenario()
    const r = await chamar('redact_checkpoint', {
      projectId: projeto.id, checkpointId: registro.id, agent: 'Codex', pedidoDoDono: PEDIDO, confirmar: true,
    })
    assert.equal(r.erro, false)
    const marca = '[registro apagado pelo Codex a pedido do dono em 27/10/2026]'
    assert.equal(r.corpo.marca, marca)
    assert.equal(r.corpo.modo, 'inteiro')
    assert.equal(lerRegistro(store, projeto.id, registro.id).summary, marca)
    const [log] = store.listAuditLogs({ projectId: projeto.id, action: 'checkpoint.apagar_inteiro' })
    assert.equal(log.actorId, 'Codex')
    assert.equal((log.details as Record<string, unknown>).pedidoDoDono, PEDIDO)
  })

  it('sem pedidoDoDono (ausente, vazio ou só espaços) é erro 400 em português e nada muda', async () => {
    const { store, projeto, registro, chamar } = await cenario()
    for (const pedido of [undefined, '', '   ']) {
      const base = { projectId: projeto.id, checkpointId: registro.id, agent: 'Codex', pedidoDoDono: pedido }
      for (const [nome, extra] of [['redact_checkpoint_excerpt', { trecho: SEGREDO }], ['redact_checkpoint', { confirmar: true }]] as const) {
        const r = await chamar(nome, { ...base, ...extra })
        assert.equal(r.erro, true)
        assert.equal(r.corpo.error.code, 'pedido_do_dono_obrigatorio')
        assert.equal(r.corpo.error.message, 'Para apagar, informe o pedido do dono, nas palavras dele.')
      }
    }
    assert.equal(lerRegistro(store, projeto.id, registro.id).summary, `Resumo com ${SEGREDO}`)
    assert.equal(store.listAuditLogs({ projectId: projeto.id, action: 'checkpoint.apagar_trecho' }).length, 0)
  })

  it('pedido de 500 caracteres passa; de 501 é recusado', async () => {
    const { projeto, registro, chamar } = await cenario()
    const base = { projectId: projeto.id, checkpointId: registro.id, agent: 'Codex', trecho: 'Passo limpo' }
    const longo = await chamar('redact_checkpoint_excerpt', { ...base, pedidoDoDono: 'a'.repeat(501) })
    assert.equal(longo.erro, true)
    assert.equal(longo.corpo.error.code, 'pedido_do_dono_longo')
    assert.equal(longo.corpo.error.message, 'O pedido do dono passa de 500 caracteres.')
    const limite = await chamar('redact_checkpoint_excerpt', { ...base, pedidoDoDono: 'a'.repeat(500) })
    assert.equal(limite.erro, false)
  })

  it('registro inteiro sem confirmar: true é erro e nada muda', async () => {
    const { store, projeto, registro, chamar } = await cenario()
    for (const confirmar of [undefined, false]) {
      const r = await chamar('redact_checkpoint', {
        projectId: projeto.id, checkpointId: registro.id, agent: 'Codex', pedidoDoDono: PEDIDO, confirmar,
      })
      assert.equal(r.erro, true)
      assert.equal(r.corpo.error.code, 'confirmacao_obrigatoria')
    }
    assert.equal(lerRegistro(store, projeto.id, registro.id).summary, `Resumo com ${SEGREDO}`)
  })

  it('trecho que não aparece é 404; trecho vazio é 400', async () => {
    const { projeto, registro, chamar } = await cenario()
    const base = { projectId: projeto.id, checkpointId: registro.id, agent: 'Codex', pedidoDoDono: PEDIDO }
    const ausente = await chamar('redact_checkpoint_excerpt', { ...base, trecho: 'nada disso existe' })
    assert.equal(ausente.erro, true)
    assert.equal(ausente.corpo.error.code, 'trecho_nao_encontrado')
    const vazio = await chamar('redact_checkpoint_excerpt', { ...base, trecho: '  ' })
    assert.equal(vazio.corpo.error.code, 'trecho_vazio')
  })
})

describe('apagamento por IA: regras puras', () => {
  it('marcas: sem agente dizem "pelo dono"; com agente dizem quem apagou', () => {
    assert.equal(marcaDoTrecho(AGORA), '[trecho apagado pelo dono em 27/10/2026]')
    assert.equal(marcaDoRegistro(AGORA), '[registro apagado pelo dono em 27/10/2026]')
    assert.equal(marcaDoTrecho(AGORA, 'Gemini'), '[trecho apagado pelo Gemini a pedido do dono em 27/10/2026]')
    assert.equal(marcaDoRegistro(AGORA, 'Gemini'), '[registro apagado pelo Gemini a pedido do dono em 27/10/2026]')
  })

  it('quemApagaPelaIa e agenteDaMarca', () => {
    const quem = quemApagaPelaIa('Gemini', 'pedido')
    assert.deepEqual(quem, { actorType: 'agent', actorId: 'Gemini', pedidoDoDono: 'pedido' })
    assert.equal(agenteDaMarca(quem), 'Gemini')
    assert.equal(agenteDaMarca({ actorType: 'anonymous', actorId: 'local-operator' }), undefined)
    assert.throws(() => quemApagaPelaIa('Gemini', 42), /pedido do dono/)
  })

  it('auditoria do dono não leva pedido; a da IA leva agente e pedido', () => {
    const resultado = { checkpointId: 'c1', modo: 'inteiro' as const, ocorrencias: 2, marca: 'M' }
    assert.deepEqual(entradaDeAuditoria(resultado, 'p1', { actorType: 'anonymous', actorId: 'local-operator' }).details, { modo: 'inteiro', ocorrencias: 2 })
    assert.deepEqual(entradaDeAuditoria(resultado, 'p1', quemApagaPelaIa('Gemini', 'pedido')).details, {
      modo: 'inteiro', ocorrencias: 2, agente: 'Gemini', pedidoDoDono: 'pedido',
    })
  })
})
