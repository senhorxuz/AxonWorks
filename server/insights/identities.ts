/**
 * Identidades conhecidas do projeto e checagem de lease ativo.
 *
 * `computeInsights` usa `store.exportProjectBundleData(projectId)` como fonte
 * principal porque é a única leitura pública que devolve o projeto inteiro de
 * uma vez — inclusive passagens, recibos de leitura e resoluções de mensagem,
 * que os métodos `getInbox`/`getHandoffDeliveries` só respondem por
 * destinatário (são a caixa de entrada de alguém, não uma lista geral). Com o
 * pacote completo em mãos, o conjunto de identidades é só a união de quem
 * apareceu em qualquer papel — sem precisar adivinhar quem perguntar.
 */
import type { ProjectDetail } from '../../shared/types.js'
import type { Task } from '../../shared/types.js'
import type { Decision, ProjectBlocker } from '../../shared/continuity.js'
import type { PortableHandoffDelivery } from '../../shared/portability.js'

const BROADCAST = '*'

export function collectKnownIdentities(
  detail: ProjectDetail,
  blockers: ProjectBlocker[],
  decisions: Decision[],
  deliveries: PortableHandoffDelivery[],
): string[] {
  const ids = new Set<string>()
  for (const checkpoint of detail.checkpoints) ids.add(checkpoint.agent)
  for (const task of detail.tasks) if (task.assignee) ids.add(task.assignee)
  for (const message of detail.messages) {
    ids.add(message.from)
    if (message.to !== BROADCAST) ids.add(message.to)
  }
  for (const blocker of blockers) {
    ids.add(blocker.openedBy)
    if (blocker.assignee) ids.add(blocker.assignee)
    if (blocker.resolvedBy) ids.add(blocker.resolvedBy)
  }
  for (const decision of decisions) {
    ids.add(decision.proposedBy)
    if (decision.acceptedBy) ids.add(decision.acceptedBy)
    if (decision.revokedBy) ids.add(decision.revokedBy)
  }
  for (const delivery of deliveries) {
    ids.add(delivery.from)
    if (delivery.to !== BROADCAST) ids.add(delivery.to)
  }
  ids.delete(BROADCAST)
  ids.delete('')
  return Array.from(ids).sort()
}

/** Uma tarefa tem lease ativo (reserva em vigor) neste instante? */
export function hasActiveLease(task: Task, now: Date): boolean {
  if (!task.assignee || !task.leaseUntil) return false
  return Date.parse(task.leaseUntil) > now.getTime()
}
