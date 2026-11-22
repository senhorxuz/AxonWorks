import type { DatabaseSync } from 'node:sqlite'
import type { EvidenceInput } from '../../shared/evidence.js'
import type { FalhaDaVerificacao } from '../../shared/licoes.js'
import { DomainError } from './errors.js'
import { naoEstaNaLixeira } from './lixeira.js'
import { requireEvidenceInput } from './validation.js'

function verificacaoInvalida(): DomainError {
  return new DomainError(400, 'verificacao_invalida', 'A evidência precisa apontar para uma verificação ativa deste projeto.')
}

export function lerEvidenciasComVerificacao(value: unknown): EvidenceInput[] {
  const evidencias = requireEvidenceInput(value)
  // A validação comum já conferiu cada declaração. O vínculo é opcional e só entra nas gravações de trabalho.
  const declaracoes = value as Array<{ verificacaoId?: unknown }>
  return evidencias.map((evidencia, posicao) => {
    const id = declaracoes[posicao]!.verificacaoId
    if (id === undefined) return evidencia
    if (typeof id !== 'string') throw verificacaoInvalida()
    return { ...evidencia, verificacaoId: id }
  })
}

/** A consulta roda na transação que grava a evidência, depois de resolver o replay idempotente. */
export function validarVinculoDaVerificacao(db: DatabaseSync, projectId: string, id: string | undefined): void {
  if (id === undefined) return
  const ativa = db.prepare(`
    SELECT id FROM licoes
    WHERE id = ? AND project_id = ? AND tipo = 'verificacao' AND aposentada_em IS NULL
      AND ${naoEstaNaLixeira("'licao'", 'licoes.id')}
  `).get(id, projectId)
  if (!ativa) throw verificacaoInvalida()
}

/** Conta os relatos e escolhe o último. Em empate de horário, vale a ordem de gravação. */
export function falhasDasVerificacoes(db: DatabaseSync, projectId: string): FalhaDaVerificacao[] {
  const linhas = db.prepare(`
    WITH falhas AS (
      SELECT verificacao_id AS verificacaoId,
             COUNT(*) OVER por_verificacao AS quantas,
             created_at AS ultimaEm,
             checkpoint_id AS ultimoCheckpointId,
             details AS ultimoDetalhe,
             rowid AS gravacao,
             ROW_NUMBER() OVER (por_verificacao ORDER BY created_at DESC, rowid DESC) AS ordem
        FROM evidence_records
       WHERE project_id = ? AND outcome = 'failed' AND verificacao_id IS NOT NULL
      WINDOW por_verificacao AS (PARTITION BY verificacao_id)
    )
    SELECT verificacaoId, quantas, ultimaEm, ultimoCheckpointId, ultimoDetalhe
      FROM falhas
     WHERE ordem = 1
     ORDER BY ultimaEm DESC, gravacao DESC
  `).all(projectId) as unknown as FalhaDaVerificacao[]
  return linhas.map((linha) => ({ ...linha }))
}
