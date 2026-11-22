import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chaveDaColuna, chaveDoQueEsperaODono } from '../src/quadro/chegada-do-dono.ts'
import { chaveDaChegada } from '../src/chegada/chegada.ts'

const c = (id: string, column: string, needsOwner: boolean) => ({ id, column: column as never, needsOwner })

describe('chaveDoQueEsperaODono', () => {
  it('leva ao primeiro cartão que depende do dono, na ordem recebida', () => {
    const chave = chaveDoQueEsperaODono([c('a', 'pending', false), c('b', 'blocked', true), c('c', 'pending', true)])
    assert.equal(chave, chaveDaChegada('cartao', 'b'))
  })
  it('ignora cartão do dono já encerrado (completo ou descartado)', () => {
    assert.equal(chaveDoQueEsperaODono([c('a', 'done', true), c('b', 'discarded', true), c('c', 'pending', true)]), chaveDaChegada('cartao', 'c'))
  })
  it('sem nenhum cartão do dono em jogo, acende a coluna Pendente', () => {
    assert.equal(chaveDoQueEsperaODono([]), chaveDaColuna('pending'))
    assert.equal(chaveDoQueEsperaODono([c('a', 'pending', false), c('b', 'done', true)]), 'quadro-coluna:pending')
  })
})
