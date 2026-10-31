import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  INTERVALO_DE_CONFERENCIA_MS,
  criarDesligamentoPorOciosidade,
  type Agendamento,
} from '../server/ocioso.ts'

/**
 * Desligamento por ociosidade: o servidor só serve para ver a tela, então quando ninguém a usa ele se desliga.
 * Aqui o relógio e o agendador são de mentira: o tempo só anda quando o teste manda, sem esperar de verdade.
 */

const MINUTO = 60_000

interface Tarefa { fn: () => void; ms: number; cancelada: boolean }

/** Relógio e agendador controlados pelo teste. `passar` anda o relógio e dispara a conferência pendente. */
function cenario(minutos: number) {
  let agora = 1_000_000
  const tarefas: Tarefa[] = []
  const desligamentos: number[] = []
  const desligamento = criarDesligamentoPorOciosidade({
    minutos,
    agora: () => agora,
    aoDesligar: () => { desligamentos.push(agora) },
    agendar: (fn, ms): Agendamento => {
      const tarefa: Tarefa = { fn, ms, cancelada: false }
      tarefas.push(tarefa)
      return { cancelar: () => { tarefa.cancelada = true } }
    },
  })
  const pendentes = () => tarefas.filter(tarefa => !tarefa.cancelada)
  /** Anda o relógio `ms` e dispara a conferência que estava marcada (a mais recente ainda ativa). */
  const passar = (ms: number) => {
    agora += ms
    const tarefa = pendentes().at(-1)
    assert.ok(tarefa, 'havia uma conferência marcada')
    tarefa.cancelada = true
    tarefa.fn()
  }
  return { desligamento, tarefas, pendentes, desligamentos, passar, relogio: () => agora, andar: (ms: number) => { agora += ms } }
}

describe('criarDesligamentoPorOciosidade: configuração', () => {
  it('confere a cada 60 segundos', () => {
    assert.equal(INTERVALO_DE_CONFERENCIA_MS, 60_000)
    const { tarefas } = cenario(30)
    assert.equal(tarefas.length, 1)
    assert.equal(tarefas[0]!.ms, 60_000)
  })

  it('recusa minutos que não sejam um inteiro de 1 em diante, com a frase em português', () => {
    for (const invalido of [0, -1, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -Infinity]) {
      assert.throws(
        () => criarDesligamentoPorOciosidade({ minutos: invalido, agora: () => 0, aoDesligar: () => {}, agendar: () => ({ cancelar: () => {} }) }),
        { message: 'O tempo de ociosidade deve ser um número inteiro de minutos, de 1 em diante.' },
        `minutos = ${invalido}`,
      )
    }
  })

  it('não marca conferência nenhuma quando os minutos são recusados', () => {
    let marcadas = 0
    assert.throws(() => criarDesligamentoPorOciosidade({ minutos: 0, agora: () => 0, aoDesligar: () => {}, agendar: () => { marcadas += 1; return { cancelar: () => {} } } }))
    assert.equal(marcadas, 0)
  })

  it('aceita 1 minuto', () => {
    const { tarefas } = cenario(1)
    assert.equal(tarefas.length, 1)
  })
})

describe('criarDesligamentoPorOciosidade: desligar', () => {
  it('não desliga antes de passar o tempo e marca a próxima conferência', () => {
    const c = cenario(30)
    c.passar(MINUTO)
    assert.deepEqual(c.desligamentos, [])
    assert.equal(c.pendentes().length, 1, 'a próxima conferência foi marcada')
    assert.equal(c.pendentes()[0]!.ms, INTERVALO_DE_CONFERENCIA_MS)
  })

  it('desliga uma vez quando passam exatamente os minutos desde o início', () => {
    const c = cenario(30)
    c.passar(30 * MINUTO)
    assert.equal(c.desligamentos.length, 1)
  })

  it('1 ms antes do limite ainda não desliga', () => {
    const c = cenario(30)
    c.passar(30 * MINUTO - 1)
    assert.deepEqual(c.desligamentos, [])
  })

  it('depois de desligar não marca outra conferência (chama aoDesligar uma única vez)', () => {
    const c = cenario(1)
    c.passar(MINUTO)
    assert.equal(c.desligamentos.length, 1)
    assert.equal(c.pendentes().length, 0, 'nenhuma conferência pendente')
  })

  it('a conta é em minutos inteiros: 2 minutos não desligam com 1 minuto parado', () => {
    const c = cenario(2)
    c.passar(MINUTO)
    assert.deepEqual(c.desligamentos, [])
    c.passar(MINUTO)
    assert.equal(c.desligamentos.length, 1)
  })

  it('sem nenhuma atividade desliga na primeira conferência depois do limite, mesmo que o tempo tenha dado um salto', () => {
    const c = cenario(30)
    c.passar(3 * 60 * MINUTO)
    assert.equal(c.desligamentos.length, 1)
  })
})

describe('criarDesligamentoPorOciosidade: atividade', () => {
  it('uma atividade zera a contagem a partir do momento dela', () => {
    const c = cenario(30)
    c.andar(20 * MINUTO)
    c.desligamento.registrarAtividade()
    c.passar(29 * MINUTO)
    assert.deepEqual(c.desligamentos, [], '29 minutos depois da atividade ainda não desliga')
    c.passar(MINUTO)
    assert.equal(c.desligamentos.length, 1, 'com 30 minutos depois da atividade, desliga')
  })

  it('vale a atividade mais recente, não a primeira', () => {
    const c = cenario(10)
    c.andar(4 * MINUTO)
    c.desligamento.registrarAtividade()
    c.andar(4 * MINUTO)
    c.desligamento.registrarAtividade()
    c.passar(9 * MINUTO)
    assert.deepEqual(c.desligamentos, [])
    c.passar(MINUTO)
    assert.equal(c.desligamentos.length, 1)
  })

  it('registrar atividade não marca nem cancela conferência', () => {
    const c = cenario(30)
    const antes = c.tarefas.length
    c.desligamento.registrarAtividade()
    assert.equal(c.tarefas.length, antes)
    assert.equal(c.pendentes().length, 1)
  })
})

describe('criarDesligamentoPorOciosidade: parar', () => {
  it('cancela a conferência marcada e não desliga', () => {
    const c = cenario(1)
    c.desligamento.parar()
    assert.equal(c.pendentes().length, 0, 'a conferência foi cancelada')
    assert.deepEqual(c.desligamentos, [])
  })

  it('cancela a conferência marcada depois de uma conferência anterior', () => {
    const c = cenario(30)
    c.passar(MINUTO)
    c.desligamento.parar()
    assert.equal(c.pendentes().length, 0)
  })

  it('parar depois de desligar não faz mal', () => {
    const c = cenario(1)
    c.passar(MINUTO)
    c.desligamento.parar()
    assert.equal(c.desligamentos.length, 1)
  })
})
