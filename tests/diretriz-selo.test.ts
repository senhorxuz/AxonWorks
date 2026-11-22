import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { anelDe, montarSelo } from '../src/diretriz/selo.ts'

function pontosDe(d: string): Array<[number, number]> {
  return d.slice(1, -2).split(' L').map(p => p.split(' ').map(Number) as [number, number])
}

describe('anelDe', () => {
  it('é um caminho fechado de 721 pontos, sempre igual para a mesma semente', () => {
    const d = anelDe('p:1:0', 110, 40, 60)
    assert.ok(d.startsWith('M') && d.endsWith(' Z'))
    assert.equal(pontosDe(d).length, 721)
    assert.equal(anelDe('p:1:0', 110, 40, 60), d)
  })
  it('sementes diferentes desenham anéis diferentes', () => assert.notEqual(anelDe('p:1:0', 110, 40, 60), anelDe('p:2:0', 110, 40, 60)))
  it('todos os pontos ficam entre o raio de dentro e o de fora', () => {
    for (const [x, y] of pontosDe(anelDe('p:3:1', 110, 40, 60))) {
      const raio = Math.hypot(x - 110, y - 110)
      assert.ok(raio >= 39.9 && raio <= 60.1, `raio ${raio}`)
    }
  })
  it('o desenho usa a faixa inteira (não colapsa num círculo)', () => {
    const raios = pontosDe(anelDe('p:3:1', 110, 40, 60)).map(([x, y]) => Math.hypot(x - 110, y - 110))
    assert.ok(Math.max(...raios) - Math.min(...raios) > 15)
  })
})

describe('montarSelo', () => {
  it('dois anéis por versão, o da vigente marcado', () => {
    const s = montarSelo([1, 2, 3], 'p', null)
    assert.equal(s.aneis.length, 6)
    assert.deepEqual(s.aneis.map(a => a.vigente), [false, false, false, false, true, true])
    assert.deepEqual(s.aneis.map(a => a.chave), ['1-0', '1-1', '2-0', '2-1', '3-0', '3-1'])
    assert.ok(s.aneis.every(a => !a.foco))
  })
  it('as faixas vão de dentro para fora, sem sair do selo', () => {
    const s = montarSelo([1, 2], 'p', null)
    const raioMedio = (d: string) => {
      const r = pontosDe(d).map(([x, y]) => Math.hypot(x - 110, y - 110))
      return r.reduce((a, b) => a + b, 0) / r.length
    }
    const medias = s.aneis.map(a => raioMedio(a.d))
    assert.ok(medias[0] < medias[2], 'a versão 2 fica fora da 1')
    assert.ok(Math.max(...s.aneis.flatMap(a => pontosDe(a.d).map(([x, y]) => Math.hypot(x - 110, y - 110)))) <= 106.1)
    assert.ok(Math.min(...s.aneis.flatMap(a => pontosDe(a.d).map(([x, y]) => Math.hypot(x - 110, y - 110)))) >= 33.9)
  })
  it('a semente depende do projeto e da versão', () => {
    assert.notEqual(montarSelo([1], 'a', null).aneis[0].d, montarSelo([1], 'b', null).aneis[0].d)
    assert.notEqual(montarSelo([1], 'a', null).aneis[0].d, montarSelo([1], 'a', null).aneis[1].d)
  })
  it('vigente: número da vigente e rótulo VIGENTE', () => {
    const s = montarSelo([1, 2, 3], 'p', null)
    assert.equal(s.numero, 'v3')
    assert.equal(s.rotulo, 'VIGENTE')
    assert.equal(s.descricao, 'Selo da diretriz: 3 versões, a vigente é a 3')
  })
  it('vendo uma antiga: foco nos anéis dela, número e rótulo ANTIGA', () => {
    const s = montarSelo([1, 2, 3], 'p', 2)
    assert.deepEqual(s.aneis.map(a => a.foco), [false, false, true, true, false, false])
    assert.equal(s.numero, 'v2')
    assert.equal(s.rotulo, 'ANTIGA')
  })
  it('vendo a própria vigente, o rótulo segue VIGENTE', () => assert.equal(montarSelo([1, 2], 'p', 2).rotulo, 'VIGENTE'))
  it('uma versão só: singular', () => assert.equal(montarSelo([1], 'p', null).descricao, 'Selo da diretriz: 1 versão, a vigente é a 1'))
  it('sem versões, sem anéis', () => {
    const s = montarSelo([], 'p', null)
    assert.equal(s.aneis.length, 0)
    assert.equal(s.numero, 'v0')
  })
})
