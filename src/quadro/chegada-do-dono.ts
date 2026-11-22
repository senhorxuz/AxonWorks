import type { BoardCard } from '../../shared/board';
import { chaveDaChegada } from '../chegada/chegada';

/** Chave de chegada da coluna de um cartão novo no Quadro (o `data-chegada` da coluna). */
export const chaveDaColuna = (coluna: string) => `quadro-coluna:${coluna}`;

const ENCERRADAS = new Set(['done', 'discarded']);

/**
 * Para onde "Ver no Quadro" leva o dono: o primeiro cartão marcado "depende de você" que ainda está em jogo.
 * Se não houver nenhum à vista (a lista mudou no meio do caminho), a coluna Pendente, que é onde o trabalho entra.
 */
export function chaveDoQueEsperaODono(cartoes: readonly Pick<BoardCard, 'id' | 'column' | 'needsOwner'>[]): string {
  const cartao = cartoes.find(c => c.needsOwner && !ENCERRADAS.has(c.column));
  return cartao ? chaveDaChegada('cartao', cartao.id) : chaveDaColuna('pending');
}
