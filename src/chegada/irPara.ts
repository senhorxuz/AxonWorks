import { PRAZO_DA_ESPERA_MS, blocoDaChegada, duracaoDaChegada, seletorDaChegada } from './chegada';

/** Classe do destaque: a mesma em toda a Axon (animação em ./chegada.css). */
export const CLASSE_DA_CHEGADA = 'axon-chegou';

export const movimentoReduzido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface PedidoDeChegada {
  /** Nome do destino: o elemento com `data-chegada="<chave>"`. */
  chave: string;
  /** Quem recebe o foco, se não for o próprio destino (ex.: o primeiro botão "Aprovar" dentro do bloco). */
  foco?: string;
  /** Só rola e acende, sem tirar o foco de onde está (ex.: o dono segue digitando no campo do cartão novo). */
  semFoco?: boolean;
  /** Outros destinos que acendem junto (ex.: o item da barra lateral). */
  tambem?: string[];
}

const acesos = new WeakMap<HTMLElement, number>();

const procurar = (chave: string) => {
  const elemento = document.querySelector<HTMLElement>(seletorDaChegada(chave));
  return elemento && elemento.getClientRects().length > 0 ? elemento : null;
};

/** O destino acende; se já estava aceso, recomeça a animação. O atributo `data-chegou` segura o brilho se o React trocar a classe no meio. */
export function acender(elemento: HTMLElement) {
  window.clearTimeout(acesos.get(elemento));
  elemento.classList.remove(CLASSE_DA_CHEGADA);
  elemento.removeAttribute('data-chegou');
  void elemento.offsetWidth;
  elemento.classList.add(CLASSE_DA_CHEGADA);
  elemento.setAttribute('data-chegou', '');
  acesos.set(elemento, window.setTimeout(() => {
    elemento.classList.remove(CLASSE_DA_CHEGADA);
    elemento.removeAttribute('data-chegou');
  }, duracaoDaChegada(movimentoReduzido())));
}

/** Quadros do navegador que a tela espera pelo foco: um elemento ainda escondido pela animação de entrada da página não aceita foco. */
const QUADROS_PARA_FOCAR = 30;

function focar(elemento: HTMLElement, restantes = QUADROS_PARA_FOCAR) {
  if (!elemento.hasAttribute('tabindex') && !elemento.matches('a[href], button, input, select, textarea, summary')) elemento.tabIndex = -1;
  elemento.focus({ preventScroll: true });
  if (document.activeElement !== elemento && restantes > 0 && elemento.isConnected) window.requestAnimationFrame(() => focar(elemento, restantes - 1));
}

function chegarEm(destino: HTMLElement, pedido: PedidoDeChegada) {
  const block = blocoDaChegada(destino.getBoundingClientRect().height, window.innerHeight);
  destino.scrollIntoView({ block, inline: 'nearest', behavior: movimentoReduzido() ? 'auto' : 'smooth' });
  if (!pedido.semFoco) focar(pedido.foco ? destino.querySelector<HTMLElement>(pedido.foco) ?? destino : destino);
  acender(destino);
  for (const chave of pedido.tambem ?? []) {
    const outro = procurar(chave);
    if (outro) acender(outro);
  }
}

/**
 * Todo clique que leva a outro ponto da tela chama isto: espera o destino aparecer (a aba que abre, a lista que
 * carrega), rola até ele nos dois eixos, passa o foco e o acende. Se ele não aparecer em 4 s, desiste sem barulho.
 * Devolve a função que cancela a espera.
 */
export function irPara(pedido: PedidoDeChegada): () => void {
  const achado = procurar(pedido.chave);
  if (achado) { chegarEm(achado, pedido); return () => {}; }
  const olho = new MutationObserver(() => {
    const destino = procurar(pedido.chave);
    if (!destino) return;
    cancelar();
    chegarEm(destino, pedido);
  });
  const limite = window.setTimeout(() => cancelar(), PRAZO_DA_ESPERA_MS);
  function cancelar() {
    olho.disconnect();
    window.clearTimeout(limite);
  }
  olho.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class', 'style'] });
  return cancelar;
}
