/**
 * Quadro (Parte 14): cartões livres do projeto, organizados em colunas de etapa.
 *
 * - O dono e as IAs criam, editam e movem cartões.
 * - Excluir um cartão de vez é só do dono, pela tela (HTTP). O MCP nunca oferece isso.
 * - Regra de linguagem: título curto ou médio (até 80 caracteres), em português simples.
 *   A descrição pode explicar mais, sem jargão.
 * - Todo movimento e edição fica num histórico que só cresce.
 *
 * Este arquivo é o contrato entre servidor, MCP e tela. Não mude sem combinar.
 */

export const BOARD_COLUMNS = [
  { id: 'ideas', name: 'Ideias', meaning: 'Ainda não foi decidido' },
  { id: 'pending', name: 'Pendente', meaning: 'Decidido, ninguém começou' },
  { id: 'in_progress', name: 'Em andamento', meaning: 'Alguém está fazendo agora' },
  { id: 'unfinished', name: 'Inacabado', meaning: 'Começou e parou no meio' },
  { id: 'testing', name: 'Em teste', meaning: 'Pronto, sendo conferido' },
  { id: 'awaiting_deploy', name: 'Testado, falta deploy', meaning: 'Funciona, falta publicar' },
  { id: 'done', name: 'Completo', meaning: 'Publicado e encerrado' },
  { id: 'blocked', name: 'Bloqueado', meaning: 'Depende de algo de fora' },
  { id: 'discarded', name: 'Descartado', meaning: 'Decidiu-se não fazer' },
] as const

export type BoardColumnId = (typeof BOARD_COLUMNS)[number]['id']

export const BOARD_LABELS = [
  { id: 'bug', name: 'Bug' },
  { id: 'improvement', name: 'Melhoria' },
  { id: 'feature', name: 'Nova função' },
  { id: 'design', name: 'Design' },
  { id: 'content', name: 'Conteúdo' },
  { id: 'test', name: 'Teste' },
  { id: 'infra', name: 'Infraestrutura' },
] as const

export type BoardLabelId = (typeof BOARD_LABELS)[number]['id']

export type BoardPriority = 'urgent' | 'high' | 'medium' | 'low'

export const BOARD_LIMITS = {
  titleMin: 3,
  titleMax: 80,
  descriptionMax: 4000,
  labelsMax: 4,
  checklistMax: 40,
  checklistItemMax: 160,
} as const

export interface BoardChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface BoardCard {
  id: string
  projectId: string
  column: BoardColumnId
  /** Ordem dentro da coluna: menor vem primeiro. Valor interno; a tela usa só a ordem. */
  position: number
  title: string
  /** Texto livre; string vazia quando não há. */
  description: string
  labels: BoardLabelId[]
  priority: BoardPriority | null
  checklist: BoardChecklistItem[]
  /** O cartão espera uma decisão ou uma ação do dono ("depende de você"). */
  needsOwner: boolean
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
  version: number
}

export type BoardCardEventKind = 'created' | 'updated' | 'moved' | 'deleted'

export interface BoardCardEvent {
  id: string
  projectId: string
  cardId: string
  kind: BoardCardEventKind
  actor: string
  fromColumn: BoardColumnId | null
  toColumn: BoardColumnId | null
  /** Frase pronta em português simples, escrita pelo servidor. Ex.: "Moveu de Pendente para Em andamento". */
  summary: string
  createdAt: string
}

export interface BoardSnapshot {
  projectId: string
  /** Na ordem das colunas de BOARD_COLUMNS e, dentro de cada coluna, por position. */
  cards: BoardCard[]
}

export interface CreateBoardCardInput {
  actor: string
  title: string
  description?: string
  /** Padrão: 'pending'. O cartão entra no fim da coluna. */
  column?: BoardColumnId
  labels?: BoardLabelId[]
  priority?: BoardPriority | null
  checklist?: Array<{ text: string; done?: boolean }>
  /** Padrão: false. */
  needsOwner?: boolean
}

export interface UpdateBoardCardInput {
  actor: string
  expectedVersion: number
  title?: string
  description?: string
  labels?: BoardLabelId[]
  priority?: BoardPriority | null
  /**
   * Substitui a lista inteira. Um item com `id` que já existe no cartão mantém o id;
   * item sem id (ou com id desconhecido) ganha id novo.
   */
  checklist?: Array<{ id?: string; text: string; done: boolean }>
  /** Ausente: mantém a marca atual. */
  needsOwner?: boolean
}

export interface MoveBoardCardInput {
  actor: string
  expectedVersion: number
  column: BoardColumnId
  /** Coloca o cartão logo antes deste. Ausente ou null: fim da coluna. */
  beforeCardId?: string | null
}

/** Só pela tela (HTTP). Nunca registrado no MCP. */
export interface DeleteBoardCardInput {
  actor: string
  expectedVersion: number
}
