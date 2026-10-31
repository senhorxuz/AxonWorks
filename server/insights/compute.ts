/**
 * Inteligência sem IA: `computeInsights` só lê o que o `WorkspaceStore` já
 * expõe publicamente e devolve fatos explicados, nunca uma nota.
 *
 * Três princípios, sem exceção:
 * 1. Determinística — mesma entrada, mesmo `now`, mesma saída.
 * 2. Explicável — todo item de `nextActions` e `stalledTasks` traz `reason`
 *    em português simples e a fonte (`sourceType` + `sourceId`).
 * 3. Honesta — nada de nota de 0 a 100, índice de saúde ou ranking entre
 *    identidades. Quando o dado não permite afirmar algo (por exemplo, o
 *    instante exato em que uma tarefa foi reivindicada), a regra não afirma.
 *
 * Fonte de dados: `store.exportProjectBundleData(projectId)` — a única
 * leitura pública que devolve o projeto inteiro de uma vez (tarefas,
 * checkpoints, mensagens, passagens, recibos de leitura, resoluções de
 * mensagem, bloqueios, decisões e eventos de tarefa). Evidência fica de fora
 * dela (é uma omissão declarada do próprio formato do pacote, ver
 * shared/portability.ts), por isso `listEvidence` é uma chamada à parte.
 */
import type { WorkspaceStore } from '../store.js'
import type { AgentMessage, Checkpoint, ProjectDetail, Task } from '../../shared/types.js'
import type { MessageResolution, ProjectBlocker, TaskTransitionEvent } from '../../shared/continuity.js'
import type { PortableHandoffDelivery } from '../../shared/portability.js'
import type { EvidenceView } from '../../shared/evidence.js'
import type {
  AgentActivitySummary,
  ComputeInsightsOptions,
  InsightSignal,
  InsightsMomentum,
  InsightsSignals,
  NextAction,
  NextActionKind,
  ProjectInsights,
  StalledTask,
} from '../../shared/insights.js'
import {
  ATTENTION_AGING_MS,
  DAY_MS,
  DEPENDENCY_UNLOCK_WINDOW_MS,
  REWORK_REOPEN_THRESHOLD,
  STALLED_LEASE_GRACE_MS,
  WEEK_MS,
} from './constants.js'
import { collectKnownIdentities, hasActiveLease } from './identities.js'

const BROADCAST = '*'

export function computeInsights(
  store: WorkspaceStore,
  projectId: string,
  options: ComputeInsightsOptions,
): ProjectInsights {
  const now = options.now
  const bundle = store.exportProjectBundleData(projectId)
  const detail = bundle.project
  const blockers = bundle.blockers ?? []
  const decisions = bundle.decisions ?? []
  const deliveries = bundle.deliveries
  const staleEvidence = store.listEvidence(projectId, { staleOnly: true })

  const identities = collectKnownIdentities(detail, blockers, decisions, deliveries)
  const receiptsByDelivery = groupReceiptsByDelivery(bundle.deliveryReceipts)
  const resolversByMessage = groupResolversByMessage(bundle.messageResolutions ?? [])
  const taskEventsByTask = groupTaskEventsByTask(bundle.taskEvents ?? [])

  const checkpointById = new Map(detail.checkpoints.map((c) => [c.id, c]))
  const taskById = new Map(detail.tasks.map((t) => [t.id, t]))

  const dependencyUnblocked = findDependencyUnblockedActions(detail, taskById, checkpointById, now)
  const staleEvidenceActions = findStaleEvidenceActions(staleEvidence, detail, checkpointById)
  const unreadHandoffActions = findUnreadHandoffActions(deliveries, receiptsByDelivery)
  const staleAttentionActions = findStaleAttentionActions(detail.messages, resolversByMessage, now)
  const urgentBlockedActions = findUrgentBlockedActions(blockers, taskById)
  const reworkByTask = collectReworkCounts(taskEventsByTask)
  const repeatedReopenActions = findRepeatedReopenActions(reworkByTask, taskById)

  const nextActions = sortByImportance([
    ...urgentBlockedActions,
    ...staleEvidenceActions,
    ...dependencyUnblocked,
    ...unreadHandoffActions,
    ...staleAttentionActions,
    ...repeatedReopenActions,
  ])

  const stalledTasks = computeStalledTasks(detail, now)

  const signals = computeSignals({
    staleEvidenceActions,
    staleAttentionActions,
    unreadHandoffActions,
    detail,
    blockers,
  })

  const momentum = computeMomentum(detail, now)

  const agentActivity = computeAgentActivity(identities, detail, checkpointById, deliveries)

  return {
    projectId,
    generatedAt: now.toISOString(),
    nextActions,
    stalledTasks,
    signals,
    momentum,
    agentActivity,
  }
}

function groupReceiptsByDelivery(receipts: { deliveryId: string; agent: string }[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const receipt of receipts) {
    const set = map.get(receipt.deliveryId) ?? new Set<string>()
    set.add(receipt.agent)
    map.set(receipt.deliveryId, set)
  }
  return map
}

function groupResolversByMessage(resolutions: MessageResolution[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const resolution of resolutions) {
    const set = map.get(resolution.messageId) ?? new Set<string>()
    set.add(resolution.agent)
    map.set(resolution.messageId, set)
  }
  return map
}

/** bundle.taskEvents já vem ordenado por created_at ASC; agrupar preserva a ordem cronológica por tarefa. */
function groupTaskEventsByTask(events: TaskTransitionEvent[]): Map<string, TaskTransitionEvent[]> {
  const map = new Map<string, TaskTransitionEvent[]>()
  for (const event of events) {
    const list = map.get(event.taskId) ?? []
    list.push(event)
    map.set(event.taskId, list)
  }
  return map
}

const KIND_PRIORITY: Record<NextActionKind, number> = {
  // Uma tarefa urgente parada por bloqueio é o que mais custa se ignorado.
  urgent_task_blocked: 0,
  // Uma entrega "concluída" cuja evidência não cobre mais o código é uma
  // falsa sensação de pronto — vale mais que uma sugestão de início.
  stale_evidence_on_done_task: 1,
  dependency_unblocked: 2,
  unread_handoff: 3,
  stale_question_or_review: 4,
  // Retrabalho é informativo, não uma pendência com prazo — fica por último.
  repeated_reopen: 5,
}

function sortByImportance(actions: NextAction[]): NextAction[] {
  return [...actions].sort((a, b) => {
    const byKind = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]
    if (byKind !== 0) return byKind
    return a.id.localeCompare(b.id)
  })
}

function findDependencyUnblockedActions(
  detail: ProjectDetail,
  taskById: Map<string, Task>,
  checkpointById: Map<string, Checkpoint>,
  now: Date,
): NextAction[] {
  const actions: NextAction[] = []
  for (const task of detail.tasks) {
    if (task.status !== 'todo') continue
    if (hasActiveLease(task, now)) continue
    const deps = task.dependencyTaskIds ?? []
    if (deps.length === 0) continue
    const depTasks = deps.map((id) => taskById.get(id)).filter((t): t is Task => Boolean(t))
    if (depTasks.length !== deps.length) continue
    if (!depTasks.every((dep) => dep.status === 'done')) continue

    // Entre as dependências concluídas, buscamos a conclusão mais recente cujo
    // instante é conhecido (completionCheckpointId aponta para o checkpoint do
    // declare_done). Dependência concluída sem esse vínculo não entra na
    // comparação — não inventamos o instante em que ela terminou.
    let mostRecent: { dep: Task; checkpoint: Checkpoint } | null = null
    for (const dep of depTasks) {
      if (!dep.completionCheckpointId) continue
      const checkpoint = checkpointById.get(dep.completionCheckpointId)
      if (!checkpoint) continue
      if (!mostRecent || Date.parse(checkpoint.createdAt) > Date.parse(mostRecent.checkpoint.createdAt)) {
        mostRecent = { dep, checkpoint }
      }
    }
    if (!mostRecent) continue

    const age = now.getTime() - Date.parse(mostRecent.checkpoint.createdAt)
    if (age < 0 || age > DEPENDENCY_UNLOCK_WINDOW_MS) continue

    actions.push({
      id: `dependency_unblocked:task:${task.id}`,
      kind: 'dependency_unblocked',
      taskId: task.id,
      title: `Começar "${task.title}"`,
      reason: `A dependência "${mostRecent.dep.title}" foi concluída por ${mostRecent.checkpoint.agent} em ${mostRecent.checkpoint.createdAt}, e "${task.title}" está livre para começar.`,
      sourceType: 'checkpoint',
      sourceId: mostRecent.checkpoint.id,
    })
  }
  return actions
}

function findStaleEvidenceActions(
  staleEvidence: EvidenceView[],
  detail: ProjectDetail,
  checkpointById: Map<string, Checkpoint>,
): NextAction[] {
  const actions: NextAction[] = []
  const seenTasks = new Set<string>()
  for (const evidence of staleEvidence) {
    const checkpoint = checkpointById.get(evidence.checkpointId)
    if (!checkpoint || !checkpoint.taskId) continue
    const task = detail.tasks.find((t) => t.id === checkpoint.taskId)
    if (!task || task.status !== 'done') continue
    if (seenTasks.has(task.id)) continue
    seenTasks.add(task.id)
    // Construído a partir dos próprios artefatos da evidência, não de `evidence.explanation`:
    // aquele texto já começa com "Esta evidência não cobre mais a versão atual" (prefixo exigido
    // pela tela, ver server/store.ts), e colar os dois aqui repetiria a mesma frase duas vezes.
    const staleFiles = evidence.artifacts.filter((a) => a.freshness === 'stale').map((a) => a.path)
    const subject = pluralizeWord(staleFiles.length, 'o arquivo declarado', 'os arquivos declarados')
    const verb = pluralizeWord(staleFiles.length, 'mudou', 'mudaram')
    // Sem crase: a tela mostra `reason` como texto puro, então marcação de código apareceria
    // literalmente para quem não programa.
    const fileNames = staleFiles.join(', ')
    actions.push({
      id: `stale_evidence_on_done_task:task:${task.id}`,
      kind: 'stale_evidence_on_done_task',
      taskId: task.id,
      title: `Reconferir "${task.title}"`,
      reason: `"${task.title}" foi dada como concluída, mas o comando "${evidence.command}" não confirma mais isso: ${subject} ${verb} depois da medição (${fileNames}).`,
      sourceType: 'evidence',
      sourceId: evidence.id,
    })
  }
  return actions
}

function findUnreadHandoffActions(
  deliveries: PortableHandoffDelivery[],
  receiptsByDelivery: Map<string, Set<string>>,
): NextAction[] {
  const actions: NextAction[] = []
  for (const delivery of deliveries) {
    if (delivery.to === BROADCAST) continue // sem destinatário único, não há como afirmar "não lida"
    const readers = receiptsByDelivery.get(delivery.id)
    if (readers?.has(delivery.to)) continue
    actions.push({
      id: `unread_handoff:handoff_delivery:${delivery.id}`,
      kind: 'unread_handoff',
      taskId: delivery.taskId,
      title: `Ler a passagem para ${delivery.to}`,
      reason: `${delivery.from} deixou uma passagem para ${delivery.to} em ${delivery.createdAt} e ela ainda não foi confirmada como lida.`,
      sourceType: 'handoff_delivery',
      sourceId: delivery.id,
    })
  }
  return actions
}

function findStaleAttentionActions(
  messages: AgentMessage[],
  resolversByMessage: Map<string, Set<string>>,
  now: Date,
): NextAction[] {
  const actions: NextAction[] = []
  for (const message of messages) {
    if (message.kind !== 'question' && message.kind !== 'review') continue
    if (message.to === BROADCAST) continue // resolução é por identidade; sem destinatário único não há "resolvido" geral
    const resolvers = resolversByMessage.get(message.id)
    if (resolvers?.has(message.to)) continue
    const age = now.getTime() - Date.parse(message.createdAt)
    if (age < ATTENTION_AGING_MS) continue
    const kindLabel = message.kind === 'question' ? 'pergunta' : 'pedido de revisão'
    actions.push({
      id: `stale_question_or_review:message:${message.id}`,
      kind: 'stale_question_or_review',
      taskId: null,
      title: `Responder ${kindLabel} de ${message.from} para ${message.to}`,
      reason: `${message.from} enviou uma ${kindLabel} para ${message.to} em ${message.createdAt} e ela segue sem desfecho.`,
      sourceType: 'message',
      sourceId: message.id,
    })
  }
  return actions
}

function findUrgentBlockedActions(blockers: ProjectBlocker[], taskById: Map<string, Task>): NextAction[] {
  const actions: NextAction[] = []
  for (const blocker of blockers) {
    if (blocker.status !== 'open') continue
    if (!blocker.taskId) continue
    const task = taskById.get(blocker.taskId)
    if (!task || task.priority !== 'urgent') continue
    actions.push({
      id: `urgent_task_blocked:blocker:${blocker.id}`,
      kind: 'urgent_task_blocked',
      taskId: task.id,
      title: `Desbloquear "${task.title}"`,
      reason: `"${task.title}" é urgente e está travada pelo bloqueio "${blocker.title}", aberto por ${blocker.openedBy} e ainda não resolvido.`,
      sourceType: 'blocker',
      sourceId: blocker.id,
    })
  }
  return actions
}

interface ReworkInfo {
  count: number
  lastEventId: string
  lastAgent: string
  lastNote: string
  lastCreatedAt: string
}

/**
 * Conta reaberturas por tarefa a partir dos eventos de transição. Só
 * `reopenTask` grava evento com `toStatus` igual a `todo` ou `in_progress`:
 * os eventos de `finalizeWork` sempre levam a `blocked` ou `done`. Não há
 * ambiguidade entre as duas fontes.
 */
function collectReworkCounts(taskEventsByTask: Map<string, TaskTransitionEvent[]>): Map<string, ReworkInfo> {
  const result = new Map<string, ReworkInfo>()
  for (const [taskId, events] of taskEventsByTask) {
    const reopenEvents = events.filter((e) => e.toStatus === 'todo' || e.toStatus === 'in_progress')
    if (reopenEvents.length === 0) continue
    const last = reopenEvents[reopenEvents.length - 1]!
    result.set(taskId, {
      count: reopenEvents.length,
      lastEventId: last.id,
      lastAgent: last.agent,
      lastNote: last.note,
      lastCreatedAt: last.createdAt,
    })
  }
  return result
}

function findRepeatedReopenActions(
  reworkByTask: Map<string, ReworkInfo>,
  taskById: Map<string, Task>,
): NextAction[] {
  const actions: NextAction[] = []
  for (const [taskId, info] of reworkByTask) {
    if (info.count < REWORK_REOPEN_THRESHOLD) continue
    const task = taskById.get(taskId)
    if (!task) continue
    actions.push({
      id: `repeated_reopen:task_event:${info.lastEventId}`,
      kind: 'repeated_reopen',
      taskId,
      title: `Investigar retrabalho em "${task.title}"`,
      reason: `"${task.title}" já foi reaberta ${info.count} vezes — a mais recente por ${info.lastAgent} em ${info.lastCreatedAt} ("${info.lastNote}"). Pode valer a pena investigar a causa antes de seguir.`,
      sourceType: 'task_event',
      sourceId: info.lastEventId,
    })
  }
  return actions
}

function computeStalledTasks(detail: ProjectDetail, now: Date): StalledTask[] {
  const result: StalledTask[] = []
  for (const task of detail.tasks) {
    if (task.status !== 'in_progress' || !task.assignee || !task.leaseUntil) continue
    const leaseExpiredAt = Date.parse(task.leaseUntil)
    if (now.getTime() - leaseExpiredAt < STALLED_LEASE_GRACE_MS) continue
    const hasRecord = detail.checkpoints.some((c) => c.taskId === task.id && c.agent === task.assignee)
    if (hasRecord) continue
    result.push({
      taskId: task.id,
      taskTitle: task.title,
      assignee: task.assignee,
      leaseUntil: task.leaseUntil,
      reason: `A reserva de ${task.assignee} em "${task.title}" venceu em ${task.leaseUntil} e não existe nenhum checkpoint dessa identidade nesta tarefa. Não sabemos o instante exato em que a reserva atual começou — só que ela venceu sem deixar registro.`,
      sourceType: 'task',
      sourceId: task.id,
    })
  }
  return result
}

/**
 * Escolhe a forma no singular ou no plural conforme a contagem — nunca "(s)"
 * entre parênteses. Todo `reason` devolvido por este módulo é lido por
 * alguém que não programa.
 */
function pluralizeWord(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

function countSignal(count: number, zeroReason: string, nonZeroReason: (count: number) => string): InsightSignal {
  return { count, reason: count === 0 ? zeroReason : nonZeroReason(count) }
}

function computeSignals(input: {
  staleEvidenceActions: NextAction[]
  staleAttentionActions: NextAction[]
  unreadHandoffActions: NextAction[]
  detail: ProjectDetail
  blockers: ProjectBlocker[]
}): InsightsSignals {
  const { staleEvidenceActions, staleAttentionActions, unreadHandoffActions, detail, blockers } = input

  const blockedTasks = detail.tasks.filter((t) => t.status === 'blocked')
  const openBlockers = blockers.filter((b) => b.status === 'open')
  const doneWithoutCriteria = detail.tasks.filter((t) => {
    if (t.status !== 'done') return false
    const criteria = t.acceptanceCriteria ?? []
    return !criteria.some((c) => c.completed)
  })
  const attentionAgingHours = ATTENTION_AGING_MS / (60 * 60 * 1000)

  return {
    staleEvidenceOnDoneTasks: countSignal(
      staleEvidenceActions.length,
      'Nenhuma tarefa concluída tem evidência que deixou de cobrir a versão atual do código.',
      (n) => {
        const subject = pluralizeWord(n, 'tarefa concluída tem', 'tarefas concluídas têm')
        return `${n} ${subject} evidência que não cobre mais a versão atual do código.`
      },
    ),
    blockedTasks: countSignal(
      blockedTasks.length,
      'Nenhuma tarefa está com status bloqueado.',
      (n) => `${n} ${pluralizeWord(n, 'tarefa está', 'tarefas estão')} com status bloqueado.`,
    ),
    openBlockers: countSignal(
      openBlockers.length,
      'Nenhum bloqueio aberto no momento.',
      (n) => `${n} ${pluralizeWord(n, 'bloqueio aberto', 'bloqueios abertos')} aguardando resolução.`,
    ),
    staleQuestionsAndReviews: countSignal(
      staleAttentionActions.length,
      `Nenhuma pergunta ou pedido de revisão está sem desfecho há mais de ${attentionAgingHours} horas.`,
      (n) => {
        const subject = pluralizeWord(n, 'mensagem de pergunta ou revisão segue', 'mensagens de pergunta ou revisão seguem')
        return `${n} ${subject} sem desfecho há mais de ${attentionAgingHours} horas.`
      },
    ),
    unreadHandoffs: countSignal(
      unreadHandoffActions.length,
      'Todas as passagens com destinatário específico já foram confirmadas como lidas.',
      (n) => {
        const subject = pluralizeWord(n, 'passagem', 'passagens')
        const verb = pluralizeWord(n, 'foi confirmada', 'foram confirmadas')
        const adjective = pluralizeWord(n, 'lida', 'lidas')
        return `${n} ${subject} com destinatário específico ainda não ${verb} como ${adjective}.`
      },
    ),
    doneTasksWithoutMarkedCriteria: countSignal(
      doneWithoutCriteria.length,
      'Toda tarefa concluída tem ao menos um critério de aceite marcado.',
      (n) => `${n} ${pluralizeWord(n, 'tarefa concluída não tem', 'tarefas concluídas não têm')} nenhum critério de aceite marcado.`,
    ),
  }
}

function calendarDayKey(iso: string): string {
  return iso.slice(0, 10) // AAAA-MM-DD em UTC, já que toda data gravada é ISO com Z
}

function computeMomentum(detail: ProjectDetail, now: Date): InsightsMomentum {
  const checkpointById = new Map(detail.checkpoints.map((c) => [c.id, c]))

  let tasksCompletedLast24h = 0
  let tasksCompletedLast7d = 0
  for (const task of detail.tasks) {
    if (task.status !== 'done' || !task.completionCheckpointId) continue
    const checkpoint = checkpointById.get(task.completionCheckpointId)
    if (!checkpoint) continue
    const age = now.getTime() - Date.parse(checkpoint.createdAt)
    if (age < 0) continue
    if (age <= DAY_MS) tasksCompletedLast24h++
    if (age <= WEEK_MS) tasksCompletedLast7d++
  }

  let checkpointsLast24h = 0
  const dayKeys = new Set<string>()
  for (const checkpoint of detail.checkpoints) {
    const age = now.getTime() - Date.parse(checkpoint.createdAt)
    if (age >= 0 && age <= DAY_MS) checkpointsLast24h++
    dayKeys.add(calendarDayKey(checkpoint.createdAt))
  }

  const { streakDays, streakEndsOn } = computeStreak(dayKeys, now)

  return { tasksCompletedLast24h, tasksCompletedLast7d, checkpointsLast24h, streakDays, streakEndsOn }
}

function computeStreak(dayKeys: Set<string>, now: Date): { streakDays: number; streakEndsOn: string | null } {
  const nowKey = calendarDayKey(now.toISOString())
  const eligibleKeys = Array.from(dayKeys)
    .filter((key) => key <= nowKey)
    .sort()
  const mostRecentKey = eligibleKeys.at(-1)
  if (!mostRecentKey) return { streakDays: 0, streakEndsOn: null }

  let streakDays = 0
  let cursor = new Date(`${mostRecentKey}T00:00:00.000Z`)
  while (dayKeys.has(calendarDayKey(cursor.toISOString()))) {
    streakDays++
    cursor = new Date(cursor.getTime() - DAY_MS)
  }
  return { streakDays, streakEndsOn: mostRecentKey }
}

function computeAgentActivity(
  identities: string[],
  detail: ProjectDetail,
  checkpointById: Map<string, Checkpoint>,
  deliveries: PortableHandoffDelivery[],
): AgentActivitySummary[] {
  return identities.map((agent) => {
    // detail.checkpoints já vem ordenado por revisão crescente (ver readDetail em server/store.ts);
    // filtrar preserva a ordem, então o último elemento é o mais recente dessa identidade.
    const ownCheckpoints = detail.checkpoints.filter((c) => c.agent === agent)
    const lastCheckpointAt = ownCheckpoints.length > 0 ? ownCheckpoints[ownCheckpoints.length - 1]!.createdAt : null

    const tasksCompleted = detail.tasks.filter((t) => {
      if (t.status !== 'done' || !t.completionCheckpointId) return false
      return checkpointById.get(t.completionCheckpointId)?.agent === agent
    }).length

    const handoffsSent = deliveries.filter((d) => d.from === agent).length

    return { agent, lastCheckpointAt, tasksCompleted, handoffsSent }
  })
}
