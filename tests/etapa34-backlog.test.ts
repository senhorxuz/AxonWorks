import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { WorkspaceStore } from '../server/store.ts'

test('a consulta individual do backlog oculta a lixeira até a restauração', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const projeto = store.createProject({ name: 'Oficina', objective: 'Planejar reparos' })
  const outro = store.createProject({ name: 'Estoque', objective: 'Contar peças' })
  const item = store.createBacklogItem(projeto.id, { title: 'Comprar fusível', createdBy: 'Dono' })
  const erro = { status: 404, code: 'not_found' }

  assert.deepEqual(store.getBacklogItem(projeto.id, item.id), item)
  assert.throws(() => store.getBacklogItem(outro.id, item.id), erro)
  store.excluir(projeto.id, { tipo: 'backlog', id: item.id, agent: 'Dono', origem: 'tela' })
  assert.throws(() => store.getBacklogItem(projeto.id, item.id), erro)
  store.restaurar(projeto.id, { tipo: 'backlog', id: item.id, agent: 'Dono' })
  assert.deepEqual(store.getBacklogItem(projeto.id, item.id), item)
})

test('as listagens HTTP e MCP ocultam o backlog na lixeira mesmo com itens fechados incluídos', async t => {
  const store = new WorkspaceStore(':memory:')
  const http = createServer(createApp(store))
  const servidor = createMcpServer(store)
  const cliente = new Client({ name: 'teste-backlog', version: '1' })
  t.after(async () => {
    http.closeAllConnections()
    await new Promise<void>(resolve => http.close(() => resolve()))
    await cliente.close()
    await servidor.close()
    store.close()
  })
  const { id: projectId } = store.createProject({ name: 'Oficina', objective: 'Planejar reparos' })
  const item = store.createBacklogItem(projectId, { title: 'Comprar fusível', createdBy: 'Dono' })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const endereco = http.address()
  assert.ok(endereco && typeof endereco !== 'string')
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair()
  await servidor.connect(ladoServidor)
  await cliente.connect(ladoCliente)

  const listarHTTP = async () => {
    const resposta = await fetch(`http://127.0.0.1:${endereco.port}/api/projects/${projectId}/backlog?includeClosed=true`)
    assert.equal(resposta.status, 200)
    return resposta.json()
  }
  const listarMCP = async () => {
    const resposta = await cliente.callTool({ name: 'get_backlog', arguments: { projectId, includeClosed: true } })
    assert.equal(resposta.isError, undefined)
    assert.ok(Array.isArray(resposta.content) && resposta.content[0]?.type === 'text')
    return JSON.parse(resposta.content[0].text)
  }
  assert.deepEqual(await listarHTTP(), [item])
  assert.deepEqual(await listarMCP(), [item])
  store.excluir(projectId, { tipo: 'backlog', id: item.id, agent: 'Dono', origem: 'tela' })
  assert.deepEqual(await listarHTTP(), [])
  assert.deepEqual(await listarMCP(), [])
})
