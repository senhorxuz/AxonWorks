/**
 * Pintura do fio: as pequenas contas e os textos que a tela usa para pintar cada casa.
 *
 * Tudo aqui é função pura sobre o desenho já tecido (./tecer.ts). Quem põe na tela é ./FioDoProjeto.tsx.
 */
import type { Desenho } from './tecer';
import type { CoisaFeita } from './coisas';
import { rotuloDaFamilia, type CoisaNoTrilho, type Trilho } from './trilhos';

/** A cauda quente do fio: os últimos 20% das colunas usadas, e nunca menos que 10 casas. */
const FRACAO_DA_CAUDA = 0.2;
const CAUDA_MINIMA = 10;

const DATA_E_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const NOME_DO_TIPO = { tarefa: 'entrega', cartao: 'cartão concluído', registro: 'registro' } as const;

/**
 * A pauta de um trilho: um ponto a cada duas colunas nas casas vazias, só para o olho seguir a linha.
 * No trilho de onde paramos, a pauta para no `◉` (dali em diante é o fio aberto).
 */
export function pautaDoTrilho(desenho: Desenho, trilho: number): string {
  const linha = trilho * 2;
  const ocupadas = new Set(desenho.casas.filter(casa => casa.linha === linha).map(casa => casa.col));
  const fim = trilho === desenho.fim.trilho ? desenho.fim.col : desenho.colunas;
  return Array.from({ length: fim }, (_, col) => (ocupadas.has(col) || col % 2 === 1 ? ' ' : '·')).join('');
}

/** De 0 (o começo do fio) a 1 (o fim): as casas antigas ficam mais apagadas. */
export function idadeDaCasa(col: number, desenho: Desenho): number {
  return col / desenho.usadas;
}

/** De 0 a 1: quanto a casa já pegou a cor da brasa por estar perto de onde paramos. */
export function calorDaCasa(col: number, desenho: Desenho): number {
  const cauda = Math.max(CAUDA_MINIMA, Math.round(desenho.usadas * FRACAO_DA_CAUDA));
  return Math.max(0, 1 - (desenho.fim.col - col) / cauda);
}

/** Quantas casas de pontilhado cabem depois do `◉`, até a borda. */
export function abertoDepoisDoFim(desenho: Desenho): number {
  return Math.max(0, desenho.colunas - desenho.fim.col - 1);
}

/** O que a dica de um símbolo mostra: quando e o quê, quem, e o texto. */
export function dicaDoSimbolo(coisa: CoisaNoTrilho, ondeParamos: boolean): { quando: string; quem: string; texto: string } {
  const quando = `${DATA_E_HORA.format(new Date(coisa.quando))} · ${NOME_DO_TIPO[coisa.tipo]}${ondeParamos ? ' · onde paramos' : ''}`;
  const quem = coisa.peloDono ? 'Concluído pelo dono' : coisa.quem || 'Sem nome declarado';
  return { quando, quem, texto: coisa.texto };
}

/** A mesma informação da dica, numa frase só, para o leitor de tela. */
export function rotuloDoSimbolo(coisa: CoisaNoTrilho, ondeParamos: boolean): string {
  const { quando, quem, texto } = dicaDoSimbolo(coisa, ondeParamos);
  return `${quando}, ${quem}: ${texto}`;
}

/** O que o nome de um trilho diz ao passar o mouse ou receber o foco. */
export function rotuloDoTrilho(trilho: Trilho): string {
  const coisas = `${trilho.total} ${trilho.total === 1 ? 'coisa' : 'coisas'}`;
  const nomes = trilho.nomes.length === 0 ? 'Nenhum nome declarado' : `Nomes declarados: ${trilho.nomes.join(', ')}`;
  return `${trilho.rotulo}: ${coisas}. ${nomes}`;
}

export interface NomeReservado {
  rotulo: string;
  total: number;
}

/**
 * A largura da coluna de nomes não pode depender do que coube no desenho (com o resumo do começo, os trilhos mudam
 * e a medida oscilaria). Ela reserva o nome de toda IA do projeto, com o total dela, mais os trilhos que existem
 * ("Outras IAs" entre eles). O cartão concluído pelo dono não tem trilho próprio e fica de fora.
 */
export function reservaDosNomes(coisas: CoisaFeita[], trilhos: Trilho[]): NomeReservado[] {
  const totais = new Map<string, number>();
  for (const coisa of coisas) {
    if (coisa.peloDono) continue;
    const rotulo = rotuloDaFamilia(coisa.quem);
    totais.set(rotulo, (totais.get(rotulo) ?? 0) + 1);
  }
  for (const trilho of trilhos) totais.set(trilho.rotulo, Math.max(totais.get(trilho.rotulo) ?? 0, trilho.total));
  return [...totais].map(([rotulo, total]) => ({ rotulo, total }));
}
