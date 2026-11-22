/**
 * Trilhos do fio: uma linha por IA (por família de nome), no máximo seis.
 *
 * "Claude", "Claude Opus 5.5" e "claude-opus-5.5 (Claude Code)" são a mesma IA: o trilho é a
 * primeira sequência de letras do nome declarado, sem caixa e sem acento para comparar.
 */
import { diaDe, type CoisaFeita } from './coisas';

export interface Trilho {
  /** A família em minúsculas e sem acento; '' é "Sem nome"; '*outras' é o trilho que junta as de menos coisas. */
  chave: string;
  rotulo: string;
  total: number;
  /** Os nomes declarados completos, sem repetir, na ordem em que apareceram. */
  nomes: string[];
  outras: boolean;
}

export interface CoisaNoTrilho extends CoisaFeita {
  /** 'AAAA-MM-DD' em São Paulo. */
  dia: string;
  /** Índice do trilho em `trilhos`. */
  trilho: number;
}

export const MAX_TRILHOS = 6;

const CHAVE_DAS_OUTRAS = '*outras';
const ROTULO_DAS_OUTRAS = 'Outras IAs';
const SEM_NOME = 'Sem nome';

/** A primeira sequência de letras como veio escrita; sem letra nenhuma, a primeira de letras e números. '4o' fica '4o'. */
function formaDoNome(nome: string | undefined): string {
  const limpo = (nome ?? '').normalize('NFC');
  return (limpo.match(/\p{N}*[\p{L}\p{M}]+/u) ?? limpo.match(/[\p{L}\p{M}\p{N}]+/u))?.[0] ?? '';
}

/** Chave de comparação: '' quando não há nome. */
export function familiaDe(nome: string | undefined): string {
  return formaDoNome(nome).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** O rótulo de um nome: 'Claude', 'Fundação'; 'Sem nome' quando não há. */
export function rotuloDaFamilia(nome: string | undefined): string {
  const forma = formaDoNome(nome);
  if (forma === '') return SEM_NOME;
  return forma[0]!.toUpperCase() + forma.slice(1).toLowerCase();
}

/** Quantas IAs diferentes: famílias com nome, sem contar "Sem nome" nem cartão do dono. */
export function contarIAs(coisas: CoisaFeita[]): number {
  const familias = new Set(coisas.filter(c => !c.peloDono).map(c => familiaDe(c.quem)));
  familias.delete('');
  return familias.size;
}

/** A família de cada coisa. Cartão do dono herda a da anterior (já resolvida); sem anterior, a da seguinte que não é do dono. */
function familiasResolvidas(coisas: CoisaFeita[]): string[] {
  const proprias = coisas.map(c => (c.peloDono ? null : familiaDe(c.quem)));
  const resolvidas: string[] = [];
  proprias.forEach((propria, i) => {
    resolvidas.push(propria ?? (i > 0 ? resolvidas[i - 1]! : (proprias.find(f => f !== null) ?? '')));
  });
  return resolvidas;
}

interface Familia {
  chave: string;
  total: number;
  formas: Map<string, number>;
  nomes: Set<string>;
}

/** As famílias na ordem da primeira aparição, com total, formas escritas e nomes declarados. */
function reunirFamilias(coisas: CoisaFeita[], resolvidas: string[]): Familia[] {
  const porChave = new Map<string, Familia>();
  coisas.forEach((c, i) => {
    const chave = resolvidas[i]!;
    let familia = porChave.get(chave);
    if (!familia) {
      familia = { chave, total: 0, formas: new Map(), nomes: new Set() };
      porChave.set(chave, familia);
    }
    familia.total++;
    if (c.peloDono) return;
    const forma = rotuloDaFamilia(c.quem);
    familia.formas.set(forma, (familia.formas.get(forma) ?? 0) + 1);
    if (c.quem) familia.nomes.add(c.quem);
  });
  return [...porChave.values()];
}

/** A forma mais frequente; empate, a que apareceu primeiro. */
function rotuloDaMaisFrequente(formas: Map<string, number>): string {
  let melhor = SEM_NOME;
  let quantas = 0;
  for (const [forma, n] of formas) {
    if (n > quantas) { melhor = forma; quantas = n; }
  }
  return melhor;
}

/** Passando de seis famílias, ficam as cinco com mais coisas (empate: a que apareceu antes); as demais viram "Outras IAs". */
function quaisJuntar(familias: Familia[]): Set<Familia> {
  if (familias.length <= MAX_TRILHOS) return new Set();
  const ranking = familias
    .map((familia, i) => ({ familia, i }))
    .sort((a, b) => b.familia.total - a.familia.total || a.i - b.i);
  return new Set(ranking.slice(MAX_TRILHOS - 1).map(r => r.familia));
}

function trilhoDe(familia: Familia): Trilho {
  return { chave: familia.chave, rotulo: rotuloDaMaisFrequente(familia.formas), total: familia.total, nomes: [...familia.nomes], outras: false };
}

function trilhoDasOutras(juntas: Familia[]): Trilho {
  return {
    chave: CHAVE_DAS_OUTRAS,
    rotulo: ROTULO_DAS_OUTRAS,
    total: juntas.reduce((soma, f) => soma + f.total, 0),
    nomes: [...new Set(juntas.flatMap(f => [...f.nomes]))],
    outras: true,
  };
}

/** Distribui as coisas pelos trilhos (no máximo 6), na ordem em que cada IA apareceu pela primeira vez. */
export function trilhosDe(coisas: CoisaFeita[]): { coisas: CoisaNoTrilho[]; trilhos: Trilho[] } {
  const resolvidas = familiasResolvidas(coisas);
  const familias = reunirFamilias(coisas, resolvidas);
  const juntas = quaisJuntar(familias);
  const ficam = familias.filter(f => !juntas.has(f));
  const trilhos = ficam.map(trilhoDe);
  const indice = new Map(ficam.map((f, i) => [f.chave, i]));
  if (juntas.size > 0) {
    trilhos.push(trilhoDasOutras(familias.filter(f => juntas.has(f))));
    for (const f of juntas) indice.set(f.chave, trilhos.length - 1);
  }
  return {
    coisas: coisas.map((c, i) => ({ ...c, dia: diaDe(c.quando), trilho: indice.get(resolvidas[i]!)! })),
    trilhos,
  };
}
