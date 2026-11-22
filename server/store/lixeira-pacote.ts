import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { RegistroPortavelNaLixeira } from '../../shared/portability.js'
import { PortabilityError } from '../portability/errors.js'
import { mapBoardCard } from './board.js'
import { listarLicoes } from './licoes.js'
import { listar } from './lixeira.js'
import type { SqlRow } from './sql.js'

export function exportarLixeira(db: DatabaseSync, projectId: string): RegistroPortavelNaLixeira[] | undefined {
  const itens = listar(db, projectId)
  if (itens.length === 0) return undefined
  const licoes = new Map(listarLicoes(db, projectId, { incluirAposentadas: true }, 'project_id IS NOT NULL')
    .map(licao => [licao.id, licao]))
  const cartao = db.prepare('SELECT * FROM board_cards WHERE project_id = ? AND id = ?')
  return itens.map(({ titulo: _, ...item }) => {
    if (item.tipo === 'cartao') {
      const { id: _id, projectId: _projeto, ...registro } = mapBoardCard(cartao.get(projectId, item.id) as SqlRow)
      return { ...item, tipo: item.tipo, registro }
    }
    if (item.tipo === 'licao') {
      const { id: _id, projectId: _projeto, ...registro } = licoes.get(item.id)!
      return { ...item, tipo: item.tipo, registro }
    }
    return { ...item, tipo: item.tipo }
  })
}

function alocarRegistrosDaLixeira(itens: RegistroPortavelNaLixeira[], idMap: Record<string, string>) {
  const licoes = new Map<string | null, string>()
  for (const item of itens) {
    if (item.tipo === 'cartao' || item.tipo === 'licao') {
      if (Object.hasOwn(idMap, item.id)) {
        throw new PortabilityError(400, 'invalid_bundle_reference', `ID de item da lixeira já usado no pacote: ${item.id}.`)
      }
      const id = randomUUID()
      idMap[item.id] = id
      if (item.tipo === 'licao') licoes.set(item.id, id)
    }
  }
  return licoes
}

export function importarLixeira(
  db: DatabaseSync, projeto: string, idMap: Record<string, string>, itens: RegistroPortavelNaLixeira[] | undefined,
): void {
  if (itens === undefined) return
  const licoes = alocarRegistrosDaLixeira(itens, idMap)
  const inserirCartao = db.prepare(`INSERT INTO board_cards (
    id, project_id, column_id, position, title, description, labels_json, priority, checklist_json,
    needs_owner, created_by, updated_by, created_at, updated_at, version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const inserirLicao = db.prepare(`INSERT INTO licoes (
    id, project_id, texto, origem, criada_em, aposentada_em, motivo_aposentadoria,
    tipo, frase_do_dono, momento, linha_curta, substitui_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const marcar = db.prepare(`INSERT INTO lixeira (
    tipo, item_id, project_id, excluido_em, excluido_por, pedido_do_dono
  ) VALUES (?, ?, ?, ?, ?, ?)`)
  // Igual horário é desempatado pela ordem da inserção na tabela.
  for (const item of itens.toReversed()) {
    const id = idMap[item.id]
    if (item.tipo === 'cartao') {
      const c = item.registro
      inserirCartao.run(id, projeto, c.column, c.position, c.title, c.description, JSON.stringify(c.labels),
        c.priority, JSON.stringify(c.checklist), Number(c.needsOwner), c.createdBy, c.updatedBy, c.createdAt, c.updatedAt, c.version)
    }
    if (item.tipo === 'licao') {
      const l = item.registro
      const substitui = licoes.get(l.substituiId) ?? null
      inserirLicao.run(id, projeto, l.texto, l.origem, l.criadaEm, l.aposentadaEm, l.motivoAposentadoria,
        l.tipo, l.fraseDoDono, l.momento, l.linhaCurta, substitui)
    }
    marcar.run(item.tipo, id, projeto, item.excluidoEm, item.excluidoPor, item.pedidoDoDono)
  }
  if (listar(db, projeto).length !== itens.length) {
    throw new PortabilityError(400, 'invalid_bundle_reference', 'O alvo de uma marca da lixeira não corresponde ao tipo declarado.')
  }
}
