import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PASSO_DO_VER_MAIS, TOTAL_INICIAL, agruparPorDia, rotuloDoDia, rotuloDoVerMais } from '../src/checkpoints/agrupar.ts'
import type { Checkpoint } from '../shared/types.ts'

const cp = (revision: number, createdAt: string) => ({ id: `cp${revision}`, revision, createdAt }) as Checkpoint

describe('agruparPorDia', () => {
  it('agrupa por dia no fuso do dono, mantendo a ordem recebida (mais novo primeiro)', () => {
    const lista = [
      cp(5, '2026-11-22T15:00:00Z'),
      cp(4, '2026-11-22T12:00:00Z'),
      cp(3, '2026-11-21T20:00:00Z'),
      cp(2, '2026-11-20T10:00:00Z'),
    ]
    const { grupos } = agruparPorDia(lista, 10)
    assert.deepEqual(grupos.map(g => [g.dia, g.itens.map(i => i.revision)]), [
      ['2026-11-22', [5, 4]],
      ['2026-11-21', [3]],
      ['2026-11-20', [2]],
    ])
  })
  it('meia-noite UTC ainda é o dia anterior em São Paulo', () => {
    const { grupos } = agruparPorDia([cp(2, '2026-11-22T01:30:00Z'), cp(1, '2026-11-21T23:00:00Z')], 10)
    assert.deepEqual(grupos.map(g => g.dia), ['2026-11-21'])
  })
  it('corta no limite e diz quantos faltam, sem quebrar o resto dos grupos', () => {
    const lista = [cp(4, '2026-11-22T12:00:00Z'), cp(3, '2026-11-22T11:00:00Z'), cp(2, '2026-11-21T11:00:00Z'), cp(1, '2026-11-20T11:00:00Z')]
    const r = agruparPorDia(lista, 3)
    assert.equal(r.mostrados, 3)
    assert.equal(r.restantes, 1)
    assert.deepEqual(r.grupos.map(g => g.itens.length), [2, 1])
  })
  it('limite maior que a lista mostra tudo', () => {
    const r = agruparPorDia([cp(1, '2026-11-20T11:00:00Z')], 10)
    assert.deepEqual([r.mostrados, r.restantes], [1, 0])
  })
  it('data ilegível vai para um grupo próprio, sem dia', () => {
    const { grupos } = agruparPorDia([cp(2, 'não é data'), cp(1, '2026-11-20T11:00:00Z')], 10)
    assert.deepEqual(grupos.map(g => g.dia), ['', '2026-11-20'])
  })
  it('lista vazia', () => {
    assert.deepEqual(agruparPorDia([], 10), { grupos: [], mostrados: 0, restantes: 0 })
  })
  it('limite zero ou negativo não mostra nada e conta tudo como restante', () => {
    const r = agruparPorDia([cp(1, '2026-11-20T11:00:00Z')], 0)
    assert.deepEqual([r.grupos.length, r.mostrados, r.restantes], [0, 0, 1])
  })
  it('começa com 10 e cada "Ver mais" soma 10', () => {
    assert.equal(TOTAL_INICIAL, 10)
    assert.equal(PASSO_DO_VER_MAIS, 10)
  })
})

describe('rotuloDoDia', () => {
  it('hoje e ontem levam o nome; os outros, só a data', () => {
    assert.equal(rotuloDoDia('2026-11-22', '2026-11-22'), 'Hoje, 22 nov')
    assert.equal(rotuloDoDia('2026-11-21', '2026-11-22'), 'Ontem, 21 nov')
    assert.equal(rotuloDoDia('2026-11-20', '2026-11-22'), '20 nov')
    assert.equal(rotuloDoDia('2026-12-02', '2026-11-22'), '2 dez')
  })
  it('sem dia', () => {
    assert.equal(rotuloDoDia('', '2026-11-22'), 'Sem data')
  })
})

describe('rotuloDoVerMais', () => {
  it('mostra o passo quando faltam mais que ele, ou só o que falta', () => {
    assert.equal(rotuloDoVerMais(51), 'Ver mais 10 (faltam 51)')
    assert.equal(rotuloDoVerMais(10), 'Ver mais 10 (faltam 10)')
    assert.equal(rotuloDoVerMais(3), 'Ver mais 3 (faltam 3)')
    assert.equal(rotuloDoVerMais(1), 'Ver o último (falta 1)')
  })
})
