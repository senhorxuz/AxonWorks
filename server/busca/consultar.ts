/**
 * Busca na memória (lote 2, D7), parte pura: o que o usuário digitou vira palavras, as palavras viram a
 * expressão FTS5, os pesos por tipo, a ordem dos resultados, o título curto e o trecho.
 *
 * A consulta nunca chega crua ao FTS5. Ela é quebrada em palavras (letras e números; o resto, inclusive
 * aspas, `*`, `-`, parênteses, `:`, `^` e emoji, separa palavras) e cada palavra vira um grupo de
 * prefixos entre aspas: `AND`, `OR`, `NOT` e `NEAR` digitados são só texto. Todas as palavras precisam
 * aparecer (E), em qualquer ordem. Acento e caixa não contam (o índice usa `remove_diacritics 2`).
 *
 * O banco fica em `indice.ts` (esquema, gatilhos, reconstrução) e `buscar.ts` (a consulta).
 */
import { DomainError } from '../store/errors.js'
import { asRecord } from '../store/validation.js'

/** Os tipos que a busca devolve, na ordem fixa em que a validação os lista. */
export const TIPOS_DA_MEMORIA = [
  'licao',
  'decisao',
  'diretriz',
  'cartao',
  'backlog',
  'bloqueio',
  'checkpoint',
  'mensagem',
  'biblioteca',
] as const

export type TipoDaMemoria = (typeof TIPOS_DA_MEMORIA)[number]

/**
 * Peso por tipo (D7), que multiplica a relevância BM25. Bloqueio, biblioteca e decisão ainda proposta
 * não têm peso no D7: ficam no neutro (1,0), junto de cartão e backlog. `encerrado` vale para decisão
 * revogada ou substituída, lição aposentada e conteúdo arquivado da biblioteca.
 */
export const PESOS = {
  licao: 1.5,
  decisaoAceita: 1.4,
  diretriz: 1.3,
  cartao: 1,
  backlog: 1,
  bloqueio: 1,
  biblioteca: 1,
  decisaoProposta: 1,
  checkpoint: 0.9,
  mensagem: 0.8,
  encerrado: 0.5,
} as const

export const LIMITE_PADRAO = 10
export const LIMITE_MAXIMO = 50
export const TERMOS_MAXIMOS = 16
export const TRECHO_MAXIMO = 200
export const TITULO_MAXIMO = 120

export interface ResultadoDaBusca {
  tipo: TipoDaMemoria
  id: string
  titulo: string
  data: string
  trecho: string
  pontuacao: number
}

/** Uma linha achada pelo FTS5, antes de ler o texto: `linha` é o rowid no `memoria_fts`. */
export interface Candidato {
  tipo: TipoDaMemoria
  id: string
  data: string
  pontuacao: number
  linha: number
}

export interface BuscaValidada {
  termos: string[]
  limite: number
  tipos: TipoDaMemoria[]
}

/** Sem acento (forma decomposta, marcas fora) e em minúsculas, como o tokenizador do índice compara. */
function dobrar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** As palavras do texto, dobradas: sequências de letras e números (o mesmo corte do `unicode61`). */
function palavrasDobradas(texto: string): string[] {
  return dobrar(texto).match(/[\p{L}\p{N}]+/gu) ?? []
}

export function termosDaConsulta(consulta: string): string[] {
  return palavrasDobradas(consulta).slice(0, TERMOS_MAXIMOS)
}

/**
 * Plural e singular que o prefixo não alcança ("decisão" não é começo de "decisões"; "testes" não é
 * começo de "teste"; "irmãos" chega a "irmão" pela regra do `s`). Ordem importa: o primeiro final que casa vale. A raiz precisa de 3 letras, para
 * palavras curtas ("não", "com", "dos") não ganharem formas sem sentido.
 */
const TROCAS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['oes', ['ao']],
  ['aes', ['ao']],
  ['ao', ['oes', 'aes', 'aos']],
  ['ns', ['m']],
  ['m', ['ns']],
  ['ais', ['al']],
  ['eis', ['el']],
  ['ois', ['ol']],
  ['al', ['ais']],
  ['el', ['eis']],
  ['ol', ['ois']],
  ['res', ['r']],
  ['zes', ['z']],
  ['ses', ['s']],
  ['s', ['']],
]

const RAIZ_MINIMA = 3

export function formasDoTermo(termo: string): string[] {
  const troca = TROCAS.find(([fim]) => termo.endsWith(fim) && termo.length - fim.length >= RAIZ_MINIMA)
  if (troca === undefined) return [termo]
  const raiz = termo.slice(0, termo.length - troca[0].length)
  return [termo, ...troca[1].map((fim) => raiz + fim)]
}

/**
 * `("decisao"* OR "decisoes"* ...) AND ("login"*)`. As formas só têm letras e números (saem de
 * `termosDaConsulta`), então as aspas nunca precisam de escape.
 */
export function expressaoFts(termos: string[]): string {
  return termos.map((termo) => `(${formasDoTermo(termo).map((forma) => `"${forma}"*`).join(' OR ')})`).join(' AND ')
}

function recusar(mensagem: string): never {
  throw new DomainError(400, 'invalid_input', mensagem)
}

function lerLimite(valor: unknown): number {
  if (valor === undefined) return LIMITE_PADRAO
  // `Number.isInteger` já recusa o que não é número (texto, nulo); o `as` só informa o TypeScript.
  const limite = valor as number
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
    recusar(`Campo limit inválido. Use um número inteiro de 1 a ${LIMITE_MAXIMO}.`)
  }
  return limite
}

function ehTipo(valor: unknown): valor is TipoDaMemoria {
  return TIPOS_DA_MEMORIA.includes(valor as TipoDaMemoria)
}

function lerTipos(valor: unknown): TipoDaMemoria[] {
  if (valor === undefined) return [...TIPOS_DA_MEMORIA]
  if (!Array.isArray(valor) || !valor.every(ehTipo)) recusar(`Campo tipos inválido. Use: ${TIPOS_DA_MEMORIA.join(', ')}.`)
  if (valor.length === 0) return [...TIPOS_DA_MEMORIA]
  return TIPOS_DA_MEMORIA.filter((tipo) => valor.includes(tipo))
}

/** Entrada de `search_memory`. Consulta sem nenhuma palavra é válida: a busca devolve lista vazia. */
export function validarBusca(input: unknown): BuscaValidada {
  const rec = asRecord(input, 'busca')
  if (typeof rec.query !== 'string') recusar('Campo query inválido.')
  return { termos: termosDaConsulta(rec.query), limite: lerLimite(rec.limit), tipos: lerTipos(rec.tipos) }
}

/** O pedaço de texto (entre espaços) tem uma palavra que começa por alguma das formas? */
function contem(texto: string, formas: string[]): boolean {
  return palavrasDobradas(texto).some((palavra) => formas.some((forma) => palavra.startsWith(forma)))
}

/**
 * Cresce a janela a partir da palavra do termo, uma palavra por vez, pelo lado que tem menos caracteres
 * (empate: a esquerda), enquanto couber. Quando um lado não cabe mais, o outro continua crescendo.
 */
function janela(palavras: string[], alvo: number, espaco: number): [number, number] {
  let de = alvo
  let ate = alvo + 1
  let esquerda = 0
  let direita = 0
  for (;;) {
    const tamanho = palavras[alvo].length + esquerda + direita
    const cabeEsquerda = de > 0 && tamanho + 1 + palavras[de - 1].length <= espaco
    const cabeDireita = ate < palavras.length && tamanho + 1 + palavras[ate].length <= espaco
    if (cabeEsquerda && (!cabeDireita || esquerda <= direita)) {
      de -= 1
      esquerda += 1 + palavras[de].length
    } else if (cabeDireita) {
      direita += 1 + palavras[ate].length
      ate += 1
    } else {
      return [de, ate]
    }
  }
}

/**
 * Até `maximo` caracteres, centrado no primeiro termo encontrado (sem termo: o começo), sem cortar
 * palavra, com "…" na ponta cortada. Uma palavra maior que o espaço inteiro é cortada (não há como não).
 */
export function trecho(texto: string, formas: string[], maximo: number = TRECHO_MAXIMO): string {
  const limpo = texto.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (limpo.length <= maximo) return limpo
  const espaco = maximo - 2
  const palavras = limpo.split(' ')
  const achada = palavras.findIndex((palavra) => contem(palavra, formas))
  const [de, ate] = janela(palavras, achada === -1 ? 0 : achada, espaco)
  const inteiro = palavras.slice(de, ate).join(' ')
  const miolo = inteiro.slice(0, espaco)
  const antes = de > 0 ? '…' : ''
  const depois = ate < palavras.length || miolo !== inteiro ? '…' : ''
  return `${antes}${miolo}${depois}`
}

/** Trecho do corpo quando o termo está nele; senão, do título com o corpo (o termo pode estar só no título). */
export function trechoDoResultado(titulo: string, corpo: string, formas: string[]): string {
  if (contem(corpo, formas)) return trecho(corpo, formas)
  return trecho([titulo, corpo].filter((parte) => parte.trim() !== '').join(' — '), formas)
}

function cortarNoFim(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto
  const espaco = texto.lastIndexOf(' ', maximo - 1)
  return `${texto.slice(0, espaco === -1 ? maximo - 1 : espaco)}…`
}

/** O título do item; sem título (mensagem, lição, diretriz), a primeira linha com texto do corpo. */
export function tituloCurto(titulo: string, corpo: string): string {
  const base = titulo.trim() === '' ? corpo.trim().split('\n')[0] : titulo
  return cortarNoFim(base.replace(/\s+/g, ' ').trim(), TITULO_MAXIMO)
}

export function paraResultado(
  candidato: Candidato,
  textos: { titulo: string; corpo: string },
  formas: string[],
): ResultadoDaBusca {
  return {
    tipo: candidato.tipo,
    id: candidato.id,
    titulo: tituloCurto(textos.titulo, textos.corpo),
    data: candidato.data,
    trecho: trechoDoResultado(textos.titulo, textos.corpo, formas),
    pontuacao: Number(candidato.pontuacao.toPrecision(4)),
  }
}
