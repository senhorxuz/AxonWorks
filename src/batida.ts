/**
 * Batida da tela. O servidor da Axon que o atalho liga se desliga sozinho quando ninguém o usa; enquanto
 * a aba está à vista, a página avisa a cada 5 minutos (GET /api/health) que ainda tem gente olhando.
 * Aba escondida não bate: se ninguém vê a tela, o servidor pode descansar.
 *
 * A página e o temporizador chegam de fora (em `main.tsx` são o `document` e o `window`), então o teste
 * anda o tempo e a visibilidade sem navegador.
 */

export const INTERVALO_DA_BATIDA_MS = 5 * 60_000

export interface PaginaComVisibilidade {
  readonly visibilityState: string
  addEventListener(tipo: 'visibilitychange', ouvinte: () => void): void
  removeEventListener(tipo: 'visibilitychange', ouvinte: () => void): void
}

export interface Temporizador {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(id: unknown): void
}

/**
 * Começa a bater se a aba estiver à vista e acompanha as mudanças de visibilidade:
 * ao esconder, para; ao mostrar, bate na hora e volta ao ritmo de 5 minutos.
 * Devolve a função que desfaz tudo.
 */
export function manterServidorVivo(pagina: PaginaComVisibilidade, bater: () => unknown, temporizador: Temporizador): () => void {
  let ativa: { id: unknown } | null = null

  const ligar = (): void => {
    ativa = { id: temporizador.setInterval(() => { bater() }, INTERVALO_DA_BATIDA_MS) }
  }
  const desligar = (): void => {
    if (ativa === null) return
    temporizador.clearInterval(ativa.id)
    ativa = null
  }
  const aoMudarVisibilidade = (): void => {
    if (pagina.visibilityState !== 'visible') {
      desligar()
      return
    }
    if (ativa !== null) return
    bater()
    ligar()
  }

  if (pagina.visibilityState === 'visible') ligar()
  pagina.addEventListener('visibilitychange', aoMudarVisibilidade)
  return () => {
    pagina.removeEventListener('visibilitychange', aoMudarVisibilidade)
    desligar()
  }
}

/**
 * Uma batida. Devolve se deu certo. Servidor fora do ar não é erro da tela: a batida é só um aviso, então a
 * falha (rede ou resposta de erro) vira `false` em vez de estourar.
 */
export function pedirSaude(buscar: (url: string, init: { cache: 'no-store' }) => Promise<{ ok: boolean }>): Promise<boolean> {
  return buscar('/api/health', { cache: 'no-store' }).then(resposta => resposta.ok, () => false)
}

/** A frase da faixa que a tela mostra quando a batida falha: o servidor se desligou sem ninguém usar. */
export const TEXTO_DO_AVISO = 'A Axon desligou por falta de uso. Clique no atalho Axon para ligar de novo.'

export interface AvisoDeDesligamento {
  /** Verdadeiro enquanto a última batida falhou. */
  desligada(): boolean
  /** Avisa `ouvinte` quando `desligada()` muda. Devolve a função que cancela a assinatura. */
  assinar(ouvinte: () => void): () => void
  /** Guarda o resultado de uma batida: falhou acende o aviso, deu certo apaga. */
  registrar(deuCerto: boolean): void
}

/**
 * O estado do aviso de desligamento, no formato que o React lê de fora (`useSyncExternalStore`). Começa apagado:
 * uma tela recém-aberta ainda não sabe de nada. A batida seguinte que der certo apaga, sem o dono fazer nada.
 */
export function criarAvisoDeDesligamento(): AvisoDeDesligamento {
  let desligada = false
  const ouvintes = new Set<() => void>()
  return {
    desligada: () => desligada,
    assinar(ouvinte) {
      ouvintes.add(ouvinte)
      return () => { ouvintes.delete(ouvinte) }
    },
    registrar(deuCerto) {
      if (desligada === !deuCerto) return
      desligada = !deuCerto
      for (const ouvinte of ouvintes) ouvinte()
    },
  }
}

/** A batida da tela: pede a saúde e conta ao aviso se deu certo. É o que `manterServidorVivo` chama. */
export function criarBatida(pedir: () => Promise<boolean>, aviso: Pick<AvisoDeDesligamento, 'registrar'>): () => Promise<void> {
  return () => pedir().then(aviso.registrar)
}
