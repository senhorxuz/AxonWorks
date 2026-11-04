import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { escalaDoElemento, paraPixelsCss } from '../src/escala-da-tela.ts'

// Em telas grandes a página inteira é ampliada (CSS zoom). O ponteiro e o getBoundingClientRect
// medem em pixels da tela; estilos escritos pelo código são pixels CSS, que a ampliação multiplica.
describe('escala da tela', () => {
  it('lê a ampliação aplicada ao elemento', () => {
    assert.equal(escalaDoElemento({ currentCSSZoom: 1.15 }), 1.15)
    assert.equal(escalaDoElemento({ currentCSSZoom: 1 }), 1)
  })

  it('sem ampliação conhecida, vale 1 (navegador antigo, elemento ausente, valor estranho)', () => {
    assert.equal(escalaDoElemento({}), 1)
    assert.equal(escalaDoElemento(null), 1)
    assert.equal(escalaDoElemento(undefined), 1)
    assert.equal(escalaDoElemento({ currentCSSZoom: 0 }), 1)
    assert.equal(escalaDoElemento({ currentCSSZoom: -2 }), 1)
    assert.equal(escalaDoElemento({ currentCSSZoom: Number.NaN }), 1)
    assert.equal(escalaDoElemento({ currentCSSZoom: Number.POSITIVE_INFINITY }), 1)
  })

  it('converte pixels da tela em pixels CSS dividindo pela ampliação', () => {
    assert.ok(Math.abs(paraPixelsCss(230, 1.15) - 200) < 1e-9)
    assert.ok(Math.abs(paraPixelsCss(-46, 1.15) + 40) < 1e-9)
    assert.equal(paraPixelsCss(500, 1), 500)
  })
})
