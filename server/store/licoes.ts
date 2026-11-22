import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  FRASE_DO_DONO_MAXIMA,
  LICAO_MOTIVO_MAXIMO,
  LICAO_TEXTO_MAXIMO,
  LINHA_CURTA_MAXIMA,
  MOMENTOS_DA_VERIFICACAO,
  TIPOS_DE_LICAO,
  type Licao,
  type MomentoDaVerificacao,
  type TipoDeLicao,
} from '../../shared/licoes.js'
import { DomainError } from './errors.js'
import { naoEstaNaLixeira, recusarSeNaLixeira } from './lixeira.js'
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

/** O pedido do dono, nas palavras dele, cabe em 500 caracteres. */
const PEDIDO_DO_DONO_MAXIMO = 500

const COLUNAS =
  'id, project_id, texto, origem, criada_em, aposentada_em, motivo_aposentadoria, tipo, frase_do_dono, momento, linha_curta, substitui_id'

/** Colunas acrescentadas depois da primeira versão da tabela; entram só se faltarem (banco antigo). */
const COLUNAS_NOVAS: ReadonlyArray<readonly [string, string]> = [
  ['tipo', "TEXT NOT NULL DEFAULT 'erro'"],
  ['frase_do_dono', 'TEXT'],
  ['momento', 'TEXT'],
  ['linha_curta', 'TEXT'],
  ['substitui_id', 'TEXT'],
]

/** O que a ferramenta recebe ao registrar. Os campos novos são opcionais: sem eles, a lição é um `erro`. */
export interface EntradaDeLicao {
  texto: string
  agent: string
  tipo?: TipoDeLicao
  fraseDoDono?: string
  momento?: MomentoDaVerificacao
  linhaCurta?: string
  /** Id da lição ativa, no mesmo escopo, que esta corrige. */
  substitui?: string
}

export interface FiltroDeLicoes {
  incluirAposentadas?: boolean
  tipo?: TipoDeLicao
  momento?: MomentoDaVerificacao
}

interface LinhaDeLicao {
  id: string
  project_id: string | null
  texto: string
  origem: string
  criada_em: string
  aposentada_em: string | null
  motivo_aposentadoria: string | null
  tipo: string
  frase_do_dono: string | null
  momento: string | null
  linha_curta: string | null
  substitui_id: string | null
}

export function ensureLicoesSchema(db: DatabaseSync): void {
  // A deduplicação e as escritas de lições consultam a marca da lixeira.
  db.exec(`
    CREATE TABLE IF NOT EXISTS lixeira (
      tipo TEXT NOT NULL, item_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
      excluido_em TEXT NOT NULL, excluido_por TEXT NOT NULL, pedido_do_dono TEXT,
      PRIMARY KEY (tipo, item_id)
    );
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
  const existentes = new Set((db.prepare('PRAGMA table_info(licoes)').all() as Array<{ name: string }>).map((c) => c.name))
  for (const [nome, definicao] of COLUNAS_NOVAS) {
    if (!existentes.has(nome)) db.exec(`ALTER TABLE licoes ADD COLUMN ${nome} ${definicao}`)
  }
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
    tipo: linha.tipo as TipoDeLicao,
    fraseDoDono: linha.frase_do_dono,
    momento: linha.momento as MomentoDaVerificacao | null,
    linhaCurta: linha.linha_curta,
    substituiId: linha.substitui_id,
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
       WHERE project_id IS ? AND aposentada_em IS NULL AND ${naoEstaNaLixeira("'licao'", 'licoes.id')}
       ORDER BY criada_em ASC, rowid ASC`,
    )
    .all(projectId) as unknown as LinhaDeLicao[]
}

/** Valor opcional que precisa estar numa lista fechada; ausente = `undefined`. */
function daLista<T extends string>(valor: unknown, campo: string, lista: readonly T[]): T | undefined {
  if (valor === undefined) return undefined
  if ((lista as readonly unknown[]).includes(valor)) return valor as T
  throw new DomainError(400, 'invalid_input', `Campo ${campo} inválido.`)
}

/** Texto opcional com limite; ausente = nulo. Vazio, ou maior que o limite, é recusado. */
function textoOpcional(valor: unknown, campo: string, maximo: number): string | null {
  return valor === undefined ? null : requireString(valor, campo, 1, maximo)
}

/** O que cada tipo exige. Regra e verificação são do dono: do projeto, com a frase dele; momento só em verificação. */
function conferirTipo(
  tipo: TipoDeLicao,
  projectId: string | null,
  fraseDoDono: string | null,
  momento: MomentoDaVerificacao | null,
): void {
  if (tipo !== 'erro') {
    if (projectId === null) {
      throw new DomainError(
        400,
        'regra_precisa_de_projeto',
        'Regra e verificação do dono valem para um projeto: informe projectId, sem global.',
      )
    }
    if (fraseDoDono === null) {
      throw new DomainError(400, 'frase_do_dono_obrigatoria', 'Regra e verificação precisam da frase do dono, escrita como ele disse.')
    }
  }
  if (tipo === 'verificacao') {
    if (momento === null) {
      throw new DomainError(400, 'momento_obrigatorio', 'Verificação precisa do momento: antes_de_subir, antes_de_pronto ou antes_de_commit.')
    }
  } else if (momento !== null) {
    throw new DomainError(400, 'momento_so_em_verificacao', 'O momento só existe em verificação.')
  }
}

/**
 * A lição a substituir existe, está ativa e é do mesmo escopo. Regra e verificação são do dono: só outra
 * lição do mesmo tipo (com a frase dele) as substitui. Um `erro` pode ser trocado por qualquer tipo.
 */
function conferirSubstituida(db: DatabaseSync, substitui: string, projectId: string | null, tipo: TipoDeLicao): void {
  const linha = db.prepare('SELECT project_id, aposentada_em, tipo FROM licoes WHERE id = ?').get(substitui) as
    | { project_id: string | null; aposentada_em: string | null; tipo: string }
    | undefined
  if (!linha) throw new DomainError(404, 'not_found', 'Lição a substituir não encontrada.')
  recusarSeNaLixeira(db, projectId, 'licao', substitui)
  if (linha.aposentada_em !== null) throw new DomainError(409, 'lesson_already_retired', 'Esta lição já está aposentada.')
  if (linha.project_id !== projectId) {
    throw new DomainError(400, 'escopo_diferente', 'A lição a substituir é de outro escopo (outro projeto ou global).')
  }
  if (linha.tipo !== 'erro' && linha.tipo !== tipo) {
    throw new DomainError(
      400,
      'tipo_diferente_na_substituicao',
      'Regra e verificação só são substituídas por uma lição do mesmo tipo, com a frase do dono.',
    )
  }
}

/** A linha curta é uma linha só: quebra de linha é recusada. */
function linhaCurtaDe(valor: unknown): string | null {
  if (valor === undefined) return null
  const linha = requireString(valor, 'linhaCurta', 1, LINHA_CURTA_MAXIMA)
  if (/[\r\n]/.test(linha)) throw new DomainError(400, 'invalid_input', 'Campo linhaCurta inválido.')
  return linha
}

/**
 * A lição ativa do escopo com a mesma chave (tipo, momento e texto). A que está sendo substituída (`ignorar`)
 * não conta: corrigir a frase ou a linha curta de uma lição mantém o texto dela.
 */
function igualAtiva(
  db: DatabaseSync,
  projectId: string | null,
  tipo: TipoDeLicao,
  momento: MomentoDaVerificacao | null,
  texto: string,
  ignorar: string | null,
): LinhaDeLicao | undefined {
  const chave = chaveDoTexto(texto)
  return ativasDoEscopo(db, projectId).find(
    (linha) => linha.id !== ignorar && linha.tipo === tipo && linha.momento === momento && chaveDoTexto(linha.texto) === chave,
  )
}

/** Tudo ou nada: se um passo falha, o `SAVEPOINT` desfaz os anteriores (vale também dentro de uma transação aberta). */
function emUmaTransacao(db: DatabaseSync, passos: () => void): void {
  db.exec('SAVEPOINT licao')
  try {
    passos()
  } catch (erro) {
    db.exec('ROLLBACK TO licao')
    db.exec('RELEASE licao')
    throw erro
  }
  db.exec('RELEASE licao')
}

/**
 * Registra a lição no escopo (`projectId` nulo = global). Se já existe uma ativa com o mesmo tipo, escopo,
 * momento (na verificação) e texto, devolve essa, sem gravar nada. Com `substitui`, grava a nova e aposenta a
 * antiga, numa transação; a substituída não conta na comparação, e texto igual ao de outra ativa é recusado.
 */
export function registrarLicao(
  db: DatabaseSync,
  projectId: string | null,
  input: EntradaDeLicao,
  ts: string,
  id: string = randomUUID(),
): Licao {
  const rec = asRecord(input, 'lição')
  const texto = requireString(rec.texto, 'texto', 1, LICAO_TEXTO_MAXIMO)
  const origem = requireString(rec.agent, 'agent', 1, AGENTE_MAXIMO)
  const tipo = daLista(rec.tipo, 'tipo', TIPOS_DE_LICAO) ?? 'erro'
  const momento = daLista(rec.momento, 'momento', MOMENTOS_DA_VERIFICACAO) ?? null
  const fraseDoDono = textoOpcional(rec.fraseDoDono, 'fraseDoDono', FRASE_DO_DONO_MAXIMA)
  const linhaCurta = linhaCurtaDe(rec.linhaCurta)
  const substitui = rec.substitui === undefined ? null : requireUuid(rec.substitui, 'substitui')
  conferirTipo(tipo, projectId, fraseDoDono, momento)
  if (substitui !== null) conferirSubstituida(db, substitui, projectId, tipo)
  const igual = igualAtiva(db, projectId, tipo, momento, texto, substitui)
  if (igual && substitui === null) return paraLicao(igual)
  if (igual) {
    throw new DomainError(
      409,
      'licao_igual_ja_existe',
      `Já existe uma lição ativa com este texto (${igual.id}); aposente-a ou escolha outro texto.`,
    )
  }
  emUmaTransacao(db, () => {
    db.prepare(
      `INSERT INTO licoes (id, project_id, texto, origem, criada_em, tipo, frase_do_dono, momento, linha_curta, substitui_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, texto, origem, ts, tipo, fraseDoDono, momento, linhaCurta, substitui)
    // Sem `substitui`, o id é NULL e `id = NULL` não casa com linha nenhuma: o UPDATE não toca em nada.
    db.prepare('UPDATE licoes SET aposentada_em = ?, motivo_aposentadoria = ? WHERE id = ?').run(ts, `substituída por ${id}`, substitui)
  })
  return {
    id,
    projectId,
    texto,
    origem,
    criadaEm: ts,
    aposentadaEm: null,
    motivoAposentadoria: null,
    tipo,
    fraseDoDono,
    momento,
    linhaCurta,
    substituiId: substitui,
  }
}

/**
 * As lições do projeto e as globais, da mais antiga para a mais nova (mesma hora: a gravada primeiro).
 * As aposentadas só entram com `incluirAposentadas: true`; `tipo` e `momento` filtram.
 */
export function listarLicoes(db: DatabaseSync, projectId: string, opcoes: FiltroDeLicoes = {}, filtro = '1'): Licao[] {
  const tipo = daLista(opcoes.tipo, 'tipo', TIPOS_DE_LICAO)
  const momento = daLista(opcoes.momento, 'momento', MOMENTOS_DA_VERIFICACAO)
  const filtros = ['(project_id = ? OR project_id IS NULL)', filtro]
  const valores: string[] = [projectId]
  if (opcoes.incluirAposentadas !== true) filtros.push('aposentada_em IS NULL')
  if (tipo !== undefined) {
    filtros.push('tipo = ?')
    valores.push(tipo)
  }
  if (momento !== undefined) {
    filtros.push('momento = ?')
    valores.push(momento)
  }
  const linhas = db
    .prepare(`SELECT ${COLUNAS} FROM licoes WHERE ${filtros.join(' AND ')} ORDER BY criada_em ASC, rowid ASC`)
    .all(...valores) as unknown as LinhaDeLicao[]
  return linhas.map(paraLicao)
}

/** O pedido do dono, nas palavras dele, fica no motivo (sem coluna nova). */
function motivoComOPedido(motivo: string, pedido: string | null): string {
  return pedido === null ? motivo : `${motivo} (pedido do dono: "${pedido}")`
}

export function licaoParaEscrita(db: DatabaseSync, projectId: string, id: string): Licao {
  const linha = db.prepare(`SELECT ${COLUNAS} FROM licoes
    WHERE id = ? AND (project_id = ? OR project_id IS NULL)`).get(id, projectId) as LinhaDeLicao | undefined
  if (!linha) throw new DomainError(404, 'not_found', 'Lição não encontrada neste projeto.')
  recusarSeNaLixeira(db, projectId, 'licao', id)
  return paraLicao(linha)
}

/**
 * Aposenta a lição com o motivo. A linha fica; aposentar duas vezes é recusado e o primeiro motivo continua.
 * Regra e verificação só se aposentam com `pedidoDoDono`; o erro continua como antes.
 */
export function aposentarLicao(
  db: DatabaseSync,
  lessonId: string,
  input: { agent: string; motivo: string; pedidoDoDono?: string },
  ts: string,
): Licao {
  const id = requireUuid(lessonId, 'lessonId')
  const rec = asRecord(input, 'lição')
  requireString(rec.agent, 'agent', 1, AGENTE_MAXIMO)
  const motivo = requireString(rec.motivo, 'motivo', 1, LICAO_MOTIVO_MAXIMO)
  const pedido = textoOpcional(rec.pedidoDoDono, 'pedidoDoDono', PEDIDO_DO_DONO_MAXIMO)
  const linha = db.prepare(`SELECT ${COLUNAS} FROM licoes WHERE id = ?`).get(id) as unknown as LinhaDeLicao | undefined
  if (!linha) throw new DomainError(404, 'not_found', 'Lição não encontrada.')
  recusarSeNaLixeira(db, linha.project_id, 'licao', id)
  if (linha.aposentada_em !== null) {
    throw new DomainError(409, 'lesson_already_retired', 'Esta lição já está aposentada.')
  }
  if (linha.tipo !== 'erro' && pedido === null) {
    throw new DomainError(
      400,
      'pedido_do_dono_obrigatorio',
      'Regra e verificação só se aposentam a pedido do dono: informe pedidoDoDono, com as palavras dele.',
    )
  }
  const motivoGuardado = motivoComOPedido(motivo, pedido)
  db.prepare('UPDATE licoes SET aposentada_em = ?, motivo_aposentadoria = ? WHERE id = ?').run(ts, motivoGuardado, id)
  return { ...paraLicao(linha), aposentadaEm: ts, motivoAposentadoria: motivoGuardado }
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
