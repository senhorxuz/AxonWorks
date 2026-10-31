import type { BacklogItem, ProjectDetail } from './types.js'
import type {
  CharterRevision,
  Decision,
  MessageResolution,
  ProjectBlocker,
  TaskTransitionEvent,
  WorkDraft,
} from './continuity.js'
import type { ContentItem, ContentRelation, ContentRevision } from './library.js'

export interface ProjectBundleV1 {
  format: 'axon-project'
  version: 1
  exportedAt: string
  project: ProjectDetail
}

export interface PortableHandoffDelivery {
  id: string
  projectId: string
  checkpointId: string
  taskId: string | null
  from: string
  to: string
  message: string
  createdAt: string
}

export interface PortableHandoffReceipt {
  projectId: string
  deliveryId: string
  agent: string
  acknowledgedAt: string
}

export interface ProjectBundleV2 {
  format: 'axon-project'
  version: 2
  exportedAt: string
  project: ProjectDetail
  backlogItems: BacklogItem[]
  deliveries: PortableHandoffDelivery[]
  deliveryReceipts: PortableHandoffReceipt[]
  /** Ausente apenas em bundles v2 produzidos antes do ciclo de resolução explícita. */
  messageResolutions?: MessageResolution[]
  /** O que a v2 declaradamente não leva. Ausente em pacotes v2 antigos. */
  omissions?: BundleOmission[]
}

export interface PortableLibrary {
  items: ContentItem[]
  revisions: ContentRevision[]
  relations: ContentRelation[]
}

/**
 * Categoria que o formato do pacote deliberadamente nao transporta.
 *
 * Existe para que uma copia importada nunca finja ser identica a origem.
 * Omissao declarada e uma escolha honesta; omissao silenciosa e perda de dado.
 */
export interface BundleOmission {
  entity: string
  reason: string
}

export interface ProjectBundleV3 {
  format: 'axon-project'
  version: 3
  exportedAt: string
  project: ProjectDetail
  backlogItems: BacklogItem[]
  deliveries: PortableHandoffDelivery[]
  deliveryReceipts: PortableHandoffReceipt[]
  messageResolutions: MessageResolution[]
  charterRevisions: CharterRevision[]
  decisions: Decision[]
  blockers: ProjectBlocker[]
  library: PortableLibrary
  workDrafts?: WorkDraft[]
  taskEvents?: TaskTransitionEvent[]
  /** O que este formato declaradamente nao leva. Ausente em pacotes v3 antigos. */
  omissions?: BundleOmission[]
}

export type ProjectBundle = ProjectBundleV1 | ProjectBundleV2 | ProjectBundleV3

export interface ProjectBundleData {
  project: ProjectDetail
  backlogItems: BacklogItem[]
  deliveries: PortableHandoffDelivery[]
  deliveryReceipts: PortableHandoffReceipt[]
  messageResolutions?: MessageResolution[]
  charterRevisions?: CharterRevision[]
  decisions?: Decision[]
  blockers?: ProjectBlocker[]
  library?: PortableLibrary
  workDrafts?: WorkDraft[]
  taskEvents?: TaskTransitionEvent[]
}

export interface InspectedFile {
  relativePath: string
  sizeBytes: number
  charCount: number
  isBinary: boolean
  isTruncated: boolean
  content: string | null
  warning?: string
}

export interface WorkspaceInspectionSummary {
  totalFilesRequested: number
  totalFilesInspected: number
  totalBytes: number
  totalChars: number
  budgetMaxChars: number
  budgetUsedChars: number
  truncated: boolean
}

export interface WorkspaceInspection {
  workspacePath: string
  generatedAt: string
  summary: WorkspaceInspectionSummary
  files: InspectedFile[]
  warnings: string[]
  disclaimer: string
  markdown: string
}

export interface InspectWorkspaceInput {
  workspacePath: string
  files: string[]
  maxChars?: number
}
