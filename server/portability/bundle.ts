import { z } from 'zod'
import type {
  PortableHandoffDelivery,
  PortableHandoffReceipt,
  PortableLibrary,
  ProjectBundle,
  ProjectBundleData,
  ProjectBundleV1,
  ProjectBundleV2,
  ProjectBundleV3,
} from '../../shared/portability.js'
import type {
  CharterRevision,
  Decision,
  MessageResolution,
  ProjectBlocker,
  TaskTransitionEvent,
  WorkDraft,
} from '../../shared/continuity.js'
import type {
  AgentMessage,
  BacklogItem,
  Checkpoint,
  Evidence,
  ExtrasDoSalvamento,
  Project,
  ProjectDetail,
  Task,
} from '../../shared/types.js'
import { PortabilityError } from './errors.js'
import { maskSecrets } from './security.js'

/** Limite de tamanho serializado: 1 MB para suportar biblioteca, histórico de charter e contratos */
export const MAX_BUNDLE_SERIALIZED_BYTES = 1024 * 1024

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const uuidSchema = z.string().regex(UUID_RE, 'UUID inválido')
const isoDateSchema = z.string().refine((val) => !isNaN(Date.parse(val)), 'Data ISO 8601 inválida')
const agentNameSchema = z.string().trim().min(1).max(120)

const evidenceSchema = z.object({
  command: z.string().max(2000),
  outcome: z.enum(['passed', 'failed', 'not_run']),
  details: z.string().max(10000),
  provenance: z.literal('agent_report'),
})

const taskAcceptanceCriterionSchema = z.object({
  id: uuidSchema,
  description: z.string().max(2000),
  completed: z.boolean(),
})

const taskExpectedOutputSchema = z.object({
  id: uuidSchema,
  title: z.string().max(300),
  kind: z.enum(['file_path', 'content_item', 'artifact', 'design_asset', 'dataset', 'other']),
  locator: z.string().max(500).optional(),
})

const taskSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  title: z.string().trim().min(1).max(300),
  status: z.enum(['todo', 'in_progress', 'blocked', 'done']),
  assignee: z.string().trim().min(1).max(120).nullable(),
  leaseUntil: isoDateSchema.nullable(),
  version: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  blockedReason: z.string().max(2000).nullable().optional().default(null),
  completionCheckpointId: uuidSchema.nullable().optional().default(null),
  workIntent: z
    .object({
      objective: z.string().max(2000),
      areas: z
        .array(
          z.object({
            kind: z.enum(['file_path', 'content_item', 'design_asset', 'dataset', 'external_system', 'other']),
            locator: z.string().max(500),
            access: z.enum(['read', 'write']),
          }),
        )
        .max(20),
      expectedOutputs: z.array(z.string().max(500)).max(20),
      plannedChecks: z.array(z.string().max(500)).max(20),
    })
    .nullable()
    .optional()
    .default(null),
  description: z.string().max(10000).nullable().optional().default(null),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional().default('medium'),
  acceptanceCriteria: z.array(taskAcceptanceCriterionSchema).max(100).optional().default([]),
  dependencyTaskIds: z.array(uuidSchema).max(100).optional().default([]),
  expectedOutputs: z.array(taskExpectedOutputSchema).max(100).optional().default([]),
})

// Salvamento de compactação (lote 2, D5): as quatro listas do salvamento. Mesmos limites do
// `requireStringArray` da gravação (50 itens de até 2.000 caracteres).
const listaDoSalvamentoSchema = z.array(z.string().max(2000)).max(50)
const extrasDoSalvamentoSchema = z.object({
  pedidosDoDono: listaDoSalvamentoSchema,
  pendencias: listaDoSalvamentoSchema,
  perguntasAbertas: listaDoSalvamentoSchema,
  arquivosMexidos: listaDoSalvamentoSchema,
})

const checkpointSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  taskId: uuidSchema.nullable(),
  agent: agentNameSchema,
  summary: z.string().max(20000),
  // humanSummary (Parte 4/5 — extensão): só a v3 popula este campo (ver
  // sanitizeProjectDetail). Fica optional aqui porque checkpointSchema é
  // compartilhado por v1/v2/v3 — sem isso, um checkpoint v3 legítimo com o
  // campo seria descartado em silêncio pelo parse do zod (z.object faz strip
  // de chaves não declaradas por padrão).
  humanSummary: z.string().trim().min(1).max(280).optional(),
  // kind e extras (lote 2, D5): só a v3 os popula (ver sanitizeProjectDetail). Optional pelo mesmo
  // motivo do humanSummary: o schema é compartilhado e o zod descartaria as chaves em silêncio.
  kind: z.enum(['normal', 'compactacao']).optional(),
  extras: extrasDoSalvamentoSchema.optional(),
  nextStep: z.string().max(10000),
  blockers: z.array(z.string().max(2000)).max(50),
  decisions: z.array(z.string().max(2000)).max(50),
  evidence: z.array(evidenceSchema).max(50),
  revision: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
})

const messageSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  from: agentNameSchema,
  to: agentNameSchema,
  kind: z.enum(['note', 'question', 'review', 'handoff']),
  body: z.string().max(20000),
  createdAt: isoDateSchema,
})

const projectSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(20000),
  workspacePath: z.string().max(2000),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  revision: z.number().int().nonnegative(),
})

export const projectDetailSchema = z.object({
  project: projectSchema,
  tasks: z.array(taskSchema).max(500),
  checkpoints: z.array(checkpointSchema).max(500),
  messages: z.array(messageSchema).max(1000),
})

const backlogItemSchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000),
  priority: z.enum(['urgent', 'high', 'medium', 'low']),
  stage: z.enum(['idea', 'ready', 'promoted', 'archived']),
  createdBy: agentNameSchema,
  promotedTaskId: uuidSchema.nullable(),
  version: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})

const portableDeliverySchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  checkpointId: uuidSchema,
  taskId: uuidSchema.nullable(),
  from: agentNameSchema,
  to: agentNameSchema,
  message: z.string().max(8000),
  createdAt: isoDateSchema,
})

const portableReceiptSchema = z.strictObject({
  projectId: uuidSchema,
  deliveryId: uuidSchema,
  agent: agentNameSchema,
  acknowledgedAt: isoDateSchema,
})

const messageResolutionSchema = z.strictObject({
  projectId: uuidSchema,
  messageId: uuidSchema,
  agent: agentNameSchema,
  note: z.string().trim().max(8000),
  responseMessageId: uuidSchema.nullable(),
  checkpointId: uuidSchema.nullable(),
  resolvedAt: isoDateSchema,
})

const charterRevisionSchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  revision: z.number().int().positive(),
  body: z.string().max(20000),
  createdBy: agentNameSchema,
  createdAt: isoDateSchema,
  sourceKind: z.enum(['human_directive', 'agent_proposal']),
  supersedesId: uuidSchema.nullable().optional().default(null),
})

const decisionSchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().max(8000),
  status: z.enum(['proposed', 'accepted', 'superseded', 'revoked']),
  proposedBy: agentNameSchema,
  acceptedBy: agentNameSchema.nullable().optional().default(null),
  revokedBy: agentNameSchema.nullable().optional().default(null),
  supersedesId: uuidSchema.nullable().optional().default(null),
  supersededById: uuidSchema.nullable().optional().default(null),
  version: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  source: z.strictObject({
    kind: z.enum(['agent_proposal', 'human_directive']),
    note: z.string().max(2000).optional(),
  }),
})

const blockerSchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  taskId: uuidSchema.nullable().optional().default(null),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(8000),
  status: z.enum(['open', 'mitigated', 'resolved', 'accepted_risk']),
  openedBy: agentNameSchema,
  assignee: agentNameSchema.nullable().optional().default(null),
  resolution: z.string().max(2000).nullable().optional().default(null),
  resolvedBy: agentNameSchema.nullable().optional().default(null),
  resolvedAt: isoDateSchema.nullable().optional().default(null),
  sourceCheckpointId: uuidSchema.nullable().optional().default(null),
  version: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})

const contentItemSchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['note', 'specification', 'research', 'reference', 'artifact']),
  status: z.enum(['active', 'archived']),
  currentRevisionId: uuidSchema,
  version: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})

const contentRevisionSchema = z.strictObject({
  id: uuidSchema,
  itemId: uuidSchema,
  revision: z.number().int().positive(),
  body: z.string().max(100000),
  format: z.enum(['plain_text', 'markdown']),
  createdBy: agentNameSchema,
  createdAt: isoDateSchema,
  supersedesId: uuidSchema.nullable().optional().default(null),
  sourceKind: z.enum(['human_directive', 'agent_report', 'external_reference']),
  sourceLabel: z.string().max(300).optional(),
  sourceUrl: z.string().max(2000).optional(),
  declaredValidity: z.enum(['current', 'needs_review', 'outdated']),
})

const contentRelationSchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  sourceRevisionId: uuidSchema,
  targetType: z.enum(['content', 'task', 'checkpoint', 'decision', 'blocker']),
  targetId: uuidSchema,
  kind: z.enum(['supports', 'contradicts', 'supersedes', 'required_input', 'produced_output', 'related']),
  createdBy: agentNameSchema,
  createdAt: isoDateSchema,
})

const librarySchema = z.strictObject({
  items: z.array(contentItemSchema).max(500),
  revisions: z.array(contentRevisionSchema).max(2000),
  relations: z.array(contentRelationSchema).max(2000),
})

const taskEventSchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  taskId: uuidSchema,
  fromStatus: z.string().max(50),
  toStatus: z.string().max(50),
  agent: agentNameSchema,
  note: z.string().max(2000),
  checkpointId: uuidSchema.nullable().optional().default(null),
  createdAt: isoDateSchema,
})

const workDraftObservedCheckSchema = z.strictObject({
  commandOrMethod: z.string().max(500),
  reportedOutcome: z.string().max(500),
})

const workDraftSchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  actorId: agentNameSchema,
  taskId: uuidSchema.nullable().optional().default(null),
  version: z.number().int().nonnegative(),
  status: z.literal('undelivered'),
  summary: z.string().max(8000),
  nextAction: z.string().max(8000),
  changedAreas: z.array(z.string().max(500)).max(50),
  openIssues: z.array(z.string().max(500)).max(50),
  observedChecks: z.array(workDraftObservedCheckSchema).max(50),
  updatedAt: isoDateSchema,
})

export const projectBundleV1Schema = z.object({
  format: z.literal('axon-project'),
  version: z.literal(1),
  exportedAt: isoDateSchema,
  project: projectDetailSchema,
})

const bundleOmissionSchema = z.object({
  entity: z.string().min(1).max(80),
  reason: z.string().min(1).max(400),
})

export const projectBundleV2Schema = z.object({
  format: z.literal('axon-project'),
  version: z.literal(2),
  exportedAt: isoDateSchema,
  project: projectDetailSchema,
  backlogItems: z.array(backlogItemSchema).max(500),
  deliveries: z.array(portableDeliverySchema).max(500),
  deliveryReceipts: z.array(portableReceiptSchema).max(1000),
  messageResolutions: z.array(messageResolutionSchema).max(1000).optional().default([]),
  omissions: z.array(bundleOmissionSchema).max(50).optional(),
})


/**
 * O que o formato v3 declaradamente nao transporta.
 *
 * Duas naturezas diferentes, e a distincao importa:
 * as primeiras sao estado efemero que NAO deve renascer numa copia, porque a
 * copia nao pode afirmar que uma IA ainda trabalha nela; as ultimas sao memoria
 * real que este formato ainda nao alcanca e que o v4 precisa resolver.
 */
export const BUNDLE_V3_OMISSIONS: ReadonlyArray<{ entity: string; reason: string }> = [
  { entity: "task_leases", reason: "Reservas e responsaveis temporarios nao viajam por decisao: a copia nao deve afirmar que uma IA ainda trabalha nela." },
  { entity: "work_intents", reason: "Intencao de escrita e estado efemero da instalacao de origem e nao renasce na copia." },
  { entity: "evidence_records", reason: "Evidencias com identidade propria e artefatos endereçados por SHA-256 ainda nao viajam neste formato." },
  { entity: "evidence_verifications", reason: "Conferencias cruzadas entre identidades ainda nao viajam neste formato." },
  { entity: "blocker_events", reason: "A linha do tempo de transicoes de bloqueio nao viaja; a copia recebe apenas o estado atual." },
  { entity: "decision_events", reason: "A linha do tempo de transicoes de decisao nao viaja; a copia recebe apenas o estado atual." },
  { entity: "approval_requests", reason: "A fila de aprovacoes (propostas pendentes, decididas e retiradas) e decisao do dono do projeto de origem e nao viaja neste formato." },
  { entity: "board_cards", reason: "O quadro de cartões do projeto ainda não viaja neste formato." },
  { entity: "board_card_events", reason: "O quadro de cartões do projeto ainda não viaja neste formato." },
]

/**
 * O que a v2 declaradamente nao transporta.
 *
 * A v2 e o formato mais pobre. Antes ela saia calada, e era o padrao: quem
 * exportava sem declarar versao perdia charter, decisoes, bloqueios, a
 * Biblioteca inteira, rascunhos, eventos e contratos de tarefa sem aviso.
 *
 * Convencao de nomes: quando a entidade existe como chave de pacote em algum
 * formato, usa-se essa chave (charterRevisions); quando nao existe em formato
 * nenhum, usa-se o nome da tabela (evidence_records).
 */
export const BUNDLE_V2_OMISSIONS: ReadonlyArray<{ entity: string; reason: string }> = [
  { entity: "charterRevisions", reason: "O historico do charter so viaja na v3. A copia recebe apenas o objetivo atual do projeto." },
  { entity: "decisions", reason: "Decisoes canonicas e suas cadeias de substituicao so viajam na v3." },
  { entity: "blockers", reason: "Bloqueios canonicos e o historico de resolucao so viajam na v3." },
  { entity: "library", reason: "A Biblioteca de conteudos, com revisoes e relacoes, so viaja na v3." },
  { entity: "workDrafts", reason: "Rascunhos de emergencia so viajam na v3." },
  { entity: "taskEvents", reason: "As transicoes de estado das tarefas so viajam na v3." },
  { entity: "taskContracts", reason: "Criterios de aceite, dependencias e saidas esperadas das tarefas so viajam na v3." },
  { entity: "checkpoints[].humanSummary", reason: "A frase simples de cada registro, escrita para o dono do projeto, so viaja na v3." },
  { entity: "checkpoints[].kind", reason: "O tipo do registro (salvamento de compactacao ou comum) so viaja na v3; na v2 todo registro chega como comum." },
  { entity: "checkpoints[].extras", reason: "Os pedidos do dono, pendencias, perguntas abertas e arquivos mexidos do salvamento de compactacao so viajam na v3." },
  ...BUNDLE_V3_OMISSIONS,
]

export const projectBundleV3Schema = z.object({
  format: z.literal('axon-project'),
  version: z.literal(3),
  exportedAt: isoDateSchema,
  project: projectDetailSchema,
  backlogItems: z.array(backlogItemSchema).max(500),
  deliveries: z.array(portableDeliverySchema).max(500),
  deliveryReceipts: z.array(portableReceiptSchema).max(1000),
  messageResolutions: z.array(messageResolutionSchema).max(1000).optional().default([]),
  charterRevisions: z.array(charterRevisionSchema).max(500).optional().default([]),
  decisions: z.array(decisionSchema).max(500).optional().default([]),
  blockers: z.array(blockerSchema).max(500).optional().default([]),
  library: librarySchema.optional().default({ items: [], revisions: [], relations: [] }),
  workDrafts: z.array(workDraftSchema).max(100).optional().default([]),
  taskEvents: z.array(taskEventSchema).max(2000).optional().default([]),
  omissions: z.array(bundleOmissionSchema).max(50).optional(),
})

export const projectBundleSchema = z.discriminatedUnion('version', [
  projectBundleV1Schema,
  projectBundleV2Schema,
  projectBundleV3Schema,
])

function throwZodError(
  error: z.ZodError,
  code: 'invalid_bundle' | 'invalid_project_detail',
): never {
  const issue = error.issues[0]
  if (code === 'invalid_bundle') {
    const pathStr = issue?.path.length ? issue.path.join('.') : 'raiz'
    const message = issue ? `Erro em '${pathStr}': ${issue.message}` : 'Estrutura do pacote inválida.'
    throw new PortabilityError(400, 'invalid_bundle', message)
  }
  const message = issue ? `${issue.path.join('.')}: ${issue.message}` : 'Estrutura do projeto inválida.'
  throw new PortabilityError(400, 'invalid_project_detail', message)
}

function assertSerializedSize(value: unknown): void {
  const serialized = JSON.stringify(value)
  const byteLength = Buffer.byteLength(serialized, 'utf-8')
  if (byteLength > MAX_BUNDLE_SERIALIZED_BYTES) {
    throw new PortabilityError(
      400,
      'bundle_too_large',
      `O pacote serializado tem ${byteLength} bytes e excede o limite máximo permitido de ${MAX_BUNDLE_SERIALIZED_BYTES} bytes (1 MB).`,
    )
  }
}

function invalidReference(message: string): never {
  throw new PortabilityError(400, 'invalid_bundle_reference', message)
}

/**
 * Valida a integridade relacional do pacote de projeto:
 * - Todas as tasks, checkpoints e mensagens pertencem ao ID do projeto.
 * - taskId referenciado em checkpoint existe na lista de tarefas.
 * - Tarefa concluída aponta para um checkpoint da própria tarefa; estados abertos não carregam esse vínculo.
 * - IDs não são duplicados.
 */
function validateRelationalIntegrity(detail: ProjectDetail): void {
  const projectId = detail.project.id
  const taskIds = new Set<string>()

  for (const task of detail.tasks) {
    if (task.projectId !== projectId) {
      invalidReference(
        `A tarefa ${task.id} referencia projectId '${task.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (taskIds.has(task.id)) {
      throw new PortabilityError(400, 'duplicate_task_id', `ID de tarefa duplicado: ${task.id}`)
    }
    taskIds.add(task.id)
  }

  const checkpointIds = new Set<string>()
  const checkpointsById = new Map<string, Checkpoint>()
  for (const cp of detail.checkpoints) {
    if (cp.projectId !== projectId) {
      invalidReference(
        `O checkpoint ${cp.id} referencia projectId '${cp.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (checkpointIds.has(cp.id)) {
      throw new PortabilityError(400, 'duplicate_checkpoint_id', `ID de checkpoint duplicado: ${cp.id}`)
    }
    checkpointIds.add(cp.id)
    checkpointsById.set(cp.id, cp)

    if (cp.taskId !== null && !taskIds.has(cp.taskId)) {
      invalidReference(`O checkpoint ${cp.id} referencia tarefa inexistente '${cp.taskId}'.`)
    }
  }

  for (const task of detail.tasks) {
    if (task.status !== 'done') {
      if (task.completionCheckpointId !== null) {
        invalidReference(
          `A tarefa ${task.id} no estado '${task.status}' não pode ter checkpoint de conclusão.`,
        )
      }
      continue
    }

    if (task.completionCheckpointId === null) {
      invalidReference(`A tarefa concluída ${task.id} exige completionCheckpointId.`)
    }

    const completionCheckpoint = checkpointsById.get(task.completionCheckpointId)
    if (!completionCheckpoint) {
      invalidReference(
        `A tarefa concluída ${task.id} referencia checkpoint de conclusão inexistente '${task.completionCheckpointId}'.`,
      )
    }
    if (completionCheckpoint.projectId !== projectId) {
      invalidReference(
        `O checkpoint de conclusão ${completionCheckpoint.id} não pertence ao projeto '${projectId}'.`,
      )
    }
    if (completionCheckpoint.taskId !== task.id) {
      invalidReference(
        `O checkpoint de conclusão ${completionCheckpoint.id} não pertence à tarefa concluída ${task.id}.`,
      )
    }
  }

  const messageIds = new Set<string>()
  for (const msg of detail.messages) {
    if (msg.projectId !== projectId) {
      invalidReference(
        `A mensagem ${msg.id} referencia projectId '${msg.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (messageIds.has(msg.id)) {
      throw new PortabilityError(400, 'duplicate_message_id', `ID de mensagem duplicado: ${msg.id}`)
    }
    messageIds.add(msg.id)
  }
}

function validateV2Integrity(data: {
  project: ProjectDetail
  backlogItems: BacklogItem[]
  deliveries: PortableHandoffDelivery[]
  deliveryReceipts: PortableHandoffReceipt[]
  messageResolutions: MessageResolution[]
}): void {
  validateRelationalIntegrity(data.project)

  const projectId = data.project.project.id
  const taskIds = new Set(data.project.tasks.map((task) => task.id))
  const checkpointsById = new Map(data.project.checkpoints.map((cp) => [cp.id, cp]))
  const messagesById = new Map(data.project.messages.map((message) => [message.id, message]))

  const backlogIds = new Set<string>()
  for (const item of data.backlogItems) {
    if (item.projectId !== projectId) {
      invalidReference(
        `O backlog ${item.id} referencia projectId '${item.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (backlogIds.has(item.id)) {
      throw new PortabilityError(400, 'duplicate_backlog_id', `ID de backlog duplicado: ${item.id}`)
    }
    backlogIds.add(item.id)

    if (item.stage === 'promoted') {
      if (item.promotedTaskId === null) {
        invalidReference(`O backlog ${item.id} no estágio promoted exige promotedTaskId.`)
      }
    } else if (item.promotedTaskId !== null) {
      invalidReference(`O backlog ${item.id} no estágio ${item.stage} exige promotedTaskId nulo.`)
    }

    if (item.promotedTaskId !== null && !taskIds.has(item.promotedTaskId)) {
      invalidReference(`O backlog ${item.id} referencia tarefa inexistente '${item.promotedTaskId}'.`)
    }
  }

  const deliveryIds = new Set<string>()
  const deliveriesById = new Map<string, PortableHandoffDelivery>()
  for (const delivery of data.deliveries) {
    if (delivery.projectId !== projectId) {
      invalidReference(
        `A passagem ${delivery.id} referencia projectId '${delivery.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (deliveryIds.has(delivery.id)) {
      throw new PortabilityError(400, 'duplicate_delivery_id', `ID de passagem duplicado: ${delivery.id}`)
    }
    deliveryIds.add(delivery.id)
    deliveriesById.set(delivery.id, delivery)

    const checkpoint = checkpointsById.get(delivery.checkpointId)
    if (!checkpoint) {
      invalidReference(`A passagem ${delivery.id} referencia checkpoint inexistente '${delivery.checkpointId}'.`)
    }
    if (delivery.taskId !== checkpoint.taskId) {
      invalidReference(
        `A passagem ${delivery.id} tem taskId '${delivery.taskId}' diferente do checkpoint '${checkpoint.taskId}'.`,
      )
    }
    if (delivery.from !== checkpoint.agent) {
      invalidReference(
        `A passagem ${delivery.id} tem remetente '${delivery.from}' diferente do agente do checkpoint '${checkpoint.agent}'.`,
      )
    }
  }

  const receiptKeys = new Set<string>()
  for (const receipt of data.deliveryReceipts) {
    if (receipt.projectId !== projectId) {
      invalidReference(
        `O recibo da passagem ${receipt.deliveryId} referencia projectId '${receipt.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    const delivery = deliveriesById.get(receipt.deliveryId)
    if (!delivery) {
      invalidReference(`O recibo referencia passagem inexistente '${receipt.deliveryId}'.`)
    }
    if (delivery.projectId !== receipt.projectId) {
      invalidReference(
        `O recibo da passagem ${receipt.deliveryId} tem projectId divergente da passagem.`,
      )
    }
    const allowedRecipient = delivery.to === '*' || receipt.agent === delivery.to
    if (!allowedRecipient) {
      invalidReference(
        `O recibo da passagem ${receipt.deliveryId} tem agente '${receipt.agent}' que não é destinatário de '${delivery.to}'.`,
      )
    }
    const key = `${receipt.deliveryId}\0${receipt.agent}`
    if (receiptKeys.has(key)) {
      throw new PortabilityError(
        400,
        'duplicate_delivery_receipt',
        `Recibo duplicado para passagem ${receipt.deliveryId} e agente ${receipt.agent}.`,
      )
    }
    receiptKeys.add(key)
  }

  const resolutionKeys = new Set<string>()
  for (const resolution of data.messageResolutions) {
    if (resolution.projectId !== projectId) {
      invalidReference(
        `A resolução da mensagem ${resolution.messageId} referencia projectId '${resolution.projectId}' diferente do projeto '${projectId}'.`,
      )
    }

    const message = messagesById.get(resolution.messageId)
    if (!message) {
      invalidReference(`A resolução referencia mensagem inexistente '${resolution.messageId}'.`)
    }
    if (message.kind !== 'question' && message.kind !== 'review') {
      invalidReference(
        `A mensagem ${resolution.messageId} do tipo '${message.kind}' não aceita resolução explícita.`,
      )
    }
    if (message.to !== '*' && resolution.agent !== message.to) {
      invalidReference(
        `A resolução da mensagem ${resolution.messageId} tem agente '${resolution.agent}' que não é destinatário de '${message.to}'.`,
      )
    }

    if (!resolution.note && !resolution.responseMessageId && !resolution.checkpointId) {
      invalidReference(
        `A resolução da mensagem ${resolution.messageId} exige nota, mensagem de resposta ou checkpoint.`,
      )
    }

    if (resolution.responseMessageId) {
      const response = messagesById.get(resolution.responseMessageId)
      if (!response) {
        invalidReference(
          `A resolução da mensagem ${resolution.messageId} referencia resposta inexistente '${resolution.responseMessageId}'.`,
        )
      }
      if (response.projectId !== projectId) {
        invalidReference(
          `A resposta ${resolution.responseMessageId} não pertence ao projeto '${projectId}'.`,
        )
      }
      if (response.from !== resolution.agent) {
        invalidReference(
          `A resposta ${resolution.responseMessageId} não foi relatada pelo agente '${resolution.agent}'.`,
        )
      }
    }

    if (resolution.checkpointId) {
      const checkpoint = checkpointsById.get(resolution.checkpointId)
      if (!checkpoint) {
        invalidReference(
          `A resolução da mensagem ${resolution.messageId} referencia checkpoint inexistente '${resolution.checkpointId}'.`,
        )
      }
      if (checkpoint.projectId !== projectId) {
        invalidReference(
          `O checkpoint ${resolution.checkpointId} não pertence ao projeto '${projectId}'.`,
        )
      }
      if (checkpoint.agent !== resolution.agent) {
        invalidReference(
          `O checkpoint ${resolution.checkpointId} não foi relatado pelo agente '${resolution.agent}'.`,
        )
      }
    }

    const key = `${resolution.messageId}\0${resolution.agent}`
    if (resolutionKeys.has(key)) {
      throw new PortabilityError(
        400,
        'duplicate_message_resolution',
        `Resolução duplicada para mensagem ${resolution.messageId} e agente ${resolution.agent}.`,
      )
    }
    resolutionKeys.add(key)
  }
}

function assertAcyclicTaskDependencies(tasks: Task[]): void {
  const adj = new Map<string, string[]>()
  for (const t of tasks) {
    adj.set(t.id, t.dependencyTaskIds ?? [])
  }
  for (const [id, deps] of adj) {
    if (deps.includes(id)) {
      throw new PortabilityError(400, 'cyclic_task_dependency', `A tarefa ${id} tem auto-dependência.`)
    }
  }
  const visited = new Map<string, number>()
  function dfs(node: string, path: string[]): void {
    visited.set(node, 1)
    const neighbors = adj.get(node) ?? []
    for (const neighbor of neighbors) {
      const state = visited.get(neighbor) ?? 0
      if (state === 1) {
        throw new PortabilityError(
          400,
          'cyclic_task_dependency',
          `Dependência cíclica detectada entre as tarefas: ${[...path, neighbor].join(' -> ')}`,
        )
      }
      if (state === 0) {
        dfs(neighbor, [...path, neighbor])
      }
    }
    visited.set(node, 2)
  }
  for (const t of tasks) {
    if ((visited.get(t.id) ?? 0) === 0) {
      dfs(t.id, [t.id])
    }
  }
}

function assertAcyclicDecisionSupersession(decisions: Decision[]): void {
  const supersedesMap = new Map<string, string | null>()
  for (const d of decisions) {
    if (d.supersedesId && d.supersedesId === d.id) {
      throw new PortabilityError(400, 'cyclic_decision_supersession', `A decisão ${d.id} substitui a si mesma.`)
    }
    supersedesMap.set(d.id, d.supersedesId ?? null)
  }
  for (const startId of supersedesMap.keys()) {
    let curr = supersedesMap.get(startId)
    const seen = new Set<string>([startId])
    while (curr) {
      if (seen.has(curr)) {
        throw new PortabilityError(
          400,
          'cyclic_decision_supersession',
          `Ciclo de substituição detectado entre decisões envolvendo '${curr}'.`,
        )
      }
      seen.add(curr)
      curr = supersedesMap.get(curr) ?? null
    }
  }
}

function validateV3Integrity(bundle: ProjectBundleV3): void {
  validateV2Integrity({
    project: bundle.project,
    backlogItems: bundle.backlogItems,
    deliveries: bundle.deliveries,
    deliveryReceipts: bundle.deliveryReceipts,
    messageResolutions: bundle.messageResolutions,
  })

  const projectId = bundle.project.project.id
  const taskIds = new Set(bundle.project.tasks.map((t) => t.id))
  const checkpointIds = new Set(bundle.project.checkpoints.map((cp) => cp.id))

  // Task contract: dependencies must exist in taskIds & no cycles
  for (const t of bundle.project.tasks) {
    for (const depId of t.dependencyTaskIds ?? []) {
      if (!taskIds.has(depId)) {
        invalidReference(`A tarefa ${t.id} referencia dependência inexistente '${depId}'.`)
      }
    }
  }
  assertAcyclicTaskDependencies(bundle.project.tasks)

  // Charter revisions
  const charterIds = new Set<string>()
  const charterRevisions = new Set<number>()
  for (const cr of bundle.charterRevisions) {
    if (cr.projectId !== projectId) {
      invalidReference(
        `A revisão do charter ${cr.id} referencia projectId '${cr.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (charterIds.has(cr.id)) {
      throw new PortabilityError(400, 'duplicate_charter_id', `ID de charter duplicado: ${cr.id}`)
    }
    if (charterRevisions.has(cr.revision)) {
      throw new PortabilityError(
        400,
        'duplicate_charter_revision',
        `Número de revisão de charter duplicado: ${cr.revision}`,
      )
    }
    charterIds.add(cr.id)
    charterRevisions.add(cr.revision)
  }
  for (const cr of bundle.charterRevisions) {
    if (cr.supersedesId !== null && !charterIds.has(cr.supersedesId)) {
      invalidReference(`A revisão do charter ${cr.id} referencia supersedesId inexistente '${cr.supersedesId}'.`)
    }
  }

  // Decisions
  const decisionIds = new Set<string>()
  for (const d of bundle.decisions) {
    if (d.projectId !== projectId) {
      invalidReference(
        `A decisão ${d.id} referencia projectId '${d.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (decisionIds.has(d.id)) {
      throw new PortabilityError(400, 'duplicate_decision_id', `ID de decisão duplicado: ${d.id}`)
    }
    decisionIds.add(d.id)
  }
  for (const d of bundle.decisions) {
    if (d.supersedesId !== null && !decisionIds.has(d.supersedesId)) {
      invalidReference(`A decisão ${d.id} referencia supersedesId inexistente '${d.supersedesId}'.`)
    }
    if (d.supersededById !== null && !decisionIds.has(d.supersededById)) {
      invalidReference(`A decisão ${d.id} referencia supersededById inexistente '${d.supersededById}'.`)
    }
  }
  assertAcyclicDecisionSupersession(bundle.decisions)

  // Blockers
  const blockerIds = new Set<string>()
  for (const b of bundle.blockers) {
    if (b.projectId !== projectId) {
      invalidReference(
        `O bloqueio ${b.id} referencia projectId '${b.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (blockerIds.has(b.id)) {
      throw new PortabilityError(400, 'duplicate_blocker_id', `ID de bloqueio duplicado: ${b.id}`)
    }
    blockerIds.add(b.id)
    if (b.taskId !== null && !taskIds.has(b.taskId)) {
      invalidReference(`O bloqueio ${b.id} referencia tarefa inexistente '${b.taskId}'.`)
    }
    if (b.sourceCheckpointId !== null && !checkpointIds.has(b.sourceCheckpointId)) {
      invalidReference(`O bloqueio ${b.id} referencia checkpoint inexistente '${b.sourceCheckpointId}'.`)
    }
  }

  // Library
  const contentItemIds = new Set<string>()
  const contentRevisionIds = new Set<string>()
  for (const item of bundle.library.items) {
    if (item.projectId !== projectId) {
      invalidReference(
        `O item de biblioteca ${item.id} referencia projectId '${item.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (contentItemIds.has(item.id)) {
      throw new PortabilityError(
        400,
        'duplicate_content_item_id',
        `ID de item de biblioteca duplicado: ${item.id}`,
      )
    }
    contentItemIds.add(item.id)
  }
  for (const rev of bundle.library.revisions) {
    if (!contentItemIds.has(rev.itemId)) {
      invalidReference(`A revisão ${rev.id} referencia item de biblioteca inexistente '${rev.itemId}'.`)
    }
    if (contentRevisionIds.has(rev.id)) {
      throw new PortabilityError(
        400,
        'duplicate_content_revision_id',
        `ID de revisão de biblioteca duplicado: ${rev.id}`,
      )
    }
    contentRevisionIds.add(rev.id)
  }
  for (const item of bundle.library.items) {
    if (!contentRevisionIds.has(item.currentRevisionId)) {
      invalidReference(
        `O item ${item.id} referencia currentRevisionId inexistente '${item.currentRevisionId}'.`,
      )
    }
  }
  for (const rev of bundle.library.revisions) {
    if (rev.supersedesId !== null && !contentRevisionIds.has(rev.supersedesId)) {
      invalidReference(`A revisão ${rev.id} referencia supersedesId inexistente '${rev.supersedesId}'.`)
    }
  }
  const contentRelationIds = new Set<string>()
  for (const rel of bundle.library.relations) {
    if (rel.projectId !== projectId) {
      invalidReference(
        `A relação ${rel.id} referencia projectId '${rel.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (contentRelationIds.has(rel.id)) {
      throw new PortabilityError(
        400,
        'duplicate_content_relation_id',
        `ID de relação duplicado: ${rel.id}`,
      )
    }
    contentRelationIds.add(rel.id)
    if (!contentRevisionIds.has(rel.sourceRevisionId)) {
      invalidReference(`A relação ${rel.id} referencia sourceRevisionId inexistente '${rel.sourceRevisionId}'.`)
    }
    switch (rel.targetType) {
      case 'content':
        if (!contentItemIds.has(rel.targetId)) {
          invalidReference(`A relação ${rel.id} referencia item de biblioteca inexistente '${rel.targetId}'.`)
        }
        break
      case 'task':
        if (!taskIds.has(rel.targetId)) {
          invalidReference(`A relação ${rel.id} referencia tarefa inexistente '${rel.targetId}'.`)
        }
        break
      case 'checkpoint':
        if (!checkpointIds.has(rel.targetId)) {
          invalidReference(`A relação ${rel.id} referencia checkpoint inexistente '${rel.targetId}'.`)
        }
        break
      case 'decision':
        if (!decisionIds.has(rel.targetId)) {
          invalidReference(`A relação ${rel.id} referencia decisão inexistente '${rel.targetId}'.`)
        }
        break
      case 'blocker':
        if (!blockerIds.has(rel.targetId)) {
          invalidReference(`A relação ${rel.id} referencia bloqueio inexistente '${rel.targetId}'.`)
        }
        break
    }
  }

  // Work Drafts
  const draftIds = new Set<string>()
  for (const wd of bundle.workDrafts ?? []) {
    if (wd.projectId !== projectId) {
      invalidReference(
        `O rascunho ${wd.id} referencia projectId '${wd.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (draftIds.has(wd.id)) {
      throw new PortabilityError(400, 'duplicate_work_draft_id', `ID de rascunho duplicado: ${wd.id}`)
    }
    draftIds.add(wd.id)
    if (wd.taskId !== null && !taskIds.has(wd.taskId)) {
      invalidReference(`O rascunho ${wd.id} referencia tarefa inexistente '${wd.taskId}'.`)
    }
  }

  // Task Events
  for (const te of bundle.taskEvents ?? []) {
    if (te.projectId !== projectId) {
      invalidReference(
        `O evento de tarefa ${te.id} referencia projectId '${te.projectId}' diferente do projeto '${projectId}'.`,
      )
    }
    if (!taskIds.has(te.taskId)) {
      invalidReference(`O evento de tarefa ${te.id} referencia tarefa inexistente '${te.taskId}'.`)
    }
    if (te.checkpointId !== null && !checkpointIds.has(te.checkpointId)) {
      invalidReference(`O evento de tarefa ${te.id} referencia checkpoint inexistente '${te.checkpointId}'.`)
    }
  }
}

/**
 * Salvamento de compactação (D5) no pacote: `kind` e `extras` só viajam na v3 e só no registro que os
 * tem (o checkpoint comum não ganha chave nenhuma). Os textos passam pelo mesmo mascaramento de
 * segredos dos demais campos do registro.
 */
function camposDoSalvamentoNoPacote(cp: Checkpoint): Pick<Checkpoint, 'kind' | 'extras'> {
  return {
    ...(cp.kind !== undefined ? { kind: cp.kind } : {}),
    ...(cp.extras !== undefined ? { extras: mascararExtras(cp.extras) } : {}),
  }
}

function mascararExtras(extras: ExtrasDoSalvamento): ExtrasDoSalvamento {
  return {
    pedidosDoDono: extras.pedidosDoDono.map(maskSecrets),
    pendencias: extras.pendencias.map(maskSecrets),
    perguntasAbertas: extras.perguntasAbertas.map(maskSecrets),
    arquivosMexidos: extras.arquivosMexidos.map(maskSecrets),
  }
}

/**
 * `includeHumanSummary` (Parte 4/5 — extensão): a frase simples do checkpoint
 * (`humanSummary`) só viaja no formato v3. v1 e v2 continuam exatamente como
 * antes — a chamada sem a opção não inclui o campo, então nada muda para
 * quem já consumia esses formatos. v3 passa `{ includeHumanSummary: true }`.
 * Regra geral: nenhuma informação que a Axon guarda pode sumir em silêncio —
 * ou viaja, ou o formato declara em `omissions` que não leva.
 */
function sanitizeProjectDetail(detail: ProjectDetail, options?: { includeHumanSummary?: boolean }): ProjectDetail {
  const includeHumanSummary = options?.includeHumanSummary === true
  const sanitizedProject: Project = {
    id: detail.project.id,
    name: maskSecrets(detail.project.name.trim()),
    objective: maskSecrets(detail.project.objective.trim()),
    workspacePath: maskSecrets(detail.project.workspacePath ?? '').trim(),
    createdAt: detail.project.createdAt,
    updatedAt: detail.project.updatedAt,
    revision: detail.project.revision,
  }

  const sanitizedTasks: Task[] = (detail.tasks ?? []).map((t) => ({
    id: t.id,
    projectId: t.projectId,
    title: maskSecrets(t.title.trim()),
    status: t.status,
    assignee: t.assignee ? maskSecrets(t.assignee.trim()) : null,
    leaseUntil: t.leaseUntil ?? null,
    version: t.version,
    createdAt: t.createdAt,
    blockedReason: t.blockedReason ? maskSecrets(t.blockedReason) : null,
    completionCheckpointId: t.completionCheckpointId ?? null,
    workIntent: t.workIntent
      ? {
          objective: maskSecrets(t.workIntent.objective),
          areas: (t.workIntent.areas ?? []).map((a) => ({
            kind: a.kind,
            locator: maskSecrets(a.locator),
            access: a.access,
          })),
          expectedOutputs: (t.workIntent.expectedOutputs ?? []).map(maskSecrets),
          plannedChecks: (t.workIntent.plannedChecks ?? []).map(maskSecrets),
        }
      : null,
    description: t.description ? maskSecrets(t.description) : null,
    priority: t.priority ?? 'medium',
    acceptanceCriteria: (t.acceptanceCriteria ?? []).map((ac) => ({
      id: ac.id,
      description: maskSecrets(ac.description),
      completed: ac.completed,
    })),
    dependencyTaskIds: t.dependencyTaskIds ?? [],
    expectedOutputs: (t.expectedOutputs ?? []).map((eo) => ({
      id: eo.id,
      title: maskSecrets(eo.title),
      kind: eo.kind,
      locator: eo.locator ? maskSecrets(eo.locator) : undefined,
    })),
  }))

  const sanitizedCheckpoints: Checkpoint[] = (detail.checkpoints ?? []).map((cp) => ({
    id: cp.id,
    projectId: cp.projectId,
    taskId: cp.taskId ?? null,
    agent: maskSecrets(cp.agent.trim()),
    summary: maskSecrets(cp.summary),
    ...(includeHumanSummary && cp.humanSummary ? { humanSummary: maskSecrets(cp.humanSummary) } : {}),
    ...(includeHumanSummary ? camposDoSalvamentoNoPacote(cp) : {}),
    nextStep: maskSecrets(cp.nextStep),
    blockers: (cp.blockers ?? []).map(maskSecrets),
    decisions: (cp.decisions ?? []).map(maskSecrets),
    evidence: (cp.evidence ?? []).map(
      (ev): Evidence => ({
        command: maskSecrets(ev.command),
        outcome: ev.outcome,
        details: maskSecrets(ev.details),
        provenance: 'agent_report',
      }),
    ),
    revision: cp.revision,
    createdAt: cp.createdAt,
  }))

  const sanitizedMessages: AgentMessage[] = (detail.messages ?? []).map((msg) => ({
    id: msg.id,
    projectId: msg.projectId,
    from: maskSecrets(msg.from.trim()),
    to: maskSecrets(msg.to.trim()),
    kind: msg.kind,
    body: maskSecrets(msg.body),
    createdAt: msg.createdAt,
  }))

  return {
    project: sanitizedProject,
    tasks: sanitizedTasks,
    checkpoints: sanitizedCheckpoints,
    messages: sanitizedMessages,
  }
}

function sanitizeBacklogItems(items: BacklogItem[] | undefined): BacklogItem[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    projectId: item.projectId,
    title: maskSecrets(item.title.trim()),
    description: maskSecrets(item.description ?? ''),
    priority: item.priority,
    stage: item.stage,
    createdBy: maskSecrets(item.createdBy.trim()),
    promotedTaskId: item.promotedTaskId ?? null,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }))
}

function sanitizeDeliveries(items: PortableHandoffDelivery[] | undefined): PortableHandoffDelivery[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    projectId: item.projectId,
    checkpointId: item.checkpointId,
    taskId: item.taskId ?? null,
    from: maskSecrets(item.from.trim()),
    to: maskSecrets(item.to.trim()),
    message: maskSecrets(item.message ?? ''),
    createdAt: item.createdAt,
  }))
}

function sanitizeReceipts(items: PortableHandoffReceipt[] | undefined): PortableHandoffReceipt[] {
  return (items ?? []).map((item) => ({
    projectId: item.projectId,
    deliveryId: item.deliveryId,
    agent: maskSecrets(item.agent.trim()),
    acknowledgedAt: item.acknowledgedAt,
  }))
}

function sanitizeMessageResolutions(items: MessageResolution[] | undefined): MessageResolution[] {
  return (items ?? []).map((item) => ({
    projectId: item.projectId,
    messageId: item.messageId,
    agent: maskSecrets(item.agent.trim()),
    note: maskSecrets(item.note ?? '').trim(),
    responseMessageId: item.responseMessageId ?? null,
    checkpointId: item.checkpointId ?? null,
    resolvedAt: item.resolvedAt,
  }))
}

function sanitizeCharterRevisions(items: CharterRevision[] | undefined): CharterRevision[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    projectId: item.projectId,
    revision: item.revision,
    body: maskSecrets(item.body),
    createdBy: maskSecrets(item.createdBy.trim()),
    createdAt: item.createdAt,
    sourceKind: item.sourceKind,
    supersedesId: item.supersedesId ?? null,
  }))
}

function sanitizeDecisions(items: Decision[] | undefined): Decision[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    projectId: item.projectId,
    title: maskSecrets(item.title.trim()),
    body: maskSecrets(item.body),
    status: item.status,
    proposedBy: maskSecrets(item.proposedBy.trim()),
    acceptedBy: item.acceptedBy ? maskSecrets(item.acceptedBy.trim()) : null,
    revokedBy: item.revokedBy ? maskSecrets(item.revokedBy.trim()) : null,
    supersedesId: item.supersedesId ?? null,
    supersededById: item.supersededById ?? null,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    source: {
      kind: item.source.kind,
      note: item.source.note ? maskSecrets(item.source.note) : undefined,
    },
  }))
}

function sanitizeBlockers(items: ProjectBlocker[] | undefined): ProjectBlocker[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    projectId: item.projectId,
    taskId: item.taskId ?? null,
    title: maskSecrets(item.title.trim()),
    body: maskSecrets(item.body),
    status: item.status,
    openedBy: maskSecrets(item.openedBy.trim()),
    assignee: item.assignee ? maskSecrets(item.assignee.trim()) : null,
    resolution: item.resolution ? maskSecrets(item.resolution) : null,
    resolvedBy: item.resolvedBy ? maskSecrets(item.resolvedBy.trim()) : null,
    resolvedAt: item.resolvedAt ?? null,
    sourceCheckpointId: item.sourceCheckpointId ?? null,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }))
}

function sanitizeLibrary(library: PortableLibrary | undefined): PortableLibrary {
  return {
    items: (library?.items ?? []).map((item) => ({
      id: item.id,
      projectId: item.projectId,
      title: maskSecrets(item.title.trim()),
      kind: item.kind,
      status: item.status,
      currentRevisionId: item.currentRevisionId,
      version: item.version,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    revisions: (library?.revisions ?? []).map((rev) => ({
      id: rev.id,
      itemId: rev.itemId,
      revision: rev.revision,
      body: maskSecrets(rev.body),
      format: rev.format,
      createdBy: maskSecrets(rev.createdBy.trim()),
      createdAt: rev.createdAt,
      supersedesId: rev.supersedesId ?? null,
      sourceKind: rev.sourceKind,
      sourceLabel: rev.sourceLabel ? maskSecrets(rev.sourceLabel) : undefined,
      sourceUrl: rev.sourceUrl ? maskSecrets(rev.sourceUrl) : undefined,
      declaredValidity: rev.declaredValidity,
    })),
    relations: (library?.relations ?? []).map((rel) => ({
      id: rel.id,
      projectId: rel.projectId,
      sourceRevisionId: rel.sourceRevisionId,
      targetType: rel.targetType,
      targetId: rel.targetId,
      kind: rel.kind,
      createdBy: maskSecrets(rel.createdBy.trim()),
      createdAt: rel.createdAt,
    })),
  }
}

function sanitizeTaskEvents(items: TaskTransitionEvent[] | undefined): TaskTransitionEvent[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    projectId: item.projectId,
    taskId: item.taskId,
    fromStatus: item.fromStatus,
    toStatus: item.toStatus,
    agent: maskSecrets(item.agent.trim()),
    note: maskSecrets(item.note),
    checkpointId: item.checkpointId ?? null,
    createdAt: item.createdAt,
  }))
}

function sanitizeWorkDrafts(items: WorkDraft[] | undefined): WorkDraft[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    projectId: item.projectId,
    actorId: maskSecrets(item.actorId.trim()),
    taskId: item.taskId ?? null,
    version: item.version,
    status: 'undelivered' as const,
    summary: maskSecrets(item.summary),
    nextAction: maskSecrets(item.nextAction),
    changedAreas: (item.changedAreas ?? []).map(maskSecrets),
    openIssues: (item.openIssues ?? []).map(maskSecrets),
    observedChecks: (item.observedChecks ?? []).map((oc) => ({
      commandOrMethod: maskSecrets(oc.commandOrMethod),
      reportedOutcome: maskSecrets(oc.reportedOutcome),
    })),
    updatedAt: item.updatedAt,
  }))
}

/**
 * Cria um pacote de projeto portável (ProjectBundle) a partir de ProjectDetail.
 * - Aplica mascaramento de segredos em textos.
 * - Garante provenance=agent_report para evidências.
 * - Trata workspacePath como metadado inerte (sem importar conteúdo ou credenciais).
 * - Exige tamanho serializado <= 1 MB.
 */
export function createProjectBundle(detail: ProjectDetail): ProjectBundleV1 {
  if (!detail || typeof detail !== 'object') {
    throw new PortabilityError(400, 'invalid_project_detail', 'Dados do projeto ausentes ou inválidos.')
  }

  const cleanDetail = sanitizeProjectDetail(detail)
  const parseResult = projectDetailSchema.safeParse(cleanDetail)
  if (!parseResult.success) {
    throwZodError(parseResult.error, 'invalid_project_detail')
  }

  validateRelationalIntegrity(parseResult.data)

  const bundle: ProjectBundleV1 = {
    format: 'axon-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: parseResult.data,
  }

  assertSerializedSize(bundle)
  return bundle
}

/**
 * Cria um pacote de projeto portável v2 com backlog, passagens e recibos.
 * Delivery portátil não inclui checkpoint/task embutidos, acknowledgedAt nem campos computados.
 */
export function createProjectBundleV2(data: ProjectBundleData): ProjectBundleV2 {
  if (!data || typeof data !== 'object' || !data.project || typeof data.project !== 'object') {
    throw new PortabilityError(400, 'invalid_project_detail', 'Dados do projeto ausentes ou inválidos.')
  }

  const payload = {
    project: sanitizeProjectDetail(data.project),
    backlogItems: sanitizeBacklogItems(data.backlogItems),
    deliveries: sanitizeDeliveries(data.deliveries),
    deliveryReceipts: sanitizeReceipts(data.deliveryReceipts),
    messageResolutions: sanitizeMessageResolutions(data.messageResolutions),
  }

  const parseResult = z
    .strictObject({
      project: projectDetailSchema,
      backlogItems: z.array(backlogItemSchema).max(500),
      deliveries: z.array(portableDeliverySchema).max(500),
      deliveryReceipts: z.array(portableReceiptSchema).max(1000),
      messageResolutions: z.array(messageResolutionSchema).max(1000),
    })
    .safeParse(payload)
  if (!parseResult.success) {
    throwZodError(parseResult.error, 'invalid_project_detail')
  }

  validateV2Integrity(parseResult.data)

  const bundle: ProjectBundleV2 = {
    format: 'axon-project',
    version: 2,
    exportedAt: new Date().toISOString(),
    project: parseResult.data.project,
    backlogItems: parseResult.data.backlogItems,
    deliveries: parseResult.data.deliveries,
    deliveryReceipts: parseResult.data.deliveryReceipts,
    messageResolutions: parseResult.data.messageResolutions,
    omissions: BUNDLE_V2_OMISSIONS.map(o => ({ ...o })),
  }

  assertSerializedSize(bundle)
  return bundle
}

/**
 * Cria um pacote de projeto portável v3 completo com contratos de tarefa, charter,
 * decisões, bloqueios, biblioteca e rascunhos.
 */
export function createProjectBundleV3(data: ProjectBundleData): ProjectBundleV3 {
  if (!data || typeof data !== 'object' || !data.project || typeof data.project !== 'object') {
    throw new PortabilityError(400, 'invalid_project_detail', 'Dados do projeto ausentes ou inválidos.')
  }

  const payload = {
    // humanSummary só viaja na v3 — ver o comentário em sanitizeProjectDetail.
    project: sanitizeProjectDetail(data.project, { includeHumanSummary: true }),
    backlogItems: sanitizeBacklogItems(data.backlogItems),
    deliveries: sanitizeDeliveries(data.deliveries),
    deliveryReceipts: sanitizeReceipts(data.deliveryReceipts),
    messageResolutions: sanitizeMessageResolutions(data.messageResolutions),
    charterRevisions: sanitizeCharterRevisions(data.charterRevisions),
    decisions: sanitizeDecisions(data.decisions),
    blockers: sanitizeBlockers(data.blockers),
    library: sanitizeLibrary(data.library),
    workDrafts: sanitizeWorkDrafts(data.workDrafts),
    taskEvents: sanitizeTaskEvents(data.taskEvents),
    omissions: BUNDLE_V3_OMISSIONS.map(o => ({ ...o })),
  }

  const parseResult = projectBundleV3Schema.safeParse({
    format: 'axon-project',
    version: 3,
    exportedAt: new Date().toISOString(),
    ...payload,
  })
  if (!parseResult.success) {
    throwZodError(parseResult.error, 'invalid_project_detail')
  }

  validateV3Integrity(parseResult.data)

  const bundle: ProjectBundleV3 = parseResult.data
  assertSerializedSize(bundle)
  return bundle
}

/**
 * Faz o parsing e validação rigorosa de um pacote de projeto importado.
 * Aceita v1 legado, v2 ou v3 discriminado por version. Garante formato, integridade relacional e limite de 1 MB.
 */
export function parseProjectBundle(input: unknown): ProjectBundle {
  if (!input || typeof input !== 'object') {
    throw new PortabilityError(400, 'invalid_bundle', 'Pacote deve ser um objeto JSON válido.')
  }

  const serialized = JSON.stringify(input)
  const byteLength = Buffer.byteLength(serialized, 'utf-8')
  if (byteLength > MAX_BUNDLE_SERIALIZED_BYTES) {
    throw new PortabilityError(
      400,
      'bundle_too_large',
      `O pacote serializado tem ${byteLength} bytes e excede o limite máximo de ${MAX_BUNDLE_SERIALIZED_BYTES} bytes (1 MB).`,
    )
  }

  const result = projectBundleSchema.safeParse(input)
  if (!result.success) {
    throwZodError(result.error, 'invalid_bundle')
  }

  const bundle = result.data
  if (bundle.version === 3) {
    validateV3Integrity(bundle)
  } else if (bundle.version === 2) {
    validateV2Integrity(bundle)
  } else {
    validateRelationalIntegrity(bundle.project)
  }

  return bundle
}

