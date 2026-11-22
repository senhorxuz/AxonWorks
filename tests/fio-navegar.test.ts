import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { vizinho } from '../src/fio/navegar.ts'
import type { Casa } from '../src/fio/tecer.ts'
import type { CoisaNoTrilho } from '../src/fio/trilhos.ts'

const coisa = (trilho: number): CoisaNoTrilho => ({ chave: `registro:${trilho}`, quando: '2026-11-01T12:00:00Z', tipo: 'registro', texto: 'x', dia: '2026-11-01', trilho })
const simbolo = (col: number, trilho: number): Casa => ({ col, linha: trilho * 2, ch: '○', classe: 'registro', trilho, coisa: coisa(trilho) })
const fiacao = (col: number, trilho = 0): Casa => ({ col, linha: trilho * 2, ch: '─', classe: 'fiacao', trilho })

// índice: 0 fio · 1 A(col 2, trilho 0) · 2 fio · 3 B(4, t1) · 4 C(5, t1) · 5 D(8, t0) · 6 E(10, t2)
const casas: Casa[] = [fiacao(0), simbolo(2, 0), fiacao(3), simbolo(4, 1), simbolo(5, 1), simbolo(8, 0), simbolo(10, 2)]

describe('vizinho: teclado do fio', () => {
  it('direita e esquerda andam em ordem de tempo, pulando as casas sem coisa', () => {
    assert.equal(vizinho(casas, 1, 'ArrowRight'), 3)
    assert.equal(vizinho(casas, 3, 'ArrowRight'), 4)
    assert.equal(vizinho(casas, 3, 'ArrowLeft'), 1)
    assert.equal(vizinho(casas, 5, 'ArrowLeft'), 4)
  })

  it('nas pontas, fica onde está', () => {
    assert.equal(vizinho(casas, 1, 'ArrowLeft'), 1)
    assert.equal(vizinho(casas, 6, 'ArrowRight'), 6)
  })

  it('Home vai ao primeiro símbolo e End ao último', () => {
    assert.equal(vizinho(casas, 4, 'Home'), 1)
    assert.equal(vizinho(casas, 4, 'End'), 6)
  })

  it('a ordem é a do tempo (a coluna), mesmo se as casas vierem embaralhadas', () => {
    const embaralhadas = [simbolo(8, 0), simbolo(2, 0), simbolo(5, 1)]
    assert.equal(vizinho(embaralhadas, 1, 'ArrowRight'), 2)
    assert.equal(vizinho(embaralhadas, 2, 'ArrowRight'), 0)
    assert.equal(vizinho(embaralhadas, 0, 'Home'), 1)
    assert.equal(vizinho(embaralhadas, 1, 'End'), 0)
  })

  it('baixo vai ao símbolo de coluna mais próxima no trilho de baixo', () => {
    assert.equal(vizinho(casas, 1, 'ArrowDown'), 3, 'de A (col 2): B está a 2, C a 3')
    assert.equal(vizinho(casas, 5, 'ArrowDown'), 4, 'de D (col 8): C está a 3, B a 4')
    assert.equal(vizinho(casas, 4, 'ArrowDown'), 6)
  })

  it('cima vai ao símbolo de coluna mais próxima no trilho de cima', () => {
    assert.equal(vizinho(casas, 3, 'ArrowUp'), 1, 'de B (col 4): A está a 2, D a 4')
    assert.equal(vizinho(casas, 4, 'ArrowUp'), 1, 'de C (col 5): A está a 3, D a 3: empate, fica o mais antigo')
    assert.equal(vizinho(casas, 6, 'ArrowUp'), 4, 'de E (trilho 2) para o trilho 1: C está mais perto')
  })

  it('sem trilho para aquele lado, fica onde está', () => {
    assert.equal(vizinho(casas, 1, 'ArrowUp'), 1)
    assert.equal(vizinho(casas, 6, 'ArrowDown'), 6)
  })

  it('trilho vizinho sem símbolo: procura o próximo que tenha', () => {
    const sem = [simbolo(2, 0), simbolo(6, 2)]
    assert.equal(vizinho(sem, 0, 'ArrowDown'), 1)
    assert.equal(vizinho(sem, 1, 'ArrowUp'), 0)
  })

  it('casa que não é um símbolo (ou lista sem símbolos): não se mexe', () => {
    assert.equal(vizinho(casas, 0, 'ArrowRight'), 0)
    assert.equal(vizinho([fiacao(0)], 0, 'End'), 0)
    assert.equal(vizinho([], 0, 'Home'), 0)
  })
})
