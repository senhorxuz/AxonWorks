import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CharterRevision } from '../../shared/continuity.js'
import type { WorkspaceStore } from '../store.js'

export function importarDiretrizesDoPacote(
  db: DatabaseSync, projectId: string, idMap: Record<string, string>, diretrizes: CharterRevision[],
  logAudit: WorkspaceStore['logAudit'],
): void {
  for (const diretriz of diretrizes) idMap[diretriz.id] = randomUUID()
  const inserir = db.prepare(`INSERT INTO charter_revisions (
    id, project_id, revision, body, created_by, created_at, source_kind, supersedes_id, visto_pelo_dono_em
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const diretriz of diretrizes.toSorted((a, b) => a.revision - b.revision)) {
    const { id, revision, body, createdBy, createdAt, sourceKind, supersedesId, vistoPeloDonoEm, motivo } = diretriz
    const novoId = idMap[id]
    const anterior = supersedesId === null ? null : idMap[supersedesId]
    inserir.run(novoId, projectId, revision, body, createdBy, createdAt, sourceKind, anterior, vistoPeloDonoEm ?? null)
    if (sourceKind === 'agent_update' && motivo !== undefined) {
      logAudit({
        actorType: 'system', actorId: 'Axon', action: 'import_project_objective',
        resourceType: 'charter', resourceId: novoId, projectId, details: { motivo },
      })
    }
  }
}
