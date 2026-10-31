process.env.TZ = 'America/Sao_Paulo'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SalvamentoResumo } from '../shared/carta.ts'
import { fraseDoSalvamento, horaDoSalvamento, listasDoSalvamento, rotuloDoSalvamento } from '../src/onde-paramos/salvamentos.ts'

/** Helpers puros da seção "Salvamentos de compactação" da tela "Onde paramos" (D5). Fuso fixo do dono. */

function salvamento(over: Partial<SalvamentoResumo> = {}): SalvamentoResumo {
  return {
    id: 's1',
    criadoEm: '2026-10-25T17:05:00.000Z',
    humanSummary: 'O login novo está pronto; falta o cadastro.',
    resumo: 'Login refeito com sessão no servidor.',
    pedidosDoDono: [],
    pendencias: [],
    perguntasAbertas: [],
    arquivosMexidos: [],
    proximoPasso: 'Fazer o cadastro.',
    ...over,
  }
}

describe('horaDoSalvamento', () => {
  it('dia, mês e hora no horário de quem lê, com zero à esquerda', () => {
    assert.equal(horaDoSalvamento('2026-10-25T17:05:00.000Z'), '25/10 às 14:05')
    assert.equal(horaDoSalvamento('2026-03-05T12:09:00.000Z'), '05/03 às 09:09')
  })
})

describe('rotuloDoSalvamento', () => {
  it('quando foi salvo e a frase para o dono', () => {
    assert.equal(rotuloDoSalvamento(salvamento()), '25/10 às 14:05 · O login novo está pronto; falta o cadastro.')
  })

  it('sem frase para o dono (dado importado): "Salvamento de" e a data, nunca o resumo técnico', () => {
    assert.equal(rotuloDoSalvamento(salvamento({ humanSummary: null })), 'Salvamento de 25/10 às 14:05')
    assert.equal(rotuloDoSalvamento(salvamento({ humanSummary: null, resumo: 'a'.repeat(200) })), 'Salvamento de 25/10 às 14:05')
    assert.equal(rotuloDoSalvamento(salvamento({ humanSummary: '' })), 'Salvamento de 25/10 às 14:05')
  })
})

describe('fraseDoSalvamento', () => {
  it('o texto principal é a frase para o dono', () => {
    assert.equal(fraseDoSalvamento(salvamento()), 'O login novo está pronto; falta o cadastro.')
  })

  it('sem frase para o dono: diz que não há e aponta os detalhes técnicos, sem mostrar o resumo técnico', () => {
    assert.equal(
      fraseDoSalvamento(salvamento({ humanSummary: null })),
      'Este salvamento não tem um resumo escrito para você. O estado completo está em “Detalhes técnicos”.',
    )
    assert.equal(fraseDoSalvamento(salvamento({ humanSummary: '' })), fraseDoSalvamento(salvamento({ humanSummary: null })))
  })
})

describe('listasDoSalvamento', () => {
  it('só as listas do dono com algo, na ordem de leitura dele; arquivos mexidos ficam nos detalhes técnicos', () => {
    const s = salvamento({
      pedidosDoDono: ['Arruma o login'],
      pendencias: ['Tela de cadastro', 'Testes'],
      perguntasAbertas: ['Qual banco?'],
      arquivosMexidos: ['src/login.ts'],
    })
    assert.deepEqual(listasDoSalvamento(s), [
      { titulo: 'Pedidos do dono', itens: ['Arruma o login'] },
      { titulo: 'Pendências', itens: ['Tela de cadastro', 'Testes'] },
      { titulo: 'Perguntas abertas', itens: ['Qual banco?'] },
    ])
  })

  it('lista vazia não aparece', () => {
    assert.deepEqual(listasDoSalvamento(salvamento({ pendencias: ['Testes'] })), [{ titulo: 'Pendências', itens: ['Testes'] }])
    assert.deepEqual(listasDoSalvamento(salvamento()), [])
    assert.deepEqual(listasDoSalvamento(salvamento({ arquivosMexidos: ['src/login.ts'] })), [])
  })
})
