export type ContentKind = 'note' | 'specification' | 'research' | 'reference' | 'artifact'
export type ContentStatus = 'active' | 'archived'
export type ContentFormat = 'plain_text' | 'markdown'
export type ContentSourceKind = 'human_directive' | 'agent_report' | 'external_reference'
export type ContentValidity = 'current' | 'needs_review' | 'outdated'
export type ContentRelationTarget = 'content' | 'task' | 'checkpoint' | 'decision' | 'blocker'
export type ContentRelationKind =
  | 'supports'
  | 'contradicts'
  | 'supersedes'
  | 'required_input'
  | 'produced_output'
  | 'related'

export interface ContentItem {
  id: string
  projectId: string
  title: string
  kind: ContentKind
  status: ContentStatus
  currentRevisionId: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface ContentRevision {
  id: string
  itemId: string
  revision: number
  body: string
  format: ContentFormat
  createdBy: string
  createdAt: string
  supersedesId: string | null
  sourceKind: ContentSourceKind
  sourceLabel?: string
  sourceUrl?: string
  declaredValidity: ContentValidity
}

export interface ContentRelation {
  id: string
  projectId: string
  sourceRevisionId: string
  targetType: ContentRelationTarget
  targetId: string
  kind: ContentRelationKind
  createdBy: string
  createdAt: string
}

export interface ContentEntry {
  item: ContentItem
  revision: ContentRevision
}

export interface ContentDocument extends ContentEntry {
  revisions: ContentRevision[]
  relations: ContentRelation[]
}

export interface CreateContentInput {
  title: string
  kind: ContentKind
  body: string
  format?: ContentFormat
  createdBy: string
  sourceKind: ContentSourceKind
  sourceLabel?: string
  sourceUrl?: string
  declaredValidity?: ContentValidity
}

export interface ReviseContentInput {
  expectedVersion: number
  title?: string
  body: string
  format?: ContentFormat
  createdBy: string
  sourceKind: ContentSourceKind
  sourceLabel?: string
  sourceUrl?: string
  declaredValidity?: ContentValidity
}

export interface ArchiveContentInput {
  expectedVersion: number
}

export interface AddContentRelationInput {
  sourceRevisionId: string
  targetType: ContentRelationTarget
  targetId: string
  kind: ContentRelationKind
  createdBy: string
}

export interface ListContentOptions {
  includeArchived?: boolean
}

export interface ContentSearchSource {
  kind: ContentSourceKind
  label?: string
  url?: string
  declaredValidity: ContentValidity
  createdBy: string
  createdAt: string
}

export interface ContentSearchResult extends ContentEntry {
  snippet: string
  source: ContentSearchSource
}
