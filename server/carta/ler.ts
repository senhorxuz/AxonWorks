// Lê do store tudo que a carta precisa. A regra de montagem fica em `montar.ts` (puro).
import { AGENTE_AUTOMATICO } from '../../shared/carta.js'
import type { WorkDraft } from '../../shared/continuity.js'
import type { WorkspaceStore } from '../store.js'
import type { DadosDaCarta } from './montar.js'

/** O rascunho automático é o `WorkDraft` do agente automático que não pertence a nenhuma tarefa. */
function lerRascunhoAutomatico(store: WorkspaceStore, projectId: string): WorkDraft | null {
  return store.listWorkDrafts(projectId, AGENTE_AUTOMATICO).find((rascunho) => rascunho.taskId === null) ?? null
}

/** Linha de saúde da conexão: o registro dos ganchos do Claude Code. Sem registro, tudo null e a linha não aparece. */
function lerSaude(store: WorkspaceStore, projectId: string): DadosDaCarta['saude'] {
  return store.ultimoEventoDeIntegracao(projectId)
}

export function lerDadosDaCarta(store: WorkspaceStore, projectId: string): DadosDaCarta {
  const { project, tasks, checkpoints } = store.getProject(projectId)
  return {
    project,
    tasks,
    checkpoints,
    cards: store.getBoard(projectId).cards,
    backlog: store.listBacklog(projectId),
    // `includeHistory`: sem ele o store devolve só as aceitas, e a carta precisa das propostas.
    decisions: store.listDecisions(projectId, { includeHistory: true }),
    approvals: store.listApprovals(projectId),
    blockers: store.listBlockers(projectId),
    rascunhoAutomatico: lerRascunhoAutomatico(store, projectId),
    saude: lerSaude(store, projectId),
    diretriz: store.getCharter(projectId),
  }
}
