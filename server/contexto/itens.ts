/**
 * Itens do contexto compilado: como cada um vira linha de markdown, fonte citada e,
 * no caso do checkpoint, forma curta. Sem banco e sem relógio.
 */
import type { ContextItem, ContextSection, ContextSectionKind, ContextSourceReference } from '../../shared/context.js'
import type { Checkpoint } from '../../shared/types.js'
import { maskSecrets } from '../handoff.js'
import type { ItemCandidato, SecaoEscolhida } from './orcamento.js'

export function linhaDoItem(item: ContextItem): string {
  return maskSecrets(`\n- [${item.sourceType}] **${item.title}**: ${item.body}`)
}

export function itemCandidatoDoContexto(item: ContextItem, curto: ContextItem | undefined): ItemCandidato<ContextItem> {
  return curto
    ? { dado: item, texto: linhaDoItem(item), curto: { dado: curto, texto: linhaDoItem(curto) } }
    : { dado: item, texto: linhaDoItem(item) }
}

export function fonteDoItem(item: ContextItem): ContextSourceReference {
  return {
    sourceId: item.id,
    sourceType: item.sourceType,
    revisionId: item.revisionId ?? null,
    revisionNo: item.revisionNo ?? null,
    provenance: item.provenance,
    authority: item.authority,
    declaredValidity: item.declaredValidity ?? null,
    reason: item.reason,
  }
}

export function corpoDoCheckpoint(checkpoint: Checkpoint): string {
  return [
    `Resumo: ${checkpoint.summary}`,
    ...(checkpoint.humanSummary ? [`Para o dono do projeto: ${checkpoint.humanSummary}`] : []),
    `Próximo passo: ${checkpoint.nextStep}`,
  ].join('\n')
}

export function corpoCurtoDoCheckpoint(checkpoint: Checkpoint): string {
  return [
    ...(checkpoint.humanSummary ? [`Para o dono do projeto: ${checkpoint.humanSummary}`] : []),
    `Próximo passo: ${checkpoint.nextStep}`,
    '(inteiro: get_resume_brief)',
  ].join('\n')
}

export function itemDoCheckpoint(checkpoint: Checkpoint, emFoco: boolean): ContextItem {
  return {
    id: checkpoint.id,
    sourceType: 'checkpoint',
    title: `Checkpoint revisão ${checkpoint.revision} por ${checkpoint.agent}`,
    body: corpoDoCheckpoint(checkpoint),
    revisionNo: checkpoint.revision,
    provenance: 'agent_report',
    reason: emFoco
      ? 'Último checkpoint registrado para a tarefa em foco.'
      : 'Último checkpoint geral registrado no projeto.',
    meta: {
      blockers: checkpoint.blockers,
      decisions: checkpoint.decisions,
      ...(checkpoint.humanSummary ? { humanSummary: checkpoint.humanSummary } : {}),
    },
  }
}

export function formaCurtaDoCheckpoint(item: ContextItem, checkpoint: Checkpoint): ContextItem {
  return { ...item, body: corpoCurtoDoCheckpoint(checkpoint), shortened: true }
}

/** Até quantos caracteres do começo da diretriz entram quando ela inteira não cabe. */
export const TAMANHO_DA_DIRETRIZ_CURTA = 300
const FIM_DA_DIRETRIZ_CURTA = ' […] (inteiro: get_charter)'

/** Maior começo de `texto` com até `maximo` caracteres que termina numa palavra inteira. */
export function cortarEmPalavra(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto
  const trecho = texto.slice(0, maximo + 1)
  const ultimoEspaco = trecho.search(/\s\S*$/)
  return (ultimoEspaco > 0 ? trecho.slice(0, ultimoEspaco) : texto.slice(0, maximo)).trimEnd()
}

/**
 * A diretriz (charter) que não cabe inteira entra pelo começo, cortado em palavra, com o aviso de onde ler o
 * resto: sem forma curta, ela saía do contexto inteira e cartões comuns do quadro entravam no lugar (banco
 * real, 20/11/2026). Diretriz curta o bastante não ganha forma curta (`null`).
 */
export function formaCurtaDaDiretriz(item: ContextItem): ContextItem | null {
  if (item.body.length <= TAMANHO_DA_DIRETRIZ_CURTA) return null
  return { ...item, body: `${cortarEmPalavra(item.body, TAMANHO_DA_DIRETRIZ_CURTA)}${FIM_DA_DIRETRIZ_CURTA}`, shortened: true }
}

export function secoesDoEnvelope(escolhidas: SecaoEscolhida<ContextItem>[]): ContextSection[] {
  return escolhidas.map((sec) => ({
    kind: sec.kind as ContextSectionKind,
    title: sec.titulo,
    items: sec.itens.map((item) => item.dado),
    omittedCount: sec.omitidos > 0 ? sec.omitidos : undefined,
  }))
}
