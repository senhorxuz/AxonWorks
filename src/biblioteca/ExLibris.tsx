import { useMemo, type CSSProperties } from 'react';
import { guilloche } from './arte';
import './biblioteca.css';

type Estilo = CSSProperties & Record<`--${string}`, string | number>;

/**
 * O ex-libris: o emblema único de cada documento, em guilhoché (as curvas das notas de dinheiro e dos
 * certificados antigos). A regra das curvas mora em ./arte.ts; a cor vem do tipo do documento.
 */
export function ExLibris({ semente, tamanho, tom }: { semente: string; tamanho: number; tom: string }) {
  const raio = 40;
  const { camadas } = useMemo(() => guilloche(semente, raio), [semente]);
  return (
    <svg className="ex-libris" viewBox={`0 0 ${raio * 2} ${raio * 2}`} width={tamanho} height={tamanho} aria-hidden="true" style={{ '--tom': tom } as Estilo}>
      {camadas.map((d, i) => <path key={i} d={d} className={`ex-libris-camada ex-libris-${i}`} />)}
    </svg>
  );
}
