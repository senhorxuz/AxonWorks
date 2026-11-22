import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { passoDaRolagem, podeRolar } from '../src/quadro/rolagem.ts'

describe('podeRolar', () => {
  it('no começo, só dá para ir à direita', () => {
    assert.deepEqual(podeRolar(0, 1000, 2000), { esquerda: false, direita: true })
  })
  it('no meio, os dois lados', () => {
    assert.deepEqual(podeRolar(400, 1000, 2000), { esquerda: true, direita: true })
  })
  it('no fim, só à esquerda', () => {
    assert.deepEqual(podeRolar(1000, 1000, 2000), { esquerda: true, direita: false })
  })
  it('cabe tudo: nenhum lado', () => {
    assert.deepEqual(podeRolar(0, 1000, 1000), { esquerda: false, direita: false })
  })
  it('a folga de 2 px não acende a seta por arredondamento', () => {
    assert.deepEqual(podeRolar(2, 1000, 1002), { esquerda: false, direita: false })
    assert.deepEqual(podeRolar(3, 1000, 1006), { esquerda: true, direita: true })
    assert.deepEqual(podeRolar(0, 1000, 1003), { esquerda: false, direita: true })
  })
})

describe('passoDaRolagem', () => {
  it('70% da largura visível, com o sinal da direção', () => {
    assert.equal(passoDaRolagem(1000, 'direita'), 700)
    assert.equal(passoDaRolagem(1000, 'esquerda'), -700)
    assert.equal(passoDaRolagem(333, 'direita'), 233)
  })
})
