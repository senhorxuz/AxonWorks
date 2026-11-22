/** Regras puras da rolagem lateral do trilho de colunas do Quadro (sem DOM). */

/** Há o que ver à esquerda ou à direita? Folga de 2 px para arredondamento de telas ampliadas. */
export function podeRolar(posicao: number, largura: number, total: number): { esquerda: boolean; direita: boolean } {
  const folga = 2;
  return { esquerda: posicao > folga, direita: posicao + largura < total - folga };
}

/** Quanto rolar por clique na seta: 70% da largura visível, para a última coluna vista continuar na tela. */
export function passoDaRolagem(largura: number, direcao: 'esquerda' | 'direita'): number {
  const passo = Math.round(largura * 0.7);
  return direcao === 'esquerda' ? -passo : passo;
}
