import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { GrupoFalta } from '../../shared/carta';
import { duracaoDaChegada, rolagemParaUmTerco } from '../chegada/chegada';
import { movimentoReduzido } from '../chegada/irPara';

/** Para onde um clique leva: uma linha de "O que foi feito" ou um grupo de "O que falta". */
export type Destino = { tipo: 'coisa'; chave: string } | { tipo: 'grupo'; grupo: GrupoFalta };

function elementoDoDestino(raiz: HTMLElement, destino: Destino): HTMLElement | null {
  const seletor = destino.tipo === 'coisa' ? `[data-linha="${CSS.escape(destino.chave)}"]` : `.carta-grupo[data-grupo="${destino.grupo}"]`;
  return raiz.querySelector<HTMLElement>(seletor);
}

/** Leva a tela até o elemento: a página até a coluna e a coluna até o destino; sem rolagem interna, só a página. */
function rolarAte(elemento: HTMLElement, tipo: Destino['tipo']) {
  const suave: ScrollBehavior = movimentoReduzido() ? 'auto' : 'smooth';
  const coluna = elemento.closest<HTMLElement>('.coluna-rolagem');
  const rolaPorDentro = coluna !== null && coluna.scrollHeight - coluna.clientHeight > 1;
  if (!coluna || !rolaPorDentro) {
    elemento.scrollIntoView({ block: tipo === 'coisa' ? 'center' : 'start', behavior: suave });
    return;
  }
  coluna.closest('.carta-coluna')?.scrollIntoView({ block: 'start', behavior: suave });
  const medidas = { topoDoDestino: elemento.getBoundingClientRect().top, topoDaColuna: coluna.getBoundingClientRect().top, rolagemAtual: coluna.scrollTop, alturaDaColuna: coluna.clientHeight };
  // O grupo vai para o topo da coluna; a linha fica a um terço da altura, com o que veio antes à vista.
  const topo = tipo === 'grupo' ? Math.max(0, medidas.topoDoDestino - medidas.topoDaColuna + medidas.rolagemAtual) : rolagemParaUmTerco(medidas);
  coluna.scrollTo({ top: topo, behavior: suave });
}

/**
 * Destaque de chegada: todo clique que leva a outro ponto da tela rola até o destino, passa o foco para ele
 * e o deixa aceso por um instante. `chegou` é o destino aceso agora; quem desenha põe a classe.
 */
export function useChegada(raiz: RefObject<HTMLElement | null>) {
  const [pedido, setPedido] = useState<{ destino: Destino; vez: number } | null>(null);
  const [chegou, setChegou] = useState<Destino | null>(null);

  useEffect(() => {
    if (!pedido || !raiz.current) return;
    const elemento = elementoDoDestino(raiz.current, pedido.destino);
    if (!elemento) return;
    rolarAte(elemento, pedido.destino.tipo);
    elemento.focus({ preventScroll: true });
    setChegou(pedido.destino);
    const fim = window.setTimeout(() => setChegou(null), duracaoDaChegada(movimentoReduzido()));
    return () => window.clearTimeout(fim);
  }, [pedido, raiz]);

  /** Chame depois de abrir o que esconde o destino: a rolagem acontece quando a tela já redesenhou. */
  const irPara = useCallback((destino: Destino) => setPedido(anterior => ({ destino, vez: (anterior?.vez ?? 0) + 1 })), []);
  return { chegou, irPara };
}
