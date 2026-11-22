/**
 * Visão geral: formulários e detalhes abertos na própria página aparecem um por vez (abrir um fecha o outro),
 * e abrir leva o dono até ele. As contas ficam aqui; quem rola e foca é `irPara` (src/chegada).
 */
import { chaveDaChegada } from '../chegada/chegada'

export const FORMULARIO_DO_BLOQUEIO = 'bloqueio'
const PREFIXO_DOS_DETALHES = 'detalhes:'

export const chaveDosDetalhes = (idDaTarefa: string): string => `${PREFIXO_DOS_DETALHES}${idDaTarefa}`

/** Pedir o que já está aberto fecha; pedir outro troca. */
export function alternarAberto(atual: string | null, pedido: string): string | null {
  return atual === pedido ? null : pedido
}

/** Para onde levar o dono quando algo abre: o destino do destaque de chegada e, se houver, o campo que recebe o foco. */
export function destinoDoAberto(aberto: string): { chave: string; foco?: string } | null {
  if (aberto === FORMULARIO_DO_BLOQUEIO) return { chave: chaveDaChegada('aberto', aberto), foco: 'input, textarea' }
  if (aberto.startsWith(PREFIXO_DOS_DETALHES)) return { chave: chaveDaChegada('tarefa', aberto.slice(PREFIXO_DOS_DETALHES.length)) }
  return null
}
