// Quando uma sessão que ficou para trás conta como parada (spec 13.4). O marcador (`marcadores.ts`) só é
// regravado quando o Claude termina uma resposta; uma resposta longa, esperando agentes, deixa o marcador
// velho com a sessão ainda ativa (defeito de 25/10, 23h42: o fim da conversa ativa virou rascunho de outro
// projeto). A conversa também não é escrita o tempo todo: o Claude Code a grava de forma preguiçosa (medição
// de 26/10/2026: uma sessão viva ficou 40 minutos sem mudar a data do arquivo). Por isso a sessão só conta
// como parada se as DUAS fontes estiverem mais velhas que o prazo, e o prazo é largo (6 horas).
import { statSync } from 'node:fs'
import type { MarcadorDeSessao } from './marcadores.js'

/**
 * Duas janelas na mesma pasta: o marcador de uma sessão ainda aberta é regravado a cada resposta. Só
 * o parado há mais que isto (marcador e conversa) é tratado como janela fechada sem SessionEnd (spec 13.4).
 * 6 horas (360 minutos): recuperar tarde custa pouco, porque o rascunho é rede de segurança; recuperar uma
 * sessão viva (a conversa pode ficar dezenas de minutos sem ser escrita) grava a conversa no projeto errado.
 */
export const MINUTOS_PARA_RECUPERAR = 360
const PRAZO_EM_MS = MINUTOS_PARA_RECUPERAR * 60_000

/** Instante ilegível (NaN) nunca passa do prazo: na dúvida, não recupera. */
function passouDoPrazo(instanteMs: number, agora: Date): boolean {
  return agora.getTime() - instanteMs > PRAZO_EM_MS
}

/**
 * `mtimeDaConversaMs`: data de modificação do arquivo da conversa; `null` quando ele sumiu (não há o que
 * esperar: conta como a mais velha possível, vale só o marcador); `NaN` quando não deu para ler (nunca
 * passa do prazo).
 */
export function sessaoParada(m: MarcadorDeSessao, mtimeDaConversaMs: number | null, agora: Date): boolean {
  return passouDoPrazo(Date.parse(m.atualizadoEm), agora) && passouDoPrazo(mtimeDaConversaMs ?? Number.NEGATIVE_INFINITY, agora)
}

/** Data de modificação da conversa em ms; `null` se o arquivo não existe; `NaN` se o sistema não deixou consultar. */
export function dataDaConversa(caminho: string): number | null {
  try {
    const estado = statSync(caminho, { throwIfNoEntry: false })
    return estado === undefined ? null : estado.mtimeMs
  } catch {
    return Number.NaN
  }
}
