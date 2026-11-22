import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filtrarLicoes, rotuloDaContagem } from '../src/regras/busca.ts'
import type { Licao } from '../shared/licoes.ts'

const licao = (id: string, texto: string, linhaCurta: string | null = null) => ({ id, texto, linhaCurta }) as Licao

const lista = [
  licao('1', 'Nunca apagar o banco real durante teste', 'Banco real intocável'),
  licao('2', 'Conferir a conexão antes de subir'),
  licao('3', 'Ação do usuário precisa de confirmação', null),
]

describe('filtrarLicoes', () => {
  it('sem busca, devolve tudo', () => {
    assert.equal(filtrarLicoes(lista, '').length, 3)
    assert.equal(filtrarLicoes(lista, '   ').length, 3)
  })
  it('acha no texto, ignorando maiúsculas e acentos', () => {
    assert.deepEqual(filtrarLicoes(lista, 'ACAO').map(l => l.id), ['3'])
    assert.deepEqual(filtrarLicoes(lista, 'conexao').map(l => l.id), ['2'])
  })
  it('acha na linha curta também', () => {
    assert.deepEqual(filtrarLicoes(lista, 'intocável').map(l => l.id), ['1'])
  })
  it('várias palavras: todas precisam aparecer, em qualquer ordem', () => {
    assert.deepEqual(filtrarLicoes(lista, 'subir conferir').map(l => l.id), ['2'])
    assert.deepEqual(filtrarLicoes(lista, 'subir banco').map(l => l.id), [])
  })
  it('sem resultado devolve lista vazia', () => {
    assert.deepEqual(filtrarLicoes(lista, 'zzz'), [])
  })
})

describe('rotuloDaContagem', () => {
  it('sem busca, só o total', () => {
    assert.equal(rotuloDaContagem(40, 40, false), '40')
  })
  it('com busca, quantos de quantos', () => {
    assert.equal(rotuloDaContagem(3, 40, true), '3 de 40')
  })
})

describe('filtrarLicoes: casos que o filtro não pode errar', () => {
  it('a busca casa palavras inteiras do texto, não letras soltas: "ab" não acha "ba"', () => {
    assert.deepEqual(filtrarLicoes([licao('1', 'ba')], 'ab'), [])
    assert.deepEqual(filtrarLicoes([licao('1', 'ab')], 'ab').map(l => l.id), ['1'])
  })
  it('espaços repetidos e nas pontas não mudam nada', () => {
    assert.deepEqual(filtrarLicoes(lista, '  subir \t  conferir  ').map(l => l.id), ['2'])
  })
  it('sem linha curta, nada é acrescentado ao texto da lição', () => {
    assert.deepEqual(filtrarLicoes([licao('1', 'abc')], 'was here'), [])
    assert.deepEqual(filtrarLicoes([licao('1', 'abc')], 'undefined'), [])
    assert.deepEqual(filtrarLicoes([licao('1', 'abc')], 'null'), [])
  })
  it('só tira acento e maiúscula: "ß" não vira "ss"', () => {
    assert.deepEqual(filtrarLicoes([licao('1', 'Straße')], 'strasse'), [])
    assert.deepEqual(filtrarLicoes([licao('1', 'Straße')], 'STRAßE').map(l => l.id), ['1'])
  })
  it('sem busca devolve uma cópia da lista, na mesma ordem', () => {
    const copia = filtrarLicoes(lista, '')
    assert.deepEqual(copia, lista)
    assert.notEqual(copia, lista)
  })
})
