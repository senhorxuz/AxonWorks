/** Teclado do fio: de um símbolo, qual é o próximo. Só os símbolos (casas com `coisa`) entram na conta. */
import type { Casa } from './tecer';

export type TeclaDoFio = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/** O símbolo mais próximo em coluna, num dos trilhos para cima ou para baixo (o primeiro que tenha símbolo). Empate: o mais antigo. */
function noTrilhoVizinho(casas: Casa[], indices: number[], atual: number, passo: 1 | -1): number {
  const origem = casas[atual]!;
  const alem = (i: number) => (casas[i]!.trilho - origem.trilho) * passo;
  const candidatos = indices.filter(i => alem(i) > 0);
  if (candidatos.length === 0) return atual;
  const primeiroTrilho = Math.min(...candidatos.map(alem));
  const distancia = (i: number) => Math.abs(casas[i]!.col - origem.col);
  return candidatos.filter(i => alem(i) === primeiroTrilho).reduce((melhor, i) => (distancia(i) < distancia(melhor) ? i : melhor));
}

/** Índice (em `casas`) do símbolo para onde a tecla leva; `atual` quando não há para onde ir. */
export function vizinho(casas: Casa[], atual: number, tecla: TeclaDoFio): number {
  const indices = casas
    .map((casa, i) => (casa.coisa ? i : -1))
    .filter(i => i >= 0)
    .sort((a, b) => casas[a]!.col - casas[b]!.col);
  const posicao = indices.indexOf(atual);
  if (posicao < 0) return atual;
  switch (tecla) {
    case 'ArrowLeft': return indices[Math.max(0, posicao - 1)]!;
    case 'ArrowRight': return indices[Math.min(indices.length - 1, posicao + 1)]!;
    case 'Home': return indices[0]!;
    case 'End': return indices.at(-1)!;
    case 'ArrowUp': return noTrilhoVizinho(casas, indices, atual, -1);
    case 'ArrowDown': return noTrilhoVizinho(casas, indices, atual, 1);
  }
}
