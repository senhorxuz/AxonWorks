/**
 * A leitura que basta ("vai na Axon e lê"): o texto curto, na ordem de importância, que uma IA lê ao
 * entrar num projeto. Este arquivo é o contrato entre a montagem (`server/carta/leitura-curta.ts`), a
 * ferramenta `get_resume_brief` (modo curto) e a rota HTTP. Não mude sem combinar.
 */
import type { MomentoDaVerificacao } from './licoes.js'

export type TipoDaFonte =
  | 'checkpoint'
  | 'licao'
  | 'aprovacao'
  | 'decisao'
  | 'cartao'
  | 'passagem'
  | 'bloqueio'
  | 'tarefa'
  | 'evidencia'
  | 'diretriz'
  | 'backlog'

/** O registro de onde uma linha veio, para a IA abrir o detalhe sem chutar. */
export interface Fonte {
  tipo: TipoDaFonte
  id: string
}

export interface LinhaDaLeitura {
  texto: string
  fonte: Fonte
}

export const LIMITE_LEITURA_CURTA = 6_000
/** O que `maxChars` aceita no modo curto. */
export const LIMITE_MINIMO_DA_LEITURA = 2_000
export const LIMITE_MAXIMO_DA_LEITURA = 20_000

/** As partes do texto que podem ficar de fora (e são contadas no rodapé). */
export type ParteDaLeitura =
  | 'regras'
  | 'verificacoes'
  | 'ultimosResultados'
  | 'dependeDoDono'
  | 'entregas'
  | 'decididoPeloDono'
  | 'passagens'
  | 'bloqueios'
  | 'decisoesAlteradas'
  | 'erros'
  | 'emAndamento'

export interface LeituraCurta {
  projeto: { id: string; nome: string }
  geradaEm: string
  revisao: number
  regras: LinhaDaLeitura[]
  verificacoes: Record<MomentoDaVerificacao, LinhaDaLeitura[]>
  estado: {
    emUmaFrase: string | null
    ultimoRegistro: { id: string; agente: string; criadoEm: string } | null
    proximoPasso: LinhaDaLeitura | null
    /** Preenchida quando nenhum registro sustenta um próximo passo. */
    lacuna: string | null
  }
  /** Evidências do último registro, como relato (nunca "comprovado"), com o frescor recalculado. */
  ultimosResultados: Array<{
    comando: string
    resultado: 'passed' | 'failed' | 'not_run'
    frescor: string
    conferida: boolean
    fonte: Fonte
  }>
  dependeDoDono: LinhaDaLeitura[]
  entregas?: LinhaDaLeitura[]
  /** Aprovações decididas pelo dono na tela depois do último registro (o resumo acima pode não saber delas). Decisões ficam em `decisoesAlteradas`. */
  decididoPeloDono: LinhaDaLeitura[]
  /** Decisões aceitas, revogadas ou substituídas depois do último registro. Quem as alterou é nome declarado pela IA, não comprovado. */
  decisoesAlteradas: LinhaDaLeitura[]
  passagens: LinhaDaLeitura[]
  bloqueios: LinhaDaLeitura[]
  erros: LinhaDaLeitura[]
  emAndamento: LinhaDaLeitura[]
  /** Quantos itens de cada parte ficaram fora do texto. */
  foraDoTexto: Partial<Record<ParteDaLeitura, number>>
  markdown: string
  limite: number
}
