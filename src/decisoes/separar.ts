import type { Decision } from '../../shared/continuity';

/**
 * Propostas abertas pedem o dono e ficam sempre à vista. "Histórico" é só o que já saiu de cena
 * (revogadas e substituídas); esconder uma proposta atrás de um botão de histórico era o defeito.
 */
export function separarDecisoes(decisoes: readonly Decision[]): { abertas: Decision[]; vigentes: Decision[]; historico: Decision[] } {
  return {
    abertas: decisoes.filter(d => d.status === 'proposed'),
    vigentes: decisoes.filter(d => d.status === 'accepted'),
    historico: decisoes.filter(d => d.status === 'revoked' || d.status === 'superseded'),
  };
}

export function rotuloDoHistorico(aberto: boolean, quantidade: number): string {
  return aberto ? 'Esconder histórico' : `Mostrar histórico (${quantidade})`;
}
