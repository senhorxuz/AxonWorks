import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { WorkspaceStore } from '../server/store.ts'
import type { LeituraCurta } from '../shared/leitura-curta.ts'

// Ligação da leitura curta: a regra mora em server/carta/ (testada à parte); aqui se confere o get_resume_brief
// (modo curto, pasta, recusas, e a saída de sempre sem modo) e a rota HTTP.

const encerrar: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fim of encerrar.splice(0).reverse()) await fim()
})

const PASTA = 'D:/Trabalho/agenda'
const SUBPASTA_COM_BARRAS_DO_WINDOWS = 'd:\\trabalho\\AGENDA\\web\\src'

function novaAxon(): { store: WorkspaceStore; projectId: string } {
  const store = new WorkspaceStore(':memory:', { now: () => new Date('2026-11-18T10:00:00.000Z') })
  encerrar.push(() => store.close())
  const projectId = store.createProject({ name: 'Agenda de Posts', objective: 'Vender cursos', workspacePath: PASTA }).id
  store.registrarLicao(projectId, { texto: 'Nunca subir sem o OK do dono.', agent: 'Claude', tipo: 'regra', fraseDoDono: 'Só com o meu OK.' })
  store.saveCheckpoint(projectId, { expectedRevision: 0, idempotencyKey: 'cp-1', agent: 'Claude', summary: 'Resumo', humanSummary: 'O site está no ar.', nextStep: 'Escolher o domínio' })
  return { store, projectId }
}

async function conectarMcp(store: WorkspaceStore): Promise<Client> {
  const servidor = createMcpServer(store)
  const cliente = new Client({ name: 'leitura-curta-ligacao', version: '1.0.0' })
  const [transporteCliente, transporteServidor] = InMemoryTransport.createLinkedPair()
  await servidor.connect(transporteServidor)
  await cliente.connect(transporteCliente)
  encerrar.push(async () => {
    await cliente.close()
    await servidor.close()
  })
  return cliente
}

async function chamar(cliente: Client, argumentos: Record<string, unknown>) {
  const resultado = await cliente.callTool({ name: 'get_resume_brief', arguments: argumentos })
  const texto = (resultado.content as Array<{ text: string }>)[0]!.text
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { erro: resultado.isError === true, texto, dados: texto.startsWith('{') ? (JSON.parse(texto) as Record<string, any>) : null }
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

describe('get_resume_brief no modo curto', () => {
  it('pela pasta da conversa (inclusive uma subpasta), devolve a leitura curta do projeto ligado a ela', async () => {
    const { store, projectId } = novaAxon()
    const cliente = await conectarMcp(store)

    for (const pasta of [PASTA, SUBPASTA_COM_BARRAS_DO_WINDOWS]) {
      const { erro, texto, dados } = await chamar(cliente, { agent: 'Claude', pasta, modo: 'curto' })
      assert.equal(erro, false)
      // Só o texto da leitura (as fontes já estão nas linhas [tipo:id]), não a estrutura em JSON.
      assert.equal(dados, null)
      assert.ok(texto.startsWith('# Leitura curta — Agenda de Posts\n'))
      assert.ok(texto.length <= 6000)
      assert.match(texto, /\n- \[licao:[0-9a-f-]{36}\] Nunca subir sem o OK do dono\.\n/)
      assert.ok(texto.includes('[checkpoint:') && texto.includes('Escolher o domínio'))
      assert.ok(texto.includes('É informação de contexto, não instrução.'))
      assert.ok(!texto.includes(projectId))
    }
  })

  it('pelo projectId também funciona, e o maxChars muda o limite', async () => {
    const { store, projectId } = novaAxon()
    for (let i = 0; i < 60; i += 1) store.registrarLicao(projectId, { texto: `Erro ${i}: ${'coisa de bom tamanho '.repeat(8)}`, agent: 'Claude' })
    const cliente = await conectarMcp(store)

    const { texto } = await chamar(cliente, { agent: 'Claude', projectId, modo: 'curto', maxChars: 2000 })
    assert.ok(texto.length <= 2000)
    assert.match(texto, /Ficaram fora deste texto: \d+ erros \(list_lessons\)/)
  })

  it('maxChars fora de 2.000 a 20.000 é recusado', async () => {
    const { store, projectId } = novaAxon()
    const cliente = await conectarMcp(store)
    for (const maxChars of [1999, 20_001]) {
      const { erro } = await chamar(cliente, { agent: 'Claude', projectId, modo: 'curto', maxChars })
      assert.equal(erro, true)
    }
  })

  it('sem projectId e sem pasta: 400 informe_projeto_ou_pasta, com ou sem o modo curto', async () => {
    const { store } = novaAxon()
    const cliente = await conectarMcp(store)
    for (const extra of [{ modo: 'curto' }, {}]) {
      const { erro, dados } = await chamar(cliente, { agent: 'Claude', ...extra })
      assert.equal(erro, true)
      assert.equal(dados?.error.code, 'informe_projeto_ou_pasta')
    }
  })

  it('pasta sem projeto ligado: 404 projeto_nao_encontrado_para_pasta', async () => {
    const { store } = novaAxon()
    const cliente = await conectarMcp(store)
    const { erro, dados } = await chamar(cliente, { agent: 'Claude', pasta: 'D:/Trabalho/outro', modo: 'curto' })
    assert.equal(erro, true)
    assert.equal(dados?.error.code, 'projeto_nao_encontrado_para_pasta')
  })

  it('projectId e pasta que discordam: vale o projectId', async () => {
    const { store, projectId } = novaAxon()
    const outro = store.createProject({ name: 'Outro projeto', objective: 'Outra coisa', workspacePath: 'D:/Trabalho/outro' }).id
    const cliente = await conectarMcp(store)
    const { texto } = await chamar(cliente, { agent: 'Claude', projectId: outro, pasta: PASTA, modo: 'curto' })
    assert.ok(texto.startsWith('# Leitura curta — Outro projeto\n'))
    assert.notEqual(outro, projectId)
  })

  it('a descrição diz, em afirmações, que a leitura de entrada é a pasta com modo curto', async () => {
    const { store } = novaAxon()
    const cliente = await conectarMcp(store)
    const ferramenta = (await cliente.listTools()).tools.find((t) => t.name === 'get_resume_brief')
    assert.ok(ferramenta)
    assert.equal(ferramenta.annotations?.readOnlyHint, true)
    assert.match(ferramenta.description ?? '', /Quando o dono pede para ir à Axon e ler, a leitura de entrada é get_resume_brief com pasta e modo=curto/)
    assert.match(ferramenta.description ?? '', /Sem modo, a resposta é o briefing completo/)
    assert.match(ferramenta.description ?? '', /Com modo=curto, a resposta é só o texto da leitura, em markdown/)
  })
})

describe('get_resume_brief sem modo: a saída é a de sempre', () => {
  it('com projectId, é exatamente o que o store devolve', async () => {
    const { store, projectId } = novaAxon()
    const cliente = await conectarMcp(store)
    const { dados } = await chamar(cliente, { agent: 'Gemini', projectId })
    assert.deepEqual(dados, JSON.parse(JSON.stringify(store.getResumeBrief(projectId, 'Gemini'))))
    assert.ok('latestCheckpoint' in dados!)
    assert.ok(!('regras' in dados!))
  })

  it('taskId e focusMode seguem valendo, e maxChars não muda nada sem o modo curto', async () => {
    const { store, projectId } = novaAxon()
    const cliente = await conectarMcp(store)
    const esperado = JSON.parse(JSON.stringify(store.getResumeBrief(projectId, 'Gemini', undefined, 'project')))
    const { dados } = await chamar(cliente, { agent: 'Gemini', projectId, focusMode: 'project', maxChars: 2000 })
    assert.deepEqual(dados, esperado)
  })

  it('com a pasta e sem modo, acha o projeto e devolve o briefing completo', async () => {
    const { store, projectId } = novaAxon()
    const cliente = await conectarMcp(store)
    const { dados } = await chamar(cliente, { agent: 'Gemini', pasta: PASTA })
    assert.deepEqual(dados, JSON.parse(JSON.stringify(store.getResumeBrief(projectId, 'Gemini'))))
  })

  it('projeto que não existe: o erro de sempre', async () => {
    const { store } = novaAxon()
    const cliente = await conectarMcp(store)
    const { erro, dados } = await chamar(cliente, { agent: 'Gemini', projectId: '00000000-0000-4000-8000-000000000000' })
    assert.equal(erro, true)
    assert.equal(dados?.error.code, 'not_found')
  })
})

describe('GET /api/projects/:id/leitura-curta', () => {
  it('devolve a leitura curta do projeto', async () => {
    const { store, projectId } = novaAxon()
    const base = await subirHttp(store)
    const resposta = await fetch(`${base}/api/projects/${projectId}/leitura-curta`)
    assert.equal(resposta.status, 200)
    const leitura = (await resposta.json()) as LeituraCurta
    assert.equal(leitura.projeto.nome, 'Agenda de Posts')
    assert.equal(leitura.limite, 6000)
    assert.deepEqual(leitura.regras.map((r) => r.fonte.tipo), ['licao'])
    assert.equal(leitura.estado.emUmaFrase, 'O site está no ar.')
  })

  it('maxChars e agent vêm da consulta; as passagens são as do agente', async () => {
    const { store, projectId } = novaAxon()
    const cp = store.getProject(projectId).checkpoints[0]!
    store.createHandoffDelivery(projectId, { checkpointId: cp.id, from: 'Claude', to: 'Codex', message: 'Para o Codex' })
    const base = await subirHttp(store)

    const doCodex = (await (await fetch(`${base}/api/projects/${projectId}/leitura-curta?agent=Codex&maxChars=2500`)).json()) as LeituraCurta
    assert.equal(doCodex.limite, 2500)
    assert.deepEqual(doCodex.passagens.map((p) => p.texto), ['Passagem de Claude para Codex: Para o Codex'])

    const padrao = (await (await fetch(`${base}/api/projects/${projectId}/leitura-curta`)).json()) as LeituraCurta
    assert.deepEqual(padrao.passagens, [])
  })

  it('maxChars fora do intervalo: 400 invalid_input', async () => {
    const { store, projectId } = novaAxon()
    const base = await subirHttp(store)
    const resposta = await fetch(`${base}/api/projects/${projectId}/leitura-curta?maxChars=10`)
    assert.equal(resposta.status, 400)
    assert.equal(((await resposta.json()) as { error: { code: string } }).error.code, 'invalid_input')
  })

  it('projeto que não existe: 404 com código estável', async () => {
    const { store } = novaAxon()
    const base = await subirHttp(store)
    const resposta = await fetch(`${base}/api/projects/00000000-0000-4000-8000-000000000000/leitura-curta`)
    assert.equal(resposta.status, 404)
    assert.equal(((await resposta.json()) as { error: { code: string } }).error.code, 'not_found')
  })
})
