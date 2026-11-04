import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resumoDaBiblioteca, type DocumentoDoHeroi } from '../src/biblioteca/heroi.ts'

// O hero da Biblioteca diz o que importa: quantos documentos, de quais tipos, e o último guardado.

const ROTULOS = { specification: 'Especificação', research: 'Pesquisa', reference: 'Referência', note: 'Nota', artifact: 'Artefato' }
const AGORA = Date.parse('2026-10-31T12:00:00Z')
const doc = (id: string, tipo: string, horasAtras: number): DocumentoDoHeroi => ({ id, titulo: `Doc ${id}`, tipo, quando: new Date(AGORA - horasAtras * 3_600_000).toISOString() })

describe('hero da Biblioteca: resumo', () => {
  it('quantos documentos, os tipos do mais comum ao menos comum, e o último guardado', () => {
    const r = resumoDaBiblioteca([doc('a', 'reference', 30), doc('b', 'specification', 2), doc('c', 'reference', 50), doc('d', 'research', 5)], ROTULOS, AGORA)
    assert.equal(r.frase, '4 documentos')
    assert.deepEqual(r.tipos, [
      { tipo: 'reference', rotulo: 'Referência', quantidade: 2 },
      // Empate na quantidade: ordem alfabética do nome.
      { tipo: 'specification', rotulo: 'Especificação', quantidade: 1 },
      { tipo: 'research', rotulo: 'Pesquisa', quantidade: 1 },
    ])
    assert.deepEqual(r.ultimo, { id: 'b', titulo: 'Doc b', haQuanto: 'há 2 h' })
  })

  it('singular, e tipo sem rótulo conhecido aparece pelo nome que veio', () => {
    const r = resumoDaBiblioteca([doc('a', 'outro', 1)], ROTULOS, AGORA)
    assert.equal(r.frase, '1 documento')
    assert.deepEqual(r.tipos, [{ tipo: 'outro', rotulo: 'outro', quantidade: 1 }])
  })

  it('data que não se lê não ganha de uma data de verdade para ser o último', () => {
    const r = resumoDaBiblioteca([{ id: 'x', titulo: 'Sem data', tipo: 'note', quando: 'ontem' }, doc('y', 'note', 3)], ROTULOS, AGORA)
    assert.equal(r.ultimo!.id, 'y')
  })

  it('biblioteca vazia: frase própria e nenhum último', () => {
    const r = resumoDaBiblioteca([], ROTULOS, AGORA)
    assert.equal(r.frase, 'Nenhum documento ainda')
    assert.deepEqual(r.tipos, [])
    assert.equal(r.ultimo, null)
  })
})
