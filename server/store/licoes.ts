import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { LICAO_MOTIVO_MAXIMO, LICAO_TEXTO_MAXIMO, type Licao } from '../../shared/licoes.js'
import { DomainError } from './errors.js'
import { asRecord, requireString, requireUuid } from './validation.js'

/**
 * Lições que o Claude não repete (lote 2, D4). Tabela `licoes`: `project_id` NULL = vale para todos os
 * projetos. Uma lição aposentada fica guardada com o motivo; nada é apagado em silêncio (só apagar o
 * projeto leva as lições dele). Texto igual no mesmo escopo, sem diferenciar maiúsculas, espaços nem a
 * forma do acento, não duplica: devolve a que já existe e está ativa.
 *
 * Regra própria, fora de `server/store.ts`, que só recebe a ligação.
 */

/** O nome do agente cabe em 80 caracteres, como nas outras ferramentas. */
const AGENTE_MAXIMO = 80

const COLUNAS = 'id, project_id, texto, origem, criada_em, aposentada_em, motivo_aposentadoria'

interface LinhaDeLicao {
  id: string
  project_id: string | null
  texto: string
  origem: string
  criada_em: string
  aposentada_em: string | null
  motivo_aposentadoria: string | null
}

export function ensureLicoesSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS licoes (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      texto TEXT NOT NULL,
      origem TEXT NOT NULL,
      criada_em TEXT NOT NULL,
      aposentada_em TEXT,
      motivo_aposentadoria TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_licoes_projeto ON licoes(project_id, criada_em);
  `)
}

function paraLicao(linha: LinhaDeLicao): Licao {
  return {
    id: linha.id,
    projectId: linha.project_id,
    texto: linha.texto,
    origem: linha.origem,
    criadaEm: linha.criada_em,
    aposentadaEm: linha.aposentada_em,
    motivoAposentadoria: linha.motivo_aposentadoria,
  }
}

/**
 * Com o que dois textos são comparados: acento na mesma forma, espaços colapsados, sem diferenciar caixa.
 * O texto já chega aparado (`requireString`) e é gravado aparado, então o colapso não deixa espaço nas pontas.
 */
function chaveDoTexto(texto: string): string {
  return texto.normalize('NFC').replace(/\s+/g, ' ').toLowerCase()
}

/** As lições ativas de um escopo (um projeto, ou o global quando `projectId` é nulo), da mais antiga para a mais nova. */
function ativasDoEscopo(db: DatabaseSync, projectId: string | null): LinhaDeLicao[] {
  return db
    .prepare(
      `SELECT ${COLUNAS} FROM licoes
       WHERE project_id IS ? AND aposentada_em IS NULL
       ORDER BY criada_em ASC, rowid ASC`,
    )
    .all(projectId) as unknown as LinhaDeLicao[]
}

/**
 * Registra a lição no escopo (`projectId` nulo = global). Se já existe uma ativa com o mesmo texto no
 * mesmo escopo, devolve essa, sem gravar nada.
 */
export function registrarLicao(
  db: DatabaseSync,
  projectId: string | null,
  input: { texto: string; agent: string },
  ts: string,
  id: string = randomUUID(),
): Licao {
  const rec = asRecord(input, 'lição')
  const texto = requireString(rec.texto, 'texto', 1, LICAO_TEXTO_MAXIMO)
  const origem = requireString(rec.agent, 'agent', 1, AGENTE_MAXIMO)
  const chave = chaveDoTexto(texto)
  const igual = ativasDoEscopo(db, projectId).find((linha) => chaveDoTexto(linha.texto) === chave)
  if (igual) return paraLicao(igual)
  db.prepare(
    `INSERT INTO licoes (id, project_id, texto, origem, criada_em) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, projectId, texto, origem, ts)
  return { id, projectId, texto, origem, criadaEm: ts, aposentadaEm: null, motivoAposentadoria: null }
}

/**
 * As lições do projeto e as globais, da mais antiga para a mais nova (mesma hora: a gravada primeiro).
 * As aposentadas só entram com `incluirAposentadas: true`.
 */
export function listarLicoes(
  db: DatabaseSync,
  projectId: string,
  opcoes: { incluirAposentadas?: boolean } = {},
): Licao[] {
  const filtro = opcoes.incluirAposentadas === true ? '' : 'AND aposentada_em IS NULL'
  const linhas = db
    .prepare(
      `SELECT ${COLUNAS} FROM licoes
       WHERE (project_id = ? OR project_id IS NULL) ${filtro}
       ORDER BY criada_em ASC, rowid ASC`,
    )
    .all(projectId) as unknown as LinhaDeLicao[]
  return linhas.map(paraLicao)
}

/** Aposenta a lição com o motivo. A linha fica; aposentar duas vezes é recusado e o primeiro motivo continua. */
export function aposentarLicao(
  db: DatabaseSync,
  lessonId: string,
  input: { agent: string; motivo: string },
  ts: string,
): Licao {
  const id = requireUuid(lessonId, 'lessonId')
  const rec = asRecord(input, 'lição')
  requireString(rec.agent, 'agent', 1, AGENTE_MAXIMO)
  const motivo = requireString(rec.motivo, 'motivo', 1, LICAO_MOTIVO_MAXIMO)
  const linha = db.prepare(`SELECT ${COLUNAS} FROM licoes WHERE id = ?`).get(id) as unknown as LinhaDeLicao | undefined
  if (!linha) throw new DomainError(404, 'not_found', 'Lição não encontrada.')
  if (linha.aposentada_em !== null) {
    throw new DomainError(409, 'lesson_already_retired', 'Esta lição já está aposentada.')
  }
  db.prepare('UPDATE licoes SET aposentada_em = ?, motivo_aposentadoria = ? WHERE id = ?').run(ts, motivo, id)
  return { ...paraLicao(linha), aposentadaEm: ts, motivoAposentadoria: motivo }
}

/** Escopo pedido na ferramenta: `global: true` vale para todos os projetos (nulo); senão o projeto é obrigatório. */
export function escopoDaLicao(projectId: string | undefined, global: boolean | undefined): string | null {
  if (global === true) return null
  if (!projectId) {
    throw new DomainError(
      400,
      'invalid_input',
      'Informe projectId, ou global: true para uma lição que vale para todos os projetos.',
    )
  }
  return projectId
}

/** Apagar o projeto leva as lições dele; as globais ficam. */
export function apagarLicoesDoProjeto(db: DatabaseSync, projectId: string): void {
  db.prepare('DELETE FROM licoes WHERE project_id = ?').run(projectId)
}
