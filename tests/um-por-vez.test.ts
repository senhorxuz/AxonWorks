import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FORMULARIO_DO_BLOQUEIO, alternarAberto, chaveDosDetalhes, destinoDoAberto } from '../src/painel/um-por-vez.ts'

describe('alternarAberto', () => {
  it('abre o pedido quando nada está aberto', () => assert.equal(alternarAberto(null, 'bloqueio'), 'bloqueio'))
  it('fecha o que já estava aberto ao pedir o mesmo', () => assert.equal(alternarAberto('bloqueio', 'bloqueio'), null))
  it('abrir outro fecha o primeiro: só um fica aberto', () => assert.equal(alternarAberto('bloqueio', 'detalhes:t1'), 'detalhes:t1'))
})

describe('destinoDoAberto', () => {
  it('o formulário de bloqueio leva o foco ao primeiro campo', () => {
    assert.deepEqual(destinoDoAberto(FORMULARIO_DO_BLOQUEIO), { chave: 'aberto:bloqueio', foco: 'input, textarea' })
  })
  it('os detalhes de uma tarefa acendem o cartão da própria tarefa', () => {
    assert.deepEqual(destinoDoAberto(chaveDosDetalhes('t1')), { chave: 'tarefa:t1' })
  })
  it('chave desconhecida não leva a lugar nenhum', () => assert.equal(destinoDoAberto('outra'), null))
})

describe('chaveDosDetalhes', () => {
  it('prefixa o id da tarefa', () => assert.equal(chaveDosDetalhes('t1'), 'detalhes:t1'))
})
