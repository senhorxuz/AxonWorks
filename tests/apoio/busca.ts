import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../server/store/schema.ts'

/**
 * Apoio dos testes da busca na memória (D7): um banco com o esquema inteiro da Axon (as mesmas
 * migrações do store), sem o store, e sementes com id e data fixos, gravadas direto nas tabelas de
 * origem. Os gatilhos do índice é que levam cada linha para a busca, como no uso real.
 */

export const P1 = '11111111-1111-4111-8111-111111111111'
export const P2 = '22222222-2222-4222-8222-222222222222'

export type TipoSemente =
  | 'checkpoint'
  | 'decisao'
  | 'diretriz'
  | 'cartao'
  | 'backlog'
  | 'bloqueio'
  | 'mensagem'
  | 'licao'
  | 'biblioteca'

export interface Semente {
  tipo: TipoSemente
  id: string
  /** `null` só para lição global. */
  projectId: string | null
  titulo?: string
  corpo: string
  data: string
  /** Decisão: status (accepted, proposed, revoked, superseded). Lição: 'aposentada'. Checkpoint: 'compactacao'. Biblioteca: 'archived'. */
  estado?: string
  /** Diretriz: número da revisão. */
  revisao?: number
  /** Checkpoint: próximo passo. Bloqueio: resolução. */
  extra?: string
}

export function garantirColuna(db: DatabaseSync, tabela: string, coluna: string, tipo: string): void {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>
  if (colunas.some((linha) => linha.name === coluna)) return
  db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`)
}

/** Banco com as migrações da Axon (inclusive o índice da memória). */
export function bancoMigrado(caminho = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(caminho, { enableForeignKeyConstraints: true })
  runMigrations(db, (tabela, coluna, tipo) => garantirColuna(db, tabela, coluna, tipo))
  return db
}

export function criarProjeto(db: DatabaseSync, id: string, nome = 'Projeto'): void {
  db.prepare(
    `INSERT INTO projects (id, name, objective, workspace_path, created_at, updated_at, revision)
     VALUES (?, ?, '', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
  ).run(id, nome)
}

const GRAVAR: Record<TipoSemente, (db: DatabaseSync, s: Semente) => void> = {
  checkpoint: (db, s) =>
    db
      .prepare(
        `INSERT INTO checkpoints (id, project_id, agent, summary, next_step, blockers_json, decisions_json,
           evidence_json, revision, created_at, idempotency_key, payload_canonical, human_summary, kind)
         VALUES (?, ?, 'claude', ?, ?, '[]', '[]', '[]', 1, ?, ?, '{}', ?, ?)`,
      )
      .run(s.id, s.projectId, s.corpo, s.extra ?? '', s.data, s.id, s.titulo ?? null, s.estado ?? 'normal'),
  decisao: (db, s) =>
    db
      .prepare(
        `INSERT INTO decisions (id, project_id, title, body, status, proposed_by, version, created_at, updated_at, source_kind)
         VALUES (?, ?, ?, ?, ?, 'claude', 1, ?, ?, 'agent_proposal')`,
      )
      .run(s.id, s.projectId, s.titulo ?? '', s.corpo, s.estado ?? 'accepted', s.data, s.data),
  diretriz: (db, s) =>
    db
      .prepare(
        `INSERT INTO charter_revisions (id, project_id, revision, body, created_by, created_at, source_kind)
         VALUES (?, ?, ?, ?, 'dono', ?, 'human_directive')`,
      )
      .run(s.id, s.projectId, s.revisao ?? 1, s.corpo, s.data),
  cartao: (db, s) =>
    db
      .prepare(
        `INSERT INTO board_cards (id, project_id, column_id, position, title, description, labels_json, priority,
           checklist_json, created_by, updated_by, created_at, updated_at, version)
         VALUES (?, ?, 'pendente', 1, ?, ?, '[]', NULL, '[]', 'claude', 'claude', ?, ?, 1)`,
      )
      .run(s.id, s.projectId, s.titulo ?? '', s.corpo, s.data, s.data),
  backlog: (db, s) =>
    db
      .prepare(
        `INSERT INTO backlog_items (id, project_id, title, description, priority, stage, created_by, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'medium', 'idea', 'claude', 1, ?, ?)`,
      )
      .run(s.id, s.projectId, s.titulo ?? '', s.corpo, s.data, s.data),
  bloqueio: (db, s) =>
    db
      .prepare(
        `INSERT INTO blockers (id, project_id, title, body, status, opened_by, resolution, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', 'claude', ?, 1, ?, ?)`,
      )
      .run(s.id, s.projectId, s.titulo ?? '', s.corpo, s.extra ?? null, s.data, s.data),
  mensagem: (db, s) =>
    db
      .prepare(
        `INSERT INTO messages (id, project_id, from_agent, to_agent, kind, body, created_at)
         VALUES (?, ?, 'claude', 'dono', 'note', ?, ?)`,
      )
      .run(s.id, s.projectId, s.corpo, s.data),
  licao: (db, s) =>
    db
      .prepare(
        `INSERT INTO licoes (id, project_id, texto, origem, criada_em, aposentada_em, motivo_aposentadoria)
         VALUES (?, ?, ?, 'claude', ?, ?, ?)`,
      )
      .run(
        s.id,
        s.projectId,
        s.corpo,
        s.data,
        s.estado === 'aposentada' ? s.data : null,
        s.estado === 'aposentada' ? 'Deixou de valer.' : null,
      ),
  // Como o store grava: primeiro o item (apontando para a revisão vigente), depois a revisão.
  biblioteca: (db, s) => {
    db.prepare(
      `INSERT INTO content_items (id, project_id, title, kind, status, current_revision_id, version, created_at, updated_at)
       VALUES (?, ?, ?, 'note', ?, ?, 1, ?, ?)`,
    ).run(s.id, s.projectId, s.titulo ?? '', s.estado ?? 'active', `${s.id}-r1`, s.data, s.data)
    db.prepare(
      `INSERT INTO content_revisions (id, item_id, revision, body, format, created_by, created_at, source_kind, declared_validity)
       VALUES (?, ?, 1, ?, 'plain_text', 'claude', ?, 'agent_report', 'current')`,
    ).run(`${s.id}-r1`, s.id, s.corpo, s.data)
  },
}

export function semear(db: DatabaseSync, ...sementes: Semente[]): void {
  for (const semente of sementes) GRAVAR[semente.tipo](db, semente)
}

/** Id de teste no formato de UUID, a partir de um número (`uuid(7)` = `00000000-0000-4000-8000-000000000007`). */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}
