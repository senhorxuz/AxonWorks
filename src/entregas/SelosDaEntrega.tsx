import type { EstadoDaEntrega } from '../../shared/entrega';
import { selosDaEntrega } from './texto';
import './entregas.css';

export function SelosDaEntrega({ entrega, id }: { entrega: EstadoDaEntrega; id?: string }) {
  return (
    <span className="entrega-selos" id={id}>
      {selosDaEntrega(entrega).map(selo => (
        <span className="entrega-selo" data-tom={selo.tom} key={selo.chave}>{selo.texto}</span>
      ))}
    </span>
  );
}
