import type {
  Decision,
  ProjectBlocker,
} from '../../shared/continuity.js'
import type {
  ContentItem,
  ContentRevision,
  ContentRelation,
} from '../../shared/library.js'
import type { Task } from '../../shared/types.js'
import type {
  ProjectGraph,
  GraphNode,
  GraphEdge,
  GraphNodeType,
  GraphEdgeKind,
  DecisionNodeData,
  ContentNodeData,
  TaskNodeData,
  BlockerNodeData,
  DecisionConflict,
  DecisionConflictReport,
  StaleContentItem,
  StaleContentReport,
  GraphImpactReport,
  ImpactedEntity,
  ImpactRiskLevel,
  ConflictSeverity,
} from '../../shared/graph.js'

const STOPWORDS = new Set([
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'com', 'sem',
  'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as', 'e', 'ou',
  'se', 'que', 'como', 'ao', 'aos', 'mais', 'muito', 'sobre',
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'with', 'to', 'in', 'on', 'at'
])

function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
  return new Set(words)
}

function calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0
  let intersectionSize = 0
  for (const item of setA) {
    if (setB.has(item)) intersectionSize++
  }
  const unionSize = setA.size + setB.size - intersectionSize
  return unionSize === 0 ? 0 : intersectionSize / unionSize
}

export interface BuildGraphInput {
  projectId: string
  decisions: Decision[]
  contents: ContentItem[]
  revisions: ContentRevision[]
  relations: ContentRelation[]
  tasks: Task[]
  blockers: ProjectBlocker[]
}

export interface BuildGraphOptions {
  nodeTypes?: GraphNodeType[]
  includeArchived?: boolean
}

export function buildProjectGraph(
  input: BuildGraphInput,
  options?: BuildGraphOptions
): ProjectGraph {
  const { projectId, decisions, contents, revisions, relations, tasks, blockers } = input
  const nodeTypeFilter = options?.nodeTypes ? new Set(options.nodeTypes) : null
  const includeArchived = options?.includeArchived ?? true

  const revisionMap = new Map<string, ContentRevision>()
  for (const rev of revisions) {
    revisionMap.set(rev.id, rev)
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // 1. Decisions -> Nodes
  if (!nodeTypeFilter || nodeTypeFilter.has('decision')) {
    for (const d of decisions) {
      const data: DecisionNodeData = {
        title: d.title,
        status: d.status,
        version: d.version,
        supersedesId: d.supersedesId,
        supersededById: d.supersededById,
        proposedBy: d.proposedBy,
        acceptedBy: d.acceptedBy,
        revokedBy: d.revokedBy,
        sourceKind: d.source.kind,
      }
      nodes.push({
        id: d.id,
        type: 'decision',
        label: d.title,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        data,
      })
    }
  }

  // 2. Content Items -> Nodes
  if (!nodeTypeFilter || nodeTypeFilter.has('content')) {
    for (const c of contents) {
      if (!includeArchived && c.status === 'archived') continue
      const currentRev = revisionMap.get(c.currentRevisionId)
      const data: ContentNodeData = {
        title: c.title,
        kind: c.kind,
        status: c.status,
        currentRevisionId: c.currentRevisionId,
        version: c.version,
        declaredValidity: currentRev?.declaredValidity ?? 'current',
        sourceKind: currentRev?.sourceKind ?? 'human_directive',
        createdBy: currentRev?.createdBy ?? 'unknown',
      }
      nodes.push({
        id: c.id,
        type: 'content',
        label: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        data,
      })
    }
  }

  // 3. Tasks -> Nodes
  if (!nodeTypeFilter || nodeTypeFilter.has('task')) {
    for (const t of tasks) {
      const data: TaskNodeData = {
        title: t.title,
        status: t.status,
        priority: t.priority ?? 'medium',
        assignee: t.assignee,
        dependencyTaskIds: t.dependencyTaskIds ?? [],
      }
      nodes.push({
        id: t.id,
        type: 'task',
        label: t.title,
        createdAt: t.createdAt,
        data,
      })
    }
  }

  // 4. Blockers -> Nodes
  if (!nodeTypeFilter || nodeTypeFilter.has('blocker')) {
    for (const b of blockers) {
      const data: BlockerNodeData = {
        title: b.title,
        status: b.status,
        taskId: b.taskId,
        openedBy: b.openedBy,
        assignee: b.assignee,
        resolution: b.resolution,
      }
      nodes.push({
        id: b.id,
        type: 'blocker',
        label: b.title,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        data,
      })
    }
  }

  const validNodeIds = new Set(nodes.map(n => n.id))

  // Edges: Decision Supersession Lineage
  for (const d of decisions) {
    if (d.supersedesId && validNodeIds.has(d.id) && validNodeIds.has(d.supersedesId)) {
      edges.push({
        id: `edge-supersedes-${d.id}-${d.supersedesId}`,
        fromNodeId: d.id,
        fromNodeType: 'decision',
        toNodeId: d.supersedesId,
        toNodeType: 'decision',
        kind: 'supersedes',
        provenance: 'structural_lineage',
      })
    }
  }

  // Edges: Task Dependencies
  for (const t of tasks) {
    if (t.dependencyTaskIds && validNodeIds.has(t.id)) {
      for (const depId of t.dependencyTaskIds) {
        if (validNodeIds.has(depId)) {
          edges.push({
            id: `edge-depends-${t.id}-${depId}`,
            fromNodeId: t.id,
            fromNodeType: 'task',
            toNodeId: depId,
            toNodeType: 'task',
            kind: 'depends_on',
            provenance: 'task_dependency',
          })
        }
      }
    }
  }

  // Edges: Blocker Links
  for (const b of blockers) {
    if (b.taskId && validNodeIds.has(b.id) && validNodeIds.has(b.taskId)) {
      edges.push({
        id: `edge-blocks-${b.id}-${b.taskId}`,
        fromNodeId: b.id,
        fromNodeType: 'blocker',
        toNodeId: b.taskId,
        toNodeType: 'task',
        kind: 'blocks',
        provenance: 'blocker_link',
      })
    }
  }

  // Edges: Content Relations
  for (const r of relations) {
    const rev = revisionMap.get(r.sourceRevisionId)
    if (!rev) continue
    const sourceItemId = rev.itemId
    if (!validNodeIds.has(sourceItemId)) continue
    if (!validNodeIds.has(r.targetId)) continue

    let edgeKind: GraphEdgeKind = 'references'
    if (r.kind === 'supports') edgeKind = 'supports'
    else if (r.kind === 'contradicts') edgeKind = 'contradicts'
    else if (r.kind === 'supersedes') edgeKind = 'supersedes'

    edges.push({
      id: `edge-rel-${r.id}`,
      fromNodeId: sourceItemId,
      fromNodeType: 'content',
      toNodeId: r.targetId,
      toNodeType: r.targetType as GraphNodeType,
      kind: edgeKind,
      provenance: 'explicit_relation',
      metadata: {
        relationKind: r.kind,
        sourceRevisionId: r.sourceRevisionId,
      },
    })
  }

  // Stats calculation
  const nodesByType: Record<GraphNodeType, number> = {
    decision: 0,
    content: 0,
    task: 0,
    blocker: 0,
  }
  for (const n of nodes) {
    nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1
  }

  const edgesByKind: Record<GraphEdgeKind, number> = {
    supersedes: 0,
    contradicts: 0,
    supports: 0,
    implements: 0,
    references: 0,
    depends_on: 0,
    blocks: 0,
  }
  for (const e of edges) {
    edgesByKind[e.kind] = (edgesByKind[e.kind] ?? 0) + 1
  }

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    stats: {
      totalNodes: nodes.length,
      nodesByType,
      totalEdges: edges.length,
      edgesByKind,
    },
  }
}

export function detectDecisionConflicts(input: {
  projectId: string
  decisions: Decision[]
  relations?: ContentRelation[]
  revisions?: ContentRevision[]
}): DecisionConflictReport {
  const { projectId, decisions } = input
  const conflicts: DecisionConflict[] = []
  const decisionMap = new Map<string, Decision>()
  for (const d of decisions) {
    decisionMap.set(d.id, d)
  }

  // 1. Direct Contradictions via relations
  if (input.relations && input.revisions) {
    const revisionMap = new Map<string, ContentRevision>()
    for (const r of input.revisions) revisionMap.set(r.id, r)

    for (const rel of input.relations) {
      if (rel.kind === 'contradicts' && rel.targetType === 'decision') {
        const targetDecision = decisionMap.get(rel.targetId)
        if (targetDecision && targetDecision.status === 'accepted') {
          // If source revision was created from another decision or content
          const sourceRev = revisionMap.get(rel.sourceRevisionId)
          conflicts.push({
            id: `conflict-direct-${rel.id}`,
            type: 'direct_contradiction',
            severity: 'critical',
            decisionIds: [targetDecision.id],
            summary: `Contradição expressa com decisão aceita: "${targetDecision.title}"`,
            explanation: `Existe uma relação declarada de contradição vinculada à decisão aceita "${targetDecision.title}".`,
            recommendation: 'Revogue ou reformule a decisão ou o conteúdo que a contradiz.',
          })
        }
      }
    }
  }

  // 2. Unresolved / Broken Supersession (Zombie Acceptance)
  const supersedesCount = new Map<string, string[]>()
  for (const d of decisions) {
    if (d.supersedesId) {
      const list = supersedesCount.get(d.supersedesId) ?? []
      list.push(d.id)
      supersedesCount.set(d.supersedesId, list)
    }
  }

  for (const d of decisions) {
    // If d is accepted, but another accepted decision supersedes it
    if (d.status === 'accepted') {
      const supersedingIds = supersedesCount.get(d.id) ?? []
      const acceptedSuperseders = supersedingIds
        .map(id => decisionMap.get(id))
        .filter((other): other is Decision => Boolean(other && other.status === 'accepted'))

      if (acceptedSuperseders.length > 0) {
        const newer = acceptedSuperseders[0]!
        conflicts.push({
          id: `conflict-zombie-${d.id}-${newer.id}`,
          type: 'unresolved_supersession',
          severity: 'critical',
          decisionIds: [d.id, newer.id],
          summary: `Decisão substituída continua aceita: "${d.title}"`,
          explanation: `A decisão "${d.title}" foi formalmente substituída por "${newer.title}", mas seu status ainda permanece como "accepted".`,
          recommendation: 'Atualize o status da decisão substituída para "superseded" para restaurar a integridade da memória.',
        })
      }
    }

    // If d has supersededById populated but status is still accepted
    if (d.status === 'accepted' && d.supersededById) {
      conflicts.push({
        id: `conflict-inconsistent-status-${d.id}`,
        type: 'unresolved_supersession',
        severity: 'warning',
        decisionIds: [d.id, d.supersededById],
        summary: `Status inconsistente na decisão: "${d.title}"`,
        explanation: `A decisão "${d.title}" tem supersededById preenchido, mas seu status é "accepted".`,
        recommendation: 'Altere o status para "superseded".',
      })
    }
  }

  // 3. Circular Supersession detection
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function detectCycle(currId: string, path: string[]): boolean {
    visited.add(currId)
    inStack.add(currId)
    const currDecision = decisionMap.get(currId)
    if (currDecision?.supersedesId) {
      const nextId = currDecision.supersedesId
      if (!visited.has(nextId)) {
        if (detectCycle(nextId, [...path, nextId])) return true
      } else if (inStack.has(nextId)) {
        const cyclePath = [...path, nextId]
        conflicts.push({
          id: `conflict-cycle-${currId}-${nextId}`,
          type: 'circular_supersession',
          severity: 'critical',
          decisionIds: cyclePath,
          summary: 'Ciclo detectado na cadeia de substituição de decisões',
          explanation: `Existe um ciclo de substituição entre decisões: ${cyclePath.map(id => decisionMap.get(id)?.title ?? id).join(' -> ')}.`,
          recommendation: 'Remova ou reajuste o supersedesId para restaurar uma cadeia acíclica.',
        })
        return true
      }
    }
    inStack.delete(currId)
    return false
  }

  for (const d of decisions) {
    if (!visited.has(d.id)) {
      detectCycle(d.id, [d.id])
    }
  }

  // 4. Overlapping Accepted Decisions without Supersession
  const acceptedDecisions = decisions.filter(d => d.status === 'accepted')
  for (let i = 0; i < acceptedDecisions.length; i++) {
    for (let j = i + 1; j < acceptedDecisions.length; j++) {
      const d1 = acceptedDecisions[i]!
      const d2 = acceptedDecisions[j]!

      // If one already supersedes the other, they are not in conflicting overlap
      if (d1.supersedesId === d2.id || d2.supersedesId === d1.id) continue
      if (d1.supersededById === d2.id || d2.supersededById === d1.id) continue

      const kwTitle1 = extractKeywords(d1.title)
      const kwTitle2 = extractKeywords(d2.title)
      const titleSimilarity = calculateJaccardSimilarity(kwTitle1, kwTitle2)

      const kw1 = extractKeywords(`${d1.title} ${d1.body}`)
      const kw2 = extractKeywords(`${d2.title} ${d2.body}`)
      const fullSimilarity = calculateJaccardSimilarity(kw1, kw2)

      // Title prefix check (e.g. "Arquitetura: ...", "Auth: ...")
      const d1Prefix = d1.title.split(/[:\-]/)[0]?.trim().toLowerCase()
      const d2Prefix = d2.title.split(/[:\-]/)[0]?.trim().toLowerCase()
      const samePrefix = Boolean(d1Prefix && d2Prefix && d1Prefix === d2Prefix && d1Prefix.length >= 4)

      const isOverlapping =
        fullSimilarity >= 0.5 ||
        titleSimilarity >= 0.4 ||
        (samePrefix && (titleSimilarity >= 0.25 || fullSimilarity >= 0.25))

      if (isOverlapping) {
        const simScore = Math.max(fullSimilarity, titleSimilarity)
        conflicts.push({
          id: `conflict-overlap-${d1.id}-${d2.id}`,
          type: 'overlapping_accepted_decisions',
          severity: 'warning',
          decisionIds: [d1.id, d2.id],
          summary: `Sobreposição temática entre decisões aceitas: "${d1.title}" e "${d2.title}"`,
          explanation: `Ambas as decisões estão vigentes (aceitas) e abordam o mesmo domínio de conhecimento com similaridade léxica de ${(simScore * 100).toFixed(0)}%, sem relação explícita de substituição.`,
          recommendation: 'Avalie se uma decisão deve substituir formalmente a outra via supersedesId ou refine o escopo de cada uma.',
        })
      }
    }
  }

  const criticalCount = conflicts.filter(c => c.severity === 'critical').length
  const warningCount = conflicts.filter(c => c.severity === 'warning').length

  return {
    projectId,
    analyzedAt: new Date().toISOString(),
    totalDecisions: decisions.length,
    acceptedDecisions: acceptedDecisions.length,
    conflictCount: conflicts.length,
    criticalCount,
    warningCount,
    conflicts,
  }
}

export function detectStaleContent(input: {
  projectId: string
  contents: ContentItem[]
  revisions: ContentRevision[]
  relations: ContentRelation[]
  decisions: Decision[]
}): StaleContentReport {
  const { projectId, contents, revisions, relations, decisions } = input
  const staleItems: StaleContentItem[] = []

  const decisionMap = new Map<string, Decision>()
  for (const d of decisions) decisionMap.set(d.id, d)

  const contentMap = new Map<string, ContentItem>()
  for (const c of contents) contentMap.set(c.id, c)

  const revisionMap = new Map<string, ContentRevision>()
  for (const rev of revisions) revisionMap.set(rev.id, rev)

  // Group relations by source revision ID
  const relationsByRevision = new Map<string, ContentRelation[]>()
  for (const r of relations) {
    const list = relationsByRevision.get(r.sourceRevisionId) ?? []
    list.push(r)
    relationsByRevision.set(r.sourceRevisionId, list)
  }

  const activeContents = contents.filter(c => c.status === 'active')

  for (const item of activeContents) {
    const currentRev = revisionMap.get(item.currentRevisionId)
    if (!currentRev) continue

    // 1. Explicit declared validity
    if (currentRev.declaredValidity === 'outdated') {
      staleItems.push({
        itemId: item.id,
        itemTitle: item.title,
        currentRevisionId: item.currentRevisionId,
        status: item.status,
        declaredValidity: currentRev.declaredValidity,
        reasonCode: 'declared_outdated',
        severity: 'critical',
        explanation: 'O conteúdo está expressamente declarado como desatualizado na revisão vigente.',
        relatedEntity: null,
        suggestedAction: 'Produza uma nova revisão atualizada ou arquive o item da biblioteca.',
      })
      continue
    }

    if (currentRev.declaredValidity === 'needs_review') {
      staleItems.push({
        itemId: item.id,
        itemTitle: item.title,
        currentRevisionId: item.currentRevisionId,
        status: item.status,
        declaredValidity: currentRev.declaredValidity,
        reasonCode: 'declared_needs_review',
        severity: 'warning',
        explanation: 'O conteúdo foi sinalizado com necessidade de revisão pendente.',
        relatedEntity: null,
        suggestedAction: 'Valide a conformidade do conteúdo e marque sua validade como "current".',
      })
    }

    // Check relations of current revision
    const itemRelations = relationsByRevision.get(item.currentRevisionId) ?? []
    for (const rel of itemRelations) {
      if (rel.targetType === 'decision') {
        const targetDecision = decisionMap.get(rel.targetId)
        if (!targetDecision) continue

        // 2. Depends on revoked decision
        if (targetDecision.status === 'revoked' && (rel.kind === 'supports' || rel.kind === 'related')) {
          staleItems.push({
            itemId: item.id,
            itemTitle: item.title,
            currentRevisionId: item.currentRevisionId,
            status: item.status,
            declaredValidity: currentRev.declaredValidity,
            reasonCode: 'dependency_decision_revoked',
            severity: 'critical',
            explanation: `Este conteúdo apoia ou referencia a decisão "${targetDecision.title}", que foi REVOGADA por ${targetDecision.revokedBy ?? 'operador'}.`,
            relatedEntity: {
              type: 'decision',
              id: targetDecision.id,
              title: targetDecision.title,
            },
            suggestedAction: 'Revise o conteúdo para remover diretivas fundamentadas na decisão revogada.',
          })
        }

        // 3. Depends on superseded decision
        if (targetDecision.status === 'superseded' && (rel.kind === 'supports' || rel.kind === 'related')) {
          staleItems.push({
            itemId: item.id,
            itemTitle: item.title,
            currentRevisionId: item.currentRevisionId,
            status: item.status,
            declaredValidity: currentRev.declaredValidity,
            reasonCode: 'dependency_decision_superseded',
            severity: 'warning',
            explanation: `Este conteúdo fundamenta-se na decisão "${targetDecision.title}", que foi SUBSTITUÍDA por uma decisão mais recente.`,
            relatedEntity: {
              type: 'decision',
              id: targetDecision.id,
              title: targetDecision.title,
            },
            suggestedAction: 'Atualize o conteúdo para refletir os termos da decisão substituta vigente.',
          })
        }

        // 4. Contradicts accepted decision
        if (targetDecision.status === 'accepted' && rel.kind === 'contradicts') {
          staleItems.push({
            itemId: item.id,
            itemTitle: item.title,
            currentRevisionId: item.currentRevisionId,
            status: item.status,
            declaredValidity: currentRev.declaredValidity,
            reasonCode: 'contradicts_accepted_decision',
            severity: 'critical',
            explanation: `Este conteúdo contradiz expressamente a decisão aceita "${targetDecision.title}".`,
            relatedEntity: {
              type: 'decision',
              id: targetDecision.id,
              title: targetDecision.title,
            },
            suggestedAction: 'Adequar o conteúdo para manter consistência com as decisões aceitas do projeto.',
          })
        }
      } else if (rel.targetType === 'content') {
        const targetContent = contentMap.get(rel.targetId)
        if (!targetContent) continue

        // 5. References archived or outdated content
        const targetRev = revisionMap.get(targetContent.currentRevisionId)
        if (targetContent.status === 'archived' || targetRev?.declaredValidity === 'outdated') {
          staleItems.push({
            itemId: item.id,
            itemTitle: item.title,
            currentRevisionId: item.currentRevisionId,
            status: item.status,
            declaredValidity: currentRev.declaredValidity,
            reasonCode: 'referenced_content_archived_or_outdated',
            severity: 'warning',
            explanation: `Este conteúdo referencia o item "${targetContent.title}", que está ${targetContent.status === 'archived' ? 'arquivado' : 'declarado desatualizado'}.`,
            relatedEntity: {
              type: 'content',
              id: targetContent.id,
              title: targetContent.title,
            },
            suggestedAction: 'Aponte para uma fonte de conteúdo vigente ou remova a dependência obsoleta.',
          })
        }
      }
    }
  }

  const criticalCount = staleItems.filter(i => i.severity === 'critical').length
  const warningCount = staleItems.filter(i => i.severity === 'warning').length

  return {
    projectId,
    analyzedAt: new Date().toISOString(),
    totalContentItems: contents.length,
    activeContentItems: activeContents.length,
    staleCount: staleItems.length,
    criticalCount,
    warningCount,
    items: staleItems,
  }
}

export function analyzeGraphImpact(
  graph: ProjectGraph,
  targetEntityId: string,
  targetEntityType: GraphNodeType
): GraphImpactReport {
  const targetNode = graph.nodes.find(n => n.id === targetEntityId && n.type === targetEntityType)
  if (!targetNode) {
    throw new Error(`Entidade alvo com id "${targetEntityId}" e tipo "${targetEntityType}" não encontrada no grafo do projeto.`)
  }

  // Build adjacency: bidirectional graph traversal for complete impact reachability
  const adjacency = new Map<string, Array<{ neighborId: string; edge: GraphEdge }>>()
  for (const edge of graph.edges) {
    const listTo = adjacency.get(edge.toNodeId) ?? []
    listTo.push({ neighborId: edge.fromNodeId, edge })
    adjacency.set(edge.toNodeId, listTo)

    const listFrom = adjacency.get(edge.fromNodeId) ?? []
    listFrom.push({ neighborId: edge.toNodeId, edge })
    adjacency.set(edge.fromNodeId, listFrom)
  }

  const nodeMap = new Map<string, GraphNode>()
  for (const n of graph.nodes) nodeMap.set(n.id, n)

  // BFS traversal
  const visited = new Set<string>([targetEntityId])
  const impactedEntities: ImpactedEntity[] = []

  interface QueueItem {
    nodeId: string
    distance: number
    path: string[]
  }

  const queue: QueueItem[] = [{ nodeId: targetEntityId, distance: 0, path: [targetNode.label] }]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.distance >= 10) continue // max depth

    const neighbors = adjacency.get(current.nodeId) ?? []
    for (const { neighborId, edge } of neighbors) {
      if (visited.has(neighborId)) continue
      visited.add(neighborId)

      const neighborNode = nodeMap.get(neighborId)
      if (!neighborNode) continue

      const nextDistance = current.distance + 1
      const nextPath = [...current.path, `${edge.kind} -> ${neighborNode.label}`]

      let severity: ConflictSeverity = 'info'
      let reason = `Dependente direto via relação "${edge.kind}"`

      if (neighborNode.type === 'task') {
        const taskData = neighborNode.data as TaskNodeData
        if (taskData.status === 'in_progress') {
          severity = 'critical'
          reason = `Tarefa atualmente em progresso ("${taskData.status}") impactada por alteração na diretiva.`
        } else {
          severity = 'warning'
          reason = `Tarefa pendente (${taskData.status}) vinculada ao elemento alterado.`
        }
      } else if (neighborNode.type === 'decision') {
        severity = 'warning'
        reason = `Decisão dependente ou substituta na cadeia de linhagem.`
      } else if (neighborNode.type === 'content') {
        severity = 'warning'
        reason = `Item de conteúdo da biblioteca que fundamenta ou referencia este elemento.`
      }

      impactedEntities.push({
        id: neighborNode.id,
        type: neighborNode.type,
        label: neighborNode.label,
        distance: nextDistance,
        relationPath: nextPath,
        severity,
        reason,
      })

      queue.push({
        nodeId: neighborId,
        distance: nextDistance,
        path: nextPath,
      })
    }
  }

  // Summary counts
  let tasksImpacted = 0
  let decisionsImpacted = 0
  let contentImpacted = 0
  let blockersImpacted = 0

  for (const item of impactedEntities) {
    if (item.type === 'task') tasksImpacted++
    else if (item.type === 'decision') decisionsImpacted++
    else if (item.type === 'content') contentImpacted++
    else if (item.type === 'blocker') blockersImpacted++
  }

  let riskLevel: ImpactRiskLevel = 'low'
  const hasCritical = impactedEntities.some(i => i.severity === 'critical')
  if (hasCritical || impactedEntities.length >= 4) {
    riskLevel = 'high'
  } else if (impactedEntities.length >= 1) {
    riskLevel = 'medium'
  }

  return {
    projectId: graph.projectId,
    analyzedAt: new Date().toISOString(),
    targetEntity: {
      id: targetNode.id,
      type: targetNode.type,
      label: targetNode.label,
    },
    riskLevel,
    impactSummary: {
      totalImpacted: impactedEntities.length,
      tasksImpacted,
      decisionsImpacted,
      contentImpacted,
      blockersImpacted,
    },
    impactedEntities,
  }
}
