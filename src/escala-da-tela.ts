/**
 * Escala da tela — converte medidas do ponteiro em medidas de estilo.
 *
 * Em monitores grandes a página inteira é ampliada com CSS zoom (src/tela-grande.css).
 * O ponteiro (clientX/clientY) e o getBoundingClientRect medem em pixels da tela;
 * um estilo escrito pelo código (transform, width, altura) é pixel CSS, que a ampliação
 * multiplica. Sem esta conversão, o que segue o ponteiro escorrega para longe dele.
 */

/** A ampliação aplicada ao elemento; 1 quando o navegador não informa ou o valor não faz sentido. */
export function escalaDoElemento(elemento: { currentCSSZoom?: number } | null | undefined): number {
  const valor = elemento?.currentCSSZoom;
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : 1;
}

/** Medida em pixels da tela convertida em pixels CSS para um elemento com essa ampliação. */
export function paraPixelsCss(pixelsDaTela: number, escala: number): number {
  return pixelsDaTela / escala;
}
