/**
 * Regras da lista "O que foi feito": agrupa as coisas feitas por dia (fuso de São Paulo, o do dono),
 * decide qual dia abre e qual linha é "Onde paramos". Módulo puro: sem tela, sem relógio, sem I/O.
 * Desenho 5.3 de 22/11/2026.
 */
import type { Carta, ItemFeito } from '../../shared/carta.ts'
import { fechoDoDia } from './lide.ts'
import { diaDe } from '../fio/coisas'
import { familiaDe, rotuloDaFamilia } from '../fio/trilhos'

export interface LinhaDoFeito {
  chave: string
  quando: string
  tipo: 'tarefa' | 'cartao' | 'registro'
  quem?: string
  peloDono?: boolean
  texto: string
  semData: boolean
}

/** `dia` vazio ('') é o grupo das coisas com data inválida: fica sempre no fim de `recentes`. */
export interface DiaDoFeito {
  dia: string
  linhas: LinhaDoFeito[]
  familias: string[]
  fecho: string
}

export interface MesDoFeito {
  mes: string
  quantidade: number
  dias: DiaDoFeito[]
}

export interface ListaDoFeito {
  recentes: DiaDoFeito[]
  meses: MesDoFeito[]
  diaAberto: string | null
  chaveDeOndeParamos: string | null
}

const DIA_SEM_DATA = ''

/** Famílias que trabalharam nas linhas, na ordem em que aparecem; o que foi feito pelo dono não entra. */
function familiasDasLinhas(linhas: LinhaDoFeito[]): string[] {
  const vistas = new Map<string, string>()
  for (const linha of linhas) {
    if (linha.peloDono === true) continue
    const chave = familiaDe(linha.quem)
    if (!vistas.has(chave)) vistas.set(chave, rotuloDaFamilia(linha.quem))
  }
  return [...vistas.values()]
}

// ---------------------------------------------------------------------------------------------
// Coleta e ordem
// ---------------------------------------------------------------------------------------------

interface Candidata {
  linha: LinhaDoFeito
  /** `null` = data inválida. */
  dia: string | null
  instante: number
  /** A posição em que chegou: no mesmo instante e do mesmo tipo, a última recebida vence (como o ◉ do fio). */
  ordem: number
  /** `null` = veio de `feitoRecente`. */
  mes: string | null
}

/** Mesmo instante: o registro fica em cima, depois o cartão, depois a tarefa (o inverso da ordem do fio). */
const PRIORIDADE_NO_EMPATE: Record<LinhaDoFeito['tipo'], number> = { registro: 0, cartao: 1, tarefa: 2 }

function linhaDe(item: ItemFeito, semData: boolean): LinhaDoFeito {
  return {
    chave: `${item.origem}:${item.id}`,
    quando: item.quando,
    tipo: item.origem,
    ...(item.quem === undefined ? {} : { quem: item.quem }),
    ...(item.peloDono === true ? { peloDono: true } : {}),
    texto: item.texto,
    semData,
  }
}

function candidataDe(item: ItemFeito, mes: string | null, ordem: number): Candidata {
  const dia = diaDe(item.quando) || null
  return { linha: linhaDe(item, dia === null), dia, instante: Date.parse(item.quando), ordem, mes }
}

/** Junta `feitoRecente` e os meses sem repetir (a mesma origem e id entra uma vez; o recente vale). */
function coletar(carta: Pick<Carta, 'feitoRecente' | 'feitoPorMes'>): Candidata[] {
  const vistas = new Set<string>()
  const todas: Candidata[] = []
  const entrar = (item: ItemFeito, mes: string | null): void => {
    const candidata = candidataDe(item, mes, todas.length)
    if (vistas.has(candidata.linha.chave)) return
    vistas.add(candidata.linha.chave)
    todas.push(candidata)
  }
  for (const item of carta.feitoRecente) entrar(item, null)
  for (const { mes, itens } of carta.feitoPorMes) for (const item of itens) entrar(item, mes)
  return todas
}

/** Do mais novo para o mais velho; data inválida no fim, na ordem em que chegou. */
function compararCandidatas(a: Candidata, b: Candidata): number {
  if (a.dia === null || b.dia === null) return Number(a.dia === null) - Number(b.dia === null)
  return b.instante - a.instante || PRIORIDADE_NO_EMPATE[a.linha.tipo] - PRIORIDADE_NO_EMPATE[b.linha.tipo] || b.ordem - a.ordem
}

// ---------------------------------------------------------------------------------------------
// Montagem dos dias
// ---------------------------------------------------------------------------------------------

/** `candidatas` já vem ordenada: cada dia aparece na posição da sua coisa mais recente. */
function agruparPorDia(candidatas: Candidata[]): DiaDoFeito[] {
  const grupos = new Map<string, LinhaDoFeito[]>()
  for (const { dia, linha } of candidatas) {
    const chave = dia ?? DIA_SEM_DATA
    grupos.set(chave, [...(grupos.get(chave) ?? []), linha])
  }
  return [...grupos].map(([dia, linhas]) => ({
    dia,
    linhas,
    familias: familiasDasLinhas(linhas),
    fecho: fechoDoDia(linhas[0]!.texto),
  }))
}

/** Dias que têm alguma coisa em `feitoRecente`: aparecem inteiros no topo. */
function diasDoTopo(candidatas: Candidata[]): Set<string> {
  return new Set(candidatas.flatMap((c) => (c.mes === null && c.dia !== null ? [c.dia] : [])))
}

/** A coisa vai para o topo se é recente, se o dia dela já está no topo ou se não tem data. */
function vaiParaOTopo(candidata: Candidata, dias: Set<string>): boolean {
  return candidata.mes === null || candidata.dia === null || dias.has(candidata.dia)
}

function mesesDoFeito(candidatas: Candidata[], mesesNaOrdem: string[]): MesDoFeito[] {
  return mesesNaOrdem
    .map((mes) => ({ mes, doMes: candidatas.filter((c) => c.mes === mes) }))
    .filter(({ doMes }) => doMes.length > 0)
    .map(({ mes, doMes }) => ({ mes, quantidade: doMes.length, dias: agruparPorDia(doMes) }))
}

export function diasDoFeito(carta: Pick<Carta, 'feitoRecente' | 'feitoPorMes'>): ListaDoFeito {
  const ordenadas = coletar(carta).sort(compararCandidatas)
  const dias = diasDoTopo(ordenadas)
  const topo = ordenadas.filter((c) => vaiParaOTopo(c, dias))
  const nosMeses = ordenadas.filter((c) => !vaiParaOTopo(c, dias))
  const maisNova = ordenadas[0]
  return {
    recentes: agruparPorDia(topo),
    meses: mesesDoFeito(nosMeses, [...new Set(carta.feitoPorMes.map((m) => m.mes))]),
    diaAberto: maisNova?.dia ?? null,
    chaveDeOndeParamos: maisNova?.dia == null ? null : maisNova.linha.chave,
  }
}
