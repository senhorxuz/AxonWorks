import type { ItemFalta } from '../shared/carta';

/**
 * Uma conta só para "o que espera por mim". A regra de quem entra mora no servidor
 * (`server/carta/montar.ts`: proposta de diretriz pendente, decisão proposta, cartão do Quadro marcado
 * "depende de você"), no grupo `precisa_de_voce` da carta. A aba Decisões, a Visão geral e "Onde paramos"
 * leem este mesmo grupo e passam por esta função, então os três números não podem divergir.
 */
export interface PendenciasDoDono { total: number; aprovacoes: number; decisoes: number; cartoes: number; outros: number }

/** `undefined` = a carta ainda não chegou: nunca vira 0. */
export function pendenciasDoDono(itens: readonly ItemFalta[] | null | undefined): PendenciasDoDono | undefined {
  if (!itens) return undefined;
  const conta = (origem: ItemFalta['origem']) => itens.filter(i => i.origem === origem).length;
  const aprovacoes = conta('aprovacao');
  const decisoes = conta('decisao');
  const cartoes = conta('cartao');
  return { total: itens.length, aprovacoes, decisoes, cartoes, outros: itens.length - aprovacoes - decisoes - cartoes };
}

/** O número da aba Decisões: o da carta; se a carta não chegou (falhou), o das propostas abertas da própria lista. */
export function decisoesEsperandoNaAba(pendencias: PendenciasDoDono | undefined, propostasDaLista: number): number {
  return pendencias ? pendencias.decisoes : propostasDaLista;
}

export function fraseDasPendencias(total: number): string {
  if (total === 0) return 'Nada espera você.';
  return total === 1 ? '1 item espera você.' : `${total} itens esperam você.`;
}

const parte = (n: number, um: string, varios: string) => (n === 0 ? [] : [`${n} ${n === 1 ? um : varios}`]);

/** "1 proposta para decidir, 20 decisões e 4 cartões do Quadro". */
export function detalheDasPendencias(p: PendenciasDoDono): string {
  const partes = [
    ...parte(p.aprovacoes, 'proposta para decidir', 'propostas para decidir'),
    ...parte(p.decisoes, 'decisão', 'decisões'),
    ...parte(p.cartoes, 'cartão do Quadro', 'cartões do Quadro'),
    ...parte(p.outros, 'outro item', 'outros itens'),
  ];
  if (partes.length < 2) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}
