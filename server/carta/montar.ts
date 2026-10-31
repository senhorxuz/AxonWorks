// Monta a "carta" (tela "Onde paramos") a partir do estado do projeto. Puro: sem relógio, sem banco.
// Quem lê o banco é `ler.ts`; quem decide a hora é o chamador (`agora`).
import type { ApprovalRequest } from '../../shared/approvals.js'
import { BOARD_COLUMNS, type BoardCard, type BoardColumnId } from '../../shared/board.js'
import {
  SALVAMENTOS_NA_CARTA,
  type Carta,
  type GrupoFalta,
  type ItemFalta,
  type ItemFeito,
  type MesFeito,
  type OrigemItem,
  type RascunhoAutomaticoVisivel,
  type SalvamentoResumo,
} from '../../shared/carta.js'
import type { Decision, ProjectBlocker, WorkDraft } from '../../shared/continuity.js'
import type { BacklogItem, BacklogStage, Checkpoint, Project, Task, TaskStatus } from '../../shared/types.js'
import { avisosDaDiretrizVelha } from './avisos.js'
import { proximoPronto } from './proximo-pronto.js'

export interface DadosDaCarta {
  project: Project
  tasks: Task[]
  checkpoints: Checkpoint[]
  cards: BoardCard[]
  backlog: BacklogItem[]
  decisions: Decision[]
  approvals: ApprovalRequest[]
  blockers: ProjectBlocker[]
  rascunhoAutomatico: WorkDraft | null
  saude: { ultimoRegistroAutomatico: string | null; ultimoErro: string | null }
  /** A diretriz (charter) vigente; ausente ou `null` = sem diretriz, e nenhum aviso de diretriz velha (D2). */
  diretriz?: { createdAt: string } | null
}

const MS_POR_DIA = 86_400_000
/** O que foi feito nos 7 dias que antecedem a última atividade aparece aberto; o resto, por mês. */
const DIAS_DO_FEITO_RECENTE = 7

// Spec 13.1: onde cada coisa entra em "O que falta". `null` = nunca entra (encerrado ou já virou outra coisa).
const GRUPO_DA_COLUNA: Record<BoardColumnId, GrupoFalta | null> = {
  ideas: 'ideias',
  pending: 'a_fazer',
  in_progress: 'em_andamento',
  unfinished: 'em_andamento',
  testing: 'em_andamento',
  awaiting_deploy: 'em_andamento',
  done: null,
  blocked: 'travado',
  discarded: null,
}
const GRUPO_DA_TAREFA: Record<TaskStatus, GrupoFalta | null> = {
  todo: 'a_fazer',
  in_progress: 'em_andamento',
  blocked: 'travado',
  done: null,
}
const GRUPO_DO_BACKLOG: Record<BacklogStage, GrupoFalta | null> = {
  idea: 'ideias',
  ready: 'a_fazer',
  promoted: null,
  archived: null,
}
const NOME_DA_COLUNA = Object.fromEntries(BOARD_COLUMNS.map((coluna) => [coluna.id, coluna.name])) as Record<
  BoardColumnId,
  string
>

interface Entrada {
  grupo: GrupoFalta
  item: ItemFalta
}

// ---------------------------------------------------------------------------------------------
// Ponto que muda quando a frente do "depende de você" entrar no ramo (BoardCard.needsOwner).
// ---------------------------------------------------------------------------------------------

function marcadoComoDoDono(card: BoardCard): boolean {
  return card.needsOwner === true
}

// ---------------------------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------------------------

/** Cópia ordenada do mais novo para o mais velho; empate mantém a ordem recebida. */
function maisNovoPrimeiro<T>(itens: T[], quando: (item: T) => string): T[] {
  return [...itens].sort((a, b) => Date.parse(quando(b)) - Date.parse(quando(a)))
}

/** O checkpoint mais recente é o de maior revisão (a revisão só cresce no projeto). */
function checkpointMaisRecente(checkpoints: Checkpoint[]): Checkpoint | undefined {
  return [...checkpoints].sort((a, b) => b.revision - a.revision)[0]
}

function ultimaAtividade(dados: DadosDaCarta): string | null {
  const datas = [
    ...dados.checkpoints.map((checkpoint) => checkpoint.createdAt),
    ...dados.cards.map((card) => card.updatedAt),
    ...(dados.rascunhoAutomatico === null ? [] : [dados.rascunhoAutomatico.updatedAt]),
  ]
  return maisNovoPrimeiro(datas, (data) => data)[0] ?? null
}

function diasParado(ultima: string | null, agora: Date): number | null {
  if (ultima === null) return null
  return Math.max(0, Math.floor((agora.getTime() - Date.parse(ultima)) / MS_POR_DIA))
}

// ---------------------------------------------------------------------------------------------
// O que falta
// ---------------------------------------------------------------------------------------------

function primeiroTexto(...textos: Array<string | null | undefined>): string | null {
  return textos.find((texto) => texto) ?? null
}

function itemFalta(
  origem: OrigemItem,
  fonte: { id: string; title: string; version: number },
  detalhe: string | null,
  etapa: string | null,
): ItemFalta {
  return { origem, id: fonte.id, titulo: fonte.title, detalhe, etapa, versao: fonte.version }
}

function comGrupo(grupo: GrupoFalta | null, item: ItemFalta): Entrada[] {
  return grupo === null ? [] : [{ grupo, item }]
}

function grupoDoCartao(card: BoardCard): GrupoFalta | null {
  const grupo = GRUPO_DA_COLUNA[card.column]
  return grupo !== null && marcadoComoDoDono(card) ? 'precisa_de_voce' : grupo
}

function entradaDoCartao(card: BoardCard): Entrada[] {
  const item = itemFalta('cartao', card, primeiroTexto(card.description), NOME_DA_COLUNA[card.column])
  return comGrupo(grupoDoCartao(card), item)
}

function entradaDaTarefa(task: Task): Entrada[] {
  const item = itemFalta('tarefa', task, primeiroTexto(task.blockedReason, task.description), null)
  return comGrupo(GRUPO_DA_TAREFA[task.status], item)
}

function entradaDoBacklog(backlog: BacklogItem): Entrada[] {
  const item = itemFalta('backlog', backlog, primeiroTexto(backlog.description), null)
  return comGrupo(GRUPO_DO_BACKLOG[backlog.stage], item)
}

function entradaDaAprovacao(aprovacao: ApprovalRequest): Entrada[] {
  const item = itemFalta('aprovacao', aprovacao, primeiroTexto(aprovacao.rationale), null)
  return comGrupo(aprovacao.status === 'pending' ? 'precisa_de_voce' : null, item)
}

function entradaDaDecisao(decisao: Decision): Entrada[] {
  const item = itemFalta('decisao', decisao, primeiroTexto(decisao.body), null)
  return comGrupo(decisao.status === 'proposed' ? 'precisa_de_voce' : null, item)
}

/** Mitigado ainda é aberto no resto do produto (`store.ts`: `IN ('open', 'mitigated')`): continua travado. */
const BLOQUEIO_EM_ABERTO: ReadonlySet<ProjectBlocker['status']> = new Set(['open', 'mitigated'])

/** Mitigado mostra a nota de mitigação (ou, sem ela, o motivo) depois de "Mitigado: ". */
function detalheDoBloqueio(bloqueio: ProjectBlocker): string | null {
  if (bloqueio.status !== 'mitigated') return primeiroTexto(bloqueio.body)
  const nota = primeiroTexto(bloqueio.resolution, bloqueio.body)
  return nota === null ? 'Mitigado.' : `Mitigado: ${nota}`
}

function entradaDoBloqueio(bloqueio: ProjectBlocker): Entrada[] {
  const item = itemFalta('bloqueio', bloqueio, detalheDoBloqueio(bloqueio), null)
  return comGrupo(BLOQUEIO_EM_ABERTO.has(bloqueio.status) ? 'travado' : null, item)
}

/** Ordem de leitura de cada grupo = ordem desta lista (spec 13.1): aprovações, decisões, cartões, bloqueios, tarefas, backlog. */
function entradasDaFalta(dados: DadosDaCarta): Entrada[] {
  return [
    ...dados.approvals.flatMap(entradaDaAprovacao),
    ...dados.decisions.flatMap(entradaDaDecisao),
    ...dados.cards.flatMap(entradaDoCartao),
    ...dados.blockers.flatMap(entradaDoBloqueio),
    ...dados.tasks.flatMap(entradaDaTarefa),
    ...dados.backlog.flatMap(entradaDoBacklog),
  ]
}

function faltaVazia(): Record<GrupoFalta, ItemFalta[]> {
  return { precisa_de_voce: [], travado: [], em_andamento: [], a_fazer: [], ideias: [] }
}

function montarFalta(dados: DadosDaCarta): Record<GrupoFalta, ItemFalta[]> {
  const falta = faltaVazia()
  for (const { grupo, item } of entradasDaFalta(dados)) falta[grupo].push(item)
  return falta
}

// ---------------------------------------------------------------------------------------------
// O que foi feito
// ---------------------------------------------------------------------------------------------

function feitoDosCartoes(cards: BoardCard[]): ItemFeito[] {
  return cards
    .filter((card) => card.column === 'done')
    .map((card): ItemFeito => ({ origem: 'cartao', id: card.id, texto: card.title, quando: card.updatedAt }))
}

/** Tarefa pronta vale desde o registro que a concluiu; sem ele, desde que foi criada. */
function feitoDasTarefas(tasks: Task[], checkpoints: Checkpoint[]): ItemFeito[] {
  const quandoDoCheckpoint = new Map<string | null, string>(checkpoints.map((c) => [c.id, c.createdAt]))
  return tasks
    .filter((task) => task.status === 'done')
    .map(
      (task): ItemFeito => ({
        origem: 'tarefa',
        id: task.id,
        texto: task.title,
        quando: quandoDoCheckpoint.get(task.completionCheckpointId) ?? task.createdAt,
      }),
    )
}

function feitoDosRegistros(checkpoints: Checkpoint[]): ItemFeito[] {
  return checkpoints.flatMap((checkpoint): ItemFeito[] =>
    checkpoint.humanSummary
      ? [{ origem: 'registro', id: checkpoint.id, texto: checkpoint.humanSummary, quando: checkpoint.createdAt }]
      : [],
  )
}

function coletarFeito(dados: DadosDaCarta): ItemFeito[] {
  const itens = [
    ...feitoDosCartoes(dados.cards),
    ...feitoDasTarefas(dados.tasks, dados.checkpoints),
    ...feitoDosRegistros(dados.checkpoints),
  ]
  return maisNovoPrimeiro(itens, (item) => item.quando)
}

/** Sem atividade registrada não existe "última sessão": nada é recente, tudo vai por mês. */
function repartirFeito(itens: ItemFeito[], ultima: string | null): { recente: ItemFeito[]; resto: ItemFeito[] } {
  if (ultima === null) return { recente: [], resto: itens }
  const corte = Date.parse(ultima) - DIAS_DO_FEITO_RECENTE * MS_POR_DIA
  const antigo = (item: ItemFeito): boolean => Date.parse(item.quando) < corte
  return { recente: itens.filter((item) => !antigo(item)), resto: itens.filter(antigo) }
}

/** O dono vive no fuso de São Paulo: 30/09 22h dele (01/10 01h UTC) ainda é setembro. */
const FORMATO_DO_MES = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })

/** 'YYYY-MM' do instante no fuso de São Paulo. */
function mesEmSaoPaulo(quando: string): string {
  const partes = new Map(FORMATO_DO_MES.formatToParts(Date.parse(quando)).map((parte) => [parte.type, parte.value]))
  return `${partes.get('year')}-${partes.get('month')}`
}

/** `itens` já vem do mais novo para o mais velho: a ordem em que cada mês aparece primeiro é a dos meses. */
function agruparPorMes(itens: ItemFeito[]): MesFeito[] {
  const meses = new Map<string, ItemFeito[]>()
  for (const item of itens) {
    const mes = mesEmSaoPaulo(item.quando)
    meses.set(mes, [...(meses.get(mes) ?? []), item])
  }
  return [...meses].map(([mes, doMes]) => ({ mes, itens: doMes }))
}

// ---------------------------------------------------------------------------------------------
// Rascunho automático (spec 13.2): só aparece se for mais novo que o checkpoint mais recente.
// ---------------------------------------------------------------------------------------------

function rascunhoVisivel(dados: DadosDaCarta): RascunhoAutomaticoVisivel | null {
  const rascunho = dados.rascunhoAutomatico
  if (rascunho === null) return null
  const ultimo = checkpointMaisRecente(dados.checkpoints)
  const maisNovo = ultimo === undefined || Date.parse(rascunho.updatedAt) > Date.parse(ultimo.createdAt)
  return maisNovo ? { resumo: rascunho.summary, atualizadoEm: rascunho.updatedAt, versao: rascunho.version } : null
}

// ---------------------------------------------------------------------------------------------
// Salvamentos de compactação (D5): os mais recentes, inteiros.
// ---------------------------------------------------------------------------------------------

function resumoDoSalvamento(checkpoint: Checkpoint): SalvamentoResumo {
  const extras = checkpoint.extras
  return {
    id: checkpoint.id,
    criadoEm: checkpoint.createdAt,
    humanSummary: checkpoint.humanSummary ?? null,
    resumo: checkpoint.summary,
    pedidosDoDono: extras?.pedidosDoDono ?? [],
    pendencias: extras?.pendencias ?? [],
    perguntasAbertas: extras?.perguntasAbertas ?? [],
    arquivosMexidos: extras?.arquivosMexidos ?? [],
    proximoPasso: checkpoint.nextStep,
  }
}

function salvamentos(checkpoints: Checkpoint[]): SalvamentoResumo[] {
  return checkpoints
    .filter((checkpoint) => checkpoint.kind === 'compactacao')
    .sort((a, b) => b.revision - a.revision)
    .slice(0, SALVAMENTOS_NA_CARTA)
    .map(resumoDoSalvamento)
}

// ---------------------------------------------------------------------------------------------

/** D2: a tela leva o texto do dono; a retomada, o do Claude. */
function avisos(dados: DadosDaCarta, agora: Date): Pick<Carta, 'avisos' | 'avisosDaRetomada'> {
  const diretrizVelha = avisosDaDiretrizVelha(dados.diretriz, dados.checkpoints, agora)
  if (diretrizVelha === null) return { avisos: [], avisosDaRetomada: [] }
  return { avisos: [diretrizVelha.paraODono], avisosDaRetomada: [diretrizVelha.paraOClaude] }
}

export function montarCarta(dados: DadosDaCarta, agora: Date): Carta {
  const ultima = ultimaAtividade(dados)
  const feito = repartirFeito(coletarFeito(dados), ultima)
  const ultimoRegistro = checkpointMaisRecente(dados.checkpoints)
  return {
    projeto: { id: dados.project.id, nome: dados.project.name, objetivo: dados.project.objective },
    ultimaAtividade: ultima,
    diasParado: diasParado(ultima, agora),
    emUmaFrase: ultimoRegistro?.humanSummary || null,
    feitoRecente: feito.recente,
    feitoPorMes: agruparPorMes(feito.resto),
    falta: montarFalta(dados),
    rascunhoAutomatico: rascunhoVisivel(dados),
    salvamentos: salvamentos(dados.checkpoints),
    ultimoRegistroEhSalvamento: ultimoRegistro?.kind === 'compactacao',
    proximoPronto: proximoPronto(dados),
    ...avisos(dados, agora),
    saude: dados.saude,
  }
}
