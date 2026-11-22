import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { contarLista, contarOrientacoes, dicaDaConfirmacao, linhasDoRemovido, ROTULOS_DO_REMOVIDO, type ContagemDoProjeto } from '../src/apagar/removido.ts'

const cheia: ContagemDoProjeto = {
  tarefas: 3, checkpoints: 12, mensagens: 0, backlog: 4, cartoes: 9, documentos: 2, decisoes: 5, bloqueios: 1, orientacoes: 7, versoesDaDiretriz: 2,
  propostas: 6, passagens: 1, rascunhos: 0,
}

describe('linhasDoRemovido', () => {
  it('lista tudo o que a exclusão apaga, na ordem de leitura, com o número de cada um', () => {
    assert.deepEqual(linhasDoRemovido(cheia).map(l => [l.rotulo, l.valor]), [
      ['Tarefas', '3'], ['Checkpoints', '12'], ['Mensagens', '0'], ['Itens de backlog', '4'], ['Cartões do Quadro', '9'],
      ['Documentos da Biblioteca', '2'], ['Decisões', '5'], ['Bloqueios', '1'], ['Regras, verificações e erros', '7'], ['Versões da diretriz', '2'],
      ['Propostas de aprovação', '6'], ['Passagens entre IAs', '1'], ['Rascunhos de trabalho', '0'],
    ])
  })
  it('o que não deu para contar aparece como traço, sem inventar zero', () => {
    const linha = linhasDoRemovido({ ...cheia, cartoes: null }).find(l => l.chave === 'cartoes')
    assert.deepEqual([linha?.valor, linha?.incerto], ['–', true])
    assert.equal(linhasDoRemovido(cheia).some(l => l.incerto), false)
  })
  it('cada chave da contagem tem rótulo', () => {
    assert.deepEqual(Object.keys(ROTULOS_DO_REMOVIDO).sort(), Object.keys(cheia).sort())
  })
})

describe('contarLista', () => {
  it('conta lista; o resto vira "não contado"', () => {
    assert.equal(contarLista([1, 2]), 2)
    assert.equal(contarLista([]), 0)
    assert.equal(contarLista(undefined), null)
    assert.equal(contarLista({ cards: [] }), null)
  })
})

describe('contarOrientacoes', () => {
  it('conta só as do projeto; as globais ficam e não entram', () => {
    assert.equal(contarOrientacoes([{ projectId: 'p' }, { projectId: null }, { projectId: 'q' }, { projectId: 'p' }], 'p'), 2)
    assert.equal(contarOrientacoes([{ projectId: 'p' }, { projectId: null }, { projectId: 'q' }, { projectId: 'r' }, { projectId: 's' }], 'p'), 1)
    assert.equal(contarOrientacoes([{ projectId: null }, { projectId: 'q' }], 'p'), 0)
  })
})

describe('dicaDaConfirmacao', () => {
  it('pede o nome sem preenchê-lo', () => assert.equal(dicaDaConfirmacao('Axon Works'), 'Digite: Axon Works'))
})
