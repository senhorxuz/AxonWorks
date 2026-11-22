/**
 * Orçamento por prioridade do contexto compilado.
 *
 * Módulo puro: sem banco, sem relógio. Recebe as seções candidatas na ordem de
 * leitura, escolhe o que entra pela prioridade da seção e devolve o texto de
 * novo na ordem de leitura. Cada item traz o texto inteiro já mascarado e,
 * opcionalmente, uma forma curta que entra quando o inteiro não cabe.
 */

/** Da mais alta para a mais baixa. O quadro e o backlog vêm depois de tudo. */
export const PRIORIDADE_DAS_SECOES: readonly string[] = [
  'regras_do_dono',
  'verificacoes',
  'attention',
  'deliveries',
  'focus_task',
  'checkpoint',
  'blockers',
  'charter',
  'decisions',
  'work_draft',
  'stale_evidence',
  'overlaps',
  'library_content',
  'inbox',
  'board',
  'backlog',
]

/** Seção sem prioridade declarada fica depois da caixa de entrada e antes do quadro. */
const POSICAO_SEM_PRIORIDADE = PRIORIDADE_DAS_SECOES.indexOf('inbox') + 0.5

export interface ItemCandidato<T> {
  dado: T
  /** Linha inteira já mascarada, como entra no markdown. */
  texto: string
  /** Forma curta, usada quando o inteiro não cabe. */
  curto?: { dado: T; texto: string }
}

export interface SecaoCandidata<T> {
  kind: string
  titulo: string
  itens: ItemCandidato<T>[]
}

export interface EntradaDoOrcamento<T> {
  cabecalho: string
  aviso: string
  secoes: SecaoCandidata<T>[]
  maxChars: number
}

export interface ItemEscolhido<T> {
  dado: T
  curto: boolean
}

export interface SecaoEscolhida<T> {
  kind: string
  titulo: string
  itens: ItemEscolhido<T>[]
  /** Quantos itens da seção ficaram fora (0 quando nenhum). */
  omitidos: number
}

export interface SaidaDoOrcamento<T> {
  /** Só as seções com ao menos um item, na ordem de leitura. */
  secoes: SecaoEscolhida<T>[]
  markdown: string
  omittedCounts: Record<string, number>
  cutSections: string[]
  truncated: boolean
}

type Escolha<T> = ItemEscolhido<T> | undefined

export function cabecalhoDaSecao(titulo: string): string {
  return `\n\n## ${titulo}\n`
}

export function posicaoDaPrioridade(kind: string): number {
  const posicao = PRIORIDADE_DAS_SECOES.indexOf(kind)
  return posicao === -1 ? POSICAO_SEM_PRIORIDADE : posicao
}

/** Índices das seções, da mais prioritária para a menos; o empate fica na ordem de leitura (a ordenação é estável). */
export function ordemDePrioridade(kinds: readonly string[]): number[] {
  return kinds
    .map((kind, indice) => ({ indice, posicao: posicaoDaPrioridade(kind) }))
    .sort((a, b) => a.posicao - b.posicao)
    .map((entrada) => entrada.indice)
}

interface FormaEscolhida<T> {
  escolha: ItemEscolhido<T>
  gasto: number
}

function escolherForma<T>(item: ItemCandidato<T>, folga: number): FormaEscolhida<T> | null {
  if (item.texto.length <= folga) {
    return { escolha: { dado: item.dado, curto: false }, gasto: item.texto.length }
  }
  const curto = item.curto
  if (curto && curto.texto.length <= folga) {
    return { escolha: { dado: curto.dado, curto: true }, gasto: curto.texto.length }
  }
  return null
}

function escolherItens<T>(secoes: SecaoCandidata<T>[], orcamento: number): Escolha<T>[][] {
  const escolhas = secoes.map((): Escolha<T>[] => [])
  let folga = orcamento
  for (const indice of ordemDePrioridade(secoes.map((s) => s.kind))) {
    const secao = secoes[indice]!
    const cabecalho = cabecalhoDaSecao(secao.titulo).length
    let abriu = false
    secao.itens.forEach((item, posicao) => {
      const custoDaSecao = abriu ? 0 : cabecalho
      const forma = escolherForma(item, folga - custoDaSecao)
      if (!forma) return
      escolhas[indice]![posicao] = forma.escolha
      folga -= forma.gasto + custoDaSecao
      abriu = true
    })
  }
  return escolhas
}

function textoDaEscolha<T>(item: ItemCandidato<T>, escolha: ItemEscolhido<T>): string {
  return escolha.curto ? item.curto!.texto : item.texto
}

function montarSecao<T>(
  secao: SecaoCandidata<T>,
  escolhas: Escolha<T>[],
): { escolhida: SecaoEscolhida<T> | null; markdown: string } {
  const itens: ItemEscolhido<T>[] = []
  let markdown = ''
  secao.itens.forEach((item, posicao) => {
    const escolha = escolhas[posicao]
    if (!escolha) return
    itens.push(escolha)
    markdown += textoDaEscolha(item, escolha)
  })
  if (itens.length === 0) return { escolhida: null, markdown: '' }
  return {
    escolhida: { kind: secao.kind, titulo: secao.titulo, itens, omitidos: secao.itens.length - itens.length },
    markdown: cabecalhoDaSecao(secao.titulo) + markdown,
  }
}

export function escolherPorOrcamento<T>(entrada: EntradaDoOrcamento<T>): SaidaDoOrcamento<T> {
  const { cabecalho, aviso, secoes, maxChars } = entrada
  const escolhas = escolherItens(secoes, maxChars - cabecalho.length - aviso.length)
  const escolhidas: SecaoEscolhida<T>[] = []
  const omittedCounts: Record<string, number> = {}
  const cutSections: string[] = []
  let markdown = cabecalho
  let truncated = false

  secoes.forEach((secao, indice) => {
    const { escolhida, markdown: trecho } = montarSecao(secao, escolhas[indice]!)
    const omitidos = escolhida ? escolhida.omitidos : secao.itens.length
    if (omitidos > 0) {
      truncated = true
      omittedCounts[secao.kind] = (omittedCounts[secao.kind] ?? 0) + omitidos
    }
    if (escolhida) escolhidas.push(escolhida)
    else cutSections.push(secao.kind)
    markdown += trecho
  })

  return {
    secoes: escolhidas,
    markdown: truncated ? markdown + aviso : markdown,
    omittedCounts,
    cutSections,
    truncated,
  }
}
