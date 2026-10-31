import type { ResumeFocusMode } from './continuity.js'

export type ContextProvenance =
  | 'human_directive'
  | 'agent_report'
  | 'authorized_system'
  | 'external_source'

export type ContextAuthority = 'directive' | 'reference' | 'proposal'

export type ContextSourceType =
  | 'project'
  | 'charter'
  | 'task'
  | 'checkpoint'
  | 'decision'
  | 'blocker'
  | 'content'
  | 'delivery'
  | 'message'
  | 'work_draft'
  /** Evidencia declarada em checkpoint, com artefatos e frescor recalculado na leitura. */
  | 'evidence'
  /** Cartão do quadro que ainda não foi encerrado. */
  | 'board_card'
  /** Item do backlog (ideia ou pronto) que ainda não virou tarefa. */
  | 'backlog_item'

export interface ContextSourceReference {
  sourceId: string
  sourceType: ContextSourceType
  revisionId?: string | null
  revisionNo?: number | null
  provenance: ContextProvenance
  authority?: ContextAuthority
  declaredValidity?: string | null
  reason: string
}

export interface ContextItem {
  id: string
  sourceType: ContextSourceType
  title: string
  body: string
  revisionId?: string | null
  revisionNo?: number | null
  provenance: ContextProvenance
  authority?: ContextAuthority
  declaredValidity?: string | null
  reason: string
  meta?: Record<string, unknown>
}

export type ContextSectionKind =
  | 'charter'
  | 'focus_task'
  | 'checkpoint'
  | 'decisions'
  | 'blockers'
  | 'library_content'
  | 'deliveries'
  | 'attention'
  | 'work_draft'
  | 'overlaps'
  | 'inbox'
  /**
   * Evidencias que deixaram de cobrir a versao atual do codigo.
   *
   * Uma IA que retoma precisa saber que o resultado registrado no checkpoint
   * anterior foi medido sobre arquivos que ja mudaram. Sem isso a feature
   * existe mas ninguem esbarra nela no momento em que importa.
   */
  | 'stale_evidence'
  /** Cartões do quadro ainda não encerrados (fora de Completo e Descartado). */
  | 'board'
  /** Itens do backlog em aberto: ideias e prontos. */
  | 'backlog'

export interface ContextSection {
  kind: ContextSectionKind
  title: string
  items: ContextItem[]
  omittedCount?: number
}

export type ContextConflictKind =
  | 'overlap'
  | 'ambiguous_focus'
  | 'stale_content'
  | 'contradiction'

export interface ContextConflict {
  kind: ContextConflictKind
  description: string
  entityIds: string[]
}

export interface ContextRequest {
  agent: string
  taskId?: string | null
  focusMode?: ResumeFocusMode
  maxChars?: number
  includeOutdatedContent?: boolean
}

export interface ContextEnvelope {
  contextSequence: number
  generatedAt: string
  projectId: string
  projectName: string
  revision: number
  charterRevisionId: string | null
  charterRevisionNo: number | null
  focusTaskId: string | null
  focusMode: ResumeFocusMode
  agent: string
  sections: ContextSection[]
  includedSources: ContextSourceReference[]
  omittedCounts: Record<string, number>
  cutSections: string[]
  conflicts: ContextConflict[]
  markdown: string
  truncated: boolean
}
