/**
 * Desligamento por ociosidade.
 *
 * O servidor da Axon só é necessário para VER a tela (o Claude Code usa os ganchos e o MCP, que leem o
 * banco direto). Num computador fraco não vale deixá-lo ligado o dia todo: quando ninguém usa, ele se desliga.
 *
 * Esta parte é pura: o relógio, o agendador e o desligamento chegam de fora, então o teste anda o tempo
 * sem esperar. A ligação com o servidor de verdade está em `server/index.ts`.
 */

export const INTERVALO_DE_CONFERENCIA_MS = 60_000
const MS_POR_MINUTO = 60_000

export interface Agendamento {
  cancelar(): void
}

export interface OpcoesDoDesligamento {
  /** Minutos sem atividade até desligar. Inteiro, de 1 em diante. */
  minutos: number
  /** Relógio em milissegundos (no servidor, `Date.now`). */
  agora: () => number
  /** Chamado uma única vez, quando o tempo parado chega ao limite. */
  aoDesligar: () => void
  /** Marca `fn` para daqui a `ms` milissegundos (uma vez só) e devolve como cancelar. */
  agendar: (fn: () => void, ms: number) => Agendamento
}

export interface DesligamentoPorOciosidade {
  /** Conta a partir de agora: chame a cada requisição recebida. */
  registrarAtividade(): void
  /** Cancela a conferência marcada. Depois disso nada mais desliga o servidor. */
  parar(): void
}

export function criarDesligamentoPorOciosidade(opcoes: OpcoesDoDesligamento): DesligamentoPorOciosidade {
  const { minutos, agora, aoDesligar, agendar } = opcoes
  if (!Number.isInteger(minutos) || minutos < 1) {
    throw new Error('O tempo de ociosidade deve ser um número inteiro de minutos, de 1 em diante.')
  }
  const limiteMs = minutos * MS_POR_MINUTO
  let ultimaAtividade = agora()
  let marcada: Agendamento

  const conferir = (): void => {
    if (agora() - ultimaAtividade >= limiteMs) {
      aoDesligar()
      return
    }
    marcada = agendar(conferir, INTERVALO_DE_CONFERENCIA_MS)
  }

  marcada = agendar(conferir, INTERVALO_DE_CONFERENCIA_MS)

  return {
    registrarAtividade() {
      ultimaAtividade = agora()
    },
    parar() {
      marcada.cancelar()
    },
  }
}
