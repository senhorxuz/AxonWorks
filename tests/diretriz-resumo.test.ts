import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resumoDaDiretriz } from '../src/diretriz/resumo.ts'

const humana = { revision: 3, createdBy: 'Dono', createdAt: '2026-10-25T15:00:00.000Z', sourceKind: 'human_directive' as const, body: 'OBJETIVO\nVender livros usados. Entregar em dois dias.\n\nRISCOS\nEstoque pequeno.' }
const ia = { ...humana, revision: 4, createdBy: 'Claude', sourceKind: 'agent_update' as const, motivo: 'mudou.' }

describe('resumoDaDiretriz', () => {
  it('sem diretriz, avisa que ainda não há', () => {
    assert.deepEqual(resumoDaDiretriz(null, 'Loja'), { frase: 'Nenhuma diretriz definida ainda.', versao: '', pendente: false, aviso: '' })
  })
  it('mostra só a primeira frase do objetivo e a versão vigente com a data', () => {
    assert.deepEqual(resumoDaDiretriz(humana, 'Loja'), { frase: 'Vender livros usados.', versao: 'Versão 3 · vigente desde 25 de out. de 2026', pendente: false, aviso: '' })
  })
  it('texto sem seção de objetivo: usa a primeira seção', () => {
    const r = resumoDaDiretriz({ ...humana, body: 'RISCOS\nEstoque pequeno. Atraso.' }, 'Loja')
    assert.equal(r.frase, 'Estoque pequeno.')
  })
  it('texto corrido, sem títulos, também vira a primeira frase', () => {
    assert.equal(resumoDaDiretriz({ ...humana, body: 'Um texto corrido. Segunda frase.' }, 'Loja').frase, 'Um texto corrido.')
  })
  it('diretriz vazia cai na frase de ausência de objetivo', () => {
    assert.equal(resumoDaDiretriz({ ...humana, body: '   ' }, 'Loja').frase, 'A diretriz está em branco.')
  })
  it('objetivo com título e sem texto também cai na frase de ausência', () => {
    assert.equal(resumoDaDiretriz({ ...humana, body: 'OBJETIVO' }, 'Loja').frase, 'A diretriz está em branco.')
  })
  it('atualização de IA não conferida pede conferência', () => {
    const r = resumoDaDiretriz(ia, 'Loja')
    assert.equal(r.pendente, true)
    assert.equal(r.aviso, 'Uma IA atualizou: confira')
  })
  it('atualização de IA já conferida não pede nada', () => {
    const r = resumoDaDiretriz({ ...ia, vistoPeloDonoEm: '2026-11-06T10:00:00Z' }, 'Loja')
    assert.deepEqual([r.pendente, r.aviso], [false, ''])
  })
})
