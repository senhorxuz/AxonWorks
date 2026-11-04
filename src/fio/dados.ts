/**
 * Fio do projeto — de onde vêm os nós e os fios soltos.
 *
 * A carta de "Onde paramos" traz tudo o que foi feito (cartões concluídos, entregas de tarefa,
 * registros) e as pendências por grupo. Para o fio ser lido, e não só admirado:
 * - um nó por DIA (não por item): o tamanho do nó diz quanto foi feito naquele dia;
 * - um fio solto por GRUPO de pendência, com nome e quantidade.
 */
import type { Carta, GrupoFalta } from '../../shared/carta';
import type { NoDoFio, TipoDoNo } from './desenho';

export const NOS_NA_MINIATURA = 12;

export interface DiaDoFio extends NoDoFio {
  /** 'AAAA-MM-DD' no fuso do dono. */
  dia: string;
  quantidade: number;
  /** O que foi feito naquele dia, mais novo primeiro. */
  itens: string[];
}

const DIA_DO_DONO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const IMPORTANCIA: Record<TipoDoNo, number> = { tarefa: 3, cartao: 2, registro: 1 };

export function diasDaCarta(carta: Carta): DiaDoFio[] {
  const itens = [...carta.feitoRecente, ...carta.feitoPorMes.flatMap(mes => mes.itens)]
    .sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando));
  const porDia = new Map<string, DiaDoFio>();
  for (const item of itens) {
    const dia = DIA_DO_DONO.format(Date.parse(item.quando));
    const atual = porDia.get(dia);
    if (!atual) {
      porDia.set(dia, { dia, quando: item.quando, tipo: item.origem, quantidade: 1, itens: [item.texto] });
      continue;
    }
    atual.quantidade++;
    atual.itens.push(item.texto);
    if (IMPORTANCIA[item.origem] > IMPORTANCIA[atual.tipo]) atual.tipo = item.origem;
  }
  return [...porDia.values()].reverse();
}

export interface PontaDoFio {
  grupo: GrupoFalta;
  rotulo: string;
  quantidade: number;
  destaque: 'brasa' | 'perigo' | 'neutro';
}

const GRUPOS: { grupo: GrupoFalta; rotulo: string; destaque: PontaDoFio['destaque'] }[] = [
  { grupo: 'precisa_de_voce', rotulo: 'Precisa de você', destaque: 'brasa' },
  { grupo: 'travado', rotulo: 'Travado', destaque: 'perigo' },
  { grupo: 'em_andamento', rotulo: 'Em andamento', destaque: 'neutro' },
  { grupo: 'a_fazer', rotulo: 'A fazer', destaque: 'neutro' },
  { grupo: 'ideias', rotulo: 'Ideias', destaque: 'neutro' },
];

export function pontasDaCarta(carta: Carta): PontaDoFio[] {
  return GRUPOS.map(g => ({ ...g, quantidade: carta.falta[g.grupo].length }))
    .filter(p => p.quantidade > 0)
    .map(({ grupo, rotulo, quantidade, destaque }) => ({ grupo, rotulo, quantidade, destaque }));
}

const NOMES: Record<TipoDoNo, string> = { registro: 'Registro', tarefa: 'Entrega', cartao: 'Cartão concluído' };

export function nomeDoTipo(tipo: TipoDoNo): string {
  return NOMES[tipo];
}

/** "70 coisas feitas em 8 dias · 23 precisam de você": a legenda do fio. */
export function resumoDosDias(dias: DiaDoFio[], pontas: PontaDoFio[]): string {
  if (dias.length === 0) return 'Nada feito ainda: o fio começa no primeiro registro';
  const total = dias.reduce((soma, d) => soma + d.quantidade, 0);
  const feito = `${total} ${total === 1 ? 'coisa feita' : 'coisas feitas'} em ${dias.length} ${dias.length === 1 ? 'dia' : 'dias'}`;
  const precisa = pontas.find(p => p.grupo === 'precisa_de_voce');
  if (!precisa) return feito;
  return `${feito} · ${precisa.quantidade} ${precisa.quantidade === 1 ? 'precisa' : 'precisam'} de você`;
}

/**
 * Quais rótulos cabem numa linha sem encavalar: o último (onde paramos) sempre aparece; andando para trás,
 * cada um só entra se ficar a pelo menos `espaco` do vizinho já escolhido. O rótulo do fim pode ser mais
 * largo ("onde paramos · 04 nov"): o vizinho dele precisa ficar a `espacoDoUltimo`. Devolve os índices em ordem.
 */
export function quaisRotular(posicoes: number[], espaco: number, espacoDoUltimo = espaco): number[] {
  const escolhidos: number[] = [];
  for (let i = posicoes.length - 1; i >= 0; i--) {
    const vizinho = escolhidos.at(-1);
    const minimo = escolhidos.length === 1 ? espacoDoUltimo : espaco;
    if (vizinho === undefined || posicoes[vizinho]! - posicoes[i]! >= minimo) escolhidos.push(i);
  }
  return escolhidos.reverse();
}

/** Na lista de projetos só se sabe quantas versões o projeto tem: um nó por versão, igualmente espaçados. */
export function nosDaMiniatura(versoes: number): NoDoFio[] {
  return Array.from({ length: Math.max(0, Math.min(versoes, NOS_NA_MINIATURA)) }, () => ({ quando: '', tipo: 'registro' as const }));
}
