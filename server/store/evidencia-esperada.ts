import type { ContextoDaEvidencia, EvidenceInput, EvidenceOutcome, EvidenceRecord } from '../../shared/evidence.js'
import { DomainError } from './errors.js'
import { mapEvidenceRecord } from './mappers.js'
import type { SqlRow } from './sql.js'
import { requireString } from './validation.js'
import { lerEvidenciasComVerificacao } from './verificacoes.js'

const RESULTADOS = { passed: 'passou', failed: 'falhou', not_run: 'não rodou' }
const RESULTADOS_COM_EXPECTATIVA = {
  passar: { passed: 'Passou como esperado', failed: 'Falhou sem esperar' },
  falhar: { passed: 'Passou quando devia falhar', failed: 'Falhou como esperado (fase vermelha)' },
}

export function leituraDaEvidencia({ esperado, outcome, versao, ambiente }: ContextoDaEvidencia & { outcome: EvidenceOutcome }): string {
  const resultado = esperado === undefined || outcome === 'not_run'
    ? RESULTADOS[outcome]
    : RESULTADOS_COM_EXPECTATIVA[esperado][outcome]
  if (ambiente === undefined && versao === undefined) return resultado
  const local = ambiente === 'prévia' ? ' na prévia' : ambiente === undefined ? '' : ` no ambiente ${ambiente}`
  const commit = versao === undefined ? '' : `${ambiente === undefined ? ' no' : ' do'} commit ${versao}`
  return resultado.charAt(0).toUpperCase() + resultado.slice(1) + local + commit
}

function lerContexto({ esperado, versao, ambiente }: Record<string, unknown>): ContextoDaEvidencia {
  const contexto: ContextoDaEvidencia = {}
  if (esperado !== undefined) {
    if (esperado !== 'passar' && esperado !== 'falhar') {
      throw new DomainError(400, 'invalid_input', 'Campo evidence.esperado inválido. Os valores aceitos são passar e falhar.')
    }
    contexto.esperado = esperado
  }
  if (versao !== undefined) contexto.versao = requireString(versao, 'evidence.versao', 1, 200)
  if (ambiente !== undefined) contexto.ambiente = requireString(ambiente, 'evidence.ambiente', 1, 200)
  return contexto
}

export function lerEvidenciasComResultado(valor: unknown): EvidenceInput[] {
  const declaracoes = valor as Array<Record<string, unknown>>
  return lerEvidenciasComVerificacao(valor).map((evidencia, posicao) => ({
    ...evidencia,
    ...lerContexto(declaracoes[posicao]!),
  }))
}

export function mapEvidenceRecordComContexto(row: SqlRow): EvidenceRecord {
  return {
    ...mapEvidenceRecord(row),
    ...lerContexto({
      esperado: row.esperado ?? undefined,
      versao: row.versao ?? undefined,
      ambiente: row.ambiente ?? undefined,
    }),
  }
}
