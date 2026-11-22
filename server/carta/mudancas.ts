import { z } from 'zod'
import type { ApprovalRequest } from '../../shared/approvals.js'
import type { BoardCard, BoardCardEvent } from '../../shared/board.js'
import type { Decision, HandoffDelivery, ProjectBlocker } from '../../shared/continuity.js'
import type { BlockerEvent, DecisionEvent } from '../../shared/events.js'
import type { EvidenceView } from '../../shared/evidence.js'
import { LIMITE_LEITURA_CURTA } from '../../shared/leitura-curta.js'
import type { Licao } from '../../shared/licoes.js'
import type { ItemNaLixeira } from '../../shared/lixeira.js'
import type { Checkpoint } from '../../shared/types.js'
import { maskSecrets } from '../handoff.js'
import { DomainError } from '../store/errors.js'
import type { RestauracaoNaLixeira } from '../store/lixeira.js'
import { cortarEmPalavra } from './leitura-curta.js'
import { MOLDURA } from './retomada-compacta.js'

const NOVENTA_DIAS = 90 * 24 * 60 * 60 * 1000
const ISO_COM_FUSO = z.iso.datetime({ offset: true })

export function intervaloDasMudancas(desde: unknown, agora: Date): { desde: string; antigo: boolean } {
  const entrada = ISO_COM_FUSO.safeParse(desde)
  const instante = entrada.success ? Date.parse(entrada.data) : NaN
  if (!(instante <= agora.getTime())) {
    throw new DomainError(400, 'desde_invalido', 'Desde deve ser uma data e hora ISO com fuso, sem ficar no futuro.')
  }
  return { desde: new Date(instante).toISOString(), antigo: agora.getTime() - instante > NOVENTA_DIAS }
}

interface ComEventos<T, E> {
  item: T
  eventos: readonly E[]
}

export interface DadosDasMudancas {
  decisoes: readonly ComEventos<Decisao, Pick<DecisionEvent, 'transition' | 'actor' | 'relatedDecisionId' | 'createdAt'>>[]
  licoes: readonly Pick<Licao, 'id' | 'tipo' | 'texto' | 'linhaCurta' | 'criadaEm' | 'aposentadaEm' | 'substituiId'>[]
  aprovacoes: readonly Pick<ApprovalRequest, 'id' | 'title' | 'status' | 'decidedAt'>[]
  passagens: readonly (Pick<HandoffDelivery, 'id' | 'from' | 'to' | 'message' | 'createdAt'> & { checkpoint: Pick<Checkpoint, 'nextStep'> })[]
  bloqueios: readonly ComEventos<Pick<ProjectBlocker, 'id' | 'title' | 'status' | 'createdAt' | 'resolvedAt'>, Pick<BlockerEvent, 'transition' | 'createdAt'>>[]
  checkpoints: readonly Pick<Checkpoint, 'id' | 'humanSummary' | 'summary' | 'nextStep' | 'createdAt'>[]
  cartoes: readonly ComEventos<Pick<BoardCard, 'id' | 'title'>, Pick<BoardCardEvent, 'kind' | 'fromColumn' | 'toColumn' | 'summary' | 'createdAt'>>[]
  evidencias: readonly Pick<EvidenceView, 'id' | 'command' | 'explanation' | 'freshness'>[]
  lixeira: readonly Pick<ItemNaLixeira, 'id' | 'tipo' | 'titulo' | 'excluidoEm'>[]
  restauracoes: readonly RestauracaoNaLixeira[]
}

type Decisao = Pick<Decision, 'id' | 'title' | 'status' | 'updatedAt' | 'acceptedBy' | 'revokedBy' | 'supersededById'>

interface Mudanca {
  quando: string | null
  texto: string
}

function trecho(texto: string): string {
  return cortarEmPalavra(maskSecrets(texto.replace(/\s+/g, ' ').trim()), 220)
}

function decisaoEmLinha(decisao: Decisao): string {
  return `[decisao:${decisao.id}] ${trecho(decisao.title)}`
}

function decisaoVigente(porId: ReadonlyMap<string | null, Decisao>, id: string | null): string {
  const visitadas = new Set<string>()
  let decisao = porId.get(id)
  while (decisao !== undefined && !visitadas.has(decisao.id)) {
    visitadas.add(decisao.id)
    if (decisao.status === 'accepted') return `Vigente: ${decisaoEmLinha(decisao)}`
    decisao = porId.get(decisao.supersededById)
  }
  return 'Sem decisão vigente disponível para essa substituição.'
}

function transicaoDaDecisao(
  decisao: Decisao, transicao: DecisionEvent['transition'] | Decision['status'], quem: string | null,
  substituta: string | null, quando: string, porId: ReadonlyMap<string | null, Decisao>,
): Mudanca | undefined {
  if (transicao === 'superseded') {
    return { quando, texto: `${decisaoEmLinha(decisao)} — Substituída. ${decisaoVigente(porId, substituta)}` }
  }
  if (transicao === 'accepted' || transicao === 'revoked') {
    const estado = transicao === 'accepted' ? 'Aceita' : 'Revogada'
    const autoria = quem === null ? '' : ` por ${trecho(quem)} (nome declarado)`
    return { quando, texto: `${decisaoEmLinha(decisao)} — ${estado}${autoria}.` }
  }
}

function mudancasNasDecisoes(decisoes: DadosDasMudancas['decisoes']): Array<Mudanca | undefined> {
  const porId = new Map<string | null, Decisao>(decisoes.map(({ item }) => [item.id, item]))
  return decisoes.flatMap(({ item, eventos }) => {
    if (eventos.length === 0) {
      // Projetos importados podem trazer as decisões sem a trilha de eventos.
      const quem = item.status === 'accepted' ? item.acceptedBy : item.revokedBy
      return transicaoDaDecisao(item, item.status, quem, item.supersededById, item.updatedAt, porId)
    }
    return eventos.map((evento) => transicaoDaDecisao(item, evento.transition, evento.actor, evento.relatedDecisionId, evento.createdAt, porId))
  })
}

function mudancasNasLicoes(licoes: DadosDasMudancas['licoes']): Mudanca[] {
  const porId = new Map<string | null, DadosDasMudancas['licoes'][number]>(licoes.map((licao) => [licao.id, licao]))
  const substituidas = new Set(licoes.map((licao) => licao.substituiId))
  return licoes.filter((licao) => licao.tipo !== 'erro').flatMap((licao) => {
    const anterior = porId.get(licao.substituiId)
    const tipo = licao.tipo === 'regra' ? 'Regra' : 'Verificação'
    const fonte = `[licao:${licao.id}]`
    const texto = trecho(licao.linhaCurta ?? licao.texto)
    const criacao = anterior === undefined ? `${tipo} nova: ${texto}` : `${tipo} corrigida: ${texto} · Anterior: [licao:${anterior.id}] ${trecho(anterior.texto)}`
    const mudancas: Mudanca[] = [{ quando: licao.criadaEm, texto: `${fonte} ${criacao}` }]
    if (!substituidas.has(licao.id)) {
      mudancas.push({ quando: licao.aposentadaEm, texto: `${fonte} ${tipo} desfeita: ${texto}` })
    }
    return mudancas
  })
}

function mudancasNasAprovacoes(aprovacoes: DadosDasMudancas['aprovacoes']): Mudanca[] {
  return aprovacoes
    .filter((item) => item.status === 'approved' || item.status === 'rejected')
    .map((item) => {
      const estado = item.status === 'approved' ? 'aprovado' : 'recusado'
      return { quando: item.decidedAt, texto: `[aprovacao:${item.id}] Pedido ${estado} na tela: ${trecho(item.title)}` }
    })
}

function mudancasNosBloqueios(bloqueios: DadosDasMudancas['bloqueios']): Array<Mudanca | undefined> {
  return bloqueios.flatMap(({ item, eventos }) => {
    const fonte = `[bloqueio:${item.id}]`
    const titulo = trecho(item.title)
    if (eventos.length === 0) {
      const aberto = { quando: item.createdAt, texto: `${fonte} Bloqueio aberto: ${titulo}` }
      if (item.status !== 'resolved') return [aberto]
      return [aberto, { quando: item.resolvedAt, texto: `${fonte} Bloqueio resolvido: ${titulo}` }]
    }
    return eventos.map(({ transition, createdAt: quando }) => {
      switch (transition) {
        case 'opened': return { quando, texto: `${fonte} Bloqueio aberto: ${titulo}` }
        case 'reopened': return { quando, texto: `${fonte} Bloqueio reaberto: ${titulo}` }
        case 'resolved': return { quando, texto: `${fonte} Bloqueio resolvido: ${titulo}` }
      }
    })
  })
}

function mudancasNosCartoes(cartoes: DadosDasMudancas['cartoes']): Mudanca[] {
  return cartoes.flatMap(({ item, eventos }) => eventos
    .filter((evento) => evento.kind === 'moved' && evento.fromColumn !== evento.toColumn)
    .map((evento) => ({ quando: evento.createdAt, texto: `[cartao:${item.id}] ${trecho(item.title)}. ${trecho(evento.summary)}` })))
}

function ordenarNoIntervalo(grupo: Array<Mudanca | undefined>, desde: number, ate: number): string[] {
  return grupo
    .filter((mudanca) => mudanca !== undefined)
    .map(({ quando, texto }) => ({ quando: Date.parse(String(quando)), texto }))
    .filter(({ quando }) => quando > desde && quando <= ate)
    .sort((a, b) => b.quando - a.quando)
    .map(({ texto }) => texto)
}

function mudancasNaLixeira({ lixeira, restauracoes }: DadosDasMudancas): Mudanca[] {
  const idas = [...lixeira, ...restauracoes].map((item) => ({
    quando: item.excluidoEm,
    texto: `[${item.tipo}:${item.id}] Foi para a lixeira: ${trecho(item.titulo)}`,
  }))
  const voltas = restauracoes.map((item) => ({
    quando: item.restauradoEm,
    texto: `[${item.tipo}:${item.id}] Voltou da lixeira: ${trecho(item.titulo)}`,
  }))
  return [...voltas, ...idas]
}

function linhasDaMudanca(dados: DadosDasMudancas, desde: number, ate: number): string[] {
  const passagens = dados.passagens.map((p) => ({
    quando: p.createdAt,
    texto: `[passagem:${p.id}] Passagem de ${trecho(p.from)} para ${trecho(p.to)}: ${trecho(p.message || p.checkpoint.nextStep)}`,
  }))
  const checkpoints = dados.checkpoints.map((c) => ({
    quando: c.createdAt,
    texto: `[checkpoint:${c.id}] ${trecho(c.humanSummary ?? c.summary)} · Próximo passo registrado: ${trecho(c.nextStep)}`,
  }))
  const grupos = [
    mudancasNasDecisoes(dados.decisoes), mudancasNasLicoes(dados.licoes), mudancasNasAprovacoes(dados.aprovacoes),
    passagens, mudancasNosBloqueios(dados.bloqueios), checkpoints, mudancasNosCartoes(dados.cartoes), mudancasNaLixeira(dados),
  ]
  return grupos.flatMap((grupo) => ordenarNoIntervalo(grupo, desde, ate))
}

function comOrcamento(cabecalho: string, linhas: string[], limite: number): string {
  const inteiro = `${cabecalho}\n- ${linhas.join('\n- ')}`
  if (inteiro.length <= limite) return inteiro

  const rodape = (n: number) => `\n\nMudanças que ficaram fora por falta de espaço: ${n}.`
  let texto = cabecalho
  let incluidos = 0
  for (const linha of linhas) {
    const proximo = `${texto}\n- ${linha}`
    if (proximo.length + rodape(linhas.length - incluidos - 1).length > limite) break
    texto = proximo
    incluidos += 1
  }
  return texto + rodape(linhas.length - incluidos)
}

export function marcaDaLeitura(geradaEm: string): string {
  return `Leitura feita em ${geradaEm}. Para receber só o que mudou depois desta, use desde=${geradaEm}.`
}

export function montarMudancas(dados: DadosDasMudancas, desde: string, geradaEm: string, maxChars: number): string {
  const marca = marcaDaLeitura(geradaEm)
  const linhas = linhasDaMudanca(dados, Date.parse(desde), Date.parse(geradaEm))
  // O frescor é recalculado na leitura. A perda de cobertura não tem data registrada.
  const foraDaCobertura = dados.evidencias.filter((e) => e.freshness === 'stale' || e.freshness === 'missing').length
  const rodape = foraDaCobertura === 0 ? ''
    : `\n\n${foraDaCobertura} evidências fora da cobertura da versão atual: list_evidence (staleOnly filtra arquivos alterados). get_evidence abre o detalhe.`
  if (linhas.length === 0) return `${MOLDURA}\n${marca}\n\nNada relevante mudou desde ${desde}.${rodape}`
  const cabecalho = `# O que mudou desde ${desde}\n${MOLDURA}\n${marca}\n`
  return comOrcamento(cabecalho, linhas, Math.min(maxChars, LIMITE_LEITURA_CURTA) - rodape.length) + rodape
}
