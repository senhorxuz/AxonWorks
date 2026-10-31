import type { StalledTask } from '../shared/insights';
import { AlertTriangle } from 'lucide-react';
import './copiar-e-selos.css';

/**
 * Parte 6 (tela) — selo de IA sumida, em cada cartão de tarefa.
 * Recebe tudo por propriedade: NÃO busque insights aqui dentro.
 * Para apagar esta parte: remova este arquivo, a propriedade `stalled` de
 * TaskItem e a montagem <SeloIASumida> em src/Workspace.tsx.
 */
export function SeloIASumida(props: { stalled: StalledTask | undefined }) {
  const { stalled } = props;
  if (!stalled) return null;

  const texto = stalled.assignee
    ? `Parada: sem checkpoint de ${stalled.assignee}`
    : 'Parada: sem checkpoint';

  return (
    <div
      className="selo-ia-sumida"
      tabIndex={0}
      role="status"
      aria-label={`${texto}. ${stalled.reason}`}
    >
      <AlertTriangle size={12} className="selo-ia-sumida-icone" aria-hidden="true" />
      <span className="selo-ia-sumida-texto">{texto}</span>
      <span className="selo-ia-sumida-motivo" role="tooltip">
        {stalled.reason}
      </span>
    </div>
  );
}
