/**
 * "Lide" de um texto de "O que foi feito": a primeira afirmação, que a tela põe em destaque.
 * Regra pura (sem tela, sem relógio); desenho 5.3 de 22/11/2026.
 */

/** O destaque (com a pontuação) tem de 16 a 120 caracteres. */
const DESTAQUE_MINIMO = 16
const DESTAQUE_MAXIMO = 120

/** Abreviações cujo ponto não encerra a frase (comparadas sem diferenciar maiúsculas). */
const ABREVIACOES = new Set(['sr', 'sra', 'dr', 'dra', 'ex', 'etc', 'obs'])

const PONTUACAO_DE_FIM = /[:.;!?]/
const SO_ESPACO = /\s/
/** Número de versão (com ou sem "v") colado ao ponto: "v1.7", "2.10.3". */
const VERSAO_NO_FIM = /\d+\.\d+$/
const DIGITO = /\d/

/** A palavra (sem espaço) que termina logo antes da posição `fim`. */
function palavraAntes(texto: string, fim: number): string {
  const comeco = texto.slice(0, fim).search(/\S+$/)
  return texto.slice(comeco, fim)
}

/** O ponto em `posicao` é de abreviação, de número ou de versão (não encerra a frase)? */
function pontoQueNaoEncerra(texto: string, posicao: number): boolean {
  const palavra = palavraAntes(texto, posicao)
  if (ABREVIACOES.has(palavra.toLowerCase())) return true
  if (VERSAO_NO_FIM.test(palavra)) return true
  const antesEhDigito = DIGITO.test(texto.charAt(posicao - 1))
  const depoisEhDigito = DIGITO.test(texto.slice(posicao + 1).trimStart().charAt(0))
  return antesEhDigito && depoisEhDigito
}

/** A pontuação em `posicao` fecha o destaque? (o laço de `lide` já limita o tamanho a 16..120) */
function fechaODestaque(texto: string, posicao: number): boolean {
  const tamanho = posicao + 1
  if (!PONTUACAO_DE_FIM.test(texto.charAt(posicao))) return false
  if (!SO_ESPACO.test(texto.charAt(tamanho))) return false
  if (texto.slice(tamanho).trim() === '') return false
  return texto.charAt(posicao) !== '.' || !pontoQueNaoEncerra(texto, posicao)
}

/** Divide o texto na primeira afirmação. Sem divisão válida, devolve o texto inteiro e resto vazio. */
export function lide(texto: string): [destaque: string, resto: string] {
  const fim = Math.min(texto.length, DESTAQUE_MAXIMO)
  for (let posicao = DESTAQUE_MINIMO - 1; posicao < fim; posicao++) {
    if (fechaODestaque(texto, posicao)) {
      return [texto.slice(0, posicao + 1), texto.slice(posicao + 1).trimStart()]
    }
  }
  return [texto, '']
}

/** A primeira afirmação do dia, sem ":" nem ";" no fim. */
export function fechoDoDia(texto: string): string {
  return lide(texto)[0].replace(/[:;]+$/, '')
}
