/**
 * Aperto do fio: o que esconder, atrás de um `+N`, quando as coisas de um dia não cabem nas colunas.
 *
 * Funções puras sobre as coisas já postas nos trilhos. Duas formas de esconder:
 * - `iguaisSeguidos`: mais de 12 símbolos iguais (mesmo dia e trilho) mostram 10 e o `+N`;
 * - `porTrecho`: último recurso, qualquer símbolo. Cada trecho (mesmo dia e trilho, em sequência) mostra os
 *   `k` primeiros e um `+N` com o resto; o `◉` (a última coisa) nunca é escondido.
 */
import type { CoisaNoTrilho } from './trilhos';

export interface Compressao {
  /** Índices que não viram símbolo. */
  ocultas: Set<number>;
  /** `+N` que entra depois da coisa de cada índice (o índice pode ser de uma coisa oculta). */
  maisApos: Map<number, number>;
  /** As primeiras coisas que somem sob um só `+N` no começo. */
  omitidas: number;
}

const MAX_IGUAIS = 12;
const IGUAIS_QUE_FICAM = 10;

export const semCompressao = (): Compressao => ({ ocultas: new Set(), maisApos: new Map(), omitidas: 0 });

/** Sequências com mais de 12 símbolos iguais (mesmo dia, mesmo trilho): ficam 10 e o resto some atrás de um `+N`. */
export function iguaisSeguidos(coisas: CoisaNoTrilho[]): Compressao {
  const compressao = semCompressao();
  const simbolo = (i: number) => (i === coisas.length - 1 ? 'agora' : coisas[i]!.tipo);
  let i = 0;
  while (i < coisas.length) {
    let fim = i + 1;
    while (fim < coisas.length && coisas[fim]!.dia === coisas[i]!.dia && coisas[fim]!.trilho === coisas[i]!.trilho && simbolo(fim) === simbolo(i)) fim++;
    if (fim - i > MAX_IGUAIS) {
      compressao.maisApos.set(i + IGUAIS_QUE_FICAM - 1, fim - i - IGUAIS_QUE_FICAM);
      for (let oculta = i + IGUAIS_QUE_FICAM; oculta < fim; oculta++) compressao.ocultas.add(oculta);
    }
    i = fim;
  }
  return compressao;
}

/** Os trechos [início, fim) de coisas seguidas no mesmo dia e trilho. */
function trechosDe(coisas: CoisaNoTrilho[]): [number, number][] {
  const trechos: [number, number][] = [];
  let inicio = 0;
  for (let i = 1; i <= coisas.length; i++) {
    if (i === coisas.length || coisas[i]!.dia !== coisas[inicio]!.dia || coisas[i]!.trilho !== coisas[inicio]!.trilho) {
      trechos.push([inicio, i]);
      inicio = i;
    }
  }
  return trechos;
}

/** Onde começa o último trecho (o do `◉`). */
export const inicioDoUltimoTrecho = (coisas: CoisaNoTrilho[]): number => trechosDe(coisas).at(-1)![0];

/** Cada trecho a partir de `desde` mostra os `k` primeiros; o resto vira `+N`, menos o `◉`, que fica sempre. */
function porTrecho(coisas: CoisaNoTrilho[], k: number, desde: number): Compressao {
  const compressao = semCompressao();
  compressao.omitidas = desde;
  for (const [inicio, fim] of trechosDe(coisas)) {
    if (inicio < desde) continue;
    const escondidas = fim - inicio - k - (fim === coisas.length ? 1 : 0);
    if (escondidas <= 0) continue;
    compressao.maisApos.set(k === 0 ? inicio : inicio + k - 1, escondidas);
    for (let oculta = inicio + k; oculta < inicio + k + escondidas; oculta++) compressao.ocultas.add(oculta);
  }
  return compressao;
}

/** O maior `k` (de `minimo` em diante) em que `cabe` ainda dá certo; `null` se nem o `minimo` cabe. Procura por bisseção. */
function maiorK(coisas: CoisaNoTrilho[], desde: number, minimo: number, cabe: (compressao: Compressao) => boolean): Compressao | null {
  const maior = Math.max(...trechosDe(coisas).filter(([inicio]) => inicio >= desde).map(([inicio, fim]) => fim - inicio));
  if (!cabe(porTrecho(coisas, minimo, desde))) return null;
  if (cabe(porTrecho(coisas, maior, desde))) return porTrecho(coisas, maior, desde);
  let bom = minimo;
  let ruim = maior;
  while (ruim - bom > 1) {
    const meio = (bom + ruim) >> 1;
    if (cabe(porTrecho(coisas, meio, desde))) bom = meio;
    else ruim = meio;
  }
  return porTrecho(coisas, bom, desde);
}

/**
 * Último recurso: o que ainda cabe, em ordem de preferência. (1) os primeiros símbolos de cada trecho e um `+N`;
 * (2) só o trecho do `◉` (os anteriores somem sob um `+N` no começo); (3) só o `◉`, atrás de um `+N`.
 */
export function apertarPorTrecho(coisas: CoisaNoTrilho[], cabe: (compressao: Compressao) => boolean): Compressao {
  const ultimo = inicioDoUltimoTrecho(coisas);
  return maiorK(coisas, 0, 0, cabe) ?? maiorK(coisas, ultimo, 1, cabe) ?? { ...semCompressao(), omitidas: coisas.length - 1 };
}
