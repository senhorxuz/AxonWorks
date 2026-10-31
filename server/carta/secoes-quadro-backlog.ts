// Quadro e backlog na retomada completa (get_resume_brief e compile_context).
// Funções puras: recebem o que o store leu e devolvem seções, listas e texto. Nada aqui lê banco.
import { BOARD_COLUMNS, type BoardCard, type BoardColumnId, type BoardPriority } from '../../shared/board.js'
import type { ContextItem, ContextSection } from '../../shared/context.js'
import type { ResumoDeCartao, ResumoDeItemDoBacklog } from '../../shared/continuity.js'
import type { BacklogItem, BacklogStage } from '../../shared/types.js'

export type { ResumoDeCartao, ResumoDeItemDoBacklog }

/** Tamanho máximo, em caracteres, da descrição de um cartão dentro do contexto. */
export const LIMITE_DESCRICAO_CARTAO = 300

/** Teto, em caracteres, de cada uma das seções (quadro e backlog) no texto da retomada, mesmo que sobre mais espaço. */
export const LIMITE_DA_SECAO = 1200

/** Colunas que não entram: o trabalho já acabou ou foi descartado. */
const COLUNAS_ENCERRADAS: ReadonlySet<BoardColumnId> = new Set<BoardColumnId>(['done', 'discarded'])

const NOME_DA_COLUNA = Object.fromEntries(BOARD_COLUMNS.map((coluna) => [coluna.id, coluna.name])) as Record<BoardColumnId, string>
const ORDEM_DA_COLUNA = Object.fromEntries(BOARD_COLUMNS.map((coluna, posicao) => [coluna.id, posicao])) as Record<BoardColumnId, number>

// Backlog e quadro usam os mesmos quatro níveis de prioridade.
const NOME_DA_PRIORIDADE: Record<BoardPriority, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}
const ORDEM_DA_PRIORIDADE: Record<BoardPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

/** Cartão que espera o dono vale mais que qualquer coluna. */
const IMPORTANCIA_DEPENDE_DO_DONO = -1

/** Colunas em aberto, da mais importante para a menos; as do mesmo grau empatam e valem na ordem das colunas. */
const GRAUS_DE_IMPORTANCIA: ReadonlyArray<readonly BoardColumnId[]> = [
  ['blocked'],
  ['in_progress', 'unfinished', 'testing', 'awaiting_deploy'],
  ['pending'],
  ['ideas'],
]
const IMPORTANCIA_DA_COLUNA = Object.fromEntries(
  GRAUS_DE_IMPORTANCIA.flatMap((colunas, grau) => colunas.map((coluna) => [coluna, grau])),
) as Record<BoardColumnId, number>

/** Etapa em aberto do backlog: só "pronto" e "ideia" chegam aqui (a lista já foi filtrada). */
function nomeDaEtapa(etapa: BacklogStage): string {
  return etapa === 'ready' ? 'Pronto' : 'Ideia'
}

function ordemDaEtapa(etapa: BacklogStage): number {
  return etapa === 'ready' ? 0 : 1
}

function importanciaDoCartao(cartao: BoardCard): number {
  return cartao.needsOwner ? IMPORTANCIA_DEPENDE_DO_DONO : IMPORTANCIA_DA_COLUNA[cartao.column]
}

/** Cartões fora de Completo e Descartado, na ordem das colunas e, dentro delas, pela posição. */
export function cartoesEmAberto(cartoes: readonly BoardCard[]): BoardCard[] {
  return cartoes
    .filter((cartao) => !COLUNAS_ENCERRADAS.has(cartao.column))
    .sort((a, b) => ORDEM_DA_COLUNA[a.column] - ORDEM_DA_COLUNA[b.column] || a.position - b.position)
}

/** Ideias e itens prontos, prioridade primeiro; no empate, pronto antes de ideia. Promovido e arquivado ficam fora. */
export function backlogEmAberto(itens: readonly BacklogItem[]): BacklogItem[] {
  return itens
    .filter((item) => item.stage === 'idea' || item.stage === 'ready')
    .sort(
      (a, b) =>
        ORDEM_DA_PRIORIDADE[a.priority] - ORDEM_DA_PRIORIDADE[b.priority] || ordemDaEtapa(a.stage) - ordemDaEtapa(b.stage),
    )
}

/** O que o `ResumeBrief` guarda de um cartão: sem descrição, etiquetas nem checklist. */
export function resumirCartao(cartao: BoardCard): ResumoDeCartao {
  return {
    id: cartao.id,
    column: cartao.column,
    title: cartao.title,
    priority: cartao.priority,
    needsOwner: cartao.needsOwner,
    version: cartao.version,
  }
}

/** O que o `ResumeBrief` guarda de um item do backlog: sem descrição. */
export function resumirItemDoBacklog(item: BacklogItem): ResumoDeItemDoBacklog {
  return { id: item.id, stage: item.stage, title: item.title, priority: item.priority, version: item.version }
}

function resumirDescricao(descricao: string): string {
  const limpa = descricao.trim()
  return limpa.length > LIMITE_DESCRICAO_CARTAO ? `${limpa.slice(0, LIMITE_DESCRICAO_CARTAO - 1)}…` : limpa
}

function corpoDoCartao(cartao: BoardCard): string {
  const partes: string[] = []
  if (cartao.priority) partes.push(`Prioridade: ${NOME_DA_PRIORIDADE[cartao.priority]}.`)
  const descricao = resumirDescricao(cartao.description)
  if (descricao) partes.push(descricao)
  return partes.length > 0 ? partes.join(' ') : 'Sem descrição.'
}

function itemDoCartao(cartao: BoardCard): ContextItem {
  return {
    id: cartao.id,
    sourceType: 'board_card',
    title: `${NOME_DA_COLUNA[cartao.column]}: ${cartao.title}`,
    body: corpoDoCartao(cartao),
    revisionNo: cartao.version,
    provenance: 'agent_report',
    authority: 'reference',
    reason: 'Cartão do quadro que ainda não foi encerrado.',
    meta: { column: cartao.column, priority: cartao.priority, needsOwner: cartao.needsOwner },
  }
}

function itemDoBacklog(item: BacklogItem): ContextItem {
  return {
    id: item.id,
    sourceType: 'backlog_item',
    title: `${nomeDaEtapa(item.stage)}: ${item.title}`,
    body: `Prioridade: ${NOME_DA_PRIORIDADE[item.priority]}.`,
    revisionNo: item.version,
    provenance: 'agent_report',
    authority: 'reference',
    reason: 'Item do backlog que ainda não virou tarefa.',
    meta: { stage: item.stage, priority: item.priority },
  }
}

/**
 * Seção "Quadro" do ContextEnvelope: um item por cartão em aberto, com `id` = id do cartão. O envelope
 * corta item por item na ordem em que chegam, então os itens saem do mais importante ao menos (depende do
 * dono, bloqueado, em andamento, pendente, ideias); quem empata segue a ordem das colunas e da posição.
 */
export function secaoDoQuadro(cartoes: readonly BoardCard[]): ContextSection {
  const porImportancia = cartoesEmAberto(cartoes).sort((a, b) => importanciaDoCartao(a) - importanciaDoCartao(b))
  return { kind: 'board', title: 'Quadro: cartões em aberto', items: porImportancia.map(itemDoCartao) }
}

/** Seção "Backlog" do ContextEnvelope: um item por ideia ou item pronto, só título e prioridade. */
export function secaoDoBacklog(itens: readonly BacklogItem[]): ContextSection {
  return { kind: 'backlog', title: 'Backlog: ideias e itens prontos', items: backlogEmAberto(itens).map(itemDoBacklog) }
}

/** As seções que o ContextEnvelope deve candidatar ao orçamento: só as que têm itens, quadro antes do backlog. */
export function secoesDoQuadroEBacklog(cartoes: readonly BoardCard[], itens: readonly BacklogItem[]): ContextSection[] {
  return [secaoDoQuadro(cartoes), secaoDoBacklog(itens)].filter((secao) => secao.items.length > 0)
}

interface Entrada {
  /** Nome do grupo (coluna); vazio quando a lista não tem grupos. */
  grupo: string
  linha: string
  /** Quanto menor, mais cedo a linha é escolhida quando falta espaço; no empate vale a ordem de exibição. */
  importancia: number
}

function avisoDeOmitidos(quantidade: number): string {
  return `_Omitidos pelo limite de tamanho: ${quantidade}._`
}

/** Texto da seção com as entradas recebidas, na ordem recebida: título, cada grupo com o seu nome, cada linha. */
function escrever(cabeca: string, entradas: readonly Entrada[]): string {
  let texto = cabeca
  let grupoAtual = ''
  for (const { grupo, linha } of entradas) {
    const abreGrupo = grupo !== grupoAtual
    const separador = abreGrupo || texto === cabeca ? '\n\n' : '\n'
    const titulo = abreGrupo ? `**${grupo}**\n` : ''
    texto += `${separador}${titulo}${linha}`
    grupoAtual = grupo
  }
  return texto
}

/**
 * Posições das entradas que cabem em `capacidade`, escolhidas da mais importante para a menos. Cada linha
 * entra inteira ou não entra (a que não cabe é pulada e as menores depois dela ainda podem entrar); o
 * título do grupo conta no espaço da primeira linha dele. A medida é o texto de verdade, não uma conta.
 */
function escolher(cabeca: string, entradas: readonly Entrada[], capacidade: number): Set<number> {
  const porImportancia = entradas
    .map((_, posicao) => posicao)
    .sort((a, b) => entradas[a]!.importancia - entradas[b]!.importancia)
  const escolhidas = new Set<number>()
  for (const posicao of porImportancia) {
    const candidatas = entradas.filter((_, outra) => outra === posicao || escolhidas.has(outra))
    if (escrever(cabeca, candidatas).length <= capacidade) escolhidas.add(posicao)
  }
  return escolhidas
}

/**
 * Seção em markdown que cabe em `limite` caracteres. Cada linha entra inteira ou não entra; quando falta
 * espaço, entram as mais importantes, mas o texto sai na ordem de exibição. O que ficou de fora vira uma
 * contagem no fim (que também cabe dentro do limite). `mascarar` apaga segredos de cada linha antes de
 * medir. Sem entradas, devolve texto vazio.
 */
function montarSecao(titulo: string, entradas: readonly Entrada[], limite: number, mascarar: (texto: string) => string): string {
  if (entradas.length === 0) return ''
  const cabeca = `## ${titulo}`
  const mascaradas = entradas.map((entrada) => ({ ...entrada, linha: mascarar(entrada.linha) }))
  const inteira = escrever(cabeca, mascaradas)
  if (inteira.length <= limite) return inteira
  // Reserva o espaço do aviso com a contagem de dígitos máxima possível (todas as entradas).
  const reserva = '\n\n'.length + avisoDeOmitidos(mascaradas.length).length
  const escolhidas = escolher(cabeca, mascaradas, limite - reserva)
  const texto = escrever(cabeca, mascaradas.filter((_, posicao) => escolhidas.has(posicao)))
  return `${texto}\n\n${avisoDeOmitidos(mascaradas.length - escolhidas.size)}`
}

function sufixoDaPrioridade(prioridade: BoardPriority | null): string {
  return prioridade ? ` (${NOME_DA_PRIORIDADE[prioridade]})` : ''
}

function sufixoDoDono(dependeDoDono: boolean): string {
  return dependeDoDono ? ' (depende de você)' : ''
}

/**
 * Quadro da retomada em markdown, por coluna: título do cartão e, quando existem, a prioridade e a marca
 * "depende de você". Se não couber tudo, entram primeiro os cartões que dependem do dono, depois os
 * bloqueados, os em andamento (e inacabado, em teste, falta deploy), os pendentes e por último as ideias.
 */
export function markdownDoQuadro(cartoes: readonly BoardCard[], limite: number, mascarar: (texto: string) => string): string {
  const entradas = cartoesEmAberto(cartoes).map((cartao) => ({
    grupo: NOME_DA_COLUNA[cartao.column],
    linha: `- ${cartao.title}${sufixoDaPrioridade(cartao.priority)}${sufixoDoDono(cartao.needsOwner)}`,
    importancia: importanciaDoCartao(cartao),
  }))
  return montarSecao('Quadro', entradas, limite, mascarar)
}

/** Backlog da retomada em markdown: só o título, a etapa e a prioridade de cada item em aberto, mais importantes primeiro. */
export function markdownDoBacklog(itens: readonly BacklogItem[], limite: number, mascarar: (texto: string) => string): string {
  const entradas = backlogEmAberto(itens).map((item, posicao) => ({
    grupo: '',
    linha: `- ${nomeDaEtapa(item.stage)}: ${item.title}${sufixoDaPrioridade(item.priority)}`,
    importancia: posicao,
  }))
  return montarSecao('Backlog', entradas, limite, mascarar)
}

/** Acrescenta ao fim de `texto` a seção que `montar` fizer com o que sobra do limite; se não couber, devolve `texto`. */
function acrescentarSecao(texto: string, limiteTotal: number, montar: (limite: number) => string): string {
  const separador = '\n\n'
  const limite = Math.min(LIMITE_DA_SECAO, limiteTotal - texto.length - separador.length)
  const secao = montar(limite)
  return secao === '' || secao.length > limite ? texto : `${texto}${separador}${secao}`
}

/**
 * Põe o quadro e o backlog no fim do markdown da retomada, só com a sobra de `limiteTotal`: o texto de
 * antes nunca é tocado nem espremido. O quadro usa a sobra (até o teto da seção), o backlog usa o que
 * sobrar depois dele; uma seção que não cabe nem com o título e o aviso de omitidos não entra.
 */
export function anexarQuadroEBacklog(
  markdownExistente: string,
  cartoes: readonly BoardCard[],
  itens: readonly BacklogItem[],
  limiteTotal: number,
  mascarar: (texto: string) => string,
): string {
  const comQuadro = acrescentarSecao(markdownExistente, limiteTotal, (limite) => markdownDoQuadro(cartoes, limite, mascarar))
  return acrescentarSecao(comQuadro, limiteTotal, (limite) => markdownDoBacklog(itens, limite, mascarar))
}
