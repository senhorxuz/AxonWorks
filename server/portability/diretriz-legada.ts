import type { CharterRevision } from '../../shared/continuity.js'
import type { ProjectDetail } from '../../shared/types.js'
import { DomainError } from '../store/errors.js'

export const OMISSAO_DA_DIRETRIZ_LEGADA = {
  entity: 'charterRevisions',
  reason: 'O histórico da diretriz viaja na v3. Quando uma IA atualizou a diretriz vigente, a cópia recebe o objetivo da última revisão do dono. Sem revisão do dono, a exportação é recusada.',
}

/** Na importação de um pacote legado, o objetivo cria uma revisão humana. */
export function diretrizParaPacoteLegado(detail: ProjectDetail, revisoes?: readonly CharterRevision[]): ProjectDetail {
  const recentes = revisoes?.toSorted((a, b) => b.revision - a.revision)
  if (recentes?.[0]?.sourceKind !== 'agent_update') return detail

  const humana = recentes.find(revisao => revisao.sourceKind === 'human_directive')
  if (!humana) {
    throw new DomainError(409, 'objetivo_da_ia_sem_versao_do_dono',
      'O objetivo foi atualizado por uma IA e não há revisão do dono para exportar neste formato. A versão 3 preserva a autoria.')
  }
  return { ...detail, project: { ...detail.project, objective: humana.body } }
}
