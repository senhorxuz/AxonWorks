import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { isWorkIntentAreaKind, type WorkIntent } from '../../shared/intent.js'
import type {
  ResumeFocusMode,
  FinalizeTaskTransition,
  WorkDraftObservedCheck,
} from '../../shared/continuity.js'
import type {
  ContentFormat,
  ContentKind,
  ContentRelationKind,
  ContentRelationTarget,
  ContentSourceKind,
  ContentValidity,
} from '../../shared/library.js'
import type {
  MessageInput,
  BacklogEditableStage,
  BacklogPriority,
  TaskPriority,
  AcceptanceCriterion,
  ExpectedOutput,
  ExpectedOutputKind,
  Evidence,
  EvidenceInput,
  EvidenceOutcome,
  EvidenceArtifactInput,
} from '../../shared/types.js'
import { DomainError } from './errors.js'
import {
  UUID_RE,
  SHA256_RE,
  MESSAGE_KINDS,
  RESUME_FOCUS_MODES,
  BACKLOG_PRIORITIES,
  BACKLOG_EDITABLE_STAGES,
  TASK_PRIORITIES,
  EXPECTED_OUTPUT_KINDS,
  CONTENT_KINDS,
  CONTENT_FORMATS,
  CONTENT_SOURCE_KINDS,
  CONTENT_VALIDITIES,
  CONTENT_RELATION_TARGETS,
  CONTENT_RELATION_KINDS,
  EVIDENCE_OUTCOMES,
} from './constants.js'
import type { SqlRow, SqlValue } from './sql.js'

/**
 * Helpers `require*`/`optional*`/`nullable*`/`asRecord`/`numberish`/`text` de
 * validação e leitura de entrada. Extraídos de server/store.ts — mesmos nomes,
 * mesmo comportamento, sem adaptação.
 */

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError(400, 'invalid_input', `Dados de ${label} inválidos.`)
  }
  return value as Record<string, unknown>
}

/**
 * Recusa texto que chegou com caracteres destruidos.
 *
 * U+FFFD e o "replacement character": o que sobra quando bytes invalidos sao
 * decodificados como UTF-8. Texto legitimo praticamente nunca o contem, entao
 * a presenca dele e sinal confiavel de que a codificacao quebrou antes de a
 * requisicao chegar — tipicamente um shell do Windows destruindo acentos.
 *
 * A perda e irreversivel: nao ha como recuperar o "ç" a partir de U+FFFD.
 * Gravar em silencio seria guardar memoria corrompida com cara de certa, que e
 * pior do que recusar a escrita. Por isso a validacao compartilhada recusa.
 */
export function assertIntactText(value: string, field: string): void {
  if (value.includes('\uFFFD')) {
    throw new DomainError(
      400,
      "corrupted_text",
      `O campo ${field} chegou com caracteres corrompidos: os acentos foram destruídos antes de chegar à Axon. Nada foi gravado. Reenvie o texto em UTF-8, de preferência por arquivo ou entrada padrão, e não digitado direto no terminal do Windows.`,
    )
  }
}

export function requireString(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') {
    throw new DomainError(400, 'invalid_input', `Campo ${field} inválido.`)
  }
  assertIntactText(value, field)
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) {
    throw new DomainError(400, 'invalid_input', `Campo ${field} inválido.`)
  }
  return trimmed
}

export function requireConfirmation(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
    throw new DomainError(400, 'invalid_input', 'Campo confirmation inválido.')
  }
  assertIntactText(value, 'confirmation')
  return value
}

export function optionalMessage(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') {
    throw new DomainError(400, 'invalid_input', 'Campo message inválido.')
  }
  assertIntactText(value, 'message')
  const trimmed = value.trim()
  if (trimmed.length > 8000) {
    throw new DomainError(400, 'invalid_input', 'Campo message inválido.')
  }
  return trimmed
}

export function optionalResolutionNote(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    throw new DomainError(400, 'invalid_input', 'Campo note inválido.')
  }
  assertIntactText(value, 'note')
  const trimmed = value.trim()
  if (trimmed.length > 8000) {
    throw new DomainError(400, 'invalid_input', 'Campo note inválido.')
  }
  return trimmed
}

export function requireInt(value: unknown, field: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new DomainError(400, 'invalid_input', `Campo ${field} inválido.`)
  }
  return value
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new DomainError(400, 'invalid_input', `Campo ${field} inválido.`)
  }
  return value
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  return requireUuid(value, field)
}

export function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new DomainError(400, 'invalid_input', `Campo ${field} inválido.`)
  }
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) {
    throw new DomainError(400, 'invalid_input', `Campo ${field} deve ser uma data ISO válida.`)
  }
  return value
}

export function requireContentKind(value: unknown): ContentKind {
  if (typeof value !== 'string' || !CONTENT_KINDS.has(value as ContentKind)) {
    throw new DomainError(400, 'invalid_input', 'Campo kind inválido.')
  }
  return value as ContentKind
}

export function requireContentFormat(value: unknown): ContentFormat {
  if (typeof value !== 'string' || !CONTENT_FORMATS.has(value as ContentFormat)) {
    throw new DomainError(400, 'invalid_input', 'Campo format inválido.')
  }
  return value as ContentFormat
}

export function requireContentSourceKind(value: unknown): ContentSourceKind {
  if (typeof value !== 'string' || !CONTENT_SOURCE_KINDS.has(value as ContentSourceKind)) {
    throw new DomainError(400, 'invalid_input', 'Campo sourceKind inválido.')
  }
  return value as ContentSourceKind
}

export function requireContentValidity(value: unknown): ContentValidity {
  if (typeof value !== 'string' || !CONTENT_VALIDITIES.has(value as ContentValidity)) {
    throw new DomainError(400, 'invalid_input', 'Campo declaredValidity inválido.')
  }
  return value as ContentValidity
}

export function requireContentRelationTarget(value: unknown): ContentRelationTarget {
  if (typeof value !== 'string' || !CONTENT_RELATION_TARGETS.has(value as ContentRelationTarget)) {
    throw new DomainError(400, 'invalid_input', 'Campo targetType inválido.')
  }
  return value as ContentRelationTarget
}

export function requireContentRelationKind(value: unknown): ContentRelationKind {
  if (typeof value !== 'string' || !CONTENT_RELATION_KINDS.has(value as ContentRelationKind)) {
    throw new DomainError(400, 'invalid_input', 'Campo kind inválido.')
  }
  return value as ContentRelationKind
}

export function optionalContentString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null
  return requireString(value, field, 1, max)
}

/**
 * `humanSummary` (Parte 4): campo opcional, até 280 caracteres, validado pela
 * mesma checagem de texto compartilhada (recusa texto corrompido via
 * `requireString`/`assertIntactText`). Ausente ou string vazia vira
 * `undefined` — nunca entra na carga canônica de idempotência quando ausente,
 * então checkpoints antigos sem o campo não passam a conflitar em replay.
 */
export function optionalHumanSummary(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireString(value, 'humanSummary', 1, 280)
}

export function requireKind(value: unknown): MessageInput['kind'] {
  if (typeof value !== 'string' || !MESSAGE_KINDS.has(value as MessageInput['kind'])) {
    throw new DomainError(400, 'invalid_input', 'Campo kind inválido.')
  }
  return value as MessageInput['kind']
}

export function requireResumeFocusMode(value: unknown): ResumeFocusMode {
  if (typeof value !== 'string' || !RESUME_FOCUS_MODES.has(value as ResumeFocusMode)) {
    throw new DomainError(400, 'invalid_input', 'Campo focusMode inválido.')
  }
  return value as ResumeFocusMode
}

export function requireBacklogPriority(value: unknown): BacklogPriority {
  if (typeof value !== 'string' || !BACKLOG_PRIORITIES.has(value as BacklogPriority)) {
    throw new DomainError(400, 'invalid_input', 'Campo priority inválido.')
  }
  return value as BacklogPriority
}

export function requireBacklogEditableStage(value: unknown): BacklogEditableStage {
  if (typeof value !== 'string' || !BACKLOG_EDITABLE_STAGES.has(value as BacklogEditableStage)) {
    throw new DomainError(400, 'invalid_input', 'Campo stage inválido.')
  }
  return value as BacklogEditableStage
}

export function requireTaskPriority(value: unknown): TaskPriority {
  if (typeof value !== 'string' || !TASK_PRIORITIES.has(value as TaskPriority)) {
    throw new DomainError(400, 'invalid_input', 'Campo priority inválido.')
  }
  return value as TaskPriority
}

export function requireAcceptanceCriteria(value: unknown): AcceptanceCriterion[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100) {
    throw new DomainError(400, 'invalid_input', 'Campo acceptanceCriteria deve ser uma lista.')
  }
  return value.map((item, index) => {
    const rec = asRecord(item, `acceptanceCriteria[${index}]`)
    const description = requireString(rec.description, `acceptanceCriteria[${index}].description`, 1, 1000)
    const id = typeof rec.id === 'string' && rec.id.trim().length > 0 ? rec.id.trim() : randomUUID()
    const completed = rec.completed === undefined ? false : Boolean(rec.completed)
    return { id, description, completed }
  })
}

export function requireExpectedOutputs(value: unknown): ExpectedOutput[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) {
    throw new DomainError(400, 'invalid_input', 'Campo expectedOutputs deve ser uma lista.')
  }
  return value.map((item, index) => {
    const rec = asRecord(item, `expectedOutputs[${index}]`)
    const title = requireString(rec.title, `expectedOutputs[${index}].title`, 1, 200)
    const id = typeof rec.id === 'string' && rec.id.trim().length > 0 ? rec.id.trim() : randomUUID()
    const kind =
      typeof rec.kind === 'string' && EXPECTED_OUTPUT_KINDS.has(rec.kind as ExpectedOutputKind)
        ? (rec.kind as ExpectedOutputKind)
        : 'file_path'
    const locator =
      rec.locator !== undefined && rec.locator !== null
        ? requireString(rec.locator, `expectedOutputs[${index}].locator`, 1, 1000)
        : undefined
    return { id, title, kind, ...(locator ? { locator } : {}) }
  })
}

export function requireStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) {
    throw new DomainError(400, 'invalid_input', `Campo ${field} inválido.`)
  }
  return value.map((item, index) => requireString(item, `${field}[${index}]`, 1, 2000))
}

export function requireWorkIntent(value: unknown): WorkIntent {
  const rec = asRecord(value, 'intent')
  const objective = requireString(rec.objective, 'intent.objective', 1, 2000)
  if (!Array.isArray(rec.areas) || rec.areas.length > 20) {
    throw new DomainError(400, 'invalid_input', 'Campo intent.areas inválido.')
  }
  const areas = rec.areas.map((item, index) => {
    const area = asRecord(item, `intent.areas[${index}]`)
    if (typeof area.kind !== 'string' || !isWorkIntentAreaKind(area.kind)) {
      throw new DomainError(400, 'invalid_input', `Campo intent.areas[${index}].kind inválido.`)
    }
    if (area.access !== 'read' && area.access !== 'write') {
      throw new DomainError(400, 'invalid_input', `Campo intent.areas[${index}].access inválido.`)
    }
    return {
      kind: area.kind,
      locator: requireString(area.locator, `intent.areas[${index}].locator`, 1, 500),
      access: area.access as 'read' | 'write',
    }
  })
  return {
    objective,
    areas,
    expectedOutputs: requireStringArray(rec.expectedOutputs, 'intent.expectedOutputs'),
    plannedChecks: requireStringArray(rec.plannedChecks, 'intent.plannedChecks'),
  }
}

export function requireFinalizeTransition(value: unknown): FinalizeTaskTransition {
  const rec = asRecord(value, 'taskTransition')
  if (rec.kind === 'keep_claimed' || rec.kind === 'release' || rec.kind === 'declare_done') {
    return { kind: rec.kind }
  }
  if (rec.kind === 'declare_blocked') {
    return {
      kind: 'declare_blocked',
      reason: requireString(rec.reason, 'taskTransition.reason', 1, 2000),
      retainLease: rec.retainLease === true,
    }
  }
  throw new DomainError(400, 'invalid_input', 'Campo taskTransition inválido.')
}

export function requireObservedChecks(value: unknown): WorkDraftObservedCheck[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) {
    throw new DomainError(400, 'invalid_input', 'Campo observedChecks inválido.')
  }
  return value.map((item, index) => {
    const rec = asRecord(item, `observedChecks[${index}]`)
    return {
      commandOrMethod: requireString(
        rec.commandOrMethod,
        `observedChecks[${index}].commandOrMethod`,
        1,
        2000,
      ),
      reportedOutcome: requireString(
        rec.reportedOutcome,
        `observedChecks[${index}].reportedOutcome`,
        1,
        2000,
      ),
    }
  })
}

export function requireEvidenceInput(value: unknown): EvidenceInput[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) {
    throw new DomainError(400, 'invalid_input', 'Campo evidence inválido.')
  }
  return value.map((item, index) => {
    const rec = asRecord(item, `evidence[${index}]`)
    const command = requireString(rec.command, `evidence[${index}].command`, 1, 2000)
    const details = requireString(rec.details, `evidence[${index}].details`, 0, 8000)
    if (typeof rec.outcome !== 'string' || !EVIDENCE_OUTCOMES.has(rec.outcome as Evidence['outcome'])) {
      throw new DomainError(400, 'invalid_input', `Campo evidence[${index}].outcome inválido.`)
    }
    const artifacts = requireEvidenceArtifacts(rec.artifacts, `evidence[${index}].artifacts`)
    return {
      command,
      outcome: rec.outcome as EvidenceOutcome,
      details,
      ...(artifacts.length > 0 ? { artifacts } : {}),
    }
  })
}

export function requireEvidenceArtifacts(value: unknown, field: string): EvidenceArtifactInput[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) {
    throw new DomainError(400, 'invalid_input', `Campo ${field} inválido.`)
  }
  return value.map((item, index) => requireEvidenceArtifactInput(item, `${field}[${index}]`))
}

export function requireEvidenceArtifactInput(value: unknown, field: string): EvidenceArtifactInput {
  const rec = asRecord(value, field)
  const rawPath = requireString(rec.path, `${field}.path`, 1, 1000)
  const normalized = rawPath.replace(/\\/g, '/')
  if (isAbsolute(rawPath) || /^[a-zA-Z]:[/\\]/.test(rawPath) || normalized.startsWith('/')) {
    throw new DomainError(400, 'invalid_input', `Campo ${field}.path deve ser um caminho relativo à pasta do projeto.`)
  }
  const sha256Raw = requireString(rec.sha256, `${field}.sha256`, 64, 64)
  if (!SHA256_RE.test(sha256Raw)) {
    throw new DomainError(
      400,
      'invalid_input',
      `Campo ${field}.sha256 deve ter 64 caracteres hexadecimais minúsculos.`,
    )
  }
  const sizeBytes =
    rec.sizeBytes === undefined || rec.sizeBytes === null ? undefined : requireInt(rec.sizeBytes, `${field}.sizeBytes`, 0)
  return {
    path: rawPath,
    sha256: sha256Raw,
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
  }
}

export function text(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`coluna ${key} ausente`)
  return value
}

export function nullableText(row: SqlRow, key: string): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`coluna ${key} inválida`)
  return value
}

export function numberish(value: SqlValue | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  throw new Error('valor numérico ausente')
}
