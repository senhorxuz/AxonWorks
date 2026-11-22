import type { ResumoDaEntrega } from '../../shared/entrega';
import { resumoParaODono } from './texto';
import './entregas.css';

export function EntregasEmAndamento({ entregas }: { entregas?: ResumoDaEntrega[] }) {
  return (
    <section className="carta-bloco entrega-resumo" aria-labelledby="entrega-resumo-titulo">
      <h3 id="entrega-resumo-titulo">Entregas em andamento</h3>
      {entregas?.length ? (
        <ul className="entrega-resumo-lista">
          {entregas.map(entrega => (
            <li className="entrega-resumo-item" key={entrega.cardId}>
              <strong>{entrega.titulo}</strong>
              <p>{resumoParaODono(entrega.resumo)}</p>
            </li>
          ))}
        </ul>
      ) : <p className="carta-vazio">Nenhuma entrega em andamento.</p>}
    </section>
  );
}
