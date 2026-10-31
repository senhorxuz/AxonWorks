import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { DomainError } from './errors.js'

/**
 * Registro de saúde dos ganchos do Claude Code: cada vez que o programa dos ganchos age num projeto
 * conectado (abrir a sessão, guardar a compactação, guardar o fechamento, recuperar uma sessão que
 * fechou sem aviso), grava aqui se deu certo. A tela "Onde paramos" mostra a linha de saúde a partir
 * deste registro; sem evento, a linha não aparece (nenhum número sem dado real).
 *
 * Regra própria, fora de `server/store.ts`, que só recebe a ligação.
 */

export type TipoEventoDeIntegracao = 'abrir' | 'compactar' | 'fechar' | 'recuperar'

export interface EventoDeIntegracao {
  tipo: TipoEventoDeIntegracao
  ok: boolean
  detalhe: string | null
}

export interface SaudeDaIntegracao {
  ultimoRegistroAutomatico: string | null
  ultimoErro: string | null
}

/** Detalhe mais longo que isto é cortado (uma mensagem de erro não precisa de mais). */
export const DETALHE_MAXIMO = 2000
/** Mostrado quando o gancho falhou sem mensagem. */
export const ERRO_SEM_DETALHE = 'O gancho do Claude Code falhou sem deixar detalhe.'

const TIPOS = new Set<string>(['abrir', 'compactar', 'fechar', 'recuperar'])

export function ensureIntegracaoSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      kind TEXT NOT NULL,
      ok INTEGER NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_integration_events_project ON integration_events(project_id, created_at);
  `)
}

function recusar(campo: string): never {
  throw new DomainError(400, 'invalid_input', `Campo ${campo} inválido no evento de integração.`)
}

function validarEvento(evento: unknown): EventoDeIntegracao {
  if (typeof evento !== 'object' || evento === null) recusar('evento')
  const { tipo, ok, detalhe } = evento as Record<string, unknown>
  if (!TIPOS.has(tipo as string)) recusar('tipo')
  if (typeof ok !== 'boolean') recusar('ok')
  if (detalhe !== null && typeof detalhe !== 'string') recusar('detalhe')
  return { tipo: tipo as TipoEventoDeIntegracao, ok, detalhe: detalhe === null ? null : detalhe.slice(0, DETALHE_MAXIMO) }
}

export function registrarEvento(
  db: DatabaseSync,
  projectId: string,
  evento: EventoDeIntegracao,
  ts: string,
  id: string = randomUUID(),
): void {
  const valido = validarEvento(evento)
  db.prepare(
    `INSERT INTO integration_events (id, project_id, kind, ok, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, valido.tipo, valido.ok ? 1 : 0, valido.detalhe, ts)
}

/** Hora do sucesso mais novo, de qualquer tipo (mesma hora: o gravado por último). */
function ultimoSucesso(db: DatabaseSync, projectId: string): string | null {
  const linha = db
    .prepare(
      `SELECT created_at FROM integration_events
       WHERE project_id = ? AND ok = 1 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(projectId) as { created_at: string } | undefined
  return linha?.created_at ?? null
}

/**
 * A falha mais nova que nenhum sucesso do mesmo tipo veio superar (depois = hora maior, ou mesma hora
 * gravada por último). `fechar` e `recuperar` gravam o mesmo rascunho de fechamento, então contam como
 * um tipo só. `abrir` é um tipo à parte: a abertura de cada sessão nunca apaga da tela uma falha de
 * gravação, e a falha de abrir some na próxima abertura bem-sucedida.
 */
function falhaDePe(db: DatabaseSync, projectId: string): { detail: string | null } | undefined {
  return db
    .prepare(
      `SELECT e.detail FROM integration_events e
       WHERE e.project_id = ? AND e.ok = 0 AND NOT EXISTS (
         SELECT 1 FROM integration_events s
         WHERE s.project_id = e.project_id AND s.ok = 1
           AND (CASE s.kind WHEN 'recuperar' THEN 'fechar' ELSE s.kind END)
             = (CASE e.kind WHEN 'recuperar' THEN 'fechar' ELSE e.kind END)
           AND (s.created_at, s.rowid) > (e.created_at, e.rowid)
       )
       ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1`,
    )
    .get(projectId) as { detail: string | null } | undefined
}

/** Registro automático: o sucesso mais novo. Erro: a falha mais nova ainda não superada (ver `falhaDePe`). */
export function ultimoEvento(db: DatabaseSync, projectId: string): SaudeDaIntegracao {
  const falha = falhaDePe(db, projectId)
  return {
    ultimoRegistroAutomatico: ultimoSucesso(db, projectId),
    ultimoErro: falha === undefined ? null : (falha.detail ?? ERRO_SEM_DETALHE),
  }
}

export function apagarEventosDoProjeto(db: DatabaseSync, projectId: string): void {
  db.prepare('DELETE FROM integration_events WHERE project_id = ?').run(projectId)
}
