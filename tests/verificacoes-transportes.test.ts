import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { WorkspaceStore } from '../server/store.ts'

it('aceita verificacaoId nas duas ferramentas MCP e expõe as falhas pela rota HTTP', async () => {
  const store = new WorkspaceStore(':memory:', { now: () => new Date('2026-11-19T12:00:00.000Z') })
  const mcp = createMcpServer(store)
  const client = new Client({ name: 'verificacoes-teste', version: '1.0.0' })
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair()
  const http = createServer(createApp(store))
  try {
    await mcp.connect(ladoServidor)
    await client.connect(ladoCliente)
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    const endereco = http.address()
    assert.ok(endereco && typeof endereco !== 'string')
    const url = `http://127.0.0.1:${endereco.port}/api/projects`
    const projectId = store.createProject({ name: 'Projeto', objective: 'Conferir antes de subir' }).id
    const verificacao = store.registrarLicao(projectId, {
      tipo: 'verificacao', momento: 'antes_de_subir', agent: 'Codex',
      texto: 'Conferir a versão.', fraseDoDono: 'Conferir a versão.',
    })
    const ferramentas = (await client.listTools()).tools
    for (const nome of ['save_checkpoint', 'finalize_work', 'list_lessons']) {
      assert.match(ferramentas.find((ferramenta) => ferramenta.name === nome)?.description ?? '', /verificacaoId/)
    }
    const entrada = {
      projectId, agent: 'Codex', summary: 'Conferi a versão', nextStep: 'Tentar de novo',
    }
    const evidencia = { command: 'preflight', outcome: 'failed', details: 'Versão divergente', verificacaoId: verificacao.id }
    const primeiro = await client.callTool({
      name: 'save_checkpoint',
      arguments: { ...entrada, expectedRevision: 0, idempotencyKey: 'primeiro', evidence: [evidencia] },
    })
    assert.notEqual(primeiro.isError, true)
    const segundo = await client.callTool({
      name: 'finalize_work',
      arguments: { ...entrada, expectedRevision: 1, idempotencyKey: 'segundo', evidence: [evidencia], taskTransition: { kind: 'keep_claimed' } },
    })
    assert.notEqual(segundo.isError, true)

    const resposta = await fetch(`${url}/${projectId}/verificacoes/falhas`)
    assert.equal(resposta.status, 200)
    const checkpoint = store.getProject(projectId).checkpoints.find((item) => item.revision === 2)
    assert.ok(checkpoint)
    assert.deepEqual(await resposta.json(), [{
      verificacaoId: verificacao.id, quantas: 2, ultimaEm: checkpoint.createdAt,
      ultimoCheckpointId: checkpoint.id, ultimoDetalhe: 'Versão divergente',
    }])

    const inexistente = await fetch(`${url}/${randomUUID()}/verificacoes/falhas`)
    assert.equal(inexistente.status, 404)
    assert.equal((await inexistente.json()).error.code, 'not_found')

    const recusada = await fetch(`${url}/${projectId}/checkpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' },
      body: JSON.stringify({
        ...entrada, expectedRevision: 2, idempotencyKey: 'inválido', evidence: [{ ...evidencia, verificacaoId: randomUUID() }],
      }),
    })
    assert.equal(recusada.status, 400)
    assert.equal((await recusada.json()).error.code, 'verificacao_invalida')
  } finally {
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
    await client.close()
    await mcp.close()
    store.close()
  }
})
