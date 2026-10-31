import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../server/mcp-tools.ts'
import { INSTRUCOES_DO_SERVIDOR } from '../server/mcp-instrucoes.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'

/**
 * Busca na memória (D7) pelo caminho de verdade: o store (gravando pelas operações de sempre, que os
 * gatilhos levam ao índice), apagar projeto, banco antigo num arquivo, reconstrução e a ferramenta MCP.
 * Nenhum teste usa o banco real: cada um tem a própria pasta temporária ou banco em memória.
 */

const stores: WorkspaceStore[] = []
const pastas: string[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function arquivoTemporario(): string {
  const pasta = mkdtempSync(path.join(tmpdir(), 'axon-busca-'))
  pastas.push(pasta)
  return path.join(pasta, 'busca.sqlite')
}

function novaAxon(arquivo = ':memory:') {
  let instante = Date.parse('2026-10-25T10:00:00.000Z')
  const store = new WorkspaceStore(arquivo, { now: () => new Date((instante += 60_000)) })
  stores.push(store)
  const alfa = store.createProject({ name: 'Alfa', objective: 'Vender cursos de confeitaria pela internet' }).id
  const outro = store.createProject({ name: 'Outro', objective: 'Outro objetivo qualquer' }).id
  return { store, alfa, outro }
}

function semearPeloStore(store: WorkspaceStore, alfa: string, outro: string) {
  const mensagem = store.postMessage(alfa, { from: 'claude', to: 'dono', kind: 'note', body: 'O checkout com Pix ficou pronto.' })
  const cartao = store.createBoardCard(alfa, { actor: 'claude', title: 'Checkout no celular', description: 'Ajustar o botão de pagar.' })
  const decisao = store.proposeDecision(alfa, { agent: 'claude', title: 'Checkout só com Pix', body: 'Cartão fica para depois.' })
  const global = store.registrarLicao(null, { texto: 'No Windows, o Stryker roda pelo binário local.', agent: 'claude' })
  const doOutro = store.postMessage(outro, { from: 'claude', to: 'dono', kind: 'note', body: 'Checkout do outro projeto.' })
  const conteudo = store.createContent(alfa, {
    title: 'Guia do checkout', kind: 'note', body: 'Como o cliente paga.', createdBy: 'claude', sourceKind: 'agent_report',
  })
  return { mensagem, cartao, decisao, global, doOutro, conteudo }
}

describe('busca na memória pelo store', () => {
  it('acha o que foi gravado pelas operações de sempre, só do projeto e as lições globais', () => {
    const { store, alfa, outro } = novaAxon()
    const s = semearPeloStore(store, alfa, outro)
    const r = store.searchMemory(alfa, { query: 'checkout' })
    assert.deepEqual(r.map((x) => `${x.tipo}:${x.id}`).sort(), [
      `biblioteca:${s.conteudo.item.id}`, `cartao:${s.cartao.id}`, `decisao:${s.decisao.id}`, `mensagem:${s.mensagem.id}`,
    ].sort())
    assert.deepEqual(store.searchMemory(outro, { query: 'stryker windows' }).map((x) => x.id), [s.global.id])
    assert.deepEqual(store.searchMemory(alfa, { query: 'confeitaria' }).map((x) => x.tipo), ['diretriz'])
  })

  it('revisar o conteúdo da biblioteca: a busca acha a revisão vigente e não a anterior', () => {
    const { store, alfa, outro } = novaAxon()
    const s = semearPeloStore(store, alfa, outro)
    store.reviseContent(alfa, s.conteudo.item.id, {
      expectedVersion: s.conteudo.item.version, title: 'Guia do pagamento', body: 'Agora com boleto.', createdBy: 'claude', sourceKind: 'agent_report',
    })
    assert.deepEqual(store.searchMemory(alfa, { query: 'boleto' }).map((x) => [x.tipo, x.id, x.titulo]), [
      ['biblioteca', s.conteudo.item.id, 'Guia do pagamento'],
    ])
    assert.deepEqual(store.searchMemory(alfa, { query: 'cliente paga' }), [])
  })

  it('arquivar o conteúdo da biblioteca: continua na busca, com metade da pontuação', () => {
    const { store, alfa, outro } = novaAxon()
    const s = semearPeloStore(store, alfa, outro)
    const [antes] = store.searchMemory(alfa, { query: 'guia' })
    store.archiveContent(alfa, s.conteudo.item.id, { expectedVersion: s.conteudo.item.version })
    const [depois] = store.searchMemory(alfa, { query: 'guia' })
    assert.equal(depois.id, s.conteudo.item.id)
    assert.ok(Math.abs(depois.pontuacao / antes.pontuacao - 0.5) < 0.002, `${depois.pontuacao} / ${antes.pontuacao}`)
  })

  it('projeto inexistente: 404; id inválido: 400', () => {
    const { store } = novaAxon()
    assert.throws(() => store.searchMemory('99999999-9999-4999-8999-999999999999', { query: 'x' }), (e: unknown) =>
      e instanceof DomainError && e.status === 404 && e.code === 'not_found')
    assert.throws(() => store.searchMemory('nao-e-uuid', { query: 'x' }), (e: unknown) =>
      e instanceof DomainError && e.status === 400)
  })

  it('apagar o projeto apaga as linhas dele no índice; as globais e as do outro ficam', () => {
    const arquivo = arquivoTemporario()
    const { store, alfa, outro } = novaAxon(arquivo)
    const s = semearPeloStore(store, alfa, outro)
    store.deleteProject(alfa, 'Alfa')
    const cru = new DatabaseSync(arquivo)
    try {
      const linhas = cru.prepare('SELECT tipo, fonte_id AS id, project_id AS projeto FROM memoria_itens ORDER BY tipo').all()
      assert.deepEqual(
        linhas.map((l) => ({ ...l })),
        [
          { tipo: 'diretriz', id: (cru.prepare('SELECT id FROM charter_revisions WHERE project_id = ?').get(outro) as { id: string }).id, projeto: outro },
          { tipo: 'licao', id: s.global.id, projeto: null },
          { tipo: 'mensagem', id: s.doOutro.id, projeto: outro },
        ],
      )
      assert.equal((cru.prepare('SELECT count(*) AS n FROM memoria_fts').get() as { n: number }).n, 3)
    } finally {
      cru.close()
    }
  })

  it('banco antigo (sem o índice) num arquivo: a primeira abertura indexa o que já existia', () => {
    const arquivo = arquivoTemporario()
    const { store, alfa, outro } = novaAxon(arquivo)
    const s = semearPeloStore(store, alfa, outro)
    store.close()
    stores.splice(stores.indexOf(store), 1)
    const cru = new DatabaseSync(arquivo)
    for (const { name } of cru.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'memoria%'").all() as Array<{ name: string }>) {
      cru.exec(`DROP TRIGGER ${name}`)
    }
    cru.exec('DROP TABLE memoria_fts; DROP TABLE memoria_itens')
    cru.close()
    const reaberto = new WorkspaceStore(arquivo)
    stores.push(reaberto)
    assert.deepEqual(reaberto.searchMemory(alfa, { query: 'pix', tipos: ['mensagem', 'decisao'] }).map((x) => x.id).sort(), [s.mensagem.id, s.decisao.id].sort())
    assert.deepEqual(reaberto.searchMemory(alfa, { query: 'guia', tipos: ['biblioteca'] }).map((x) => x.id), [s.conteudo.item.id])
  })

  it('rebuildMemoriaIndex refaz o índice desencontrado', () => {
    const arquivo = arquivoTemporario()
    const { store, alfa, outro } = novaAxon(arquivo)
    const s = semearPeloStore(store, alfa, outro)
    const cru = new DatabaseSync(arquivo)
    cru.exec('DELETE FROM memoria_itens')
    cru.close()
    assert.deepEqual(store.searchMemory(alfa, { query: 'pix', tipos: ['mensagem'] }), [])
    store.rebuildMemoriaIndex()
    assert.deepEqual(store.searchMemory(alfa, { query: 'pix', tipos: ['mensagem'] }).map((x) => x.id), [s.mensagem.id])
  })
})

describe('search_memory pelo MCP', () => {
  async function conectar() {
    const { store, alfa, outro } = novaAxon()
    const s = semearPeloStore(store, alfa, outro)
    const server = createMcpServer(store)
    const client = new Client({ name: 'busca-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const chamar = async (args: Record<string, unknown>) => {
      const response = await client.callTool({ name: 'search_memory', arguments: args })
      const content = response.content as Array<{ type: string; text: string }>
      return { erro: response.isError === true, texto: content[0].text }
    }
    const encerrar = async () => {
      await client.close()
      await server.close()
    }
    return { chamar, encerrar, client, alfa, s }
  }

  it('a ferramenta existe, só lê, com os campos do desenho', async () => {
    const { client, encerrar } = await conectar()
    try {
      const ferramenta = (await client.listTools()).tools.find((f) => f.name === 'search_memory')
      assert.ok(ferramenta)
      assert.deepEqual(Object.keys(ferramenta.inputSchema.properties ?? {}).sort(), ['limit', 'projectId', 'query', 'tipos'])
      assert.deepEqual(ferramenta.inputSchema.required?.sort(), ['projectId', 'query'])
      assert.equal(ferramenta.annotations?.readOnlyHint, true)
      assert.match(ferramenta.description ?? '', /get_\*/)
      assert.match(ferramenta.description ?? '', /tratada como texto/)
    } finally {
      await encerrar()
    }
  })

  it('devolve a lista curta; consulta com operadores e emoji não dá erro', async () => {
    const { chamar, encerrar, alfa, s } = await conectar()
    try {
      const r = await chamar({ projectId: alfa, query: 'pix', tipos: ['mensagem'] })
      assert.equal(r.erro, false)
      const lista = JSON.parse(r.texto) as Array<Record<string, unknown>>
      assert.deepEqual(lista.map((x) => Object.keys(x)), [['tipo', 'id', 'titulo', 'data', 'trecho', 'pontuacao']])
      assert.equal(lista[0].id, s.mensagem.id)
      for (const query of ['"pix', 'pix AND NOT', 'NEAR(pix)', '🚀', '   ', '-pix*', 'pix:(']) {
        const resposta = await chamar({ projectId: alfa, query })
        assert.equal(resposta.erro, false, `${query}: ${resposta.texto}`)
      }
    } finally {
      await encerrar()
    }
  })

  it('recusa limit fora de 1 a 50, tipo desconhecido e projeto inexistente', async () => {
    const { chamar, encerrar, alfa } = await conectar()
    try {
      assert.equal((await chamar({ projectId: alfa, query: 'pix', limit: 51 })).erro, true)
      assert.equal((await chamar({ projectId: alfa, query: 'pix', limit: 0 })).erro, true)
      assert.equal((await chamar({ projectId: alfa, query: 'pix', tipos: ['tarefa'] })).erro, true)
      const inexistente = await chamar({ projectId: '99999999-9999-4999-8999-999999999999', query: 'pix' })
      assert.equal(inexistente.erro, true)
      assert.equal(JSON.parse(inexistente.texto).error.code, 'not_found')
    } finally {
      await encerrar()
    }
  })

  it('as instruções do servidor citam a busca e continuam em até 4.096 caracteres', () => {
    assert.match(INSTRUCOES_DO_SERVIDOR, /search_memory/)
    assert.ok(INSTRUCOES_DO_SERVIDOR.length <= 4096, `${INSTRUCOES_DO_SERVIDOR.length}`)
  })
})
