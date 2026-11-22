/**
 * Os textos pequenos de "O que foi feito": a data e a assinatura de cada dia, a hora e a assinatura de cada linha.
 * Funções puras; quem desenha é ./ColunaFeito.tsx.
 */
import { diaEMes } from '../fio/datas';
import { rotuloDaFamilia } from '../fio/trilhos';
import type { DiaDoFeito, LinhaDoFeito } from './dias';
import { contar } from './texto';

const SEMANA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long' });
const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const NOME_DO_TIPO = { tarefa: 'Entrega', cartao: 'Cartão concluído', registro: '' } as const;

/** "21 nov"; o grupo das coisas sem data diz "Sem data". */
export function dataDoDia(dia: string): string {
  return dia === '' ? 'Sem data' : diaEMes(dia);
}

/** "sábado". O dia já vem no fuso do dono; o meio-dia em UTC cai sempre no mesmo dia do calendário. */
export function diaDaSemana(dia: string): string {
  return dia === '' ? '' : SEMANA.format(new Date(`${dia}T12:00:00.000Z`));
}

function juntar(nomes: string[]): string {
  return nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)!}`;
}

/** "7 coisas" e "Claude e Codex": quanto foi feito no dia e por quem. */
export function assinaturaDoDia(dia: DiaDoFeito): { coisas: string; familias: string } {
  return { coisas: contar(dia.linhas.length, 'coisa', 'coisas'), familias: juntar(dia.familias) };
}

/** "23:37" em São Paulo; linha sem data não tem hora. */
export function horaDaLinha(linha: LinhaDoFeito): string {
  return linha.semData ? '' : HORA.format(new Date(linha.quando));
}

/** O que vai embaixo do texto aberto: sempre o tipo (entrega, cartão concluído; o registro não tem) e quem fez. */
export function assinaturaDaLinha(linha: LinhaDoFeito): string {
  const quem = linha.peloDono ? 'pelo dono' : rotuloDaFamilia(linha.quem);
  return [NOME_DO_TIPO[linha.tipo], quem].filter(Boolean).join(' · ');
}

/** A linha "Onde paramos" não repete a frase que já está no alto da tela. */
export function repeteAManchete(texto: string, manchete: string | null): boolean {
  return Boolean(manchete?.trim()) && texto.trim() === manchete!.trim();
}
