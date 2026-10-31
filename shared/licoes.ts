/**
 * Lições que o Claude não repete (lote 2, D4): coisas aprendidas na prática que valem para as próximas
 * sessões. `projectId` nulo = vale para todos os projetos (ambiente e ferramenta: Windows, git,
 * Stryker); lição de produto fica no projeto. Uma lição aposentada continua guardada, com o motivo.
 *
 * Este arquivo é o contrato entre servidor, MCP, retomada e tela. Não mude sem combinar.
 */

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
}

/** Uma lição é uma frase curta. */
export const LICAO_TEXTO_MAXIMO = 500
/** O motivo de aposentar também. */
export const LICAO_MOTIVO_MAXIMO = 500
