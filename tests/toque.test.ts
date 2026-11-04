import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SELETOR_DO_TOQUE, pontoNoElemento } from '../src/toque.ts'

// A luz que segue o mouse e a onda do clique precisam do ponto do ponteiro dentro do botão,
// em pixels CSS (no 27" a página é ampliada e o ponteiro mede em pixels da tela).
describe('toque: ponto do ponteiro dentro do botão', () => {
  const caixa = { left: 100, top: 40, width: 120, height: 42 }

  it('mede a partir do canto do botão', () => {
    assert.deepEqual(pontoNoElemento(130, 61, caixa, 1), { x: 30, y: 21 })
  })

  it('com a página ampliada, converte para pixels CSS', () => {
    assert.deepEqual(pontoNoElemento(215, 86, caixa, 1.15), { x: 100, y: 40 })
  })

  it('arredonda para não reescrever o estilo por frações de pixel', () => {
    assert.deepEqual(pontoNoElemento(130.4, 61.6, caixa, 1), { x: 30, y: 22 })
  })

  it('vale para botões de todo tipo, e não para links soltos', () => {
    assert.match(SELETOR_DO_TOQUE, /\.button/)
    assert.match(SELETOR_DO_TOQUE, /\.icon-button/)
    assert.doesNotMatch(SELETOR_DO_TOQUE, /(^|,\s*)a(\s|,|$)/)
  })
})
