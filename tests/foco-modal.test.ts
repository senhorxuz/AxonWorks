import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { escolherFocoInicial, houveDigitacao, proximoFoco } from '../src/foco/modal.ts'

describe('proximoFoco: o Tab fica preso dentro do modal', () => {
  it('avança de um em um', () => {
    assert.equal(proximoFoco(4, 0, false), 1)
    assert.equal(proximoFoco(4, 2, false), 3)
  })
  it('do último volta ao primeiro', () => {
    assert.equal(proximoFoco(4, 3, false), 0)
  })
  it('Shift+Tab recua e do primeiro vai ao último', () => {
    assert.equal(proximoFoco(4, 2, true), 1)
    assert.equal(proximoFoco(4, 0, true), 3)
  })
  it('foco fora do modal (corpo da página): Tab entra no primeiro, Shift+Tab no último', () => {
    assert.equal(proximoFoco(4, -1, false), 0)
    assert.equal(proximoFoco(4, 9, false), 0)
    assert.equal(proximoFoco(4, -1, true), 3)
    assert.equal(proximoFoco(4, 9, true), 3)
  })
  it('um só elemento: fica nele; nenhum: não há para onde ir', () => {
    assert.equal(proximoFoco(1, 0, false), 0)
    assert.equal(proximoFoco(1, 0, true), 0)
    assert.equal(proximoFoco(0, 0, false), -1)
  })
})

describe('houveDigitacao', () => {
  it('retratos iguais: nada mudou', () => {
    assert.equal(houveDigitacao(['', ''], ['', '']), false)
    assert.equal(houveDigitacao([], []), false)
  })
  it('um campo diferente basta', () => {
    assert.equal(houveDigitacao(['', ''], ['', 'a']), true)
    assert.equal(houveDigitacao(['x'], ['']), true)
  })
  it('número de campos diferente conta como mudança', () => {
    assert.equal(houveDigitacao([''], ['', '']), true)
  })
})

describe('escolherFocoInicial', () => {
  it('prefere o campo, depois a ação principal, depois o primeiro botão', () => {
    assert.equal(escolherFocoInicial('campo', 'principal', 'botao'), 'campo')
    assert.equal(escolherFocoInicial(null, 'principal', 'botao'), 'principal')
    assert.equal(escolherFocoInicial(null, null, 'botao'), 'botao')
    assert.equal(escolherFocoInicial(null, null, null), null)
  })
})
