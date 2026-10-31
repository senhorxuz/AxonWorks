import type { DecisionStatus, BlockerStatus } from './continuity.js'
import type { ContentKind, ContentStatus, ContentValidity } from './library.js'
import type { TaskStatus, TaskPriority } from './types.js'

export type GraphNodeType = 'decision' | 'content' | 'task' | 'blocker'

export type GraphEdgeKind =
  | 'supersedes'
  | 'contradicts'
  | 'supports'
  | 'implements'
  | 'references'
  | 'depends_on'
  | 'blocks'

export type EdgeProvenance =
  | 'explicit_relation'
  | 'structural_lineage'
  | 'task_dependency'
  | 'blocker_link'
  | 'detected_conflict'

export interface DecisionNodeData {
  title: string
  status: DecisionStatus
  version: number
  supersedesId: string | null
  supersededById: string | null
  proposedBy: string
  acceptedBy: string | null
  revokedBy: string | null
  sourceKind: string
}

export interface ContentNodeData {
  title: string
  kind: ContentKind
  status: ContentStatus
  currentRevisionId: string
  version: number
  declaredValidity: ContentValidity
  sourceKind: string
  createdBy: string
}

export interface TaskNodeData {
  title: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string | null
  dependencyTaskIds: string[]
}

export interface BlockerNodeData {
  title: string
  status: BlockerStatus
  taskId: string | null
  openedBy: string
  assignee: string | null
  resolution: string | null
}

export interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  createdAt: string
  updatedAt?: string
  data: DecisionNodeData | ContentNodeData | TaskNodeData | BlockerNodeData
}

export interface GraphEdge {
  id: string
  fromNodeId: string
  fromNodeType: GraphNodeType
  toNodeId: string
  toNodeType: GraphNodeType
  kind: GraphEdgeKind
  provenance: EdgeProvenance
  metadata?: Record<string, unknown>
}

export interface ProjectGraph {
  projectId: string
  generatedAt: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: {
    totalNodes: number
    nodesByType: Record<GraphNodeType, number>
    totalEdges: number
    edgesByKind: Record<GraphEdgeKind, number>
  }
}

// Conflict Detection Types
export type DecisionConflictType =
  | 'direct_contradiction'
  | 'overlapping_accepted_decisions'
  | 'unresolved_supersession'
  | 'circular_supersession'

export type ConflictSeverity = 'critical' | 'warning' | 'info'

export interface DecisionConflict {
  id: string
  type: DecisionConflictType
  severity: ConflictSeverity
  decisionIds: string[]
  summary: string
  explanation: string
  recommendation: string
}

export interface DecisionConflictReport {
  projectId: string
  analyzedAt: string
  totalDecisions: number
  acceptedDecisions: number
  conflictCount: number
  criticalCount: number
  warningCount: number
  conflicts: DecisionConflict[]
}

// Stale Content Types
export type StaleReasonCode =
  | 'dependency_decision_revoked'
  | 'dependency_decision_superseded'
  | 'referenced_content_archived_or_outdated'
  | 'declared_needs_review'
  | 'declared_outdated'
  | 'contradicts_accepted_decision'

export interface StaleContentItem {
  itemId: string
  itemTitle: string
  currentRevisionId: string
  status: ContentStatus
  declaredValidity: ContentValidity
  reasonCode: StaleReasonCode
  severity: ConflictSeverity
  explanation: string
  relatedEntity: {
    type: GraphNodeType
    id: string
    title?: string
  } | null
  suggestedAction: string
}

export interface StaleContentReport {
  projectId: string
  analyzedAt: string
  totalContentItems: number
  activeContentItems: number
  staleCount: number
  criticalCount: number
  warningCount: number
  items: StaleContentItem[]
}

// Impact Analysis Types
export type ImpactRiskLevel = 'high' | 'medium' | 'low'

export interface ImpactedEntity {
  id: string
  type: GraphNodeType
  label: string
  distance: number
  relationPath: string[]
  severity: ConflictSeverity
  reason: string
}

export interface GraphImpactReport {
  projectId: string
  analyzedAt: string
  targetEntity: {
    id: string
    type: GraphNodeType
    label: string
  }
  riskLevel: ImpactRiskLevel
  impactSummary: {
    totalImpacted: number
    tasksImpacted: number
    decisionsImpacted: number
    contentImpacted: number
    blockersImpacted: number
  }
  impactedEntities: ImpactedEntity[]
}
