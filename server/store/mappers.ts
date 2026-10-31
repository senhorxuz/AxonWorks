import type {
  Decision,
  DecisionSourceKind,
  DecisionStatus,
  TaskTransitionEvent,
  MessageResolution,
  CharterRevision,
  ProjectBlocker,
  BlockerStatus,
  WorkDraft,
  WorkDraftObservedCheck,
} from '../../shared/continuity.js'
import type { PortableHandoffDelivery, PortableHandoffReceipt } from '../../shared/portability.js'
import type { WorkIntent } from '../../shared/intent.js'
import type {
  ContentFormat,
  ContentItem,
  ContentKind,
  ContentRelation,
  ContentRelationKind,
  ContentRelationTarget,
  ContentRevision,
  ContentSourceKind,
  ContentValidity,
} from '../../shared/library.js'
import type {
  AgentMessage,
  BacklogItem,
  BacklogPriority,
  BacklogStage,
  Checkpoint,
  MessageInput,
  Project,
  Task,
  TaskStatus,
  AcceptanceCriterion,
  ExpectedOutput,
  TaskPriority,
  EvidenceArtifact,
  EvidenceOutcome,
  EvidenceRecord,
  EvidenceVerification,
  BlockerEvent,
  BlockerTransition,
  DecisionEvent,
  DecisionTransition,
  Evidence,
} from '../../shared/types.js'
import {
  CONTENT_KINDS,
  CONTENT_FORMATS,
  CONTENT_SOURCE_KINDS,
  CONTENT_VALIDITIES,
  CONTENT_RELATION_TARGETS,
  CONTENT_RELATION_KINDS,
  TASK_PRIORITIES,
  BACKLOG_PRIORITIES,
  BACKLOG_STAGES,
  EVIDENCE_OUTCOMES,
  MESSAGE_KINDS,
} from './constants.js'
import { camposDoSalvamento } from './salvamento.js'
import type { SqlRow } from './sql.js'
import { text, nullableText, numberish, requireWorkIntent } from './validation.js'

/**
 * Funções puras `map*(row)` que convertem uma linha SQL crua (SqlRow) no tipo de
 * domínio correspondente. Extraídas de server/store.ts — mesmos nomes, mesmo
 * comportamento, sem adaptação.
 *
 * `parseStoredIntent`, `parseStringArray`, `parseEvidence` e
 * `parseObservedChecks` também vivem aqui (não em `validation.ts`): são
 * parsers tolerantes de coluna JSON armazenada — nunca lançam `DomainError`,
 * só degradam para `null`/`[]` em conteúdo inválido — usados exclusivamente
 * pelos mappers acima (`mapTask`, `mapCheckpoint`, `mapWorkDraft`). Ficar sem
 * export, colocados ao lado do único consumidor, evita um quarto módulo para
 * ~50 linhas e evita reintroduzir uma dependência de volta a `store.ts`.
 */

function parseStoredIntent(raw: string | null): WorkIntent | null {
  if (!raw) return null
  try {
    return requireWorkIntent(JSON.parse(raw))
  } catch {
    return null
  }
}

function parseObservedChecks(raw: string): WorkDraftObservedCheck[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const result: WorkDraftObservedCheck[] = []
    for (const item of value) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
      const rec = item as Record<string, unknown>
      if (typeof rec.commandOrMethod !== 'string' || typeof rec.reportedOutcome !== 'string') continue
      result.push({
        commandOrMethod: rec.commandOrMethod,
        reportedOutcome: rec.reportedOutcome,
      })
    }
    return result
  } catch {
    return []
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return []
    return value
  } catch {
    return []
  }
}

function parseEvidence(raw: string): Evidence[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const result: Evidence[] = []
    for (const item of value) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
      const rec = item as Record<string, unknown>
      const outcome = rec.outcome
      result.push({
        command: typeof rec.command === 'string' ? rec.command : '',
        outcome:
          outcome === 'passed' || outcome === 'failed' || outcome === 'not_run' ? outcome : 'not_run',
        details: typeof rec.details === 'string' ? rec.details : '',
        provenance: 'agent_report',
      })
    }
    return result
  } catch {
    return []
  }
}

export function mapContentItem(row: SqlRow): ContentItem {
  const kind = text(row, 'kind')
  const status = text(row, 'status')
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    title: text(row, 'title'),
    kind: CONTENT_KINDS.has(kind as ContentKind) ? (kind as ContentKind) : 'note',
    status: status === 'archived' ? 'archived' : 'active',
    currentRevisionId: text(row, 'current_revision_id'),
    version: numberish(row.version),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  }
}

export function mapContentRevision(row: SqlRow): ContentRevision {
  const format = text(row, 'format')
  const sourceKind = text(row, 'source_kind')
  const validity = text(row, 'declared_validity')
  const sourceLabel = nullableText(row, 'source_label')
  const sourceUrl = nullableText(row, 'source_url')
  return {
    id: text(row, 'id'),
    itemId: text(row, 'item_id'),
    revision: numberish(row.revision),
    body: text(row, 'body'),
    format: CONTENT_FORMATS.has(format as ContentFormat) ? (format as ContentFormat) : 'plain_text',
    createdBy: text(row, 'created_by'),
    createdAt: text(row, 'created_at'),
    supersedesId: nullableText(row, 'supersedes_id'),
    sourceKind: CONTENT_SOURCE_KINDS.has(sourceKind as ContentSourceKind)
      ? (sourceKind as ContentSourceKind)
      : 'agent_report',
    ...(sourceLabel ? { sourceLabel } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    declaredValidity: CONTENT_VALIDITIES.has(validity as ContentValidity)
      ? (validity as ContentValidity)
      : 'current',
  }
}

export function mapContentRelation(row: SqlRow): ContentRelation {
  const targetType = text(row, 'target_type')
  const kind = text(row, 'kind')
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    sourceRevisionId: text(row, 'source_revision_id'),
    targetType: CONTENT_RELATION_TARGETS.has(targetType as ContentRelationTarget)
      ? (targetType as ContentRelationTarget)
      : 'content',
    targetId: text(row, 'target_id'),
    kind: CONTENT_RELATION_KINDS.has(kind as ContentRelationKind)
      ? (kind as ContentRelationKind)
      : 'related',
    createdBy: text(row, 'created_by'),
    createdAt: text(row, 'created_at'),
  }
}

export function mapProject(row: SqlRow): Project {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    objective: text(row, 'objective'),
    workspacePath: text(row, 'workspace_path'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: numberish(row.revision),
  }
}

export function mapTask(row: SqlRow): Task {
  const status = text(row, 'status')
  const mappedStatus: TaskStatus =
    status === 'in_progress' || status === 'blocked' || status === 'done' ? status : 'todo'
  const desc = nullableText(row, 'description')
  const priorityRaw = nullableText(row, 'priority')
  const priority: TaskPriority =
    priorityRaw && TASK_PRIORITIES.has(priorityRaw as TaskPriority) ? (priorityRaw as TaskPriority) : 'medium'

  let acceptanceCriteria: AcceptanceCriterion[] = []
  const acJson = nullableText(row, 'acceptance_criteria_json')
  if (acJson) {
    try {
      const parsed = JSON.parse(acJson)
      if (Array.isArray(parsed)) acceptanceCriteria = parsed
    } catch {
      acceptanceCriteria = []
    }
  }

  let dependencyTaskIds: string[] = []
  const depJson = nullableText(row, 'dependency_task_ids_json')
  if (depJson) {
    try {
      const parsed = JSON.parse(depJson)
      if (Array.isArray(parsed)) dependencyTaskIds = parsed
    } catch {
      dependencyTaskIds = []
    }
  }

  let expectedOutputs: ExpectedOutput[] = []
  const eoJson = nullableText(row, 'expected_outputs_json')
  if (eoJson) {
    try {
      const parsed = JSON.parse(eoJson)
      if (Array.isArray(parsed)) expectedOutputs = parsed
    } catch {
      expectedOutputs = []
    }
  }

  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    title: text(row, 'title'),
    ...(desc !== null && desc !== undefined ? { description: desc } : {}),
    priority,
    acceptanceCriteria,
    dependencyTaskIds,
    expectedOutputs,
    status: mappedStatus,
    assignee: nullableText(row, 'assignee'),
    leaseUntil: nullableText(row, 'lease_until'),
    version: numberish(row.version),
    createdAt: text(row, 'created_at'),
    blockedReason: nullableText(row, 'blocked_reason'),
    completionCheckpointId: nullableText(row, 'completion_checkpoint_id'),
    workIntent: parseStoredIntent(nullableText(row, 'work_intent_json')),
  }
}

export function mapTaskEvent(row: SqlRow): TaskTransitionEvent {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    taskId: text(row, 'task_id'),
    fromStatus: text(row, 'from_status'),
    toStatus: text(row, 'to_status'),
    agent: text(row, 'agent'),
    note: text(row, 'note'),
    checkpointId: nullableText(row, 'checkpoint_id'),
    createdAt: text(row, 'created_at'),
  }
}

export function mapPortableDelivery(row: SqlRow): PortableHandoffDelivery {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    checkpointId: text(row, 'checkpoint_id'),
    taskId: nullableText(row, 'task_id'),
    from: text(row, 'from_agent'),
    to: text(row, 'to_agent'),
    message: text(row, 'message'),
    createdAt: text(row, 'created_at'),
  }
}

export function mapPortableReceipt(row: SqlRow): PortableHandoffReceipt {
  return {
    projectId: text(row, 'project_id'),
    deliveryId: text(row, 'delivery_id'),
    agent: text(row, 'agent'),
    acknowledgedAt: text(row, 'acknowledged_at'),
  }
}

export function mapBacklogItem(row: SqlRow): BacklogItem {
  const priority = text(row, 'priority')
  const stage = text(row, 'stage')
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    title: text(row, 'title'),
    description: text(row, 'description'),
    priority: BACKLOG_PRIORITIES.has(priority as BacklogPriority) ? (priority as BacklogPriority) : 'medium',
    stage: BACKLOG_STAGES.has(stage as BacklogStage) ? (stage as BacklogStage) : 'idea',
    createdBy: text(row, 'created_by'),
    promotedTaskId: nullableText(row, 'promoted_task_id'),
    version: numberish(row.version),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  }
}

export function mapCharter(row: SqlRow): CharterRevision {
  const sourceKind = text(row, 'source_kind')
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    revision: numberish(row.revision),
    body: text(row, 'body'),
    createdBy: text(row, 'created_by'),
    createdAt: text(row, 'created_at'),
    sourceKind: sourceKind === 'agent_proposal' ? 'agent_proposal' : 'human_directive',
    supersedesId: nullableText(row, 'supersedes_id'),
  }
}

export function mapBlocker(row: SqlRow): ProjectBlocker {
  const status = text(row, 'status')
  const mapped: BlockerStatus =
    status === 'mitigated' || status === 'resolved' || status === 'accepted_risk' ? status : 'open'
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    taskId: nullableText(row, 'task_id'),
    title: text(row, 'title'),
    body: text(row, 'body'),
    status: mapped,
    openedBy: text(row, 'opened_by'),
    assignee: nullableText(row, 'assignee'),
    resolution: nullableText(row, 'resolution'),
    resolvedBy: nullableText(row, 'resolved_by'),
    resolvedAt: nullableText(row, 'resolved_at'),
    sourceCheckpointId: nullableText(row, 'source_checkpoint_id'),
    version: numberish(row.version),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  }
}

export function mapDecision(row: SqlRow): Decision {
  const sourceKind = text(row, 'source_kind') as DecisionSourceKind
  const sourceNote = nullableText(row, 'source_note')
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    title: text(row, 'title'),
    body: text(row, 'body'),
    status: text(row, 'status') as DecisionStatus,
    proposedBy: text(row, 'proposed_by'),
    acceptedBy: nullableText(row, 'accepted_by'),
    revokedBy: nullableText(row, 'revoked_by'),
    supersedesId: nullableText(row, 'supersedes_id'),
    supersededById: nullableText(row, 'superseded_by_id'),
    version: numberish(row.version),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    source: {
      kind: sourceKind === 'human_directive' ? 'human_directive' : 'agent_proposal',
      ...(sourceNote !== null ? { note: sourceNote } : {}),
    },
  }
}

export function mapCheckpoint(row: SqlRow): Checkpoint {
  // humanSummary (Parte 4): a coluna é NULL em checkpoints gravados antes do
  // campo existir e em checkpoints novos que não o informaram. Nesses casos o
  // campo fica ausente no objeto — nunca `null` —, para que o formato de
  // saída não distinga "nunca existiu" de "vazio".
  const humanSummary = nullableText(row, 'human_summary')
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    taskId: nullableText(row, 'task_id'),
    agent: text(row, 'agent'),
    summary: text(row, 'summary'),
    ...(humanSummary !== null ? { humanSummary } : {}),
    nextStep: text(row, 'next_step'),
    blockers: parseStringArray(text(row, 'blockers_json')),
    decisions: parseStringArray(text(row, 'decisions_json')),
    evidence: parseEvidence(text(row, 'evidence_json')),
    revision: numberish(row.revision),
    createdAt: text(row, 'created_at'),
    // Salvamento de compactação (D5): só o checkpoint marcado ganha `kind` e `extras`.
    ...camposDoSalvamento(row),
  }
}

export function mapEvidenceRecord(row: SqlRow): EvidenceRecord {
  const outcome = text(row, 'outcome')
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    checkpointId: text(row, 'checkpoint_id'),
    position: numberish(row.position),
    command: text(row, 'command'),
    outcome: EVIDENCE_OUTCOMES.has(outcome as Evidence['outcome']) ? (outcome as EvidenceOutcome) : 'not_run',
    details: text(row, 'details'),
    reportedBy: text(row, 'reported_by'),
    provenance: 'agent_report',
    createdAt: text(row, 'created_at'),
  }
}

export function mapEvidenceArtifact(row: SqlRow): EvidenceArtifact {
  return {
    id: text(row, 'id'),
    evidenceId: text(row, 'evidence_id'),
    path: text(row, 'path'),
    sha256: text(row, 'sha256'),
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : numberish(row.size_bytes),
    observedAt: text(row, 'observed_at'),
  }
}

export function mapEvidenceVerification(row: SqlRow): EvidenceVerification {
  return {
    id: text(row, 'id'),
    evidenceId: text(row, 'evidence_id'),
    verifiedBy: text(row, 'verified_by'),
    note: text(row, 'note'),
    createdAt: text(row, 'created_at'),
  }
}

export function mapBlockerEvent(row: SqlRow): BlockerEvent {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    blockerId: text(row, 'blocker_id'),
    transition: text(row, 'transition') as BlockerTransition,
    fromStatus: nullableText(row, 'from_status') as BlockerStatus | null,
    toStatus: text(row, 'to_status') as BlockerStatus,
    actor: text(row, 'actor'),
    note: nullableText(row, 'note'),
    version: numberish(row.version),
    createdAt: text(row, 'created_at'),
  }
}

export function mapDecisionEvent(row: SqlRow): DecisionEvent {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    decisionId: text(row, 'decision_id'),
    transition: text(row, 'transition') as DecisionTransition,
    fromStatus: nullableText(row, 'from_status') as DecisionStatus | null,
    toStatus: text(row, 'to_status') as DecisionStatus,
    actor: text(row, 'actor'),
    note: nullableText(row, 'note'),
    relatedDecisionId: nullableText(row, 'related_decision_id'),
    version: numberish(row.version),
    createdAt: text(row, 'created_at'),
  }
}

export function mapMessage(row: SqlRow): AgentMessage {
  const kind = text(row, 'kind')
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    from: text(row, 'from_agent'),
    to: text(row, 'to_agent'),
    kind: MESSAGE_KINDS.has(kind as MessageInput['kind']) ? (kind as MessageInput['kind']) : 'note',
    body: text(row, 'body'),
    createdAt: text(row, 'created_at'),
  }
}

export function mapWorkDraft(row: SqlRow): WorkDraft {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    actorId: text(row, 'actor_id'),
    taskId: nullableText(row, 'task_id'),
    version: numberish(row.version),
    status: 'undelivered',
    summary: text(row, 'summary'),
    nextAction: text(row, 'next_action'),
    changedAreas: parseStringArray(text(row, 'changed_areas_json')),
    openIssues: parseStringArray(text(row, 'open_issues_json')),
    observedChecks: parseObservedChecks(text(row, 'observed_checks_json')),
    updatedAt: text(row, 'updated_at'),
  }
}

export function mapMessageResolution(row: SqlRow, prefix = ''): MessageResolution {
  return {
    projectId: text(row, `${prefix}project_id`),
    messageId: text(row, `${prefix}message_id`),
    agent: text(row, `${prefix}agent`),
    note: text(row, `${prefix}note`),
    responseMessageId: nullableText(row, `${prefix}response_message_id`),
    checkpointId: nullableText(row, `${prefix}checkpoint_id`),
    resolvedAt: text(row, `${prefix}resolved_at`),
  }
}
