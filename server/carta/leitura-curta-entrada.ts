// A porta de entrada da leitura curta: qual projeto, qual agente e qual limite. Regra de recusa com código
// estável, fora de `mcp-tools.ts` e `app.ts`, que só fazem a ligação.
import {
  LIMITE_LEITURA_CURTA,
  LIMITE_MAXIMO_DA_LEITURA,
  LIMITE_MINIMO_DA_LEITURA,
} from '../../shared/leitura-curta.js'
import type { Project } from '../../shared/types.js'
import { acharProjetoPorPasta } from '../ganchos/achar-projeto.js'
import type { WorkspaceStore } from '../store.js'
import { DomainError } from '../store/errors.js'
import { lerDadosDaLeitura } from './leitura-curta-ler.js'
import { montarLeituraCurta } from './leitura-curta.js'
import { intervaloDasMudancas, marcaDaLeitura, montarMudancas } from './mudancas.js'

/** Quem lê, quando ninguém diz: é por esse nome que chegam as passagens não lidas. */
export const AGENTE_PADRAO_DA_LEITURA = 'Claude'

export interface PedidoDeLeitura {
  projectId?: string
  pasta?: string
}

/**
 * Descobre o projeto do pedido. `projectId` vale quando vem; se vier junto com uma `pasta` que aponta para
 * outro projeto, o `projectId` vence e a pasta é ignorada. Sem `projectId`, a pasta segue a regra de
 * `achar-projeto.ts` (pasta igual ou contida). `projetos` só é lido quando precisa.
 */
export function projetoDoPedido(listarProjetos: () => Project[], pedido: PedidoDeLeitura): string {
  const id = pedido.projectId?.trim()
  if (id) return id
  const pasta = pedido.pasta?.trim()
  if (!pasta) {
    throw new DomainError(400, 'informe_projeto_ou_pasta', 'Informe o projeto (projectId) ou a pasta da conversa (pasta).')
  }
  const projeto = acharProjetoPorPasta(listarProjetos(), pasta)
  if (projeto === null) {
    throw new DomainError(404, 'projeto_nao_encontrado_para_pasta', 'Nenhum projeto da Axon está ligado a esta pasta.')
  }
  return projeto.id
}

/** O limite de caracteres do modo curto: o padrão quando não vem, ou um inteiro de 2.000 a 20.000. */
export function limiteDaLeitura(valor: unknown): number {
  if (valor === undefined) return LIMITE_LEITURA_CURTA
  const numero = typeof valor === 'string' ? Number(valor) : valor
  if (!Number.isInteger(numero) || (numero as number) < LIMITE_MINIMO_DA_LEITURA || (numero as number) > LIMITE_MAXIMO_DA_LEITURA) {
    throw new DomainError(400, 'invalid_input', `maxChars deve ser um número inteiro de ${LIMITE_MINIMO_DA_LEITURA} a ${LIMITE_MAXIMO_DA_LEITURA}.`)
  }
  return numero as number
}

/** O agente da leitura: o nome que veio, sem espaços nas pontas, ou o padrão. */
export function agenteDaLeitura(valor: unknown): string {
  const nome = typeof valor === 'string' ? valor.trim() : ''
  return nome === '' ? AGENTE_PADRAO_DA_LEITURA : nome
}

function leituraInteiraComMarca(store: WorkspaceStore, projectId: string, agent: string, geradaEm: string, limite: number, aviso = ''): string {
  const marca = marcaDaLeitura(geradaEm)
  const dados = lerDadosDaLeitura(store, projectId, agent, geradaEm)
  const disponivel = limite - marca.length - aviso.length - 1
  const leitura = montarLeituraCurta(dados, disponivel)
  const linhas = leitura.markdown.split('\n')
  linhas.splice(2, 0, marca + aviso)
  return linhas.join('\n')
}

export function lerPedidoCurto(
  store: WorkspaceStore, pedido: PedidoDeLeitura & { agent: string; maxChars?: number; desde?: unknown },
  relogio: () => Date = () => new Date(),
): string {
  const agora = relogio()
  const geradaEm = agora.toISOString()
  const projectId = projetoDoPedido(() => store.listProjects(), pedido)
  const limite = limiteDaLeitura(pedido.maxChars)
  if (pedido.desde === undefined) return leituraInteiraComMarca(store, projectId, pedido.agent, geradaEm, limite)

  const { desde, antigo } = intervaloDasMudancas(pedido.desde, agora)
  if (antigo) {
    const aviso = `\nA marca ${desde} tem mais de 90 dias. É melhor fazer a leitura inteira para retomar o contexto.`
    return leituraInteiraComMarca(store, projectId, pedido.agent, geradaEm, limite, aviso)
  }

  const { lixeira, restauracoes } = store.historicoDaLixeira(projectId, desde)
  const cartoes = [
    ...store.getBoard(projectId).cards,
    ...lixeira.filter((item) => item.tipo === 'cartao').map(({ id, titulo }) => ({ id, title: titulo })),
  ]
  return montarMudancas({
    decisoes: store.listDecisions(projectId, { includeHistory: true }).map((item) => ({
      item, eventos: store.getDecisionTimeline(projectId, item.id).events,
    })),
    licoes: store.listarLicoes(projectId, { incluirAposentadas: true }),
    aprovacoes: store.listApprovals(projectId),
    passagens: store.getHandoffDeliveries(projectId, pedido.agent),
    bloqueios: store.listBlockers(projectId, { includeClosed: true }).map((item) => ({
      item, eventos: store.getBlockerTimeline(projectId, item.id).events,
    })),
    checkpoints: store.getProject(projectId).checkpoints,
    cartoes: cartoes.map((item) => ({ item, eventos: store.listBoardCardEvents(projectId, item.id) })),
    evidencias: store.listEvidence(projectId),
    lixeira,
    restauracoes,
  }, desde, geradaEm, limite)
}
