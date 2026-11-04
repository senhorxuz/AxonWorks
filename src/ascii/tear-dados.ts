/**
 * Tear — de onde vêm os trilhos, a régua do tempo e os textos ao lado.
 *
 * A lista de projetos só diz quando cada um nasceu e quando mudou pela última vez. As atividades de
 * verdade (cartões concluídos, entregas de tarefa, registros) vêm da carta de cada projeto, a mesma
 * de "Onde paramos". Enquanto a carta não chega, ou se ela falhar, o trilho fica sem nós e o texto
 * diz isso: o Tear nunca desenha atividade que não leu.
 */
import type { Carta } from '../../shared/carta';
import type { Project } from '../../shared/types';
import type { MarcaDaRegua, TrilhoDoTear } from './tear';

export const PROJETOS_NO_TEAR = 6;
/** Sem mexer há mais que isso, o projeto aparece apagado. */
const DIAS_PARA_PARADO = 7;
const FUSO_DO_DONO = 'America/Sao_Paulo';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
/** Mais que 90 dias espremeria tudo: o que nasceu antes começa com ‹ na borda. */
const JANELA_MAXIMA = 90 * DIA;
/** Folga para o projeto mais antigo não nascer colado na borda. */
const FOLGA_DA_JANELA = 1.06;
/** Passos da régua, em minutos: o menor que deixa as marcas a pelo menos 12 colunas umas das outras. */
const PASSOS_EM_MINUTOS = [10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10_080, 43_200];
const PASSO_DO_DIA = 1440;
const PASSO_DO_MES = 43_200;
const COLUNAS_ENTRE_MARCAS = 12;
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

export type Historico = { estado: 'lendo' } | { estado: 'erro' } | { estado: 'pronto'; quando: number[] };

export function escolherProjetos(projetos: readonly Project[], max = PROJETOS_NO_TEAR): { visiveis: Project[]; resto: number } {
  const ordenados = [...projetos].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return { visiveis: ordenados.slice(0, max), resto: Math.max(0, ordenados.length - max) };
}

/** Os instantes de tudo o que foi feito no projeto, do mais antigo para o mais novo. */
export function atividadesDaCarta(carta: Pick<Carta, 'feitoRecente' | 'feitoPorMes'>): number[] {
  return [...carta.feitoRecente, ...carta.feitoPorMes.flatMap(mes => mes.itens)].map(item => Date.parse(item.quando)).sort((a, b) => a - b);
}

const lido = (historico: Historico): number[] => (historico.estado === 'pronto' ? historico.quando : []);

/** A última vez que o projeto mexeu: a mudança mais nova do projeto ou a última coisa feita. */
export function ultimaVez(projeto: Project, historico: Historico): number {
  return Math.max(Date.parse(projeto.updatedAt), ...lido(historico));
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function haQuanto(quando: number, agora: number): string {
  const passou = Math.max(0, agora - quando);
  if (passou < MINUTO) return 'agora mesmo';
  if (passou < HORA) return `há ${Math.floor(passou / MINUTO)} min`;
  if (passou < DIA) return `há ${Math.floor(passou / HORA)} h`;
  const dias = Math.floor(passou / DIA);
  if (dias < 30) return `há ${plural(dias, 'dia', 'dias')}`;
  if (dias < 365) return `há ${plural(Math.floor(dias / 30), 'mês', 'meses')}`;
  return `há ${plural(Math.floor(dias / 365), 'ano', 'anos')}`;
}

function quantoFoiFeito(historico: Historico): string {
  if (historico.estado === 'lendo') return 'lendo…';
  if (historico.estado === 'erro') return 'sem histórico';
  return historico.quando.length === 0 ? 'nada feito ainda' : plural(historico.quando.length, 'coisa feita', 'coisas feitas');
}

/** "há 2 h · 18 coisas feitas": o texto embaixo do nome do projeto. */
export function rotuloDoProjeto(projeto: Project, historico: Historico, agora: number): string {
  return `${haQuanto(ultimaVez(projeto, historico), agora)} · ${quantoFoiFeito(historico)}`;
}

export function resumoDoTear(total: number): string {
  const contagem = plural(total, 'projeto', 'projetos');
  return total > PROJETOS_NO_TEAR ? `${contagem} · os ${PROJETOS_NO_TEAR} mais recentes` : contagem;
}

/** O projeto cuja carta ainda não chegou está sendo lido. */
export const historicoDe = (historicos: Record<string, Historico>, id: string): Historico => historicos[id] ?? { estado: 'lendo' };

/** O que o Tear mostra, em palavras, para quem usa leitor de tela. */
export function fraseDoTear(visiveis: Project[], total: number, historicos: Record<string, Historico>, agora: number): string {
  const inicio = `Sua memória: ${resumoDoTear(total)}.`;
  const recente = visiveis[0];
  if (!recente) return inicio;
  return `${inicio} O mais recente, aceso, é ${recente.name}, com atividade ${haQuanto(ultimaVez(recente, historicoDe(historicos, recente.id)), agora)}.`;
}

/**
 * A janela, terminando agora, que mostra desde o nascimento do projeto mais antigo: toda a largura
 * vira tempo com história. Arredonda para 10 minutos, horas ou dias inteiros (conforme a idade), para
 * a escala não escorregar a cada minuto.
 */
export function janelaDoTempo(desde: number, agora: number): { inicio: number; fim: number } {
  const idade = Math.max(0, agora - desde) * FOLGA_DA_JANELA;
  const unidade = idade < HORA ? 10 * MINUTO : idade < DIA ? HORA : DIA;
  const tamanho = Math.min(JANELA_MAXIMA, Math.max(10 * MINUTO, Math.ceil(idade / unidade) * unidade));
  return { inicio: agora - tamanho, fim: agora };
}

const PARTES = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_DO_DONO, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});

function partesDe(quando: number) {
  const p = Object.fromEntries(PARTES.formatToParts(quando).map(parte => [parte.type, Number(parte.value)]));
  const semana = new Date(Date.UTC(p.year!, p.month! - 1, p.day!)).getUTCDay();
  return { minuto: p.minute!, hora: p.hour!, dia: p.day!, mes: p.month!, semana };
}

type Partes = ReturnType<typeof partesDe>;

/**
 * O instante cai no passo? Até uma hora, a régua já anda no próprio passo, então todo instante cai.
 * Depois: horas redondas; dias à meia-noite; um dia sim, outro não; semanas na segunda; meses no dia 1.
 */
function caiNoPasso(p: Partes, passo: number): boolean {
  if (passo <= 60) return true;
  if (passo < PASSO_DO_DIA) return p.hora % (passo / 60) === 0;
  if (p.hora !== 0) return false;
  if (passo === PASSO_DO_DIA) return true;
  if (passo === 2 * PASSO_DO_DIA) return p.dia % 2 === 1;
  if (passo === 7 * PASSO_DO_DIA) return p.semana === 1;
  return p.dia === 1;
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

function rotuloDaMarca(p: Partes, passo: number): string {
  if (passo === PASSO_DO_MES) return MESES[p.mes - 1]!;
  if (p.minuto !== 0) return `${doisDigitos(p.hora)}:${doisDigitos(p.minuto)}`;
  if (p.hora !== 0) return `${doisDigitos(p.hora)}h`;
  return `${doisDigitos(p.dia)} ${MESES[p.mes - 1]}`;
}

/** As marcas da régua no fuso do dono, com o passo que cabe na largura. */
export function marcasDaRegua(janela: { inicio: number; fim: number }, cols: number): MarcaDaRegua[] {
  const colunasPorMinuto = (cols - 2) / ((janela.fim - janela.inicio) / MINUTO);
  let passo = PASSOS_EM_MINUTOS[0]!;
  for (const minutos of PASSOS_EM_MINUTOS) {
    passo = minutos;
    if (minutos * colunasPorMinuto >= COLUNAS_ENTRE_MARCAS) break;
  }
  const incremento = Math.min(passo, 60) * MINUTO;
  const marcas: MarcaDaRegua[] = [];
  for (let quando = Math.ceil(janela.inicio / incremento) * incremento; quando <= janela.fim; quando += incremento) {
    const p = partesDe(quando);
    if (caiNoPasso(p, passo)) marcas.push({ quando, rotulo: rotuloDaMarca(p, passo) });
  }
  return marcas;
}

/** Um trilho por projeto visível, na mesma ordem: o primeiro (o mais recente) é o vivo. */
export function trilhosDoTear(visiveis: Project[], historicos: Record<string, Historico>, agora: number): TrilhoDoTear[] {
  return visiveis.map((projeto, i) => {
    const historico = historicoDe(historicos, projeto.id);
    const ultimo = ultimaVez(projeto, historico);
    return { desde: Date.parse(projeto.createdAt), ultimo, atividades: lido(historico), vivo: i === 0, parado: agora - ultimo > DIAS_PARA_PARADO * DIA };
  });
}
