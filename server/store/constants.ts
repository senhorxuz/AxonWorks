import type {
  MessageInput,
  Evidence,
  BacklogPriority,
  BacklogEditableStage,
  BacklogStage,
  TaskPriority,
  ExpectedOutputKind,
} from '../../shared/types.js'
import type { ResumeFocusMode } from '../../shared/continuity.js'
import type {
  ContentKind,
  ContentFormat,
  ContentSourceKind,
  ContentValidity,
  ContentRelationTarget,
  ContentRelationKind,
} from '../../shared/library.js'

/**
 * Regex e conjuntos de valores válidos por campo — o vocabulário fechado que
 * os 33 helpers de validação usam para aceitar/rejeitar entrada, e que os 21
 * mappers usam para decidir o valor de fallback ao ler uma linha do banco.
 * Extraído de server/store.ts — mesmos nomes, mesmos valores, sem adaptação.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MESSAGE_KINDS = new Set<MessageInput['kind']>(['note', 'question', 'review', 'handoff'])
export const EVIDENCE_OUTCOMES = new Set<Evidence['outcome']>(['passed', 'failed', 'not_run'])
export const BACKLOG_PRIORITIES = new Set<BacklogPriority>(['urgent', 'high', 'medium', 'low'])
export const BACKLOG_EDITABLE_STAGES = new Set<BacklogEditableStage>(['idea', 'ready'])
export const BACKLOG_STAGES = new Set<BacklogStage>(['idea', 'ready', 'promoted', 'archived'])
export const TASK_PRIORITIES = new Set<TaskPriority>(['urgent', 'high', 'medium', 'low'])
export const EXPECTED_OUTPUT_KINDS = new Set<ExpectedOutputKind>(['file_path', 'content_item', 'artifact', 'design_asset', 'dataset', 'other'])
export const RESUME_FOCUS_MODES = new Set<ResumeFocusMode>(['auto', 'project'])
export const SHA256_RE = /^[0-9a-f]{64}$/
export const CONTENT_KINDS = new Set<ContentKind>(['note', 'specification', 'research', 'reference', 'artifact'])
export const CONTENT_FORMATS = new Set<ContentFormat>(['plain_text', 'markdown'])
export const CONTENT_SOURCE_KINDS = new Set<ContentSourceKind>([
  'human_directive',
  'agent_report',
  'external_reference',
])
export const CONTENT_VALIDITIES = new Set<ContentValidity>(['current', 'needs_review', 'outdated'])
export const CONTENT_RELATION_TARGETS = new Set<ContentRelationTarget>([
  'content',
  'task',
  'checkpoint',
  'decision',
  'blocker',
])
export const CONTENT_RELATION_KINDS = new Set<ContentRelationKind>([
  'supports',
  'contradicts',
  'supersedes',
  'required_input',
  'produced_output',
  'related',
])
