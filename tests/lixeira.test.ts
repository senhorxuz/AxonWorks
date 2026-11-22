import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { lerLeituraCurta } from '../server/carta/leitura-curta-ler.ts'
import { lerDadosDaCarta } from '../server/carta/ler.ts'
import { montarCarta } from '../server/carta/montar.ts'
import { lerExtrasDaRetomada } from '../server/ganchos/extras.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import { validarDonoDaLixeira } from '../server/store/lixeira.ts'

const AGENTE = 'Codex'
const PEDIDO = '  Exclui esse registro, por favor.  '
const PEDIDO_DE_PURGAR = 'Agora pode apagar de vez.'
const BASE = Date.parse('2026-11-20T10:00:00.000Z')
const stores: WorkspaceStore[] = []

test('restaurações são persistidas por projeto, sem aparecer na lixeira ativa', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'axon-historico-lixeira-'))
  const caminho = join(pasta, 'workspace.sqlite')
  let instante = BASE
  const relogio = { now: () => new Date(instante) }
  const store = new WorkspaceStore(caminho, relogio)
  try {
    const { id: pid } = store.createProject({ name: 'Projeto do item', objective: 'Conferir a volta' })
    const { id: outro } = store.createProject({ name: 'Outro projeto', objective: 'Isolar a volta' })
    const item = store.createBoardCard(pid, { actor: AGENTE, title: 'Cartão restaurado' })
    const alvo = { tipo: 'cartao', id: item.id, agent: AGENTE }
    const exclusao = store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
    instante += 1_000
    recusa(() => store.restaurar(outro, alvo), 404, 'fora_da_lixeira')
    assert.deepEqual(store.restaurar(pid, alvo), { ok: true })
    recusa(() => store.restaurar(pid, alvo), 404, 'fora_da_lixeira')
    const volta = {
      id: item.id, tipo: 'cartao', titulo: item.title, excluidoEm: exclusao.excluidoEm,
      restauradoEm: new Date(instante).toISOString(),
    }
    assert.deepEqual(store.listarLixeira(pid), [])
    const reaberto = new WorkspaceStore(caminho, relogio)
    try {
      assert.deepEqual(reaberto.historicoDaLixeira(pid, new Date(BASE).toISOString()), { lixeira: [], restauracoes: [volta] })
      assert.deepEqual(reaberto.historicoDaLixeira(pid, volta.restauradoEm).restauracoes, [])
      assert.deepEqual(reaberto.historicoDaLixeira(outro, new Date(BASE).toISOString()).restauracoes, [])
      instante += 1_000
      reaberto.excluir(pid, { ...alvo, origem: 'tela' })
      reaberto.apagarDeVez(pid, { ...alvo, confirmar: true, pedidoDoDono: PEDIDO_DE_PURGAR })
      assert.deepEqual(reaberto.historicoDaLixeira(pid, new Date(BASE).toISOString()).restauracoes, [])
      assert.deepEqual(reaberto['db'].prepare('SELECT item_id FROM lixeira_historico').all(), [])
    } finally {
      reaberto.close()
    }
  } finally {
    store.close()
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('restauração mantém a marca ativa quando gravar a volta falha', () => {
  const { store, pid } = projeto()
  const item = store.createBoardCard(pid, { actor: AGENTE, title: 'Cartão com falha' })
  const alvo = { tipo: 'cartao', id: item.id, agent: AGENTE }
  const excluido = store.excluir(pid, { ...alvo, origem: 'tela' })
  store['db'].exec(`CREATE TRIGGER falha_na_restauracao BEFORE INSERT ON lixeira_historico
    BEGIN SELECT RAISE(ABORT, 'Histórico indisponível'); END;`)
  assert.throws(() => store.restaurar(pid, alvo), /Histórico indisponível/)
  assert.deepEqual(store.listarLixeira(pid), [excluido])
  assert.deepEqual(store.historicoDaLixeira(pid, new Date(BASE).toISOString()), { lixeira: [excluido], restauracoes: [] })
})

function abrir(caminho = ':memory:') {
  let instante = BASE
  const store = new WorkspaceStore(caminho, { now: () => new Date(instante += 1_000) })
  stores.push(store)
  return store
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

function projeto() {
  const store = abrir()
  const pid = store.createProject({ name: 'Projeto de teste', objective: 'Conferir a lixeira' }).id
  const tarefa = store.createTask(pid, { title: 'Tarefa de teste' }).id
  const contexto = () => store.compileContext(pid, { agent: AGENTE, taskId: tarefa }).markdown
  const carta = () => montarCarta(lerDadosDaCarta(store, pid), new Date(BASE))
  const curta = () => lerLeituraCurta(store, pid, AGENTE, undefined, () => new Date(BASE)).markdown
  const retomada = () => store.getResumeBrief(pid, AGENTE)
  return { store, pid, tarefa, contexto, carta, curta, retomada }
}

type Leitores = Record<string, () => unknown>
type Cenario = ReturnType<typeof projeto>

const casos = {
  cartao: {
    tabela: 'board_cards',
    criar: ({ store, pid, carta, curta, retomada, contexto }: Cenario, titulo: string) => {
      const { id } = store.createBoardCard(pid, { actor: AGENTE, title: titulo, column: 'pending', needsOwner: true })
      return { id, leitores: {
        quadro: () => store.getBoard(pid),
        carta, curta, retomada, contexto,
      } }
    },
  },
  licao: {
    tabela: 'licoes',
    criar: ({ store, pid, curta, contexto }: Cenario, titulo: string) => {
      const { id } = store.registrarLicao(pid, { agent: AGENTE, texto: titulo, tipo: 'regra', fraseDoDono: titulo })
      return { id, leitores: {
        licoes: () => store.listarLicoes(pid, { tipo: 'regra', incluirAposentadas: true }),
        retomadaCompacta: () => lerExtrasDaRetomada(store, pid, false),
        curta, contexto,
      } }
    },
  },
  decisao: {
    tabela: 'decisions',
    criar: ({ store, pid, carta, retomada, contexto }: Cenario, titulo: string) => {
      const decisao = store.proposeDecision(pid, { agent: AGENTE, title: titulo, body: 'Descrição da decisão.' })
      store.acceptDecision(pid, decisao.id, { actor: 'Dono', expectedVersion: decisao.version })
      return { id: decisao.id, leitores: {
        decisoes: () => store.listDecisions(pid),
        historico: () => store.listDecisions(pid, { includeHistory: true }),
        carta: () => JSON.stringify(carta()) + JSON.stringify(lerDadosDaCarta(store, pid).decisions),
        retomada, contexto,
      } }
    },
  },
  mensagem: {
    tabela: 'messages',
    criar: ({ store, pid, retomada, contexto }: Cenario, titulo: string) => {
      const { id } = store.postMessage(pid, { from: 'Dono', to: AGENTE, kind: 'question', body: titulo })
      return { id, leitores: {
        caixa: () => store.getInbox(pid, AGENTE),
        naoLidas: () => store.getInbox(pid, AGENTE, { unreadOnly: true }),
        mensagens: () => store.getProject(pid).messages,
        handoff: () => store.getHandoff(pid),
        buscaDeProjetos: () => store.searchProjects(titulo),
        retomada, contexto,
      } }
    },
  },
  backlog: {
    tabela: 'backlog_items',
    criar: ({ store, pid, carta, retomada, contexto }: Cenario, titulo: string) => {
      const { id } = store.createBacklogItem(pid, { createdBy: AGENTE, title: titulo, stage: 'ready' })
      return { id, leitores: {
        backlog: () => store.listBacklog(pid),
        incluindoFechados: () => store.listBacklog(pid, { includeClosed: true }),
        carta, retomada, contexto,
      } }
    },
  },
  biblioteca: {
    tabela: 'content_items',
    criar: ({ store, pid, tarefa, contexto }: Cenario, titulo: string) => {
      const { item, revision } = store.createContent(pid, {
        title: titulo, kind: 'note', body: 'Texto da revisão.', createdBy: AGENTE, sourceKind: 'agent_report',
      })
      store.addContentRelation(pid, {
        sourceRevisionId: revision.id, targetType: 'task', targetId: tarefa, kind: 'required_input', createdBy: AGENTE,
      })
      return { id: item.id, leitores: {
        biblioteca: () => store.listContent(pid),
        incluindoArquivados: () => store.listContent(pid, { includeArchived: true }),
        buscaDaBiblioteca: () => store.searchContent(pid, titulo),
        contexto,
      } }
    },
  },
} as const

function conferirVisibilidade(leitores: Leitores, titulo: string, visivel: boolean) {
  for (const [nome, ler] of Object.entries(leitores)) {
    assert.equal(JSON.stringify(ler()).includes(titulo), visivel, nome)
  }
}

for (const tipo of Object.keys(casos) as Array<keyof typeof casos>) {
  test(`${tipo} some de todos os seus leitores, volta e só então pode ser apagado do banco`, () => {
    const cenario = projeto()
    const { store, pid } = cenario
    const titulo = `Zênite ${tipo}`
    const { tabela, criar } = casos[tipo]
    const { id, leitores } = criar(cenario, titulo)
    const todasAsLeituras = { ...leitores, memoria: () => store.searchMemory(pid, { query: titulo }) }
    conferirVisibilidade(todasAsLeituras, titulo, true)

    const alvo = { tipo, id, agent: AGENTE }
    const item = store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
    assert.deepEqual(item, { tipo, id, projectId: pid, titulo, excluidoEm: item.excluidoEm, excluidoPor: AGENTE, pedidoDoDono: PEDIDO })
    assert.ok(Date.parse(item.excluidoEm) >= BASE)
    assert.deepEqual(store.listarLixeira(pid), [item])
    const db = store['db']
    assert.ok(db.prepare(`SELECT id FROM ${tabela} WHERE id = ?`).get(id))
    conferirVisibilidade(todasAsLeituras, titulo, false)

    assert.deepEqual(store.restaurar(pid, alvo), { ok: true })
    assert.deepEqual(store.listarLixeira(pid), [])
    const { restauracoes } = store.historicoDaLixeira(pid, new Date(BASE).toISOString())
    const [volta] = restauracoes
    assert.ok(volta.restauradoEm > item.excluidoEm)
    assert.deepEqual(restauracoes, [{ tipo, id, titulo, excluidoEm: item.excluidoEm, restauradoEm: volta.restauradoEm }])
    conferirVisibilidade(todasAsLeituras, titulo, true)

    store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
    assert.deepEqual(store.apagarDeVez(pid, { ...alvo, confirmar: true, pedidoDoDono: PEDIDO_DE_PURGAR }), { ok: true })
    assert.equal(db.prepare(`SELECT id FROM ${tabela} WHERE id = ?`).get(id), undefined)
    assert.equal(db.prepare('SELECT item_id FROM lixeira WHERE item_id = ?').get(id), undefined)
    assert.equal(db.prepare('SELECT item_id FROM lixeira_historico WHERE item_id = ?').get(id), undefined)
    assert.equal(db.prepare('SELECT fonte_id FROM memoria_itens WHERE fonte_id = ?').get(id), undefined)
    if (tipo === 'cartao') assert.deepEqual(db.prepare('SELECT id FROM board_card_events WHERE card_id = ?').all(id), [])
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    conferirVisibilidade(todasAsLeituras, titulo, false)
    const auditoria = store.listAuditLogs({ projectId: pid, action: 'purge_record' })
    assert.equal(auditoria.length, 1)
    assert.deepEqual({ ...auditoria[0], id: undefined, timestamp: undefined }, {
      id: undefined, timestamp: undefined, actorType: 'agent', actorId: AGENTE,
      action: 'purge_record', resourceType: tipo, resourceId: id, projectId: pid,
      ipAddress: null, status: 'success', details: { pedidoDoDono: PEDIDO_DE_PURGAR },
    })
  })
}

function recusa(acao: () => unknown, status: number, code: string, mensagem?: string) {
  assert.throws(acao, (erro: unknown) => {
    assert.ok(erro instanceof DomainError)
    assert.equal(erro.status, status)
    assert.equal(erro.code, code)
    assert.ok(erro.message.trim(), 'A recusa precisa explicar o motivo.')
    if (mensagem !== undefined) assert.equal(erro.message, mensagem)
    return true
  })
}

test('a exclusão rejeita pedido inválido, escopo errado, lição global e duplicidade', () => {
  const { store, pid } = projeto()
  const outro = store.createProject({ name: 'Outro projeto', objective: 'Isolamento' }).id
  const { id } = store.createBoardCard(pid, { actor: AGENTE, title: 'Cartão legítimo' })
  const global = store.registrarLicao(null, { agent: AGENTE, texto: 'Lição global' })
  const alvo = { tipo: 'cartao', id, agent: AGENTE, origem: 'mcp' } as const
  for (const pedidoDoDono of [undefined, null, false, '', '   ', 'a'.repeat(501)]) {
    recusa(() => store.excluir(pid, { ...alvo, pedidoDoDono }), 400, 'pedido_do_dono_obrigatorio')
  }
  recusa(() => store.excluir(outro, { ...alvo, pedidoDoDono: PEDIDO }), 404, 'not_found')
  recusa(() => store.excluir(pid, { ...alvo, id: randomUUID(), pedidoDoDono: PEDIDO }), 404, 'not_found')
  recusa(() => store.excluir(pid, { ...alvo, tipo: 'licao', id: global.id, pedidoDoDono: PEDIDO }), 400, 'licao_global')
  assert.deepEqual(store.listarLixeira(pid), [])
  const item = store.excluir(pid, { ...alvo, pedidoDoDono: 'a'.repeat(500) })
  recusa(() => store.excluir(pid, { ...alvo, pedidoDoDono: PEDIDO }), 409, 'ja_na_lixeira')
  assert.deepEqual(store.listarLixeira(pid), [item])
  assert.deepEqual(store.listarLixeira(outro), [])
})

test('restauração e apagamento exigem lixeira do projeto, confirmação e pedido', () => {
  const { store, pid } = projeto()
  const outro = store.createProject({ name: 'Outro projeto', objective: 'Isolamento' }).id
  const { id } = store.createBoardCard(pid, { actor: AGENTE, title: 'Cartão legítimo' })
  const alvo = { tipo: 'cartao', id, agent: AGENTE }
  const apagar = { ...alvo, confirmar: true, pedidoDoDono: PEDIDO_DE_PURGAR }
  recusa(() => store.restaurar(pid, alvo), 404, 'fora_da_lixeira')
  recusa(() => store.apagarDeVez(pid, apagar), 409, 'precisa_estar_na_lixeira')
  store.excluir(pid, { ...alvo, origem: 'tela' })
  recusa(() => store.restaurar(outro, alvo), 404, 'fora_da_lixeira')
  recusa(() => store.apagarDeVez(outro, apagar), 409, 'precisa_estar_na_lixeira')
  for (const confirmar of [undefined, false, 'true', 1]) {
    recusa(() => store.apagarDeVez(pid, { ...apagar, confirmar }), 400, 'confirmacao_obrigatoria')
  }
  recusa(() => store.apagarDeVez(pid, { ...apagar, pedidoDoDono: undefined }), 400, 'pedido_do_dono_obrigatorio')
  assert.equal(store.listarLixeira(pid)[0]?.id, id)
  assert.deepEqual(store.listAuditLogs({ projectId: pid }), [])
})

test('a lista é por projeto, com o descarte mais novo primeiro, e o backup preserva item e marca', () => {
  const { store, pid } = projeto()
  const primeiro = store.createBoardCard(pid, { actor: AGENTE, title: 'Primeiro cartão' })
  const segundo = store.createBoardCard(pid, { actor: AGENTE, title: 'Segundo cartão' })
  const alvo1 = { tipo: 'cartao', id: primeiro.id, agent: 'Dono' }
  const alvo2 = { ...alvo1, id: segundo.id }
  const item1 = store.excluir(pid, { ...alvo1, origem: 'tela' })
  const item2 = store.excluir(pid, { ...alvo2, origem: 'tela' })
  assert.equal(item1.pedidoDoDono, null)
  assert.deepEqual(store.listarLixeira(pid), [item2, item1])
  const pasta = mkdtempSync(join(tmpdir(), 'axon-lixeira-'))
  try {
    const copia = join(pasta, 'backup.sqlite')
    store.vacuumInto(copia)
    const restaurada = new WorkspaceStore(copia)
    try {
      assert.deepEqual(restaurada.listarLixeira(pid), [item2, item1])
      assert.deepEqual(restaurada.getBoard(pid).cards, [])
      restaurada.restaurar(pid, alvo1)
      assert.deepEqual(restaurada.getBoard(pid).cards, [primeiro])
      restaurada.deleteProject(pid, 'Projeto de teste')
      assert.deepEqual(restaurada['db'].prepare('SELECT * FROM lixeira').all(), [])
    } finally {
      restaurada.close()
    }
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('decisão proposta some da carta e da leitura curta e volta com o mesmo estado', () => {
  const { store, pid, carta, curta } = projeto()
  const titulo = 'Decisão para o dono'
  const decisao = store.proposeDecision(pid, { agent: AGENTE, title: titulo, body: 'Descrição da decisão.' })
  const alvo = { tipo: 'decisao', id: decisao.id, agent: AGENTE }
  conferirVisibilidade({ carta, curta }, titulo, true)
  store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
  conferirVisibilidade({ carta, curta }, titulo, false)
  store.restaurar(pid, alvo)
  conferirVisibilidade({ carta, curta }, titulo, true)
  assert.deepEqual(store.listDecisions(pid, { includeHistory: true }), [decisao])
})

test('tipo e origem inválidos são recusados e o título da lição usa a linha curta', () => {
  const { store, pid } = projeto()
  const { id } = store.registrarLicao(pid, { agent: AGENTE, texto: 'Descrição da lição.', linhaCurta: 'Linha curta' })
  const alvo = { tipo: 'licao', id, agent: AGENTE, origem: 'mcp', pedidoDoDono: PEDIDO }
  recusa(() => store.excluir(pid, { ...alvo, tipo: 'checkpoint' }), 400, 'invalid_input')
  recusa(() => store.excluir(pid, { ...alvo, origem: 'manual' }), 400, 'invalid_input')
  assert.equal(store.excluir(pid, alvo).titulo, 'Linha curta')
  assert.equal(store.listarLixeira(pid)[0]?.titulo, 'Linha curta')
})

test('dados inválidos identificam a operação e o campo ao dono', () => {
  const { store, pid } = projeto()
  recusa(() => store.excluir(pid, null), 400, 'invalid_input', 'Dados de exclusão inválidos.')
  recusa(() => store.restaurar(pid, null), 400, 'invalid_input', 'Dados de restauração inválidos.')
  recusa(() => store.apagarDeVez(pid, null), 400, 'invalid_input', 'Dados de apagamento definitivo inválidos.')
  recusa(() => store.excluir(pid, { tipo: 'cartao', id: '', agent: AGENTE }), 400, 'invalid_input', 'Campo id inválido.')
  recusa(() => store.excluir(pid, { tipo: 'cartao', id: randomUUID(), agent: '' }), 400, 'invalid_input', 'Campo agent inválido.')
  recusa(() => validarDonoDaLixeira(undefined), 403, 'so_o_dono')
})

test('uma falha na auditoria desfaz o apagamento da marca, do registro e dos vínculos', () => {
  const { store, pid } = projeto()
  const { id } = store.createBoardCard(pid, { actor: AGENTE, title: 'Cartão com histórico' })
  const alvo = { tipo: 'cartao', id, agent: AGENTE }
  const item = store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
  const db = store['db']
  db.exec(`CREATE TRIGGER falha_de_auditoria BEFORE INSERT ON audit_logs
    BEGIN SELECT RAISE(ABORT, 'auditoria indisponível'); END`)
  assert.throws(() => store.apagarDeVez(pid, { ...alvo, confirmar: true, pedidoDoDono: PEDIDO_DE_PURGAR }), /auditoria indisponível/)
  assert.deepEqual(store.listarLixeira(pid), [item])
  assert.equal(store.listBoardCardEvents(pid, id).length, 1)
  store.restaurar(pid, alvo)
  assert.equal(store.getBoard(pid).cards[0]?.id, id)
})

test('as operações antigas de apagar cartão e backlog preservam o item enquanto ele estiver na lixeira', () => {
  const { store, pid } = projeto()
  const cartao = store.createBoardCard(pid, { actor: AGENTE, title: 'Cartão oculto' })
  const backlog = store.createBacklogItem(pid, { createdBy: AGENTE, title: 'Backlog oculto' })
  const arquivado = store.archiveBacklogItem(pid, backlog.id, { expectedVersion: backlog.version })
  store.excluir(pid, { tipo: 'cartao', id: cartao.id, agent: AGENTE, origem: 'mcp', pedidoDoDono: PEDIDO })
  store.excluir(pid, { tipo: 'backlog', id: backlog.id, agent: AGENTE, origem: 'mcp', pedidoDoDono: PEDIDO })
  recusa(() => store.deleteBoardCard(pid, cartao.id, { actor: AGENTE, expectedVersion: cartao.version }), 409, 'ja_na_lixeira')
  recusa(() => store.deleteBacklogItem(pid, backlog.id, arquivado.version), 409, 'ja_na_lixeira')
  assert.deepEqual(store.listarLixeira(pid).map(({ id }) => id), [backlog.id, cartao.id])
  store.restaurar(pid, { tipo: 'cartao', id: cartao.id, agent: AGENTE })
  store.restaurar(pid, { tipo: 'backlog', id: backlog.id, agent: AGENTE })
  assert.deepEqual(store.getBoard(pid).cards, [cartao])
  assert.deepEqual(store.listBacklog(pid, { includeClosed: true }), [arquivado])
  assert.equal(store.deleteBoardCard(pid, cartao.id, { actor: AGENTE, expectedVersion: cartao.version }).cardId, cartao.id)
  assert.equal(store.deleteBacklogItem(pid, backlog.id, arquivado.version).itemId, backlog.id)
})

test('recusa editar ou mover um cartão na lixeira e restaura a versão original', () => {
  const { store, pid } = projeto()
  const cartao = store.createBoardCard(pid, { actor: AGENTE, title: 'Cartão removido' })
  const outro = store.createBoardCard(pid, { actor: AGENTE, title: 'Cartão visível' })
  const alvo = { tipo: 'cartao', id: cartao.id, agent: AGENTE }
  const entrada = { actor: AGENTE, expectedVersion: cartao.version }
  store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
  recusa(() => store.updateBoardCard(pid, cartao.id, { ...entrada, title: 'Outro título' }), 409, 'ja_na_lixeira')
  recusa(() => store.moveBoardCard(pid, cartao.id, { ...entrada, column: 'pending' }), 409, 'ja_na_lixeira')
  recusa(() => store.moveBoardCard(pid, outro.id, {
    actor: AGENTE, expectedVersion: outro.version, column: 'pending', beforeCardId: cartao.id,
  }), 409, 'ja_na_lixeira')
  store.restaurar(pid, alvo)
  assert.deepEqual(store.getBoard(pid).cards, [cartao, outro])
})

test('recusa editar, promover ou arquivar um item de backlog na lixeira', () => {
  const { store, pid } = projeto()
  const item = store.createBacklogItem(pid, { createdBy: AGENTE, title: 'Ideia pronta', stage: 'ready' })
  const alvo = { tipo: 'backlog', id: item.id, agent: AGENTE }
  const entrada = { expectedVersion: item.version }
  store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
  recusa(() => store.updateBacklogItem(pid, item.id, { ...entrada, title: 'Outro título' }), 409, 'ja_na_lixeira')
  recusa(() => store.promoteBacklogItem(pid, item.id), 409, 'ja_na_lixeira')
  recusa(() => store.archiveBacklogItem(pid, item.id, entrada), 409, 'ja_na_lixeira')
  assert.equal(store.getProject(pid).tasks.length, 1)
  store.restaurar(pid, alvo)
  assert.deepEqual(store.listBacklog(pid), [item])
})

test('recusa ler, aceitar, revogar ou substituir uma decisão na lixeira', () => {
  const { store, pid } = projeto()
  const proposta = store.proposeDecision(pid, { agent: AGENTE, title: 'Proposta', body: 'Texto' })
  const outra = store.proposeDecision(pid, { agent: AGENTE, title: 'Decisão', body: 'Texto' })
  const vigente = store.acceptDecision(pid, outra.id, { actor: 'Dono', expectedVersion: outra.version })
  for (const id of [proposta.id, vigente.id]) {
    store.excluir(pid, { tipo: 'decisao', id, agent: AGENTE, origem: 'mcp', pedidoDoDono: PEDIDO })
  }
  recusa(() => store.getDecision(pid, proposta.id), 404, 'not_found')
  recusa(() => store.acceptDecision(pid, proposta.id, { actor: 'Dono', expectedVersion: proposta.version }), 409, 'ja_na_lixeira')
  const entrada = { actor: 'Dono', expectedVersion: vigente.version }
  recusa(() => store.revokeDecision(pid, vigente.id, entrada), 409, 'ja_na_lixeira')
  recusa(() => store.supersedeDecision(pid, vigente.id, { ...entrada, title: 'Nova decisão', body: 'Texto' }), 409, 'ja_na_lixeira')
  store.restaurar(pid, { tipo: 'decisao', id: vigente.id, agent: AGENTE })
  assert.deepEqual(store.getDecision(pid, vigente.id), vigente)
})

test('recusa ler, revisar, arquivar ou relacionar conteúdo na lixeira', () => {
  const { store, pid, tarefa } = projeto()
  const criar = (title: string) => store.createContent(pid, {
    title, kind: 'note', body: 'Texto original', createdBy: AGENTE, sourceKind: 'agent_report',
  })
  const { item, revision } = criar('Conteúdo excluído')
  const outro = criar('Conteúdo visível')
  const decisao = store.proposeDecision(pid, { agent: AGENTE, title: 'Proposta excluída', body: 'Texto' })
  const alvo = { tipo: 'biblioteca', id: item.id, agent: AGENTE }
  store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
  store.excluir(pid, { tipo: 'decisao', id: decisao.id, agent: AGENTE, origem: 'mcp', pedidoDoDono: PEDIDO })
  recusa(() => store.getContent(pid, item.id), 404, 'not_found')
  recusa(() => store.reviseContent(pid, item.id, {
    expectedVersion: item.version, createdBy: AGENTE, body: 'Texto novo', sourceKind: 'agent_report',
  }), 409, 'ja_na_lixeira')
  recusa(() => store.archiveContent(pid, item.id, { expectedVersion: item.version }), 409, 'ja_na_lixeira')
  const relacao = { kind: 'related', createdBy: AGENTE } as const
  recusa(() => store.addContentRelation(pid, {
    ...relacao, sourceRevisionId: revision.id, targetType: 'task', targetId: tarefa,
  }), 409, 'ja_na_lixeira')
  recusa(() => store.addContentRelation(pid, {
    ...relacao, sourceRevisionId: outro.revision.id, targetType: 'content', targetId: item.id,
  }), 409, 'ja_na_lixeira')
  recusa(() => store.addContentRelation(pid, {
    ...relacao, sourceRevisionId: outro.revision.id, targetType: 'decision', targetId: decisao.id,
  }), 409, 'ja_na_lixeira')
  store.restaurar(pid, alvo)
  assert.deepEqual(store.getContent(pid, item.id), { item, revision, revisions: [revision], relations: [] })
  assert.deepEqual(store.getContent(pid, outro.item.id).relations, [])
})

test('recusa marcar como lida ou resolver mensagem na lixeira, inclusive a resposta indicada', () => {
  const { store, pid } = projeto()
  const perguntar = (body: string) => store.postMessage(pid, { from: 'Dono', to: AGENTE, kind: 'question', body })
  const pergunta = perguntar('Pergunta removida.')
  const outra = perguntar('Pergunta visível.')
  const resposta = store.postMessage(pid, { from: AGENTE, to: 'Dono', kind: 'note', body: 'Resposta removida.' })
  for (const id of [pergunta.id, resposta.id]) {
    store.excluir(pid, { tipo: 'mensagem', id, agent: AGENTE, origem: 'mcp', pedidoDoDono: PEDIDO })
  }
  recusa(() => store.acknowledgeMessage(pid, pergunta.id, { agent: AGENTE }), 409, 'ja_na_lixeira')
  recusa(() => store.resolveMessageAttention(pid, pergunta.id, { agent: AGENTE, note: 'Resolvida.' }), 409, 'ja_na_lixeira')
  recusa(() => store.resolveMessageAttention(pid, outra.id, { agent: AGENTE, responseMessageId: resposta.id }), 409, 'ja_na_lixeira')
  store.restaurar(pid, { tipo: 'mensagem', id: pergunta.id, agent: AGENTE })
  assert.deepEqual(store.getInbox(pid, AGENTE).map(({ acknowledgedAt, resolution }) => [acknowledgedAt, resolution]),
    [[null, null], [null, null]])
})

test('apagar uma mensagem remove recibos e resoluções que apontam para ela', () => {
  const { store, pid } = projeto()
  const pergunta = store.postMessage(pid, { from: 'Dono', to: AGENTE, kind: 'question', body: 'A primeira pergunta.' })
  const resposta = store.postMessage(pid, { from: AGENTE, to: 'Dono', kind: 'note', body: 'A resposta.' })
  store.acknowledgeMessage(pid, resposta.id, { agent: 'Dono' })
  store.resolveMessageAttention(pid, pergunta.id, { agent: AGENTE, responseMessageId: resposta.id })
  const alvo = { tipo: 'mensagem', id: resposta.id, agent: AGENTE }
  store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
  store.apagarDeVez(pid, { ...alvo, confirmar: true, pedidoDoDono: PEDIDO_DE_PURGAR })
  assert.deepEqual(store.getProject(pid).messages, [pergunta])
  assert.equal(store.getInbox(pid, AGENTE)[0]?.resolution, null)
  assert.deepEqual(store['db'].prepare('SELECT * FROM message_receipts').all(), [])
})

test('apagar a mensagem de resposta preserva o texto da resolução de outra mensagem', () => {
  const { store, pid } = projeto()
  const pergunta = store.postMessage(pid, { from: 'Dono', to: AGENTE, kind: 'question', body: 'Pergunta com nota de resolução.' })
  const resposta = store.postMessage(pid, { from: AGENTE, to: 'Dono', kind: 'note', body: 'A resposta.' })
  const nota = { agent: AGENTE, note: 'Resolução documentada separadamente.' }
  const resolucao = store.resolveMessageAttention(pid, pergunta.id, { ...nota, responseMessageId: resposta.id })
  const alvo = { tipo: 'mensagem', id: resposta.id, agent: AGENTE }
  store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
  store.apagarDeVez(pid, { ...alvo, confirmar: true, pedidoDoDono: PEDIDO_DE_PURGAR })
  const esperada = { ...resolucao, responseMessageId: null }
  assert.deepEqual(store.getInbox(pid, AGENTE)[0]?.resolution, esperada)
  assert.deepEqual(store.resolveMessageAttention(pid, pergunta.id, nota), esperada)
})

test('apagar uma lição antiga limpa o vínculo sem descartar a lição que a substituiu', () => {
  const { store, pid } = projeto()
  const antiga = store.registrarLicao(pid, { texto: 'Observação original.', agent: AGENTE })
  const nova = store.registrarLicao(pid, { texto: 'Observação corrigida.', agent: AGENTE, substitui: antiga.id })
  const alvo = { tipo: 'licao', id: antiga.id, agent: AGENTE }
  store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
  store.apagarDeVez(pid, { ...alvo, confirmar: true, pedidoDoDono: PEDIDO_DE_PURGAR })
  assert.deepEqual(store.listarLicoes(pid, { incluirAposentadas: true }), [{ ...nova, substituiId: null }])
})

test('apagar conteúdo com várias revisões limpa o índice e mantém o outro conteúdo', () => {
  const { store, pid } = projeto()
  const criar = (title: string) => store.createContent(pid, {
    title, kind: 'note', body: 'Primeira versão.', createdBy: AGENTE, sourceKind: 'agent_report',
  })
  const apagado = criar('Conteúdo removível')
  const guardado = criar('Conteúdo preservado')
  store.reviseContent(pid, apagado.item.id, {
    expectedVersion: apagado.item.version, createdBy: AGENTE, body: 'Segunda versão.', sourceKind: 'agent_report',
  })
  store.addContentRelation(pid, {
    sourceRevisionId: guardado.revision.id, targetType: 'content', targetId: apagado.item.id, kind: 'related', createdBy: AGENTE,
  })
  const alvo = { tipo: 'biblioteca', id: apagado.item.id, agent: AGENTE }
  store.excluir(pid, { ...alvo, origem: 'mcp', pedidoDoDono: PEDIDO })
  store.apagarDeVez(pid, { ...alvo, confirmar: true, pedidoDoDono: PEDIDO_DE_PURGAR })
  const db = store['db']
  assert.deepEqual(db.prepare('SELECT id FROM content_revisions WHERE item_id = ?').all(apagado.item.id), [])
  assert.deepEqual(db.prepare('SELECT * FROM content_fts WHERE item_id = ?').all(apagado.item.id), [])
  assert.deepEqual(db.prepare('SELECT * FROM content_relations WHERE target_id = ?').all(apagado.item.id), [])
  assert.equal(store.searchContent(pid, 'preservado')[0]?.item.id, guardado.item.id)
})
