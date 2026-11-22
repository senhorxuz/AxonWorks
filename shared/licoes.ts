/**
 * Lições que o Claude não repete (lote 2, D4): coisas aprendidas na prática que valem para as próximas
 * sessões. `projectId` nulo = vale para todos os projetos (ambiente e ferramenta: Windows, git,
 * Stryker); lição de produto fica no projeto. Uma lição aposentada continua guardada, com o motivo.
 *
 * Este arquivo é o contrato entre servidor, MCP, retomada e tela. Não mude sem combinar.
 */

/**
 * Os três tipos de memória. `erro`: a IA anota sozinha, no projeto ou global (ambiente e ferramenta).
 * `regra` e `verificacao`: vêm da fala do dono, na conversa, e são sempre do projeto.
 */
export type TipoDeLicao = 'erro' | 'regra' | 'verificacao'
export const TIPOS_DE_LICAO: readonly TipoDeLicao[] = ['erro', 'regra', 'verificacao']

/** Quando uma verificação vale. */
export type MomentoDaVerificacao = 'antes_de_subir' | 'antes_de_pronto' | 'antes_de_commit'
export const MOMENTOS_DA_VERIFICACAO: readonly MomentoDaVerificacao[] = ['antes_de_subir', 'antes_de_pronto', 'antes_de_commit']

export const LINHA_CURTA_MAXIMA = 120
export const FRASE_DO_DONO_MAXIMA = 1000

export interface Licao {
  id: string
  /** Projeto a que a lição pertence; nulo = vale para todos os projetos. */
  projectId: string | null
  texto: string
  /** Agente que registrou. */
  origem: string
  criadaEm: string
  aposentadaEm: string | null
  motivoAposentadoria: string | null
  /** Lições antigas são `erro`. */
  tipo: TipoDeLicao
  /** Frase literal do dono (regra e verificação). */
  fraseDoDono: string | null
  /** Só em verificação. */
  momento: MomentoDaVerificacao | null
  /** Versão curta, até 120 caracteres. */
  linhaCurta: string | null
  /** A lição que esta corrigiu. */
  substituiId: string | null
}

/** Uma lição é uma frase curta. */
export const LICAO_TEXTO_MAXIMO = 500
/** O motivo de aposentar também. */
export const LICAO_MOTIVO_MAXIMO = 500

/** Histórico de relatos de falha de uma verificação. */
export interface FalhaDaVerificacao {
  verificacaoId: string
  quantas: number
  ultimaEm: string
  ultimoCheckpointId: string
  ultimoDetalhe: string
}
