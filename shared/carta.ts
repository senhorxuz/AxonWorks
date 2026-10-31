// Contrato compartilhado da "carta" (tela "Onde paramos") e da retomada injetada pelos ganchos.
// Só tipos e constantes: nenhuma regra mora aqui.

/** Agente que assina o rascunho gravado sozinho pelo gancho de fechamento. */
export const AGENTE_AUTOMATICO = 'Claude (automático)'
/** Teto, em caracteres, da retomada injetada na sessão. Item entra inteiro ou não entra. */
export const LIMITE_RETOMADA = 10_000
/** Projeto parado há tantos dias (da última atividade registrada) abre pela carta. */
export const DIAS_PARA_ABRIR_CARTA = 7
/** Troca qualquer segredo apagado do texto. */
export const MARCADOR_SEGREDO = '[segredo removido]'
/** `nextAction` fixo do rascunho automático. */
export const PROXIMO_PASSO_AUTOMATICO = 'O registro desta etapa ainda não foi gravado; ver o resumo acima.'

export type GrupoFalta = 'precisa_de_voce' | 'travado' | 'em_andamento' | 'a_fazer' | 'ideias'
export type OrigemItem = 'cartao' | 'tarefa' | 'backlog' | 'aprovacao' | 'decisao' | 'bloqueio'

export interface ItemFalta {
  origem: OrigemItem
  id: string
  titulo: string
  detalhe: string | null
  etapa: string | null
  versao: number | null
}

export interface ItemFeito {
  origem: 'cartao' | 'tarefa' | 'registro'
  id: string
  texto: string
  quando: string
}

export interface MesFeito {
  /** 'YYYY-MM' no fuso America/Sao_Paulo (o do dono), não em UTC. */
  mes: string
  itens: ItemFeito[]
}

export interface RascunhoAutomaticoVisivel {
  resumo: string
  atualizadoEm: string
  /** Versão do rascunho: a tela a usa para descartá-lo (27/10/2026). Opcional só para os testes antigos. */
  versao?: number
}

/** Um salvamento de compactação (D5), inteiro, para a seção "Salvamentos de compactação". */
export interface SalvamentoResumo {
  id: string
  criadoEm: string
  humanSummary: string | null
  resumo: string
  pedidosDoDono: string[]
  pendencias: string[]
  perguntasAbertas: string[]
  arquivosMexidos: string[]
  proximoPasso: string
}

/** A carta mostra tantos salvamentos de compactação, os mais recentes. */
export const SALVAMENTOS_NA_CARTA = 5

export interface Carta {
  projeto: { id: string; nome: string; objetivo: string }
  ultimaAtividade: string | null
  diasParado: number | null
  emUmaFrase: string | null
  /** Últimos 7 dias antes da última atividade, mais novo primeiro. */
  feitoRecente: ItemFeito[]
  /** O resto, mês mais novo primeiro. */
  feitoPorMes: MesFeito[]
  falta: Record<GrupoFalta, ItemFalta[]>
  rascunhoAutomatico: RascunhoAutomaticoVisivel | null
  /** Os salvamentos de compactação mais recentes (até `SALVAMENTOS_NA_CARTA`), mais novo primeiro. */
  salvamentos: SalvamentoResumo[]
  /** O registro mais recente (maior revisão) é um salvamento de compactação: `salvamentos[0]` é ele (D5). */
  ultimoRegistroEhSalvamento: boolean
  /** Até 5 itens que dá para começar agora, em ordem de prioridade e depois de idade (lote 2, D3). */
  proximoPronto: ItemFalta[]
  /** Frases curtas de aviso para a tela do dono, sem jargão (lote 2, D2: diretriz velha). */
  avisos: string[]
  /** Os mesmos avisos no texto da retomada do Claude, com o nome da ferramenta (D2). */
  avisosDaRetomada: string[]
  saude: { ultimoRegistroAutomatico: string | null; ultimoErro: string | null }
}
