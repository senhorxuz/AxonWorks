import { useEffect, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { passoDaRolagem, podeRolar } from './rolagem';

type Medida = { esquerda: boolean; direita: boolean; topo: number; altura: number };

/** Degradê e setas nas bordas do trilho de colunas: mostram que há mais colunas fora da tela. */
export function SetasDoTrilho({ trilho, ativo }: { trilho: RefObject<HTMLDivElement | null>; ativo: boolean }) {
  const [medida, setMedida] = useState<Medida>({ esquerda: false, direita: false, topo: 0, altura: 0 });
  useEffect(() => {
    const elemento = trilho.current;
    if (!ativo || !elemento) return;
    const medir = () => setMedida({ ...podeRolar(elemento.scrollLeft, elemento.clientWidth, elemento.scrollWidth), topo: elemento.offsetTop, altura: elemento.clientHeight });
    medir();
    elemento.addEventListener('scroll', medir, { passive: true });
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    const mudancas = new MutationObserver(medir);
    mudancas.observe(elemento, { childList: true });
    window.addEventListener('resize', medir);
    return () => { elemento.removeEventListener('scroll', medir); observador.disconnect(); mudancas.disconnect(); window.removeEventListener('resize', medir); };
  }, [trilho, ativo]);
  if (!ativo) return null;
  const rolar = (direcao: 'esquerda' | 'direita') => trilho.current?.scrollBy({ left: passoDaRolagem(trilho.current.clientWidth, direcao), behavior: 'smooth' });
  return (
    <div className="quadro-setas" style={{ top: medida.topo, height: medida.altura }}>
      {medida.esquerda && <><span className="quadro-borda quadro-borda-esq" aria-hidden="true" /><button type="button" className="quadro-seta quadro-seta-esq" aria-label="Ver colunas à esquerda" title="Ver colunas à esquerda" onClick={() => rolar('esquerda')}><ChevronLeft size={18} /></button></>}
      {medida.direita && <><span className="quadro-borda quadro-borda-dir" aria-hidden="true" /><button type="button" className="quadro-seta quadro-seta-dir" aria-label="Ver mais colunas à direita" title="Ver mais colunas à direita" onClick={() => rolar('direita')}><ChevronRight size={18} /></button></>}
    </div>
  );
}
