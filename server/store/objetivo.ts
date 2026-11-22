import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthContext } from '../../shared/auth.js'
import type { CharterRevision, SaveCharterInput, UpdateProjectObjectiveInput } from '../../shared/continuity.js'
import type { WorkspaceStore } from '../store.js'
import { DomainError } from './errors.js'
import { mapCharter } from './mappers.js'
import type { SqlRow } from './sql.js'
import { asRecord, nullableText, requireInt, requireString } from './validation.js'

const ACAO_DA_ATUALIZACAO = 'update_project_objective'

// A justificativa pertence à autoria da revisão e fica registrada na mesma transação.
export const COLUNAS_DA_DIRETRIZ = `id, project_id, revision, body, created_by, created_at, source_kind, supersedes_id, visto_pelo_dono_em,
  CASE WHEN source_kind = 'agent_update' THEN (
    SELECT json_extract(a.details_json, '$.motivo') FROM audit_logs a
    WHERE a.project_id = charter_revisions.project_id AND a.resource_id = charter_revisions.id
      AND a.action IN ('${ACAO_DA_ATUALIZACAO}', 'import_project_objective')
    LIMIT 1
  ) END AS motivo`

export function mapearDiretriz(row: SqlRow): CharterRevision {
  const diretriz = mapCharter(row)
  if (row.source_kind !== 'agent_update') return diretriz

  const motivo = nullableText(row, 'motivo')
  const vistoPeloDonoEm = nullableText(row, 'visto_pelo_dono_em')
  return {
    ...diretriz,
    sourceKind: 'agent_update',
    ...(motivo === null ? {} : { motivo }),
    ...(vistoPeloDonoEm === null ? {} : { vistoPeloDonoEm }),
  }
}

export function entradaDaDiretriz(input: SaveCharterInput) {
  const rec = asRecord(input, 'charter')
  const actor = requireString(rec.actor, 'actor', 1, 80)
  const body = requireString(rec.body, 'body', 1, 8000)
  const expectedRevision = requireInt(rec.expectedRevision, 'expectedRevision', 0)
  if (rec.sourceKind === 'agent_proposal' || rec.sourceKind === 'agent_update') {
    throw new DomainError(409, 'human_approval_required', 'Uma proposta de agente não pode alterar o charter vigente sem aceite humano.')
  }
  return { actor, body, expectedRevision }
}

type RevisaoNova = Pick<CharterRevision, 'body' | 'createdBy' | 'createdAt'> & {
  sourceKind: 'human_directive' | 'agent_update'
  expectedRevision: number
}

/** A leitura da revisão vigente e esta escrita ocorrem na mesma transação. */
export function gravarDiretriz(db: DatabaseSync, projectId: string, atual: CharterRevision | null, nova: RevisaoNova): CharterRevision {
  const revision = (atual?.revision ?? 0) + 1
  if (revision - 1 !== nova.expectedRevision) {
    throw new DomainError(409, 'version_conflict', 'A revisão do charter mudou. Recarregue o contexto.')
  }
  const { body, createdBy, createdAt, sourceKind } = nova
  const diretriz: CharterRevision = {
    id: randomUUID(), projectId, revision, body, createdBy, createdAt, sourceKind,
    supersedesId: atual?.id ?? null,
  }
  db.prepare(`
    INSERT INTO charter_revisions (id, project_id, revision, body, created_by, created_at, source_kind, supersedes_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(diretriz.id, projectId, revision, body, createdBy, createdAt, sourceKind, diretriz.supersedesId)
  db.prepare('UPDATE projects SET objective = ?, updated_at = ? WHERE id = ?').run(body, createdAt, projectId)
  return diretriz
}

export function atualizarObjetivo(
  db: DatabaseSync,
  projectId: string,
  atual: CharterRevision | null,
  input: UpdateProjectObjectiveInput,
  createdAt: string,
  logAudit: WorkspaceStore['logAudit'],
): CharterRevision {
  const rec = asRecord(input, 'atualização do objetivo')
  const motivo = requireString(rec.motivo, 'motivo', 1, 500)
  const diretriz = gravarDiretriz(db, projectId, atual, {
    body: requireString(rec.objetivo, 'objetivo', 1, 8000),
    createdBy: requireString(rec.agent, 'agent', 1, 80),
    expectedRevision: requireInt(rec.expectedRevision, 'expectedRevision', 0),
    createdAt,
    sourceKind: 'agent_update',
  })
  const auditoria = logAudit({
    actorType: 'agent', actorId: diretriz.createdBy, action: ACAO_DA_ATUALIZACAO,
    resourceType: 'charter', resourceId: diretriz.id, projectId, details: { motivo },
  })
  return { ...diretriz, motivo: auditoria.details.motivo as string }
}

export function marcarObjetivoVisto(db: DatabaseSync, atual: CharterRevision | null, agora: string): CharterRevision | null {
  if (atual?.sourceKind !== 'agent_update' || atual.vistoPeloDonoEm !== undefined) return atual
  db.prepare('UPDATE charter_revisions SET visto_pelo_dono_em = ? WHERE id = ?').run(agora, atual.id)
  return { ...atual, vistoPeloDonoEm: agora }
}

function nadaADesfazer(): never {
  throw new DomainError(409, 'nada_a_desfazer', 'Não há atualização de objetivo para desfazer.')
}

export function desfazerAtualizacaoDoObjetivo(db: DatabaseSync, atual: CharterRevision | null, agora: string): CharterRevision {
  if (atual?.sourceKind !== 'agent_update') return nadaADesfazer()
  const anterior = db.prepare(`
    SELECT body FROM charter_revisions
    WHERE project_id = ? AND source_kind = 'human_directive'
    ORDER BY revision DESC LIMIT 1
  `).get(atual.projectId) as { body: string } | undefined
  if (!anterior) return nadaADesfazer()
  return gravarDiretriz(db, atual.projectId, atual, {
    body: anterior.body, createdBy: 'Dono', createdAt: agora, sourceKind: 'human_directive',
    expectedRevision: atual.revision,
  })
}

export function verificarDonoDoObjetivo(auth: AuthContext | undefined, projectId: string): void {
  if (auth?.role !== 'owner' || auth.actorType === 'agent' || (auth.projectId && auth.projectId !== projectId)) {
    throw new DomainError(403, 'so_o_dono', 'Só o dono pode conferir ou desfazer uma atualização do objetivo.')
  }
}
