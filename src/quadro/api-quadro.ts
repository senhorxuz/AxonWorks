import type {
  BoardCard,
  BoardCardEvent,
  BoardSnapshot,
  CreateBoardCardInput,
  DeleteBoardCardInput,
  MoveBoardCardInput,
  UpdateBoardCardInput,
} from '../../shared/board';
import { request } from '../api';

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/board`;

export const apiQuadro = {
  quadro: (projectId: string, signal?: AbortSignal) => request<BoardSnapshot>(base(projectId), undefined, signal, 'GET'),
  historico: (projectId: string, cardId: string, signal?: AbortSignal) =>
    request<BoardCardEvent[]>(`${base(projectId)}/cards/${encodeURIComponent(cardId)}/events`, undefined, signal, 'GET'),
  criar: (projectId: string, input: CreateBoardCardInput) => request<BoardCard>(`${base(projectId)}/cards`, input),
  atualizar: (projectId: string, cardId: string, input: UpdateBoardCardInput) =>
    request<BoardCard>(`${base(projectId)}/cards/${encodeURIComponent(cardId)}/update`, input),
  mover: (projectId: string, cardId: string, input: MoveBoardCardInput) =>
    request<BoardCard>(`${base(projectId)}/cards/${encodeURIComponent(cardId)}/move`, input),
  excluir: (projectId: string, cardId: string, input: DeleteBoardCardInput) =>
    request<{ cardId: string }>(`${base(projectId)}/cards/${encodeURIComponent(cardId)}/delete`, input),
};

const CHAVE_NOME_DONO = 'axon-nome-do-dono';

/** Quem assina as mudanças feitas pela tela: o nome do dono salvo neste computador. */
export function nomeDoDono(): string {
  try {
    return localStorage.getItem(CHAVE_NOME_DONO)?.trim() || 'Dono do projeto';
  } catch {
    return 'Dono do projeto';
  }
}
