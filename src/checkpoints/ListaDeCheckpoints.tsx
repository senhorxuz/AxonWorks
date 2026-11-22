import { useState } from 'react';
import type { Checkpoint, EvidenceView } from '../../shared/types';
import { diaDe } from '../fio/coisas';
import { CartaoDeCheckpoint } from './CartaoDeCheckpoint';
import { PASSO_DO_VER_MAIS, TOTAL_INICIAL, agruparPorDia, rotuloDoDia, rotuloDoVerMais } from './agrupar';

/** Os checkpoints agrupados por dia: os 10 mais recentes, e "Ver mais" soma outros 10. */
export function ListaDeCheckpoints({ checkpoints, agent, evidenceViews, onCrossCheck, onDeliver, onApagado }: {
  checkpoints: Checkpoint[];
  agent: string;
  evidenceViews: EvidenceView[];
  onCrossCheck: (evidence: EvidenceView) => void;
  onDeliver: (checkpoint: Checkpoint) => void;
  onApagado: () => Promise<void>;
}) {
  const [limite, setLimite] = useState(TOTAL_INICIAL);
  const { grupos, restantes } = agruparPorDia(checkpoints, limite);
  const hoje = diaDe(new Date().toISOString());
  return <div className="checkpoints-lista">
    {grupos.map(grupo => <section key={`${grupo.dia}-${grupo.itens[0]!.id}`} className="checkpoints-dia" aria-label={rotuloDoDia(grupo.dia, hoje)}>
      <h3 className="checkpoints-dia-titulo">{rotuloDoDia(grupo.dia, hoje)}<span>{grupo.itens.length}</span></h3>
      {grupo.itens.map(cp => <CartaoDeCheckpoint key={cp.id} checkpoint={cp} agent={agent} evidenceViews={evidenceViews} onCrossCheck={onCrossCheck} onDeliver={onDeliver} onApagado={onApagado} />)}
    </section>)}
    {restantes > 0 && <button type="button" className="button secondary checkpoints-ver-mais" onClick={() => setLimite(valor => valor + PASSO_DO_VER_MAIS)}>{rotuloDoVerMais(restantes)}</button>}
  </div>;
}
