import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test, type TestContext } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../server/app.js'
import { createMcpServer } from '../server/mcp-tools.js'
import { WorkspaceStore } from '../server/store.js'

const DATA = new Date('2026-11-20T14:00:00.000Z')
const ORIGINAL = 'Sistema na versão 1'
const objetivo = 'Sistema na versão 2'
const motivo = 'A versão no ar mudou'

function preparar(t: TestContext) {
  const store = new WorkspaceStore(':memory:', { now: () => DATA })
  t.after(() => store.close())
  const projeto = store.createProject({ name: 'Projeto de teste', objective: ORIGINAL })
  return { store, entrada: { projectId: projeto.id, agent: 'IA de teste', objetivo, motivo, expectedRevision: 1 } }
}

async function clienteMcp(t: TestContext, store: WorkspaceStore) {
  const server = createMcpServer(store)
  const client = new Client({ name: 'objetivo-teste', version: '1.0.0' })
  const [cliente, servidor] = InMemoryTransport.createLinkedPair()
  await server.connect(servidor)
  await client.connect(cliente)
  t.after(async () => { await client.close(); await server.close() })
  return client
}

async function clienteHttp(t: TestContext, store: WorkspaceStore) {
  const server = createServer(createApp(store))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const base = `http://127.0.0.1:${address.port}/api/projects/`
  return (caminho: string, token?: string) => fetch(base + caminho, caminho.endsWith('/carta') ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: '{}',
  })
}

test('MCP publica atualização com descrição de escopo e mantém a fila do save_charter', async (t) => {
  const { store, entrada } = preparar(t)
  const client = await clienteMcp(t, store)
  const { tools } = await client.listTools()
  const tool = tools.find(({ name }) => name === 'update_project_objective')
  assert.match(tool?.description ?? '', /só corrige fatos vencidos/)
  assert.match(tool?.description ?? '', /As regras que o dono escreveu ficam como estão/)
  assert.deepEqual(tool?.inputSchema.required?.toSorted(), ['agent', 'expectedRevision', 'motivo', 'objetivo', 'projectId'])
  assert.equal(tool?.annotations?.readOnlyHint, false)
  assert.equal(tools.some(({ name }) => /^(mark|undo|visto|desfazer).*charter/.test(name)), false)

  async function chamar(name: string, args: Record<string, unknown>) {
    const resposta = await client.callTool({ name, arguments: args })
    assert.ok(Array.isArray(resposta.content))
    const conteudo = resposta.content[0]
    assert.equal(conteudo.type, 'text')
    return { erro: resposta.isError === true, resultado: JSON.parse(conteudo.text) }
  }

  const { projectId, agent } = entrada
  const proposta = await chamar('save_charter', { projectId, actor: agent, body: 'Uma proposta', expectedRevision: 1, sourceKind: 'agent_proposal' })
  assert.equal(proposta.erro, false)
  assert.equal(proposta.resultado.status, 'pending_approval')
  assert.equal(store.getCharter(projectId)?.body, ORIGINAL)
  const vazio = await chamar('update_project_objective', { ...entrada, motivo: ' ' })
  assert.equal(vazio.erro, true)
  assert.equal(vazio.resultado.error.code, 'invalid_input')
  const correta = await chamar('update_project_objective', entrada)
  assert.equal(correta.erro, false)
  assert.equal(correta.resultado.sourceKind, 'agent_update')
  assert.deepEqual(correta.resultado, store.getCharter(projectId))
  const repetida = await chamar('update_project_objective', entrada)
  assert.equal(repetida.erro, true)
  assert.equal(repetida.resultado.error.code, 'version_conflict')
})

test('as rotas do dono retiram o aviso e recuperam o objetivo com uma revisão nova', async (t) => {
  const { store, entrada } = preparar(t)
  const { projectId } = entrada
  const pedir = await clienteHttp(t, store)
  const carta = async () => {
    const resposta = await pedir(`${projectId}/carta`)
    assert.equal(resposta.status, 200)
    return resposta.json()
  }
  const anterior = store.getCharter(projectId)!
  const nova = store.updateProjectObjective(projectId, entrada)
  assert.deepEqual((await carta()).avisos, ['O objetivo foi atualizado por IA de teste em 20/11/2026: A versão no ar mudou. Confira na aba Diretriz.'])
  const vista = await pedir(`${projectId}/charter/visto`)
  assert.equal(vista.status, 200)
  assert.deepEqual(await vista.json(), { ...nova, vistoPeloDonoEm: DATA.toISOString() })
  const depois = await carta()
  assert.deepEqual(depois.avisos, [])
  assert.deepEqual(depois.avisosDaRetomada, [])

  const desfeita = await pedir(`${projectId}/charter/desfazer`)
  assert.equal(desfeita.status, 200)
  const restaurada = await desfeita.json()
  assert.equal(restaurada.body, anterior.body)
  assert.equal(restaurada.createdBy, 'Dono')
  assert.equal(restaurada.sourceKind, 'human_directive')
  assert.equal(restaurada.supersedesId, nova.id)
  assert.equal(restaurada.revision, 3)
  assert.equal((await carta()).projeto.objetivo, ORIGINAL)
  const jaDesfeita = await pedir(`${projectId}/charter/desfazer`)
  assert.equal(jaDesfeita.status, 409)
  assert.equal((await jaDesfeita.json()).error.code, 'nada_a_desfazer')
  for (const acao of ['visto', 'desfazer']) {
    const ausente = await pedir(`${randomUUID()}/charter/${acao}`)
    assert.equal(ausente.status, 404)
    assert.equal((await ausente.json()).error.code, 'not_found')
  }
})

test('as duas rotas recusam usuários sem papel de dono, incluindo token de agente com papel owner', async (t) => {
  const { store, entrada } = preparar(t)
  const { projectId } = entrada
  const pedir = await clienteHttp(t, store)
  const nova = store.updateProjectObjective(projectId, entrada)
  const outro = store.createProject({ name: 'Outro projeto', objective: ORIGINAL })
  const { token: agente } = store.createAuthToken({ name: 'IA', tokenType: 'agent', role: 'owner', agentName: 'Codex' })
  const { token: colaborador } = store.createAuthToken({ name: 'Colaborador', tokenType: 'user_session', role: 'collaborator' })
  const { token: donoDeOutro } = store.createAuthToken({ name: 'Dono de outro projeto', tokenType: 'user_session', role: 'owner', projectId: outro.id })
  // Dono de OUTRO projeto é barrado antes, pela conferência de escopo de toda rota /api/projects/:id (server/auth/escopo.ts).
  const esperado = new Map([[agente, 'so_o_dono'], [colaborador, 'so_o_dono'], [donoDeOutro, 'forbidden_project_scope']])
  for (const [token, code] of esperado) {
    for (const acao of ['visto', 'desfazer']) {
      const resposta = await pedir(`${projectId}/charter/${acao}`, token)
      assert.equal(resposta.status, 403)
      assert.equal((await resposta.json()).error.code, code)
    }
  }
  assert.deepEqual(store.getCharter(projectId), nova)
  const { token: dono } = store.createAuthToken({ name: 'Dono do projeto', tokenType: 'user_session', role: 'owner', projectId })
  const vista = await pedir(`${projectId}/charter/visto`, dono)
  assert.equal(vista.status, 200)
  assert.equal((await vista.json()).vistoPeloDonoEm, DATA.toISOString())
})
