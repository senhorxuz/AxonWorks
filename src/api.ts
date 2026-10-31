import type {
  ArchiveBacklogItemInput,
  BacklogItem,
  CreateBacklogItemInput,
  ContextEnvelope,
  DeletedBacklogItem,
  DeletedProject,
  Handoff,
  Project,
  ProjectDetail,
  PromoteBacklogResult,
  Task,
  UpdateBacklogItemInput,
  UpdateTaskContractInput,
  ConnectorsInfo,
  EvidenceView,
  CrossCheckEvidenceInput,
  RegisterEvidenceArtifactsInput,
  ListEvidenceOptions,
  BlockerTimeline,
  DecisionTimeline,
} from '../shared/types';
import type {
  AcceptDecisionInput,
  CharterRevision,
  Decision,
  DiscardedWorkDraft,
  DiscardWorkDraftInput,
  FinalizeWorkInput,
  FinalizeWorkResult,
  HandoffDelivery,
  HandoffDeliveryAcknowledgement,
  MessageResolution,
  ProjectBlocker,
  ProposeDecisionInput,
  ReopenTaskInput,
  ResolveMessageAttentionInput,
  ResumeBrief,
  ResumeFocusMode,
  RevokeDecisionInput,
  SaveWorkDraftInput,
  SupersedeDecisionInput,
  TaskTransitionEvent,
  WorkDraft,
} from '../shared/continuity';
import type {
  AddContentRelationInput,
  ArchiveContentInput,
  ContentDocument,
  ContentEntry,
  ContentItem,
  ContentRelation,
  ContentSearchResult,
  CreateContentInput,
  ReviseContentInput,
} from '../shared/library';
import type {
  DecisionConflictReport,
  GraphImpactReport,
  GraphNodeType,
  ProjectGraph,
  StaleContentReport,
} from '../shared/graph';
import type { Carta } from '../shared/carta';
export interface ResultadoDoApagamento { checkpointId: string; modo: 'trecho' | 'inteiro'; ocorrencias: number; marca: string }
export class ApiError extends Error { constructor(message: string, public status: number, public code: string) { super(message); } }
export async function request<T>(path: string, body?: unknown, signal?: AbortSignal, method?: 'GET' | 'POST' | 'DELETE'): Promise<T> {
  const verb = method ?? (body === undefined ? 'GET' : 'POST');
  const writing = verb !== 'GET';
  const response = await fetch(`/api${path}`, { method: verb, headers: writing ? { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' } : {}, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) {
    // Sessão vencida no meio do uso: a porta reaparece em vez de a tela quebrar.
    if (response.status === 401 && path !== '/auth/me' && path !== '/auth/login') {
      window.dispatchEvent(new Event('axon:sessao-expirada'));
    }
    throw new ApiError(data.error?.message ?? 'Não foi possível salvar. Tente novamente.', response.status, data.error?.code ?? 'unknown');
  }
  return data as T;
}
export interface ContaDaAxon { id: string; username: string; displayName: string; role: string }
export interface StatusDeEntrada { temConta: boolean; exigeLogin: boolean }
export const api = {
  statusDeEntrada: (signal?: AbortSignal) => request<StatusDeEntrada>('/auth/status', undefined, signal),
  quemSouEu: (signal?: AbortSignal) => request<{ account: ContaDaAxon }>('/auth/me', undefined, signal),
  entrar: (username: string, password: string) => request<{ account: ContaDaAxon }>('/auth/login', { username, password }),
  sair: () => request<{ ok: boolean }>('/auth/logout', {}),
  criarPrimeiraConta: (dados: { username: string; displayName: string; password: string }) =>
    request<ContaDaAxon>('/auth/register', { ...dados, role: 'admin' }),
  connectors: (signal?: AbortSignal) => request<ConnectorsInfo>('/connectors', undefined, signal),
  projects: (signal?: AbortSignal) => request<Project[]>('/projects', undefined, signal),
  project: (id: string, signal?: AbortSignal) => request<ProjectDetail>(`/projects/${encodeURIComponent(id)}`, undefined, signal),
  handoff: (id: string) => request<Handoff>(`/projects/${encodeURIComponent(id)}/handoff`),
  carta: (id: string, signal?: AbortSignal) => request<Carta>(`/projects/${encodeURIComponent(id)}/carta`, undefined, signal),
  resume: (id: string, agent: string, taskId?: string, focusMode?: ResumeFocusMode, signal?: AbortSignal) => {
    const query = new URLSearchParams({ agent });
    if (taskId) query.set('taskId', taskId);
    if (focusMode) query.set('focusMode', focusMode);
    return request<ResumeBrief>(`/projects/${encodeURIComponent(id)}/resume?${query.toString()}`, undefined, signal);
  },
  deliveries: (id: string, agent: string, unreadOnly = false, signal?: AbortSignal) =>
    request<HandoffDelivery[]>(
      `/projects/${encodeURIComponent(id)}/deliveries?agent=${encodeURIComponent(agent)}${unreadOnly ? '&unreadOnly=true' : ''}`,
      undefined,
      signal,
    ),
  createDelivery: (id: string, input: { checkpointId: string; from: string; to: string; message: string }) =>
    request<HandoffDelivery>(`/projects/${encodeURIComponent(id)}/deliveries`, input),
  acknowledgeDelivery: (id: string, deliveryId: string, agent: string) =>
    request<HandoffDeliveryAcknowledgement>(`/projects/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}/ack`, { agent }),
  resolveMessageAttention: (id: string, messageId: string, input: ResolveMessageAttentionInput) =>
    request<MessageResolution>(`/projects/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/resolve`, input),
  drafts: (id: string, agent: string, signal?: AbortSignal) =>
    request<WorkDraft[]>(`/projects/${encodeURIComponent(id)}/drafts?agent=${encodeURIComponent(agent)}`, undefined, signal),
  saveWorkDraft: (id: string, input: SaveWorkDraftInput) =>
    request<WorkDraft>(`/projects/${encodeURIComponent(id)}/drafts`, input),
  // O dono apaga trecho ou registro inteiro (27/10/2026). Só a tela chama estas rotas.
  contarTrecho: (id: string, checkpointId: string, trecho: string) =>
    request<{ ocorrencias: number }>(`/projects/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/apagar-trecho/contar`, { trecho }),
  apagarTrecho: (id: string, checkpointId: string, trecho: string) =>
    request<ResultadoDoApagamento>(`/projects/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/apagar-trecho`, { trecho }),
  apagarRegistro: (id: string, checkpointId: string) =>
    request<ResultadoDoApagamento>(`/projects/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/apagar-registro`, { confirmar: true }),
  discardWorkDraft: (id: string, input: DiscardWorkDraftInput) =>
    request<DiscardedWorkDraft>(`/projects/${encodeURIComponent(id)}/drafts/discard`, input),
  finalizeWork: (id: string, input: FinalizeWorkInput) =>
    request<FinalizeWorkResult>(`/projects/${encodeURIComponent(id)}/finalize`, input),
  reopenTask: (id: string, taskId: string, input: ReopenTaskInput) =>
    request<Task>(`/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/reopen`, input),
  updateTaskContract: (id: string, taskId: string, input: UpdateTaskContractInput) =>
    request<Task>(`/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/contract`, input),
  taskEvents: (id: string, taskId: string, signal?: AbortSignal) =>
    request<TaskTransitionEvent[]>(`/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/events`, undefined, signal),
  backlog: (id: string, signal?: AbortSignal, includeClosed = false) =>
    request<BacklogItem[]>(`/projects/${encodeURIComponent(id)}/backlog${includeClosed ? '?includeClosed=true' : ''}`, undefined, signal),
  createBacklogItem: (id: string, input: CreateBacklogItemInput) =>
    request<BacklogItem>(`/projects/${encodeURIComponent(id)}/backlog`, input),
  updateBacklogItem: (id: string, itemId: string, input: UpdateBacklogItemInput) =>
    request<BacklogItem>(`/projects/${encodeURIComponent(id)}/backlog/${encodeURIComponent(itemId)}/update`, input),
  promoteBacklogItem: (id: string, itemId: string) =>
    request<PromoteBacklogResult>(`/projects/${encodeURIComponent(id)}/backlog/${encodeURIComponent(itemId)}/promote`, {}),
  archiveBacklogItem: (id: string, itemId: string, input: ArchiveBacklogItemInput) =>
    request<BacklogItem>(`/projects/${encodeURIComponent(id)}/backlog/${encodeURIComponent(itemId)}/archive`, input),
  deleteBacklogItem: (id: string, itemId: string, expectedVersion: number) =>
    request<DeletedBacklogItem>(`/projects/${encodeURIComponent(id)}/backlog/${encodeURIComponent(itemId)}`, { expectedVersion }, undefined, 'DELETE'),
  deleteProject: (id: string, confirmation: string) =>
    request<DeletedProject>(`/projects/${encodeURIComponent(id)}`, { confirmation }, undefined, 'DELETE'),
  decisions: (id: string, includeHistory = false, signal?: AbortSignal) =>
    request<Decision[]>(`/projects/${encodeURIComponent(id)}/decisions${includeHistory ? '?includeHistory=true' : ''}`, undefined, signal),
  proposeDecision: (id: string, input: ProposeDecisionInput) =>
    request<Decision>(`/projects/${encodeURIComponent(id)}/decisions`, input),
  acceptDecision: (id: string, decisionId: string, input: AcceptDecisionInput) =>
    request<Decision>(`/projects/${encodeURIComponent(id)}/decisions/${encodeURIComponent(decisionId)}/accept`, input),
  revokeDecision: (id: string, decisionId: string, input: RevokeDecisionInput) =>
    request<Decision>(`/projects/${encodeURIComponent(id)}/decisions/${encodeURIComponent(decisionId)}/revoke`, input),
  supersedeDecision: (id: string, decisionId: string, input: SupersedeDecisionInput) =>
    request<Decision>(`/projects/${encodeURIComponent(id)}/decisions/${encodeURIComponent(decisionId)}/supersede`, input),
  charter: (id: string, signal?: AbortSignal) =>
    request<CharterRevision | null>(`/projects/${encodeURIComponent(id)}/charter`, undefined, signal),
  saveCharter: (id: string, input: { actor: string; body: string; expectedRevision: number }) =>
    request<CharterRevision>(`/projects/${encodeURIComponent(id)}/charter`, input),
  blockers: (id: string, includeClosed = false, signal?: AbortSignal) =>
    request<ProjectBlocker[]>(`/projects/${encodeURIComponent(id)}/blockers${includeClosed ? '?includeClosed=true' : ''}`, undefined, signal),
  openBlocker: (id: string, input: { agent: string; title: string; body: string; taskId?: string }) =>
    request<ProjectBlocker>(`/projects/${encodeURIComponent(id)}/blockers`, input),
  resolveBlocker: (id: string, blockerId: string, input: { agent: string; expectedVersion: number; note: string }) =>
    request<ProjectBlocker>(`/projects/${encodeURIComponent(id)}/blockers/${encodeURIComponent(blockerId)}/resolve`, input),
  reopenBlocker: (id: string, blockerId: string, input: { agent: string; expectedVersion: number; note: string }) =>
    request<ProjectBlocker>(`/projects/${encodeURIComponent(id)}/blockers/${encodeURIComponent(blockerId)}/reopen`, input),
  acceptBlockerRisk: (id: string, blockerId: string, input: { agent: string; expectedVersion: number; note: string }) =>
    request<ProjectBlocker>(`/projects/${encodeURIComponent(id)}/blockers/${encodeURIComponent(blockerId)}/accept-risk`, input),
  content: (id: string, includeArchived = false, signal?: AbortSignal) =>
    request<ContentEntry[]>(`/projects/${encodeURIComponent(id)}/content${includeArchived ? '?includeArchived=true' : ''}`, undefined, signal),
  contentItem: (id: string, itemId: string, signal?: AbortSignal) =>
    request<ContentDocument>(`/projects/${encodeURIComponent(id)}/content/${encodeURIComponent(itemId)}`, undefined, signal),
  createContent: (id: string, input: CreateContentInput) =>
    request<ContentEntry>(`/projects/${encodeURIComponent(id)}/content`, input),
  reviseContent: (id: string, itemId: string, input: ReviseContentInput) =>
    request<ContentEntry>(`/projects/${encodeURIComponent(id)}/content/${encodeURIComponent(itemId)}/revise`, input),
  archiveContent: (id: string, itemId: string, input: ArchiveContentInput) =>
    request<ContentItem>(`/projects/${encodeURIComponent(id)}/content/${encodeURIComponent(itemId)}/archive`, input),
  searchContent: (id: string, query: string, signal?: AbortSignal) =>
    request<ContentSearchResult[]>(`/projects/${encodeURIComponent(id)}/content/search?q=${encodeURIComponent(query)}`, undefined, signal),
  addContentRelation: (id: string, itemId: string, input: AddContentRelationInput) =>
    request<ContentRelation>(`/projects/${encodeURIComponent(id)}/content/${encodeURIComponent(itemId)}/relations`, input),
  context: (
    id: string,
    options?: {
      agent: string
      taskId?: string
      focusMode?: ResumeFocusMode
      maxChars?: number
      includeOutdatedContent?: boolean
    },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (options?.agent) params.set('agent', options.agent);
    if (options?.taskId) params.set('taskId', options.taskId);
    if (options?.focusMode) params.set('focusMode', options.focusMode);
    if (options?.maxChars) params.set('maxChars', String(options.maxChars));
    if (options?.includeOutdatedContent) params.set('includeOutdatedContent', 'true');
    const qs = params.toString();
    return request<ContextEnvelope>(
      `/projects/${encodeURIComponent(id)}/context${qs ? `?${qs}` : ''}`,
      undefined,
      signal,
    );
  },
  graph: (
    id: string,
    options?: {
      nodeTypes?: GraphNodeType[];
      includeArchived?: boolean;
    },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (options?.nodeTypes?.length) params.set('nodeTypes', options.nodeTypes.join(','));
    if (options?.includeArchived) params.set('includeArchived', 'true');
    const qs = params.toString();
    return request<ProjectGraph>(
      `/projects/${encodeURIComponent(id)}/graph${qs ? `?${qs}` : ''}`,
      undefined,
      signal,
    );
  },
  graphConflicts: (id: string, signal?: AbortSignal) =>
    request<DecisionConflictReport>(
      `/projects/${encodeURIComponent(id)}/graph/conflicts`,
      undefined,
      signal,
    ),
  graphStale: (id: string, signal?: AbortSignal) =>
    request<StaleContentReport>(
      `/projects/${encodeURIComponent(id)}/graph/stale`,
      undefined,
      signal,
    ),
  graphImpact: (
    id: string,
    type: GraphNodeType,
    entityId: string,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ type, id: entityId });
    return request<GraphImpactReport>(
      `/projects/${encodeURIComponent(id)}/graph/impact?${params.toString()}`,
      undefined,
      signal,
    );
  },
  evidence: (id: string, options?: ListEvidenceOptions, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (options?.taskId) params.set('taskId', options.taskId);
    if (options?.checkpointId) params.set('checkpointId', options.checkpointId);
    if (options?.staleOnly) params.set('staleOnly', 'true');
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return request<EvidenceView[]>(
      `/projects/${encodeURIComponent(id)}/evidence${qs ? `?${qs}` : ''}`,
      undefined,
      signal,
    );
  },
  crossCheckEvidence: (id: string, evidenceId: string, input: CrossCheckEvidenceInput) =>
    request<EvidenceView>(
      `/projects/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}/cross-check`,
      input,
    ),
  registerEvidenceArtifacts: (id: string, evidenceId: string, input: RegisterEvidenceArtifactsInput) =>
    request<EvidenceView>(
      `/projects/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}/artifacts`,
      input,
    ),
  blockerTimeline: (id: string, blockerId: string, signal?: AbortSignal) =>
    request<BlockerTimeline>(
      `/projects/${encodeURIComponent(id)}/blockers/${encodeURIComponent(blockerId)}/timeline`,
      undefined,
      signal,
    ),
  decisionTimeline: (id: string, decisionId: string, signal?: AbortSignal) =>
    request<DecisionTimeline>(
      `/projects/${encodeURIComponent(id)}/decisions/${encodeURIComponent(decisionId)}/timeline`,
      undefined,
      signal,
    ),
};
export function errorText(error: unknown) {
  // A tela é mais nova que o servidor aberto: a rota ainda não existe lá. O dono precisa saber o que fazer.
  if (error instanceof ApiError && error.code === 'route_not_found') return 'Esta parte da Axon é mais nova que o servidor que está aberto. Feche a Axon e abra de novo para carregar a versão atual.';
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}
