/**
 * Fila de aprovações (Parte 5): pedidos que só o dono do projeto pode decidir.
 *
 * Existe porque a Axon proíbe, com razão, que uma IA mude a diretriz do
 * projeto direto (`saveCharter` recusa `agent_proposal`) — mas não oferecia
 * nenhum caminho para a IA *propor* a mudança. Uma proposta fica pendente até
 * o dono aprovar ou recusar pela tela HTTP. Aprovar e recusar nunca são
 * ferramenta MCP: se fossem, a IA que propõe poderia aprovar a própria
 * proposta e a fila seria decoração (ver server/mcp-tools.ts — só
 * propose/list/withdraw estão lá).
 *
 * Arquivo isolado, sem dependência de outro tipo do domínio: apagar a Parte 5
 * começa apagando este arquivo.
 * para a lista exata de pontos de remoção.
 */

export type ApprovalKind = 'charter_change' | 'note'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

export interface ApprovalRequest {
  id: string
  projectId: string
  kind: ApprovalKind
  title: string
  body: string
  rationale: string
  proposedBy: string
  status: ApprovalStatus
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
  version: number
}

export interface ProposeApprovalInput {
  agent: string
  kind: ApprovalKind
  title: string
  body: string
  rationale: string
}

export interface ListApprovalsOptions {
  status?: ApprovalStatus
}

export interface WithdrawApprovalInput {
  agent: string
  expectedVersion: number
}

/**
 * Decisão do dono sobre uma proposta pendente. `expectedCharterRevision` só é
 * exigido para `kind: 'charter_change'` — é o equivalente ao `expectedRevision`
 * de `saveCharter`: o dono confirma sobre qual revisão do charter está
 * decidindo, e a aprovação falha explicitamente se o charter mudou embaixo
 * dela, sem aplicar metade da transação.
 */
export interface DecideApprovalInput {
  actor: string
  expectedVersion: number
  decisionNote?: string
  expectedCharterRevision?: number
}
