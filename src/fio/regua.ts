/**
 * Régua do fio: o dia do mês sob o primeiro símbolo de cada dia, o mês sob o primeiro dia rotulado de
 * cada mês e, no fim, "21 nov · onde paramos" terminando sob o `◉`. Rótulo que encavala some, de trás para a frente.
 */
import { MESES, diaEMes } from './datas';
import type { Desenho } from './tecer';

export interface RotuloDaRegua {
  /** Coluna onde o texto começa. */
  col: number;
  texto: string;
  tipo: 'dia' | 'mes' | 'agora';
}

/** Casas livres entre dois rótulos de dia (os dias têm até 2 dígitos, mais uma casa de respiro). */
const ESPACO_ENTRE_DIAS = 3;

/**
 * Quais rótulos cabem numa linha sem encavalar: o último sempre aparece; andando para trás,
 * cada um só entra se ficar a pelo menos `espaco` do vizinho já escolhido. O vizinho do último precisa ficar
 * a `espacoDoUltimo`. Devolve os índices em ordem.
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

const diaDoMes = (dia: string) => Number(dia.slice(8));
const mesDe = (dia: string) => dia.slice(0, 7);

/** "nov"; janeiro leva o ano ("jan 27"). */
function rotuloDoMes(dia: string): string {
  const mes = Number(dia.slice(5, 7)) - 1;
  return mes === 0 ? `jan ${dia.slice(2, 4)}` : MESES[mes]!;
}

/** O mês vai no primeiro dia que ficou rotulado; o dia do "onde paramos" já traz o mês no texto. */
function mesesDosDias(dias: { col: number; dia: string }[]): RotuloDaRegua[] {
  const meses: RotuloDaRegua[] = [];
  let anterior = '';
  for (const { col, dia } of dias) {
    if (mesDe(dia) === anterior) continue;
    anterior = mesDe(dia);
    meses.push({ col, texto: rotuloDoMes(dia), tipo: 'mes' });
  }
  return meses;
}

/** Meses que encavalam somem, de trás para a frente (o mais novo fica). */
function semEncavalar(meses: RotuloDaRegua[]): RotuloDaRegua[] {
  const ficam: RotuloDaRegua[] = [];
  for (const mes of meses.toReversed()) {
    const seguinte = ficam.at(-1);
    if (!seguinte || mes.col + mes.texto.length + 1 <= seguinte.col) ficam.push(mes);
  }
  return ficam.reverse();
}

/** Os rótulos da régua, dias e "onde paramos" primeiro (em ordem), depois os meses. */
export function rotulosDaRegua(desenho: Desenho): RotuloDaRegua[] {
  const ultimo = desenho.dias.at(-1);
  if (!ultimo) return [];
  const texto = `${diaEMes(ultimo.dia)} · onde paramos`;
  const agora: RotuloDaRegua = { col: Math.max(0, desenho.fim.col - texto.length + 1), texto, tipo: 'agora' };
  const candidatos = [...desenho.dias.slice(0, -1), { col: agora.col, dia: ultimo.dia }];
  const ficam = quaisRotular(candidatos.map(d => d.col), ESPACO_ENTRE_DIAS).map(i => candidatos[i]!);
  const dias: RotuloDaRegua[] = ficam.slice(0, -1).map(d => ({ col: d.col, texto: String(diaDoMes(d.dia)), tipo: 'dia' }));
  const meses = semEncavalar(mesesDosDias(ficam.slice(0, -1)));
  return [...dias, agora, ...meses];
}
