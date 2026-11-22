/** Datas do fio, sempre no fuso do dono (America/Sao_Paulo). */

export const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

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

/** "5 nov": o dia (sem zero à esquerda) e o mês abreviado de um dia 'AAAA-MM-DD'. */
export function diaEMes(dia: string): string {
  return `${Number(dia.slice(8))} ${MESES[Number(dia.slice(5, 7)) - 1]!}`;
}
