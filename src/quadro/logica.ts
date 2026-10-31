import type { BoardCard, BoardColumnId } from '../../shared/board';

/**
 * Lógica pura do Quadro: ordem, movimento otimista, resumo e tempo.
 * A tela usa isto para responder na hora; o servidor continua sendo a verdade.
 */

const PASSO = 1024;

export function cardsDaColuna(cards: BoardCard[], coluna: BoardColumnId): BoardCard[] {
  return cards.filter(c => c.column === coluna).sort((a, b) => a.position - b.position);
}

/** Aplica um movimento localmente, com a mesma regra de posição do servidor. Não altera a lista recebida. */
export function aplicarMovimentoLocal(cards: BoardCard[], cardId: string, coluna: BoardColumnId, beforeCardId: string | null): BoardCard[] {
  const destino = cardsDaColuna(cards, coluna).filter(c => c.id !== cardId);
  let posicao: number;
  const indice = beforeCardId ? destino.findIndex(c => c.id === beforeCardId) : -1;
  if (indice === -1) {
    posicao = destino.length ? destino[destino.length - 1]!.position + PASSO : PASSO;
  } else {
    const depois = destino[indice]!.position;
    const antes = indice > 0 ? destino[indice - 1]!.position : 0;
    posicao = (antes + depois) / 2;
  }
  return cards.map(c => (c.id === cardId ? { ...c, column: coluna, position: posicao } : c));
}

/** Em que posição da coluna o cartão cai, dado o y do ponteiro e o meio vertical de cada cartão. */
export function indiceDeInsercao(y: number, meios: number[]): number {
  const indice = meios.findIndex(meio => y < meio);
  return indice === -1 ? meios.length : indice;
}

/** Para mover pelo teclado uma posição acima ou abaixo. `null` quando não há para onde ir. */
export function proximoVizinho(coluna: BoardCard[], cardId: string, direcao: 'acima' | 'abaixo'): { beforeCardId: string | null } | null {
  const indice = coluna.findIndex(c => c.id === cardId);
  if (indice === -1) return null;
  if (direcao === 'acima') {
    if (indice === 0) return null;
    return { beforeCardId: coluna[indice - 1]!.id };
  }
  if (indice === coluna.length - 1) return null;
  const depoisDoProximo = coluna[indice + 2];
  return { beforeCardId: depoisDoProximo ? depoisDoProximo.id : null };
}

const RECOLHIVEIS = new Set<BoardColumnId>(['blocked', 'discarded']);

export function colunaRecolhida(coluna: BoardColumnId, cards: BoardCard[]): boolean {
  return RECOLHIVEIS.has(coluna) && !cards.some(c => c.column === coluna);
}

function plural(n: number, singular: string, pluralForma: string) {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

export function resumoDoQuadro(cards: BoardCard[]): string {
  if (cards.length === 0) return 'Nenhum cartão ainda. Comece escrevendo um em Pendente.';
  const partes: string[] = [];
  const conta = (coluna: BoardColumnId) => cards.filter(c => c.column === coluna).length;
  const andamento = conta('in_progress');
  const deploy = conta('awaiting_deploy');
  const bloqueados = conta('blocked');
  if (andamento) partes.push(`${andamento} em andamento`);
  if (deploy) partes.push(`${deploy} esperando deploy`);
  if (bloqueados) partes.push(`${bloqueados} ${bloqueados === 1 ? 'bloqueado' : 'bloqueados'}`);
  const total = plural(cards.length, 'cartão', 'cartões');
  if (!partes.length) return `${total}.`;
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}`;
  return `${total}: ${lista}.`;
}

const formatoData = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });

export function tempoRelativo(iso: string, agora: Date): string {
  const data = new Date(iso);
  const minutos = Math.floor((agora.getTime() - data.getTime()) / 60000);
  if (minutos < 1) return 'agora mesmo';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const mesmoDia = data.toDateString() === agora.toDateString();
  if (mesmoDia) return `há ${horas} h`;
  const ontem = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1);
  if (data.toDateString() === ontem.toDateString()) return 'ontem';
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const dias = Math.ceil((inicioHoje - data.getTime()) / 86400000);
  if (dias <= 6) return `há ${dias} dias`;
  return formatoData.format(data);
}

const CORES_DE_NOME = ['#7dd3fc', '#c4b5fd', '#f9a8d4', '#fcd34d', '#86efac', '#fdba74', '#a5b4fc', '#5eead4'];

export function corDoNome(nome: string): string {
  let soma = 0;
  for (const letra of nome) soma = (soma * 31 + letra.charCodeAt(0)) >>> 0;
  return CORES_DE_NOME[soma % CORES_DE_NOME.length]!;
}

export function inicial(nome: string): string {
  return (nome.trim()[0] ?? '?').toUpperCase();
}
