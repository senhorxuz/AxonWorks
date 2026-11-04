/**
 * Toque — a luz que segue o mouse nos botões e a onda que nasce no ponto do clique.
 *
 * A regra: qual elemento reage e onde o ponteiro está dentro dele. A ligação com a página mora
 * em ./instalar-toque.ts; o desenho, em ./brasa.css.
 */
import { paraPixelsCss } from './escala-da-tela';

export const SELETOR_DO_TOQUE = '.button, .icon-button, .text-button, .connector-tab-btn, .snippet-copy-btn';

/** Ponto do ponteiro dentro da caixa do elemento, em pixels CSS inteiros. */
export function pontoNoElemento(clientX: number, clientY: number, caixa: { left: number; top: number }, escala: number): { x: number; y: number } {
  return {
    x: Math.round(paraPixelsCss(clientX - caixa.left, escala)),
    y: Math.round(paraPixelsCss(clientY - caixa.top, escala)),
  };
}
