/**
 * Tear — os projetos como trilhos sobre uma régua de tempo comum, desenhados em caracteres.
 *
 * Um projeto por trilho, o mais recente no alto, como um mapa de metrô ou um gráfico de versões:
 * - o trilho nasce quando o projeto foi criado (├) e segue firme (─) até a última atividade;
 *   dali até agora fica pontilhado (·····): é o tempo parado; em letra pequena, ┄ parecia linha cheia;
 * - cada nó é uma atividade de verdade (coisa feita lida da carta do projeto), no lugar exato do
 *   tempo; o glifo diz quanto foi feito naquele trecho (• ● ◆). Sem dado, sem nó: nada é inventado;
 * - o projeto mais recente é o vivo: trilho grosso (━) em brasa, último nó ◉ com ondas e um pulso;
 *   os parados (mais de 7 dias) ficam apagados;
 * - embaixo, a régua com as marcas do tempo e, à direita, a coluna do AGORA.
 * Os nomes e os textos ao lado ficam na tela em HTML (TearDosProjetos.tsx), alinhados às linhas daqui.
 *
 * `tecerBase` faz o trabalho pesado uma vez por tamanho e dados; `quadroDoTear` só acrescenta o que
 * muda no tempo (poeira do fundo, ondas do nó aceso e o pulso) e é barato o bastante para cada quadro.
 */

/**
 * ' ' vazio · d poeira · u urdume e régua · ag coluna do agora ·
 * t, t2, tv trilho (normal, parado, vivo) · p pontilhado do tempo parado ·
 * n, n2, nv nó (normal, parado, vivo) · na nó aceso · b brasa · bq brasa quente
 */
export type Classe = ' ' | 'd' | 'u' | 'ag' | 't' | 't2' | 'tv' | 'p' | 'n' | 'n2' | 'nv' | 'na' | 'b' | 'bq';

export interface Celula {
  ch: string;
  c: Classe;
}

/** Um projeto, já em números: quando nasceu, a última vez que mexeu e cada atividade lida. */
export interface TrilhoDoTear {
  desde: number;
  ultimo: number;
  atividades: number[];
  vivo: boolean;
  parado: boolean;
}

export interface MarcaDaRegua {
  quando: number;
  rotulo: string;
}

export interface PedidoDoTear {
  cols: number;
  /** A janela do tempo, em milissegundos: `fim` é agora, na última coluna antes da do AGORA. */
  inicio: number;
  fim: number;
  trilhos: TrilhoDoTear[];
  marcas: MarcaDaRegua[];
}

type Lugar = { col: number; row: number };

export interface BaseDoTear {
  cols: number;
  rows: number;
  fixo: Celula[];
  /** Casas que nada vivo pode tingir nem cobrir: os nós. */
  solido: Set<number>;
  pulso: Lugar[];
  aceso: Lugar | null;
}

const VAZIO: Celula = { ch: ' ', c: ' ' };
const AGORA = 'AGORA';
/** Folga mínima, em colunas, entre dois rótulos da régua. */
const FOLGA_DA_REGUA = 3;

/** Uma linha de folga no alto, duas por trilho (o trilho e o respiro) e duas de régua. */
export const linhasDoTear = (trilhos: number) => 2 * trilhos + 3;
export const linhaDoTrilho = (indice: number) => 1 + 2 * indice;

export function glifoDoNo(quantidade: number): string {
  if (quantidade >= 4) return '◆';
  return quantidade >= 2 ? '●' : '•';
}

/** Coluna de um instante: o começo da janela na coluna 0, agora na penúltima. */
function coluna(pedido: PedidoDoTear, quando: number): number {
  return Math.round(((quando - pedido.inicio) / (pedido.fim - pedido.inicio)) * (pedido.cols - 2));
}

function classesDo(trilho: TrilhoDoTear): { linha: Celula; inicio: string; no: Classe } {
  if (trilho.vivo) return { linha: { ch: '━', c: 'tv' }, inicio: '┣', no: 'nv' };
  const c = trilho.parado ? 't2' : 't';
  return { linha: { ch: '─', c }, inicio: '├', no: trilho.parado ? 'n2' : 'n' };
}

/** Quantas atividades caem em cada coluna; as de antes da janela ficam de fora. */
function contarPorColuna(pedido: PedidoDoTear, atividades: number[]): Map<number, number> {
  const contagem = new Map<number, number>();
  for (const quando of atividades) {
    const col = Math.min(coluna(pedido, quando), pedido.cols - 2);
    if (col >= 0) contagem.set(col, (contagem.get(col) ?? 0) + 1);
  }
  return contagem;
}

function tecerTrilho(base: BaseDoTear, pedido: PedidoDoTear, trilho: TrilhoDoTear, row: number) {
  const ultimaCol = base.cols - 2;
  const ini = Math.min(coluna(pedido, trilho.desde), ultimaCol);
  const fim = Math.min(coluna(pedido, trilho.ultimo), ultimaCol);
  const estilo = classesDo(trilho);
  const poe = (col: number, celula: Celula) => { base.fixo[row * base.cols + col] = celula; };
  // Antes de o projeto existir, nada: o trilho nasce no dia em que o projeto foi criado.
  for (let col = Math.max(ini, 0); col <= ultimaCol; col++) poe(col, col <= fim ? estilo.linha : { ch: '·', c: 'p' });
  if (ini < 0) poe(0, { ch: '‹', c: estilo.linha.c });
  else poe(ini, { ch: estilo.inicio, c: estilo.linha.c });

  const contagem = contarPorColuna(pedido, trilho.atividades);
  for (const [col, quantidade] of contagem) {
    poe(col, { ch: glifoDoNo(quantidade), c: estilo.no });
    base.solido.add(row * base.cols + col);
  }
  if (!trilho.vivo) return;
  if (contagem.size > 0) {
    const ultimoNo = Math.max(...contagem.keys());
    poe(ultimoNo, { ch: '◉', c: 'na' });
    base.aceso = { col: ultimoNo, row };
  }
  const ate = base.aceso ? base.aceso.col : fim;
  for (let col = Math.max(ini, 0); col <= ate; col++) base.pulso.push({ col, row });
}

/** As marcas cujo rótulo cabe centrado embaixo do ┴ sem atropelar a vizinha, a borda ou o AGORA. */
function marcasQueCabem(pedido: PedidoDoTear): { col: number; inicio: number; letras: string[] }[] {
  const limite = pedido.cols - AGORA.length - FOLGA_DA_REGUA;
  const ordenadas = pedido.marcas.map(m => ({ col: coluna(pedido, m.quando), letras: [...m.rotulo] })).sort((a, b) => a.col - b.col);
  const cabem: { col: number; inicio: number; letras: string[] }[] = [];
  let livreDesde = 0;
  for (const marca of ordenadas) {
    const inicio = marca.col - Math.floor(marca.letras.length / 2);
    const fim = inicio + marca.letras.length - 1;
    if (inicio < livreDesde || fim >= limite) continue;
    cabem.push({ ...marca, inicio });
    livreDesde = fim + 1 + FOLGA_DA_REGUA;
  }
  return cabem;
}

function tecerRegua(base: BaseDoTear, pedido: PedidoDoTear) {
  const { cols, rows } = base;
  const regua = (rows - 2) * cols;
  const rodape = (rows - 1) * cols;
  for (let col = 0; col < cols - 1; col++) base.fixo[regua + col] = { ch: '─', c: 'u' };
  base.fixo[regua + cols - 1] = { ch: '┘', c: 'ag' };
  for (let row = 0; row < rows - 2; row++) base.fixo[row * cols + cols - 1] = { ch: '┊', c: 'ag' };
  [...AGORA].forEach((ch, i) => { base.fixo[rodape + cols - AGORA.length + i] = { ch, c: 'ag' }; });
  for (const marca of marcasQueCabem(pedido)) {
    base.fixo[regua + marca.col] = { ch: '┴', c: 'u' };
    marca.letras.forEach((ch, i) => { base.fixo[rodape + marca.inicio + i] = { ch, c: 'u' }; });
    // O urdume: a marca sobe pontilhada pelas casas vazias.
    for (let row = 0; row < rows - 2; row++) {
      const k = row * cols + marca.col;
      if (base.fixo[k] === VAZIO) base.fixo[k] = { ch: '┊', c: 'u' };
    }
  }
}

export function tecerBase(pedido: PedidoDoTear): BaseDoTear {
  const rows = linhasDoTear(pedido.trilhos.length);
  const base: BaseDoTear = { cols: pedido.cols, rows, fixo: Array.from({ length: pedido.cols * rows }, () => VAZIO), solido: new Set(), pulso: [], aceso: null };
  pedido.trilhos.forEach((trilho, i) => tecerTrilho(base, pedido, trilho, linhaDoTrilho(i)));
  tecerRegua(base, pedido);
  return base;
}

/** Fundo: poeira fixa e uma onda que passa devagar acendendo pontos. */
function fundo(col: number, row: number, tempo: number): Celula {
  const poeira = Math.abs(Math.sin(col * 12.9898 + row * 78.233) * 43758.5453) % 1;
  if (poeira < 0.016) return { ch: '·', c: 'd' };
  const onda = Math.sin(col * 0.09 - tempo * 0.8 + row * 0.35) * Math.sin(row * 0.7 + tempo * 0.3);
  // Só uma em cada quatro casas da crista acende: pontos soltos, nunca um traço.
  const sorteio = Math.abs(Math.sin(col * 3.7 + row * 19.1) * 9631.17) % 1;
  return onda > 0.9 && sorteio < 0.25 ? { ch: '·', c: 'd' } : VAZIO;
}

/** A tinta da brasa por cima de uma casa: o vazio vira ponto; o desenho mantém o caractere. */
function tingir(celula: Celula): Celula {
  return celula.c === ' ' || celula.c === 'd' ?{ ch: '·', c: 'b' } : { ch: celula.ch, c: 'b' };
}

/** Duas ondas saem do nó aceso, uma atrás da outra; não passam para a régua nem tocam nos nós. */
function ondas(base: BaseDoTear, quadro: Celula[][], tempo: number) {
  if (!base.aceso) return;
  const { col, row } = base.aceso;
  for (const fase of [0, 0.5]) {
    const raio = 1.2 + 3 * (((tempo / 1.6 + fase) % 1) + 1) % 1;
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -9; dc <= 9; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= base.rows - 2 || c < 0 || c >= base.cols) continue;
        if (Math.abs(Math.hypot(dc / 2, dr) - raio) >= 0.42 || base.solido.has(r * base.cols + c)) continue;
        quadro[r]![c] = tingir(quadro[r]![c]!);
      }
    }
  }
}

/**
 * O pulso: uma luz correndo pelo trilho vivo até o nó aceso, com rastro, e uma pausa no fim. Acende o
 * próprio trilho (━), nunca desenha um ponto: um ponto passaria por atividade que não existe.
 */
function pulso(base: BaseDoTear, quadro: Celula[][], tempo: number) {
  const total = base.pulso.length;
  if (total === 0) return;
  const cabeca = Math.floor((tempo * 26) % (total + 18));
  for (let atras = 0; atras <= 14; atras++) {
    const lugar = base.pulso[cabeca - atras];
    if (!lugar || base.solido.has(lugar.row * base.cols + lugar.col)) continue;
    const atual = quadro[lugar.row]![lugar.col]!;
    quadro[lugar.row]![lugar.col] = { ch: atual.ch, c: atras <= 2 ? 'bq' : 'b' };
  }
}

function grade(base: BaseDoTear, tempo: number | null): Celula[][] {
  return Array.from({ length: base.rows }, (_, row) => Array.from({ length: base.cols }, (_, col) => {
    const celula = base.fixo[row * base.cols + col]!;
    // A poeira só existe na camada viva e fora da régua.
    return celula === VAZIO && tempo !== null && row < base.rows - 2 ? fundo(col, row, tempo) : celula;
  }));
}

export function quadroDoTear(base: BaseDoTear, tempo: number): Celula[][] {
  const quadro = grade(base, tempo);
  ondas(base, quadro, tempo);
  pulso(base, quadro, tempo);
  return quadro;
}

/**
 * O que não muda com o tempo: trilhos, nós, urdume e régua. A tela pinta isto uma vez e, a cada
 * quadro, só as casas vivas por cima (pulso, ondas, poeira): pintar tudo de novo custaria caro.
 */
export function quadroFixo(base: BaseDoTear): Celula[][] {
  return grade(base, null);
}
