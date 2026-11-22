// Lê do store tudo que a leitura curta precisa. A regra de montagem fica em `leitura-curta.ts` (puro).
import { LIMITE_LEITURA_CURTA, type LeituraCurta } from '../../shared/leitura-curta.js'
import type { CharterRevision } from '../../shared/continuity.js'
import type { LinhaDaLeitura } from '../../shared/leitura-curta.js'
import { avisosDoObjetivoAtualizado } from './avisos.js'
import type { WorkspaceStore } from '../store.js'
import { montarLeituraCurta, type DadosDaLeitura } from './leitura-curta.js'

function avisoDaDiretriz(diretriz: CharterRevision | null): LinhaDaLeitura | undefined {
  const avisos = avisosDoObjetivoAtualizado(diretriz)
  if (avisos === null) return undefined
  // O formatador só devolve um aviso quando a diretriz existe.
  return { texto: avisos.paraOClaude, fonte: { tipo: 'diretriz', id: diretriz!.id } }
}

export function lerDadosDaLeitura(store: WorkspaceStore, projectId: string, agente: string, geradaEm: string): DadosDaLeitura {
  const { project, tasks, checkpoints } = store.getProject(projectId)
  // O registro mais recente é o de maior revisão (a revisão só cresce no projeto).
  const checkpoint = [...checkpoints].sort((a, b) => b.revision - a.revision)[0] ?? null
  return {
    projeto: { id: project.id, nome: project.name },
    geradaEm,
    revisao: project.revision,
    licoes: store.listarLicoes(projectId),
    falhas: store.falhasDasVerificacoes(projectId),
    avisoDaDiretriz: avisoDaDiretriz(store.getCharter(projectId)),
    checkpoint,
    evidencias: checkpoint === null ? [] : store.listEvidence(projectId, { checkpointId: checkpoint.id }),
    aprovacoes: store.listApprovals(projectId),
    // `includeHistory`: sem ele o store devolve só as aceitas, e a leitura precisa das propostas.
    decisoes: store.listDecisions(projectId, { includeHistory: true }),
    cartoes: store.getBoard(projectId).cards,
    entregas: store.listDeliveries(projectId),
    tarefas: tasks,
    passagens: store.getHandoffDeliveries(projectId, agente, { unreadOnly: true }),
    bloqueios: store.listBlockers(projectId),
  }
}

/** A leitura curta de um projeto, com a hora de agora (ou a de `agora`, nos testes). */
export function lerLeituraCurta(
  store: WorkspaceStore,
  projectId: string,
  agente: string,
  limite: number = LIMITE_LEITURA_CURTA,
  agora: () => Date = () => new Date(),
): LeituraCurta {
  return montarLeituraCurta(lerDadosDaLeitura(store, projectId, agente, agora().toISOString()), limite)
}
