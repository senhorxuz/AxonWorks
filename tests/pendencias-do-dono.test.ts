import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decisoesEsperandoNaAba, detalheDasPendencias, fraseDasPendencias, pendenciasDoDono } from '../src/pendencias-do-dono.ts'
import type { ItemFalta, OrigemItem } from '../shared/carta.ts'

const item = (origem: OrigemItem, id: string): ItemFalta => ({ origem, id, titulo: id, detalhe: null, etapa: null, versao: 1 })

describe('pendenciasDoDono: a única conta de "o que espera por mim"', () => {
  it('sem carta ainda, não há número (nunca 0 no lugar de "ainda não sei")', () => {
    assert.equal(pendenciasDoDono(undefined), undefined)
    assert.equal(pendenciasDoDono(null), undefined)
  })
  it('conta propostas de diretriz, decisões propostas e cartões do Quadro marcados para o dono', () => {
    const itens = [item('aprovacao', 'a1'), item('decisao', 'd1'), item('decisao', 'd2'), item('cartao', 'c1'), item('cartao', 'c2'), item('cartao', 'c3')]
    assert.deepEqual(pendenciasDoDono(itens), { total: 6, aprovacoes: 1, decisoes: 2, cartoes: 3, outros: 0 })
  })
  it('origem que não é uma dessas três entra só no total, para o número continuar batendo com a carta', () => {
    assert.deepEqual(pendenciasDoDono([item('tarefa', 't1'), item('decisao', 'd1')]), { total: 2, aprovacoes: 0, decisoes: 1, cartoes: 0, outros: 1 })
  })
  it('lista vazia é zero de verdade', () => {
    assert.deepEqual(pendenciasDoDono([]), { total: 0, aprovacoes: 0, decisoes: 0, cartoes: 0, outros: 0 })
  })
})

describe('fraseDasPendencias', () => {
  it('singular e plural', () => {
    assert.equal(fraseDasPendencias(1), '1 item espera você.')
    assert.equal(fraseDasPendencias(25), '25 itens esperam você.')
    assert.equal(fraseDasPendencias(0), 'Nada espera você.')
  })
})

describe('detalheDasPendencias', () => {
  it('lista só o que tem, na ordem diretriz, decisões, cartões', () => {
    assert.equal(detalheDasPendencias({ total: 25, aprovacoes: 1, decisoes: 20, cartoes: 4, outros: 0 }), '1 proposta para decidir, 20 decisões e 4 cartões do Quadro')
  })
  it('dois itens se ligam com "e"', () => {
    assert.equal(detalheDasPendencias({ total: 21, aprovacoes: 0, decisoes: 20, cartoes: 1, outros: 0 }), '20 decisões e 1 cartão do Quadro')
  })
  it('um item só, no singular', () => {
    assert.equal(detalheDasPendencias({ total: 1, aprovacoes: 0, decisoes: 1, cartoes: 0, outros: 0 }), '1 decisão')
    assert.equal(detalheDasPendencias({ total: 1, aprovacoes: 1, decisoes: 0, cartoes: 0, outros: 0 }), '1 proposta para decidir')
  })
  it('"outros" aparece como "outros itens"', () => {
    assert.equal(detalheDasPendencias({ total: 3, aprovacoes: 0, decisoes: 2, cartoes: 0, outros: 1 }), '2 decisões e 1 outro item')
  })
  it('nada, nada a dizer', () => {
    assert.equal(detalheDasPendencias({ total: 0, aprovacoes: 0, decisoes: 0, cartoes: 0, outros: 0 }), '')
  })
})

describe('detalheDasPendencias: plurais', () => {
  it('propostas e outros itens no plural', () => {
    assert.equal(detalheDasPendencias({ total: 4, aprovacoes: 2, decisoes: 0, cartoes: 0, outros: 2 }), '2 propostas para decidir e 2 outros itens')
  })
  it('uma parte só: sem "e" nem vírgula; nenhuma: vazio', () => {
    assert.equal(detalheDasPendencias({ total: 2, aprovacoes: 2, decisoes: 0, cartoes: 0, outros: 0 }), '2 propostas para decidir')
    assert.equal(detalheDasPendencias({ total: 3, aprovacoes: 0, decisoes: 0, cartoes: 0, outros: 3 }), '3 outros itens')
  })
})

describe('decisoesEsperandoNaAba', () => {
  it('com a carta, vale o número dela, mesmo que a lista tenha outro', () => {
    assert.equal(decisoesEsperandoNaAba({ total: 5, aprovacoes: 0, decisoes: 2, cartoes: 3, outros: 0 }, 7), 2)
    assert.equal(decisoesEsperandoNaAba({ total: 1, aprovacoes: 0, decisoes: 0, cartoes: 1, outros: 0 }, 4), 0)
  })
  it('sem a carta (falhou), vale o número das propostas da lista, em vez de sumir', () => {
    assert.equal(decisoesEsperandoNaAba(undefined, 3), 3)
    assert.equal(decisoesEsperandoNaAba(undefined, 0), 0)
  })
})
