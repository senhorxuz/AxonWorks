/**
 * Eventos imutáveis de entidade.
 *
 * Bloqueios e decisões guardavam apenas o retrato atual: mitigar, resolver,
 * aceitar risco e reabrir escreviam por cima dos mesmos campos. Reabrir um
 * bloqueio apagava a resolução anterior, e a nota de revogação de uma decisão
 * contaminava a origem da proposta — dois fatos diferentes no mesmo campo.
 *
 * A partir daqui a entidade continua guardando o retrato atual e cada
 * transição vira um evento append-only. Nenhum evento é editado ou removido.
 * O histórico deixa de ser reescrito para combinar com o estado presente.
 */

import type { BlockerStatus, DecisionStatus } from './continuity.js'

export type BlockerTransition = 'opened' | 'mitigated' | 'resolved' | 'accepted_risk' | 'reopened'

export type DecisionTransition = 'proposed' | 'accepted' | 'revoked' | 'superseded' | 'replaced_by'

export interface BlockerEvent {
  id: string
  projectId: string
  blockerId: string
  transition: BlockerTransition
  /** Estado imediatamente anterior. `null` apenas na abertura. */
  fromStatus: BlockerStatus | null
  toStatus: BlockerStatus
  /** Identidade declarada de quem provocou a transição. */
  actor: string
  note: string | null
  /** Versão do bloqueio resultante desta transição. */
  version: number
  createdAt: string
}

export interface DecisionEvent {
  id: string
  projectId: string
  decisionId: string
  transition: DecisionTransition
  /** Estado imediatamente anterior. `null` apenas na proposta. */
  fromStatus: DecisionStatus | null
  toStatus: DecisionStatus
  actor: string
  /**
   * Motivo desta transição. É um fato distinto da origem da decisão
   * (`Decision.source`), que nunca deve ser sobrescrita por ele.
   */
  note: string | null
  /** Decisão relacionada em transições de substituição. */
  relatedDecisionId: string | null
  version: number
  createdAt: string
}

export interface ListEntityEventsOptions {
  limit?: number
}

/** Linha do tempo unificada de uma entidade, em ordem cronológica crescente. */
export interface EntityTimeline<TEvent> {
  entityId: string
  projectId: string
  events: TEvent[]
}

export type BlockerTimeline = EntityTimeline<BlockerEvent>
export type DecisionTimeline = EntityTimeline<DecisionEvent>
