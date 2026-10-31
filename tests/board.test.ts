import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, test } from 'node:test'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DatabaseSync } from 'node:sqlite'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import { ensureBoardSchema, getBoard } from '../server/store/board.ts'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { BOARD_COLUMNS, BOARD_LIMITS } from '../shared/board.ts'
import type { Project } from '../shared/types.ts'

let cleanups: Array<() => void> = []

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) {
    try {
      dispose()
    } catch {
      /* ignore */
    }
  }
})

function makeStore(): WorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'axon-board-'))
  const store = new WorkspaceStore(join(dir, 'workspace.sqlite'))
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

function expectDomain(fn: () => unknown, status: number, code: string, messagePattern?: RegExp | string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof DomainError, `esperado DomainError, recebido ${String(err)}`)
    assert.equal(err.status, status)
    assert.equal(err.code, code)
    if (messagePattern instanceof RegExp) {
      assert.match(err.message, messagePattern)
    } else if (typeof messagePattern === 'string') {
      assert.equal(err.message, messagePattern)
    }
    return true
  })
}

function seed(store: WorkspaceStore): Project {
  return store.createProject({ name: 'Projeto Quadro', objective: 'Testar quadro do projeto' })
}

async function httpFixture(t: { after: (fn: () => unknown) => void }) {
  const store = new WorkspaceStore(':memory:')
  const app = createApp(store)
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('endereço inválido')
  const base = `http://127.0.0.1:${address.port}`
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  })
  const headers = {
    'Content-Type': 'application/json',
    'X-Workspace-Client': 'local',
    Host: `127.0.0.1:${address.port}`,
    Origin: `http://127.0.0.1:${address.port}`,
  }
  const post = (urlPath: string, body: unknown) =>
    fetch(base + urlPath, { method: 'POST', headers, body: JSON.stringify(body) })
  const get = (urlPath: string) => fetch(base + urlPath, { headers: { Host: headers.Host, Origin: headers.Origin } })
  return { store, post, get }
}

describe('quadro do projeto (Parte 14) — TDD', () => {
  // 1. Criar com o mínimo: coluna pending, fim da coluna, descrição vazia, versão 0 e evento "Criou o cartão em Pendente".
  it('1. cria cartão com o mínimo e grava evento inicial', () => {
    const store = makeStore()
    const project = seed(store)

    const card = store.createBoardCard(project.id, {
      actor: 'Astra',
      title: 'Cartão Mínimo',
    })

    assert.ok(card.id)
    assert.equal(card.projectId, project.id)
    assert.equal(card.column, 'pending')
    assert.equal(card.position, 1024)
    assert.equal(card.title, 'Cartão Mínimo')
    assert.equal(card.description, '')
    assert.deepEqual(card.labels, [])
    assert.equal(card.priority, null)
    assert.deepEqual(card.checklist, [])
    assert.equal(card.createdBy, 'Astra')
    assert.equal(card.updatedBy, 'Astra')
    assert.equal(card.version, 0)
    assert.ok(card.createdAt)
    assert.ok(card.updatedAt)

    const events = store.listBoardCardEvents(project.id, card.id)
    assert.equal(events.length, 1)
    assert.equal(events[0]!.kind, 'created')
    assert.equal(events[0]!.actor, 'Astra')
    assert.equal(events[0]!.fromColumn, null)
    assert.equal(events[0]!.toColumn, 'pending')
    assert.equal(events[0]!.summary, 'Criou o cartão em Pendente')
  })

  // 2. Título com exatamente 80 caracteres é aceito; com 81, erro board_title_too_long com a frase exata; com U+FFFD, recusado.
  it('2. valida limites de tamanho e integridade do título', () => {
    const store = makeStore()
    const project = seed(store)

    const title80 = 'A'.repeat(80)
    const card = store.createBoardCard(project.id, {
      actor: 'Astra',
      title: title80,
    })
    assert.equal(card.title, title80)

    const title81 = 'A'.repeat(81)
    expectDomain(
      () => store.createBoardCard(project.id, { actor: 'Astra', title: title81 }),
      400,
      'board_title_too_long',
      'O título passou de 80 caracteres. Use um título curto e deixe os detalhes na descrição.',
    )

    // Título muito curto (< 3 caracteres)
    expectDomain(
      () => store.createBoardCard(project.id, { actor: 'Astra', title: 'Oi' }),
      400,
      'invalid_input',
    )

    // Título com U+FFFD
    expectDomain(
      () => store.createBoardCard(project.id, { actor: 'Astra', title: 'T\uFFFDtulo corrompido' }),
      400,
      'corrupted_text',
    )
  })

  // 3. Etiqueta, prioridade e coluna inválidas são recusadas; etiqueta repetida é recusada.
  it('3. recusa etiquetas, prioridade e coluna inválidas, e duplicata de etiqueta', () => {
    const store = makeStore()
    const project = seed(store)

    // Coluna inválida
    expectDomain(
      () => store.createBoardCard(project.id, { actor: 'Astra', title: 'Válido', column: 'invalida' as any }),
      400,
      'invalid_input',
    )

    // Prioridade inválida
    expectDomain(
      () => store.createBoardCard(project.id, { actor: 'Astra', title: 'Válido', priority: 'mega' as any }),
      400,
      'invalid_input',
    )

    // Etiqueta inválida
    expectDomain(
      () => store.createBoardCard(project.id, { actor: 'Astra', title: 'Válido', labels: ['inexistente' as any] }),
      400,
      'invalid_input',
    )

    // Etiqueta duplicada
    expectDomain(
      () => store.createBoardCard(project.id, { actor: 'Astra', title: 'Válido', labels: ['bug', 'bug'] }),
      400,
      'invalid_input',
    )

    // Mais de labelsMax (4) etiquetas
    expectDomain(
      () => store.createBoardCard(project.id, { actor: 'Astra', title: 'Válido', labels: ['bug', 'feature', 'design', 'test', 'infra'] }),
      400,
      'invalid_input',
    )
  })

  // 4. Mover para o fim, antes de um cartão e na mesma coluna; a ordem do getBoard bate e os eventos têm as frases exatas.
  it('4. move cartões e reflete ordem e histórico corretos', () => {
    const store = makeStore()
    const project = seed(store)

    const c1 = store.createBoardCard(project.id, { actor: 'Astra', title: 'Cartão 1', column: 'pending' })
    const c2 = store.createBoardCard(project.id, { actor: 'Astra', title: 'Cartão 2', column: 'pending' })
    const c3 = store.createBoardCard(project.id, { actor: 'Astra', title: 'Cartão 3', column: 'pending' })

    // Mover c3 para antes de c1 na mesma coluna
    const movedC3 = store.moveBoardCard(project.id, c3.id, {
      actor: 'Grok',
      expectedVersion: c3.version,
      column: 'pending',
      beforeCardId: c1.id,
    })
    assert.equal(movedC3.version, 1)

    // Mover c2 para outra coluna (in_progress) no fim
    const movedC2 = store.moveBoardCard(project.id, c2.id, {
      actor: 'Grok',
      expectedVersion: c2.version,
      column: 'in_progress',
    })
    assert.equal(movedC2.column, 'in_progress')

    const board = store.getBoard(project.id)
    const pendingCards = board.cards.filter((c) => c.column === 'pending')
    assert.deepEqual(pendingCards.map((c) => c.id), [c3.id, c1.id])

    const inProgressCards = board.cards.filter((c) => c.column === 'in_progress')
    assert.deepEqual(inProgressCards.map((c) => c.id), [c2.id])

    const eventsC3 = store.listBoardCardEvents(project.id, c3.id)
    assert.equal(eventsC3[0]!.summary, 'Mudou a ordem em Pendente')

    const eventsC2 = store.listBoardCardEvents(project.id, c2.id)
    assert.equal(eventsC2[0]!.summary, 'Moveu de Pendente para Em andamento')
    assert.equal(eventsC2[0]!.fromColumn, 'pending')
    assert.equal(eventsC2[0]!.toColumn, 'in_progress')
  })

  // 5. Renumeração: forçar muitos movimentos para o mesmo intervalo mantém a ordem certa.
  it('5. renumera a coluna quando a folga fica menor que 1e-6 e preserva a ordem', () => {
    const store = makeStore()
    const project = seed(store)

    // Criar c1 e c2
    const c1 = store.createBoardCard(project.id, { actor: 'Astra', title: 'Base' })
    const c2 = store.createBoardCard(project.id, { actor: 'Astra', title: 'Fixo fim' })

    // Inserir repetidamente antes de c2 para quebrar a folga (2^-30 < 1e-6)
    const insertedIds: string[] = []
    for (let i = 0; i < 40; i++) {
      const card = store.createBoardCard(project.id, { actor: 'Astra', title: `Card ${i}` })
      store.moveBoardCard(project.id, card.id, {
        actor: 'Astra',
        expectedVersion: card.version,
        column: 'pending',
        beforeCardId: c2.id,
      })
      insertedIds.push(card.id)
    }

    const board = store.getBoard(project.id)
    const pending = board.cards.filter((c) => c.column === 'pending')
    assert.equal(pending[0]!.id, c1.id)
    assert.equal(pending[pending.length - 1]!.id, c2.id)
    // As posições devem ser estritamente crescentes
    for (let i = 1; i < pending.length; i++) {
      assert.ok(
        pending[i]!.position > pending[i - 1]!.position,
        `Posição fora de ordem no índice ${i}: ${pending[i]!.position} <= ${pending[i - 1]!.position}`,
      )
    }
  })

  // 6. Versão velha dá 409 version_conflict em atualizar, mover e excluir.
  it('6. exige expectedVersion e recusa versão desatualizada com 409 version_conflict', () => {
    const store = makeStore()
    const project = seed(store)

    const card = store.createBoardCard(project.id, { actor: 'Astra', title: 'Original' })

    // Versão esperada errada em atualizar
    expectDomain(
      () => store.updateBoardCard(project.id, card.id, { actor: 'Astra', expectedVersion: 99, title: 'Novo' }),
      409,
      'version_conflict',
    )

    // Versão esperada errada em mover
    expectDomain(
      () => store.moveBoardCard(project.id, card.id, { actor: 'Astra', expectedVersion: 99, column: 'in_progress' }),
      409,
      'version_conflict',
    )

    // Versão esperada errada em excluir
    expectDomain(
      () => store.deleteBoardCard(project.id, card.id, { actor: 'Astra', expectedVersion: 99 }),
      409,
      'version_conflict',
    )
  })

  // 7. Atualizar a lista de verificação gera "Concluiu: …", "Adicionou à lista: …" e "Tirou da lista: …"; atualizar sem mudar nada não gera evento nem soma versão.
  it('7. gera histórico detalhado de checklist e ignora atualização no-op', () => {
    const store = makeStore()
    const project = seed(store)

    const card = store.createBoardCard(project.id, {
      actor: 'Astra',
      title: 'Cartão com Checklist',
      checklist: [
        { text: 'Passo 1', done: false },
        { text: 'Passo 2', done: false },
      ],
    })
    assert.equal(card.checklist.length, 2)
    const [p1, p2] = card.checklist

    // Atualização 1: conclui Passo 1, remove Passo 2, adiciona Passo 3
    const u1 = store.updateBoardCard(project.id, card.id, {
      actor: 'Astra',
      expectedVersion: card.version,
      checklist: [
        { id: p1!.id, text: 'Passo 1', done: true },
        { text: 'Passo 3', done: false },
      ],
    })
    assert.equal(u1.version, 1)

    const events1 = store.listBoardCardEvents(project.id, card.id)
    assert.equal(events1[0]!.summary, 'Concluiu: Passo 1; Adicionou à lista: Passo 3; Tirou da lista: Passo 2')

    // Atualização 2 (no-op): passar exatamente o mesmo estado
    const u2 = store.updateBoardCard(project.id, card.id, {
      actor: 'Astra',
      expectedVersion: u1.version,
      title: u1.title,
      description: u1.description,
      labels: u1.labels,
      priority: u1.priority,
      checklist: u1.checklist,
    })
    assert.equal(u2.version, 1, 'Versão não deve mudar em no-op')
    const events2 = store.listBoardCardEvents(project.id, card.id)
    assert.equal(events2.length, 2, 'Nenhum evento novo deve ser gerado em no-op')
  })

  // 8. Excluir pelo HTTP funciona; o evento "Excluiu o cartão" continua listável; cartão de outro projeto dá 404.
  test('8. exclusão via HTTP, persistência do histórico e isolamento entre projetos', async (t) => {
    const { store, post, get } = await httpFixture(t)

    const p1Res = await post('/api/projects', { name: 'P1', objective: 'Obj 1' })
    const p1 = await p1Res.json()
    const p2Res = await post('/api/projects', { name: 'P2', objective: 'Obj 2' })
    const p2 = await p2Res.json()

    // Cria cartão via HTTP
    const createRes = await post(`/api/projects/${p1.id}/board/cards`, {
      actor: 'Dono',
      title: 'Cartão para Exclusão',
    })
    assert.equal(createRes.status, 201)
    const card = await createRes.json()

    // Consulta de outro projeto dá 404
    const wrongProjectRes = await get(`/api/projects/${p2.id}/board/cards/${card.id}/events`)
    assert.equal(wrongProjectRes.status, 404)

    // Exclusão por outro projeto dá 404
    const wrongDeleteRes = await post(`/api/projects/${p2.id}/board/cards/${card.id}/delete`, {
      actor: 'Dono',
      expectedVersion: 0,
    })
    assert.equal(wrongDeleteRes.status, 404)

    // Exclusão bem-sucedida pelo HTTP
    const delRes = await post(`/api/projects/${p1.id}/board/cards/${card.id}/delete`, {
      actor: 'Dono',
      expectedVersion: 0,
    })
    assert.equal(delRes.status, 200)
    const delJson = await delRes.json()
    assert.equal(delJson.cardId, card.id)

    // Cartão sumiu do snapshot
    const boardRes = await get(`/api/projects/${p1.id}/board`)
    const board = await boardRes.json()
    assert.ok(!board.cards.some((c: any) => c.id === card.id))

    // Histórico de eventos do cartão excluído continua listável
    const eventsRes = await get(`/api/projects/${p1.id}/board/cards/${card.id}/events`)
    assert.equal(eventsRes.status, 200)
    const events = await eventsRes.json()
    assert.equal(events[0]!.kind, 'deleted')
    assert.equal(events[0]!.summary, 'Excluiu o cartão')
  })

  // 9. MCP: as 4 tools existem, e nenhuma tool com delete no nome mexe em cartão; criar e mover pelo MCP funcionam.
  test('9. MCP expõe 4 tools de quadro, exclui delete de cartão e opera create/move', async (t) => {
    const store = new WorkspaceStore(':memory:')
    const server = createMcpServer(store)
    const client = new Client({ name: 'board-mcp-test', version: '1.0.0' })
    t.after(async () => {
      await client.close()
      await server.close()
      store.close()
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const tools = (await client.listTools()).tools
    const names = tools.map((t) => t.name)

    assert.ok(names.includes('get_board'))
    assert.ok(names.includes('create_board_card'))
    assert.ok(names.includes('update_board_card'))
    assert.ok(names.includes('move_board_card'))

    // Nenhuma tool com 'delete' mexe em cartão
    const deleteTools = names.filter((n) => n.includes('delete'))
    assert.ok(!deleteTools.some((n) => n.includes('card') || n.includes('board')))

    const proj = store.createProject({ name: 'MCP Board', objective: 'Obj' })

    const createdResult = await client.callTool({
      name: 'create_board_card',
      arguments: {
        projectId: proj.id,
        actor: 'Grok',
        title: 'Cartão criado via MCP',
        description: 'Detalhes completos aqui',
        column: 'ideas',
      },
    })
    assert.equal(createdResult.isError, undefined)
    const createdCard = JSON.parse((createdResult.content as Array<{ text: string }>)[0]!.text)
    assert.equal(createdCard.title, 'Cartão criado via MCP')
    assert.equal(createdCard.column, 'ideas')

    const moveResult = await client.callTool({
      name: 'move_board_card',
      arguments: {
        projectId: proj.id,
        cardId: createdCard.id,
        actor: 'Grok',
        expectedVersion: 0,
        column: 'in_progress',
      },
    })
    assert.equal(moveResult.isError, undefined)
    const movedCard = JSON.parse((moveResult.content as Array<{ text: string }>)[0]!.text)
    assert.equal(movedCard.column, 'in_progress')
    assert.equal(movedCard.version, 1)

    const boardResult = await client.callTool({
      name: 'get_board',
      arguments: { projectId: proj.id },
    })
    const board = JSON.parse((boardResult.content as Array<{ text: string }>)[0]!.text)
    assert.equal(board.cards.length, 1)
    assert.equal(board.cards[0]!.id, createdCard.id)
  })

  // 10. deleteProject apaga cartões e eventos sem violar chave estrangeira.
  it('10. deleteProject remove cartões e eventos em cascata manual sem erro de chave estrangeira', () => {
    const store = makeStore()
    const project = seed(store)

    const c1 = store.createBoardCard(project.id, { actor: 'Astra', title: 'Cartão 1' })
    store.moveBoardCard(project.id, c1.id, { actor: 'Astra', expectedVersion: 0, column: 'done' })

    const deleted = store.deleteProject(project.id, project.name)
    assert.equal(deleted.projectId, project.id)

    expectDomain(() => store.getProject(project.id), 404, 'not_found')
  })

  // 11. Evento é imutável: UPDATE direto na tabela é recusado.
  it('11. tabela board_card_events recusa UPDATE por trigger de imutabilidade', () => {
    const store = makeStore()
    const project = seed(store)

    const card = store.createBoardCard(project.id, { actor: 'Astra', title: 'Card' })
    const events = store.listBoardCardEvents(project.id, card.id)
    assert.equal(events.length, 1)

    assert.throws(
      () => {
        (store as any).db.prepare('UPDATE board_card_events SET summary = ? WHERE id = ?').run('Alterado', events[0]!.id)
      },
      (err: any) => {
        assert.match(err.message, /board card events are immutable/)
        return true
      },
    )
  })
})

describe('quadro: qualidade da API e do MCP', () => {
  it('12. cada erro diz em português o que é aceito, para quem errou se corrigir sozinho', () => {
    const store = makeStore()
    const project = seed(store)
    const criar = (extra: Record<string, unknown>) => () => store.createBoardCard(project.id, { actor: 'Astra', title: 'Título válido', ...extra } as never)

    expectDomain(criar({ title: 'ab' }), 400, 'invalid_input', 'O título precisa ter pelo menos 3 caracteres.')
    expectDomain(criar({ labels: ['inexistente'] }), 400, 'invalid_input',
      'Etiqueta desconhecida: "inexistente". Use uma destas: bug, improvement, feature, design, content, test, infra.')
    expectDomain(criar({ labels: ['bug', 'bug'] }), 400, 'invalid_input', 'A etiqueta "bug" apareceu mais de uma vez.')
    expectDomain(criar({ labels: ['bug', 'feature', 'design', 'test', 'infra'] }), 400, 'invalid_input', 'Use no máximo 4 etiquetas por cartão.')
    expectDomain(criar({ column: 'invalida' }), 400, 'invalid_input',
      'Coluna desconhecida: "invalida". Use uma destas: ideas, pending, in_progress, unfinished, testing, awaiting_deploy, done, blocked, discarded.')
    expectDomain(criar({ priority: 'mega' }), 400, 'invalid_input',
      'Prioridade desconhecida: "mega". Use uma destas: urgent, high, medium, low. Para tirar a prioridade, use null.')
    expectDomain(criar({ description: 'x'.repeat(BOARD_LIMITS.descriptionMax + 1) }), 400, 'invalid_input', 'A descrição passou de 4000 caracteres.')
    expectDomain(criar({ checklist: Array.from({ length: BOARD_LIMITS.checklistMax + 1 }, (_, i) => ({ text: `Passo ${i}` })) }), 400, 'invalid_input',
      'A lista de verificação aceita no máximo 40 itens.')

    const a = store.createBoardCard(project.id, { actor: 'Astra', title: 'Cartão A', column: 'pending' })
    const b = store.createBoardCard(project.id, { actor: 'Astra', title: 'Cartão B', column: 'done' })
    expectDomain(() => store.moveBoardCard(project.id, a.id, { actor: 'Astra', expectedVersion: 0, column: 'pending', beforeCardId: b.id }), 400, 'invalid_input',
      'beforeCardId precisa ser um cartão que já está na coluna de destino.')
  })

  it('13. mover para o lugar onde o cartão já está não grava histórico nem soma versão', () => {
    const store = makeStore()
    const project = seed(store)
    const a = store.createBoardCard(project.id, { actor: 'Astra', title: 'Primeiro', column: 'pending' })
    const b = store.createBoardCard(project.id, { actor: 'Astra', title: 'Segundo', column: 'pending' })

    const noFim = store.moveBoardCard(project.id, b.id, { actor: 'Gemini', expectedVersion: 0, column: 'pending' })
    assert.equal(noFim.version, 0)
    const antesDoProximo = store.moveBoardCard(project.id, a.id, { actor: 'Gemini', expectedVersion: 0, column: 'pending', beforeCardId: b.id })
    assert.equal(antesDoProximo.version, 0)
    assert.equal(store.listBoardCardEvents(project.id, a.id).length, 1)
    assert.equal(store.listBoardCardEvents(project.id, b.id).length, 1)
    assert.deepEqual(store.getBoard(project.id).cards.map(c => c.title), ['Primeiro', 'Segundo'])

    // Mesmo sem mudança, versão velha continua sendo conflito: a IA precisa estar olhando o estado atual.
    expectDomain(() => store.moveBoardCard(project.id, a.id, { actor: 'Gemini', expectedVersion: 7, column: 'pending', beforeCardId: b.id }), 409, 'version_conflict')
  })

  test('14. o MCP anuncia os limites reais do servidor e oferece o histórico do cartão só para leitura', async (t) => {
    const store = new WorkspaceStore(':memory:')
    const server = createMcpServer(store)
    const client = new Client({ name: 'board-mcp-qualidade', version: '1.0.0' })
    t.after(async () => {
      await client.close()
      await server.close()
      store.close()
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const tools = (await client.listTools()).tools
    type Esquema = { properties: Record<string, { minLength?: number; maxLength?: number; maxItems?: number; items?: { properties?: Record<string, { maxLength?: number }> } }> }
    for (const nome of ['create_board_card', 'update_board_card']) {
      const esquema = tools.find(tool => tool.name === nome)!.inputSchema as unknown as Esquema
      assert.equal(esquema.properties.title!.maxLength, BOARD_LIMITS.titleMax, `${nome}: title`)
      assert.equal(esquema.properties.title!.minLength, BOARD_LIMITS.titleMin, `${nome}: title min`)
      assert.equal(esquema.properties.description!.maxLength, BOARD_LIMITS.descriptionMax, `${nome}: description`)
      assert.equal(esquema.properties.labels!.maxItems, BOARD_LIMITS.labelsMax, `${nome}: labels`)
      assert.equal(esquema.properties.checklist!.maxItems, BOARD_LIMITS.checklistMax, `${nome}: checklist`)
      assert.equal(esquema.properties.checklist!.items!.properties!.text!.maxLength, BOARD_LIMITS.checklistItemMax, `${nome}: item`)
    }

    const historico = tools.find(tool => tool.name === 'get_board_card_events')
    assert.ok(historico, 'get_board_card_events precisa existir')
    assert.equal(historico.annotations?.readOnlyHint, true)

    const proj = store.createProject({ name: 'MCP Histórico', objective: 'Obj' })
    const card = store.createBoardCard(proj.id, { actor: 'Astra', title: 'Tela de login', column: 'pending' })
    store.moveBoardCard(proj.id, card.id, { actor: 'Gemini', expectedVersion: 0, column: 'in_progress' })
    const resposta = await client.callTool({ name: 'get_board_card_events', arguments: { projectId: proj.id, cardId: card.id } })
    assert.equal(resposta.isError, undefined)
    const eventos = JSON.parse((resposta.content as Array<{ text: string }>)[0]!.text) as Array<{ actor: string; summary: string }>
    assert.deepEqual(eventos.map(e => [e.actor, e.summary]), [['Gemini', 'Moveu de Pendente para Em andamento'], ['Astra', 'Criou o cartão em Pendente']])
  })
})

describe('quadro: marca "depende de você" (Task 2)', () => {
  it('15. cartão nasce sem a marca e aceita needsOwner na criação e na edição', () => {
    const store = makeStore()
    const project = seed(store)

    const comum = store.createBoardCard(project.id, { actor: 'Astra', title: 'Cartão comum' })
    assert.equal(comum.needsOwner, false)

    const marcado = store.createBoardCard(project.id, { actor: 'Astra', title: 'Esperando o dono', needsOwner: true })
    assert.equal(marcado.needsOwner, true)
    assert.equal(marcado.version, 0)
    assert.equal(store.getBoard(project.id).cards.find((c) => c.id === marcado.id)!.needsOwner, true)

    const aberto = store.createBoardCard(project.id, { actor: 'Astra', title: 'Explicitamente livre', needsOwner: false })
    assert.equal(aberto.needsOwner, false)

    const ligado = store.updateBoardCard(project.id, comum.id, { actor: 'Grok', expectedVersion: 0, needsOwner: true })
    assert.equal(ligado.needsOwner, true)
    assert.equal(ligado.version, 1)
    assert.equal(ligado.updatedBy, 'Grok')
    const eventosLigado = store.listBoardCardEvents(project.id, comum.id)
    assert.equal(eventosLigado[0]!.kind, 'updated')
    assert.equal(eventosLigado[0]!.actor, 'Grok')
    assert.equal(eventosLigado[0]!.summary, 'Marcou como dependente do dono')

    const desligado = store.updateBoardCard(project.id, comum.id, { actor: 'Dono', expectedVersion: 1, needsOwner: false })
    assert.equal(desligado.needsOwner, false)
    assert.equal(desligado.version, 2)
    assert.equal(store.listBoardCardEvents(project.id, comum.id)[0]!.summary, 'Tirou a marca de dependente do dono')
  })

  it('16. repetir o valor da marca não grava histórico nem soma versão; junto de outra mudança vira uma frase só', () => {
    const store = makeStore()
    const project = seed(store)
    const card = store.createBoardCard(project.id, { actor: 'Astra', title: 'Aprovar a identidade visual', needsOwner: true })

    const igual = store.updateBoardCard(project.id, card.id, { actor: 'Grok', expectedVersion: 0, needsOwner: true })
    assert.equal(igual.version, 0)
    assert.equal(igual.updatedBy, 'Astra')
    assert.equal(store.listBoardCardEvents(project.id, card.id).length, 1)

    const duas = store.updateBoardCard(project.id, card.id, { actor: 'Dono', expectedVersion: 0, title: 'Aprovar a nova identidade', needsOwner: false })
    assert.equal(duas.needsOwner, false)
    assert.equal(store.listBoardCardEvents(project.id, card.id)[0]!.summary, 'Mudou o título; Tirou a marca de dependente do dono')
  })

  it('17. editar outro campo, ou mover o cartão, não perde a marca', () => {
    const store = makeStore()
    const project = seed(store)
    const card = store.createBoardCard(project.id, { actor: 'Astra', title: 'Escolher o domínio', needsOwner: true })

    const editado = store.updateBoardCard(project.id, card.id, { actor: 'Grok', expectedVersion: 0, description: 'Três opções na pasta.' })
    assert.equal(editado.needsOwner, true)
    assert.equal(store.listBoardCardEvents(project.id, card.id)[0]!.summary, 'Mudou a descrição')

    const movido = store.moveBoardCard(project.id, card.id, { actor: 'Grok', expectedVersion: 1, column: 'blocked' })
    assert.equal(movido.needsOwner, true)
    assert.equal(store.getBoard(project.id).cards[0]!.needsOwner, true)
  })

  it('18. recusa needsOwner que não é verdadeiro ou falso, na criação e na edição, sem gravar nada', () => {
    const store = makeStore()
    const project = seed(store)
    const card = store.createBoardCard(project.id, { actor: 'Astra', title: 'Cartão firme' })

    for (const valor of ['sim', 1, 0, null, {}, []]) {
      expectDomain(
        () => store.createBoardCard(project.id, { actor: 'Astra', title: 'Não deve nascer', needsOwner: valor as never }),
        400,
        'invalid_input',
        'Campo needsOwner inválido. Use true ou false.',
      )
      expectDomain(
        () => store.updateBoardCard(project.id, card.id, { actor: 'Astra', expectedVersion: 0, needsOwner: valor as never }),
        400,
        'invalid_input',
        'Campo needsOwner inválido. Use true ou false.',
      )
    }
    const quadro = store.getBoard(project.id)
    assert.equal(quadro.cards.length, 1)
    assert.equal(quadro.cards[0]!.needsOwner, false)
    assert.equal(quadro.cards[0]!.version, 0)
    assert.equal(store.listBoardCardEvents(project.id, card.id).length, 1)
  })

  it('19. banco antigo ganha a coluna sem perder cartões, e rodar de novo não estraga nada', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY);
        INSERT INTO projects (id) VALUES ('p1');
        CREATE TABLE board_cards (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id),
          column_id TEXT NOT NULL,
          position REAL NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          labels_json TEXT NOT NULL,
          priority TEXT,
          checklist_json TEXT NOT NULL,
          created_by TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          version INTEGER NOT NULL
        );
        INSERT INTO board_cards VALUES
          ('c1', 'p1', 'pending', 1024, 'Cartão antigo', 'Escrito antes da marca', '["bug"]', 'high', '[]',
           'Astra', 'Astra', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 3);
      `)
      const antes = db.prepare('PRAGMA table_info(board_cards)').all() as Array<{ name: string }>
      assert.equal(antes.some((c) => c.name === 'needs_owner'), false)

      ensureBoardSchema(db)
      ensureBoardSchema(db)

      const colunas = db.prepare('PRAGMA table_info(board_cards)').all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>
      const coluna = colunas.filter((c) => c.name === 'needs_owner')
      assert.equal(coluna.length, 1)
      assert.equal(coluna[0]!.type, 'INTEGER')
      assert.equal(coluna[0]!.notnull, 1)
      assert.equal(coluna[0]!.dflt_value, '0')

      const { cards } = getBoard(db, 'p1')
      assert.equal(cards.length, 1)
      assert.equal(cards[0]!.needsOwner, false)
      assert.equal(cards[0]!.title, 'Cartão antigo')
      assert.equal(cards[0]!.description, 'Escrito antes da marca')
      assert.deepEqual(cards[0]!.labels, ['bug'])
      assert.equal(cards[0]!.priority, 'high')
      assert.equal(cards[0]!.version, 3)
    } finally {
      db.close()
    }
  })

  test('20. MCP create_board_card e update_board_card aceitam needsOwner e o anunciam no esquema', async (t) => {
    const store = new WorkspaceStore(':memory:')
    const server = createMcpServer(store)
    const client = new Client({ name: 'board-mcp-marca', version: '1.0.0' })
    t.after(async () => {
      await client.close()
      await server.close()
      store.close()
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const tools = (await client.listTools()).tools
    for (const nome of ['create_board_card', 'update_board_card']) {
      const esquema = tools.find((tool) => tool.name === nome)!.inputSchema as unknown as { properties: Record<string, { type?: string; description?: string }> }
      assert.equal(esquema.properties.needsOwner!.type, 'boolean', `${nome}: needsOwner`)
      assert.match(esquema.properties.needsOwner!.description ?? '', /depende do dono/i, `${nome}: descrição`)
    }

    const proj = store.createProject({ name: 'MCP Marca', objective: 'Obj' })
    const criado = await client.callTool({
      name: 'create_board_card',
      arguments: { projectId: proj.id, actor: 'Grok', title: 'Decidir o nome do produto', needsOwner: true },
    })
    assert.equal(criado.isError, undefined)
    const card = JSON.parse((criado.content as Array<{ text: string }>)[0]!.text)
    assert.equal(card.needsOwner, true)

    const atualizado = await client.callTool({
      name: 'update_board_card',
      arguments: { projectId: proj.id, cardId: card.id, actor: 'Grok', expectedVersion: 0, needsOwner: false },
    })
    assert.equal(atualizado.isError, undefined)
    const depois = JSON.parse((atualizado.content as Array<{ text: string }>)[0]!.text)
    assert.equal(depois.needsOwner, false)
    assert.equal(depois.version, 1)

    const semCampo = await client.callTool({
      name: 'update_board_card',
      arguments: { projectId: proj.id, cardId: card.id, actor: 'Grok', expectedVersion: 1, title: 'Decidir o nome final' },
    })
    assert.equal(JSON.parse((semCampo.content as Array<{ text: string }>)[0]!.text).needsOwner, false)
  })

  test('21. a tela (HTTP) cria e edita a marca', async (t) => {
    const { post, get } = await httpFixture(t)
    const projeto = await (await post('/api/projects', { name: 'HTTP Marca', objective: 'Obj' })).json()

    const criado = await post(`/api/projects/${projeto.id}/board/cards`, { actor: 'Dono', title: 'Pagar o domínio', needsOwner: true })
    assert.equal(criado.status, 201)
    const card = await criado.json()
    assert.equal(card.needsOwner, true)

    const editado = await post(`/api/projects/${projeto.id}/board/cards/${card.id}/update`, { actor: 'Dono', expectedVersion: 0, needsOwner: false })
    assert.equal(editado.status, 200)
    assert.equal((await editado.json()).needsOwner, false)

    const recusado = await post(`/api/projects/${projeto.id}/board/cards/${card.id}/update`, { actor: 'Dono', expectedVersion: 1, needsOwner: 'talvez' })
    assert.equal(recusado.status, 400)
    assert.equal((await recusado.json()).error.code, 'invalid_input')

    const quadro = await (await get(`/api/projects/${projeto.id}/board`)).json()
    assert.equal(quadro.cards[0].needsOwner, false)
  })
})
