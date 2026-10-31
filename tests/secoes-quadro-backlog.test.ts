import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  anexarQuadroEBacklog,
  backlogEmAberto,
  cartoesEmAberto,
  LIMITE_DA_SECAO,
  LIMITE_DESCRICAO_CARTAO,
  markdownDoBacklog,
  markdownDoQuadro,
  resumirCartao,
  resumirItemDoBacklog,
  secaoDoBacklog,
  secaoDoQuadro,
  secoesDoQuadroEBacklog,
  type ResumoDeCartao,
  type ResumoDeItemDoBacklog,
} from '../server/carta/secoes-quadro-backlog.js'
import { WorkspaceStore } from '../server/store.js'
import type { BoardCard } from '../shared/board.js'
import type { BacklogItem } from '../shared/types.js'

const T0 = new Date('2026-10-25T12:00:00.000Z')
const cleanups: Array<() => void> = []

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose()
})

function makeStore(): WorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'axon-quadro-backlog-'))
  const store = new WorkspaceStore(join(dir, 'workspace.sqlite'), { now: () => T0 })
  cleanups.push(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

function projetoComQuadro(): { store: WorkspaceStore; projectId: string } {
  const store = makeStore()
  const project = store.createProject({ name: 'Projeto Beta', objective: 'Testar a retomada com quadro' })
  return { store, projectId: project.id }
}

function cartao(id: string, column: BoardCard['column'], position: number, extra: Partial<BoardCard> = {}): BoardCard {
  return {
    id,
    projectId: 'p1',
    needsOwner: false,
    column,
    position,
    title: `Cartão ${id}`,
    description: '',
    labels: [],
    priority: null,
    checklist: [],
    createdBy: 'Astra',
    updatedBy: 'Astra',
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    version: 0,
    ...extra,
  }
}

function itemDoBacklog(id: string, stage: BacklogItem['stage'], priority: BacklogItem['priority'], extra: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id,
    projectId: 'p1',
    title: `Item ${id}`,
    description: '',
    priority,
    stage,
    createdBy: 'Astra',
    promotedTaskId: null,
    version: 0,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...extra,
  }
}

const mesmoTexto = (t: string): string => t

describe('cartoesEmAberto', () => {
  it('tira Completo e Descartado e segue a ordem das colunas, depois a posição', () => {
    const entrada = [
      cartao('feito', 'done', 1),
      cartao('teste', 'testing', 1),
      cartao('b2', 'blocked', 2),
      cartao('p2', 'pending', 2),
      cartao('p1', 'pending', 1),
      cartao('ideia', 'ideas', 5),
      cartao('desc', 'discarded', 1),
      cartao('andamento', 'in_progress', 9),
      cartao('inacabado', 'unfinished', 9),
      cartao('deploy', 'awaiting_deploy', 9),
      cartao('b1', 'blocked', 1),
    ]
    assert.deepEqual(
      cartoesEmAberto(entrada).map((c) => c.id),
      ['ideia', 'p1', 'p2', 'andamento', 'inacabado', 'teste', 'deploy', 'b1', 'b2'],
    )
  })

  it('não altera a lista recebida e mantém a ordem de quem empata', () => {
    const entrada = [cartao('y', 'pending', 1), cartao('x', 'pending', 1), cartao('z', 'done', 1)]
    const copia = entrada.map((c) => c.id)
    assert.deepEqual(cartoesEmAberto(entrada).map((c) => c.id), ['y', 'x'])
    assert.deepEqual(entrada.map((c) => c.id), copia)
  })

  it('lista vazia devolve lista vazia', () => {
    assert.deepEqual(cartoesEmAberto([]), [])
  })
})

describe('backlogEmAberto', () => {
  it('só ideia e pronto, prioridade primeiro; no empate, pronto antes de ideia; depois a ordem recebida', () => {
    const entrada = [
      itemDoBacklog('promovido', 'promoted', 'urgent'),
      itemDoBacklog('ideia-baixa', 'idea', 'low'),
      itemDoBacklog('ideia-alta', 'idea', 'high'),
      itemDoBacklog('pronto-media', 'ready', 'medium'),
      itemDoBacklog('arquivado', 'archived', 'urgent'),
      itemDoBacklog('pronto-alta', 'ready', 'high'),
      itemDoBacklog('ideia-urgente', 'idea', 'urgent'),
      itemDoBacklog('ideia-media-a', 'idea', 'medium'),
      itemDoBacklog('ideia-media-b', 'idea', 'medium'),
    ]
    assert.deepEqual(
      backlogEmAberto(entrada).map((i) => i.id),
      ['ideia-urgente', 'pronto-alta', 'ideia-alta', 'pronto-media', 'ideia-media-a', 'ideia-media-b', 'ideia-baixa'],
    )
  })

  it('não altera a lista recebida', () => {
    const entrada = [itemDoBacklog('b', 'idea', 'low'), itemDoBacklog('a', 'ready', 'urgent'), itemDoBacklog('c', 'archived', 'low')]
    backlogEmAberto(entrada)
    assert.deepEqual(entrada.map((i) => i.id), ['b', 'a', 'c'])
  })
})

describe('secaoDoQuadro', () => {
  it('cada cartão em aberto vira um item com o id do cartão e o texto "<coluna>: <título>"', () => {
    const secao = secaoDoQuadro([
      cartao('fim', 'done', 1, { title: 'Já publicado' }),
      cartao('c1', 'in_progress', 1, { title: 'Montar a carta', version: 3, priority: 'high', description: 'Função pura da carta.' }),
    ])
    assert.equal(secao.kind, 'board')
    assert.equal(secao.title, 'Quadro: cartões em aberto')
    assert.deepEqual(secao.items, [
      {
        id: 'c1',
        sourceType: 'board_card',
        title: 'Em andamento: Montar a carta',
        body: 'Prioridade: Alta. Função pura da carta.',
        revisionNo: 3,
        provenance: 'agent_report',
        authority: 'reference',
        reason: 'Cartão do quadro que ainda não foi encerrado.',
        meta: { column: 'in_progress', priority: 'high', needsOwner: false },
      },
    ])
  })

  it('o meta do item diz se o cartão depende do dono', () => {
    const [dono, livre] = secaoDoQuadro([
      cartao('d', 'pending', 1, { needsOwner: true, priority: 'low' }),
      cartao('l', 'pending', 2),
    ]).items
    assert.deepEqual(dono!.meta, { column: 'pending', priority: 'low', needsOwner: true })
    assert.deepEqual(livre!.meta, { column: 'pending', priority: null, needsOwner: false })
  })

  it('o nome da coluna vem do contrato do quadro, uma por coluna (na ordem de importância)', () => {
    const colunas = ['ideas', 'pending', 'in_progress', 'unfinished', 'testing', 'awaiting_deploy', 'blocked'] as const
    const titulos = secaoDoQuadro(colunas.map((c, i) => cartao(`c${i}`, c, 1, { title: 'x' }))).items.map((i) => i.title)
    assert.deepEqual(titulos, [
      'Bloqueado: x',
      'Em andamento: x',
      'Inacabado: x',
      'Em teste: x',
      'Testado, falta deploy: x',
      'Pendente: x',
      'Ideias: x',
    ])
  })

  it('os itens saem do mais importante ao menos: depende do dono, bloqueado, andamento, pendente, ideias', () => {
    const ids = secaoDoQuadro([
      cartao('ideia', 'ideas', 1),
      cartao('pendente', 'pending', 1),
      cartao('deploy', 'awaiting_deploy', 1),
      cartao('teste', 'testing', 1),
      cartao('inacabado', 'unfinished', 1),
      cartao('andamento2', 'in_progress', 2),
      cartao('andamento1', 'in_progress', 1),
      cartao('bloqueado', 'blocked', 1),
      cartao('dono-pendente', 'pending', 2, { needsOwner: true }),
      cartao('dono-ideia', 'ideas', 2, { needsOwner: true }),
      cartao('feito', 'done', 1, { needsOwner: true }),
    ]).items.map((i) => i.id)
    assert.deepEqual(ids, [
      'dono-ideia',
      'dono-pendente',
      'bloqueado',
      'andamento1',
      'andamento2',
      'inacabado',
      'teste',
      'deploy',
      'pendente',
      'ideia',
    ])
  })

  it('sob o orçamento do ContextEnvelope o bloqueado que depende do dono sobrevive a 40 ideias', () => {
    const { store, projectId } = projetoComQuadro()
    for (let i = 0; i < 40; i += 1) {
      store.createBoardCard(projectId, { actor: 'Astra', title: `Ideia solta número ${String(i).padStart(2, '0')}`, column: 'ideas' })
    }
    const bloqueado = store.createBoardCard(projectId, {
      actor: 'Astra',
      title: 'Destravar a cobrança do GitHub',
      column: 'blocked',
      needsOwner: true,
    })
    const envelope = store.compileContext(projectId, { agent: 'Astra', maxChars: 2500 })
    const board = envelope.sections.find((s) => s.kind === 'board')
    assert.ok(board, 'a seção do quadro deveria ter entrado')
    assert.ok(board.items.length < 41, 'o orçamento precisa ter cortado alguma coisa')
    assert.equal(board.items[0]?.id, bloqueado.id)
    assert.deepEqual(board.items[0]?.meta, { column: 'blocked', priority: null, needsOwner: true })
    assert.ok(envelope.markdown.includes('Bloqueado: Destravar a cobrança do GitHub'))
  })

  it('o corpo mostra prioridade e descrição, só uma delas, ou avisa que não há descrição', () => {
    const corpos = secaoDoQuadro([
      cartao('a', 'pending', 1, { priority: 'urgent' }),
      cartao('b', 'pending', 2, { description: '  Só texto.  ' }),
      cartao('c', 'pending', 3),
      cartao('d', 'pending', 4, { priority: 'medium', description: 'Com os dois.' }),
      cartao('e', 'pending', 5, { priority: 'low' }),
    ]).items.map((i) => i.body)
    assert.deepEqual(corpos, [
      'Prioridade: Urgente.',
      'Só texto.',
      'Sem descrição.',
      'Prioridade: Média. Com os dois.',
      'Prioridade: Baixa.',
    ])
  })

  it('descrição longa é resumida com reticências; a do tamanho exato do limite fica inteira', () => {
    assert.equal(LIMITE_DESCRICAO_CARTAO, 300)
    const exata = 'a'.repeat(300)
    const longa = 'b'.repeat(301)
    const [semCorte, comCorte] = secaoDoQuadro([
      cartao('a', 'pending', 1, { description: exata }),
      cartao('b', 'pending', 2, { description: longa }),
    ]).items
    assert.equal(semCorte!.body, exata)
    assert.equal(comCorte!.body, `${'b'.repeat(299)}…`)
  })

  it('sem cartões em aberto a seção vem sem itens', () => {
    assert.deepEqual(secaoDoQuadro([cartao('a', 'done', 1), cartao('b', 'discarded', 1)]).items, [])
  })
})

describe('secaoDoBacklog', () => {
  it('só ideia e pronto, com o id do item e a prioridade no corpo', () => {
    const secao = secaoDoBacklog([
      itemDoBacklog('arq', 'archived', 'urgent'),
      itemDoBacklog('i1', 'idea', 'low', { title: 'Tema claro', version: 2, description: 'Texto longo que não entra.' }),
      itemDoBacklog('r1', 'ready', 'high', { title: 'Exportar relatório' }),
    ])
    assert.equal(secao.kind, 'backlog')
    assert.equal(secao.title, 'Backlog: ideias e itens prontos')
    assert.deepEqual(secao.items, [
      {
        id: 'r1',
        sourceType: 'backlog_item',
        title: 'Pronto: Exportar relatório',
        body: 'Prioridade: Alta.',
        revisionNo: 0,
        provenance: 'agent_report',
        authority: 'reference',
        reason: 'Item do backlog que ainda não virou tarefa.',
        meta: { stage: 'ready', priority: 'high' },
      },
      {
        id: 'i1',
        sourceType: 'backlog_item',
        title: 'Ideia: Tema claro',
        body: 'Prioridade: Baixa.',
        revisionNo: 2,
        provenance: 'agent_report',
        authority: 'reference',
        reason: 'Item do backlog que ainda não virou tarefa.',
        meta: { stage: 'idea', priority: 'low' },
      },
    ])
  })

  it('o nome de cada prioridade em português', () => {
    const corpos = secaoDoBacklog([
      itemDoBacklog('a', 'idea', 'urgent'),
      itemDoBacklog('b', 'idea', 'high'),
      itemDoBacklog('c', 'idea', 'medium'),
      itemDoBacklog('d', 'idea', 'low'),
    ]).items.map((i) => i.body)
    assert.deepEqual(corpos, ['Prioridade: Urgente.', 'Prioridade: Alta.', 'Prioridade: Média.', 'Prioridade: Baixa.'])
  })

  it('sem itens em aberto a seção vem sem itens', () => {
    assert.deepEqual(secaoDoBacklog([itemDoBacklog('a', 'promoted', 'low'), itemDoBacklog('b', 'archived', 'low')]).items, [])
  })
})

describe('secoesDoQuadroEBacklog', () => {
  it('devolve só as seções que têm itens, quadro antes do backlog', () => {
    const cards = [cartao('c', 'pending', 1)]
    const itens = [itemDoBacklog('i', 'idea', 'low')]
    assert.deepEqual(secoesDoQuadroEBacklog(cards, itens).map((s) => s.kind), ['board', 'backlog'])
    assert.deepEqual(secoesDoQuadroEBacklog(cards, []).map((s) => s.kind), ['board'])
    assert.deepEqual(secoesDoQuadroEBacklog([], itens).map((s) => s.kind), ['backlog'])
    assert.deepEqual(secoesDoQuadroEBacklog([cartao('f', 'done', 1)], [itemDoBacklog('a', 'archived', 'low')]), [])
  })
})

describe('markdownDoQuadro', () => {
  it('lista o quadro por coluna, com a prioridade quando existe', () => {
    const texto = markdownDoQuadro(
      [
        cartao('p', 'pending', 1, { title: 'Escrever o guia' }),
        cartao('a', 'in_progress', 1, { title: 'Montar a carta', priority: 'high' }),
        cartao('a2', 'in_progress', 2, { title: 'Ligar o gancho' }),
        cartao('fim', 'done', 1, { title: 'Já publicado' }),
      ],
      1200,
      mesmoTexto,
    )
    assert.equal(
      texto,
      ['## Quadro', '', '**Pendente**', '- Escrever o guia', '', '**Em andamento**', '- Montar a carta (Alta)', '- Ligar o gancho'].join('\n'),
    )
  })

  it('sem cartões em aberto não escreve nada', () => {
    assert.equal(markdownDoQuadro([], 1200, mesmoTexto), '')
    assert.equal(markdownDoQuadro([cartao('f', 'done', 1), cartao('d', 'discarded', 1)], 1200, mesmoTexto), '')
  })

  it('passa cada linha pelo apagador de segredos recebido', () => {
    const texto = markdownDoQuadro(
      [cartao('a', 'pending', 1, { title: 'Trocar o token ghp_abc123' })],
      1200,
      (t) => t.replace('ghp_abc123', '[segredo removido]'),
    )
    assert.equal(texto, '## Quadro\n\n**Pendente**\n- Trocar o token [segredo removido]')
  })

  it('mede o limite depois de apagar o segredo', () => {
    const mascarar = (t: string): string => t.replace('SEGREDO-MUITO-LONGO-AQUI', 'x')
    const cards = [cartao('a', 'pending', 1, { title: 'SEGREDO-MUITO-LONGO-AQUI' })]
    const esperado = '## Quadro\n\n**Pendente**\n- x'
    assert.equal(markdownDoQuadro(cards, esperado.length, mascarar), esperado)
  })

  describe('limite de tamanho: linha inteira ou nada', () => {
    const aviso = (n: number): string => `_Omitidos pelo limite de tamanho: ${n}._`
    // Seis cartões na mesma coluna, com linhas do mesmo tamanho.
    const numeros = [1, 2, 3, 4, 5, 6]
    const titulo = (i: number): string => `Cartão ${i} ${'.'.repeat(30)}`
    const cards = numeros.map((i) => cartao(`c${i}`, 'pending', i, { title: titulo(i) }))
    const textoCom = (incluidos: number, omitidos = 0): string => {
      const corpo = ['## Quadro', '', '**Pendente**', ...numeros.slice(0, incluidos).map((i) => `- ${titulo(i)}`)].join('\n')
      return omitidos > 0 ? `${corpo}\n\n${aviso(omitidos)}` : corpo
    }

    it('cabendo no limite exato, vem inteiro e sem aviso', () => {
      assert.equal(markdownDoQuadro(cards, textoCom(6).length, mesmoTexto), textoCom(6))
      assert.equal(markdownDoQuadro(cards, textoCom(6).length + 500, mesmoTexto), textoCom(6))
    })

    it('um caractere a menos: a última linha sai e o aviso diz quantas ficaram de fora', () => {
      assert.equal(markdownDoQuadro(cards, textoCom(6).length - 1, mesmoTexto), textoCom(5, 1))
    })

    it('o resultado com aviso cabe exatamente no limite; um caractere a menos tira mais uma linha', () => {
      const esperado = textoCom(5, 1)
      assert.equal(markdownDoQuadro(cards, esperado.length, mesmoTexto), esperado)
      assert.equal(markdownDoQuadro(cards, esperado.length - 1, mesmoTexto), textoCom(4, 2))
    })

    it('uma linha grande que não cabe é pulada e as menores depois dela entram', () => {
      const lista = [
        cartao('a', 'pending', 1, { title: 'Curto' }),
        cartao('b', 'pending', 2, { title: 'X'.repeat(80) }),
        cartao('c', 'pending', 3, { title: 'Fim' }),
      ]
      const esperado = `## Quadro\n\n**Pendente**\n- Curto\n- Fim\n\n${aviso(1)}`
      assert.equal(markdownDoQuadro(lista, esperado.length, mesmoTexto), esperado)
    })

    it('sem espaço para nada, sobra o título e o aviso', () => {
      assert.equal(markdownDoQuadro(cards, 10, mesmoTexto), `## Quadro\n\n${aviso(6)}`)
    })

    it('quando o primeiro cartão de um grupo não cabe, o grupo abre no próximo que couber', () => {
      const lista = [
        cartao('a', 'pending', 1, { title: 'Curto' }),
        cartao('b', 'in_progress', 1, { title: 'Y'.repeat(60) }),
        cartao('c', 'in_progress', 2, { title: 'Z' }),
      ]
      const esperado = `## Quadro\n\n**Pendente**\n- Curto\n\n**Em andamento**\n- Z\n\n${aviso(1)}`
      assert.equal(markdownDoQuadro(lista, esperado.length, mesmoTexto), esperado)
    })
  })
})

describe('markdownDoQuadro: o que entra por importância, a exibição por coluna', () => {
  const aviso = (n: number): string => `_Omitidos pelo limite de tamanho: ${n}._`

  it('cartão que depende do dono ganha o sufixo "(depende de você)", depois da prioridade', () => {
    const texto = markdownDoQuadro(
      [
        cartao('a', 'pending', 1, { title: 'Só o dono', needsOwner: true }),
        cartao('b', 'pending', 2, { title: 'Dono e prioridade', needsOwner: true, priority: 'urgent' }),
        cartao('c', 'pending', 3, { title: 'Livre', priority: 'low' }),
      ],
      1200,
      mesmoTexto,
    )
    assert.equal(
      texto,
      ['## Quadro', '', '**Pendente**', '- Só o dono (depende de você)', '- Dono e prioridade (Urgente) (depende de você)', '- Livre (Baixa)'].join('\n'),
    )
  })

  it('40 ideias e 1 bloqueado que depende do dono: com 1200 caracteres o bloqueado entra, mas aparece depois das ideias', () => {
    const ideias = Array.from({ length: 40 }, (_, i) =>
      cartao(`i${i}`, 'ideas', i + 1, { title: `Ideia solta e bem comprida número ${String(i).padStart(2, '0')}` }),
    )
    const bloqueado = cartao('b', 'blocked', 1, { title: 'Destravar a cobrança do GitHub', needsOwner: true })

    const texto = markdownDoQuadro([...ideias, bloqueado], 1200, mesmoTexto)

    const linhasDeIdeia = texto.split('\n').filter((linha) => linha.startsWith('- Ideia solta'))
    assert.ok(linhasDeIdeia.length > 0 && linhasDeIdeia.length < 40, `ideias no texto: ${linhasDeIdeia.length}`)
    assert.deepEqual(
      linhasDeIdeia,
      ideias.slice(0, linhasDeIdeia.length).map((c) => `- ${c.title}`),
      'as ideias que entram são as primeiras, sem buraco',
    )
    assert.equal(
      texto,
      [
        '## Quadro',
        '',
        '**Ideias**',
        ...linhasDeIdeia,
        '',
        '**Bloqueado**',
        '- Destravar a cobrança do GitHub (depende de você)',
        '',
        aviso(40 - linhasDeIdeia.length),
      ].join('\n'),
    )
    assert.ok(texto.length <= 1200)
    // Está no limite: mais uma linha de ideia (quebra de linha + "- Ideia solta e bem comprida número NN") não caberia.
    assert.ok(1200 - texto.length < '\n- Ideia solta e bem comprida número 00'.length, `sobraram ${1200 - texto.length} caracteres`)
  })

  describe('a ordem do corte', () => {
    // Títulos do mesmo tamanho e compridos (cada linha custa mais que o aviso de omitidos): o limite deixa
    // entrar exatamente as k mais importantes e nenhuma outra, nem uma menor que venha depois.
    const titulo = (rotulo: string): string => `Cartão ${rotulo.padEnd(50, '.')}`
    const porImportancia = [
      cartao('dono-ideias', 'ideas', 2, { title: titulo('dono-ide'), needsOwner: true }),
      cartao('dono-pendente', 'pending', 2, { title: titulo('dono-pen'), needsOwner: true }),
      cartao('bloqueado', 'blocked', 1, { title: titulo('bloq') }),
      cartao('andamento', 'in_progress', 1, { title: titulo('andam') }),
      cartao('inacabado', 'unfinished', 1, { title: titulo('inac') }),
      cartao('teste', 'testing', 1, { title: titulo('teste') }),
      cartao('deploy', 'awaiting_deploy', 1, { title: titulo('deploy') }),
      cartao('pendente', 'pending', 1, { title: titulo('pend') }),
      cartao('ideias', 'ideas', 1, { title: titulo('ideia') }),
    ]
    // Embaralhada de propósito: a ordem de chegada não conta.
    const chegada = [4, 8, 1, 6, 0, 3, 7, 2, 5].map((i) => porImportancia[i]!)

    for (let k = 1; k <= 8; k += 1) {
      it(`com espaço para ${k} linha(s) entram as ${k} mais importantes`, () => {
        const entram = porImportancia.slice(0, k)
        const esperado = `${markdownDoQuadro(entram, 100_000, mesmoTexto)}\n\n${aviso(9 - k)}`
        assert.equal(markdownDoQuadro(chegada, esperado.length, mesmoTexto), esperado)
      })
    }
  })

  it('o cabeçalho da coluna entra na conta: o cartão importante só entra se couber com o título do grupo', () => {
    const cards = [
      cartao('a', 'pending', 1, { title: 'P'.repeat(40) }),
      cartao('b', 'blocked', 1, { title: 'Bloqueado do dono', needsOwner: true }),
    ]
    const soBloqueado = `## Quadro\n\n**Bloqueado**\n- Bloqueado do dono (depende de você)\n\n${aviso(1)}`
    // Cabe o bloqueado com o cabeçalho e o aviso, não cabe mais nada.
    assert.equal(markdownDoQuadro(cards, soBloqueado.length, mesmoTexto), soBloqueado)
    // Um caractere a menos: nem o bloqueado cabe; sobra só o aviso.
    assert.equal(markdownDoQuadro(cards, soBloqueado.length - 1, mesmoTexto), `## Quadro\n\n${aviso(2)}`)
  })
})

describe('markdownDoBacklog', () => {
  it('lista os itens em aberto, prioridade primeiro, só o título', () => {
    const texto = markdownDoBacklog(
      [
        itemDoBacklog('a', 'idea', 'low', { title: 'Tema claro', description: 'Não aparece.' }),
        itemDoBacklog('b', 'ready', 'high', { title: 'Exportar relatório' }),
        itemDoBacklog('c', 'archived', 'urgent', { title: 'Velho' }),
      ],
      1200,
      mesmoTexto,
    )
    assert.equal(texto, '## Backlog\n\n- Pronto: Exportar relatório (Alta)\n- Ideia: Tema claro (Baixa)')
  })

  it('sem itens em aberto não escreve nada', () => {
    assert.equal(markdownDoBacklog([], 1200, mesmoTexto), '')
    assert.equal(markdownDoBacklog([itemDoBacklog('a', 'promoted', 'low')], 1200, mesmoTexto), '')
  })

  it('passa cada linha pelo apagador de segredos recebido', () => {
    const texto = markdownDoBacklog(
      [itemDoBacklog('a', 'idea', 'medium', { title: 'Guardar sk-ant-123' })],
      1200,
      (t) => t.replace('sk-ant-123', '[segredo removido]'),
    )
    assert.equal(texto, '## Backlog\n\n- Ideia: Guardar [segredo removido] (Média)')
  })

  it('respeita o limite: linha inteira ou nada, com o aviso da contagem', () => {
    const aviso = (n: number): string => `_Omitidos pelo limite de tamanho: ${n}._`
    const numeros = [1, 2, 3, 4, 5, 6]
    const titulo = (i: number): string => `Item ${i} ${'.'.repeat(30)}`
    const itens = numeros.map((i) => itemDoBacklog(`i${i}`, 'ready', 'high', { title: titulo(i) }))
    const textoCom = (incluidos: number, omitidos = 0): string => {
      const corpo = ['## Backlog', '', ...numeros.slice(0, incluidos).map((i) => `- Pronto: ${titulo(i)} (Alta)`)].join('\n')
      return omitidos > 0 ? `${corpo}\n\n${aviso(omitidos)}` : corpo
    }
    assert.equal(markdownDoBacklog(itens, textoCom(6).length, mesmoTexto), textoCom(6))
    assert.equal(markdownDoBacklog(itens, textoCom(6).length - 1, mesmoTexto), textoCom(5, 1))
    assert.equal(markdownDoBacklog(itens, textoCom(5, 1).length, mesmoTexto), textoCom(5, 1))
    assert.equal(markdownDoBacklog(itens, textoCom(5, 1).length - 1, mesmoTexto), textoCom(4, 2))
  })
})

describe('resumos enxutos para o ResumeBrief', () => {
  it('resumirCartao guarda só id, coluna, título, prioridade, "depende do dono" e versão', () => {
    const resumo: ResumoDeCartao = resumirCartao(
      cartao('c1', 'blocked', 4, {
        title: 'Destravar a cobrança',
        description: 'Texto longo que não vai para o brief.',
        priority: 'high',
        needsOwner: true,
        version: 7,
        labels: ['bug'],
        checklist: [{ id: 'k1', text: 'Passo', done: false }],
      }),
    )
    assert.deepEqual(resumo, {
      id: 'c1',
      column: 'blocked',
      title: 'Destravar a cobrança',
      priority: 'high',
      needsOwner: true,
      version: 7,
    })
  })

  it('resumirCartao mantém prioridade vazia e cartão livre', () => {
    assert.deepEqual(resumirCartao(cartao('c2', 'ideas', 1, { title: 'Ideia' })), {
      id: 'c2',
      column: 'ideas',
      title: 'Ideia',
      priority: null,
      needsOwner: false,
      version: 0,
    })
  })

  it('resumirItemDoBacklog guarda só id, etapa, título, prioridade e versão', () => {
    const resumo: ResumoDeItemDoBacklog = resumirItemDoBacklog(
      itemDoBacklog('i1', 'ready', 'urgent', { title: 'Exportar relatório', description: 'Detalhe longo.', version: 3, createdBy: 'Grok' }),
    )
    assert.deepEqual(resumo, { id: 'i1', stage: 'ready', title: 'Exportar relatório', priority: 'urgent', version: 3 })
  })
})

describe('anexarQuadroEBacklog: quadro e backlog só com a sobra', () => {
  const base = 'TEXTO QUE JÁ EXISTIA NA RETOMADA'
  const cards = [cartao('a', 'pending', 1, { title: 'Escrever o guia' })]
  const itens = [itemDoBacklog('i', 'ready', 'high', { title: 'Exportar relatório' })]
  const quadro = '## Quadro\n\n**Pendente**\n- Escrever o guia'
  const backlog = '## Backlog\n\n- Pronto: Exportar relatório (Alta)'
  const completo = `${base}\n\n${quadro}\n\n${backlog}`
  const aviso = (n: number): string => `_Omitidos pelo limite de tamanho: ${n}._`

  it('o teto de cada seção é 1200 caracteres', () => {
    assert.equal(LIMITE_DA_SECAO, 1200)
  })

  it('com sobra: o texto de antes fica intacto e vêm depois, nesta ordem, o quadro e o backlog', () => {
    assert.equal(anexarQuadroEBacklog(base, cards, itens, 8000, mesmoTexto), completo)
  })

  it('só o quadro, só o backlog ou nenhum dos dois: sem separador sobrando', () => {
    assert.equal(anexarQuadroEBacklog(base, cards, [], 8000, mesmoTexto), `${base}\n\n${quadro}`)
    assert.equal(anexarQuadroEBacklog(base, [], itens, 8000, mesmoTexto), `${base}\n\n${backlog}`)
    assert.equal(anexarQuadroEBacklog(base, [], [], 8000, mesmoTexto), base)
    assert.equal(
      anexarQuadroEBacklog(base, [cartao('f', 'done', 1)], [itemDoBacklog('a', 'archived', 'low')], 8000, mesmoTexto),
      base,
    )
  })

  it('cabendo no limite exato vem inteiro; um caractere a menos, o backlog sai (nem o aviso dele cabe)', () => {
    assert.equal(anexarQuadroEBacklog(base, cards, itens, completo.length, mesmoTexto), completo)
    assert.equal(anexarQuadroEBacklog(base, cards, itens, completo.length - 1, mesmoTexto), `${base}\n\n${quadro}`)
  })

  it('o quadro cabe no limite exato; um caractere a menos e ele sai', () => {
    const soQuadro = `${base}\n\n${quadro}`
    assert.equal(anexarQuadroEBacklog(base, cards, [], soQuadro.length, mesmoTexto), soQuadro)
    assert.equal(anexarQuadroEBacklog(base, cards, [], soQuadro.length - 1, mesmoTexto), base)
  })

  it('sem sobra nenhuma devolve o texto de antes, sem tocar', () => {
    assert.equal(anexarQuadroEBacklog(base, cards, itens, base.length, mesmoTexto), base)
    assert.equal(anexarQuadroEBacklog(base, cards, itens, base.length + 2, mesmoTexto), base)
    assert.equal(anexarQuadroEBacklog(base, cards, itens, base.length - 5, mesmoTexto), base)
    assert.equal(anexarQuadroEBacklog(base, cards, itens, 0, mesmoTexto), base)
  })

  it('o quadro que nem com o aviso cabe é descartado e o backlog, menor, ainda entra', () => {
    const quadroGrande = [cartao('g', 'pending', 1, { title: 'P'.repeat(80) })]
    // Sobra para o backlog inteiro (47) e não para o quadro, nem só com título e aviso (48).
    const limite = base.length + 2 + backlog.length
    assert.equal(backlog.length, 47)
    assert.equal(`## Quadro\n\n${aviso(1)}`.length, 48)
    assert.equal(anexarQuadroEBacklog(base, quadroGrande, itens, limite, mesmoTexto), `${base}\n\n${backlog}`)
  })

  it('o backlog usa só o que sobrou depois do quadro (e do separador)', () => {
    const muitos = Array.from({ length: 30 }, (_, i) => itemDoBacklog(`i${i}`, 'idea', 'medium', { title: `Ideia numero ${String(i).padStart(2, '0')}` }))
    const sobraDoBacklog = 300
    const limite = base.length + 2 + quadro.length + 2 + sobraDoBacklog
    const esperado = `${base}\n\n${quadro}\n\n${markdownDoBacklog(muitos, sobraDoBacklog, mesmoTexto)}`
    assert.equal(anexarQuadroEBacklog(base, cards, muitos, limite, mesmoTexto), esperado)
    assert.ok(esperado.length <= limite)
    assert.ok(esperado.includes('_Omitidos pelo limite de tamanho:'), 'o backlog foi cortado para caber')
  })

  it('o quadro usa a sobra inteira quando ela é menor que o teto da seção', () => {
    const muitos = Array.from({ length: 30 }, (_, i) => cartao(`c${i}`, 'pending', i + 1, { title: `Cartão numero ${String(i).padStart(2, '0')}` }))
    const sobra = 500
    const resultado = anexarQuadroEBacklog(base, muitos, [], base.length + 2 + sobra, mesmoTexto)
    assert.equal(resultado, `${base}\n\n${markdownDoQuadro(muitos, sobra, mesmoTexto)}`)
    assert.ok(resultado.length <= base.length + 2 + sobra)
    assert.ok(resultado.includes('_Omitidos pelo limite de tamanho:'), 'o quadro foi cortado para caber')
  })

  it('com muita sobra cada seção para no teto de 1200 caracteres e diz quantos ficaram de fora', () => {
    const muitosCartoes = Array.from({ length: 100 }, (_, i) => cartao(`c${i}`, 'pending', i + 1, { title: `Cartão numero ${String(i).padStart(3, '0')}` }))
    const muitosItens = Array.from({ length: 100 }, (_, i) => itemDoBacklog(`i${i}`, 'idea', 'low', { title: `Ideia numero ${String(i).padStart(3, '0')}` }))
    const resultado = anexarQuadroEBacklog(base, muitosCartoes, muitosItens, 100_000, mesmoTexto)
    const esperadoQuadro = markdownDoQuadro(muitosCartoes, 1200, mesmoTexto)
    const esperadoBacklog = markdownDoBacklog(muitosItens, 1200, mesmoTexto)
    assert.equal(resultado, `${base}\n\n${esperadoQuadro}\n\n${esperadoBacklog}`)
    assert.ok(esperadoQuadro.length <= 1200 && esperadoQuadro.length > 1100)
    assert.ok(esperadoBacklog.length <= 1200 && esperadoBacklog.length > 1100)
    assert.ok(esperadoQuadro.includes('_Omitidos pelo limite de tamanho:') && esperadoBacklog.includes('_Omitidos pelo limite de tamanho:'))
  })

  it('para qualquer limite o texto de antes fica intacto no começo e o total nunca passa do limite', () => {
    const muitosCartoes = Array.from({ length: 30 }, (_, i) => cartao(`c${i}`, i % 2 === 0 ? 'pending' : 'blocked', i + 1, { title: `Cartão numero ${String(i).padStart(2, '0')}` }))
    const muitosItens = Array.from({ length: 30 }, (_, i) => itemDoBacklog(`i${i}`, 'idea', 'low', { title: `Ideia numero ${String(i).padStart(2, '0')}` }))
    for (let limite = base.length - 3; limite <= base.length + 2500; limite += 7) {
      const resultado = anexarQuadroEBacklog(base, muitosCartoes, muitosItens, limite, mesmoTexto)
      assert.ok(resultado.startsWith(base), `limite ${limite}`)
      assert.ok(resultado.length <= Math.max(limite, base.length), `limite ${limite}: ${resultado.length}`)
    }
  })

  it('apaga segredos de cada linha antes de medir', () => {
    const mascarar = (t: string): string => t.replace('SEGREDO-MUITO-LONGO-AQUI', 'x')
    const resultado = anexarQuadroEBacklog(
      base,
      [cartao('s', 'pending', 1, { title: 'SEGREDO-MUITO-LONGO-AQUI' })],
      [itemDoBacklog('t', 'idea', 'low', { title: 'SEGREDO-MUITO-LONGO-AQUI' })],
      8000,
      mascarar,
    )
    assert.equal(resultado, `${base}\n\n## Quadro\n\n**Pendente**\n- x\n\n## Backlog\n\n- Ideia: x (Baixa)`)
  })
})

describe('Retomada completa: quadro e backlog', () => {
  it('brief traz cartões não encerrados e backlog aberto', () => {
    const { store, projectId } = projetoComQuadro()
    store.createBoardCard(projectId, { actor: 'Astra', title: 'Cartão pendente', column: 'pending' })
    store.createBoardCard(projectId, { actor: 'Astra', title: 'Cartão em andamento', column: 'in_progress', priority: 'high' })
    store.createBoardCard(projectId, { actor: 'Astra', title: 'Cartão completo', column: 'done' })
    store.createBoardCard(projectId, { actor: 'Astra', title: 'Cartão descartado', column: 'discarded' })
    store.createBacklogItem(projectId, { title: 'Ideia baixa', createdBy: 'Astra', priority: 'low', stage: 'idea' })
    store.createBacklogItem(projectId, { title: 'Pronto urgente', createdBy: 'Astra', priority: 'urgent', stage: 'ready' })
    const arquivado = store.createBacklogItem(projectId, { title: 'Ideia arquivada', createdBy: 'Astra', stage: 'idea' })
    store.archiveBacklogItem(projectId, arquivado.id, { expectedVersion: arquivado.version })

    const brief = store.getResumeBrief(projectId, 'Astra')

    assert.deepEqual(brief.boardCards.map((c) => c.title), ['Cartão pendente', 'Cartão em andamento'])
    assert.deepEqual(brief.backlogItems.map((i) => i.title), ['Pronto urgente', 'Ideia baixa'])
  })

  it('o brief traz só o resumo enxuto: sem descrição, etiquetas nem checklist', () => {
    const { store, projectId } = projetoComQuadro()
    const card = store.createBoardCard(projectId, {
      actor: 'Astra',
      title: 'Destravar a cobrança',
      description: 'Descrição longa que não vai para o brief.',
      column: 'blocked',
      priority: 'urgent',
      needsOwner: true,
      labels: ['bug'],
      checklist: [{ text: 'Passo um' }],
    })
    const item = store.createBacklogItem(projectId, {
      title: 'Exportar relatório',
      description: 'Detalhe que não vai para o brief.',
      createdBy: 'Astra',
      priority: 'high',
      stage: 'ready',
    })

    const brief = store.getResumeBrief(projectId, 'Astra')

    assert.deepEqual(brief.boardCards, [
      { id: card.id, column: 'blocked', title: 'Destravar a cobrança', priority: 'urgent', needsOwner: true, version: card.version },
    ])
    assert.deepEqual(brief.backlogItems, [
      { id: item.id, stage: 'ready', title: 'Exportar relatório', priority: 'high', version: item.version },
    ])
  })

  it('brief de projeto sem quadro nem backlog traz listas vazias e nenhuma seção nova', () => {
    const { store, projectId } = projetoComQuadro()
    const brief = store.getResumeBrief(projectId, 'Astra')
    assert.deepEqual(brief.boardCards, [])
    assert.deepEqual(brief.backlogItems, [])
    assert.ok(!brief.markdown.includes('## Quadro'))
    assert.ok(!brief.markdown.includes('## Backlog'))
  })

  describe('o quadro e o backlog só usam a sobra: o resto da retomada não muda', () => {
    const corpoDaMensagem = (n: number, tamanho: number): string => `Mensagem ${n}: ${'x'.repeat(tamanho)}`

    function postarMensagens(store: WorkspaceStore, projectId: string, quantidade: number, tamanho: number): void {
      for (let n = 1; n <= quantidade; n += 1) {
        store.postMessage(projectId, { from: 'Grok', to: 'Astra', kind: 'note', body: corpoDaMensagem(n, tamanho) })
      }
    }

    function criarCartoesEItens(store: WorkspaceStore, projectId: string, cartoes: number, itens: number): void {
      for (let i = 0; i < cartoes; i += 1) {
        store.createBoardCard(projectId, {
          actor: 'Astra',
          title: `Cartão ${String(i).padStart(2, '0')} com um título comprido`,
          column: i === 0 ? 'blocked' : 'pending',
          needsOwner: i === 0,
        })
      }
      for (let i = 0; i < itens; i += 1) {
        store.createBacklogItem(projectId, {
          title: `Ideia ${String(i).padStart(2, '0')} com um título comprido`,
          createdBy: 'Astra',
          stage: 'idea',
        })
      }
    }

    it('brief com Inbox de ~7 mil caracteres: o texto de antes fica idêntico e o quadro e o backlog só entram na sobra', () => {
      const { store, projectId } = projetoComQuadro()
      postarMensagens(store, projectId, 10, 600)
      const antes = store.getResumeBrief(projectId, 'Astra').markdown
      assert.ok(antes.length > 6500 && antes.length < 7800, `antes com ${antes.length} caracteres`)
      assert.ok(!antes.includes('Brief truncado'), 'o brief de antes cabia inteiro')

      criarCartoesEItens(store, projectId, 14, 10)
      const depois = store.getResumeBrief(projectId, 'Astra').markdown

      // O texto de antes, inteiro e sem um caractere trocado.
      assert.ok(depois.startsWith(antes), 'as seções antigas mudaram')
      assert.ok(depois.length <= 8000, `depois com ${depois.length} caracteres`)
      for (let n = 1; n <= 10; n += 1) assert.ok(depois.includes(corpoDaMensagem(n, 600)), `mensagem ${n} cortada`)
      // O que veio depois é só o quadro (e, se sobrar, o backlog), com o dono em primeiro lugar.
      const acrescimo = depois.slice(antes.length)
      assert.ok(acrescimo.startsWith('\n\n## Quadro\n\n'), acrescimo)
      assert.ok(acrescimo.includes('**Bloqueado**\n- Cartão 00 com um título comprido (depende de você)'), acrescimo)
      assert.ok(acrescimo.includes('_Omitidos pelo limite de tamanho:'), acrescimo)
      assert.equal(depois.indexOf('## Quadro'), antes.length + 2)
    })

    it('brief já no teto de 8000: nada de quadro nem de backlog e o texto é idêntico ao de antes', () => {
      const { store, projectId } = projetoComQuadro()
      postarMensagens(store, projectId, 12, 800)
      const antes = store.getResumeBrief(projectId, 'Astra').markdown
      assert.ok(antes.includes('Brief truncado'), 'o brief de antes já estava cortado')
      assert.ok(antes.length <= 8000)

      criarCartoesEItens(store, projectId, 14, 10)
      const brief = store.getResumeBrief(projectId, 'Astra')

      assert.equal(brief.markdown, antes)
      assert.ok(!brief.markdown.includes('## Quadro'))
      assert.ok(!brief.markdown.includes('## Backlog'))
      // As listas estruturadas continuam completas: o corte é só do texto.
      assert.equal(brief.boardCards.length, 14)
      assert.equal(brief.backlogItems.length, 10)
    })

    it('com poucas mensagens sobra bastante: quadro e backlog entram depois de tudo, inclusive depois do Inbox', () => {
      const { store, projectId } = projetoComQuadro()
      postarMensagens(store, projectId, 2, 50)
      const antes = store.getResumeBrief(projectId, 'Astra').markdown

      criarCartoesEItens(store, projectId, 3, 3)
      const depois = store.getResumeBrief(projectId, 'Astra').markdown

      assert.ok(depois.startsWith(`${antes}\n\n## Quadro\n\n`))
      assert.ok(depois.indexOf('## Inbox') < depois.indexOf('## Quadro'))
      assert.ok(depois.indexOf('## Quadro') < depois.indexOf('## Backlog'))
      // Os três itens do backlog têm a mesma prioridade e o mesmo instante: a ordem entre eles não importa.
      for (const n of ['00', '01', '02']) assert.ok(depois.includes(`- Ideia: Ideia ${n} com um título comprido (Média)`), `ideia ${n}`)
      assert.ok(depois.endsWith('(Média)'))
    })
  })

  it('compileContext tem seções board e backlog com sourceId', () => {
    const { store, projectId } = projetoComQuadro()
    const card = store.createBoardCard(projectId, { actor: 'Astra', title: 'Montar a carta', column: 'in_progress' })
    store.createBoardCard(projectId, { actor: 'Astra', title: 'Já publicado', column: 'done' })
    const item = store.createBacklogItem(projectId, { title: 'Exportar relatório', createdBy: 'Astra', priority: 'high', stage: 'ready' })

    const envelope = store.compileContext(projectId, { agent: 'Astra' })

    const board = envelope.sections.find((s) => s.kind === 'board')
    const backlog = envelope.sections.find((s) => s.kind === 'backlog')
    assert.deepEqual(board?.items.map((i) => i.id), [card.id])
    assert.deepEqual(backlog?.items.map((i) => i.id), [item.id])
    assert.ok(envelope.includedSources.some((s) => s.sourceId === card.id && s.sourceType === 'board_card'))
    assert.ok(envelope.includedSources.some((s) => s.sourceId === item.id && s.sourceType === 'backlog_item'))
    assert.ok(envelope.markdown.includes('Em andamento: Montar a carta'))
    assert.ok(envelope.markdown.includes('Pronto: Exportar relatório'))
    assert.ok(!envelope.markdown.includes('Já publicado'))
  })

  it('compileContext de projeto sem quadro nem backlog não ganha seções novas', () => {
    const { store, projectId } = projetoComQuadro()
    const envelope = store.compileContext(projectId, { agent: 'Astra' })
    assert.ok(!envelope.sections.some((s) => s.kind === 'board' || s.kind === 'backlog'))
    assert.ok(!envelope.cutSections.includes('board'))
    assert.ok(!envelope.cutSections.includes('backlog'))
  })

  it('seções respeitam o orçamento: item inteiro ou nada', () => {
    const { store, projectId } = projetoComQuadro()
    const total = 60
    for (let i = 0; i < total; i += 1) {
      store.createBoardCard(projectId, {
        actor: 'Astra',
        title: `Cartão numero ${String(i).padStart(2, '0')}`,
        description: 'Descrição para ocupar espaço no orçamento. '.repeat(5),
        column: 'pending',
      })
    }
    const envelope = store.compileContext(projectId, { agent: 'Astra', maxChars: 4000 })

    const board = envelope.sections.find((s) => s.kind === 'board')
    assert.ok(board, 'a seção do quadro deveria ter entrado com pelo menos um cartão')
    assert.ok(board.items.length > 0 && board.items.length < total)
    assert.equal(board.omittedCount, total - board.items.length)
    assert.equal(envelope.omittedCounts['board'], total - board.items.length)
    assert.equal(envelope.truncated, true)
    assert.ok(envelope.markdown.length <= 4000)
    // Cada cartão que entrou está inteiro no texto; nenhum entrou pela metade.
    for (const item of board.items) {
      assert.ok(envelope.markdown.includes(`**${item.title}**: ${item.body}`), `item cortado: ${item.title}`)
    }
    // Os que ficaram de fora não deixaram rastro no texto.
    const incluidos = new Set(board.items.map((i) => i.title))
    for (let i = 0; i < total; i += 1) {
      const titulo = `Pendente: Cartão numero ${String(i).padStart(2, '0')}`
      if (!incluidos.has(titulo)) assert.ok(!envelope.markdown.includes(titulo), `rastro de item omitido: ${titulo}`)
    }
  })

  it('markdown da retomada lista o quadro por coluna', () => {
    const { store, projectId } = projetoComQuadro()
    store.createBoardCard(projectId, { actor: 'Astra', title: 'Escrever o guia', column: 'pending' })
    store.createBoardCard(projectId, { actor: 'Astra', title: 'Montar a carta', column: 'in_progress', priority: 'high' })
    store.createBoardCard(projectId, { actor: 'Astra', title: 'Já publicado', column: 'done' })
    store.createBacklogItem(projectId, { title: 'Exportar relatório', createdBy: 'Astra', priority: 'high', stage: 'ready' })

    const { markdown } = store.getResumeBrief(projectId, 'Astra')

    assert.ok(
      markdown.includes('## Quadro\n\n**Pendente**\n- Escrever o guia\n\n**Em andamento**\n- Montar a carta (Alta)'),
      markdown,
    )
    assert.ok(markdown.includes('## Backlog\n\n- Pronto: Exportar relatório (Alta)'), markdown)
    assert.ok(!markdown.includes('Já publicado'))
  })

  it('o que o mascarador do store já cobre não aparece no markdown do quadro e do backlog', () => {
    const { store, projectId } = projetoComQuadro()
    const segredo = 'abc123segredo456'
    store.createBoardCard(projectId, { actor: 'Astra', title: `Trocar API_KEY=${segredo}`, column: 'pending' })
    store.createBacklogItem(projectId, { title: `Guardar API_KEY=${segredo}`, createdBy: 'Astra', stage: 'idea' })

    const brief = store.getResumeBrief(projectId, 'Astra').markdown
    assert.ok(brief.includes('Trocar API_KEY=***'), brief)
    assert.ok(brief.includes('Ideia: Guardar API_KEY=***'), brief)
    assert.ok(!brief.includes(segredo))
    assert.ok(!store.compileContext(projectId, { agent: 'Astra' }).markdown.includes(segredo))
  })

  it('com muito quadro e muito backlog e brief curto: cada seção para no teto e o total fica dentro do limite do brief', () => {
    const { store, projectId } = projetoComQuadro()
    const antes = store.getResumeBrief(projectId, 'Astra').markdown
    for (let i = 0; i < 80; i += 1) {
      store.createBoardCard(projectId, { actor: 'Astra', title: `Cartão ${String(i).padStart(2, '0')} com um título comprido o bastante`, column: 'pending' })
      store.createBacklogItem(projectId, { title: `Ideia ${String(i).padStart(2, '0')} com um título comprido o bastante`, createdBy: 'Astra', stage: 'idea' })
    }
    const { markdown } = store.getResumeBrief(projectId, 'Astra')
    assert.ok(markdown.startsWith(`${antes}\n\n## Quadro\n\n`))
    const [quadro, backlog] = markdown.slice(antes.length + 2).split('\n\n## Backlog\n\n')
    assert.ok(quadro && backlog, 'as duas seções entraram')
    assert.ok(quadro.length <= LIMITE_DA_SECAO && quadro.length > LIMITE_DA_SECAO - 100, `quadro com ${quadro.length}`)
    assert.ok(backlog.length + '## Backlog\n\n'.length <= LIMITE_DA_SECAO, `backlog com ${backlog.length}`)
    assert.ok(markdown.length <= 8000, `markdown com ${markdown.length} caracteres`)
    assert.ok(quadro.includes('_Omitidos pelo limite de tamanho:'))
    assert.ok(backlog.includes('_Omitidos pelo limite de tamanho:'))
  })
})
