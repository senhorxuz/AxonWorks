import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { WorkspaceStore } from '../server/store.ts'

function preparar() {
  const store = new WorkspaceStore(':memory:')
  const projectId = store.createProject({ name: 'Teste local', objective: 'Testar a lixeira' }).id
  const { id } = store.createBoardCard(projectId, { actor: 'Dono', title: 'Cartão descartável' })
  return { store, projectId, id, tipo: 'cartao' as const }
}

test('as quatro rotas usam a identidade da tela e registram a confirmação no apagamento', async () => {
  const { store, projectId, id, tipo } = preparar()
  const server = createServer(createApp(store)).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const addr = server.address()
    assert.ok(addr && typeof addr === 'object')
    const url = `http://127.0.0.1:${addr.port}/api/projects/${projectId}/lixeira`
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(url + path, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local', ...headers },
    })
    const alvo = { tipo, id }
    const lista = await fetch(url)
    assert.equal(lista.status, 200)
    assert.deepEqual(await lista.json(), [])
    const agente = store.createAuthToken({ name: 'Agente de teste', tokenType: 'agent', role: 'owner' })
    const tentativa = await post('', alvo, { Authorization: `Bearer ${agente.token}` })
    assert.equal(tentativa.status, 403)
    assert.equal((await tentativa.json()).error.code, 'so_o_dono')
    const outro = store.createProject({ name: 'Outro projeto', objective: 'Testar o escopo' }).id
    const donoDeOutro = store.createAuthToken({ name: 'Dono de outro projeto', tokenType: 'user_session', role: 'owner', projectId: outro })
    const outroEscopo = await post('', alvo, { Authorization: `Bearer ${donoDeOutro.token}` })
    assert.equal(outroEscopo.status, 403)
    assert.deepEqual((await outroEscopo.json()).error, {
      code: 'forbidden_project_scope', message: 'Este token não possui permissão para acessar este projeto.',
    })
    const donoDoProjeto = store.createAuthToken({ name: 'Dono deste projeto', tokenType: 'user_session', role: 'owner', projectId })
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${donoDoProjeto.token}` } })).status, 200)
    const exclusao = await post('', { ...alvo, agent: 'Identidade falsa', origem: 'mcp' })
    assert.equal(exclusao.status, 201)
    const item = await exclusao.json()
    assert.equal(item.excluidoPor, 'Dono')
    assert.equal(item.pedidoDoDono, null)
    assert.deepEqual(await (await fetch(url)).json(), [item])
    assert.deepEqual(await (await post('/restaurar', alvo)).json(), { ok: true })
    await post('', alvo)
    const semConfirmar = await post('/apagar', alvo)
    assert.equal(semConfirmar.status, 400)
    assert.equal((await semConfirmar.json()).error.code, 'confirmacao_obrigatoria')
    assert.deepEqual(await (await post('/apagar', { ...alvo, confirmar: true })).json(), { ok: true })
    assert.deepEqual(await (await fetch(url)).json(), [])
    const [auditoria] = store.listAuditLogs({ projectId, action: 'purge_record' })
    assert.equal(auditoria?.actorType, 'user')
    assert.equal(auditoria?.actorId, 'Dono')
    assert.equal(auditoria?.details.pedidoDoDono, 'Apagamento definitivo confirmado na tela.')
  } finally {
    server.closeAllConnections()
    server.close()
    store.close()
  }
})

test('as quatro ferramentas MCP funcionam no transporte em memória e exigem o pedido do dono', async () => {
  const { store, projectId, tipo, id } = preparar()
  const cliente = new Client({ name: 'teste-lixeira', version: '1' })
  const servidor = createMcpServer(store)
  const [transporteCliente, transporteServidor] = InMemoryTransport.createLinkedPair()
  try {
    await servidor.connect(transporteServidor)
    await cliente.connect(transporteCliente)
    const tools = (await cliente.listTools()).tools.map((tool) => tool.name)
    for (const nome of ['trash_record', 'restore_record', 'purge_record', 'list_trash']) assert.ok(tools.includes(nome), nome)
    const chamar = async (name: string, args = {}) => {
      const resposta = await cliente.callTool({ name, arguments: { projectId, ...args } })
      const conteudo = resposta.content
      assert.ok(Array.isArray(conteudo) && conteudo[0]?.type === 'text')
      return JSON.parse(conteudo[0].text)
    }
    const alvo = { tipo, id, agent: 'Codex' }
    assert.equal((await chamar('trash_record', alvo)).error.code, 'pedido_do_dono_obrigatorio')
    const item = await chamar('trash_record', { ...alvo, pedidoDoDono: 'Exclui o cartão.' })
    assert.equal(item.excluidoPor, 'Codex')
    assert.deepEqual(await chamar('list_trash'), [item])
    assert.deepEqual(await chamar('restore_record', alvo), { ok: true })
    await chamar('trash_record', { ...alvo, pedidoDoDono: 'Exclui o cartão.' })
    assert.equal((await chamar('purge_record', { ...alvo, confirmar: true })).error.code, 'pedido_do_dono_obrigatorio')
    assert.deepEqual(await chamar('purge_record', { ...alvo, confirmar: true, pedidoDoDono: 'Pode apagar de vez.' }), { ok: true })
    assert.deepEqual(await chamar('list_trash'), [])
  } finally {
    await cliente.close()
    await servidor.close()
    store.close()
  }
})
