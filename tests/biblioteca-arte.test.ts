import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { guilloche, previaDoConteudo, tomDoTipo } from '../src/biblioteca/arte.ts'

const numeros = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe('biblioteca: prévia do conteúdo', () => {
  it('tira a marcação e junta o texto numa linha corrida', () => {
    const texto = '# Título\n\n- **Pix** primeiro\n> citação com `código` e [link](https://x.com)\n1. passo um'
    assert.equal(previaDoConteudo(texto), 'Título Pix primeiro citação com código e link passo um')
  })

  it('corta na palavra, com reticências, quando passa do limite', () => {
    const longo = 'palavra '.repeat(40)
    const previa = previaDoConteudo(longo, 30)
    assert.ok(previa.endsWith('…'))
    assert.ok(previa.length <= 31)
    assert.ok(!previa.includes('palavr…'), 'não corta no meio da palavra')
  })

  it('texto curto fica inteiro; texto vazio fica vazio', () => {
    assert.equal(previaDoConteudo('Só isto.'), 'Só isto.')
    assert.equal(previaDoConteudo('   \n\n  '), '')
  })

  it('uma palavra só, maior que o limite, é cortada mesmo assim', () => {
    assert.equal(previaDoConteudo('a'.repeat(50), 10), `${'a'.repeat(10)}…`)
  })
})

describe('biblioteca: ex-libris em guilhoché', () => {
  it('o mesmo documento desenha sempre o mesmo emblema; outro documento, outro', () => {
    assert.deepEqual(guilloche('doc-1', 40), guilloche('doc-1', 40))
    assert.notDeepEqual(guilloche('doc-1', 40), guilloche('doc-2', 40))
  })

  it('três camadas de curva, todas dentro do quadrado do emblema', () => {
    const { camadas } = guilloche('doc-3', 40)
    assert.equal(camadas.length, 3)
    for (const d of camadas) {
      assert.match(d, /^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+)+ Z$/)
      for (const v of numeros(d)) assert.ok(v >= 0 && v <= 80, `fora do emblema: ${v}`)
    }
  })

  it('a curva fecha: termina onde começou', () => {
    for (const semente of ['a', 'b', 'c', 'doc-com-nome-comprido']) {
      for (const d of guilloche(semente, 30).camadas) {
        const v = numeros(d)
        assert.ok(Math.hypot(v.at(-2)! - v[0]!, v.at(-1)! - v[1]!) < 0.6, `curva aberta em ${semente}`)
      }
    }
  })

  it('a camada de fora chega quase à borda do emblema (medido pela distância ao centro)', () => {
    for (const semente of ['doc-4', 'doc-5', 'x']) {
      const v = numeros(guilloche(semente, 40).camadas[0]!)
      let maior = 0
      for (let i = 0; i < v.length; i += 2) maior = Math.max(maior, Math.hypot(v[i]! - 40, v[i + 1]! - 40))
      assert.ok(maior > 37, `${semente}: ${maior}`)
    }
  })
})

describe('biblioteca: tom do tipo', () => {
  it('cada tipo tem seu tom; tipo desconhecido usa o da nota', () => {
    const tons = ['specification', 'research', 'reference', 'artifact', 'note'].map(tomDoTipo)
    assert.equal(new Set(tons).size, 5)
    assert.equal(tomDoTipo('specification'), '#e8794a')
    assert.equal(tomDoTipo('qualquer'), tomDoTipo('note'))
  })
})
