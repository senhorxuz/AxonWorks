import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { acharProjetoPorPasta, normalizarPasta } from '../server/ganchos/achar-projeto.ts'
import type { Project } from '../shared/types.ts'

/** Review Focus 1: a pasta da sessão escrita de outro jeito ainda acha o projeto; pasta irmã não. */

function projeto(id: string, workspacePath: string): Project {
  return { id, name: id, objective: 'o', workspacePath, createdAt: '', updatedAt: '', revision: 0 }
}

const ALFA = projeto('alfa', 'D:\\Projetos\\projeto-exemplo')

describe('normalizarPasta', () => {
  it('minúsculas, barra normal, sem barra final, sem espaço nas pontas', () => {
    assert.equal(normalizarPasta('  D:\\Projetos\\Projeto-Exemplo\\  '), 'd:/projetos/projeto-exemplo')
    assert.equal(normalizarPasta('D:/Projetos/projeto-exemplo/'), 'd:/projetos/projeto-exemplo')
    assert.equal(normalizarPasta('/home/axon/Projeto'), '/home/axon/projeto')
  })

  it('barras repetidas viram uma só; pasta que é só barra vira vazio', () => {
    assert.equal(normalizarPasta('D:\\\\Projetos//projeto-exemplo'), 'd:/projetos/projeto-exemplo')
    assert.equal(normalizarPasta('/'), '')
    assert.equal(normalizarPasta('\\\\'), '')
    assert.equal(normalizarPasta(''), '')
  })
})

describe('acharProjetoPorPasta', () => {
  it('as três grafias da mesma pasta casam', () => {
    for (const pasta of ['d:\\Projetos\\projeto-exemplo', 'D:/Projetos/projeto-exemplo/', 'D:\\PROJETOS\\projeto-exemplo\\']) {
      assert.equal(acharProjetoPorPasta([ALFA], pasta)?.id, 'alfa', pasta)
    }
  })

  it('subpasta casa', () => {
    assert.equal(acharProjetoPorPasta([ALFA], 'D:\\Projetos\\projeto-exemplo\\web')?.id, 'alfa')
    assert.equal(acharProjetoPorPasta([ALFA], 'd:/projetos/projeto-exemplo/web/src/x')?.id, 'alfa')
  })

  it('pasta irmã com o mesmo começo não casa, nem a pasta de cima', () => {
    assert.equal(acharProjetoPorPasta([ALFA], 'D:\\Projetos\\projeto-exemplo-old'), null)
    assert.equal(acharProjetoPorPasta([ALFA], 'D:\\Projetos\\projeto-exempl'), null)
    assert.equal(acharProjetoPorPasta([ALFA], 'D:\\Projetos'), null)
  })

  it('duas candidatas: vence a mais específica, em qualquer ordem', () => {
    const web = projeto('web', 'd:/projetos/projeto-exemplo/web')
    const pasta = 'D:\\Projetos\\projeto-exemplo\\web\\src'
    assert.equal(acharProjetoPorPasta([ALFA, web], pasta)?.id, 'web')
    assert.equal(acharProjetoPorPasta([web, ALFA], pasta)?.id, 'web')
    assert.equal(acharProjetoPorPasta([web, ALFA], 'D:\\Projetos\\projeto-exemplo\\api')?.id, 'alfa')
  })

  it('mesma pasta em dois projetos: fica o primeiro da lista', () => {
    const copia = projeto('copia', 'd:/projetos/projeto-exemplo')
    assert.equal(acharProjetoPorPasta([ALFA, copia], 'D:\\Projetos\\projeto-exemplo')?.id, 'alfa')
  })

  it('workspacePath vazio (ou só barra) nunca casa', () => {
    const vazio = projeto('vazio', '')
    const barra = projeto('barra', '/')
    assert.equal(acharProjetoPorPasta([vazio, barra], 'D:\\Projetos\\projeto-exemplo'), null)
    assert.equal(acharProjetoPorPasta([vazio, barra], '/home/axon'), null)
    assert.equal(acharProjetoPorPasta([vazio], ''), null)
  })

  it('pasta da sessão vazia não casa com nada; lista vazia devolve null', () => {
    assert.equal(acharProjetoPorPasta([ALFA], ''), null)
    assert.equal(acharProjetoPorPasta([], 'D:\\Projetos\\projeto-exemplo'), null)
  })
})
