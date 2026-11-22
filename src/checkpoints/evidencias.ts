import type { Checkpoint, EvidenceView } from '../../shared/types';

/**
 * As evidências de um registro: as que o servidor já ligou a ele (`checkpointId`) ou, na falta delas, as que o
 * próprio registro declarou. Nunca as de outro registro: o desvio antigo, que mostrava todas as evidências do
 * projeto em cada registro sem evidência, é o que inchava a página.
 */
export function evidenciasDoRegistro(cp: Checkpoint, evidenceViews: readonly EvidenceView[]): EvidenceView[] {
  const doRegistro = evidenceViews.filter(v => v.checkpointId === cp.id);
  if (doRegistro.length > 0) return doRegistro;
  return cp.evidence.map((e, i) => {
    const found = evidenceViews.find(v => v.command === e.command || v.position === i);
    return found || {
      id: `ev-${cp.id}-${i}`,
      projectId: cp.projectId,
      checkpointId: cp.id,
      position: i,
      command: e.command,
      outcome: e.outcome,
      details: e.details,
      reportedBy: cp.agent,
      provenance: 'agent_report' as const,
      createdAt: cp.createdAt,
      assertions: ['agent_reported' as const],
      freshness: 'no_artifacts' as const,
      explanation: '',
      artifacts: [],
      verifications: [],
    };
  });
}

export function rotuloDoDetalhe(aberto: boolean, evidencias: number): string {
  if (aberto) return 'Ocultar detalhes';
  return evidencias > 0 ? `Ver detalhes e evidências (${evidencias})` : 'Ver detalhes';
}
