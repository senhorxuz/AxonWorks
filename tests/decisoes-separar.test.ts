import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDoHistorico, separarDecisoes } from '../src/decisoes/separar.ts'
import type { Decision, DecisionStatus } from '../shared/continuity.ts'

const decisao = (id: string, status: DecisionStatus) => ({ id, status }) as Decision

describe('separarDecisoes', () => {
  it('propostas abertas ficam sempre à vista, separadas das vigentes e do histórico', () => {
    const lista = [decisao('a', 'accepted'), decisao('b', 'proposed'), decisao('c', 'revoked'), decisao('d', 'superseded'), decisao('e', 'proposed')]
    const { abertas, vigentes, historico } = separarDecisoes(lista)
    assert.deepEqual(abertas.map(d => d.id), ['b', 'e'])
    assert.deepEqual(vigentes.map(d => d.id), ['a'])
    assert.deepEqual(historico.map(d => d.id), ['c', 'd'])
  })
  it('o histórico é só revogadas e substituídas', () => {
    const { historico } = separarDecisoes([decisao('a', 'proposed'), decisao('b', 'accepted')])
    assert.deepEqual(historico, [])
  })
  it('lista vazia', () => {
    assert.deepEqual(separarDecisoes([]), { abertas: [], vigentes: [], historico: [] })
  })
  it('mantém a ordem recebida em cada grupo', () => {
    const { vigentes } = separarDecisoes([decisao('z', 'accepted'), decisao('a', 'accepted')])
    assert.deepEqual(vigentes.map(d => d.id), ['z', 'a'])
  })
})

describe('rotuloDoHistorico', () => {
  it('fechado mostra a quantidade; aberto oferece esconder', () => {
    assert.equal(rotuloDoHistorico(false, 3), 'Mostrar histórico (3)')
    assert.equal(rotuloDoHistorico(true, 3), 'Esconder histórico')
  })
})
