export const TIPOS_NA_LIXEIRA = ['cartao', 'licao', 'decisao', 'mensagem', 'backlog', 'biblioteca'] as const

export type TipoNaLixeira = typeof TIPOS_NA_LIXEIRA[number]

export interface ItemNaLixeira {
  tipo: TipoNaLixeira
  id: string
  projectId: string
  titulo: string
  excluidoEm: string
  excluidoPor: string
  pedidoDoDono: string | null
}
