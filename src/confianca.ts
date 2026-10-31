import type { EvidenceView } from '../shared/evidence';

/**
 * Selo de confiança de uma entrega, a partir das evidências do checkpoint que a concluiu.
 * Vale a afirmação mais forte presente: arquivos conferidos pelo sistema, depois
 * conferência de outra IA, depois o relato da própria IA.
 */
export type Confianca = { rotulo: string; tom: 'sistema' | 'ia' | 'relato' | 'sem-evidencia' };

export function nivelDeConfianca(evidencias: EvidenceView[]): Confianca {
  if (evidencias.length === 0) return { rotulo: 'Sem evidência registrada', tom: 'sem-evidencia' };
  if (evidencias.some(e => e.assertions?.includes('artifact_bound'))) return { rotulo: 'Arquivos conferidos pelo sistema', tom: 'sistema' };
  if (evidencias.some(e => e.assertions?.includes('cross_checked'))) return { rotulo: 'Conferido por outra IA', tom: 'ia' };
  return { rotulo: 'Informado pela IA', tom: 'relato' };
}
