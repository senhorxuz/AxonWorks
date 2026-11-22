// Forma curta da diretriz (charter) no contexto compilado: o começo cortado em palavra e o aviso de onde ler o resto.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ContextItem } from '../shared/context.ts'
import { TAMANHO_DA_DIRETRIZ_CURTA, cortarEmPalavra, formaCurtaDaDiretriz } from '../server/contexto/itens.ts'

const FIM = ' […] (inteiro: get_charter)'
const item = (body: string): ContextItem =>
  ({ id: 'c1', sourceType: 'charter', title: 'Charter vigente (revisão 1)', body, provenance: 'human_directive', reason: 'r' }) as ContextItem

describe('cortarEmPalavra', () => {
  it('texto que cabe volta igual', () => {
    assert.equal(cortarEmPalavra('abc def', 7), 'abc def')
  })
  it('corta antes da palavra que passaria do máximo', () => {
    assert.equal(cortarEmPalavra('abc def ghi', 9), 'abc def')
  })
  it('a palavra que termina exatamente no máximo entra inteira', () => {
    assert.equal(cortarEmPalavra('abc def ghi', 7), 'abc def')
  })
  it('sem espaço nenhum, corta no máximo', () => {
    assert.equal(cortarEmPalavra('abcdefghij', 4), 'abcd')
  })
  it('não deixa espaço no fim', () => {
    assert.equal(cortarEmPalavra('abc   def', 5), 'abc')
  })
})

describe('formaCurtaDaDiretriz', () => {
  it('diretriz que cabe no tamanho curto não ganha forma curta', () => {
    assert.equal(formaCurtaDaDiretriz(item('x'.repeat(TAMANHO_DA_DIRETRIZ_CURTA))), null)
  })
  it('diretriz longa vira o começo em palavra inteira e o aviso, marcada como encurtada', () => {
    const palavras = Array.from({ length: 100 }, (_, i) => `palavra${i}`).join(' ')
    const curta = formaCurtaDaDiretriz(item(palavras))
    assert.ok(curta)
    assert.equal(curta.shortened, true)
    assert.equal(curta.id, 'c1')
    assert.equal(curta.title, 'Charter vigente (revisão 1)')
    assert.ok(curta.body.endsWith(FIM))
    const comeco = curta.body.slice(0, -FIM.length)
    assert.ok(comeco.length <= TAMANHO_DA_DIRETRIZ_CURTA)
    assert.ok(palavras.startsWith(`${comeco} `), 'o começo termina numa palavra inteira')
  })
})
