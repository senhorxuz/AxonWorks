// Próximo trabalho pronto (lote 2, D3): o que dá para começar agora. Puro.
// Entra: cartão em Pendente sem "depende de você" e tarefa a fazer com todas as dependências prontas e
// sem bloqueio aberto. Fica de fora tudo que espera o dono ou está travado. Ordem: prioridade (urgente,
// alta, média, baixa, sem prioridade) e, no empate, o mais antigo primeiro.
import type { BoardCard, BoardPriority } from '../../shared/board.js'
import type { ItemFalta } from '../../shared/carta.js'
import type { ProjectBlocker } from '../../shared/continuity.js'
import type { Task } from '../../shared/types.js'

export const PROXIMO_PRONTO_MAXIMO = 5

const PESO_DA_PRIORIDADE: Record<BoardPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
/** Sem prioridade vem depois de "baixa". */
const SEM_PRIORIDADE = 4

/** Mitigado ainda é aberto no resto do produto (ver `montar.ts`). */
const BLOQUEIO_EM_ABERTO: ReadonlySet<ProjectBlocker['status']> = new Set(['open', 'mitigated'])

interface Candidato {
  item: ItemFalta
  prioridade: BoardPriority | null | undefined
  criadoEm: string
}

function candidatoDoCartao(card: BoardCard): Candidato {
  const item: ItemFalta = { origem: 'cartao', id: card.id, titulo: card.title, detalhe: card.description || null, etapa: 'Pendente', versao: card.version }
  return { item, prioridade: card.priority, criadoEm: card.createdAt }
}

function candidatoDaTarefa(task: Task): Candidato {
  const item: ItemFalta = { origem: 'tarefa', id: task.id, titulo: task.title, detalhe: task.description || null, etapa: null, versao: task.version }
  return { item, prioridade: task.priority, criadoEm: task.createdAt }
}

function tarefasProntas(tasks: Task[], blockers: ProjectBlocker[]): Task[] {
  const feitas = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id))
  const bloqueadas = new Set(blockers.filter((b) => BLOQUEIO_EM_ABERTO.has(b.status)).map((b) => b.taskId))
  return tasks.filter(
    (t) => t.status === 'todo' && !bloqueadas.has(t.id) && (t.dependencyTaskIds ?? []).every((id) => feitas.has(id)),
  )
}

const peso = (c: Candidato): number => (c.prioridade ? PESO_DA_PRIORIDADE[c.prioridade] : SEM_PRIORIDADE)

export function proximoPronto(dados: { cards: BoardCard[]; tasks: Task[]; blockers: ProjectBlocker[] }): ItemFalta[] {
  const candidatos = [
    ...dados.cards.filter((card) => card.column === 'pending' && !card.needsOwner).map(candidatoDoCartao),
    ...tarefasProntas(dados.tasks, dados.blockers).map(candidatoDaTarefa),
  ]
  return candidatos
    .sort((a, b) => peso(a) - peso(b) || Date.parse(a.criadoEm) - Date.parse(b.criadoEm))
    .slice(0, PROXIMO_PRONTO_MAXIMO)
    .map((c) => c.item)
}
