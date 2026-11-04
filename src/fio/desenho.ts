/**
 * Fio do projeto — o desenho que conta a história do projeto.
 *
 * Fibras saem de uma origem (a intenção), se trançam e convergem num nó a cada coisa feita,
 * e terminam num nó aceso: onde paramos. Depois dele, fios soltos, um por pendência.
 * O formato vem do projeto (a mesma semente desenha sempre o mesmo fio); os nós vêm dos dados.
 *
 * Função pura: recebe dados e medidas, devolve caminhos SVG prontos. Quem desenha é
 * src/fio/FioDoProjeto.tsx.
 */

export type TipoDoNo = 'registro' | 'tarefa' | 'cartao';

export interface NoDoFio {
  quando: string;
  tipo: TipoDoNo;
  /** O que foi feito, para a dica ao passar o mouse. */
  texto?: string;
}

export interface PedidoDoFio {
  semente: string;
  nos: NoDoFio[];
  pontasSoltas: number;
  largura: number;
  altura: number;
  fibras: number;
  /** De 0 a 1: quanto as fibras abrem entre os nós. A camada de fundo usa menos, para dar profundidade. */
  abertura?: number;
}

export interface NoDesenhado {
  x: number;
  y: number;
  tipo: TipoDoNo;
  quando: string;
  texto: string;
  ultimo: boolean;
}

export interface PontaSolta {
  d: string;
  fim: { x: number; y: number };
}

export interface DesenhoDoFio {
  largura: number;
  altura: number;
  origem: { x: number; y: number };
  /** x do último nó (ou da origem, sem nós): até ali a trança; depois, fibras abertas. */
  fimDoTrancado: number;
  fibras: string[];
  nos: NoDesenhado[];
  pontas: PontaSolta[];
}

export const MAX_NOS = 32;
export const MAX_PONTAS = 6;

type Ponto = { x: number; y: number };

interface Fibra {
  deslocamento: number;
  fase: number;
  comprimentoDaOnda: number;
}

interface Forma {
  largura: number;
  altura: number;
  centro: number;
  amplitude: number;
  frequencia: number;
  fase: number;
  abertura: number;
}

/** Gerador pseudoaleatório determinístico (mulberry32) a partir de um texto (FNV-1a). */
export function aleatorioDe(semente: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < semente.length; i++) h = Math.imul(h ^ semente.charCodeAt(i), 16777619);
  let estado = h >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** Em ordem de tempo quando todas as datas se leem; senão, na ordem recebida. */
function ordenar(nos: NoDoFio[]): { nos: NoDoFio[]; tempos: number[] | null } {
  const tempos = nos.map(n => Date.parse(n.quando));
  if (tempos.some(t => Number.isNaN(t))) return { nos: [...nos], tempos: null };
  const pares = nos.map((no, i) => ({ no, t: tempos[i]!, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  return { nos: pares.map(p => p.no), tempos: pares.map(p => p.t) };
}

/** Amostra igualmente espaçada que sempre mantém o primeiro e o último. */
function limitarNos<T>(lista: T[]): T[] {
  if (lista.length <= MAX_NOS) return lista;
  return Array.from({ length: MAX_NOS }, (_, k) => lista[Math.round((k * (lista.length - 1)) / (MAX_NOS - 1))]!);
}

/** Fração de 0 a 1 de cada nó: metade pelo tempo, metade pela ordem (nós próximos não colam). */
function fracoes(tempos: number[] | null, quantos: number): number[] {
  if (quantos === 1) return [1];
  const ordem = Array.from({ length: quantos }, (_, i) => i / (quantos - 1));
  if (!tempos) return ordem;
  const inicio = tempos[0]!;
  const vao = tempos[quantos - 1]! - inicio;
  if (vao <= 0) return ordem;
  return ordem.map((o, i) => 0.5 * o + 0.5 * ((tempos[i]! - inicio) / vao));
}

function linhaBase(forma: Forma, x: number): number {
  return forma.centro + forma.amplitude * Math.sin((2 * Math.PI * forma.frequencia * x) / forma.largura + forma.fase);
}

function ondaDaFibra(forma: Forma, fibra: Fibra, x: number): number {
  return Math.sin((2 * Math.PI * x) / (forma.largura * fibra.comprimentoDaOnda) + fibra.fase);
}

function quantosPontos(forma: Forma, comprimento: number): number {
  return limitar(Math.round(comprimento / (forma.largura / 70)), 4, 16);
}

/** Trecho entre dois nós: as fibras abrem no meio e voltam a se encontrar no nó seguinte. */
function trecho(forma: Forma, fibra: Fibra, de: Ponto, ate: Ponto): Ponto[] {
  const comprimento = ate.x - de.x;
  const n = quantosPontos(forma, comprimento);
  const peso = limitar(0.45 + 0.55 * Math.sqrt(comprimento / (forma.largura * 0.25)), 0.45, 1);
  const pontos: Ponto[] = [];
  for (let k = 1; k < n; k++) {
    const u = k / n;
    const x = de.x + comprimento * u;
    const abertura = forma.abertura * peso * Math.sin(Math.PI * u) ** 0.85;
    pontos.push({ x, y: linhaBase(forma, x) + abertura * (fibra.deslocamento + 0.25 * ondaDaFibra(forma, fibra, x)) });
  }
  pontos.push(ate);
  return pontos;
}

/** Depois do último nó: as fibras se abrem até a borda, o caminho que ainda não foi feito. */
function cauda(forma: Forma, fibra: Fibra, de: Ponto, xFinal: number): Ponto[] {
  const comprimento = xFinal - de.x;
  const n = quantosPontos(forma, comprimento);
  const pontos: Ponto[] = [];
  for (let k = 1; k <= n; k++) {
    const u = k / n;
    const x = de.x + comprimento * u;
    const abertura = forma.abertura * 0.9 * u ** 0.8;
    pontos.push({ x, y: linhaBase(forma, x) + abertura * (fibra.deslocamento + 0.25 * ondaDaFibra(forma, fibra, x)) });
  }
  return pontos;
}

/** Curva suave que passa por todos os pontos (Catmull-Rom convertida em Bézier cúbica). */
function caminhoSuave(pontos: Ponto[], forma: Forma): string {
  const cx = (v: number) => fmt(limitar(v, 0, forma.largura));
  const cy = (v: number) => fmt(limitar(v, 0, forma.altura));
  let d = `M${fmt(pontos[0]!.x)} ${fmt(pontos[0]!.y)}`;
  for (let i = 0; i < pontos.length - 1; i++) {
    const p0 = pontos[Math.max(0, i - 1)]!;
    const p1 = pontos[i]!;
    const p2 = pontos[i + 1]!;
    const p3 = pontos[Math.min(pontos.length - 1, i + 2)]!;
    d += ` C${cx(p1.x + (p2.x - p0.x) / 6)} ${cy(p1.y + (p2.y - p0.y) / 6)} ${cx(p2.x - (p3.x - p1.x) / 6)} ${cy(p2.y - (p3.y - p1.y) / 6)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return d;
}

function pontasSoltas(quantas: number, de: Ponto, forma: Forma, margem: number): PontaSolta[] {
  const total = limitar(Math.floor(Number.isFinite(quantas) ? quantas : 0), 0, MAX_PONTAS);
  // Os fios soltos param em 80% da largura: o resto é dos nomes dos grupos de pendência.
  const xFinal = forma.largura * 0.8;
  const dx = xFinal - de.x;
  return Array.from({ length: total }, (_, k) => {
    const y = forma.centro + (total === 1 ? 0 : (k / (total - 1) - 0.5) * forma.altura * 0.7);
    const d = `M${fmt(de.x)} ${fmt(de.y)} C${fmt(de.x + dx * 0.45)} ${fmt(de.y)} ${fmt(xFinal - dx * 0.4)} ${fmt(y)} ${fmt(xFinal)} ${fmt(y)}`;
    return { d, fim: { x: xFinal, y } };
  });
}

export function desenharFio(pedido: PedidoDoFio): DesenhoDoFio {
  const { largura, altura } = pedido;
  const sorte = aleatorioDe(pedido.semente);
  const forma: Forma = {
    largura, altura, centro: altura / 2, amplitude: altura * 0.08,
    frequencia: 0.6 + sorte() * 0.7, fase: sorte() * Math.PI * 2, abertura: altura * 0.3 * limitar(pedido.abertura ?? 1, 0, 1),
  };
  const margem = largura * 0.04;
  const origem = { x: margem, y: linhaBase(forma, margem) };

  const ordenados = ordenar(pedido.nos);
  const escolhidos = limitarNos(ordenados.nos.map((no, i) => ({ no, t: ordenados.tempos?.[i] ?? Number.NaN })));
  const tempos = ordenados.tempos ? escolhidos.map(e => e.t) : null;
  const temPendencia = Math.floor(pedido.pontasSoltas) > 0;
  const fimDoTrancado = escolhidos.length === 0 ? origem.x : largura * (temPendencia ? 0.62 : 0.86);
  const inicioDosNos = escolhidos.length > 1 ? origem.x + (fimDoTrancado - origem.x) * 0.12 : fimDoTrancado;
  const nos: NoDesenhado[] = fracoes(tempos, escolhidos.length).map((f, i) => {
    const x = inicioDosNos + (fimDoTrancado - inicioDosNos) * f;
    const { no } = escolhidos[i]!;
    return { x, y: linhaBase(forma, x), tipo: no.tipo, quando: no.quando, texto: no.texto ?? '', ultimo: i === escolhidos.length - 1 };
  });

  const quantasFibras = limitar(Math.round(pedido.fibras), 1, 40);
  const fibras = Array.from({ length: quantasFibras }, (_, j) => {
    const base = quantasFibras === 1 ? 0 : -1 + (2 * j) / (quantasFibras - 1);
    const fibra: Fibra = {
      deslocamento: limitar(base + (sorte() - 0.5) * 0.16, -1, 1),
      fase: sorte() * Math.PI * 2,
      comprimentoDaOnda: 0.12 + sorte() * 0.18,
    };
    const pontos: Ponto[] = [origem];
    let anterior: Ponto = origem;
    for (const no of nos) {
      pontos.push(...trecho(forma, fibra, anterior, no));
      anterior = no;
    }
    pontos.push(...cauda(forma, fibra, anterior, largura - margem));
    return caminhoSuave(pontos, forma);
  });

  const deOnde = nos.at(-1) ?? origem;
  return { largura, altura, origem, fimDoTrancado, fibras, nos, pontas: pontasSoltas(pedido.pontasSoltas, deOnde, forma, margem) };
}

const DATA_CURTA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short' });

/** "31 out": dia e mês abreviado no fuso do dono; vazio quando a data não se lê. */
export function rotuloCurtoDaData(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const partes = DATA_CURTA.formatToParts(t);
  // Com day e month pedidos no formatador, as duas partes sempre vêm.
  const dia = partes.find(p => p.type === 'day')!.value;
  const mes = partes.find(p => p.type === 'month')!.value.replace('.', '');
  return `${dia} ${mes}`;
}

export interface MarcaDoMes {
  x: number;
  rotulo: string;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** São Paulo, sem horário de verão: meia-noite local é 3h em UTC. */
const FUSO_DO_DONO_MS = 3 * 60 * 60 * 1000;
const MAX_MARCAS = 8;

/** Primeiro instante de cada mês (no fuso do dono) depois de `inicio` e até `fim`. */
function viradasDeMes(inicio: number, fim: number): { t: number; mes: number; ano: number }[] {
  const local = new Date(inicio - FUSO_DO_DONO_MS);
  let ano = local.getUTCFullYear();
  let mes = local.getUTCMonth() + 1;
  const viradas: { t: number; mes: number; ano: number }[] = [];
  for (;;) {
    if (mes === 12) { mes = 0; ano++; }
    const t = Date.UTC(ano, mes, 1) + FUSO_DO_DONO_MS;
    if (t > fim) return viradas;
    viradas.push({ t, mes, ano });
    mes++;
  }
}

/** A régua do tempo embaixo do fio: onde cada mês começa, interpolado entre os nós vizinhos. */
export function marcasDosMeses(nos: NoDesenhado[]): MarcaDoMes[] {
  const tempos = nos.map(n => Date.parse(n.quando));
  if (nos.length < 2 || tempos.some(t => Number.isNaN(t))) return [];
  const marcas = viradasDeMes(tempos[0]!, tempos.at(-1)!).map(v => {
    // A virada pode cair exatamente no último nó: o par usado é sempre um par que existe.
    const i = Math.min(tempos.findLastIndex(t => t <= v.t), nos.length - 2);
    const vao = tempos[i + 1]! - tempos[i]!;
    const fracao = vao > 0 ? (v.t - tempos[i]!) / vao : 1;
    const x = nos[i]!.x + (nos[i + 1]!.x - nos[i]!.x) * fracao;
    return { x, rotulo: v.mes === 0 ? `jan ${String(v.ano).slice(2)}` : MESES[v.mes]! };
  });
  const passo = Math.ceil(marcas.length / MAX_MARCAS);
  return marcas.filter((_, i) => i % passo === 0);
}
