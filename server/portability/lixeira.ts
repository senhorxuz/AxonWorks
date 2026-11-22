import { z } from 'zod'
import { BOARD_COLUMNS, BOARD_LABELS, BOARD_LIMITS } from '../../shared/board.js'
import { FRASE_DO_DONO_MAXIMA, LICAO_MOTIVO_MAXIMO, LICAO_TEXTO_MAXIMO, LINHA_CURTA_MAXIMA, MOMENTOS_DA_VERIFICACAO, TIPOS_DE_LICAO } from '../../shared/licoes.js'
import type { ProjectBundleData, ProjectBundleV3, RegistroPortavelNaLixeira } from '../../shared/portability.js'
import { PortabilityError } from './errors.js'
import { maskSecrets } from './security.js'

const data = z.iso.datetime()
const nome = z.string().min(1).max(80)
const pedido = z.string().min(1).max(500)
const marca = z.strictObject({
  id: z.guid(),
  projectId: z.guid(),
  excluidoEm: data,
  excluidoPor: nome,
  pedidoDoDono: pedido.nullable(),
})

const cartao = z.strictObject({
  column: z.enum(BOARD_COLUMNS.map(coluna => coluna.id)),
  position: z.number(),
  title: z.string().min(BOARD_LIMITS.titleMin).max(BOARD_LIMITS.titleMax),
  description: z.string().max(BOARD_LIMITS.descriptionMax),
  labels: z.array(z.enum(BOARD_LABELS.map(rotulo => rotulo.id))).max(BOARD_LIMITS.labelsMax),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable(),
  checklist: z.array(z.strictObject({
    id: z.guid(), text: z.string().min(1).max(BOARD_LIMITS.checklistItemMax), done: z.boolean(),
  })).max(BOARD_LIMITS.checklistMax),
  needsOwner: z.boolean(),
  createdBy: nome,
  updatedBy: nome,
  createdAt: data,
  updatedAt: data,
  version: z.number().int().nonnegative(),
})

const licao = z.strictObject({
  texto: z.string().min(1).max(LICAO_TEXTO_MAXIMO),
  origem: nome,
  criadaEm: data,
  aposentadaEm: data.nullable(),
  // O método de aposentar guarda motivo, pedido literal e o rótulo que une os dois.
  motivoAposentadoria: z.string().max(2 * LICAO_MOTIVO_MAXIMO + ' (pedido do dono: "")'.length).nullable(),
  tipo: z.enum(TIPOS_DE_LICAO),
  fraseDoDono: z.string().max(FRASE_DO_DONO_MAXIMA).nullable(),
  momento: z.enum(MOMENTOS_DA_VERIFICACAO).nullable(),
  linhaCurta: z.string().min(1).max(LINHA_CURTA_MAXIMA).regex(/^[^\r\n]+$/).nullable(),
  substituiId: z.guid().nullable(),
})
  .refine(l => l.tipo === 'erro' || l.fraseDoDono !== null, 'Regra e verificação precisam da frase do dono.')
  .refine(l => (l.tipo === 'verificacao') === (l.momento !== null), 'Só uma verificação tem momento, e ele é obrigatório.')

export const lixeiraSchema = z.array(z.discriminatedUnion('tipo', [
  marca.extend({ tipo: z.literal('cartao'), registro: cartao }),
  marca.extend({ tipo: z.literal('licao'), registro: licao }),
  marca.extend({ tipo: z.enum(['backlog', 'biblioteca', 'decisao', 'mensagem']) }),
]))

const mascararSePresente = (texto: string | null) => texto && maskSecrets(texto)

export function omitirLixeiraDaV2(data: ProjectBundleData): ProjectBundleData {
  if (data.lixeira === undefined) return data
  const mensagens = new Set<string | null>()
  const backlog = new Set<string>()
  for (const item of data.lixeira) {
    if (item.tipo === 'mensagem') mensagens.add(item.id)
    if (item.tipo === 'backlog') backlog.add(item.id)
  }
  return {
    ...data,
    project: { ...data.project, messages: data.project.messages.filter(item => !mensagens.has(item.id)) },
    backlogItems: data.backlogItems.filter(item => !backlog.has(item.id)),
    messageResolutions: data.messageResolutions?.filter(item =>
      !mensagens.has(item.messageId) && !mensagens.has(item.responseMessageId)),
  }
}

export function sanitizarLixeira(lixeira: RegistroPortavelNaLixeira[]): RegistroPortavelNaLixeira[] {
  return lixeira.map(item => {
    const marca = { excluidoPor: maskSecrets(item.excluidoPor), pedidoDoDono: mascararSePresente(item.pedidoDoDono) }
    if (item.tipo === 'cartao') {
      const registro = item.registro
      return { ...item, ...marca, registro: {
        ...registro, title: maskSecrets(registro.title), description: maskSecrets(registro.description),
        createdBy: maskSecrets(registro.createdBy), updatedBy: maskSecrets(registro.updatedBy),
        checklist: registro.checklist.map(entrada => ({ ...entrada, text: maskSecrets(entrada.text) })),
      } }
    }
    if (item.tipo === 'licao') {
      const registro = item.registro
      return { ...item, ...marca, registro: {
        ...registro, texto: maskSecrets(registro.texto), origem: maskSecrets(registro.origem),
        motivoAposentadoria: mascararSePresente(registro.motivoAposentadoria),
        fraseDoDono: mascararSePresente(registro.fraseDoDono), linhaCurta: mascararSePresente(registro.linhaCurta),
      } }
    }
    return { ...item, ...marca }
  })
}

export function validarLixeiraDoPacote(bundle: ProjectBundleV3): void {
  if (bundle.lixeira === undefined) return
  const alvos = {
    backlog: new Set(bundle.backlogItems.map(item => item.id)),
    biblioteca: new Set(bundle.library.items.map(item => item.id)),
    decisao: new Set(bundle.decisions.map(item => item.id)),
    mensagem: new Set(bundle.project.messages.map(item => item.id)),
  }
  const vistos = new Set<string>()
  for (const item of bundle.lixeira) {
    const chave = `${item.tipo}:${item.id}`
    if (item.projectId !== bundle.project.project.id || vistos.has(chave)) {
      throw new PortabilityError(400, 'invalid_bundle_reference', `Marca de lixeira duplicada ou fora do projeto: ${chave}.`)
    }
    vistos.add(chave)
    if (item.tipo !== 'cartao' && item.tipo !== 'licao' && !alvos[item.tipo].has(item.id)) {
      throw new PortabilityError(400, 'invalid_bundle_reference', `Item da lixeira ausente no pacote: ${chave}.`)
    }
  }
}
