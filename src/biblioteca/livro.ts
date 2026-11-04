/**
 * O livro aberto do hero da Biblioteca — ilustração em traço fino, gerada por geometria.
 *
 * Uma regra só define a página: `alturaDaPagina(u, v)`, com u de 0 (lombada) a 1 (borda de fora) e
 * v de 0 (topo) a 1 (base). A página afunda junto à lombada e sobe para a borda, como num livro de
 * verdade; o contorno, o bloco de páginas e cada linha de texto seguem essa mesma curva.
 * O texto (parágrafos, recuo, última linha curta) sai da semente do projeto: cada projeto, o seu livro.
 */
import { aleatorioDe } from '../fio/desenho';

export const LARGURA_DO_LIVRO = 320;
export const ALTURA_DO_LIVRO = 210;
export const LOMBADA = LARGURA_DO_LIVRO / 2;

/** Largura de cada página, da lombada à borda de fora. */
const PAGINA = 136;
/** Margens do texto dentro da página (em u) e o passo entre linhas (em v). */
const MARGEM_LOMBADA = 0.12;
const MARGEM_FORA = 0.9;
const ENTRELINHA = 0.045;

type Ponto = { x: number; y: number };
export type Pagina = 'esquerda' | 'direita';

export interface LinhaDeTexto {
  d: string;
  pagina: Pagina;
  tipo: 'titulo' | 'texto';
}

export interface LivroAberto {
  capa: string;
  paginaEsquerda: string;
  paginaDireita: string;
  sombra: string;
  bordas: string[];
  linhas: LinhaDeTexto[];
  fita: string;
  emblema: { cx: number; cy: number; r: number };
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const caminho = (pontos: Ponto[], fechar = false) =>
  `M${fmt(pontos[0]!.x)} ${fmt(pontos[0]!.y)} ${pontos.slice(1).map(p => `L${fmt(p.x)} ${fmt(p.y)}`).join(' ')}${fechar ? ' Z' : ''}`;

/** A altura (y) de um ponto da página: u = 0 na lombada, 1 na borda; v = 0 no topo, 1 na base. */
export function alturaDaPagina(u: number, v: number): number {
  const vinco = (1 - u) ** 2.2;
  // A curva junto à lombada é bem marcada, como num livro aberto de verdade.
  const topo = 32 + 19 * vinco;
  const base = 175 + 10 * vinco;
  return topo + (base - topo) * v;
}

const xDaPagina = (pagina: Pagina, u: number, folga = 0) => (pagina === 'esquerda' ? LOMBADA - u * (PAGINA + folga) : LOMBADA + u * (PAGINA + folga));
const amostras = (de: number, ate: number, n: number) => Array.from({ length: n + 1 }, (_, i) => de + ((ate - de) * i) / n);

function contornoDaPagina(pagina: Pagina): string {
  const topo = amostras(0, 1, 24).map(u => ({ x: xDaPagina(pagina, u), y: alturaDaPagina(u, 0) }));
  const base = amostras(1, 0, 24).map(u => ({ x: xDaPagina(pagina, u), y: alturaDaPagina(u, 1) }));
  return caminho([...topo, ...base], true);
}

/** A capa aparece um pouco além das páginas: contorno por cima e por baixo das duas, de ponta a ponta. */
function contornoDaCapa(): string {
  const folga = 6;
  const topo = (pagina: Pagina, us: number[]) => us.map(u => ({ x: xDaPagina(pagina, u, folga), y: alturaDaPagina(u, 0) + 4 }));
  const base = (pagina: Pagina, us: number[]) => us.map(u => ({ x: xDaPagina(pagina, u, folga), y: alturaDaPagina(u, 1) + 9 }));
  const ida = amostras(0, 1, 16);
  const volta = amostras(1, 0, 16);
  return caminho([...topo('esquerda', ida), ...base('esquerda', volta), ...base('direita', ida), ...topo('direita', volta)], true);
}

/** O bloco de páginas: bordas finíssimas embaixo e do lado de fora de cada página. */
function bordasDasPaginas(): string[] {
  const bordas: string[] = [];
  for (const pagina of ['esquerda', 'direita'] as const) {
    for (let k = 1; k <= 7; k++) {
      bordas.push(caminho(amostras(0.04, 1, 18).map(u => ({ x: xDaPagina(pagina, u, k * 0.7), y: alturaDaPagina(u, 1) + k * 1.1 }))));
    }
    for (let k = 1; k <= 6; k++) {
      const x = xDaPagina(pagina, 1, k * 0.8);
      bordas.push(caminho([{ x, y: alturaDaPagina(1, 0) + k * 0.5 }, { x, y: alturaDaPagina(1, 1) + k * 1.1 }]));
    }
  }
  return bordas;
}

/** Uma linha de texto: palavras de tamanhos variados, cada uma seguindo a curva da página. */
function linhaDeTexto(sorte: () => number, pagina: Pagina, v: number, inicio: number, fim: number): string {
  const trechos: string[] = [];
  let u = inicio;
  while (u < fim - 0.02) {
    const palavra = Math.min(fim - u, 0.04 + sorte() * 0.09);
    const pontos = amostras(u, u + palavra, 3).map(t => ({ x: xDaPagina(pagina, t), y: alturaDaPagina(t, v) }));
    // Na página da esquerda o texto corre da borda de fora para a lombada: lido da esquerda para a direita.
    trechos.push(caminho(pagina === 'esquerda' ? pontos.reverse() : pontos));
    u += palavra + 0.018;
  }
  return trechos.join(' ');
}

/**
 * Posição de leitura s (0 onde a linha começa, 1 onde termina) convertida em u, devolvida em ordem.
 * Na página esquerda o texto começa na borda de fora; na direita, junto à lombada.
 */
function faixaDaLinha(pagina: Pagina, sInicio: number, sFim: number): [number, number] {
  const largura = MARGEM_FORA - MARGEM_LOMBADA;
  const emU = (s: number) => (pagina === 'esquerda' ? MARGEM_FORA - s * largura : MARGEM_LOMBADA + s * largura);
  const [a, b] = [emU(sInicio), emU(sFim)];
  return a < b ? [a, b] : [b, a];
}

/** Parágrafos: recuo na primeira linha, última linha mais curta, uma linha em branco entre eles. */
function paragrafos(sorte: () => number, pagina: Pagina, deV: number, ateV: number): LinhaDeTexto[] {
  const linhas: LinhaDeTexto[] = [];
  let v = deV;
  while (v <= ateV) {
    const tamanho = 3 + Math.floor(sorte() * 4);
    for (let i = 0; i < tamanho && v <= ateV; i++, v += ENTRELINHA) {
      const recuo = i === 0 ? 0.09 : 0;
      const fim = i === tamanho - 1 ? 0.35 + sorte() * 0.4 : 1;
      const [ini, fimU] = faixaDaLinha(pagina, recuo, fim);
      linhas.push({ d: linhaDeTexto(sorte, pagina, v, ini, fimU), pagina, tipo: 'texto' });
    }
    v += ENTRELINHA;
  }
  return linhas;
}

/** A fita marcadora: nasce na lombada, cai sobre a página direita e termina em V abaixo da base. */
function fitaMarcadora(): string {
  const topo = alturaDaPagina(0, 0) - 2;
  const fim = alturaDaPagina(0, 1) + 13;
  return `M${LOMBADA + 3} ${topo} C${LOMBADA + 9} ${topo + 50} ${LOMBADA + 2} ${topo + 100} ${LOMBADA + 6} ${fim} L${LOMBADA + 9} ${fim - 4} L${LOMBADA + 12} ${fim} C${LOMBADA + 8} ${topo + 100} ${LOMBADA + 15} ${topo + 50} ${LOMBADA + 9} ${topo} Z`;
}

export function livroAberto(semente: string): LivroAberto {
  const sorte = aleatorioDe(`livro:${semente}`);
  const titulo = (v: number, comprimento: number): LinhaDeTexto => ({
    d: linhaDeTexto(sorte, 'esquerda', v, ...faixaDaLinha('esquerda', 0, comprimento)),
    pagina: 'esquerda',
    tipo: 'titulo',
  });
  const emblemaU = 0.5;
  const r = 18;
  return {
    capa: contornoDaCapa(),
    paginaEsquerda: contornoDaPagina('esquerda'),
    paginaDireita: contornoDaPagina('direita'),
    sombra: caminho([
      { x: LOMBADA - 16, y: alturaDaPagina(0.12, 0) }, { x: LOMBADA + 16, y: alturaDaPagina(0.12, 0) },
      { x: LOMBADA + 16, y: alturaDaPagina(0.12, 1) }, { x: LOMBADA - 16, y: alturaDaPagina(0.12, 1) },
    ], true),
    bordas: bordasDasPaginas(),
    linhas: [
      titulo(0.13, 0.55 + sorte() * 0.2),
      titulo(0.18, 0.3 + sorte() * 0.15),
      ...paragrafos(sorte, 'esquerda', 0.28, 0.92),
      ...paragrafos(sorte, 'direita', 0.44, 0.92),
    ],
    fita: fitaMarcadora(),
    emblema: { cx: xDaPagina('direita', emblemaU), cy: alturaDaPagina(emblemaU, 0.24), r },
  };
}
