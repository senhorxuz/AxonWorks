// A leitura que basta: monta a `LeituraCurta` e o texto dela a partir do estado do projeto. Puro: sem
// relógio, sem banco (quem lê o banco é `leitura-curta-ler.ts`; a hora vem em `geradaEm`).
//
// Orçamento (`limite` caracteres, medido no texto final, nunca estimado):
// 1. o estado (resumo, último registro, próximo passo ou lacuna) entra sempre; o resumo e o próximo
//    passo são cortados em proporção ao limite, para a moldura fixa caber mesmo no limite mínimo (2.000)
//    com o nome do projeto (160) e o do agente (80) no tamanho máximo que o store aceita;
// 2. regras e verificações vêm logo depois e nunca somem em silêncio, e uma não toma o espaço da outra:
//    inteiras; senão regras curtas e verificações inteiras; senão as duas curtas; senão as linhas curtas que
//    couberem (uma de cada parte por vez) e o texto diz, antes de tudo, quantas ficaram de fora;
// 3. o resto entra por prioridade (o que depende do dono, entregas, o que o dono decidiu depois do último registro, passagens, bloqueios, resultados, erros do
//    projeto, em andamento, erros gerais), item inteiro ou nenhum; o texto segue a mesma ordem. Quando um item de uma parte não cabe,
//    nada de menos importante entra depois dele (um cartão comum nunca ocupa o lugar de uma passagem).
//    O que ficou de fora vira contagem no rodapé.
// O texto é escrito em afirmações, não em ordens: conteúdo do banco é dado, não instrução.
import type { ApprovalRequest } from '../../shared/approvals.js'
import { BOARD_COLUMNS, type BoardCard, type BoardColumnId } from '../../shared/board.js'
import type { Decision, HandoffDelivery, ProjectBlocker } from '../../shared/continuity.js'
import type { EvidenceFreshness, EvidenceView } from '../../shared/evidence.js'
import type { EstadoDaEntrega } from '../../shared/entrega.js'
import {
  LIMITE_LEITURA_CURTA,
  type LeituraCurta,
  type LinhaDaLeitura,
  type ParteDaLeitura,
  type TipoDaFonte,
} from '../../shared/leitura-curta.js'
import { LINHA_CURTA_MAXIMA, MOMENTOS_DA_VERIFICACAO, type FalhaDaVerificacao, type Licao, type MomentoDaVerificacao } from '../../shared/licoes.js'
import type { Checkpoint, Task } from '../../shared/types.js'
import { maskSecrets } from '../handoff.js'
import { resumirEntregas } from '../store/entrega.js'
import { leituraDaEvidencia } from '../store/evidencia-esperada.js'
import { anteporPontoDeConferencia, type ComPontoDeConferencia } from '../store/ponto-de-conferencia.js'
import { MOLDURA } from './retomada-compacta.js'

export interface DadosDaLeitura {
  projeto: { id: string; nome: string }
  /** A hora da leitura, em ISO. Vem de quem chama: este módulo não lê o relógio. */
  geradaEm: string
  revisao: number
  /** Lições ativas do projeto e as globais, da mais antiga para a mais nova. */
  licoes: Licao[]
  falhas?: FalhaDaVerificacao[]
  avisoDaDiretriz?: LinhaDaLeitura
  /** O registro mais recente do projeto, ou `null` se não há nenhum. */
  checkpoint: Checkpoint | null
  /** As evidências desse registro. */
  evidencias: EvidenceView[]
  aprovacoes: ApprovalRequest[]
  decisoes: Decision[]
  cartoes: BoardCard[]
  entregas?: EstadoDaEntrega[]
  tarefas: Task[]
  /** Passagens não lidas, destinadas ao agente ou a todos. */
  passagens: ComPontoDeConferencia<HandoffDelivery>[]
  bloqueios: ProjectBlocker[]
}

/** O resumo e o próximo passo do último registro entram até aqui; o inteiro está no `get_resume_brief`. */
export const LIMITE_DO_RESUMO = 400
export const LIMITE_DO_PROXIMO_PASSO = 500
/** E, em limites pequenos, só esta fração do limite (7% e 11%), para sobrar espaço para o resto da moldura. */
export const FRACAO_DO_RESUMO = 0.07
export const FRACAO_DO_PROXIMO_PASSO = 0.11
/** Cada linha do resto (passagem, cartão, bloqueio) entra até aqui. */
export const LIMITE_DA_LINHA = 200
export const LIMITE_DO_COMANDO = 100
export const LACUNA_SEM_REGISTRO = 'Nenhum registro de trabalho sustenta um próximo passo neste projeto.'

const PARTES: readonly ParteDaLeitura[] = [
  'regras',
  'verificacoes',
  'ultimosResultados',
  'dependeDoDono',
  'entregas',
  'decididoPeloDono',
  'passagens',
  'bloqueios',
  'decisoesAlteradas',
  'erros',
  'emAndamento',
]

const NOME_DA_PARTE: Record<ParteDaLeitura, [string, string]> = {
  regras: ['regra', 'regras'],
  verificacoes: ['verificação', 'verificações'],
  ultimosResultados: ['resultado', 'resultados'],
  dependeDoDono: ['item que depende do dono', 'itens que dependem do dono'],
  entregas: ['entrega em andamento', 'entregas em andamento'],
  decididoPeloDono: ['decisão do dono', 'decisões do dono'],
  passagens: ['passagem', 'passagens'],
  bloqueios: ['bloqueio', 'bloqueios'],
  decisoesAlteradas: ['decisão alterada', 'decisões alteradas'],
  erros: ['erro', 'erros'],
  emAndamento: ['item em andamento', 'itens em andamento'],
}

const FERRAMENTA_DA_PARTE: Record<ParteDaLeitura, string> = {
  regras: 'list_lessons',
  verificacoes: 'list_lessons',
  ultimosResultados: 'get_evidence',
  dependeDoDono: 'get_resume_brief sem modo',
  entregas: 'get_delivery',
  decididoPeloDono: 'get_resume_brief sem modo',
  passagens: 'get_handoff_deliveries',
  bloqueios: 'get_resume_brief sem modo',
  decisoesAlteradas: 'get_decisions',
  erros: 'list_lessons',
  emAndamento: 'get_board',
}

const TITULO_DO_MOMENTO: Record<MomentoDaVerificacao, string> = {
  antes_de_subir: 'Antes de subir',
  antes_de_pronto: 'Antes de dizer pronto',
  antes_de_commit: 'Antes de commit ou junção',
}

const FRESCOR_EM_TEXTO: Record<EvidenceFreshness, string> = {
  covers_current: 'cobre a versão atual',
  stale: 'não cobre mais a versão atual',
  missing: 'arquivo ausente',
  unverifiable: 'não dá para verificar',
  no_artifacts: 'sem arquivos para conferir',
}

const COLUNAS_EM_ANDAMENTO: ReadonlySet<BoardColumnId> = new Set(['in_progress', 'unfinished', 'testing', 'awaiting_deploy'])
const COLUNAS_ENCERRADAS: ReadonlySet<BoardColumnId> = new Set(['done', 'discarded'])
const NOME_DA_COLUNA = Object.fromEntries(BOARD_COLUMNS.map((coluna) => [coluna.id, coluna.name])) as Record<BoardColumnId, string>

const RODAPE_FIXO =
  'Para abrir um registro: list_lessons (regras, verificações, erros), get_board (cartões), get_evidence (resultados), ' +
  'get_handoff_deliveries (passagens), get_resume_brief sem modo (o resto).'

type Verificacao = LinhaDaLeitura & { momento: MomentoDaVerificacao }
type Resultado = LeituraCurta['ultimosResultados'][number] & { leitura: string }
type Item = LinhaDaLeitura | Verificacao | Resultado
type Selecao = Record<ParteDaLeitura, Item[]>
type Estado = LeituraCurta['estado']

const plural = (n: number, singular: string, mais: string): string => (n === 1 ? singular : mais)

/**
 * Corta em palavra, com reticências, para caber em `maximo` caracteres. Texto que já cabe volta como está.
 * Uma palavra sozinha maior que o espaço é cortada no meio.
 */
export function cortarEmPalavra(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto
  const espaco = texto.slice(0, maximo).lastIndexOf(' ')
  return `${(espaco > 0 ? texto.slice(0, espaco) : texto.slice(0, maximo - 1)).trimEnd()}…`
}

/**
 * Texto que veio do banco, pronto para virar uma linha: sem quebra de linha (um `\n` seguido de `## ` criaria
 * uma seção falsa) e sem segredo. A máscara vem antes de qualquer corte, para o corte nunca deixar um pedaço cru.
 */
function limpar(texto: string): string {
  return maskSecrets(texto.replace(/\s+/g, ' ').trim())
}

function linha(tipo: TipoDaFonte, id: string, texto: string): LinhaDaLeitura {
  return { texto: cortarEmPalavra(limpar(texto), LIMITE_DA_LINHA), fonte: { tipo, id } }
}

/** A forma curta de uma lição: a que o dono ou a IA escreveu, ou o começo do texto cortado em palavra. */
function formaCurta(licao: Licao): string {
  return cortarEmPalavra(limpar(licao.linhaCurta ?? licao.texto), LINHA_CURTA_MAXIMA)
}

function linhaDaLicao(licao: Licao, texto: string): LinhaDaLeitura {
  return { texto: limpar(texto), fonte: { tipo: 'licao', id: licao.id } }
}

// ---------------------------------------------------------------------------------------------
// O que cada parte leva
// ---------------------------------------------------------------------------------------------

function estadoDaLeitura(checkpoint: Checkpoint | null, limite: number, reducao: number): Estado {
  if (checkpoint === null) {
    return { emUmaFrase: null, ultimoRegistro: null, proximoPasso: null, lacuna: LACUNA_SEM_REGISTRO }
  }
  const caber = (texto: string, maximo: number, fracao: number) => {
    const inicial = cortarEmPalavra(texto, Math.min(maximo, Math.floor(limite * fracao)))
    return cortarEmPalavra(inicial, Math.max(1, inicial.length - reducao))
  }
  const resumo = limpar(checkpoint.humanSummary ?? '')
  return {
    emUmaFrase: resumo ? caber(resumo, LIMITE_DO_RESUMO, FRACAO_DO_RESUMO) : null,
    ultimoRegistro: { id: checkpoint.id, agente: limpar(checkpoint.agent), criadoEm: checkpoint.createdAt },
    proximoPasso: {
      texto: caber(limpar(checkpoint.nextStep), LIMITE_DO_PROXIMO_PASSO, FRACAO_DO_PROXIMO_PASSO),
      fonte: { tipo: 'checkpoint', id: checkpoint.id },
    },
    lacuna: null,
  }
}

interface InteirasECurtas<T> {
  inteiras: T[]
  curtas: T[]
}

function regrasDaLeitura(licoes: Licao[]): InteirasECurtas<LinhaDaLeitura> {
  const regras = licoes.filter((licao) => licao.tipo === 'regra')
  return {
    inteiras: regras.map((licao) => linhaDaLicao(licao, licao.texto)),
    curtas: regras.map((licao) => linhaDaLicao(licao, formaCurta(licao))),
  }
}

/** Verificação sem momento vale antes de dizer pronto: a leitura não deixa uma verificação sair em silêncio. */
function marcaDaFalha(falha: FalhaDaVerificacao | undefined): string {
  if (falha === undefined) return ''
  const { quantas, ultimaEm } = falha
  return ` (falhou ${quantas} ${plural(quantas, 'vez', 'vezes')}; a última em ${ultimaEm.slice(0, 10)})`
}

function verificacoesDaLeitura(licoes: Licao[], falhas?: FalhaDaVerificacao[]): InteirasECurtas<Verificacao> {
  const falhasPorId = new Map(falhas?.map((falha) => [falha.verificacaoId, falha]))
  const lista = licoes
    .filter((licao) => licao.tipo === 'verificacao')
    .map((licao) => ({
      licao,
      momento: licao.momento ?? 'antes_de_pronto',
      marca: marcaDaFalha(falhasPorId.get(licao.id)),
    }))
  // Do momento mais cedo ao mais tarde, na ordem em que o dono as disse dentro de cada um.
  const ordenadas = MOMENTOS_DA_VERIFICACAO.flatMap((momento) => lista.filter((item) => item.momento === momento))
  return {
    inteiras: ordenadas.map(({ licao, momento, marca }) => ({ ...linhaDaLicao(licao, licao.texto + marca), momento })),
    curtas: ordenadas.map(({ licao, momento, marca }) => ({ ...linhaDaLicao(licao, formaCurta(licao) + marca), momento })),
  }
}

function resultadosDaLeitura(evidencias: EvidenceView[]): Resultado[] {
  return evidencias.map((evidencia) => ({
    comando: cortarEmPalavra(limpar(evidencia.command), LIMITE_DO_COMANDO),
    resultado: evidencia.outcome,
    leitura: cortarEmPalavra(limpar(leituraDaEvidencia(evidencia)), LIMITE_DA_LINHA),
    frescor: evidencia.freshness,
    conferida: evidencia.verifications.length > 0,
    fonte: { tipo: 'evidencia', id: evidencia.id },
  }))
}

/** Só de registro: aprovação pendente, decisão proposta e cartão marcado. A prosa do próximo passo não conta. */
function dependeDoDonoDaLeitura(dados: DadosDaLeitura): LinhaDaLeitura[] {
  return [
    ...dados.aprovacoes
      .filter((aprovacao) => aprovacao.status === 'pending')
      .map((aprovacao) => linha('aprovacao', aprovacao.id, `Aprovação pendente: ${aprovacao.title}`)),
    ...dados.decisoes
      .filter((decisao) => decisao.status === 'proposed')
      .map((decisao) => linha('decisao', decisao.id, `Decisão proposta, ainda sem confirmação do dono: ${decisao.title}`)),
    ...dados.cartoes
      .filter((cartao) => cartao.needsOwner && !COLUNAS_ENCERRADAS.has(cartao.column))
      .map((cartao) => linha('cartao', cartao.id, `Cartão marcado como "depende de você": ${cartao.title}`)),
  ]
}

function entregasDaLeitura(dados: DadosDaLeitura): LinhaDaLeitura[] {
  if (dados.entregas === undefined) return []
  return resumirEntregas(dados.entregas, dados.cartoes).map(({ cardId, titulo, resumo, autorias }) => ({
    texto: [`${titulo}: ${resumo}`, ...autorias].join(' · '),
    fonte: { tipo: 'cartao', id: cardId },
  }))
}

const PALAVRA_DA_DECISAO = {
  approved: 'Aprovada',
  rejected: 'Recusada',
  accepted: 'Aceita',
  revoked: 'Revogada',
  superseded: 'Substituída',
} as const

/** "Aprovada por Dono em 2026-11-08T…: título. Nota: …"; sem quem decidiu, sem o "por". */
function frase(
  palavra: string,
  quem: string | null,
  quando: string,
  titulo: string,
  nota: string | null = null,
): string {
  return `${palavra}${quem ? ` por ${quem}` : ''} em ${quando}: ${titulo}${nota ? ` Nota: ${nota}` : ''}`
}

/** Sem registro, entram só as aprovações decididas mais recentes; o resto vira contagem no rodapé. */
export const LIMITE_DECIDIDAS_SEM_REGISTRO = 5

function maisNovaQue(dados: DadosDaLeitura): (quando: string | null) => boolean {
  const desde = dados.checkpoint === null ? Number.NEGATIVE_INFINITY : Date.parse(dados.checkpoint.createdAt)
  // Sem data (`null`), `Date.parse('null')` é NaN e a comparação é falsa: não entra.
  return (quando) => Date.parse(String(quando)) > desde
}

/**
 * O que o dono decidiu NA TELA (aprovação aprovada ou recusada) depois do último registro, da mais recente
 * para a mais antiga. Só aprovações: aprovar e recusar só existe pela tela. As decisões aceitas pelo MCP vão
 * para `decisoesAlteradas`, porque o nome de quem aceitou é declarado pela IA.
 */
function decididoPeloDonoDaLeitura(dados: DadosDaLeitura): LinhaDaLeitura[] {
  const maisNova = maisNovaQue(dados)
  return dados.aprovacoes
    .filter((aprovacao) => (aprovacao.status === 'approved' || aprovacao.status === 'rejected') && maisNova(aprovacao.decidedAt))
    .sort((a, b) => Date.parse(String(b.decidedAt)) - Date.parse(String(a.decidedAt)))
    .map((aprovacao) =>
      linha(
        'aprovacao',
        aprovacao.id,
        frase(PALAVRA_DA_DECISAO[aprovacao.status as 'approved' | 'rejected'], aprovacao.decidedBy, aprovacao.decidedAt as string, aprovacao.title, aprovacao.decisionNote),
      ),
    )
}

/** Decisões aceitas, revogadas ou substituídas depois do último registro; o nome de quem alterou é declarado. */
function decisoesAlteradasDaLeitura(dados: DadosDaLeitura): LinhaDaLeitura[] {
  const maisNova = maisNovaQue(dados)
  return dados.decisoes
    .filter((decisao) => (decisao.status === 'accepted' || decisao.status === 'revoked' || decisao.status === 'superseded') && maisNova(decisao.updatedAt))
    .map((decisao) => {
      const quem = decisao.status === 'accepted' ? decisao.acceptedBy : decisao.status === 'revoked' ? decisao.revokedBy : null
      return linha(
        'decisao',
        decisao.id,
        frase(PALAVRA_DA_DECISAO[decisao.status as 'accepted' | 'revoked' | 'superseded'], quem ? `${quem} (nome declarado)` : null, decisao.updatedAt, decisao.title),
      )
    })
}

function passagensDaLeitura(passagens: DadosDaLeitura['passagens']): LinhaDaLeitura[] {
  return passagens.map((passagem) => {
    const narrativa = `Passagem de ${passagem.from} para ${passagem.to}: ${passagem.message || passagem.checkpoint.nextStep}`
    return linha('passagem', passagem.id, anteporPontoDeConferencia(passagem.pontoDeConferencia, narrativa))
  })
}

/** Bloqueio aberto, tarefa bloqueada (com o motivo) e cartão na coluna Bloqueado (o que depende do dono já está lá). */
function bloqueiosDaLeitura(dados: DadosDaLeitura): LinhaDaLeitura[] {
  return [
    ...dados.bloqueios
      .filter((bloqueio) => bloqueio.status === 'open')
      .map((bloqueio) => linha('bloqueio', bloqueio.id, `Bloqueio aberto: ${bloqueio.title}`)),
    ...dados.tarefas
      .filter((tarefa) => tarefa.status === 'blocked')
      .map((tarefa) => linha('tarefa', tarefa.id, `Tarefa bloqueada: ${tarefa.title}${tarefa.blockedReason ? `. Motivo: ${tarefa.blockedReason}` : ''}`)),
    ...dados.cartoes
      .filter((cartao) => cartao.column === 'blocked' && !cartao.needsOwner)
      .map((cartao) => linha('cartao', cartao.id, `Cartão na coluna Bloqueado: ${cartao.title}`)),
  ]
}

function emAndamentoDaLeitura(dados: DadosDaLeitura): LinhaDaLeitura[] {
  return [
    ...dados.cartoes
      .filter((cartao) => COLUNAS_EM_ANDAMENTO.has(cartao.column) && !cartao.needsOwner)
      .map((cartao) => linha('cartao', cartao.id, `${cartao.title} (${NOME_DA_COLUNA[cartao.column]})`)),
    ...dados.tarefas
      .filter((tarefa) => tarefa.status === 'in_progress')
      .map((tarefa) => linha('tarefa', tarefa.id, `Tarefa em andamento: ${tarefa.title}`)),
  ]
}

/** Erros do projeto e erros gerais, cada grupo do mais novo para o mais antigo, sempre em linha curta. */
function errosDaLeitura(licoes: Licao[]): { doProjeto: LinhaDaLeitura[]; gerais: LinhaDaLeitura[] } {
  const erros = licoes.filter((licao) => licao.tipo === 'erro')
  const emLinha = (grupo: Licao[]): LinhaDaLeitura[] => grupo.reverse().map((licao) => linhaDaLicao(licao, formaCurta(licao)))
  return {
    doProjeto: emLinha(erros.filter((licao) => licao.projectId !== null)),
    gerais: emLinha(erros.filter((licao) => licao.projectId === null)),
  }
}

// ---------------------------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------------------------

const linhaDoItem = ({ texto, fonte }: LinhaDaLeitura): string => `- [${fonte.tipo}:${fonte.id}] ${texto}`

function secao(titulo: string, itens: string[]): string[] {
  return itens.length === 0 ? [] : ['', `## ${titulo}`, ...itens]
}

function linhaDoResultado(resultado: Resultado): string {
  const conferencia = resultado.conferida ? 'conferido por outra identidade' : 'sem conferência de outra identidade'
  return `- [${resultado.fonte.tipo}:${resultado.fonte.id}] \`${resultado.comando}\`: relatado como ${resultado.leitura}; ${conferencia}; frescor: ${FRESCOR_EM_TEXTO[resultado.frescor as EvidenceFreshness]}`
}

function secaoDasVerificacoes(verificacoes: Verificacao[]): string[] {
  const grupos = MOMENTOS_DA_VERIFICACAO.flatMap((momento) => {
    const doMomento = verificacoes.filter((verificacao) => verificacao.momento === momento)
    return doMomento.length === 0 ? [] : [`### ${TITULO_DO_MOMENTO[momento]}`, ...doMomento.map(linhaDoItem)]
  })
  return secao('Verificações antes de agir', grupos)
}

/** Para onde o aviso de "Onde parou" aponta: o texto que entra depois de "veja". */
type OndeEstaoAsDecisoes = 'abaixo' | 'o rodapé'

function secaoDoEstado(estado: Estado, ondeEstao: OndeEstaoAsDecisoes | null, avisoDaDiretriz: string | undefined): string[] {
  const { ultimoRegistro, proximoPasso } = estado
  return [
    '',
    '## Onde parou',
    ...(estado.emUmaFrase === null ? [] : [`- Em uma frase: ${estado.emUmaFrase}`]),
    ...(ultimoRegistro === null ? [] : [`- Último registro: [checkpoint:${ultimoRegistro.id}] de ${ultimoRegistro.agente}, em ${ultimoRegistro.criadoEm}`]),
    proximoPasso === null
      ? `- Próximo passo: ${estado.lacuna}`
      : `- Próximo passo anotado no último registro (não é autorização do dono): [${proximoPasso.fonte.tipo}:${proximoPasso.fonte.id}] ${proximoPasso.texto}`,
    ...(avisoDaDiretriz === undefined ? [] : [avisoDaDiretriz]),
    ...(ondeEstao === null
      ? []
      : [`- Há decisões do dono mais novas que o último registro (veja ${ondeEstao}): o resumo e o próximo passo acima podem estar desatualizados.`]),
  ]
}

/** Regras e verificações que não couberam vêm antes de tudo: o texto nunca as esconde. */
function avisoDeCorte(fora: Partial<Record<ParteDaLeitura, number>>): string[] {
  const avisos = (['regras', 'verificacoes'] as const)
    .filter((parte) => (fora[parte] ?? 0) > 0)
    .map((parte) => {
      const n = fora[parte] as number
      const [singular, mais] = NOME_DA_PARTE[parte]
      return `Atenção: ${n} ${plural(n, `${singular} do dono ficou`, `${mais} do dono ficaram`)} fora deste texto por falta de espaço; list_lessons abre ${plural(n, 'a', 'todas as')} ${plural(n, singular, mais)}.`
    })
  return avisos.length === 0 ? [] : ['', ...avisos]
}

function rodape(fora: Partial<Record<ParteDaLeitura, number>>): string[] {
  const omitidos = PARTES.filter((parte) => (fora[parte] ?? 0) > 0).map((parte) => {
    const n = fora[parte] as number
    const [singular, mais] = NOME_DA_PARTE[parte]
    return `${n} ${plural(n, singular, mais)} (${FERRAMENTA_DA_PARTE[parte]})`
  })
  return ['', '---', ...(omitidos.length === 0 ? [] : [`Ficaram fora deste texto: ${omitidos.join('; ')}.`]), RODAPE_FIXO]
}

interface Contexto {
  dados: DadosDaLeitura
  estado: Estado
  avisoDaDiretriz: string | undefined
  limite: number
  selecao: Selecao
  /** Os ids dos erros do projeto: o texto separa os do projeto dos gerais. */
  idsDosErrosDoProjeto: ReadonlySet<string>
  totais: Record<ParteDaLeitura, number>
}

function foraDoTexto({ selecao, totais }: Contexto): Partial<Record<ParteDaLeitura, number>> {
  const fora: Partial<Record<ParteDaLeitura, number>> = {}
  for (const parte of PARTES) {
    const n = totais[parte] - selecao[parte].length
    if (n > 0) fora[parte] = n
  }
  return fora
}

function errosDoTexto({ selecao, idsDosErrosDoProjeto }: Contexto, doProjeto: boolean): string[] {
  return (selecao.erros as LinhaDaLeitura[]).filter((erro) => idsDosErrosDoProjeto.has(erro.fonte.id) === doProjeto).map(linhaDoItem)
}

/** O aviso de "Onde parou" aponta para o texto se alguma decisão entrou, e para o rodapé se todas ficaram de fora. */
function ondeEstaoAsDecisoes({ totais, selecao }: Contexto): OndeEstaoAsDecisoes | null {
  if (totais.decididoPeloDono === 0) return null
  return selecao.decididoPeloDono.length > 0 ? 'abaixo' : 'o rodapé'
}

function renderizar(contexto: Contexto): string {
  const { dados, selecao } = contexto
  const fora = foraDoTexto(contexto)
  const linhas = (parte: ParteDaLeitura): string[] => (selecao[parte] as LinhaDaLeitura[]).map(linhaDoItem)
  return [
    `# Leitura curta — ${dados.projeto.nome}`,
    MOLDURA,
    ...avisoDeCorte(fora),
    ...secao('Regras do dono', linhas('regras')),
    ...secaoDasVerificacoes(selecao.verificacoes as Verificacao[]),
    ...secaoDoEstado(contexto.estado, ondeEstaoAsDecisoes(contexto), contexto.avisoDaDiretriz),
    ...secao('Últimos resultados (relatos de quem gravou, não prova)', (selecao.ultimosResultados as Resultado[]).map(linhaDoResultado)),
    ...secao('Depende do dono', linhas('dependeDoDono')),
    ...secao('Entregas em andamento', linhas('entregas')),
    ...secao('Decidido pelo dono depois do último registro', linhas('decididoPeloDono')),
    ...secao('Passagens não lidas', linhas('passagens')),
    ...secao('Bloqueios abertos', linhas('bloqueios')),
    ...secao('Decisões alteradas depois do último registro (quem aceitou é declarado, não comprovado)', linhas('decisoesAlteradas')),
    ...secao('Erros do projeto a não repetir', errosDoTexto(contexto, true)),
    ...secao('Em andamento', linhas('emAndamento')),
    ...secao('Erros gerais a não repetir (ambiente e ferramenta)', errosDoTexto(contexto, false)),
    ...rodape(fora),
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// Orçamento
// ---------------------------------------------------------------------------------------------

const cabe = (contexto: Contexto): boolean => renderizar(contexto).length <= contexto.limite

/** Entra item por item, na ordem, até o primeiro que não cabe. Devolve `false` se algum ficou de fora. */
function acrescentarEnquantoCabe(contexto: Contexto, parte: ParteDaLeitura, itens: Item[]): boolean {
  for (const item of itens) {
    contexto.selecao[parte].push(item)
    if (!cabe(contexto)) {
      contexto.selecao[parte].pop()
      return false
    }
  }
  return true
}

/** Os degraus de regras + verificações, do mais completo ao mais curto: as regras encurtam antes das verificações. */
const DEGRAUS: ReadonlyArray<readonly ['inteiras' | 'curtas', 'inteiras' | 'curtas']> = [
  ['inteiras', 'inteiras'],
  ['curtas', 'inteiras'],
  ['curtas', 'curtas'],
]

/**
 * Regras e verificações nunca somem em silêncio, e uma parte não toma o espaço da outra: tenta cada degrau
 * (regras inteiras + verificações inteiras; regras curtas + verificações inteiras; as duas curtas) e, se nem
 * o último couber, entra uma linha curta de cada parte por vez, até onde couber (a contagem vai no topo).
 */
function escolherRegrasEVerificacoes(
  contexto: Contexto,
  regras: InteirasECurtas<Item>,
  verificacoes: InteirasECurtas<Item>,
): void {
  for (const [deRegras, deVerificacoes] of DEGRAUS) {
    contexto.selecao.regras = regras[deRegras]
    contexto.selecao.verificacoes = verificacoes[deVerificacoes]
    if (cabe(contexto)) return
  }
  contexto.selecao.regras = []
  contexto.selecao.verificacoes = []
  const filas: Array<[ParteDaLeitura, Item[]]> = [
    ['regras', regras.curtas],
    ['verificacoes', verificacoes.curtas],
  ]
  const abertas = new Set<ParteDaLeitura>(['regras', 'verificacoes'])
  const rodadas = Array.from({ length: Math.max(regras.curtas.length, verificacoes.curtas.length) }, (_, i) => i)
  for (const i of rodadas) {
    for (const [parte, itens] of filas) {
      const item = itens[i]
      if (item === undefined || !abertas.has(parte)) continue
      contexto.selecao[parte].push(item)
      if (!cabe(contexto)) {
        contexto.selecao[parte].pop()
        abertas.delete(parte)
      }
    }
  }
}

/**
 * Cabendo tudo, entra tudo (o rodapé "ficaram fora" some e libera o espaço dele). Senão, por prioridade de
 * verdade: assim que algo de uma parte fica de fora, nada de menos importante entra depois.
 */
function escolherOResto(contexto: Contexto, resto: Array<[ParteDaLeitura, Item[]]>): void {
  for (const [parte, itens] of resto) contexto.selecao[parte].push(...itens)
  if (cabe(contexto)) return
  for (const [parte] of resto) contexto.selecao[parte] = []
  for (const [parte, itens] of resto) {
    if (!acrescentarEnquantoCabe(contexto, parte, itens)) return
  }
}

function agruparVerificacoes(verificacoes: Verificacao[]): LeituraCurta['verificacoes'] {
  const grupos = { antes_de_subir: [], antes_de_pronto: [], antes_de_commit: [] } as LeituraCurta['verificacoes']
  for (const { momento, texto, fonte } of verificacoes) grupos[momento].push({ texto, fonte })
  return grupos
}

export function montarLeituraCurta(bruto: DadosDaLeitura, limite: number = LIMITE_LEITURA_CURTA): LeituraCurta {
  const dados = { ...bruto, projeto: { id: bruto.projeto.id, nome: limpar(bruto.projeto.nome) } }
  const regras = regrasDaLeitura(dados.licoes)
  const verificacoes = verificacoesDaLeitura(dados.licoes, dados.falhas)
  const erros = errosDaLeitura(dados.licoes)
  const decididas = decididoPeloDonoDaLeitura(dados)
  const decididasNaLeitura = dados.checkpoint === null ? decididas.slice(0, LIMITE_DECIDIDAS_SEM_REGISTRO) : decididas
  // Do que mais importa para o que menos, na ordem do contrato (erros do projeto, em andamento e, por último, os erros gerais, que entram "até caber").
  const resto: Array<[ParteDaLeitura, Item[]]> = [
    ['dependeDoDono', dependeDoDonoDaLeitura(dados)],
    ['entregas', entregasDaLeitura(dados)],
    ['decididoPeloDono', decididasNaLeitura],
    ['passagens', passagensDaLeitura(dados.passagens)],
    ['bloqueios', bloqueiosDaLeitura(dados)],
    ['decisoesAlteradas', decisoesAlteradasDaLeitura(dados)],
    ['ultimosResultados', resultadosDaLeitura(dados.evidencias)],
    ['erros', erros.doProjeto],
    ['emAndamento', emAndamentoDaLeitura(dados)],
    ['erros', erros.gerais],
  ]
  const totais = Object.fromEntries(PARTES.map((parte) => [parte, 0])) as Record<ParteDaLeitura, number>
  totais.regras = regras.inteiras.length
  totais.verificacoes = verificacoes.inteiras.length
  for (const [parte, itens] of resto) totais[parte] += itens.length
  totais.decididoPeloDono += decididas.length - decididasNaLeitura.length
  const avisoDaDiretriz = dados.avisoDaDiretriz && linhaDoItem({
    ...dados.avisoDaDiretriz, texto: limpar(dados.avisoDaDiretriz.texto),
  })
  // A reserva cobre o aviso e deixa margem para a autoria e a data quando o rodapé tem cortes em todas as partes.
  const limiteDoEstado = limite - 2 * (avisoDaDiretriz?.length ?? 0)
  const contexto: Contexto = {
    dados,
    estado: estadoDaLeitura(dados.checkpoint, limiteDoEstado, 0),
    avisoDaDiretriz: undefined,
    limite,
    idsDosErrosDoProjeto: new Set(erros.doProjeto.map((erro) => erro.fonte.id)),
    selecao: Object.fromEntries(PARTES.map((parte) => [parte, []])) as unknown as Selecao,
    totais,
  }
  if (avisoDaDiretriz !== undefined) {
    // A linha começa pela fonte, autoria e data. Só o texto excedente é abreviado.
    const espaco = limite - renderizar(contexto).length - 1
    contexto.avisoDaDiretriz = cortarEmPalavra(avisoDaDiretriz, espaco)
  }
  // A moldura e o rodapé vêm antes dos itens opcionais. Em limites apertados, eles também limitam o estado.
  const excesso = Math.max(0, renderizar(contexto).length - limite)
  contexto.estado = estadoDaLeitura(dados.checkpoint, limiteDoEstado, excesso)
  escolherRegrasEVerificacoes(contexto, regras, verificacoes)
  escolherOResto(contexto, resto)
  const { selecao } = contexto
  return {
    projeto: dados.projeto,
    geradaEm: dados.geradaEm,
    revisao: dados.revisao,
    regras: selecao.regras as LinhaDaLeitura[],
    verificacoes: agruparVerificacoes(selecao.verificacoes as Verificacao[]),
    estado: contexto.estado,
    ultimosResultados: (selecao.ultimosResultados as Resultado[]).map(({ leitura: _, ...resultado }) => resultado),
    dependeDoDono: selecao.dependeDoDono as LinhaDaLeitura[],
    ...(totais.entregas > 0 ? { entregas: selecao.entregas as LinhaDaLeitura[] } : {}),
    decididoPeloDono: selecao.decididoPeloDono as LinhaDaLeitura[],
    decisoesAlteradas: selecao.decisoesAlteradas as LinhaDaLeitura[],
    passagens: selecao.passagens as LinhaDaLeitura[],
    bloqueios: selecao.bloqueios as LinhaDaLeitura[],
    erros: selecao.erros as LinhaDaLeitura[],
    emAndamento: selecao.emAndamento as LinhaDaLeitura[],
    foraDoTexto: foraDoTexto(contexto),
    markdown: renderizar(contexto),
    limite,
  }
}
