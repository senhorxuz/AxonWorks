export type WorkIntentAreaKind =
  | 'file_path'
  | 'content_item'
  | 'design_asset'
  | 'dataset'
  | 'external_system'
  | 'other'

export type WorkIntentAccess = 'read' | 'write'

export interface WorkIntentArea {
  kind: WorkIntentAreaKind
  locator: string
  access: WorkIntentAccess
}

export interface WorkIntent {
  objective: string
  areas: WorkIntentArea[]
  expectedOutputs: string[]
  plannedChecks: string[]
}

export interface IntentOverlap {
  otherTaskId: string
  otherTaskTitle: string
  otherAgent: string
  locator: string
  kind: WorkIntentAreaKind
  explanation: string
}

export interface IntentBearer {
  taskId: string
  title: string
  agent: string
  intent: WorkIntent | null
}

const AREA_KINDS = new Set<WorkIntentAreaKind>([
  'file_path',
  'content_item',
  'design_asset',
  'dataset',
  'external_system',
  'other',
])

export function normalizeIntentLocator(kind: WorkIntentAreaKind, locator: string): string {
  const trimmed = locator.trim()
  if (kind !== 'file_path') return trimmed
  return trimmed.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase()
}

export function writeLocatorsOverlap(left: WorkIntentArea, right: WorkIntentArea): boolean {
  if (left.kind !== right.kind) return false
  if (left.access !== 'write' || right.access !== 'write') return false
  const a = normalizeIntentLocator(left.kind, left.locator)
  const b = normalizeIntentLocator(right.kind, right.locator)
  if (!a || !b) return false
  if (a === b) return true
  if (left.kind !== 'file_path') return false
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export function findWriteOverlaps(current: IntentBearer, others: IntentBearer[]): IntentOverlap[] {
  if (!current.intent) return []
  const overlaps: IntentOverlap[] = []
  const seen = new Set<string>()
  for (const area of current.intent.areas) {
    if (area.access !== 'write') continue
    for (const other of others) {
      if (other.taskId === current.taskId || !other.intent) continue
      for (const candidate of other.intent.areas) {
        if (!writeLocatorsOverlap(area, candidate)) continue
        const key = `${other.taskId}:${area.kind}:${normalizeIntentLocator(area.kind, area.locator)}`
        if (seen.has(key)) continue
        seen.add(key)
        const locator = area.locator.trim()
        overlaps.push({
          otherTaskId: other.taskId,
          otherTaskTitle: other.title,
          otherAgent: other.agent,
          locator,
          kind: area.kind,
          explanation: `A tarefa "${current.title}" (${current.agent}) e a tarefa "${other.title}" (${other.agent}) declaram escrita em ${locator}. Isso não é um lock: cada uma continua responsável por coordenar.`,
        })
      }
    }
  }
  return overlaps
}

export function isWorkIntentAreaKind(value: string): value is WorkIntentAreaKind {
  return AREA_KINDS.has(value as WorkIntentAreaKind)
}
