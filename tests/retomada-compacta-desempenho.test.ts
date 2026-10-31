import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Carta, ItemFalta } from '../shared/carta.ts'
import { renderizarRetomadaCompacta } from '../server/carta/retomada-compacta.ts'

/**
 * Desempenho da retomada compacta, num arquivo à parte: a mutação (Stryker) instrumenta o código e o
 * deixa várias vezes mais lento, então este teste não entra na fatia de mutação, só no `npm test`.
 * O comportamento é conferido em `retomada-compacta.test.ts`.
 */

const DETALHE = 'Detalhe registrado pela IA com o contexto do que falta e por quê. '.repeat(3).trim()

function itens(prefixo: string, n: number, detalhe: string | null): ItemFalta[] {
  return Array.from({ length: n }, (_, i) => {
    const titulo = `${prefixo}${i} Ajustar o fluxo de pedidos da loja para o cliente que volta`.padEnd(80, '.')
    return { origem: 'cartao', id: `${prefixo}${i}`, titulo, detalhe, etapa: 'Pendente', versao: 1 }
  })
}

function cartaCom(total: number): Carta {
  const quinto = Math.floor(total / 5)
  return {
    projeto: { id: 'alfa', nome: 'Alfa', objetivo: '' },
    ultimaAtividade: '2026-10-20T10:00:00.000Z',
    diasParado: 5,
    emUmaFrase: null,
    feitoRecente: [],
    feitoPorMes: [],
    falta: {
      precisa_de_voce: itens('P', quinto, DETALHE),
      travado: itens('T', quinto, DETALHE),
      em_andamento: itens('A', quinto, DETALHE),
      a_fazer: itens('F', quinto, null),
      ideias: itens('I', total - 4 * quinto, null),
    },
    rascunhoAutomatico: { resumo: 'Resumo da compactação. '.repeat(340).trim(), atualizadoEm: 'ontem' },
    salvamentos: [],
    ultimoRegistroEhSalvamento: false,
    proximoPronto: [],
    avisos: [],
    avisosDaRetomada: [],
    saude: { ultimoRegistroAutomatico: null, ultimoErro: null },
  }
}

const EXTRAS = {
  decisoesVigentes: [],
  bloqueiosAbertos: [],
  mensagensNaoLidas: [{ de: 'Grok', texto: 'Revisei o checkout.' }],
  tarefasDoClaude: [],
  evidenciasDesatualizadas: 0,
  posCompactacao: true,
}

describe('retomada compacta: desempenho', () => {
  it('montagem linear: 9.000 itens em menos de 300 ms e 40.000 em menos de 1 s', () => {
    // Medido em 25/10/2026 nesta máquina: ~65 ms e ~250 ms (antes, remontando o texto a cada item:
    // 3 s para 9.000). Os tetos dão quatro vezes de folga para a máquina ocupada não derrubar o teste.
    for (const [total, tetoMs] of [
      [9_000, 300],
      [40_000, 1_000],
    ]) {
      const carta = cartaCom(total)
      const inicio = performance.now()
      const texto = renderizarRetomadaCompacta(carta, EXTRAS)
      const ms = performance.now() - inicio
      assert.ok(texto.length <= 10_000, `${total} itens: ${texto.length} caracteres`)
      assert.ok(texto.split('\n').at(-1)?.startsWith('Não coube neste texto: mais '), `${total} itens: rodapé`)
      assert.ok(ms < tetoMs, `${total} itens levaram ${ms.toFixed(0)} ms (teto ${tetoMs} ms)`)
    }
  })
})
