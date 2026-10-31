// Pedidos do dono no rascunho automático (D6). No PostCompact e no SessionEnd, o resumo gravado sozinho
// termina com a seção "Pedidos do dono nesta sessão:": os últimos pedidos, um por linha, cada um cortado
// sem partir palavra. O campo aceita 8.000 caracteres; quem cede espaço é o resumo, não os pedidos.
import { cortarInicioSemPartir } from './transcricao.js'

export const TITULO_DOS_PEDIDOS = 'Pedidos do dono nesta sessão:'
/** Tantos pedidos, os mais recentes, entram na seção. */
export const MAXIMO_DE_PEDIDOS = 15
/** Cada pedido entra com até tantos caracteres (sem partir palavra). */
export const LIMITE_POR_PEDIDO = 300
/** Entre o resumo e a seção. */
const SEPARADOR = '\n\n'

/** Pedido numa linha só: quebras e espaços repetidos viram um espaço. */
function emUmaLinha(pedido: string): string {
  return pedido.replace(/\s+/g, ' ').trim()
}

/** A seção pronta, ou '' quando não há pedido. */
export function secaoDosPedidos(pedidos: string[]): string {
  const linhas = pedidos
    .map(emUmaLinha)
    .filter((pedido) => pedido !== '')
    .slice(-MAXIMO_DE_PEDIDOS)
    .map((pedido) => `- ${cortarInicioSemPartir(pedido, LIMITE_POR_PEDIDO)}`)
  return linhas.length === 0 ? '' : [TITULO_DOS_PEDIDOS, ...linhas].join('\n')
}

/**
 * Resumo + seção dos pedidos, dentro de `limite`. `cortar` decide de que lado o resumo perde texto
 * (o fim da conversa guarda o final; o resumo da compactação guarda o começo). Sem resumo, nada:
 * a sessão sem resumo continua sem rascunho, como antes.
 */
export function juntarComPedidos(
  resumo: string,
  pedidos: string[],
  limite: number,
  cortar: (texto: string, limite: number) => string,
): string {
  const texto = resumo.trim()
  if (texto === '') return ''
  const secao = secaoDosPedidos(pedidos)
  if (secao === '') return cortar(texto, limite)
  const espaco = limite - secao.length - SEPARADOR.length
  const corpo = cortar(texto, Math.max(espaco, 0))
  return corpo === '' ? secao : `${corpo}${SEPARADOR}${secao}`
}
