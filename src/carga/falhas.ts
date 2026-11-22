// Falhas de carga da tela, em texto de produto. Puro: quem usa decide o que mostrar.
// O dono precisa distinguir "a Axon não respondeu" (os dados continuam guardados) de
// "este projeto não existe" e de "não consegui abrir". Nada disso é "não foi possível salvar".

export const TEXTO_SERVIDOR_FORA = 'Não consegui falar com a Axon neste computador. Seus dados continuam guardados.'

export type TipoDeFalha = 'servidor-fora' | 'projeto-inexistente' | 'abrir-projeto' | 'abrir-lista'
export interface FalhaDeCarga { tipo: TipoDeFalha; mensagem: string }

/**
 * A Axon não respondeu: o fetch nem chegou ao servidor, ou o que voltou não era JSON (o servidor caiu atrás de um
 * proxy). Quem faz o pedido (`request` em api.ts) marca a falha com esta classe; um TypeError qualquer, vindo de
 * um defeito da própria tela, não é "servidor fora do ar".
 */
export class FalhaDeRede extends Error {
  constructor(public readonly causa?: unknown) {
    super('A Axon não respondeu.')
  }
}

export function ehFalhaDeRede(erro: unknown): boolean {
  return erro instanceof FalhaDeRede
}

export function textoDoErroDeRede(erro: unknown): string | null {
  return ehFalhaDeRede(erro) ? TEXTO_SERVIDOR_FORA : null
}

/** 400 (endereço mal formado) e 404 (projeto apagado) chegam ao dono como a mesma frase. */
function projetoNaoExiste(erro: unknown): boolean {
  const status = (erro as { status?: unknown } | null | undefined)?.status
  return status === 400 || status === 404
}

export function classificarFalhaDeCarga(erro: unknown, alvo: 'lista' | 'projeto'): FalhaDeCarga {
  if (ehFalhaDeRede(erro)) return { tipo: 'servidor-fora', mensagem: TEXTO_SERVIDOR_FORA }
  if (alvo === 'lista') return { tipo: 'abrir-lista', mensagem: 'Não consegui carregar a lista de projetos.' }
  if (projetoNaoExiste(erro)) return { tipo: 'projeto-inexistente', mensagem: 'Este projeto não existe mais ou o link está errado.' }
  return { tipo: 'abrir-projeto', mensagem: 'Não consegui abrir este projeto.' }
}

/** O número ao lado de "Projetos" na barra lateral. Enquanto não sabemos, "–": "00" parece que tudo sumiu. */
export function contagemDaBarra(quantidade: number, estado: { carregando: boolean; falhou: boolean }): string {
  if (estado.carregando || estado.falhou) return '–'
  return String(quantidade).padStart(2, '0')
}
