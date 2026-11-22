import type { DatabaseSync } from 'node:sqlite'
import type { AuthContext } from '../../shared/auth.js'
import { TIPOS_NA_LIXEIRA, type ItemNaLixeira, type TipoNaLixeira } from '../../shared/lixeira.js'
import { PEDIDO_MAXIMO, quemApaga } from './apagamento.js'
import { DomainError } from './errors.js'
import { asRecord, requireString, requireUuid } from './validation.js'

type Origem = 'mcp' | 'tela'

interface Alvo {
  tipo: TipoNaLixeira
  id: string
  agent: string
}

interface Fonte {
  tabela: string
  titulo: string
  dependencias: readonly string[]
}

// A marca é independente do estado do item. Restaurar devolve a coluna, o estado e a versão originais.
const FONTES: Record<TipoNaLixeira, Fonte> = {
  cartao: {
    tabela: 'board_cards', titulo: 'title',
    dependencias: ['DELETE FROM board_card_events WHERE project_id = $projeto AND card_id = $id'],
  },
  licao: {
    tabela: 'licoes', titulo: 'coalesce(linha_curta, texto)',
    dependencias: ['UPDATE licoes SET substitui_id = NULL WHERE project_id = $projeto AND substitui_id = $id'],
  },
  decisao: {
    tabela: 'decisions', titulo: 'title',
    dependencias: [
      'DELETE FROM decision_events WHERE project_id = $projeto AND (decision_id = $id OR related_decision_id = $id)',
      "DELETE FROM content_relations WHERE project_id = $projeto AND target_type = 'decision' AND target_id = $id",
    ],
  },
  mensagem: {
    tabela: 'messages', titulo: 'body',
    dependencias: [
      'DELETE FROM message_receipts WHERE project_id = $projeto AND message_id = $id',
      `DELETE FROM message_resolutions WHERE project_id = $projeto AND
         (message_id = $id OR (response_message_id = $id AND note = '' AND checkpoint_id IS NULL))`,
      `UPDATE message_resolutions SET response_message_id = NULL,
         payload_canonical = json_set(payload_canonical, '$.responseMessageId', NULL)
         WHERE project_id = $projeto AND response_message_id = $id`,
    ],
  },
  backlog: { tabela: 'backlog_items', titulo: 'title', dependencias: [] },
  biblioteca: {
    tabela: 'content_items', titulo: 'title',
    dependencias: [
      'DELETE FROM content_fts WHERE project_id = $projeto AND item_id = $id',
      `DELETE FROM content_relations WHERE project_id = $projeto
         AND (source_revision_id IN (SELECT id FROM content_revisions WHERE item_id = $id)
              OR (target_type = 'content' AND target_id = $id))`,
      `DELETE FROM content_revisions WHERE item_id = $id
         AND EXISTS (SELECT 1 FROM content_items WHERE id = $id AND project_id = $projeto)`,
    ],
  },
}

/** Predicado SQL para colunas conhecidas no código, aplicado antes de ordenação e limite. */
export function naoEstaNaLixeira(tipoSql: string, idSql: string): string {
  return `NOT EXISTS (SELECT 1 FROM lixeira l WHERE l.tipo = ${tipoSql} AND l.item_id = ${idSql})`
}

/** As escritas por ID conferem a marca na mesma transação da operação. */
export function recusarSeNaLixeira(db: DatabaseSync, projectId: string | null, tipo: TipoNaLixeira, id: string): void {
  const item = db.prepare('SELECT 1 FROM lixeira WHERE tipo = ? AND item_id = ? AND project_id IS ?').get(tipo, id, projectId)
  if (item !== undefined) {
    throw new DomainError(409, 'ja_na_lixeira', 'O item está na lixeira. Restaure-o antes de alterá-lo.')
  }
}

function validarAlvo(rec: Record<string, unknown>): Alvo {
  const tipo = TIPOS_NA_LIXEIRA.find((valor) => valor === rec.tipo)
  if (tipo === undefined) throw new DomainError(400, 'invalid_input', 'Tipo de item inválido para a lixeira.')
  return { tipo, id: requireUuid(rec.id, 'id'), agent: requireString(rec.agent, 'agent', 1, 80) }
}

function validarPedido(pedido: unknown): string {
  if (typeof pedido !== 'string' || pedido.trim() === '' || pedido.length > PEDIDO_MAXIMO) {
    throw new DomainError(400, 'pedido_do_dono_obrigatorio', 'Informe o pedido do dono, nas palavras dele, de 1 a 500 caracteres.')
  }
  return pedido
}

function pedidoParaExcluir(origem: unknown, pedido: unknown): string | null {
  if (origem === 'mcp') return validarPedido(pedido)
  if (origem === 'tela') return null
  throw new DomainError(400, 'invalid_input', 'Origem da exclusão inválida.')
}

function tituloDoItem(db: DatabaseSync, projectId: string, { tipo, id }: Alvo): string {
  const { tabela, titulo } = FONTES[tipo]
  const linha = db.prepare(`SELECT project_id, ${titulo} AS titulo FROM ${tabela}
      WHERE id = ? AND (project_id = ? OR project_id IS NULL)`).get(id, projectId) as
    { project_id: string | null; titulo: string } | undefined
  if (linha === undefined) throw new DomainError(404, 'not_found', 'Item não encontrado neste projeto.')
  if (linha.project_id === null) throw new DomainError(400, 'licao_global', 'Uma lição global não pode ser excluída por projeto.')
  return linha.titulo
}

/** As operações de escrita são chamadas dentro da transação imediata do store. */
export function excluir(db: DatabaseSync, projectId: string, input: unknown, excluidoEm: string): ItemNaLixeira {
  const rec = asRecord(input, 'exclusão')
  const { tipo, id, agent } = validarAlvo(rec)
  const pedidoDoDono = pedidoParaExcluir(rec.origem, rec.pedidoDoDono)
  const titulo = tituloDoItem(db, projectId, { tipo, id, agent })
  const marca = db.prepare(`INSERT INTO lixeira (tipo, item_id, project_id, excluido_em, excluido_por, pedido_do_dono)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (tipo, item_id) DO NOTHING RETURNING item_id`)
    .get(tipo, id, projectId, excluidoEm, agent, pedidoDoDono)
  if (marca === undefined) throw new DomainError(409, 'ja_na_lixeira', 'O item já está na lixeira.')
  return { tipo, id, projectId, titulo, excluidoEm, excluidoPor: agent, pedidoDoDono }
}

function removerMarca(db: DatabaseSync, projectId: string, { tipo, id }: Alvo) {
  return db.prepare('DELETE FROM lixeira WHERE project_id = ? AND tipo = ? AND item_id = ? RETURNING excluido_em')
    .get(projectId, tipo, id) as { excluido_em: string } | undefined
}

export function restaurar(db: DatabaseSync, projectId: string, input: unknown, restauradoEm: string): { ok: true } {
  const alvo = validarAlvo(asRecord(input, 'restauração'))
  const marca = removerMarca(db, projectId, alvo)
  if (marca === undefined) {
    throw new DomainError(404, 'fora_da_lixeira', 'O item não está na lixeira deste projeto.')
  }
  db.prepare(`INSERT INTO lixeira_historico (project_id, tipo, item_id, excluido_em, restaurado_em)
    VALUES (?, ?, ?, ?, ?)`).run(projectId, alvo.tipo, alvo.id, marca.excluido_em, restauradoEm)
  return { ok: true }
}

type AuditoriaDoApagamento = {
  actorType: 'agent' | 'user'
  actorId: string
  action: 'purge_record'
  resourceType: TipoNaLixeira
  resourceId: string
  projectId: string
  details: { pedidoDoDono: string }
}

export function apagarDeVez(
  db: DatabaseSync, projectId: string, input: unknown, origem: Origem, auditar: (entrada: AuditoriaDoApagamento) => void,
): { ok: true } {
  const rec = asRecord(input, 'apagamento definitivo')
  const alvo = validarAlvo(rec)
  if (rec.confirmar !== true) {
    throw new DomainError(400, 'confirmacao_obrigatoria', 'Confirme o apagamento definitivo do item.')
  }
  const pedidoDoDono = origem === 'tela' ? 'Apagamento definitivo confirmado na tela.' : validarPedido(rec.pedidoDoDono)
  if (removerMarca(db, projectId, alvo) === undefined) {
    throw new DomainError(409, 'precisa_estar_na_lixeira', 'O item precisa estar na lixeira deste projeto.')
  }

  const { tabela, dependencias } = FONTES[alvo.tipo]
  const parametros = { $projeto: projectId, $id: alvo.id }
  for (const sql of dependencias) db.prepare(sql).run(parametros)
  db.prepare(`DELETE FROM ${tabela} WHERE project_id = $projeto AND id = $id`).run(parametros)
  db.prepare('DELETE FROM lixeira_historico WHERE project_id = ? AND tipo = ? AND item_id = ?')
    .run(projectId, alvo.tipo, alvo.id)
  auditar({
    actorType: origem === 'tela' ? 'user' : 'agent', actorId: alvo.agent, action: 'purge_record',
    resourceType: alvo.tipo, resourceId: alvo.id, projectId, details: { pedidoDoDono },
  })
  return { ok: true }
}

const CONSULTA_DA_LIXEIRA = TIPOS_NA_LIXEIRA.map((tipo) => {
  const { tabela, titulo } = FONTES[tipo]
  return `SELECT l.tipo, l.item_id AS id, l.project_id AS projectId, ${titulo} AS titulo,
                 l.excluido_em AS excluidoEm, l.excluido_por AS excluidoPor,
                 l.pedido_do_dono AS pedidoDoDono, l.rowid AS ordem
          FROM lixeira l JOIN ${tabela} t ON t.id = l.item_id AND t.project_id = l.project_id
          WHERE l.tipo = '${tipo}' AND l.project_id = $projeto`
}).join(' UNION ALL ')

export function listar(db: DatabaseSync, projectId: string): ItemNaLixeira[] {
  const linhas = db.prepare(`${CONSULTA_DA_LIXEIRA} ORDER BY excluidoEm DESC, ordem DESC`).all({ $projeto: projectId })
  return linhas.map(({ ordem: _, ...item }) => ({ ...item }) as unknown as ItemNaLixeira)
}

export type RestauracaoNaLixeira = Pick<ItemNaLixeira, 'id' | 'tipo' | 'titulo' | 'excluidoEm'> & { restauradoEm: string }

const CONSULTA_DAS_RESTAURACOES = TIPOS_NA_LIXEIRA.map((tipo) => {
  const { tabela, titulo } = FONTES[tipo]
  return `SELECT h.tipo, h.item_id AS id, ${titulo} AS titulo,
                 h.excluido_em AS excluidoEm, h.restaurado_em AS restauradoEm
          FROM lixeira_historico h JOIN ${tabela} t ON t.id = h.item_id AND t.project_id = h.project_id
          WHERE h.tipo = '${tipo}' AND h.project_id = $projeto AND h.restaurado_em > $desde`
}).join(' UNION ALL ')

export function listarRestauracoes(db: DatabaseSync, projectId: string, desde: string): RestauracaoNaLixeira[] {
  return db.prepare(CONSULTA_DAS_RESTAURACOES).all({ $projeto: projectId, $desde: desde })
    .map((item) => ({ ...item }) as RestauracaoNaLixeira)
}

/**
 * Só o dono mexe na lixeira pela tela. O escopo do projeto (token restrito a outro projeto) é conferido antes,
 * para toda rota /api/projects/:id, por `exigirEscopoDoProjeto` em server/auth/escopo.ts.
 */
export function validarDonoDaLixeira(auth: AuthContext | undefined): void {
  quemApaga(auth)
}
