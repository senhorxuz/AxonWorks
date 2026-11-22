import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aleatorioDe } from '../src/aleatorio.ts'

describe('aleatorioDe: gerador determinístico por semente', () => {
  it('a mesma semente sempre devolve a mesma sequência', () => {
    const a = aleatorioDe('axon')
    const b = aleatorioDe('axon')
    assert.deepEqual([a(), a(), a()], [b(), b(), b()])
  })

  it('sementes diferentes dão sequências diferentes', () => {
    assert.notEqual(aleatorioDe('axon')(), aleatorioDe('nata')())
  })

  it('devolve números em [0, 1) e valores conhecidos (fixa o algoritmo)', () => {
    const sorte = aleatorioDe('axon')
    const vistos = Array.from({ length: 200 }, () => sorte())
    assert.ok(vistos.every(v => v >= 0 && v < 1))
    assert.equal(new Set(vistos).size, 200)
    assert.equal(aleatorioDe('')(), aleatorioDe('')())
    assert.equal(aleatorioDe('axon')(), 0.5771827753633261)
  })

})
