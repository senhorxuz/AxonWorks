import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CHAVE_DOS_FAVORITOS, alternarFavorito, lerFavoritos, ordenarProjetos } from '../src/projetos/ordem.ts'

const p = (id: string, name: string, updatedAt: string) => ({ id, name, updatedAt })
const a = p('a', 'Zeta', '2026-11-01T10:00:00Z')
const b = p('b', 'Alfa', '2026-11-03T10:00:00Z')
const c = p('c', 'Meio', '2026-11-02T10:00:00Z')

describe('ordenarProjetos', () => {
  it('recentes: o atualizado por último vem primeiro', () => {
    assert.deepEqual(ordenarProjetos([a, b, c], [], 'recent').map(x => x.id), ['b', 'c', 'a'])
  })
  it('favoritos vêm antes, e entre eles vale o critério', () => {
    assert.deepEqual(ordenarProjetos([a, b, c], ['a', 'c'], 'recent').map(x => x.id), ['c', 'a', 'b'])
  })
  it('por nome, em ordem alfabética do português, com favoritos primeiro', () => {
    assert.deepEqual(ordenarProjetos([a, b, c], [], 'name').map(x => x.id), ['b', 'c', 'a'])
    assert.deepEqual(ordenarProjetos([a, b, c], ['a'], 'name').map(x => x.id), ['a', 'b', 'c'])
  })
  it('não mexe na lista de origem', () => {
    const origem = [a, b, c]
    ordenarProjetos(origem, [], 'recent')
    assert.deepEqual(origem.map(x => x.id), ['a', 'b', 'c'])
  })
})

describe('lerFavoritos', () => {
  const com = (valor: string | null) => ({ getItem: (chave: string) => (chave === CHAVE_DOS_FAVORITOS ? valor : null) })
  it('lê a lista guardada, ignorando o que não é texto', () => assert.deepEqual(lerFavoritos(com('["a",1,"b"]')), ['a', 'b']))
  it('sem nada guardado, lista vazia', () => assert.deepEqual(lerFavoritos(com(null)), []))
  it('valor que não é lista, vazio', () => assert.deepEqual(lerFavoritos(com('{"a":1}')), []))
  it('JSON quebrado, vazio', () => assert.deepEqual(lerFavoritos(com('{')), []))
  it('sem armazenamento, vazio', () => assert.deepEqual(lerFavoritos(undefined), []))
  it('armazenamento que lança erro, vazio', () => assert.deepEqual(lerFavoritos({ getItem: () => { throw new Error('bloqueado') } }), []))
})

describe('alternarFavorito', () => {
  it('põe quem não estava', () => assert.deepEqual(alternarFavorito(['a'], 'b'), ['a', 'b']))
  it('tira quem estava', () => assert.deepEqual(alternarFavorito(['a', 'b'], 'a'), ['b']))
})
