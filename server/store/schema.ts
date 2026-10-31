import type { DatabaseSync } from 'node:sqlite'
import { ensureApagamentoSchema } from './apagamento.js'
import { ensureApprovalsSchema } from './approvals.js'
import { ensureBoardSchema } from './board.js'
import { ensureIntegracaoSchema } from './integracao.js'
import { ensureLicoesSchema } from './licoes.js'
import { ensureMemoriaSchema } from '../busca/indice.js'

/**
 * Cria (se ausente) todas as tabelas, índices e triggers do workspace, e garante
 * colunas adicionadas em versões posteriores do schema via `ensureColumn`.
 *
 * Extraído de `WorkspaceStore.migrate()` em server/store.ts — o DDL não mudou
 * uma vírgula. `ensureColumn` continua de propriedade da classe (é chamado de
 * volta via callback) porque é um helper genérico, não exclusivo da migração.
 */
export function runMigrations(
  db: DatabaseSync,
  ensureColumn: (table: string, column: string, type: string) => void,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      acceptance_criteria_json TEXT,
      dependency_task_ids_json TEXT,
      expected_outputs_json TEXT,
      status TEXT NOT NULL,
      assignee TEXT,
      lease_until TEXT,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      blocked_reason TEXT,
      completion_checkpoint_id TEXT,
      work_intent_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      task_id TEXT REFERENCES tasks(id),
      agent TEXT NOT NULL,
      summary TEXT NOT NULL,
      next_step TEXT NOT NULL,
      blockers_json TEXT NOT NULL,
      decisions_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_canonical TEXT NOT NULL,
      UNIQUE (project_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON checkpoints(project_id, revision);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, created_at, id);
    CREATE TABLE IF NOT EXISTS message_receipts (
      project_id TEXT NOT NULL REFERENCES projects(id),
      message_id TEXT NOT NULL REFERENCES messages(id),
      agent TEXT NOT NULL,
      acknowledged_at TEXT NOT NULL,
      PRIMARY KEY (message_id, agent)
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_project_agent ON message_receipts(project_id, agent);
    CREATE TABLE IF NOT EXISTS message_resolutions (
      project_id TEXT NOT NULL REFERENCES projects(id),
      message_id TEXT NOT NULL REFERENCES messages(id),
      agent TEXT NOT NULL,
      note TEXT NOT NULL,
      response_message_id TEXT REFERENCES messages(id),
      checkpoint_id TEXT REFERENCES checkpoints(id),
      resolved_at TEXT NOT NULL,
      payload_canonical TEXT NOT NULL,
      PRIMARY KEY (message_id, agent)
    );
    CREATE INDEX IF NOT EXISTS idx_message_resolutions_project_agent
      ON message_resolutions(project_id, agent);
    CREATE TABLE IF NOT EXISTS handoff_deliveries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id),
      task_id TEXT REFERENCES tasks(id),
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_handoff_deliveries_project
      ON handoff_deliveries(project_id, created_at, id);
    CREATE TABLE IF NOT EXISTS handoff_receipts (
      project_id TEXT NOT NULL REFERENCES projects(id),
      delivery_id TEXT NOT NULL REFERENCES handoff_deliveries(id),
      agent TEXT NOT NULL,
      acknowledged_at TEXT NOT NULL,
      PRIMARY KEY (delivery_id, agent)
    );
    CREATE INDEX IF NOT EXISTS idx_handoff_receipts_project_agent
      ON handoff_receipts(project_id, agent);
    CREATE TABLE IF NOT EXISTS backlog_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL,
      stage TEXT NOT NULL,
      created_by TEXT NOT NULL,
      promoted_task_id TEXT REFERENCES tasks(id),
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_backlog_items_project
      ON backlog_items(project_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_backlog_items_promoted_task
      ON backlog_items(promoted_task_id);
    CREATE TABLE IF NOT EXISTS work_drafts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      actor_id TEXT NOT NULL,
      task_id TEXT REFERENCES tasks(id),
      task_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      summary TEXT NOT NULL,
      next_action TEXT NOT NULL,
      changed_areas_json TEXT NOT NULL,
      open_issues_json TEXT NOT NULL,
      observed_checks_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, actor_id, task_key)
    );
    CREATE INDEX IF NOT EXISTS idx_work_drafts_project_actor
      ON work_drafts(project_id, actor_id, updated_at);
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      proposed_by TEXT NOT NULL,
      accepted_by TEXT,
      revoked_by TEXT,
      supersedes_id TEXT REFERENCES decisions(id) ON DELETE SET NULL,
      superseded_by_id TEXT REFERENCES decisions(id) ON DELETE SET NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_project
      ON decisions(project_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_decisions_supersedes
      ON decisions(supersedes_id);
    CREATE TABLE IF NOT EXISTS charter_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      revision INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      supersedes_id TEXT REFERENCES charter_revisions(id) ON DELETE SET NULL,
      UNIQUE (project_id, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_charter_project
      ON charter_revisions(project_id, revision);
    CREATE TABLE IF NOT EXISTS blockers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      task_id TEXT REFERENCES tasks(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      opened_by TEXT NOT NULL,
      assignee TEXT,
      resolution TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      source_checkpoint_id TEXT REFERENCES checkpoints(id),
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blockers_project
      ON blockers(project_id, status, created_at, id);
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      task_id TEXT NOT NULL REFERENCES tasks(id),
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      agent TEXT NOT NULL,
      note TEXT NOT NULL,
      checkpoint_id TEXT REFERENCES checkpoints(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task
      ON task_events(project_id, task_id, created_at, id);
    CREATE TABLE IF NOT EXISTS finalize_work (
      project_id TEXT NOT NULL REFERENCES projects(id),
      idempotency_key TEXT NOT NULL,
      payload_canonical TEXT NOT NULL,
      checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id),
      delivery_id TEXT REFERENCES handoff_deliveries(id),
      discarded_draft INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS content_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      current_revision_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_items_project
      ON content_items(project_id, status, updated_at, id);
    CREATE TABLE IF NOT EXISTS content_revisions (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES content_items(id),
      revision INTEGER NOT NULL,
      body TEXT NOT NULL,
      format TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      supersedes_id TEXT REFERENCES content_revisions(id),
      source_kind TEXT NOT NULL,
      source_label TEXT,
      source_url TEXT,
      declared_validity TEXT NOT NULL,
      UNIQUE (item_id, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_content_revisions_item
      ON content_revisions(item_id, revision, id);
    CREATE TRIGGER IF NOT EXISTS trg_content_revisions_immutable
    BEFORE UPDATE ON content_revisions
    BEGIN
      SELECT RAISE(ABORT, 'content revisions are immutable');
    END;
    CREATE TABLE IF NOT EXISTS content_relations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      source_revision_id TEXT NOT NULL REFERENCES content_revisions(id),
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_relations_source
      ON content_relations(project_id, source_revision_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_content_relations_target
      ON content_relations(project_id, target_type, target_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
      item_id UNINDEXED,
      project_id UNINDEXED,
      title,
      body,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

    CREATE TABLE IF NOT EXISTS paired_devices (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      device_name TEXT NOT NULL,
      device_fingerprint TEXT NOT NULL,
      pairing_code TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      ip_address TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_paired_devices_account ON paired_devices(account_id, status);

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_members_account ON project_members(account_id);

    CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      token_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      token_type TEXT NOT NULL,
      role TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      agent_name TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      revoked_at TEXT,
      revoked_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_account ON auth_tokens(account_id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_project ON auth_tokens(project_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      project_id TEXT,
      ip_address TEXT,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp, id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_project ON audit_logs(project_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, timestamp);

    CREATE TABLE IF NOT EXISTS evidence_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id),
      position INTEGER NOT NULL,
      command TEXT NOT NULL,
      outcome TEXT NOT NULL,
      details TEXT NOT NULL,
      reported_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (checkpoint_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_records_project
      ON evidence_records(project_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_evidence_records_checkpoint
      ON evidence_records(checkpoint_id, position);
    CREATE TRIGGER IF NOT EXISTS trg_evidence_records_immutable
    BEFORE UPDATE ON evidence_records
    BEGIN
      SELECT RAISE(ABORT, 'evidence records are immutable');
    END;

    CREATE TABLE IF NOT EXISTS evidence_artifacts (
      id TEXT PRIMARY KEY,
      evidence_id TEXT NOT NULL REFERENCES evidence_records(id),
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER,
      observed_at TEXT NOT NULL,
      UNIQUE (evidence_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_artifacts_evidence
      ON evidence_artifacts(evidence_id);
    CREATE TRIGGER IF NOT EXISTS trg_evidence_artifacts_immutable
    BEFORE UPDATE ON evidence_artifacts
    BEGIN
      SELECT RAISE(ABORT, 'evidence artifacts are immutable');
    END;

    CREATE TABLE IF NOT EXISTS evidence_verifications (
      id TEXT PRIMARY KEY,
      evidence_id TEXT NOT NULL REFERENCES evidence_records(id),
      verified_by TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_verifications_evidence
      ON evidence_verifications(evidence_id, created_at, id);
    CREATE TRIGGER IF NOT EXISTS trg_evidence_verifications_immutable
    BEFORE UPDATE ON evidence_verifications
    BEGIN
      SELECT RAISE(ABORT, 'evidence verifications are immutable');
    END;

    CREATE TABLE IF NOT EXISTS blocker_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      blocker_id TEXT NOT NULL REFERENCES blockers(id),
      transition TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor TEXT NOT NULL,
      note TEXT,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blocker_events_blocker
      ON blocker_events(blocker_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_blocker_events_project
      ON blocker_events(project_id, created_at, id);
    CREATE TRIGGER IF NOT EXISTS trg_blocker_events_immutable
    BEFORE UPDATE ON blocker_events
    BEGIN
      SELECT RAISE(ABORT, 'blocker events are immutable');
    END;

    CREATE TABLE IF NOT EXISTS decision_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      decision_id TEXT NOT NULL REFERENCES decisions(id),
      transition TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor TEXT NOT NULL,
      note TEXT,
      related_decision_id TEXT REFERENCES decisions(id),
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decision_events_decision
      ON decision_events(decision_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_decision_events_project
      ON decision_events(project_id, created_at, id);
    CREATE TRIGGER IF NOT EXISTS trg_decision_events_immutable
    BEFORE UPDATE ON decision_events
    BEGIN
      SELECT RAISE(ABORT, 'decision events are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_checkpoints_immutable
    BEFORE UPDATE ON checkpoints
    BEGIN
      SELECT RAISE(ABORT, 'checkpoints are immutable');
    END;
  `)
  ensureColumn('tasks', 'blocked_reason', 'TEXT')
  ensureColumn('tasks', 'completion_checkpoint_id', 'TEXT')
  ensureColumn('tasks', 'work_intent_json', 'TEXT')
  ensureColumn('tasks', 'description', 'TEXT')
  ensureColumn('tasks', 'priority', "TEXT NOT NULL DEFAULT 'medium'")
  ensureColumn('tasks', 'acceptance_criteria_json', 'TEXT')
  ensureColumn('tasks', 'dependency_task_ids_json', 'TEXT')
  ensureColumn('tasks', 'expected_outputs_json', 'TEXT')
  // Parte 4 — humanSummary: coluna nova via ALTER TABLE ADD COLUMN, nunca UPDATE
  // nos registros antigos. `checkpoints` tem trigger BEFORE UPDATE
  // (trg_checkpoints_immutable) que aborta qualquer tentativa de reescrever
  // uma linha existente; `ensureColumn` só adiciona a coluna, nunca popula.
  ensureColumn('checkpoints', 'human_summary', 'TEXT')
  // Lote 2, D5 — salvamento de compactação: o tipo do checkpoint e os extras. Mesma regra do
  // human_summary: só ALTER TABLE; os registros antigos ficam 'normal' pelo DEFAULT, sem UPDATE.
  ensureColumn('checkpoints', 'kind', "TEXT NOT NULL DEFAULT 'normal'")
  ensureColumn('checkpoints', 'extras_json', 'TEXT')
  // Parte 5 — fila de aprovações: tabela nova isolada em server/store/approvals.ts.
  // Apagar a Parte 5 remove essa chamada e o import acima.
  ensureApprovalsSchema(db)
  // Parte 14 — quadro do projeto: tabelas isoladas em server/store/board.ts.
  ensureBoardSchema(db)
  // Continuidade sem esforço — saúde dos ganchos do Claude Code: tabela isolada em server/store/integracao.ts.
  ensureIntegracaoSchema(db)
  // Lote 2 — lições que o Claude não repete: tabela isolada em server/store/licoes.ts.
  ensureLicoesSchema(db)
  // 27/10/2026 — o dono apaga trecho ou registro inteiro: licença de apagamento e gatilhos de imutabilidade
  // que a aceitam, em server/store/apagamento.ts. Sem licença, todo UPDATE de checkpoint continua abortando.
  ensureApagamentoSchema(db)
  // Lote 2, D7 — busca na memória: índice e gatilhos isolados em server/busca/indice.ts. Fica por último,
  // porque os gatilhos leem as tabelas e colunas criadas acima (banco antigo ganha o índice aqui).
  ensureMemoriaSchema(db)
}
