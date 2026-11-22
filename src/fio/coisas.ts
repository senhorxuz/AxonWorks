/**
 * Coisas feitas: a carta de "Onde paramos" vista como uma lista só, em ordem de tempo.
 * É a entrada de todas as regras do fio (trilhos, tecer, régua, resumo).
 */
import type { Carta, ItemFeito } from '../../shared/carta';

export type TipoDaCoisa = 'tarefa' | 'cartao' | 'registro';

export interface CoisaFeita {
  /** `${origem}:${id}`: nunca só o id, que se repete entre origens. */
  chave: string;
  quando: string;
  tipo: TipoDaCoisa;
  quem?: string;
  peloDono?: boolean;
  texto: string;
}

/** Empate no mesmo instante: tarefa, depois cartão, depois registro. */
const ORDEM_DO_TIPO: Record<TipoDaCoisa, number> = { tarefa: 0, cartao: 1, registro: 2 };

const DIA_DO_DONO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Quantas datas guardar na memória do `diaDe`: o fio refaz a conta de dia muitas vezes sobre as mesmas datas. */
const LIMITE_DA_MEMORIA_DE_DIAS = 5000;
const diasJaCalculados = new Map<string, string>();

/** 'AAAA-MM-DD' no fuso de São Paulo; '' quando a data não se lê. É a única conta de dia do fio e da lista. */
export function diaDe(iso: string): string {
  const guardado = diasJaCalculados.get(iso);
  if (guardado !== undefined) return guardado;
  const instante = Date.parse(iso);
  const dia = Number.isNaN(instante) ? '' : DIA_DO_DONO.format(instante);
  if (diasJaCalculados.size >= LIMITE_DA_MEMORIA_DE_DIAS) diasJaCalculados.clear();
  diasJaCalculados.set(iso, dia);
  return dia;
}

/** Diferença de datas entre dois dias 'AAAA-MM-DD' (de 1/11 a 8/11 são 7). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function daCoisa(item: ItemFeito): CoisaFeita {
  const coisa: CoisaFeita = { chave: `${item.origem}:${item.id}`, quando: item.quando, tipo: item.origem, texto: item.texto };
  if (item.quem !== undefined) coisa.quem = item.quem;
  if (item.peloDono) coisa.peloDono = true;
  return coisa;
}

/** Em ordem de tempo; empate no mesmo instante: tarefa, cartão, registro; o resto, na ordem recebida. Só para datas que se leem. */
export function emOrdemDeTempo(coisas: CoisaFeita[]): CoisaFeita[] {
  return coisas
    .map((coisa, ordem) => ({ coisa, t: Date.parse(coisa.quando), ordem }))
    .sort((a, b) => a.t - b.t || ORDEM_DO_TIPO[a.coisa.tipo] - ORDEM_DO_TIPO[b.coisa.tipo] || a.ordem - b.ordem)
    .map(c => c.coisa);
}

/** Junta feitoRecente e feitoPorMes sem repetir (vale a primeira vista) e ordena por tempo. Data que não se lê vai para `semData`. */
export function coisasDaCarta(carta: Pick<Carta, 'feitoRecente' | 'feitoPorMes'>): { validas: CoisaFeita[]; semData: CoisaFeita[] } {
  const vistas = new Set<string>();
  const validas: CoisaFeita[] = [];
  const semData: CoisaFeita[] = [];
  const todos: ItemFeito[] = [...carta.feitoRecente, ...carta.feitoPorMes.flatMap(mes => mes.itens)];
  for (const item of todos) {
    const coisa = daCoisa(item);
    if (vistas.has(coisa.chave)) continue;
    vistas.add(coisa.chave);
    (Number.isNaN(Date.parse(coisa.quando)) ? semData : validas).push(coisa);
  }
  return { validas: emOrdemDeTempo(validas), semData };
}
