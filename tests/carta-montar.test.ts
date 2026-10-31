import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { montarCarta, type DadosDaCarta } from '../server/carta/montar.ts'
import type { ApprovalRequest } from '../shared/approvals.ts'
import type { BoardCard, BoardColumnId } from '../shared/board.ts'
import type { Decision, ProjectBlocker, WorkDraft } from '../shared/continuity.ts'
import type { BacklogItem, Checkpoint, Project, Task } from '../shared/types.ts'

const AGORA = new Date('2026-10-25T12:00:00.000Z')
const DIA = 86_400_000

/** ISO de um instante `dias` dias (e `horas` horas) antes de `AGORA`. */
function atras(dias: number, horas = 0): string {
  return new Date(AGORA.getTime() - dias * DIA - horas * 3_600_000).toISOString()
}

function projeto(over: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Alfa',
    objective: 'Vender cursos pela internet',
    workspacePath: '',
    createdAt: atras(90),
    updatedAt: atras(90),
    revision: 0,
    ...over,
  }
}

function tarefa(over: Partial<Task> = {}): Task {
  return {
    id: 'tarefa-1',
    projectId: 'proj-1',
    title: 'Tarefa',
    status: 'todo',
    assignee: null,
    leaseUntil: null,
    version: 1,
    createdAt: atras(60),
    blockedReason: null,
    completionCheckpointId: null,
    workIntent: null,
    ...over,
  }
}

function checkpoint(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'cp-1',
    projectId: 'proj-1',
    taskId: null,
    agent: 'Claude',
    summary: 'Resumo técnico para outras IAs',
    nextStep: 'Seguir',
    blockers: [],
    decisions: [],
    evidence: [],
    revision: 1,
    createdAt: atras(30),
    ...over,
  }
}

function cartao(over: Partial<BoardCard> = {}): BoardCard {
  return {
    id: 'cartao-1',
    projectId: 'proj-1',
    needsOwner: false,
    column: 'pending',
    position: 0,
    title: 'Cartão',
    description: '',
    labels: [],
    priority: null,
    checklist: [],
    createdBy: 'Claude',
    updatedBy: 'Claude',
    createdAt: atras(80),
    updatedAt: atras(80),
    version: 1,
    ...over,
  }
}

function itemDoBacklog(over: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: 'backlog-1',
    projectId: 'proj-1',
    title: 'Item do backlog',
    description: '',
    priority: 'medium',
    stage: 'ready',
    createdBy: 'Claude',
    promotedTaskId: null,
    version: 1,
    createdAt: atras(70),
    updatedAt: atras(70),
    ...over,
  }
}

function decisao(over: Partial<Decision> = {}): Decision {
  return {
    id: 'decisao-1',
    projectId: 'proj-1',
    title: 'Decisão',
    body: '',
    status: 'proposed',
    proposedBy: 'Claude',
    acceptedBy: null,
    revokedBy: null,
    supersedesId: null,
    supersededById: null,
    version: 0,
    createdAt: atras(50),
    updatedAt: atras(50),
    source: { kind: 'agent_proposal' },
    ...over,
  }
}

function aprovacao(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'aprovacao-1',
    projectId: 'proj-1',
    kind: 'note',
    title: 'Aprovação',
    body: '',
    rationale: '',
    proposedBy: 'Claude',
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: atras(40),
    version: 0,
    ...over,
  }
}

function bloqueio(over: Partial<ProjectBlocker> = {}): ProjectBlocker {
  return {
    id: 'bloqueio-1',
    projectId: 'proj-1',
    taskId: null,
    title: 'Bloqueio',
    body: '',
    status: 'open',
    openedBy: 'Claude',
    assignee: null,
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    sourceCheckpointId: null,
    version: 0,
    createdAt: atras(45),
    updatedAt: atras(45),
    ...over,
  }
}

function rascunho(over: Partial<WorkDraft> = {}): WorkDraft {
  return {
    id: 'rascunho-1',
    projectId: 'proj-1',
    actorId: 'Claude (automático)',
    taskId: null,
    version: 0,
    status: 'undelivered',
    summary: 'Resumo automático da sessão',
    nextAction: 'O registro desta etapa ainda não foi gravado; ver o resumo acima.',
    changedAreas: [],
    openIssues: [],
    observedChecks: [],
    updatedAt: atras(0, 1),
    ...over,
  }
}

function dados(over: Partial<DadosDaCarta> = {}): DadosDaCarta {
  return {
    project: projeto(),
    tasks: [],
    checkpoints: [],
    cards: [],
    backlog: [],
    decisions: [],
    approvals: [],
    blockers: [],
    rascunhoAutomatico: null,
    saude: { ultimoRegistroAutomatico: null, ultimoErro: null },
    ...over,
  }
}

const ids = (itens: Array<{ id: string }>): string[] => itens.map((i) => i.id)

describe('montarCarta: cinco grupos do "O que falta"', () => {
  it('agrupa nos cinco grupos', () => {
    const carta = montarCarta(
      dados({
        cards: [
          cartao({ id: 'c-pend', column: 'pending' }),
          cartao({ id: 'c-prog', column: 'in_progress' }),
          cartao({ id: 'c-unf', column: 'unfinished' }),
          cartao({ id: 'c-test', column: 'testing' }),
          cartao({ id: 'c-dep', column: 'awaiting_deploy' }),
          cartao({ id: 'c-bloq', column: 'blocked' }),
          cartao({ id: 'c-ideia', column: 'ideas' }),
        ],
        tasks: [
          tarefa({ id: 't-todo', status: 'todo' }),
          tarefa({ id: 't-prog', status: 'in_progress' }),
          tarefa({ id: 't-bloq', status: 'blocked', blockedReason: 'Falta a chave' }),
        ],
        backlog: [itemDoBacklog({ id: 'b-ready', stage: 'ready' }), itemDoBacklog({ id: 'b-idea', stage: 'idea' })],
        approvals: [aprovacao({ id: 'a-pend', status: 'pending' }), aprovacao({ id: 'a-ok', status: 'approved' })],
        decisions: [decisao({ id: 'd-prop', status: 'proposed' }), decisao({ id: 'd-acc', status: 'accepted' })],
        blockers: [bloqueio({ id: 'bl-open', status: 'open' }), bloqueio({ id: 'bl-res', status: 'resolved' })],
      }),
      AGORA,
    )
    assert.deepEqual(ids(carta.falta.precisa_de_voce), ['a-pend', 'd-prop'])
    assert.deepEqual(ids(carta.falta.travado), ['c-bloq', 'bl-open', 't-bloq'])
    assert.deepEqual(ids(carta.falta.em_andamento), ['c-prog', 'c-unf', 'c-test', 'c-dep', 't-prog'])
    assert.deepEqual(ids(carta.falta.a_fazer), ['c-pend', 't-todo', 'b-ready'])
    assert.deepEqual(ids(carta.falta.ideias), ['c-ideia', 'b-idea'])
  })

  it('cada fonte cai no grupo certo, uma de cada vez', () => {
    const casos: Array<[string, Partial<DadosDaCarta>, keyof ReturnType<typeof montarCarta>['falta']]> = [
      ['coluna Bloqueado', { cards: [cartao({ column: 'blocked' })] }, 'travado'],
      ['coluna Em andamento', { cards: [cartao({ column: 'in_progress' })] }, 'em_andamento'],
      ['coluna Inacabado', { cards: [cartao({ column: 'unfinished' })] }, 'em_andamento'],
      ['coluna Em teste', { cards: [cartao({ column: 'testing' })] }, 'em_andamento'],
      ['coluna Testado, falta deploy', { cards: [cartao({ column: 'awaiting_deploy' })] }, 'em_andamento'],
      ['coluna Pendente', { cards: [cartao({ column: 'pending' })] }, 'a_fazer'],
      ['coluna Ideias', { cards: [cartao({ column: 'ideas' })] }, 'ideias'],
      ['tarefa blocked', { tasks: [tarefa({ status: 'blocked' })] }, 'travado'],
      ['tarefa in_progress', { tasks: [tarefa({ status: 'in_progress' })] }, 'em_andamento'],
      ['tarefa todo', { tasks: [tarefa({ status: 'todo' })] }, 'a_fazer'],
      ['backlog ready', { backlog: [itemDoBacklog({ stage: 'ready' })] }, 'a_fazer'],
      ['backlog idea', { backlog: [itemDoBacklog({ stage: 'idea' })] }, 'ideias'],
      ['aprovação pending', { approvals: [aprovacao({ status: 'pending' })] }, 'precisa_de_voce'],
      ['decisão proposed', { decisions: [decisao({ status: 'proposed' })] }, 'precisa_de_voce'],
      ['bloqueio open', { blockers: [bloqueio({ status: 'open' })] }, 'travado'],
      ['bloqueio mitigated', { blockers: [bloqueio({ status: 'mitigated' })] }, 'travado'],
    ]
    for (const [nome, parte, grupoEsperado] of casos) {
      const carta = montarCarta(dados(parte), AGORA)
      for (const grupo of Object.keys(carta.falta) as Array<keyof typeof carta.falta>) {
        assert.equal(carta.falta[grupo].length, grupo === grupoEsperado ? 1 : 0, `${nome}: grupo ${grupo}`)
      }
    }
  })

  it('o que não é pendência fica fora: aprovação decidida, decisão vigente, bloqueio resolvido ou com risco aceito, tarefa pronta', () => {
    const carta = montarCarta(
      dados({
        approvals: [
          aprovacao({ id: 'a1', status: 'approved' }),
          aprovacao({ id: 'a2', status: 'rejected' }),
          aprovacao({ id: 'a3', status: 'withdrawn' }),
        ],
        decisions: [
          decisao({ id: 'd1', status: 'accepted' }),
          decisao({ id: 'd2', status: 'superseded' }),
          decisao({ id: 'd3', status: 'revoked' }),
        ],
        blockers: [bloqueio({ id: 'b2', status: 'resolved' }), bloqueio({ id: 'b3', status: 'accepted_risk' })],
        tasks: [tarefa({ id: 't1', status: 'done' })],
      }),
      AGORA,
    )
    assert.deepEqual(carta.falta, { precisa_de_voce: [], travado: [], em_andamento: [], a_fazer: [], ideias: [] })
  })

  it('completo e descartado não entram em falta; promovido e arquivado do backlog ficam fora', () => {
    const carta = montarCarta(
      dados({
        cards: [cartao({ id: 'c1', column: 'done' }), cartao({ id: 'c2', column: 'discarded' })],
        backlog: [
          itemDoBacklog({ id: 'b1', stage: 'promoted', promotedTaskId: 'tarefa-1' }),
          itemDoBacklog({ id: 'b2', stage: 'archived' }),
        ],
      }),
      AGORA,
    )
    assert.deepEqual(carta.falta, { precisa_de_voce: [], travado: [], em_andamento: [], a_fazer: [], ideias: [] })
    assert.deepEqual(ids(carta.feitoRecente), ['c1'])
  })

  it('a ordem dentro do grupo segue as fontes e, em cada fonte, a ordem recebida', () => {
    const carta = montarCarta(
      dados({
        cards: [cartao({ id: 'c1', column: 'pending' }), cartao({ id: 'c2', column: 'pending' })],
        tasks: [tarefa({ id: 't1' }), tarefa({ id: 't2' })],
        backlog: [itemDoBacklog({ id: 'b1' }), itemDoBacklog({ id: 'b2' })],
        approvals: [aprovacao({ id: 'a1' }), aprovacao({ id: 'a2' })],
        decisions: [decisao({ id: 'd1' }), decisao({ id: 'd2' })],
      }),
      AGORA,
    )
    assert.deepEqual(ids(carta.falta.precisa_de_voce), ['a1', 'a2', 'd1', 'd2'])
    assert.deepEqual(ids(carta.falta.a_fazer), ['c1', 'c2', 't1', 't2', 'b1', 'b2'])
  })
})

describe('montarCarta: cartão "depende de você"', () => {
  it('cartão marcado aparece só em precisa_de_voce', () => {
    const colunas: BoardColumnId[] = ['ideas', 'pending', 'in_progress', 'unfinished', 'testing', 'awaiting_deploy', 'blocked']
    for (const column of colunas) {
      const carta = montarCarta(dados({ cards: [cartao({ id: 'marcado', column, needsOwner: true })] }), AGORA)
      assert.deepEqual(ids(carta.falta.precisa_de_voce), ['marcado'], column)
      assert.deepEqual(ids(carta.falta.travado), [], column)
      assert.deepEqual(ids(carta.falta.em_andamento), [], column)
      assert.deepEqual(ids(carta.falta.a_fazer), [], column)
      assert.deepEqual(ids(carta.falta.ideias), [], column)
    }
  })

  it('o cartão marcado mantém a etapa de origem no item', () => {
    const carta = montarCarta(dados({ cards: [cartao({ id: 'm', column: 'blocked', needsOwner: true })] }), AGORA)
    assert.equal(carta.falta.precisa_de_voce[0]?.etapa, 'Bloqueado')
  })

  it('só a marca verdadeira conta: false, ausente ou outro valor ficam no grupo da coluna', () => {
    const carta = montarCarta(
      dados({
        cards: [
          cartao({ id: 'falso', column: 'pending', needsOwner: false }),
          cartao({ id: 'ausente', column: 'pending' }),
          cartao({ id: 'texto', column: 'pending', needsOwner: 'sim' as unknown as boolean }),
        ],
      }),
      AGORA,
    )
    assert.deepEqual(ids(carta.falta.precisa_de_voce), [])
    assert.deepEqual(ids(carta.falta.a_fazer), ['falso', 'ausente', 'texto'])
  })

  it('cartão marcado mas encerrado (completo ou descartado) não entra em falta', () => {
    const carta = montarCarta(
      dados({
        cards: [
          cartao({ id: 'feito', column: 'done', needsOwner: true }),
          cartao({ id: 'descartado', column: 'discarded', needsOwner: true }),
        ],
      }),
      AGORA,
    )
    assert.deepEqual(carta.falta, { precisa_de_voce: [], travado: [], em_andamento: [], a_fazer: [], ideias: [] })
  })
})

describe('montarCarta: forma de cada item de falta', () => {
  it('cartão: título, descrição, nome da coluna como etapa e versão', () => {
    const carta = montarCarta(
      dados({ cards: [cartao({ id: 'c', column: 'awaiting_deploy', title: 'Publicar o site', description: 'Falta o domínio', version: 4 })] }),
      AGORA,
    )
    assert.deepEqual(carta.falta.em_andamento, [
      { origem: 'cartao', id: 'c', titulo: 'Publicar o site', detalhe: 'Falta o domínio', etapa: 'Testado, falta deploy', versao: 4 },
    ])
  })

  it('cartão sem descrição: detalhe null', () => {
    const carta = montarCarta(dados({ cards: [cartao({ description: '' })] }), AGORA)
    assert.equal(carta.falta.a_fazer[0]?.detalhe, null)
  })

  it('a etapa é o nome da coluna, em português', () => {
    const nomes: Array<[BoardColumnId, string]> = [
      ['ideas', 'Ideias'],
      ['pending', 'Pendente'],
      ['in_progress', 'Em andamento'],
      ['unfinished', 'Inacabado'],
      ['testing', 'Em teste'],
      ['awaiting_deploy', 'Testado, falta deploy'],
      ['blocked', 'Bloqueado'],
    ]
    for (const [column, nome] of nomes) {
      const carta = montarCarta(dados({ cards: [cartao({ column })] }), AGORA)
      const item = Object.values(carta.falta).flat()[0]
      assert.equal(item?.etapa, nome, column)
    }
  })

  it('tarefa travada mostra o motivo do bloqueio; sem motivo, a descrição; sem nada, null', () => {
    const carta = montarCarta(
      dados({
        tasks: [
          tarefa({ id: 'a', status: 'blocked', blockedReason: 'Falta a chave', description: 'Texto da tarefa', version: 3 }),
          tarefa({ id: 'b', status: 'blocked', blockedReason: null, description: 'Só a descrição' }),
          tarefa({ id: 'c', status: 'blocked', blockedReason: '', description: null }),
          tarefa({ id: 'd', status: 'blocked' }),
        ],
      }),
      AGORA,
    )
    assert.deepEqual(carta.falta.travado[0], {
      origem: 'tarefa',
      id: 'a',
      titulo: 'Tarefa',
      detalhe: 'Falta a chave',
      etapa: null,
      versao: 3,
    })
    assert.equal(carta.falta.travado[1]?.detalhe, 'Só a descrição')
    assert.equal(carta.falta.travado[2]?.detalhe, null)
    assert.equal(carta.falta.travado[3]?.detalhe, null)
  })

  it('item do backlog: título, descrição e versão', () => {
    const carta = montarCarta(dados({ backlog: [itemDoBacklog({ id: 'b', title: 'Rever preços', description: 'Comparar com a concorrência', version: 2 })] }), AGORA)
    assert.deepEqual(carta.falta.a_fazer, [
      { origem: 'backlog', id: 'b', titulo: 'Rever preços', detalhe: 'Comparar com a concorrência', etapa: null, versao: 2 },
    ])
    assert.equal(montarCarta(dados({ backlog: [itemDoBacklog({ description: '' })] }), AGORA).falta.a_fazer[0]?.detalhe, null)
  })

  it('aprovação: o detalhe é a justificativa', () => {
    const carta = montarCarta(
      dados({ approvals: [aprovacao({ id: 'a', title: 'Mudar o objetivo', body: 'Texto longo', rationale: 'Porque o foco mudou', version: 5 })] }),
      AGORA,
    )
    assert.deepEqual(carta.falta.precisa_de_voce, [
      { origem: 'aprovacao', id: 'a', titulo: 'Mudar o objetivo', detalhe: 'Porque o foco mudou', etapa: null, versao: 5 },
    ])
    assert.equal(montarCarta(dados({ approvals: [aprovacao({ rationale: '' })] }), AGORA).falta.precisa_de_voce[0]?.detalhe, null)
  })

  it('decisão proposta: o detalhe é o texto e a versão vai junto (o botão de confirmar precisa dela)', () => {
    const carta = montarCarta(
      dados({ decisions: [decisao({ id: 'd', title: 'Usar Postgres', body: 'Por causa da escala', version: 7 })] }),
      AGORA,
    )
    assert.deepEqual(carta.falta.precisa_de_voce, [
      { origem: 'decisao', id: 'd', titulo: 'Usar Postgres', detalhe: 'Por causa da escala', etapa: null, versao: 7 },
    ])
    assert.equal(montarCarta(dados({ decisions: [decisao({ body: '' })] }), AGORA).falta.precisa_de_voce[0]?.detalhe, null)
  })

  it('bloqueio aberto: o detalhe é o motivo', () => {
    const carta = montarCarta(dados({ blockers: [bloqueio({ id: 'x', title: 'Cobrança do GitHub', body: 'O cartão foi recusado', version: 1 })] }), AGORA)
    assert.deepEqual(carta.falta.travado, [
      { origem: 'bloqueio', id: 'x', titulo: 'Cobrança do GitHub', detalhe: 'O cartão foi recusado', etapa: null, versao: 1 },
    ])
    assert.equal(montarCarta(dados({ blockers: [bloqueio({ body: '' })] }), AGORA).falta.travado[0]?.detalhe, null)
  })

  it('bloqueio mitigado continua travado (no resto do produto ainda é aberto); o detalhe começa por "Mitigado: "', () => {
    const mitigado = (over: Partial<ProjectBlocker>) =>
      montarCarta(dados({ blockers: [bloqueio({ id: 'm', title: 'Cobrança', status: 'mitigated', ...over })] }), AGORA).falta.travado
    assert.deepEqual(mitigado({ body: 'O cartão foi recusado', resolution: 'Pago por boleto este mês', version: 2 }), [
      { origem: 'bloqueio', id: 'm', titulo: 'Cobrança', detalhe: 'Mitigado: Pago por boleto este mês', etapa: null, versao: 2 },
    ])
    // Sem a nota de mitigação, o motivo do bloqueio; sem nenhum dos dois, só o estado.
    assert.equal(mitigado({ body: 'O cartão foi recusado', resolution: null })[0]?.detalhe, 'Mitigado: O cartão foi recusado')
    assert.equal(mitigado({ body: 'O cartão foi recusado', resolution: '' })[0]?.detalhe, 'Mitigado: O cartão foi recusado')
    assert.equal(mitigado({ body: '', resolution: null })[0]?.detalhe, 'Mitigado.')
    // Aberto nunca leva o prefixo, mesmo com uma nota antiga gravada.
    const aberto = montarCarta(dados({ blockers: [bloqueio({ body: 'Motivo', resolution: 'nota velha' })] }), AGORA)
    assert.equal(aberto.falta.travado[0]?.detalhe, 'Motivo')
  })
})

describe('montarCarta: última atividade e dias parado', () => {
  it('ultima atividade é o mais novo entre checkpoint, cartão e rascunho automático', () => {
    const base = {
      checkpoints: [checkpoint({ id: 'cp-a', revision: 2, createdAt: atras(5) }), checkpoint({ id: 'cp-b', revision: 1, createdAt: atras(9) })],
      cards: [cartao({ updatedAt: atras(6) })],
    }
    // O checkpoint é o mais novo.
    assert.equal(montarCarta(dados(base), AGORA).ultimaAtividade, atras(5))
    // O cartão passa a ser o mais novo.
    assert.equal(montarCarta(dados({ ...base, cards: [cartao({ updatedAt: atras(2) })] }), AGORA).ultimaAtividade, atras(2))
    // O rascunho automático passa a ser o mais novo.
    assert.equal(
      montarCarta(dados({ ...base, cards: [cartao({ updatedAt: atras(2) })], rascunhoAutomatico: rascunho({ updatedAt: atras(1) }) }), AGORA)
        .ultimaAtividade,
      atras(1),
    )
  })

  it('o mais novo vale em qualquer posição da lista', () => {
    const cps = [
      checkpoint({ id: 'a', revision: 1, createdAt: atras(8) }),
      checkpoint({ id: 'b', revision: 3, createdAt: atras(2) }),
      checkpoint({ id: 'c', revision: 2, createdAt: atras(4) }),
    ]
    assert.equal(montarCarta(dados({ checkpoints: cps }), AGORA).ultimaAtividade, atras(2))
    assert.equal(montarCarta(dados({ checkpoints: [...cps].reverse() }), AGORA).ultimaAtividade, atras(2))
    const cartoes = [cartao({ id: 'x', updatedAt: atras(3) }), cartao({ id: 'y', updatedAt: atras(1) }), cartao({ id: 'z', updatedAt: atras(7) })]
    assert.equal(montarCarta(dados({ cards: cartoes }), AGORA).ultimaAtividade, atras(1))
  })

  it('tarefa e bloqueio não contam como atividade', () => {
    const carta = montarCarta(dados({ tasks: [tarefa({ createdAt: atras(1) })], blockers: [bloqueio({ updatedAt: atras(1) })] }), AGORA)
    assert.equal(carta.ultimaAtividade, null)
    assert.equal(carta.diasParado, null)
  })

  it('diasParado são os dias inteiros entre a última atividade e agora', () => {
    const com = (quando: string) => montarCarta(dados({ cards: [cartao({ updatedAt: quando })] }), AGORA).diasParado
    assert.equal(com(atras(3, 23)), 3)
    assert.equal(com(atras(3)), 3)
    assert.equal(com(atras(2, 23)), 2)
    assert.equal(com(atras(0, 5)), 0)
    assert.equal(com(atras(30)), 30)
  })

  it('atividade no futuro (relógio adiantado) não gera dias negativos', () => {
    const futuro = new Date(AGORA.getTime() + 2 * DIA).toISOString()
    assert.equal(montarCarta(dados({ cards: [cartao({ updatedAt: futuro })] }), AGORA).diasParado, 0)
  })

  it('o relógio vem de fora: a mesma atividade vista de outro dia dá outro número', () => {
    const d = dados({ cards: [cartao({ updatedAt: atras(3) })] })
    assert.equal(montarCarta(d, AGORA).diasParado, 3)
    assert.equal(montarCarta(d, new Date(AGORA.getTime() + 4 * DIA)).diasParado, 7)
  })
})

describe('montarCarta: em uma frase', () => {
  it('em uma frase é o humanSummary do checkpoint mais recente', () => {
    const carta = montarCarta(
      dados({
        checkpoints: [
          checkpoint({ id: 'velho', revision: 1, createdAt: atras(9), humanSummary: 'Frase antiga' }),
          checkpoint({ id: 'novo', revision: 2, createdAt: atras(2), humanSummary: 'O site está no ar; falta o domínio.' }),
        ],
      }),
      AGORA,
    )
    assert.equal(carta.emUmaFrase, 'O site está no ar; falta o domínio.')
  })

  it('o mais recente vale em qualquer posição da lista', () => {
    const cps = [
      checkpoint({ id: 'b', revision: 2, humanSummary: 'Segunda' }),
      checkpoint({ id: 'c', revision: 3, humanSummary: 'Terceira' }),
      checkpoint({ id: 'a', revision: 1, humanSummary: 'Primeira' }),
    ]
    assert.equal(montarCarta(dados({ checkpoints: cps }), AGORA).emUmaFrase, 'Terceira')
  })

  it('sem humanSummary no mais recente: null, nunca o resumo técnico nem a frase de um registro antigo', () => {
    const carta = montarCarta(
      dados({
        checkpoints: [
          checkpoint({ id: 'velho', revision: 1, humanSummary: 'Frase antiga' }),
          checkpoint({ id: 'novo', revision: 2, summary: 'Refatorei store.ts' }),
        ],
      }),
      AGORA,
    )
    assert.equal(carta.emUmaFrase, null)
  })

  it('humanSummary vazio vale como ausente', () => {
    assert.equal(montarCarta(dados({ checkpoints: [checkpoint({ humanSummary: '' })] }), AGORA).emUmaFrase, null)
  })

  it('sem checkpoint: null', () => {
    assert.equal(montarCarta(dados(), AGORA).emUmaFrase, null)
  })
})

describe('montarCarta: o que foi feito', () => {
  it('fontes: cartões completos, tarefas prontas e registros com humanSummary', () => {
    const carta = montarCarta(
      dados({
        cards: [
          cartao({ id: 'c-done', column: 'done', title: 'Login pronto', updatedAt: atras(1) }),
          cartao({ id: 'c-pend', column: 'pending', title: 'Não feito', updatedAt: atras(1) }),
          cartao({ id: 'c-desc', column: 'discarded', title: 'Descartado', updatedAt: atras(1) }),
        ],
        tasks: [
          tarefa({ id: 't-done', status: 'done', title: 'Migrar o banco', completionCheckpointId: 'cp-fim' }),
          tarefa({ id: 't-todo', status: 'todo', title: 'Ainda não' }),
        ],
        checkpoints: [
          checkpoint({ id: 'cp-fim', revision: 2, createdAt: atras(2), humanSummary: 'Banco migrado.' }),
          checkpoint({ id: 'cp-sem', revision: 1, createdAt: atras(3) }),
          checkpoint({ id: 'cp-vazio', revision: 3, createdAt: atras(4), humanSummary: '' }),
        ],
      }),
      AGORA,
    )
    assert.deepEqual(carta.feitoRecente, [
      { origem: 'cartao', id: 'c-done', texto: 'Login pronto', quando: atras(1) },
      { origem: 'tarefa', id: 't-done', texto: 'Migrar o banco', quando: atras(2) },
      { origem: 'registro', id: 'cp-fim', texto: 'Banco migrado.', quando: atras(2) },
    ])
    assert.deepEqual(carta.feitoPorMes, [])
  })

  it('tarefa pronta sem checkpoint de conclusão usa a data de criação', () => {
    const carta = montarCarta(
      dados({
        cards: [cartao({ updatedAt: atras(1) })],
        tasks: [
          tarefa({ id: 't1', status: 'done', createdAt: atras(3), completionCheckpointId: null }),
          tarefa({ id: 't2', status: 'done', createdAt: atras(4), completionCheckpointId: 'cp-que-nao-existe' }),
        ],
      }),
      AGORA,
    )
    assert.deepEqual(
      carta.feitoRecente.map((i) => [i.id, i.quando]),
      [
        ['t1', atras(3)],
        ['t2', atras(4)],
      ],
    )
  })

  it('feito recente = 7 dias antes da última atividade; o resto por mês, mais novo primeiro', () => {
    const ultima = '2026-10-24T12:00:00.000Z'
    const registro = (id: string, revision: number, createdAt: string) => checkpoint({ id, revision, createdAt, humanSummary: `Texto ${id}` })
    const carta = montarCarta(
      dados({
        checkpoints: [
          registro('mes-07', 1, '2026-07-01T09:00:00.000Z'),
          registro('mes-09-a', 2, '2026-09-02T09:00:00.000Z'),
          registro('limite-fora', 3, '2026-10-17T11:59:59.999Z'),
          registro('limite-dentro', 4, '2026-10-17T12:00:00.000Z'),
          registro('mes-09-b', 5, '2026-09-30T23:59:59.000Z'),
          // 30/09 22h em São Paulo = 01/10 01h UTC: conta em setembro (o dono vive no fuso de São Paulo).
          registro('mes-09-borda', 10, '2026-10-01T01:00:00.000Z'),
          registro('mes-08', 6, '2026-08-15T09:00:00.000Z'),
          registro('ultimo', 7, ultima),
          registro('recente-meio', 8, '2026-10-20T08:00:00.000Z'),
          // 01/10 00h em São Paulo = 01/10 03h UTC: primeiro instante de outubro.
          registro('mes-10-novo-mes', 9, '2026-10-01T03:00:00.000Z'),
          // 01/10 02h59 UTC = 30/09 23h59 em São Paulo: ainda setembro.
          registro('mes-09-fim', 11, '2026-10-01T02:59:59.999Z'),
        ],
      }),
      AGORA,
    )
    assert.deepEqual(ids(carta.feitoRecente), ['ultimo', 'recente-meio', 'limite-dentro'])
    assert.deepEqual(
      carta.feitoPorMes.map((m) => ({ mes: m.mes, itens: ids(m.itens) })),
      [
        { mes: '2026-10', itens: ['limite-fora', 'mes-10-novo-mes'] },
        { mes: '2026-09', itens: ['mes-09-fim', 'mes-09-borda', 'mes-09-b', 'mes-09-a'] },
        { mes: '2026-08', itens: ['mes-08'] },
        { mes: '2026-07', itens: ['mes-07'] },
      ],
    )
  })

  it('a janela é medida da última atividade, não de agora', () => {
    // Parado há 40 dias: o que foi feito na última semana de trabalho continua "recente".
    const carta = montarCarta(
      dados({
        cards: [
          cartao({ id: 'ultimo', column: 'done', updatedAt: atras(40) }),
          cartao({ id: 'junto', column: 'done', updatedAt: atras(43) }),
          cartao({ id: 'antigo', column: 'done', updatedAt: atras(48) }),
        ],
      }),
      AGORA,
    )
    assert.deepEqual(ids(carta.feitoRecente), ['ultimo', 'junto'])
    assert.deepEqual(carta.feitoPorMes.flatMap((m) => ids(m.itens)), ['antigo'])
  })

  it('sem atividade registrada não existe "última sessão": tudo vai agrupado por mês', () => {
    const carta = montarCarta(dados({ tasks: [tarefa({ id: 't', status: 'done', createdAt: '2026-05-10T10:00:00.000Z' })] }), AGORA)
    assert.deepEqual(carta.feitoRecente, [])
    assert.deepEqual(carta.feitoPorMes, [
      { mes: '2026-05', itens: [{ origem: 'tarefa', id: 't', texto: 'Tarefa', quando: '2026-05-10T10:00:00.000Z' }] },
    ])
  })
})

describe('montarCarta: rascunho automático', () => {
  const cp = (revision: number, createdAt: string) => checkpoint({ id: `cp-${revision}`, revision, createdAt })

  it('rascunho automático só aparece se mais novo que o checkpoint mais recente', () => {
    const r = (updatedAt: string) => rascunho({ updatedAt, summary: 'O que aconteceu na sessão' })
    const vista = (rascunhoAutomatico: WorkDraft | null, checkpoints: Checkpoint[]) =>
      montarCarta(dados({ rascunhoAutomatico, checkpoints }), AGORA).rascunhoAutomatico
    // Mais novo: aparece.
    assert.deepEqual(vista(r(atras(1)), [cp(1, atras(3))]), { resumo: 'O que aconteceu na sessão', atualizadoEm: atras(1), versao: 0 })
    // A versão vai junto: a tela descarta o rascunho com ela.
    assert.equal(montarCarta(dados({ rascunhoAutomatico: rascunho({ updatedAt: atras(1), version: 4 }), checkpoints: [] }), AGORA).rascunhoAutomatico?.versao, 4)
    // Mais velho: some.
    assert.equal(vista(r(atras(4)), [cp(1, atras(3))]), null)
    // Mesmo instante: some (precisa ser mais novo).
    assert.equal(vista(r(atras(3)), [cp(1, atras(3))]), null)
    // Um milissegundo depois: aparece.
    assert.notEqual(vista(r(new Date(Date.parse(atras(3)) + 1).toISOString()), [cp(1, atras(3))]), null)
  })

  it('a comparação é com o checkpoint mais recente, em qualquer posição da lista', () => {
    const cps = [cp(1, atras(9)), cp(3, atras(2)), cp(2, atras(4))]
    // Mais novo que o primeiro e que o último da lista, mas mais velho que o checkpoint mais recente.
    const escondido = montarCarta(dados({ rascunhoAutomatico: rascunho({ updatedAt: atras(3) }), checkpoints: cps }), AGORA)
    assert.equal(escondido.rascunhoAutomatico, null)
    const visivel = montarCarta(dados({ rascunhoAutomatico: rascunho({ updatedAt: atras(1) }), checkpoints: cps }), AGORA)
    assert.notEqual(visivel.rascunhoAutomatico, null)
  })

  it('sem checkpoint nenhum, o rascunho aparece', () => {
    const carta = montarCarta(dados({ rascunhoAutomatico: rascunho({ summary: 'Primeira sessão' }) }), AGORA)
    assert.equal(carta.rascunhoAutomatico?.resumo, 'Primeira sessão')
  })

  it('sem rascunho: null', () => {
    assert.equal(montarCarta(dados({ checkpoints: [cp(1, atras(3))] }), AGORA).rascunhoAutomatico, null)
  })

  it('rascunho escondido continua sem contar como atividade a mais, e o visível conta', () => {
    const escondido = montarCarta(dados({ rascunhoAutomatico: rascunho({ updatedAt: atras(5) }), checkpoints: [cp(1, atras(3))] }), AGORA)
    assert.equal(escondido.ultimaAtividade, atras(3))
    const visivel = montarCarta(dados({ rascunhoAutomatico: rascunho({ updatedAt: atras(1) }), checkpoints: [cp(1, atras(3))] }), AGORA)
    assert.equal(visivel.ultimaAtividade, atras(1))
  })
})

describe('montarCarta: projeto, saúde e projeto vazio', () => {
  it('copia o projeto e a saúde como vieram', () => {
    const carta = montarCarta(
      dados({
        project: projeto({ id: 'p-9', name: 'Alfa', objective: 'Vender cursos' }),
        saude: { ultimoRegistroAutomatico: atras(2), ultimoErro: 'banco travado' },
      }),
      AGORA,
    )
    assert.deepEqual(carta.projeto, { id: 'p-9', nome: 'Alfa', objetivo: 'Vender cursos' })
    assert.deepEqual(carta.saude, { ultimoRegistroAutomatico: atras(2), ultimoErro: 'banco travado' })
  })

  it('sem dado, sem número', () => {
    const carta = montarCarta(dados(), AGORA)
    assert.deepEqual(carta, {
      projeto: { id: 'proj-1', nome: 'Alfa', objetivo: 'Vender cursos pela internet' },
      ultimaAtividade: null,
      diasParado: null,
      emUmaFrase: null,
      feitoRecente: [],
      feitoPorMes: [],
      falta: { precisa_de_voce: [], travado: [], em_andamento: [], a_fazer: [], ideias: [] },
      rascunhoAutomatico: null,
      salvamentos: [],
      ultimoRegistroEhSalvamento: false,
      proximoPronto: [],
      avisos: [],
      avisosDaRetomada: [],
      saude: { ultimoRegistroAutomatico: null, ultimoErro: null },
    })
  })
})

describe('montarCarta: salvamentos de compactação (D5)', () => {
  const extras = {
    pedidosDoDono: ['Arruma o login'],
    pendencias: ['Tela de cadastro'],
    perguntasAbertas: ['Qual banco?'],
    arquivosMexidos: ['src/login.ts'],
  }
  const salvamento = (revision: number, over: Partial<Checkpoint> = {}) =>
    checkpoint({ id: `sv-${revision}`, revision, createdAt: atras(20 - revision), kind: 'compactacao', extras, ...over })

  it('cada salvamento vira um resumo inteiro: frase, estado, pedidos, pendências, perguntas, arquivos e próximo passo', () => {
    const carta = montarCarta(
      dados({ checkpoints: [salvamento(1, { summary: 'Estado completo', humanSummary: 'Login pronto', nextStep: 'Fazer o cadastro' })] }),
      AGORA,
    )
    assert.deepEqual(carta.salvamentos, [
      {
        id: 'sv-1',
        criadoEm: atras(19),
        humanSummary: 'Login pronto',
        resumo: 'Estado completo',
        pedidosDoDono: ['Arruma o login'],
        pendencias: ['Tela de cadastro'],
        perguntasAbertas: ['Qual banco?'],
        arquivosMexidos: ['src/login.ts'],
        proximoPasso: 'Fazer o cadastro',
      },
    ])
  })

  it('só os checkpoints de compactação entram; sem frase para o dono, null', () => {
    const carta = montarCarta(dados({ checkpoints: [checkpoint({ id: 'comum', revision: 1 }), salvamento(2)] }), AGORA)
    assert.deepEqual(carta.salvamentos.map((s) => s.id), ['sv-2'])
    assert.equal(carta.salvamentos[0]!.humanSummary, null)
  })

  it('salvamento sem extras (lido de um registro estranho): listas vazias', () => {
    const carta = montarCarta(dados({ checkpoints: [salvamento(1, { extras: undefined })] }), AGORA)
    assert.deepEqual(
      [carta.salvamentos[0]!.pedidosDoDono, carta.salvamentos[0]!.pendencias, carta.salvamentos[0]!.perguntasAbertas, carta.salvamentos[0]!.arquivosMexidos],
      [[], [], [], []],
    )
  })

  it('os 5 mais recentes (pela revisão), mais novo primeiro, em qualquer ordem de chegada', () => {
    const lista = [3, 7, 1, 6, 2, 5, 4].map((r) => salvamento(r))
    const carta = montarCarta(dados({ checkpoints: lista }), AGORA)
    assert.deepEqual(carta.salvamentos.map((s) => s.id), ['sv-7', 'sv-6', 'sv-5', 'sv-4', 'sv-3'])
  })

  it('sem salvamento: lista vazia', () => {
    assert.deepEqual(montarCarta(dados({ checkpoints: [checkpoint()] }), AGORA).salvamentos, [])
  })
})

describe('montarCarta: o salvamento como registro mais recente (D5)', () => {
  it('verdadeiro só quando o checkpoint de maior revisão é de compactação', () => {
    const salvo = checkpoint({ id: 'sv', revision: 2, kind: 'compactacao' })
    const comum = checkpoint({ id: 'cp', revision: 3 })
    assert.equal(montarCarta(dados({ checkpoints: [salvo] }), AGORA).ultimoRegistroEhSalvamento, true)
    assert.equal(montarCarta(dados({ checkpoints: [comum, salvo] }), AGORA).ultimoRegistroEhSalvamento, false)
    assert.equal(montarCarta(dados({ checkpoints: [checkpoint({ revision: 1, kind: 'normal' })] }), AGORA).ultimoRegistroEhSalvamento, false)
    assert.equal(montarCarta(dados(), AGORA).ultimoRegistroEhSalvamento, false)
  })
})

describe('montarCarta: próximo trabalho pronto (D3)', () => {
  it('cartões em Pendente e tarefas a fazer prontas, em ordem de prioridade', () => {
    const carta = montarCarta(
      dados({
        cards: [cartao({ id: 'c-baixa', priority: 'low' }), cartao({ id: 'c-dono', needsOwner: true }), cartao({ id: 'c-urgente', priority: 'urgent' })],
        tasks: [tarefa({ id: 't-alta', priority: 'high' }), tarefa({ id: 't-travada', status: 'blocked' })],
      }),
      AGORA,
    )
    assert.deepEqual(ids(carta.proximoPronto), ['c-urgente', 't-alta', 'c-baixa'])
  })

  it('tarefa com bloqueio aberto fica de fora', () => {
    const blockers = [{ id: 'b1', taskId: 't-1', status: 'open' } as ProjectBlocker]
    const carta = montarCarta(dados({ tasks: [tarefa({ id: 't-1' }), tarefa({ id: 't-2' })], blockers }), AGORA)
    assert.deepEqual(ids(carta.proximoPronto), ['t-2'])
  })
})

describe('montarCarta: avisos (D2, diretriz velha)', () => {
  const registros = (n: number) => Array.from({ length: n }, (_, i) => checkpoint({ id: `cp-${i}`, revision: i + 1, createdAt: atras(10 - i) }))

  it('diretriz de 14 dias ou mais com 5 registros ou mais depois dela: a frase do dono na tela e a do Claude na retomada', () => {
    const carta = montarCarta(dados({ diretriz: { createdAt: atras(20) }, checkpoints: registros(5) }), AGORA)
    assert.equal(carta.avisos.length, 1)
    assert.match(
      carta.avisos[0]!,
      /^A diretriz deste projeto não muda desde \d{2}\/\d{2}\/2026, e desde então houve 5 registros\. Se o projeto mudou, o Claude pode propor a atualização, e você aprova aqui na Axon\.$/,
    )
    assert.equal(carta.avisosDaRetomada.length, 1)
    assert.match(carta.avisosDaRetomada[0]!, /^A diretriz deste projeto não muda desde \d{2}\/\d{2}\/2026; depois dela houve 5 registros\. .*save_charter/)
  })

  it('diretriz nova, poucos registros ou sem diretriz: nenhum aviso, nem na tela nem na retomada', () => {
    for (const d of [
      dados({ diretriz: { createdAt: atras(5) }, checkpoints: registros(9) }),
      dados({ diretriz: { createdAt: atras(20) }, checkpoints: registros(4) }),
      dados({ diretriz: null, checkpoints: registros(9) }),
      dados({ checkpoints: registros(9) }),
    ]) {
      const carta = montarCarta(d, AGORA)
      assert.deepEqual([carta.avisos, carta.avisosDaRetomada], [[], []])
    }
  })
})
