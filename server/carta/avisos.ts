// Avisos curtos (lote 2): trabalho não registrado (D1, do git da pasta da sessão) e diretriz velha (D2,
// com um texto para a tela do dono e outro para a retomada do Claude).
// Puro: sem relógio, sem banco, sem processo. Frases em afirmação, não em ordem.
import type { EstadoDoGit } from '../ganchos/git.js'

/** D1: a retomada lista até tantos títulos; o git lê um a mais para saber que houve mais. */
const TITULOS_DO_TRABALHO = 5
/** D2: a diretriz é velha com tantos dias ou mais e tantos registros ou mais depois dela. */
export const DIAS_PARA_DIRETRIZ_VELHA = 14
export const CHECKPOINTS_PARA_DIRETRIZ_VELHA = 5

const MS_POR_DIA = 86_400_000

const contar = (n: number, singular: string, plural: string): string => `${n} ${n === 1 ? singular : plural}`

function parteDosCommits(commits: EstadoDoGit['commits']): string {
  const lista = commits
    .slice(0, TITULOS_DO_TRABALHO)
    .map((c) => `${c.hash} ${c.titulo}`.trim())
    .join('; ')
  if (commits.length > TITULOS_DO_TRABALHO) {
    return `mais de ${TITULOS_DO_TRABALHO} commits depois do registro mais recente (os ${TITULOS_DO_TRABALHO} mais novos: ${lista})`
  }
  return `${contar(commits.length, 'commit', 'commits')} depois do registro mais recente (${lista})`
}

/** D1: commits depois do registro mais recente e arquivos alterados sem commit; sem nenhum dos dois, `null`. */
export function fraseDoTrabalhoNaoRegistrado(estado: EstadoDoGit): string | null {
  const partes: string[] = []
  if (estado.commits.length > 0) partes.push(parteDosCommits(estado.commits))
  if (estado.alterados > 0) partes.push(contar(estado.alterados, 'arquivo alterado sem commit', 'arquivos alterados sem commit'))
  return partes.length === 0 ? null : `Trabalho não registrado na Axon: ${partes.join(' e ')}.`
}

/** O dono vive no fuso de São Paulo: a data é a dele. */
const FORMATO_DA_DATA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** D2: o mesmo aviso em dois textos. A tela fala com o dono; a retomada fala com o Claude. */
export interface AvisosDaDiretrizVelha {
  /** Para a tela "Onde paramos": sem nome de ferramenta. */
  paraODono: string
  /** Para a retomada do Claude: com a ferramenta que propõe a atualização. */
  paraOClaude: string
}

/**
 * D2: a diretriz vigente tem `DIAS_PARA_DIRETRIZ_VELHA` dias ou mais e houve
 * `CHECKPOINTS_PARA_DIRETRIZ_VELHA` registros ou mais depois dela. Sem diretriz, ou antes disso, `null`.
 */
export function avisosDaDiretrizVelha(
  diretriz: { createdAt: string } | null | undefined,
  checkpoints: Array<{ createdAt: string }>,
  agora: Date,
): AvisosDaDiretrizVelha | null {
  if (!diretriz) return null
  const desde = Date.parse(diretriz.createdAt)
  if (agora.getTime() - desde < DIAS_PARA_DIRETRIZ_VELHA * MS_POR_DIA) return null
  const depois = checkpoints.filter((c) => Date.parse(c.createdAt) > desde).length
  if (depois < CHECKPOINTS_PARA_DIRETRIZ_VELHA) return null
  const data = FORMATO_DA_DATA.format(desde)
  return {
    paraODono:
      `A diretriz deste projeto não muda desde ${data}, e desde então houve ${depois} registros. ` +
      'Se o projeto mudou, o Claude pode propor a atualização, e você aprova aqui na Axon.',
    paraOClaude:
      `A diretriz deste projeto não muda desde ${data}; depois dela houve ${depois} registros. ` +
      'Quando o estado mudou (por exemplo, a versão no ar), a atualização é proposta com save_charter e o dono aprova na tela.',
  }
}
