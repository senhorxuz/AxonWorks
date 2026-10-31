import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  BOARD_COLUMNS,
  BOARD_LABELS,
  BOARD_LIMITS,
  type BoardCard,
  type BoardCardEvent,
  type BoardCardEventKind,
  type BoardChecklistItem,
  type BoardColumnId,
  type BoardLabelId,
  type BoardPriority,
  type BoardSnapshot,
  type CreateBoardCardInput,
  type DeleteBoardCardInput,
  type MoveBoardCardInput,
  type UpdateBoardCardInput,
} from '../../shared/board.js'
import { frasesDaMarca, garantirColunaDaMarca, resolverMarca } from './board-marca.js'
import { DomainError } from './errors.js'
import { asRecord, assertIntactText, nullableText, numberish, requireInt, requireString, text } from './validation.js'
import type { SqlRow } from './sql.js'

const COLUMN_NAMES = new Map<BoardColumnId, string>(BOARD_COLUMNS.map((c) => [c.id, c.name]))
const VALID_LABEL_IDS = new Set<BoardLabelId>(BOARD_LABELS.map((l) => l.id))
const VALID_PRIORITIES = new Set<BoardPriority>(['urgent', 'high', 'medium', 'low'])

const BOARD_CARD_COLUMNS = `id, project_id, column_id, position, title, description, labels_json, priority, checklist_json, needs_owner, created_by, updated_by, created_at, updated_at, version`

export function ensureBoardSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS board_cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      column_id TEXT NOT NULL,
      position REAL NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      labels_json TEXT NOT NULL,
      priority TEXT,
      checklist_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_board_cards_pos
      ON board_cards(project_id, column_id, position);

    CREATE TABLE IF NOT EXISTS board_card_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      card_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      actor TEXT NOT NULL,
      from_column TEXT,
      to_column TEXT,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_board_card_events_card
      ON board_card_events(project_id, card_id, created_at, id);
    CREATE TRIGGER IF NOT EXISTS trg_board_card_events_immutable
    BEFORE UPDATE ON board_card_events
    BEGIN
      SELECT RAISE(ABORT, 'board card events are immutable');
    END;
  `)
  garantirColunaDaMarca(db)
}

export function mapBoardCard(row: SqlRow): BoardCard {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    column: text(row, 'column_id') as BoardColumnId,
    position: numberish(row.position),
    title: text(row, 'title'),
    description: text(row, 'description'),
    labels: JSON.parse(text(row, 'labels_json')) as BoardLabelId[],
    priority: nullableText(row, 'priority') as BoardPriority | null,
    checklist: JSON.parse(text(row, 'checklist_json')) as BoardChecklistItem[],
    needsOwner: numberish(row.needs_owner) === 1,
    createdBy: text(row, 'created_by'),
    updatedBy: text(row, 'updated_by'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    version: numberish(row.version),
  }
}

export function mapBoardCardEvent(row: SqlRow): BoardCardEvent {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    cardId: text(row, 'card_id'),
    kind: text(row, 'kind') as BoardCardEventKind,
    actor: text(row, 'actor'),
    fromColumn: nullableText(row, 'from_column') as BoardColumnId | null,
    toColumn: nullableText(row, 'to_column') as BoardColumnId | null,
    summary: text(row, 'summary'),
    createdAt: text(row, 'created_at'),
  }
}

function requireBoardTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DomainError(400, 'invalid_input', 'Campo title inválido.')
  }
  assertIntactText(value, 'title')
  const trimmed = value.trim()
  if (trimmed.length > BOARD_LIMITS.titleMax) {
    throw new DomainError(
      400,
      'board_title_too_long',
      'O título passou de 80 caracteres. Use um título curto e deixe os detalhes na descrição.',
    )
  }
  if (trimmed.length < BOARD_LIMITS.titleMin) {
    throw new DomainError(400, 'invalid_input', `O título precisa ter pelo menos ${BOARD_LIMITS.titleMin} caracteres.`)
  }
  return trimmed
}

function optionalBoardDescription(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') {
    throw new DomainError(400, 'invalid_input', 'Campo description inválido.')
  }
  assertIntactText(value, 'description')
  const trimmed = value.trim()
  if (trimmed.length > BOARD_LIMITS.descriptionMax) {
    throw new DomainError(400, 'invalid_input', `A descrição passou de ${BOARD_LIMITS.descriptionMax} caracteres.`)
  }
  return trimmed
}

function validateBoardLabels(value: unknown): BoardLabelId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new DomainError(400, 'invalid_input', 'Campo labels deve ser uma lista.')
  }
  if (value.length > BOARD_LIMITS.labelsMax) {
    throw new DomainError(400, 'invalid_input', `Use no máximo ${BOARD_LIMITS.labelsMax} etiquetas por cartão.`)
  }
  const seen = new Set<BoardLabelId>()
  const result: BoardLabelId[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !VALID_LABEL_IDS.has(item as BoardLabelId)) {
      throw new DomainError(400, 'invalid_input', `Etiqueta desconhecida: ${JSON.stringify(item)}. Use uma destas: ${BOARD_LABELS.map((l) => l.id).join(', ')}.`)
    }
    if (seen.has(item as BoardLabelId)) {
      throw new DomainError(400, 'invalid_input', `A etiqueta ${JSON.stringify(item)} apareceu mais de uma vez.`)
    }
    seen.add(item as BoardLabelId)
    result.push(item as BoardLabelId)
  }
  return result
}

function validateBoardPriority(value: unknown): BoardPriority | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !VALID_PRIORITIES.has(value as BoardPriority)) {
    throw new DomainError(400, 'invalid_input', `Prioridade desconhecida: ${JSON.stringify(value)}. Use uma destas: urgent, high, medium, low. Para tirar a prioridade, use null.`)
  }
  return value as BoardPriority
}

function validateBoardColumn(value: unknown, defaultCol: BoardColumnId = 'pending'): BoardColumnId {
  if (value === undefined || value === null) return defaultCol
  if (typeof value !== 'string' || !COLUMN_NAMES.has(value as BoardColumnId)) {
    throw new DomainError(400, 'invalid_input', `Coluna desconhecida: ${JSON.stringify(value)}. Use uma destas: ${BOARD_COLUMNS.map((c) => c.id).join(', ')}.`)
  }
  return value as BoardColumnId
}

function validateCreateChecklist(value: unknown): BoardChecklistItem[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new DomainError(400, 'invalid_input', 'Campo checklist inválido.')
  }
  if (value.length > BOARD_LIMITS.checklistMax) {
    throw new DomainError(400, 'invalid_input', `A lista de verificação aceita no máximo ${BOARD_LIMITS.checklistMax} itens.`)
  }
  return value.map((item, idx) => {
    const rec = asRecord(item, `checklist[${idx}]`)
    const itemText = requireString(rec.text, `checklist[${idx}].text`, 1, BOARD_LIMITS.checklistItemMax)
    const done = rec.done !== undefined ? Boolean(rec.done) : false
    return {
      id: randomUUID(),
      text: itemText,
      done,
    }
  })
}

function validateUpdateChecklist(
  value: unknown,
  currentChecklist: BoardChecklistItem[],
): BoardChecklistItem[] | undefined {
  if (value === undefined) return undefined
  if (value === null || !Array.isArray(value)) {
    throw new DomainError(400, 'invalid_input', 'Campo checklist inválido.')
  }
  if (value.length > BOARD_LIMITS.checklistMax) {
    throw new DomainError(400, 'invalid_input', `A lista de verificação aceita no máximo ${BOARD_LIMITS.checklistMax} itens.`)
  }
  const currentMap = new Map(currentChecklist.map((item) => [item.id, item]))
  return value.map((item, idx) => {
    const rec = asRecord(item, `checklist[${idx}]`)
    const itemText = requireString(rec.text, `checklist[${idx}].text`, 1, BOARD_LIMITS.checklistItemMax)
    if (typeof rec.done !== 'boolean') {
      throw new DomainError(400, 'invalid_input', `Campo checklist[${idx}].done inválido.`)
    }
    const done = rec.done
    let id: string
    if (typeof rec.id === 'string' && currentMap.has(rec.id)) {
      id = rec.id
    } else {
      id = randomUUID()
    }
    return {
      id,
      text: itemText,
      done,
    }
  })
}

export function requireBoardCard(db: DatabaseSync, projectId: string, cardId: string): BoardCard {
  const row = db
    .prepare(`SELECT ${BOARD_CARD_COLUMNS} FROM board_cards WHERE id = ? AND project_id = ?`)
    .get(cardId, projectId)
  if (!row) {
    throw new DomainError(404, 'not_found', 'Cartão não encontrado neste projeto.')
  }
  return mapBoardCard(row as SqlRow)
}

function getColumnEndPosition(db: DatabaseSync, projectId: string, columnId: string, excludeCardId?: string): number {
  const query = excludeCardId
    ? `SELECT MAX(position) as max_pos FROM board_cards WHERE project_id = ? AND column_id = ? AND id != ?`
    : `SELECT MAX(position) as max_pos FROM board_cards WHERE project_id = ? AND column_id = ?`
  const row = (excludeCardId
    ? db.prepare(query).get(projectId, columnId, excludeCardId)
    : db.prepare(query).get(projectId, columnId)) as { max_pos: SqlRow['position'] } | undefined
  if (!row || row.max_pos === null || row.max_pos === undefined) {
    return 1024
  }
  return numberish(row.max_pos) + 1024
}

function renumberColumn(db: DatabaseSync, projectId: string, columnId: string, excludeCardId?: string): void {
  const sql = excludeCardId
    ? `SELECT id FROM board_cards WHERE project_id = ? AND column_id = ? AND id != ? ORDER BY position ASC, id ASC`
    : `SELECT id FROM board_cards WHERE project_id = ? AND column_id = ? ORDER BY position ASC, id ASC`
  const rows = (excludeCardId
    ? db.prepare(sql).all(projectId, columnId, excludeCardId)
    : db.prepare(sql).all(projectId, columnId)) as Array<{ id: string }>

  const updateStmt = db.prepare(`UPDATE board_cards SET position = ? WHERE id = ?`)
  for (let i = 0; i < rows.length; i++) {
    updateStmt.run((i + 1) * 1024, rows[i]!.id)
  }
}

export function getBoard(db: DatabaseSync, projectId: string): BoardSnapshot {
  const colOrderSql = BOARD_COLUMNS.map((c, i) => `WHEN '${c.id}' THEN ${i}`).join(' ')
  const sql = `
    SELECT ${BOARD_CARD_COLUMNS} FROM board_cards
    WHERE project_id = ?
    ORDER BY CASE column_id ${colOrderSql} ELSE 99 END, position ASC, id ASC
  `
  const rows = db.prepare(sql).all(projectId)
  return {
    projectId,
    cards: rows.map((r) => mapBoardCard(r as SqlRow)),
  }
}

export function listBoardCardEvents(db: DatabaseSync, projectId: string, cardId: string): BoardCardEvent[] {
  const rows = db
    .prepare(
      `SELECT id, project_id, card_id, kind, actor, from_column, to_column, summary, created_at
       FROM board_card_events
       WHERE project_id = ? AND card_id = ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(projectId, cardId)
  if (rows.length === 0) {
    // Check if card exists in board_cards for this project
    const cardExists = db.prepare(`SELECT 1 FROM board_cards WHERE project_id = ? AND id = ?`).get(projectId, cardId)
    if (!cardExists) {
      throw new DomainError(404, 'not_found', 'Cartão não encontrado neste projeto.')
    }
  }
  return rows.map((r) => mapBoardCardEvent(r as SqlRow))
}

export function createBoardCard(
  db: DatabaseSync,
  projectId: string,
  input: CreateBoardCardInput,
  ts: string,
): BoardCard {
  const rec = asRecord(input, 'cartão')
  const actor = requireString(rec.actor, 'actor', 1, 80)
  const title = requireBoardTitle(rec.title)
  const description = optionalBoardDescription(rec.description)
  const column = validateBoardColumn(rec.column, 'pending')
  const labels = validateBoardLabels(rec.labels)
  const priority = validateBoardPriority(rec.priority)
  const checklist = validateCreateChecklist(rec.checklist)
  const needsOwner = resolverMarca(rec.needsOwner, false)

  const position = getColumnEndPosition(db, projectId, column)
  const cardId = randomUUID()

  db.prepare(
    `INSERT INTO board_cards (
       id, project_id, column_id, position, title, description, labels_json,
       priority, checklist_json, needs_owner, created_by, updated_by, created_at, updated_at, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    cardId,
    projectId,
    column,
    position,
    title,
    description,
    JSON.stringify(labels),
    priority,
    JSON.stringify(checklist),
    Number(needsOwner),
    actor,
    actor,
    ts,
    ts,
  )

  const colName = COLUMN_NAMES.get(column)!
  const eventId = randomUUID()
  db.prepare(
    `INSERT INTO board_card_events (
       id, project_id, card_id, kind, actor, from_column, to_column, summary, created_at
     ) VALUES (?, ?, ?, 'created', ?, NULL, ?, ?, ?)`,
  ).run(eventId, projectId, cardId, actor, column, `Criou o cartão em ${colName}`, ts)

  return requireBoardCard(db, projectId, cardId)
}

export function updateBoardCard(
  db: DatabaseSync,
  projectId: string,
  cardId: string,
  input: UpdateBoardCardInput,
  ts: string,
): BoardCard {
  const rec = asRecord(input, 'atualização do cartão')
  const actor = requireString(rec.actor, 'actor', 1, 80)
  const expectedVersion = requireInt(rec.expectedVersion, 'expectedVersion', 0)
  const current = requireBoardCard(db, projectId, cardId)

  if (current.version !== expectedVersion) {
    throw new DomainError(409, 'version_conflict', 'A versão do cartão mudou. Recarregue o contexto.')
  }

  const newTitle = rec.title !== undefined ? requireBoardTitle(rec.title) : current.title
  const newDescription = rec.description !== undefined ? optionalBoardDescription(rec.description) : current.description
  const newLabels = rec.labels !== undefined ? validateBoardLabels(rec.labels) : current.labels
  const newPriority = rec.priority !== undefined ? validateBoardPriority(rec.priority) : current.priority
  const newChecklist = validateUpdateChecklist(rec.checklist, current.checklist) ?? current.checklist
  const newNeedsOwner = resolverMarca(rec.needsOwner, current.needsOwner)

  const phrases: string[] = []

  if (newTitle !== current.title) {
    phrases.push('Mudou o título')
  }
  if (newDescription !== current.description) {
    phrases.push('Mudou a descrição')
  }

  const labelsChanged =
    newLabels.length !== current.labels.length || newLabels.some((l, i) => l !== current.labels[i])
  if (labelsChanged) {
    phrases.push('Mudou as etiquetas')
  }

  if (newPriority !== current.priority) {
    phrases.push('Mudou a prioridade')
  }

  phrases.push(...frasesDaMarca(current.needsOwner, newNeedsOwner))

  if (rec.checklist !== undefined) {
    const oldMap = new Map(current.checklist.map((item) => [item.id, item]))
    const newMap = new Map(newChecklist.map((item) => [item.id, item]))

    // Para cada item que passou de não feito para feito
    for (const item of newChecklist) {
      const old = oldMap.get(item.id)
      if (old && !old.done && item.done) {
        phrases.push(`Concluiu: ${item.text}`)
      }
    }

    // Para cada item que voltou a não feito
    for (const item of newChecklist) {
      const old = oldMap.get(item.id)
      if (old && old.done && !item.done) {
        phrases.push(`Reabriu: ${item.text}`)
      }
    }

    // Para cada item novo
    for (const item of newChecklist) {
      if (!oldMap.has(item.id)) {
        phrases.push(`Adicionou à lista: ${item.text}`)
      }
    }

    // Para cada item removido
    for (const item of current.checklist) {
      if (!newMap.has(item.id)) {
        phrases.push(`Tirou da lista: ${item.text}`)
      }
    }
  }

  // Se nada mudou de fato, não grava evento e não soma versão; devolve o cartão como está.
  if (phrases.length === 0) {
    return current
  }

  const summary = phrases.join('; ')
  const updated = db
    .prepare(
      `UPDATE board_cards
       SET title = ?, description = ?, labels_json = ?, priority = ?, checklist_json = ?, needs_owner = ?,
           updated_by = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND project_id = ? AND version = ?`,
    )
    .run(
      newTitle,
      newDescription,
      JSON.stringify(newLabels),
      newPriority,
      JSON.stringify(newChecklist),
      Number(newNeedsOwner),
      actor,
      ts,
      cardId,
      projectId,
      expectedVersion,
    )

  if (numberish(updated.changes) !== 1) {
    throw new DomainError(409, 'version_conflict', 'A versão do cartão mudou. Recarregue o contexto.')
  }

  const eventId = randomUUID()
  db.prepare(
    `INSERT INTO board_card_events (
       id, project_id, card_id, kind, actor, from_column, to_column, summary, created_at
     ) VALUES (?, ?, ?, 'updated', ?, NULL, NULL, ?, ?)`,
  ).run(eventId, projectId, cardId, actor, summary, ts)

  return requireBoardCard(db, projectId, cardId)
}

export function moveBoardCard(
  db: DatabaseSync,
  projectId: string,
  cardId: string,
  input: MoveBoardCardInput,
  ts: string,
): BoardCard {
  const rec = asRecord(input, 'movimento do cartão')
  const actor = requireString(rec.actor, 'actor', 1, 80)
  const expectedVersion = requireInt(rec.expectedVersion, 'expectedVersion', 0)
  const toColumn = validateBoardColumn(rec.column)
  const beforeCardId = rec.beforeCardId !== undefined && rec.beforeCardId !== null ? String(rec.beforeCardId) : null

  const current = requireBoardCard(db, projectId, cardId)
  if (current.version !== expectedVersion) {
    throw new DomainError(409, 'version_conflict', 'A versão do cartão mudou. Recarregue o contexto.')
  }

  // Já está exatamente ali: não soma versão nem suja o histórico (mesma regra da edição sem mudança).
  if (current.column === toColumn && beforeCardId !== cardId) {
    const ids = (db
      .prepare(`SELECT id FROM board_cards WHERE project_id = ? AND column_id = ? ORDER BY position ASC, id ASC`)
      .all(projectId, toColumn) as Array<{ id: string }>).map((r) => r.id)
    const proximo = ids[ids.indexOf(cardId) + 1] ?? null
    if (beforeCardId === proximo) return current
  }

  let newPosition: number

  if (!beforeCardId) {
    newPosition = getColumnEndPosition(db, projectId, toColumn, cardId)
  } else {
    if (beforeCardId === cardId) {
      throw new DomainError(400, 'invalid_input', 'beforeCardId não pode ser o próprio cartão.')
    }
    const beforeRow = db
      .prepare(`SELECT id, column_id, position FROM board_cards WHERE id = ? AND project_id = ?`)
      .get(beforeCardId, projectId) as SqlRow | undefined

    if (!beforeRow || text(beforeRow, 'column_id') !== toColumn) {
      throw new DomainError(400, 'invalid_input', 'beforeCardId precisa ser um cartão que já está na coluna de destino.')
    }

    let beforePos = numberish(beforeRow.position)
    let prevRow = db
      .prepare(
        `SELECT id, position FROM board_cards
         WHERE project_id = ? AND column_id = ? AND id != ? AND position < ?
         ORDER BY position DESC LIMIT 1`,
      )
      .get(projectId, toColumn, cardId, beforePos) as SqlRow | undefined

    let prevPos = prevRow ? numberish(prevRow.position) : 0
    let folga = beforePos - prevPos

    if (folga < 1e-6) {
      renumberColumn(db, projectId, toColumn, cardId)
      // Recarrega posições após renumeração
      const refreshedBefore = db
        .prepare(`SELECT position FROM board_cards WHERE id = ?`)
        .get(beforeCardId) as SqlRow
      beforePos = numberish(refreshedBefore.position)
      prevRow = db
        .prepare(
          `SELECT id, position FROM board_cards
           WHERE project_id = ? AND column_id = ? AND id != ? AND position < ?
           ORDER BY position DESC LIMIT 1`,
        )
        .get(projectId, toColumn, cardId, beforePos) as SqlRow | undefined
      prevPos = prevRow ? numberish(prevRow.position) : 0
    }

    newPosition = prevRow ? (prevPos + beforePos) / 2 : beforePos / 2
  }

  const updated = db
    .prepare(
      `UPDATE board_cards
       SET column_id = ?, position = ?, updated_by = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND project_id = ? AND version = ?`,
    )
    .run(toColumn, newPosition, actor, ts, cardId, projectId, expectedVersion)

  if (numberish(updated.changes) !== 1) {
    throw new DomainError(409, 'version_conflict', 'A versão do cartão mudou. Recarregue o contexto.')
  }

  const fromColName = COLUMN_NAMES.get(current.column)!
  const toColName = COLUMN_NAMES.get(toColumn)!

  let summary: string
  let fromColValue: BoardColumnId | null
  let toColValue: BoardColumnId | null

  if (current.column !== toColumn) {
    summary = `Moveu de ${fromColName} para ${toColName}`
    fromColValue = current.column
    toColValue = toColumn
  } else {
    summary = `Mudou a ordem em ${toColName}`
    fromColValue = toColumn
    toColValue = toColumn
  }

  const eventId = randomUUID()
  db.prepare(
    `INSERT INTO board_card_events (
       id, project_id, card_id, kind, actor, from_column, to_column, summary, created_at
     ) VALUES (?, ?, ?, 'moved', ?, ?, ?, ?, ?)`,
  ).run(eventId, projectId, cardId, actor, fromColValue, toColValue, summary, ts)

  return requireBoardCard(db, projectId, cardId)
}

export function deleteBoardCard(
  db: DatabaseSync,
  projectId: string,
  cardId: string,
  input: DeleteBoardCardInput,
  ts: string,
): { cardId: string } {
  const rec = asRecord(input, 'exclusão do cartão')
  const actor = requireString(rec.actor, 'actor', 1, 80)
  const expectedVersion = requireInt(rec.expectedVersion, 'expectedVersion', 0)
  const current = requireBoardCard(db, projectId, cardId)

  if (current.version !== expectedVersion) {
    throw new DomainError(409, 'version_conflict', 'A versão do cartão mudou. Recarregue o contexto.')
  }

  const eventId = randomUUID()
  db.prepare(
    `INSERT INTO board_card_events (
       id, project_id, card_id, kind, actor, from_column, to_column, summary, created_at
     ) VALUES (?, ?, ?, 'deleted', ?, ?, NULL, 'Excluiu o cartão', ?)`,
  ).run(eventId, projectId, cardId, actor, current.column, ts)

  const removed = db
    .prepare(`DELETE FROM board_cards WHERE id = ? AND project_id = ? AND version = ?`)
    .run(cardId, projectId, expectedVersion)

  if (numberish(removed.changes) !== 1) {
    throw new DomainError(409, 'version_conflict', 'A versão do cartão mudou. Recarregue o contexto.')
  }

  return { cardId }
}
