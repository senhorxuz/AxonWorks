import type { Checkpoint } from '../../shared/types';
import { diaDe, diasEntre } from '../fio/coisas';
import { diaEMes } from '../fio/datas';

/** A aba Checkpoints abre com os 10 mais recentes; cada "Ver mais" soma outros 10. */
export const TOTAL_INICIAL = 10;
export const PASSO_DO_VER_MAIS = 10;

export interface GrupoDoDia { dia: string; itens: Checkpoint[] }

/**
 * Os `limite` primeiros checkpoints (já do mais novo para o mais velho), agrupados por dia no fuso do
 * dono. `dia` vazio é o grupo das datas ilegíveis. Um dia pode ser cortado no meio: o resto vem no "Ver mais".
 */
export function agruparPorDia(checkpoints: readonly Checkpoint[], limite: number): { grupos: GrupoDoDia[]; mostrados: number; restantes: number } {
  const visiveis = checkpoints.slice(0, Math.max(0, limite));
  const grupos: GrupoDoDia[] = [];
  for (const checkpoint of visiveis) {
    const dia = diaDe(checkpoint.createdAt);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.dia === dia) ultimo.itens.push(checkpoint);
    else grupos.push({ dia, itens: [checkpoint] });
  }
  return { grupos, mostrados: visiveis.length, restantes: checkpoints.length - visiveis.length };
}

/** "Hoje, 22 nov", "Ontem, 21 nov", "20 nov". `hoje` e `dia` são 'AAAA-MM-DD' no fuso do dono. */
export function rotuloDoDia(dia: string, hoje: string): string {
  if (dia === '') return 'Sem data';
  const curto = diaEMes(dia);
  const atras = diasEntre(dia, hoje);
  if (atras === 0) return `Hoje, ${curto}`;
  return atras === 1 ? `Ontem, ${curto}` : curto;
}

export function rotuloDoVerMais(restantes: number): string {
  if (restantes === 1) return 'Ver o último (falta 1)';
  return `Ver mais ${Math.min(PASSO_DO_VER_MAIS, restantes)} (faltam ${restantes})`;
}
