import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PROXIMO_PRONTO_MAXIMO, proximoPronto } from '../server/carta/proximo-pronto.ts'
import type { BoardCard } from '../shared/board.ts'
import type { ProjectBlocker } from '../shared/continuity.ts'
import type { Task } from '../shared/types.ts'

/** Próximo trabalho pronto (lote 2, D3): o que dá para começar agora, em ordem de prioridade e idade. */

const quando = (dia: number) => `2026-10-${String(dia).padStart(2, '0')}T10:00:00.000Z`

function cartao(id: string, over: Partial<BoardCard> = {}): BoardCard {
  return {
    id,
    projectId: 'p',
    column: 'pending',
    position: 0,
    title: `Cartão ${id}`,
    description: '',
    labels: [],
    priority: null,
    checklist: [],
    needsOwner: false,
    createdBy: 'Claude',
    updatedBy: 'Claude',
    createdAt: quando(1),
    updatedAt: quando(20),
    version: 3,
    ...over,
  }
}

function tarefa(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'p',
    title: `Tarefa ${id}`,
    status: 'todo',
    assignee: null,
    leaseUntil: null,
    version: 2,
    createdAt: quando(1),
    blockedReason: null,
    completionCheckpointId: null,
    workIntent: null,
    ...over,
  }
}

function bloqueio(taskId: string | null, status: ProjectBlocker['status']): ProjectBlocker {
  return { id: `b-${taskId}-${status}`, taskId, status } as ProjectBlocker
}

const ids = (itens: Array<{ id: string }>) => itens.map((i) => i.id)
const pronto = (dados: { cards?: BoardCard[]; tasks?: Task[]; blockers?: ProjectBlocker[] }) =>
  proximoPronto({ cards: [], tasks: [], blockers: [], ...dados })

describe('proximoPronto (D3)', () => {
  it('cartão em Pendente vira item com etapa, descrição como detalhe e versão; vazio = sem detalhe', () => {
    assert.deepEqual(pronto({ cards: [cartao('c1', { description: 'Fazer o rodapé' }), cartao('c2', { createdAt: quando(2) })] }), [
      { origem: 'cartao', id: 'c1', titulo: 'Cartão c1', detalhe: 'Fazer o rodapé', etapa: 'Pendente', versao: 3 },
      { origem: 'cartao', id: 'c2', titulo: 'Cartão c2', detalhe: null, etapa: 'Pendente', versao: 3 },
    ])
  })

  it('tarefa a fazer vira item sem etapa, com a descrição como detalhe', () => {
    assert.deepEqual(pronto({ tasks: [tarefa('t1', { description: 'Ligar o Pix' }), tarefa('t2', { createdAt: quando(2) })] }), [
      { origem: 'tarefa', id: 't1', titulo: 'Tarefa t1', detalhe: 'Ligar o Pix', etapa: null, versao: 2 },
      { origem: 'tarefa', id: 't2', titulo: 'Tarefa t2', detalhe: null, etapa: null, versao: 2 },
    ])
  })

  it('só entra cartão em Pendente sem "depende de você"', () => {
    const colunas = ['ideas', 'in_progress', 'unfinished', 'testing', 'awaiting_deploy', 'done', 'blocked', 'discarded'] as const
    const cards = [...colunas.map((column) => cartao(column, { column })), cartao('dono', { needsOwner: true }), cartao('ok')]
    assert.deepEqual(ids(pronto({ cards })), ['ok'])
  })

  it('só entra tarefa a fazer cujas dependências estão todas prontas', () => {
    const tasks = [
      tarefa('feita', { status: 'done' }),
      tarefa('andando', { status: 'in_progress' }),
      tarefa('travada', { status: 'blocked' }),
      tarefa('sem-dependencia'),
      tarefa('dependencia-vazia', { dependencyTaskIds: [] }),
      tarefa('dependencia-pronta', { dependencyTaskIds: ['feita'] }),
      tarefa('dependencia-andando', { dependencyTaskIds: ['feita', 'andando'] }),
      tarefa('dependencia-desconhecida', { dependencyTaskIds: ['sumiu'] }),
    ]
    assert.deepEqual(ids(pronto({ tasks })), ['sem-dependencia', 'dependencia-vazia', 'dependencia-pronta'])
  })

  it('tarefa com bloqueio aberto ou mitigado não está pronta; resolvido ou risco aceito não impede', () => {
    const tasks = [tarefa('aberto'), tarefa('mitigado'), tarefa('resolvido'), tarefa('aceito'), tarefa('livre')]
    const blockers = [
      bloqueio('aberto', 'open'),
      bloqueio('mitigado', 'mitigated'),
      bloqueio('resolvido', 'resolved'),
      bloqueio('aceito', 'accepted_risk'),
      bloqueio(null, 'open'),
    ]
    assert.deepEqual(ids(pronto({ tasks, blockers })), ['resolvido', 'aceito', 'livre'])
  })

  it('ordem: urgente, alta, média, baixa, sem prioridade; no empate, o mais antigo primeiro', () => {
    const cards = [
      cartao('sem', { createdAt: quando(1) }),
      cartao('baixa', { priority: 'low', createdAt: quando(1) }),
      cartao('media', { priority: 'medium', createdAt: quando(1) }),
      cartao('alta-nova', { priority: 'high', createdAt: quando(9) }),
      cartao('urgente', { priority: 'urgent', createdAt: quando(9) }),
    ]
    const tasks = [tarefa('alta-velha', { priority: 'high', createdAt: quando(2) })]
    const lista = proximoPronto({ cards, tasks, blockers: [] })
    assert.equal(PROXIMO_PRONTO_MAXIMO, 5)
    assert.deepEqual(ids(lista), ['urgente', 'alta-velha', 'alta-nova', 'media', 'baixa'])
    const comMais = proximoPronto({ cards: [...cards, cartao('mais-velho-sem', { createdAt: '2026-09-30T10:00:00.000Z' })], tasks: [], blockers: [] })
    assert.deepEqual(ids(comMais), ['urgente', 'alta-nova', 'media', 'baixa', 'mais-velho-sem'])
  })

  it('no empate de prioridade e de idade, a ordem recebida (cartões antes das tarefas)', () => {
    const lista = pronto({ cards: [cartao('c1'), cartao('c2')], tasks: [tarefa('t1')] })
    assert.deepEqual(ids(lista), ['c1', 'c2', 't1'])
  })

  it('até cinco itens; sem nada pronto, lista vazia', () => {
    const cards = Array.from({ length: 8 }, (_, i) => cartao(`c${i}`, { createdAt: quando(i + 1) }))
    assert.deepEqual(ids(pronto({ cards })), ['c0', 'c1', 'c2', 'c3', 'c4'])
    assert.deepEqual(pronto({}), [])
  })
})
