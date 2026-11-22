/**
 * "O que será removido" ao excluir um projeto: a lista completa, o que não deu para contar e a dica do campo de confirmação.
 * A lista segue o que `deleteProject` (server/store.ts) apaga de fato; sem tela.
 */
export interface ContagemDoProjeto {
  tarefas: number | null
  checkpoints: number | null
  mensagens: number | null
  backlog: number | null
  cartoes: number | null
  documentos: number | null
  decisoes: number | null
  bloqueios: number | null
  orientacoes: number | null
  versoesDaDiretriz: number | null
  propostas: number | null
  passagens: number | null
  rascunhos: number | null
}

export const ROTULOS_DO_REMOVIDO: Record<keyof ContagemDoProjeto, string> = {
  tarefas: 'Tarefas',
  checkpoints: 'Checkpoints',
  mensagens: 'Mensagens',
  backlog: 'Itens de backlog',
  cartoes: 'Cartões do Quadro',
  documentos: 'Documentos da Biblioteca',
  decisoes: 'Decisões',
  bloqueios: 'Bloqueios',
  orientacoes: 'Regras, verificações e erros',
  versoesDaDiretriz: 'Versões da diretriz',
  propostas: 'Propostas de aprovação',
  passagens: 'Passagens entre IAs',
  rascunhos: 'Rascunhos de trabalho',
}

export interface LinhaDoRemovido { chave: keyof ContagemDoProjeto; rotulo: string; valor: string; incerto: boolean }

export function linhasDoRemovido(contagem: ContagemDoProjeto): LinhaDoRemovido[] {
  return (Object.keys(ROTULOS_DO_REMOVIDO) as (keyof ContagemDoProjeto)[]).map(chave => {
    const quantidade = contagem[chave]
    return { chave, rotulo: ROTULOS_DO_REMOVIDO[chave], valor: quantidade === null ? '–' : String(quantidade), incerto: quantidade === null }
  })
}

/** Quantos itens a lista tem; se a resposta não é uma lista, não dá para dizer (nunca vira zero de mentira). */
export function contarLista(valor: unknown): number | null {
  return Array.isArray(valor) ? valor.length : null
}

/** As orientações (regras, verificações, erros) que são só deste projeto; as de todos os projetos ficam. */
export function contarOrientacoes(licoes: ReadonlyArray<{ projectId: string | null }>, projectId: string): number {
  return licoes.filter(licao => licao.projectId === projectId).length
}

export function dicaDaConfirmacao(nome: string): string {
  return `Digite: ${nome}`
}
