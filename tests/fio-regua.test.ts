import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { quaisRotular, rotulosDaRegua } from '../src/fio/regua.ts'
import { tecer, type Desenho } from '../src/fio/tecer.ts'
import type { CoisaFeita } from '../src/fio/coisas.ts'

/** Só o que a régua lê: os dias com a coluna do primeiro símbolo e a casa do ◉. */
const desenho = (dias: [number, string][], fim: number): Desenho =>
  ({ dias: dias.map(([col, dia]) => ({ col, dia })), fim: { col: fim, linha: 0, trilho: 0 } }) as unknown as Desenho

describe('quaisRotular (copiado do fio antigo)', () => {
  it('o último sempre aparece; os outros só se ficarem longe o bastante do vizinho já escolhido', () => {
    assert.deepEqual(quaisRotular([0, 10, 12, 30, 31, 50], 8), [0, 2, 4, 5])
  })

  it('todos cabem quando estão espaçados', () => {
    assert.deepEqual(quaisRotular([0, 20, 40], 8), [0, 1, 2])
  })

  it('lista vazia ou de um só', () => {
    assert.deepEqual(quaisRotular([], 8), [])
    assert.deepEqual(quaisRotular([5], 8), [0])
  })

  it('o vizinho do último precisa de folga maior, os outros não', () => {
    assert.deepEqual(quaisRotular([22, 31, 40, 50], 8, 15), [0, 1, 3])
    assert.deepEqual(quaisRotular([35, 50], 8, 15), [0, 1])
  })
})

describe('rotulosDaRegua', () => {
  it('o dia do mês sob o primeiro símbolo de cada dia; o mês sob o primeiro dia rotulado de cada mês', () => {
    const r = rotulosDaRegua(desenho([[2, '2026-10-30'], [10, '2026-10-31'], [20, '2026-11-01'], [40, '2026-11-21']], 45))
    assert.deepEqual(r.filter(x => x.tipo === 'dia'), [
      { col: 2, texto: '30', tipo: 'dia' }, { col: 10, texto: '31', tipo: 'dia' }, { col: 20, texto: '1', tipo: 'dia' },
    ])
    assert.deepEqual(r.filter(x => x.tipo === 'mes'), [{ col: 2, texto: 'out', tipo: 'mes' }, { col: 20, texto: 'nov', tipo: 'mes' }])
  })

  it('o último dia vira "21 nov · onde paramos", terminando sob o ◉', () => {
    const r = rotulosDaRegua(desenho([[2, '2026-11-01'], [40, '2026-11-21']], 45))
    const agora = r.filter(x => x.tipo === 'agora')
    assert.deepEqual(agora, [{ col: 45 - '21 nov · onde paramos'.length + 1, texto: '21 nov · onde paramos', tipo: 'agora' }])
    assert.equal(agora[0]!.col + agora[0]!.texto.length - 1, 45)
    assert.ok(!r.some(x => x.tipo === 'dia' && x.col === 40), 'o rótulo do último dia é o "onde paramos"')
  })

  it('o dia sem zero à esquerda também no "onde paramos"', () => {
    const r = rotulosDaRegua(desenho([[30, '2026-11-05']], 60))
    assert.equal(r[0]!.texto, '5 nov · onde paramos')
  })

  it('o rótulo final nunca passa da borda esquerda: se não couber, encosta nela', () => {
    const r = rotulosDaRegua(desenho([[2, '2026-11-21']], 2))
    assert.deepEqual(r, [{ col: 0, texto: '21 nov · onde paramos', tipo: 'agora' }])
  })

  it('quem encavala some, de trás para a frente (o último sempre fica)', () => {
    const r = rotulosDaRegua(desenho([[0, '2026-11-01'], [1, '2026-11-02'], [2, '2026-11-03'], [3, '2026-11-04'], [4, '2026-11-05'], [60, '2026-11-21']], 70))
    // de trás para a frente: o dia 5 (col 4) fica; 4 e 3 colam nele e saem; o 2 (col 1) fica, a 3 casas; o 1 cola e sai
    assert.deepEqual(r.filter(x => x.tipo === 'dia').map(x => x.texto), ['2', '5'])
  })

  it('os dias debaixo do rótulo do "onde paramos" somem', () => {
    // o último dia está em 30 e o ◉ em 30: o rótulo ocupa as colunas 10 a 30
    const r = rotulosDaRegua(desenho([[0, '2026-11-01'], [7, '2026-11-02'], [9, '2026-11-03'], [12, '2026-11-04'], [30, '2026-11-21']], 30))
    assert.deepEqual(r.filter(x => x.tipo === 'dia').map(x => x.texto), ['1', '2'])
    assert.equal(r.find(x => x.tipo === 'agora')!.col, 10)
  })

  it('o mês vai para o primeiro dia que ficou rotulado, não para um que sumiu', () => {
    const r = rotulosDaRegua(desenho([[2, '2026-10-30'], [3, '2026-10-31'], [30, '2026-11-21']], 40))
    assert.deepEqual(r.filter(x => x.tipo === 'mes'), [{ col: 3, texto: 'out', tipo: 'mes' }])
  })

  it('o dia do "onde paramos" já traz o mês no texto: não ganha rótulo de mês', () => {
    const r = rotulosDaRegua(desenho([[2, '2026-10-30'], [40, '2026-11-21']], 45))
    assert.deepEqual(r.filter(x => x.tipo === 'mes').map(x => x.texto), ['out'])
  })

  it('janeiro leva o ano', () => {
    const r = rotulosDaRegua(desenho([[2, '2026-12-30'], [20, '2027-01-02'], [60, '2027-01-20']], 70))
    assert.deepEqual(r.filter(x => x.tipo === 'mes'), [{ col: 2, texto: 'dez', tipo: 'mes' }, { col: 20, texto: 'jan 27', tipo: 'mes' }])
  })

  it('meses que encavalam também somem de trás para a frente: o mês mais novo fica', () => {
    // "dez" (3 casas) em 5 e "jan 27" em 8: não cabem juntos
    const r = rotulosDaRegua(desenho([[5, '2026-12-31'], [8, '2027-01-01'], [40, '2027-01-02']], 50))
    assert.deepEqual(r.filter(x => x.tipo === 'mes'), [{ col: 8, texto: 'jan 27', tipo: 'mes' }])
  })

  it('meses que cabem ficam todos', () => {
    // "dez" ocupa 5 a 7; o espaço em 8; "jan 27" em 9
    const r = rotulosDaRegua(desenho([[5, '2026-12-31'], [9, '2027-01-01'], [40, '2027-01-02']], 50))
    assert.deepEqual(r.filter(x => x.tipo === 'mes').map(x => x.texto), ['dez', 'jan 27'])
  })

  it('sem dias, sem régua', () => {
    assert.deepEqual(rotulosDaRegua(desenho([], 0)), [])
  })

  it('com um desenho de verdade: um dia só, e vários', () => {
    const c = (dia: string): CoisaFeita => ({ chave: `registro:${dia}`, quando: `${dia}T12:00:00Z`, tipo: 'registro', texto: 'x', quem: 'Claude' })
    const um = rotulosDaRegua(tecer([c('2026-11-21')], 40)!)
    assert.deepEqual(um.map(x => x.tipo), ['agora'])
    const varios = rotulosDaRegua(tecer([c('2026-11-01'), c('2026-11-09'), c('2026-11-21')], 100)!)
    assert.deepEqual(varios.filter(x => x.tipo === 'dia').map(x => x.texto), ['1', '9'])
    assert.equal(varios.at(-1)!.tipo, 'mes')
  })
})
