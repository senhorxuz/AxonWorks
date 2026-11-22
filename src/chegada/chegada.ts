/**
 * Destaque de chegada, as contas comuns a toda a Axon (sem tela).
 *
 * Regra do dono (22/11/2026): todo clique que leva a outro ponto da tela destaca o destino.
 * Quem acha o destino, rola, passa o foco e acende de verdade é ./irPara.ts; aqui ficam os números e as decisões.
 */

/** O destino fica aceso por 2,2 s; com movimento reduzido, um contorno parado por 2 s. */
export const DURACAO_DA_CHEGADA_MS = 2200;
export const DURACAO_SEM_MOVIMENTO_MS = 2000;
/** Quanto a tela espera o destino aparecer (aba que abre, lista que carrega) antes de desistir sem barulho. */
export const PRAZO_DA_ESPERA_MS = 4000;
/** O aviso "Desfazer" depois de mandar algo para a lixeira. */
export const DURACAO_DO_DESFAZER_MS = 6000;
/** A aba em que as tarefas e os bloqueios aparecem sempre (a coluna "Tarefas" fica ao lado de qualquer aba). */
/** O bloco "Esperando você aceitar" da aba Decisões (o destino de "Ver decisões" na Visão geral). */
export const CHAVE_DAS_DECISOES_ESPERANDO = 'decisoes-esperando';

export const ABA_DA_TAREFA = 'overview';

export function duracaoDaChegada(movimentoReduzido: boolean): number {
  return movimentoReduzido ? DURACAO_SEM_MOVIMENTO_MS : DURACAO_DA_CHEGADA_MS;
}

/** Para onde a coluna rola para o destino ficar a um terço da altura dela (nunca antes do começo). */
export function rolagemParaUmTerco(medidas: { topoDoDestino: number; topoDaColuna: number; rolagemAtual: number; alturaDaColuna: number }): number {
  const { topoDoDestino, topoDaColuna, rolagemAtual, alturaDaColuna } = medidas;
  return Math.max(0, topoDoDestino - topoDaColuna + rolagemAtual - alturaDaColuna / 3);
}

/** Destino mais alto que a tela não cabe no meio: começa pelo topo dele. Os demais ficam no meio da tela. */
export function blocoDaChegada(alturaDoDestino: number, alturaDaTela: number): 'start' | 'center' {
  return alturaDoDestino > alturaDaTela * 0.8 ? 'start' : 'center';
}

/** Para onde a lista rola, no mínimo, para o item aparecer inteiro (não mexe se já está à vista). */
export function rolagemParaMostrar(medidas: { topoDoItem: number; alturaDoItem: number; topoDaLista: number; alturaDaLista: number; rolagemAtual: number }): number {
  const { topoDoItem, alturaDoItem, topoDaLista, alturaDaLista, rolagemAtual } = medidas;
  const acima = topoDoItem - topoDaLista;
  if (acima < 0) return Math.max(0, rolagemAtual + acima);
  const abaixo = acima + alturaDoItem - alturaDaLista;
  return abaixo > 0 ? rolagemAtual + abaixo : rolagemAtual;
}

/** Os projetos da barra lateral: os cinco primeiros; o projeto aberto, se ficou de fora, entra no lugar do último (para o brilho de chegada ter onde acender). */
export function projetosDaBarra<T extends { id: string }>(projetos: readonly T[], abertoId: string | null, limite = 5): T[] {
  const primeiros = projetos.slice(0, limite);
  const aberto = projetos.find(projeto => projeto.id === abertoId);
  return aberto && !primeiros.includes(aberto) ? [...primeiros.slice(0, limite - 1), aberto] : primeiros;
}

/** O nome do destino: cada elemento que pode receber a chegada leva `data-chegada="<tipo>:<id>"`. */
export function chaveDaChegada(tipo: string, id: string): string {
  return `${tipo}:${id}`;
}

export function seletorDaChegada(chave: string): string {
  return `[data-chegada="${chave.replace(/[\\"]/g, match => `\\${match}`)}"]`;
}

export interface DestinoDoNo { aba: string; tipo: 'decisao' | 'conteudo' | 'tarefa' | 'bloqueio'; id: string; chave: string }

const ONDE_MORA: Record<string, { aba: string; tipo: DestinoDoNo['tipo'] }> = {
  decision: { aba: 'decisions', tipo: 'decisao' },
  content: { aba: 'library', tipo: 'conteudo' },
  task: { aba: ABA_DA_TAREFA, tipo: 'tarefa' },
  blocker: { aba: ABA_DA_TAREFA, tipo: 'bloqueio' },
};

/** Em Relações, "Abrir na aba de origem": a aba onde o item mora e o nome do destino dentro dela. */
export function destinoDoNo(tipoDoNo: string, id: string): DestinoDoNo | null {
  const onde = ONDE_MORA[tipoDoNo];
  return onde ? { ...onde, id, chave: chaveDaChegada(onde.tipo, id) } : null;
}
