import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { WorkspaceStore } from '../server/store.ts'
import type { Carta } from '../shared/carta.ts'

// Ligação da carta "Onde paramos": a regra mora em server/carta/ (testada à parte); aqui só se confere
// que a rota HTTP e a ferramenta MCP chamam a regra com o relógio de verdade e devolvem a carta inteira.

const encerrar: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fim of encerrar.splice(0).reverse()) await fim()
})

const DIA = 86_400_000

/** Axon cujo "agora" de gravação está 10 dias no passado: o projeto nasce e fica parado. */
function axonParada(): { store: WorkspaceStore; projectId: string } {
  const gravadoEm = new Date(Date.now() - 10 * DIA)
  const store = new WorkspaceStore(':memory:', { now: () => gravadoEm })
  encerrar.push(() => store.close())
  const projectId = store.createProject({ name: 'Alfa Exemplo', objective: 'Vender cursos pela internet' }).id
  store.createBoardCard(projectId, { actor: 'Claude', title: 'Publicar o site', column: 'in_progress' })
  store.proposeDecision(projectId, { agent: 'Claude', title: 'Usar Postgres', body: 'Por causa da escala' })
  return { store, projectId }
}

async function subirHttp(store: WorkspaceStore): Promise<string> {
  const servidor = createServer(createApp(store))
  servidor.listen(0, '127.0.0.1')
  await once(servidor, 'listening')
  encerrar.push(async () => {
    servidor.closeAllConnections()
    await new Promise<void>((resolve) => servidor.close(() => resolve()))
  })
  const endereco = servidor.address()
  assert.ok(endereco && typeof endereco !== 'string')
  return `http://127.0.0.1:${endereco.port}`
}

async function conectarMcp(store: WorkspaceStore): Promise<Client> {
  const servidor = createMcpServer(store)
  const cliente = new Client({ name: 'carta-ligacao', version: '1.0.0' })
  const [transporteCliente, transporteServidor] = InMemoryTransport.createLinkedPair()
  await servidor.connect(transporteServidor)
  await cliente.connect(transporteCliente)
  encerrar.push(async () => {
    await cliente.close()
    await servidor.close()
  })
  return cliente
}

describe('GET /api/projects/:id/carta', () => {
  it('devolve a carta montada com o relógio de verdade', async () => {
    const { store, projectId } = axonParada()
    const base = await subirHttp(store)

    const resposta = await fetch(`${base}/api/projects/${projectId}/carta`)

    assert.equal(resposta.status, 200)
    const carta = (await resposta.json()) as Carta
    assert.equal(carta.projeto.nome, 'Alfa Exemplo')
    assert.equal(carta.diasParado, 10)
    assert.deepEqual(carta.falta.em_andamento.map((i) => i.titulo), ['Publicar o site'])
    assert.deepEqual(carta.falta.precisa_de_voce.map((i) => [i.origem, i.titulo, i.versao]), [['decisao', 'Usar Postgres', 0]])
  })

  it('projeto que não existe: 404 com código estável, sem vazar detalhe', async () => {
    const { store } = axonParada()
    const base = await subirHttp(store)

    const resposta = await fetch(`${base}/api/projects/00000000-0000-4000-8000-000000000000/carta`)

    assert.equal(resposta.status, 404)
    const corpo = (await resposta.json()) as { error: { code: string } }
    assert.equal(corpo.error.code, 'not_found')
  })

  it('identificador que não é de projeto: 400', async () => {
    const { store } = axonParada()
    const base = await subirHttp(store)

    const resposta = await fetch(`${base}/api/projects/nao-e-um-id/carta`)

    assert.equal(resposta.status, 400)
  })
})

describe('ferramenta MCP get_where_we_stopped', () => {
  it('é só leitura e devolve a mesma carta da rota', async () => {
    const { store, projectId } = axonParada()
    const cliente = await conectarMcp(store)

    const ferramenta = (await cliente.listTools()).tools.find((t) => t.name === 'get_where_we_stopped')
    assert.ok(ferramenta, 'a ferramenta precisa existir')
    assert.equal(ferramenta.annotations?.readOnlyHint, true)
    assert.match(ferramenta.description ?? '', /Não inicia IA/)

    const resultado = await cliente.callTool({ name: 'get_where_we_stopped', arguments: { projectId } })

    assert.equal(resultado.isError, undefined)
    const carta = JSON.parse((resultado.content as Array<{ text: string }>)[0]!.text) as Carta
    assert.equal(carta.projeto.nome, 'Alfa Exemplo')
    assert.equal(carta.diasParado, 10)
    assert.deepEqual(carta.falta.em_andamento.map((i) => i.titulo), ['Publicar o site'])
    assert.deepEqual(carta.falta.precisa_de_voce.map((i) => i.titulo), ['Usar Postgres'])
  })

  it('projeto que não existe: erro com código estável', async () => {
    const { store } = axonParada()
    const cliente = await conectarMcp(store)

    const resultado = await cliente.callTool({
      name: 'get_where_we_stopped',
      arguments: { projectId: '00000000-0000-4000-8000-000000000000' },
    })

    assert.equal(resultado.isError, true)
    const corpo = JSON.parse((resultado.content as Array<{ text: string }>)[0]!.text) as { error: { code: string } }
    assert.equal(corpo.error.code, 'not_found')
  })
})
