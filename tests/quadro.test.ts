process.env.TZ = 'America/Sao_Paulo'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BoardCard } from '../shared/board.ts'
import {
  aplicarMovimentoLocal,
  cardsDaColuna,
  colunaRecolhida,
  indiceDeInsercao,
  proximoVizinho,
  resumoDoQuadro,
  tempoRelativo,
} from '../src/quadro/logica.ts'

function cartao(id: string, column: BoardCard['column'], position: number, extra: Partial<BoardCard> = {}): BoardCard {
  return {
    id, projectId: 'p1', column, position, title: `Cartão ${id}`, description: '', labels: [], priority: null, checklist: [], needsOwner: false,
    createdBy: 'Astra', updatedBy: 'Astra', createdAt: '2026-09-16T10:00:00-03:00', updatedAt: '2026-09-16T10:00:00-03:00', version: 0,
    ...extra,
  }
}

describe('quadro: ordem e movimento local', () => {
  const base = [cartao('c', 'pending', 3072), cartao('a', 'pending', 1024), cartao('x', 'done', 1024), cartao('b', 'pending', 2048)]

  it('cardsDaColuna devolve só a coluna, na ordem de position', () => {
    assert.deepEqual(cardsDaColuna(base, 'pending').map(c => c.id), ['a', 'b', 'c'])
    assert.deepEqual(cardsDaColuna(base, 'ideas'), [])
  })

  it('mover antes de um cartão coloca entre o anterior e ele', () => {
    const depois = aplicarMovimentoLocal(base, 'c', 'pending', 'b')
    assert.deepEqual(cardsDaColuna(depois, 'pending').map(c => c.id), ['a', 'c', 'b'])
  })

  it('mover para o fim de outra coluna', () => {
    const depois = aplicarMovimentoLocal(base, 'a', 'done', null)
    assert.deepEqual(cardsDaColuna(depois, 'done').map(c => c.id), ['x', 'a'])
    assert.deepEqual(cardsDaColuna(depois, 'pending').map(c => c.id), ['b', 'c'])
  })

  it('mover para o topo de uma coluna', () => {
    const depois = aplicarMovimentoLocal(base, 'x', 'pending', 'a')
    assert.deepEqual(cardsDaColuna(depois, 'pending').map(c => c.id), ['x', 'a', 'b', 'c'])
  })

  it('não altera a lista original', () => {
    aplicarMovimentoLocal(base, 'a', 'done', null)
    assert.equal(base.find(c => c.id === 'a')!.column, 'pending')
  })

  it('índice de inserção pelo meio de cada cartão', () => {
    const meios = [100, 200, 300]
    assert.equal(indiceDeInsercao(50, meios), 0)
    assert.equal(indiceDeInsercao(150, meios), 1)
    assert.equal(indiceDeInsercao(299, meios), 2)
    assert.equal(indiceDeInsercao(900, meios), 3)
    assert.equal(indiceDeInsercao(10, []), 0)
  })

  it('vizinho para mover pelo teclado: antes do anterior, ou depois do próximo', () => {
    const coluna = cardsDaColuna(base, 'pending')
    assert.deepEqual(proximoVizinho(coluna, 'b', 'acima'), { beforeCardId: 'a' })
    assert.deepEqual(proximoVizinho(coluna, 'b', 'abaixo'), { beforeCardId: null })
    assert.deepEqual(proximoVizinho(coluna, 'a', 'abaixo'), { beforeCardId: 'c' })
    assert.equal(proximoVizinho(coluna, 'a', 'acima'), null, 'o primeiro não sobe')
    assert.equal(proximoVizinho(coluna, 'c', 'abaixo'), null, 'o último não desce')
  })
})

describe('quadro: resumo e tempo', () => {
  it('resumo usa só números reais e omite o que é zero', () => {
    assert.equal(resumoDoQuadro([]), 'Nenhum cartão ainda. Comece escrevendo um em Pendente.')
    assert.equal(resumoDoQuadro([cartao('a', 'pending', 1)]), '1 cartão.')
    assert.equal(
      resumoDoQuadro([
        cartao('a', 'in_progress', 1), cartao('b', 'in_progress', 2), cartao('c', 'awaiting_deploy', 1),
        cartao('d', 'blocked', 1), cartao('e', 'done', 1),
      ]),
      '5 cartões: 2 em andamento, 1 esperando deploy e 1 bloqueado.',
    )
  })

  it('Bloqueado e Descartado recolhem só quando vazios; as outras nunca', () => {
    const cards = [cartao('a', 'blocked', 1)]
    assert.equal(colunaRecolhida('blocked', cards), false)
    assert.equal(colunaRecolhida('discarded', cards), true)
    assert.equal(colunaRecolhida('pending', []), false)
  })

  it('tempo relativo em português simples', () => {
    const agora = new Date('2026-09-16T15:00:00-03:00')
    assert.equal(tempoRelativo('2026-09-16T14:59:30-03:00', agora), 'agora mesmo')
    assert.equal(tempoRelativo('2026-09-16T14:55:00-03:00', agora), 'há 5 min')
    assert.equal(tempoRelativo('2026-09-16T12:00:00-03:00', agora), 'há 3 h')
    assert.equal(tempoRelativo('2026-09-15T20:00:00-03:00', agora), 'ontem')
    assert.equal(tempoRelativo('2026-09-13T20:00:00-03:00', agora), 'há 3 dias')
    assert.equal(tempoRelativo('2026-08-01T20:00:00-03:00', agora), '1 de ago.')
  })
})
