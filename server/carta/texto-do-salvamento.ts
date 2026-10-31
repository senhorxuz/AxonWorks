// O salvamento de compactação (lote 2, D5) como aparece na retomada: uma linha curta e o detalhe, que
// pode entrar cortado em palavra. Puro.
//
// Ordem do detalhe: o que é curto e decide o próximo passo vem primeiro (próximo passo, pendências,
// perguntas abertas, pedidos do dono); o estado completo, que costuma ser longo, vem depois; os
// arquivos mexidos por último. Se o detalhe não cabe, quem perde é o fim.
import type { SalvamentoResumo } from '../../shared/carta.js'

export function linhaCurtaDoSalvamento(salvamento: SalvamentoResumo): string {
  return `Salvamento de compactação, gravado em ${salvamento.criadoEm}; é o registro mais recente.`
}

function lista(titulo: string, itens: string[]): string[] {
  return itens.length === 0 ? [] : [`${titulo}:`, ...itens.map((item) => `- ${item}`)]
}

export function detalheDoSalvamento(salvamento: SalvamentoResumo): string {
  return [
    `Próximo passo: ${salvamento.proximoPasso}`,
    ...lista('Pendências', salvamento.pendencias),
    ...lista('Perguntas abertas', salvamento.perguntasAbertas),
    ...lista('Pedidos do dono', salvamento.pedidosDoDono),
    `Estado: ${salvamento.resumo}`,
    ...lista('Arquivos mexidos', salvamento.arquivosMexidos),
  ].join('\n')
}
