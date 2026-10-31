import type { IntentOverlap } from './intent.js'
import type { AgentMessage, BacklogPriority, BacklogStage, Checkpoint, Evidence, Project, ProjectDetail, Task } from './types.js'
import type { BoardColumnId, BoardPriority } from './board.js'
import type { EvidenceInput } from './evidence.js'
import type { ApprovalRequest } from './approvals.js'

/**
 * Cartão do quadro como a retomada o guarda: o bastante para saber o que existe e em que estado, sem
 * descrição, etiquetas nem checklist (quem precisar do cartão inteiro lê o quadro).
 */
export interface ResumoDeCartao {
  id: string
  column: BoardColumnId
  title: string
  priority: BoardPriority | null
  /** O cartão espera uma decisão ou uma ação do dono ("depende de você"). */
  needsOwner: boolean
  version: number
}

/** Item do backlog como a retomada o guarda: sem descrição. */
export interface ResumoDeItemDoBacklog {
  id: string
  stage: BacklogStage
  title: string
  priority: BacklogPriority
  version: number
}

export interface SearchResult {
  projectId: string
  projectName: string
  kind: 'project' | 'checkpoint' | 'message' | 'task'
  recordId: string
  excerpt: string
}

export interface InboxItem {
  message: AgentMessage
  acknowledgedAt: string | null
  resolution: MessageResolution | null
}

export interface GetInboxOptions {
  unreadOnly?: boolean
}

export interface AcknowledgeMessageInput {
  agent: string
}

export interface MessageAcknowledgement {
  messageId: string
  agent: string
  acknowledgedAt: string
}

export interface ResolveMessageAttentionInput {
  agent: string
  note?: string
  responseMessageId?: string
  checkpointId?: string
}

export interface MessageResolution {
  projectId: string
  messageId: string
  agent: string
  note: string
  responseMessageId: string | null
  checkpointId: string | null
  resolvedAt: string
}

export interface ImportProjectResult {
  project: Project
  sourceProjectId: string
  idMap: Record<string, string>
}

export type { ProjectBundleData } from './portability.js'

export interface HistoricalDecision {
  decision: string
  checkpointId: string
  revision: number
  agent: string
  createdAt: string
}

export type AttentionKind = 'blocker' | 'question' | 'review' | 'handoff'

export interface AttentionItem {
  kind: AttentionKind
  text: string
  sourceId: string
}

export interface CreateHandoffDeliveryInput {
  checkpointId: string
  from: string
  to: string
  message?: string
  taskId?: string
}

export interface HandoffDelivery {
  id: string
  projectId: string
  checkpointId: string
  taskId: string | null
  from: string
  to: string
  message: string
  createdAt: string
  acknowledgedAt: string | null
  checkpoint: Checkpoint
  task: Task | null
}

export interface GetHandoffDeliveriesOptions {
  unreadOnly?: boolean
}

export interface AcknowledgeHandoffDeliveryInput {
  agent: string
}

export interface HandoffDeliveryAcknowledgement {
  deliveryId: string
  agent: string
  acknowledgedAt: string
}

export type ResumeFocusMode = 'auto' | 'project'

export interface WorkDraftObservedCheck {
  commandOrMethod: string
  reportedOutcome: string
}

export interface WorkDraft {
  id: string
  projectId: string
  actorId: string
  taskId: string | null
  version: number
  status: 'undelivered'
  summary: string
  nextAction: string
  changedAreas: string[]
  openIssues: string[]
  observedChecks: WorkDraftObservedCheck[]
  updatedAt: string
}

export interface SaveWorkDraftInput {
  agent: string
  expectedVersion: number
  taskId?: string | null
  summary: string
  nextAction: string
  changedAreas?: string[]
  openIssues?: string[]
  observedChecks?: WorkDraftObservedCheck[]
}

export interface DiscardWorkDraftInput {
  agent: string
  expectedVersion: number
  taskId?: string | null
}

export interface DiscardedWorkDraft {
  projectId: string
  actorId: string
  taskId: string | null
  discardedAt: string
}

export type FinalizeTaskTransition =
  | { kind: 'keep_claimed' }
  | { kind: 'release' }
  | { kind: 'declare_blocked'; reason: string; retainLease?: boolean }
  | { kind: 'declare_done' }

export interface ReopenTaskInput {
  agent: string
  expectedVersion: number
  note: string
}

export interface TaskTransitionEvent {
  id: string
  projectId: string
  taskId: string
  fromStatus: string
  toStatus: string
  agent: string
  note: string
  checkpointId: string | null
  createdAt: string
}

export interface FinalizeWorkDeliveryInput {
  to: string
  message?: string
}

export interface FinalizeWorkInput {
  agent: string
  expectedRevision: number
  idempotencyKey: string
  summary: string
  humanSummary?: string
  nextStep: string
  taskId?: string
  blockers?: string[]
  decisions?: string[]
  evidence?: EvidenceInput[]
  delivery?: FinalizeWorkDeliveryInput
  taskTransition: FinalizeTaskTransition
  discardDraft?: boolean
  draftId?: string
  expectedDraftVersion?: number
}

export interface FinalizeWorkResult {
  checkpoint: Checkpoint
  delivery: HandoffDelivery | null
  task: Task | null
  draftDiscarded: boolean
}

export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'revoked'

export type DecisionSourceKind = 'agent_proposal' | 'human_directive'

export interface DecisionSource {
  kind: DecisionSourceKind
  note?: string
}

export interface Decision {
  id: string
  projectId: string
  title: string
  body: string
  status: DecisionStatus
  proposedBy: string
  acceptedBy: string | null
  revokedBy: string | null
  supersedesId: string | null
  supersededById: string | null
  version: number
  createdAt: string
  updatedAt: string
  source: DecisionSource
}

export interface ProposeDecisionInput {
  agent: string
  title: string
  body: string
  note?: string
  source?: {
    kind?: DecisionSourceKind
    note?: string
  }
}

export interface AcceptDecisionInput {
  actor: string
  expectedVersion: number
}

export interface RevokeDecisionInput {
  actor: string
  expectedVersion: number
  note?: string
}

export interface SupersedeDecisionInput {
  actor: string
  expectedVersion: number
  title: string
  body: string
  note?: string
}

export interface ListDecisionsOptions {
  includeHistory?: boolean
}

export type CharterSourceKind = 'human_directive' | 'agent_proposal'

export interface CharterRevision {
  id: string
  projectId: string
  revision: number
  body: string
  createdBy: string
  createdAt: string
  sourceKind: CharterSourceKind
  supersedesId: string | null
}

export interface SaveCharterInput {
  actor: string
  body: string
  expectedRevision: number
  sourceKind?: CharterSourceKind
}

export type BlockerStatus = 'open' | 'mitigated' | 'resolved' | 'accepted_risk'

export interface ProjectBlocker {
  id: string
  projectId: string
  taskId: string | null
  title: string
  body: string
  status: BlockerStatus
  openedBy: string
  assignee: string | null
  resolution: string | null
  resolvedBy: string | null
  resolvedAt: string | null
  sourceCheckpointId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface OpenBlockerInput {
  agent: string
  title: string
  body: string
  taskId?: string | null
  assignee?: string | null
  sourceCheckpointId?: string | null
}

export interface TransitionBlockerInput {
  agent: string
  expectedVersion: number
  note: string
}

export interface ListBlockersOptions {
  includeClosed?: boolean
}

export interface ResumeBrief {
  project: Project
  generatedAt: string
  revision: number
  focusTask: Task | null
  claimedTasks: Task[]
  availableTasks: Task[]
  latestTaskCheckpoint: Checkpoint | null
  latestProjectCheckpoint: Checkpoint | null
  /**
   * Alias temporário do checkpoint efetivo para clientes anteriores:
   * o checkpoint da tarefa quando há foco, ou o geral quando não há.
   */
  latestCheckpoint: Checkpoint | null
  workDraft: WorkDraft | null
  workDrafts: WorkDraft[]
  inbox: InboxItem[]
  deliveries: HandoffDelivery[]
  attention: AttentionItem[]
  decisions: Decision[]
  charter: CharterRevision | null
  blockers: ProjectBlocker[]
  overlaps: IntentOverlap[]
  /**
   * Propostas pendentes na fila de aprovações (Parte 5) — a seção "Esperando
   * por você". Só o dono decide; a lista existe para que ele veja o que está
   * parado sem precisar ler o chat de uma IA.
   */
  pendingApprovals: ApprovalRequest[]
  /**
   * Cartões do quadro que ainda não foram encerrados (fora de Completo e
   * Descartado), na ordem das colunas e, dentro de cada uma, pela posição.
   * Só o resumo de cada um: sem descrição nem checklist.
   */
  boardCards: ResumoDeCartao[]
  /** Itens do backlog em aberto (ideia ou pronto), prioridade primeiro. Sem descrição. */
  backlogItems: ResumoDeItemDoBacklog[]
  markdown: string
}
