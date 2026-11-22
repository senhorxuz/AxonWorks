export type OrigemDaAprovacao = 'tela' | 'chat'

export type OrigemDoDesfazimento =
  | { origem: 'tela' }
  | { origem: 'chat'; agente: string; pedidoDoDono: string }

export interface AprovacaoDaEntrega {
  id: string
  tipo: 'visual' | 'publicacao'
  ambiente: string | null
  origem: OrigemDaAprovacao
  fraseDoDono: string | null
  registradaPor: string
  em: string
  desfeitaEm: string | null
  desfeitaPor?: OrigemDoDesfazimento
  versao: string | null
}

export interface EstadoDaEntrega {
  cardId: string
  testes: { estado: 'passando' | 'falhando' | 'nao_rodado'; evidenciaId: string | null; em: string | null }
  codigo: { onde: 'nao_feito' | 'local' | 'enviado'; commit: string | null; ramo: string | null; em: string | null }
  publicacoes: Array<{ ambiente: string; commit: string | null; publicadoEm: string; evidenciaId: string | null; registradoPor: string }>
  aprovacoes: AprovacaoDaEntrega[]
  atualizadoEm: string
}

/** Estado e origem das aprovações vigentes, para a carta e a leitura curta. */
export interface ResumoDaEntrega {
  cardId: string
  titulo: string
  resumo: string
  autorias: string[]
}
