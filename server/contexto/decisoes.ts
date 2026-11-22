/**
 * As decisões do contexto compilado, puras: quem manda na fonte, qual tarefa fica em foco e quais lições
 * são do dono. `secoes.ts` só chama estas funções e monta as seções.
 */
import type { ContextAuthority, ContextProvenance, ContextSection } from '../../shared/context.js'
import type { ResumeFocusMode } from '../../shared/continuity.js'
import type { Licao } from '../../shared/licoes.js'
import type { Task } from '../../shared/types.js'

/** Só a diretriz do dono manda; relato de agente e fonte externa são referência. */
export function autoridadeDaFonte(provenance: ContextProvenance): ContextAuthority {
  return provenance === 'human_directive' ? 'directive' : 'reference'
}

/** Modo projeto não tem tarefa em foco; senão vale a pedida, ou a única reservada pelo agente. */
export function escolherTarefaEmFoco(mode: ResumeFocusMode, pedida: Task | null, reservadas: Task[]): Task | null {
  if (mode === 'project') return null
  return pedida ?? (reservadas.length === 1 ? reservadas[0]! : null)
}

/** Regra e verificação vêm da fala do dono; o erro, que a IA anota sozinha, fica de fora, na ordem em que veio. */
export function gruposDasLicoesDoDono(licoes: Licao[]): { regras: Licao[]; verificacoes: Licao[] } {
  return {
    regras: licoes.filter((licao) => licao.tipo === 'regra'),
    verificacoes: licoes.filter((licao) => licao.tipo === 'verificacao'),
  }
}

/** Uma seção com os itens, ou nenhuma quando não há item (seção vazia não entra no contexto). */
export function secaoSeHouverItens<T>(itens: T[], montar: (itens: T[]) => ContextSection): ContextSection[] {
  return itens.length > 0 ? [montar(itens)] : []
}
