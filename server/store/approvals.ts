import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  ApprovalKind,
  ApprovalRequest,
  ApprovalStatus,
  DecideApprovalInput,
  ListApprovalsOptions,
  ProposeApprovalInput,
  WithdrawApprovalInput,
} from '../../shared/approvals.js'
import { DomainError } from './errors.js'
import { asRecord, nullableText, numberish, requireInt, requireString, text } from './validation.js'
import type { SqlRow, SqlValue } from './sql.js'

/**
 * Fila de aprovações (Parte 5) — toda a lógica de domínio, schema e mapeamento
 * num único arquivo novo, para que apagar a Parte 5 seja apagar este arquivo
 * mais os pontos de fiação finos listados no relatório (chamada em
 * server/store/schema.ts, métodos delegados em server/store.ts, rotas em
 * server/app.ts, ferramentas em server/mcp-tools.ts e o campo em ResumeBrief).
 *
 * `approveApprovalRequest`/`rejectApprovalRequest` só são chamadas a partir de
 * server/app.ts (HTTP). server/mcp-tools.ts nunca as registra — ver
 * tests/approvals.test.ts para o teste que afirma a ausência.
 */

const APPROVAL_KINDS = new Set<ApprovalKind>(['charter_change', 'note'])
const APPROVAL_STATUSES = new Set<ApprovalStatus>(['pending', 'approved', 'rejected', 'withdrawn'])

const APPROVAL_COLUMNS = `id, project_id, kind, title, body, rationale, proposed_by, status, decided_by, decided_at, decision_note, created_at, version`

export function ensureApprovalsSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      rationale TEXT NOT NULL,
      proposed_by TEXT NOT NULL,
      status TEXT NOT NULL,
      decided_by TEXT,
      decided_at TEXT,
      decision_note TEXT,
      created_at TEXT NOT NULL,
      version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approval_requests_project
      ON approval_requests(project_id, status, created_at, id);
  `)
}

function requireApprovalKind(value: unknown): ApprovalKind {
  if (typeof value !== 'string' || !APPROVAL_KINDS.has(value as ApprovalKind)) {
    throw new DomainError(400, 'invalid_input', 'Campo kind inválido. Use charter_change ou note.')
  }
  return value as ApprovalKind
}

function requireApprovalStatusFilter(value: unknown): ApprovalStatus {
  if (typeof value !== 'string' || !APPROVAL_STATUSES.has(value as ApprovalStatus)) {
    throw new DomainError(400, 'invalid_input', 'Campo status inválido.')
  }
  return value as ApprovalStatus
}

function optionalDecisionNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return requireString(value, 'decisionNote', 1, 2000)
}

export function mapApprovalRequest(row: SqlRow): ApprovalRequest {
  const kind = text(row, 'kind')
  const status = text(row, 'status')
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    kind: APPROVAL_KINDS.has(kind as ApprovalKind) ? (kind as ApprovalKind) : 'note',
    title: text(row, 'title'),
    body: text(row, 'body'),
    rationale: text(row, 'rationale'),
    proposedBy: text(row, 'proposed_by'),
    status: APPROVAL_STATUSES.has(status as ApprovalStatus) ? (status as ApprovalStatus) : 'pending',
    decidedBy: nullableText(row, 'decided_by'),
    decidedAt: nullableText(row, 'decided_at'),
    decisionNote: nullableText(row, 'decision_note'),
    createdAt: text(row, 'created_at'),
    version: numberish(row.version),
  }
}

export function requireApprovalRequest(db: DatabaseSync, projectId: string, approvalId: string): ApprovalRequest {
  const row = db
    .prepare(`SELECT ${APPROVAL_COLUMNS} FROM approval_requests WHERE id = ? AND project_id = ?`)
    .get(approvalId, projectId)
  if (!row) throw new DomainError(404, 'not_found', 'Proposta de aprovação não encontrada neste projeto.')
  return mapApprovalRequest(row as SqlRow)
}

export function proposeApprovalRequest(
  db: DatabaseSync,
  projectId: string,
  input: ProposeApprovalInput,
  ts: string,
): ApprovalRequest {
  const rec = asRecord(input, 'proposta')
  const agent = requireString(rec.agent, 'agent', 1, 80)
  const kind = requireApprovalKind(rec.kind)
  const title = requireString(rec.title, 'title', 1, 200)
  const body = requireString(rec.body, 'body', 1, 8000)
  const rationale = requireString(rec.rationale, 'rationale', 1, 2000)
  const id = randomUUID()
  db.prepare(
    `INSERT INTO approval_requests (
       id, project_id, kind, title, body, rationale, proposed_by, status,
       decided_by, decided_at, decision_note, created_at, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, 0)`,
  ).run(id, projectId, kind, title, body, rationale, agent, ts)
  return requireApprovalRequest(db, projectId, id)
}

export function listApprovalRequests(
  db: DatabaseSync,
  projectId: string,
  options?: ListApprovalsOptions,
): ApprovalRequest[] {
  const opts = options === undefined ? {} : asRecord(options, 'opções')
  const status = opts.status === undefined ? undefined : requireApprovalStatusFilter(opts.status)
  const sql = `
    SELECT ${APPROVAL_COLUMNS} FROM approval_requests
    WHERE project_id = ? ${status ? 'AND status = ?' : ''}
    ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at ASC, id ASC
  `
  const rows = status ? db.prepare(sql).all(projectId, status) : db.prepare(sql).all(projectId)
  return rows.map((row) => mapApprovalRequest(row as SqlRow))
}

/**
 * Retirar (Parte 5): só quem propôs, e só enquanto pendente. Estados finais
 * são finais — uma proposta decidida ou retirada não volta a pendente.
 */
export function withdrawApprovalRequest(
  db: DatabaseSync,
  projectId: string,
  approvalId: string,
  input: WithdrawApprovalInput,
  ts: string,
): ApprovalRequest {
  const rec = asRecord(input, 'retirada')
  const agent = requireString(rec.agent, 'agent', 1, 80)
  const expectedVersion = requireInt(rec.expectedVersion, 'expectedVersion', 0)
  const current = requireApprovalRequest(db, projectId, approvalId)
  if (current.version !== expectedVersion) {
    throw new DomainError(409, 'version_conflict', 'A versão da proposta mudou. Recarregue o contexto.')
  }
  if (current.status !== 'pending') {
    throw new DomainError(
      409,
      'approval_not_pending',
      'Esta proposta já foi decidida ou retirada; estados finais não voltam a pendente.',
    )
  }
  if (current.proposedBy !== agent) {
    throw new DomainError(403, 'not_proposer', 'Só quem propôs pode retirar esta proposta.')
  }
  const updated = db
    .prepare(
      `UPDATE approval_requests
       SET status = 'withdrawn', decided_by = ?, decided_at = ?, version = version + 1
       WHERE id = ? AND project_id = ? AND version = ?`,
    )
    .run(agent, ts, approvalId, projectId, expectedVersion)
  if (numberish(updated.changes) !== 1) {
    throw new DomainError(409, 'version_conflict', 'A versão da proposta mudou. Recarregue o contexto.')
  }
  return requireApprovalRequest(db, projectId, approvalId)
}

/**
 * Aprovar (Parte 5, só HTTP — nunca chamada a partir de uma ferramenta MCP).
 * Para `kind: 'charter_change'`, grava a nova revisão do charter como diretiva
 * humana na MESMA transação (o chamador em server/store.ts já envolve isto em
 * `this.mutate`): a checagem de `expectedCharterRevision` acontece antes de
 * qualquer escrita, então um conflito de revisão falha inteiro, sem aplicar
 * metade. `kind: 'note'` só decide a proposta; nunca toca o charter.
 */
export function approveApprovalRequest(
  db: DatabaseSync,
  projectId: string,
  approvalId: string,
  input: DecideApprovalInput,
  ts: string,
): ApprovalRequest {
  const rec = asRecord(input, 'decisão')
  const actor = requireString(rec.actor, 'actor', 1, 80)
  const expectedVersion = requireInt(rec.expectedVersion, 'expectedVersion', 0)
  const decisionNote = optionalDecisionNote(rec.decisionNote)
  const current = requireApprovalRequest(db, projectId, approvalId)
  if (current.version !== expectedVersion) {
    throw new DomainError(409, 'version_conflict', 'A versão da proposta mudou. Recarregue o contexto.')
  }
  if (current.status !== 'pending') {
    throw new DomainError(
      409,
      'approval_not_pending',
      'Esta proposta já foi decidida ou retirada; estados finais não voltam a pendente.',
    )
  }

  if (current.kind === 'charter_change') {
    const expectedCharterRevision = requireInt(rec.expectedCharterRevision, 'expectedCharterRevision', 0)
    const charterRow = db
      .prepare(
        `SELECT id, revision FROM charter_revisions
         WHERE project_id = ? ORDER BY revision DESC, id DESC LIMIT 1`,
      )
      .get(projectId) as { id: SqlValue; revision: SqlValue } | undefined
    const currentRevision = charterRow ? numberish(charterRow.revision) : 0
    if (currentRevision !== expectedCharterRevision) {
      throw new DomainError(
        409,
        'charter_revision_conflict',
        'A revisão do charter mudou desde que esta proposta foi lida. Releia o charter e decida de novo.',
      )
    }
    const newCharterId = randomUUID()
    db.prepare(
      `INSERT INTO charter_revisions (
         id, project_id, revision, body, created_by, created_at, source_kind, supersedes_id
       ) VALUES (?, ?, ?, ?, ?, ?, 'human_directive', ?)`,
    ).run(newCharterId, projectId, currentRevision + 1, current.body, actor, ts, charterRow ? charterRow.id : null)
    db.prepare(`UPDATE projects SET objective = ?, updated_at = ? WHERE id = ?`).run(current.body, ts, projectId)
  }

  const updated = db
    .prepare(
      `UPDATE approval_requests
       SET status = 'approved', decided_by = ?, decided_at = ?, decision_note = ?, version = version + 1
       WHERE id = ? AND project_id = ? AND version = ?`,
    )
    .run(actor, ts, decisionNote, approvalId, projectId, expectedVersion)
  if (numberish(updated.changes) !== 1) {
    throw new DomainError(409, 'version_conflict', 'A versão da proposta mudou. Recarregue o contexto.')
  }
  return requireApprovalRequest(db, projectId, approvalId)
}

/** Recusar (Parte 5, só HTTP). Nunca toca a diretriz, seja qual for o kind. */
export function rejectApprovalRequest(
  db: DatabaseSync,
  projectId: string,
  approvalId: string,
  input: DecideApprovalInput,
  ts: string,
): ApprovalRequest {
  const rec = asRecord(input, 'decisão')
  const actor = requireString(rec.actor, 'actor', 1, 80)
  const expectedVersion = requireInt(rec.expectedVersion, 'expectedVersion', 0)
  const decisionNote = optionalDecisionNote(rec.decisionNote)
  const current = requireApprovalRequest(db, projectId, approvalId)
  if (current.version !== expectedVersion) {
    throw new DomainError(409, 'version_conflict', 'A versão da proposta mudou. Recarregue o contexto.')
  }
  if (current.status !== 'pending') {
    throw new DomainError(
      409,
      'approval_not_pending',
      'Esta proposta já foi decidida ou retirada; estados finais não voltam a pendente.',
    )
  }
  const updated = db
    .prepare(
      `UPDATE approval_requests
       SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ?, version = version + 1
       WHERE id = ? AND project_id = ? AND version = ?`,
    )
    .run(actor, ts, decisionNote, approvalId, projectId, expectedVersion)
  if (numberish(updated.changes) !== 1) {
    throw new DomainError(409, 'version_conflict', 'A versão da proposta mudou. Recarregue o contexto.')
  }
  return requireApprovalRequest(db, projectId, approvalId)
}
