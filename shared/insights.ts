/**
 * Tipos de saída da inteligência sem IA (Parte 6).
 *
 * Nada aqui vem de modelo de linguagem, rede neural ou nota de 0 a 100. Cada
 * item é derivado de fatos que já existem na Axon — tarefas, checkpoints,
 * bloqueios, mensagens, passagens e evidências — e explica a si mesmo em
 * `reason`, em português simples, com a fonte declarada (`sourceType` +
 * `sourceId`). Ver `server/insights/compute.ts` para as regras e
 * o código abaixo para o motivo de cada limite de
 * tempo e o que os dados atuais não permitem afirmar.
 */

/** De onde um item de inteligência foi derivado, para quem quiser conferir a fonte. */
export type InsightSourceType =
  | 'task'
  | 'checkpoint'
  | 'blocker'
  | 'message'
  | 'handoff_delivery'
  | 'evidence'
  | 'task_event'

export type NextActionKind =
  | 'dependency_unblocked'
  | 'stale_evidence_on_done_task'
  | 'unread_handoff'
  | 'stale_question_or_review'
  | 'urgent_task_blocked'
  | 'repeated_reopen'

/** Uma próxima ação sugerida. Sempre explicável, sempre rastreável até a fonte. */
export interface NextAction {
  id: string
  kind: NextActionKind
  taskId: string | null
  title: string
  reason: string
  sourceType: InsightSourceType
  sourceId: string
}

/** Uma tarefa reservada por uma identidade que não deixou nenhum registro nela — a "IA sumida". */
export interface StalledTask {
  taskId: string
  taskTitle: string
  assignee: string
  leaseUntil: string
  reason: string
  sourceType: InsightSourceType
  sourceId: string
}

/** Uma contagem com motivo. Nunca uma nota, nunca um índice — só o fato e por quê. */
export interface InsightSignal {
  count: number
  reason: string
}

export interface InsightsSignals {
  staleEvidenceOnDoneTasks: InsightSignal
  blockedTasks: InsightSignal
  openBlockers: InsightSignal
  staleQuestionsAndReviews: InsightSignal
  unreadHandoffs: InsightSignal
  doneTasksWithoutMarkedCriteria: InsightSignal
}

/** O que aconteceu de bom recentemente. Só eventos reais, nada estimado. */
export interface InsightsMomentum {
  tasksCompletedLast24h: number
  tasksCompletedLast7d: number
  checkpointsLast24h: number
  /** Dias consecutivos com pelo menos um checkpoint, terminando no dia mais recente com registro. */
  streakDays: number
  /** O dia (AAAA-MM-DD, UTC) em que a sequência termina. `null` quando não há nenhum checkpoint. */
  streakEndsOn: string | null
}

/** Atividade por identidade. Contagem, nunca julgamento — nenhum ranking de qual IA é melhor. */
export interface AgentActivitySummary {
  agent: string
  lastCheckpointAt: string | null
  tasksCompleted: number
  handoffsSent: number
}

export interface ProjectInsights {
  projectId: string
  generatedAt: string
  nextActions: NextAction[]
  stalledTasks: StalledTask[]
  signals: InsightsSignals
  momentum: InsightsMomentum
  agentActivity: AgentActivitySummary[]
}

export interface ComputeInsightsOptions {
  /** O relógio entra como parâmetro: mesma entrada, mesma saída, e os testes controlam o tempo. */
  now: Date
}
