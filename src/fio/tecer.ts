/**
 * Tecer o fio: de uma lista de coisas feitas e de quantas colunas cabem, a grade de caracteres.
 *
 * Função pura. O fio é um só, contínuo, do início até onde paramos, com um trilho por IA
 * (trilho i na linha 2i; entre dois trilhos, uma linha vazia). Quem desenha é a tela.
 *
 * Sem espaço, nesta ordem: (1) a tela tenta letras menores (`tamanhoDaLetra`); (2) um dia com mais de
 * 12 símbolos iguais mostra 10 e `+N`; (3) os dias mais antigos viram `┄ antes: N coisas em M dias ┄`,
 * um dia por vez; (4) só de 20 colunas em diante, se o último dia ainda não couber, ele mostra os primeiros
 * símbolos de cada trecho e um `+N` (`aperto.ts`), e o resumo do começo encurta para `┄ antes: N ┄`.
 * O último dia nunca sai e o `◉` é sempre a última casa.
 */
import { diaDe, diasEntre, emOrdemDeTempo, type CoisaFeita } from './coisas';
import { apertarPorTrecho, iguaisSeguidos, semCompressao, type Compressao } from './aperto';
import { trilhosDe, type CoisaNoTrilho, type Trilho } from './trilhos';

export type ClasseDaCasa = 'fiacao' | 'parado' | 'parado-numero' | 'mais' | 'entrega' | 'cartao' | 'registro' | 'agora';

export interface Casa {
  col: number;
  linha: number;
  ch: string;
  classe: ClasseDaCasa;
  trilho: number;
  coisa?: CoisaNoTrilho;
}

export interface Desenho {
  casas: Casa[];
  /** Colunas ocupadas pelo desenho (da primeira à última casa). */
  usadas: number;
  /** As colunas que a tela tinha. */
  colunas: number;
  linhas: number;
  trilhos: Trilho[];
  /** O primeiro símbolo de cada dia desenhado. */
  dias: { col: number; dia: string }[];
  /** A casa do `◉`. */
  fim: { col: number; linha: number; trilho: number };
  /** Só o resumo do começo (`┄ antes: N coisas em M dias ┄`): quantas coisas e quantos dias de trabalho saíram do desenho. A compressão `+N` não entra aqui. */
  coisasResumidas: number;
  diasResumidos: number;
  /** Nada foi resumido nem comprimido. */
  cabe: boolean;
}

export const TAMANHOS_DA_LETRA = [20, 19, 18, 17, 16, 15, 14, 13, 12] as const;
/** Parado de 7 dias em diante ganha o rótulo `┄ N dias ┄` (o mesmo prazo de DIAS_PARA_ABRIR_CARTA). */
export const DIAS_PARA_PARAR = 7;
/** Casas de folga depois da última coisa. */
const FOLGA_DO_FIM = 6;
/** De quantas colunas em diante o último dia sempre cabe (`usadas <= colunas`); abaixo disso o fio só tenta. */
export const COLUNAS_COM_GARANTIA = 20;
const GLIFOS = { tarefa: '●', cartao: '◆', registro: '○' } as const;
const CLASSES = { tarefa: 'entrega', cartao: 'cartao', registro: 'registro' } as const;

type Passo =
  | { k: 'vao'; dias: number; trilho: number; largura: number }
  | { k: 'troca'; de: number; para: number }
  | { k: 'item'; coisa: CoisaNoTrilho; ultimo: boolean }
  | { k: 'mais'; n: number; trilho: number };

interface Plano {
  trilhos: Trilho[];
  passos: Passo[];
  inicio: string;
  resumido: boolean;
  coisasResumidas: number;
  diasResumidos: number;
  precisa: number;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const linhaDoTrilho = (trilho: number) => trilho * 2;
const ehNumero = (ch: string) => /\d/.test(ch);

export function rotuloDoSilencio(dias: number): string {
  return ` ${dias} dias `;
}

/** A largura mínima de um passo, em casas. */
function minimo(passo: Passo): number {
  if (passo.k === 'mais') return `+${passo.n}`.length;
  if (passo.k !== 'vao') return 1;
  if (passo.dias >= DIAS_PARA_PARAR) return rotuloDoSilencio(passo.dias).length + 2;
  return passo.dias >= 2 ? 2 : 1;
}

/** O que vem entre duas coisas seguidas: o vão de dias e, depois dele, a troca de IA. */
function passosEntre(anterior: CoisaNoTrilho, coisa: CoisaNoTrilho): Passo[] {
  const passos: Passo[] = [];
  if (anterior.dia !== coisa.dia) passos.push({ k: 'vao', dias: diasEntre(anterior.dia, coisa.dia), trilho: anterior.trilho, largura: 0 });
  if (anterior.trilho !== coisa.trilho) passos.push({ k: 'troca', de: anterior.trilho, para: coisa.trilho });
  return passos;
}

function passosDe(coisas: CoisaNoTrilho[], { ocultas, maisApos, omitidas }: Compressao): Passo[] {
  const passos: Passo[] = [];
  if (omitidas > 0) passos.push({ k: 'mais', n: omitidas, trilho: coisas[omitidas]!.trilho });
  for (let i = omitidas; i < coisas.length; i++) {
    const coisa = coisas[i]!;
    if (i > omitidas) passos.push(...passosEntre(coisas[i - 1]!, coisa));
    if (!ocultas.has(i)) passos.push({ k: 'item', coisa, ultimo: i === coisas.length - 1 });
    const n = maisApos.get(i);
    if (n !== undefined) passos.push({ k: 'mais', n, trilho: coisa.trilho });
  }
  return passos;
}

function textoDoResumo(coisas: number, dias: number, curto: boolean): string {
  return curto ? `┄ antes: ${coisas} ┄` : `┄ antes: ${plural(coisas, 'coisa', 'coisas')} em ${plural(dias, 'dia', 'dias')} ┄`;
}

/** O que sobra do projeto a partir do `corte`-ésimo dia de trabalho (0 = o projeto inteiro). */
interface Recorte {
  coisas: CoisaNoTrilho[];
  trilhos: Trilho[];
  coisasResumidas: number;
  corte: number;
}

/** Onde cada dia de trabalho começa em `ordenadas` (já em ordem de tempo, então o dia só cresce). */
function iniciosDosDias(ordenadas: CoisaFeita[]): number[] {
  const inicios: number[] = [];
  let anterior = '';
  ordenadas.forEach((c, i) => {
    const dia = diaDe(c.quando);
    if (dia !== anterior) inicios.push(i);
    anterior = dia;
  });
  return inicios;
}

function recortar(ordenadas: CoisaFeita[], inicios: number[], corte: number): Recorte {
  const coisasResumidas = inicios[corte]!;
  return { ...trilhosDe(ordenadas.slice(coisasResumidas)), coisasResumidas, corte };
}

function planoDe(recorte: Recorte, compressao: Compressao, curto: boolean): Plano {
  const { coisas, trilhos, coisasResumidas, corte } = recorte;
  const passos = passosDe(coisas, compressao);
  const inicio = coisasResumidas > 0 ? textoDoResumo(coisasResumidas, corte, curto) : '├─';
  const precisa = inicio.length + passos.reduce((soma, p) => soma + minimo(p), 0) + FOLGA_DO_FIM;
  return { trilhos, passos, inicio, resumido: coisasResumidas > 0, coisasResumidas, diasResumidos: corte, precisa };
}

/** O plano de um desenho que começa no `corte`-ésimo dia de trabalho. */
function planoCom(ordenadas: CoisaFeita[], inicios: number[], corte: number, comprimir: boolean): Plano {
  const recorte = recortar(ordenadas, inicios, corte);
  return planoDe(recorte, comprimir ? iguaisSeguidos(recorte.coisas) : semCompressao(), false);
}

/**
 * O primeiro dia de corte em que o desenho (com os iguais comprimidos) cabe; `null` se nem só o último dia cabe.
 * O corte 0 é à parte (não leva o texto do resumo); de 1 em diante, cortar mais só encurta (conferido contra a busca dia a dia em 3000 entradas sorteadas), então procura por bisseção.
 */
function menorCorteQueCabe(ordenadas: CoisaFeita[], inicios: number[], colunas: number): number | null {
  const cabeEm = (corte: number) => planoCom(ordenadas, inicios, corte, true).precisa <= colunas;
  if (cabeEm(0)) return 0;
  let menor = 1;
  let maior = inicios.length - 1;
  if (maior < menor || !cabeEm(maior)) return null;
  while (menor < maior) {
    const meio = (menor + maior) >> 1;
    if (cabeEm(meio)) maior = meio;
    else menor = meio + 1;
  }
  return maior;
}

/** O último dia, apertado por trecho até caber nas colunas (sem as casas de folga). */
function planoDoUltimoDia(ordenadas: CoisaFeita[], inicios: number[], colunas: number): Plano {
  const recorte = recortar(ordenadas, inicios, inicios.length - 1);
  const compressao = apertarPorTrecho(recorte.coisas, c => planoDe(recorte, c, true).precisa - FOLGA_DO_FIM <= colunas);
  return planoDe(recorte, compressao, true);
}

/** Sem espaço: primeiro comprime os excessos, depois resume dias antigos, um por vez, até caber (o último dia fica sempre). */
function escolherPlano(ordenadas: CoisaFeita[], colunas: number): { plano: Plano; cabe: boolean } {
  const inicios = iniciosDosDias(ordenadas);
  const inteiro = planoCom(ordenadas, inicios, 0, false);
  if (inteiro.precisa <= colunas) return { plano: inteiro, cabe: true };
  const corte = menorCorteQueCabe(ordenadas, inicios, colunas);
  if (corte !== null) return { plano: planoCom(ordenadas, inicios, corte, true), cabe: false };
  const doUltimoDia = planoCom(ordenadas, inicios, inicios.length - 1, true);
  const estoura = doUltimoDia.precisa - FOLGA_DO_FIM > colunas;
  return { plano: estoura && colunas >= COLUNAS_COM_GARANTIA ? planoDoUltimoDia(ordenadas, inicios, colunas) : doUltimoDia, cabe: false };
}

/** A sobra vira tempo: cada vão cresce na proporção dos dias que durou, até o teto (30% das colunas, no mínimo 14). */
function distribuirSobra(passos: Passo[], sobra: number, colunas: number): void {
  const vaos = passos.filter(p => p.k === 'vao');
  const pesoTotal = vaos.reduce((soma, p) => soma + p.dias, 0);
  const teto = Math.max(14, Math.floor(colunas * 0.3));
  for (const vao of vaos) {
    vao.largura = minimo(vao);
    if (sobra > 0) vao.largura += Math.max(0, Math.min(Math.floor((sobra * vao.dias) / pesoTotal), teto - vao.largura));
  }
}

/** Constrói as casas, uma coluna de cada vez. */
class Grade {
  casas: Casa[] = [];
  dias: { col: number; dia: string }[] = [];
  col = 0;
  private diaAtual: string | null = null;

  casa(col: number, linha: number, ch: string, classe: ClasseDaCasa, trilho: number, coisa?: CoisaNoTrilho): void {
    this.casas.push(coisa ? { col, linha, ch, classe, trilho, coisa } : { col, linha, ch, classe, trilho });
  }

  /** Texto de fio parado (`parado`; os dígitos em `parado-numero`) ou de fiação. */
  texto(texto: string, linha: number, trilho: number, parado: boolean): void {
    for (const ch of texto) {
      const classe: ClasseDaCasa = !parado ? 'fiacao' : ehNumero(ch) ? 'parado-numero' : 'parado';
      this.casa(this.col++, linha, ch, classe, trilho);
    }
  }

  vao(passo: Extract<Passo, { k: 'vao' }>): void {
    const parado = passo.dias >= DIAS_PARA_PARAR;
    const rotulo = parado ? rotuloDoSilencio(passo.dias) : '';
    const antes = Math.floor((passo.largura - rotulo.length) / 2);
    const miolo = parado ? '┄'.repeat(antes) + rotulo + '┄'.repeat(passo.largura - antes - rotulo.length) : '─'.repeat(passo.largura);
    this.texto(miolo, linhaDoTrilho(passo.trilho), passo.trilho, parado);
  }

  troca(passo: Extract<Passo, { k: 'troca' }>): void {
    const desce = passo.para > passo.de;
    const de = linhaDoTrilho(passo.de);
    const para = linhaDoTrilho(passo.para);
    this.casa(this.col, de, desce ? '╮' : '╯', 'fiacao', passo.de);
    for (let linha = Math.min(de, para) + 1; linha < Math.max(de, para); linha++) this.casa(this.col, linha, '│', 'fiacao', passo.para);
    this.casa(this.col, para, desce ? '╰' : '╭', 'fiacao', passo.para);
    this.col++;
  }

  item(passo: Extract<Passo, { k: 'item' }>): void {
    const { coisa, ultimo } = passo;
    if (coisa.dia !== this.diaAtual) {
      this.diaAtual = coisa.dia;
      this.dias.push({ col: this.col, dia: coisa.dia });
    }
    this.casa(this.col++, linhaDoTrilho(coisa.trilho), ultimo ? '◉' : GLIFOS[coisa.tipo], ultimo ? 'agora' : CLASSES[coisa.tipo], coisa.trilho, coisa);
  }

  mais(passo: Extract<Passo, { k: 'mais' }>): void {
    for (const ch of `+${passo.n}`) this.casa(this.col++, linhaDoTrilho(passo.trilho), ch, 'mais', passo.trilho);
  }

  passo(passo: Passo): void {
    if (passo.k === 'vao') this.vao(passo);
    else if (passo.k === 'troca') this.troca(passo);
    else if (passo.k === 'item') this.item(passo);
    else this.mais(passo);
  }
}

/** O desenho inteiro em casas de uma grade: função pura de (coisas feitas, colunas que cabem). `null` sem coisas. */
export function tecer(coisas: CoisaFeita[], colunas: number): Desenho | null {
  if (coisas.length === 0) return null;
  const { plano, cabe } = escolherPlano(emOrdemDeTempo(coisas), colunas);
  distribuirSobra(plano.passos, Math.max(0, colunas - plano.precisa), colunas);
  const grade = new Grade();
  const primeira = plano.passos.find((p): p is Extract<Passo, { k: 'item' }> => p.k === 'item')!;
  grade.texto(plano.inicio, linhaDoTrilho(primeira.coisa.trilho), primeira.coisa.trilho, plano.resumido);
  for (const passo of plano.passos) grade.passo(passo);
  const ultima = plano.passos.findLast((p): p is Extract<Passo, { k: 'item' }> => p.k === 'item')!.coisa;
  return {
    casas: grade.casas,
    usadas: grade.col,
    colunas,
    linhas: plano.trilhos.length * 2 - 1,
    trilhos: plano.trilhos,
    dias: grade.dias,
    fim: { col: grade.col - 1, linha: linhaDoTrilho(ultima.trilho), trilho: ultima.trilho },
    coisasResumidas: plano.coisasResumidas,
    diasResumidos: plano.diasResumidos,
    cabe,
  };
}

/** O maior tamanho de letra (de 20 a 12 px) em que o fio inteiro cabe; se nenhum, 12. `casaPorTamanho` devolve a largura de uma casa. */
export function tamanhoDaLetra(coisas: CoisaFeita[], larguraPx: number, casaPorTamanho: (tamanho: number) => number): number {
  const precisa = larguraDoFioInteiro(coisas);
  return TAMANHOS_DA_LETRA.find(tamanho => precisa <= Math.floor(larguraPx / casaPorTamanho(tamanho))) ?? 12;
}

/** As colunas de que o fio inteiro precisa, sem resumo nem compressão (com a folga do fim); `Infinity` sem coisas. */
function larguraDoFioInteiro(coisas: CoisaFeita[]): number {
  if (coisas.length === 0) return Infinity;
  const ordenadas = emOrdemDeTempo(coisas);
  return planoCom(ordenadas, iniciosDosDias(ordenadas), 0, false).precisa;
}
