import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { estadoDoPe, textoDoPe, type EstadoDoPe } from './chegada';

/**
 * O corpo de uma coluna de "Onde paramos": rola por dentro (na tela larga) e avisa, no pé, se ainda há mais
 * embaixo ("Role para ver o resto") ou se a lista acabou ("Fim da lista"). Coluna que cabe inteira não diz nada.
 * A medida se refaz quando a coluna ou o conteúdo mudam de tamanho.
 */
export function Rolagem({ children, rotulo }: { children: ReactNode; rotulo: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const miolo = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<EstadoDoPe>('cabe');
  const medir = useCallback(() => {
    const elemento = caixa.current;
    if (elemento) setEstado(estadoDoPe({ conteudo: elemento.scrollHeight, visivel: elemento.clientHeight, rolagem: elemento.scrollTop }));
  }, []);

  useEffect(() => {
    medir();
    const vigia = new ResizeObserver(medir);
    if (caixa.current) vigia.observe(caixa.current);
    if (miolo.current) vigia.observe(miolo.current);
    return () => vigia.disconnect();
  }, [medir]);

  return (
    <>
      <div ref={caixa} className={`coluna-rolagem coluna-${estado}`} onScroll={medir} {...(estado === 'cabe' ? {} : { tabIndex: 0, role: 'region', 'aria-label': rotulo })}>
        <div ref={miolo}>{children}</div>
      </div>
      <p className="coluna-pe" aria-hidden="true">{textoDoPe(estado)}</p>
    </>
  );
}
