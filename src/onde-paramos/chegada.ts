/**
 * Destaque de chegada e rolagem das colunas de "Onde paramos": as contas, sem tela.
 *
 * Regra do dono (22/11/2026): todo clique que leva a outro ponto da tela destaca o destino.
 * Quem rola e acende de verdade é ./useChegada.ts; aqui ficam os números e as decisões.
 */
import type { DiaDoFeito, MesDoFeito } from './dias';

/** O destino fica destacado por 2,2 s; com movimento reduzido, um contorno parado por 2 s. */
export const DURACAO_DA_CHEGADA_MS = 2200;
export const DURACAO_SEM_MOVIMENTO_MS = 2000;
/** Diferença, em pixels, abaixo da qual a coluna conta como "no fim" ou "cabe inteira" (arredondamento da tela). */
const FOLGA_PX = 8;

export function duracaoDaChegada(movimentoReduzido: boolean): number {
  return movimentoReduzido ? DURACAO_SEM_MOVIMENTO_MS : DURACAO_DA_CHEGADA_MS;
}

/** Para onde a coluna rola para o destino ficar a um terço da altura dela (nunca antes do começo). */
export function rolagemParaUmTerco(medidas: { topoDoDestino: number; topoDaColuna: number; rolagemAtual: number; alturaDaColuna: number }): number {
  const { topoDoDestino, topoDaColuna, rolagemAtual, alturaDaColuna } = medidas;
  return Math.max(0, topoDoDestino - topoDaColuna + rolagemAtual - alturaDaColuna / 3);
}

export type EstadoDoPe = 'cabe' | 'tem-mais' | 'fim';

/** A coluna cabe inteira, ainda tem mais embaixo, ou já chegou ao fim. */
export function estadoDoPe(medidas: { conteudo: number; visivel: number; rolagem: number }): EstadoDoPe {
  const { conteudo, visivel, rolagem } = medidas;
  if (conteudo - visivel <= FOLGA_PX) return 'cabe';
  return conteudo - visivel - rolagem > FOLGA_PX ? 'tem-mais' : 'fim';
}

const TEXTO_DO_PE: Record<EstadoDoPe, string> = { cabe: '', 'tem-mais': 'Role para ver o resto', fim: 'Fim da lista' };

export function textoDoPe(estado: EstadoDoPe): string {
  return TEXTO_DO_PE[estado];
}

/** O que precisa estar aberto para a linha aparecer: o dia e, se ela está num mês antigo, o mês. */
export function abrirParaMostrar(lista: { recentes: DiaDoFeito[]; meses: MesDoFeito[] }, chave: string): { mes: string | null; dia: string } | null {
  const tem = (dia: DiaDoFeito) => dia.linhas.some(linha => linha.chave === chave);
  const recente = lista.recentes.find(tem);
  if (recente) return { mes: null, dia: recente.dia };
  for (const mes of lista.meses) {
    const dia = mes.dias.find(tem);
    if (dia) return { mes: mes.mes, dia: dia.dia };
  }
  return null;
}
