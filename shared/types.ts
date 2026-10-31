import type {
  AcceptanceCriterion,
  AcceptanceCriterionInput,
  CreateTaskContractFields,
  ExpectedOutput,
  ExpectedOutputInput,
  ExpectedOutputKind,
  TaskPriority,
  UpdateTaskContractInput,
} from './task-contract.js'
import type { EvidenceInput } from './evidence.js'
import type { WorkIntent } from './intent.js'

export interface Project { id: string; name: string; objective: string; workspacePath: string; createdAt: string; updatedAt: string; revision: number }
export interface CreateProject { name: string; objective: string; workspacePath?: string }
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'
export interface Task {
  id: string
  projectId: string
  title: string
  status: TaskStatus
  assignee: string | null
  leaseUntil: string | null
  version: number
  createdAt: string
  blockedReason: string | null
  completionCheckpointId: string | null
  workIntent: WorkIntent | null
  description?: string | null
  priority?: TaskPriority
  acceptanceCriteria?: AcceptanceCriterion[]
  dependencyTaskIds?: string[]
  expectedOutputs?: ExpectedOutput[]
}
export interface CreateTaskInput extends CreateTaskContractFields {
  title: string
}
export interface Evidence { command: string; outcome: 'passed' | 'failed' | 'not_run'; details: string; provenance: 'agent_report' }
/**
 * `humanSummary` (Parte 4): frase curta e opcional, em português simples, escrita
 * para o dono do projeto — que não é programador. `summary` continua em jargão
 * técnico, para outras IAs. Ausente em checkpoints antigos; nunca inferida.
 */
/**
 * `kind` e `extras` (salvamento de compactação, D5): só aparecem no checkpoint gravado por
 * `save_compaction_snapshot` (`kind: 'compactacao'`). Ausentes = checkpoint normal, como sempre foi.
 */
export interface Checkpoint { id: string; projectId: string; taskId: string | null; agent: string; summary: string; humanSummary?: string; nextStep: string; blockers: string[]; decisions: string[]; evidence: Evidence[]; revision: number; createdAt: string; kind?: CheckpointKind; extras?: ExtrasDoSalvamento }
export type CheckpointKind = 'normal' | 'compactacao'
/** O que o salvamento de compactação guarda além do checkpoint comum. */
export interface ExtrasDoSalvamento { pedidosDoDono: string[]; pendencias: string[]; perguntasAbertas: string[]; arquivosMexidos: string[] }
/** Entrada de `save_compaction_snapshot` (sem o `projectId`). `humanSummary` é obrigatório aqui. */
export interface CompactionSnapshotInput { expectedRevision: number; idempotencyKey: string; agent: string; summary: string; humanSummary: string; nextStep: string; decisions?: string[]; pedidosDoDono: string[]; pendencias: string[]; perguntasAbertas?: string[]; arquivosMexidos?: string[] }
export interface CheckpointInput { expectedRevision: number; idempotencyKey: string; taskId?: string; agent: string; summary: string; humanSummary?: string; nextStep: string; blockers?: string[]; decisions?: string[]; evidence?: EvidenceInput[] }
export interface MessageInput { from: string; to: string; kind: 'note' | 'question' | 'review' | 'handoff'; body: string }
export interface AgentMessage extends MessageInput { id: string; projectId: string; createdAt: string }
export interface ProjectDetail { project: Project; tasks: Task[]; checkpoints: Checkpoint[]; messages: AgentMessage[] }
export interface Handoff { markdown: string; revision: number; truncated: boolean; generatedAt: string }

export type BacklogPriority = 'urgent' | 'high' | 'medium' | 'low'
export type BacklogStage = 'idea' | 'ready' | 'promoted' | 'archived'
export type BacklogEditableStage = 'idea' | 'ready'

export interface BacklogItem {
  id: string
  projectId: string
  title: string
  description: string
  priority: BacklogPriority
  stage: BacklogStage
  createdBy: string
  promotedTaskId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface CreateBacklogItemInput {
  title: string
  createdBy: string
  description?: string
  priority?: BacklogPriority
  stage?: BacklogEditableStage
}

export interface UpdateBacklogItemInput {
  expectedVersion: number
  title?: string
  description?: string
  priority?: BacklogPriority
  stage?: BacklogEditableStage
}

export interface ArchiveBacklogItemInput {
  expectedVersion: number
}

export interface GetBacklogOptions {
  includeClosed?: boolean
}

export interface PromoteBacklogResult {
  item: BacklogItem
  task: Task
}

export interface DeletedProject {
  projectId: string
  deletedAt: string
}

export interface DeletedBacklogItem {
  projectId: string
  itemId: string
  deletedAt: string
}

export type {
  AcceptDecisionInput,
  Decision,
  DecisionSource,
  DecisionSourceKind,
  DecisionStatus,
  ListDecisionsOptions,
  ProposeDecisionInput,
  RevokeDecisionInput,
  SupersedeDecisionInput,
} from './continuity.js'

export type {
  ContextAuthority,
  ContextConflict,
  ContextConflictKind,
  ContextEnvelope,
  ContextItem,
  ContextProvenance,
  ContextRequest,
  ContextSection,
  ContextSectionKind,
  ContextSourceReference,
  ContextSourceType,
} from './context.js'

export type {
  AcceptanceCriterion,
  AcceptanceCriterionInput,
  CreateTaskContractFields,
  ExpectedOutput,
  ExpectedOutputInput,
  ExpectedOutputKind,
  TaskPriority,
  UpdateTaskContractInput,
} from './task-contract.js'

export type {
  ArtifactFreshness,
  CrossCheckEvidenceInput,
  EvidenceArtifact,
  EvidenceArtifactInput,
  EvidenceArtifactStatus,
  EvidenceAssertion,
  EvidenceFreshness,
  EvidenceInput,
  EvidenceOutcome,
  EvidenceProvenance,
  EvidenceRecord,
  EvidenceVerification,
  EvidenceView,
  ListEvidenceOptions,
  RegisterEvidenceArtifactsInput,
} from './evidence.js'

export type {
  BlockerEvent,
  BlockerTimeline,
  BlockerTransition,
  DecisionEvent,
  DecisionTimeline,
  DecisionTransition,
  EntityTimeline,
  ListEntityEventsOptions,
} from './events.js'

export type {
  ApprovalKind,
  ApprovalRequest,
  ApprovalStatus,
  DecideApprovalInput,
  ListApprovalsOptions,
  ProposeApprovalInput,
  WithdrawApprovalInput,
} from './approvals.js'

export type {
  AgentActivitySummary,
  ComputeInsightsOptions,
  InsightSignal,
  InsightSourceType,
  InsightsMomentum,
  InsightsSignals,
  NextAction,
  NextActionKind,
  ProjectInsights,
  StalledTask,
} from './insights.js'

export interface ConnectorsInfo {
  projectRoot: string
  nodeExecutable: string
  mcpCommand: string
  mcpArgs: string[]
  port: number
  platform: string
}

export type {
  BoardColumnId,
  BoardLabelId,
  BoardPriority,
  BoardChecklistItem,
  BoardCard,
  BoardCardEventKind,
  BoardCardEvent,
  BoardSnapshot,
  CreateBoardCardInput,
  UpdateBoardCardInput,
  MoveBoardCardInput,
  DeleteBoardCardInput,
} from './board.js'



