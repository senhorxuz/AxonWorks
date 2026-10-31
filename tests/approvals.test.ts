import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, test } from 'node:test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import type { Project } from '../shared/types.ts'

/**
 * Parte 5 — fila de aprovações: um caminho para IAs PROPOREM mudanças (como
 * uma nova diretriz de charter) que só o dono decide.
 *
 * Ponto que não pode falhar: aprovar e recusar são só HTTP, nunca MCP. Ver o
 * teste "MCP nunca registra approve/reject" abaixo — se ele falhar, a fila
 * virou decoração (uma IA poderia aprovar a própria proposta pelo MCP).
 */

let cleanups: Array<() => void> = []

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) {
    try {
      dispose()
    } catch {
      /* limpeza de arquivo temporário não deve mascarar a falha do teste */
    }
  }
})

function makeStore(): WorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'axon-approvals-'))
  const store = new WorkspaceStore(join(dir, 'workspace.sqlite'))
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* já fechado no próprio teste */
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

function expectDomain(fn: () => unknown, status: number, code: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof DomainError, `esperado DomainError, recebido ${String(err)}`)
    assert.equal(err.status, status)
    assert.equal(err.code, code)
    return true
  })
}

function seed(store: WorkspaceStore): Project {
  return store.createProject({ name: 'Projeto com dono', objective: 'Objetivo original do charter' })
}

describe('fila de aprovações (Parte 5) — propor, listar, retirar', () => {
  it('propõe uma mudança de charter como pendente', () => {
    const store = makeStore()
    const project = seed(store)
    const proposal = store.proposeApproval(project.id, {
      agent: 'Astra',
      kind: 'charter_change',
      title: 'Corrigir o charter',
      body: 'Nova diretriz corrigida do projeto.',
      rationale: 'O charter atual contradiz a decisão vigente sobre X.',
    })
    assert.equal(proposal.status, 'pending')
    assert.equal(proposal.proposedBy, 'Astra')
    assert.equal(proposal.kind, 'charter_change')
    assert.equal(proposal.decidedBy, null)
    assert.equal(proposal.decidedAt, null)
    assert.equal(proposal.version, 0)
  })

  it('lista por estado', () => {
    const store = makeStore()
    const project = seed(store)
    const a = store.proposeApproval(project.id, {
      agent: 'Astra', kind: 'note', title: 'A', body: 'corpo A', rationale: 'razão A',
    })
    store.proposeApproval(project.id, {
      agent: 'Astra', kind: 'note', title: 'B', body: 'corpo B', rationale: 'razão B',
    })
    store.withdrawApproval(project.id, a.id, { agent: 'Astra', expectedVersion: 0 })

    const pending = store.listApprovals(project.id, { status: 'pending' })
    assert.equal(pending.length, 1)
    assert.equal(pending[0]!.title, 'B')

    const withdrawn = store.listApprovals(project.id, { status: 'withdrawn' })
    assert.equal(withdrawn.length, 1)
    assert.equal(withdrawn[0]!.title, 'A')

    assert.equal(store.listApprovals(project.id).length, 2)
  })

  it('retirar: só quem propôs, e só enquanto pendente', () => {
    const store = makeStore()
    const project = seed(store)
    const proposal = store.proposeApproval(project.id, {
      agent: 'Astra', kind: 'note', title: 'T', body: 'corpo', rationale: 'razão',
    })

    expectDomain(
      () => store.withdrawApproval(project.id, proposal.id, { agent: 'Outra-IA', expectedVersion: 0 }),
      403,
      'not_proposer',
    )
    expectDomain(
      () => store.withdrawApproval(project.id, proposal.id, { agent: 'Astra', expectedVersion: 5 }),
      409,
      'version_conflict',
    )

    const withdrawn = store.withdrawApproval(project.id, proposal.id, { agent: 'Astra', expectedVersion: 0 })
    assert.equal(withdrawn.status, 'withdrawn')
    assert.equal(withdrawn.decidedBy, 'Astra')
    assert.ok(withdrawn.decidedAt)
  })

  it('estados finais são finais: proposta decidida não volta a pendente', () => {
    const store = makeStore()
    const project = seed(store)
    const proposal = store.proposeApproval(project.id, {
      agent: 'Astra', kind: 'note', title: 'T', body: 'corpo', rationale: 'razão',
    })
    store.withdrawApproval(project.id, proposal.id, { agent: 'Astra', expectedVersion: 0 })
    expectDomain(
      () => store.withdrawApproval(project.id, proposal.id, { agent: 'Astra', expectedVersion: 1 }),
      409,
      'approval_not_pending',
    )
    expectDomain(
      () => store.approveApproval(project.id, proposal.id, { actor: 'Dono', expectedVersion: 1 }),
      409,
      'approval_not_pending',
    )
    expectDomain(
      () => store.rejectApproval(project.id, proposal.id, { actor: 'Dono', expectedVersion: 1 }),
      409,
      'approval_not_pending',
    )
  })
})

describe('fila de aprovações (Parte 5) — aprovar charter_change grava a revisão na mesma transação', () => {
  it('aprovar aplica a diretriz proposta como nova revisão humana do charter', () => {
    const store = makeStore()
    const project = seed(store)
    const before = store.getCharter(project.id)
    assert.equal(before?.revision, 1)

    const proposal = store.proposeApproval(project.id, {
      agent: 'Astra',
      kind: 'charter_change',
      title: 'Corrigir o charter',
      body: 'Nova diretriz completa do projeto.',
      rationale: 'O charter atual está desatualizado.',
    })

    const decided = store.approveApproval(project.id, proposal.id, {
      actor: 'Dono',
      expectedVersion: 0,
      expectedCharterRevision: 1,
      decisionNote: 'Faz sentido, aprovado.',
    })
    assert.equal(decided.status, 'approved')
    assert.equal(decided.decidedBy, 'Dono')
    assert.equal(decided.decisionNote, 'Faz sentido, aprovado.')

    const after = store.getCharter(project.id)
    assert.equal(after?.revision, 2)
    assert.equal(after?.body, 'Nova diretriz completa do projeto.')
    assert.equal(after?.createdBy, 'Dono')
    assert.equal(after?.sourceKind, 'human_directive')
    assert.equal(after?.supersedesId, before?.id)

    // approve também atualiza o objetivo do projeto, como save_charter faz
    const detail = store.getProject(project.id)
    assert.equal(detail.project.objective, 'Nova diretriz completa do projeto.')
  })

  it('conflito de revisão do charter no momento da aprovação falha inteiro, sem aplicar metade', () => {
    const store = makeStore()
    const project = seed(store)
    const proposal = store.proposeApproval(project.id, {
      agent: 'Astra',
      kind: 'charter_change',
      title: 'Corrigir o charter',
      body: 'Diretriz da IA.',
      rationale: 'razão',
    })

    // O charter muda por outro caminho antes da decisão (ex.: o dono editou direto).
    store.saveCharter(project.id, { actor: 'Dono', body: 'Diretriz editada direto pelo dono', expectedRevision: 1 })

    expectDomain(
      () =>
        store.approveApproval(project.id, proposal.id, {
          actor: 'Dono',
          expectedVersion: 0,
          expectedCharterRevision: 1, // desatualizado: o charter já está na revisão 2
        }),
      409,
      'charter_revision_conflict',
    )

    // Nada foi aplicado: nem o charter avançou de novo, nem a proposta mudou de estado.
    const charter = store.getCharter(project.id)
    assert.equal(charter?.revision, 2)
    assert.equal(charter?.body, 'Diretriz editada direto pelo dono')
    const stillPending = store.listApprovals(project.id, { status: 'pending' })
    assert.equal(stillPending.length, 1)
    assert.equal(stillPending[0]!.id, proposal.id)
    assert.equal(stillPending[0]!.version, 0)
  })

  it('aprovar kind note nunca toca o charter', () => {
    const store = makeStore()
    const project = seed(store)
    const before = store.getCharter(project.id)
    const proposal = store.proposeApproval(project.id, {
      agent: 'Astra', kind: 'note', title: 'Observação', body: 'Só uma nota', rationale: 'razão',
    })
    store.approveApproval(project.id, proposal.id, { actor: 'Dono', expectedVersion: 0 })
    const after = store.getCharter(project.id)
    assert.equal(after?.revision, before?.revision)
    assert.equal(after?.body, before?.body)
  })

  it('recusar (qualquer kind) nunca toca a diretriz', () => {
    const store = makeStore()
    const project = seed(store)
    const before = store.getCharter(project.id)
    const proposal = store.proposeApproval(project.id, {
      agent: 'Astra', kind: 'charter_change', title: 'T', body: 'Diretriz recusada', rationale: 'razão',
    })
    const decided = store.rejectApproval(project.id, proposal.id, {
      actor: 'Dono', expectedVersion: 0, decisionNote: 'Não agora.',
    })
    assert.equal(decided.status, 'rejected')
    assert.equal(decided.decisionNote, 'Não agora.')
    const after = store.getCharter(project.id)
    assert.equal(after?.revision, before?.revision)
    assert.equal(after?.body, before?.body)
  })
})

describe('fila de aprovações (Parte 5) — get_resume_brief', () => {
  it('ganha a seção "Esperando por você" com as propostas pendentes', () => {
    const store = makeStore()
    const project = seed(store)
    store.proposeApproval(project.id, {
      agent: 'Astra', kind: 'charter_change', title: 'Diretriz pendente', body: 'corpo', rationale: 'razão',
    })
    const decided = store.proposeApproval(project.id, {
      agent: 'Astra', kind: 'note', title: 'Já decidida', body: 'corpo', rationale: 'razão',
    })
    store.approveApproval(project.id, decided.id, { actor: 'Dono', expectedVersion: 0 })

    const brief = store.getResumeBrief(project.id, 'Astra')
    assert.equal(brief.pendingApprovals.length, 1)
    assert.equal(brief.pendingApprovals[0]!.title, 'Diretriz pendente')
    assert.match(brief.markdown, /## Esperando por você/)
    assert.match(brief.markdown, /Diretriz pendente/)
    assert.doesNotMatch(brief.markdown.split('## Esperando por você')[1]!.split('##')[0]!, /Já decidida/)
  })
})

describe('fila de aprovações (Parte 5) — deleteProject', () => {
  it('apaga a tabela nova na ordem certa, sem violar chave estrangeira', () => {
    const store = makeStore()
    const project = seed(store)
    store.proposeApproval(project.id, {
      agent: 'Astra', kind: 'note', title: 'T', body: 'corpo', rationale: 'razão',
    })
    const result = store.deleteProject(project.id, project.name)
    assert.equal(result.projectId, project.id)
    expectDomain(() => store.getProject(project.id), 404, 'not_found')
  })
})

async function httpFixture(t: { after: (fn: () => void | Promise<void>) => void }) {
  const store = new WorkspaceStore(':memory:')
  const server = createServer(createApp(store))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  })
  const headers = {
    'Content-Type': 'application/json',
    'X-Workspace-Client': 'local',
    Host: `127.0.0.1:${address.port}`,
    Origin: `http://127.0.0.1:${address.port}`,
  }
  const post = (urlPath: string, body: unknown) =>
    fetch(base + urlPath, { method: 'POST', headers, body: JSON.stringify(body) })
  const get = (urlPath: string) => fetch(base + urlPath, { headers: { Host: headers.Host, Origin: headers.Origin } })
  return { post, get }
}

test('fila de aprovações (Parte 5) — HTTP: propor, aprovar (aplica charter) e recusar', async (t) => {
  const { post, get } = await httpFixture(t)
  const createdProject = await post('/api/projects', { name: 'HTTP Aprovações', objective: 'Objetivo original' })
  const project = await createdProject.json()

  const proposed = await post(`/api/projects/${project.id}/approvals`, {
    agent: 'Astra',
    kind: 'charter_change',
    title: 'Nova diretriz',
    body: 'Diretriz proposta via HTTP',
    rationale: 'razão',
  })
  assert.equal(proposed.status, 201)
  const proposal = await proposed.json()
  assert.equal(proposal.status, 'pending')

  const listed = await get(`/api/projects/${project.id}/approvals?status=pending`)
  assert.equal(listed.status, 200)
  const pending = await listed.json()
  assert.equal(pending.length, 1)

  const approved = await post(`/api/projects/${project.id}/approvals/${proposal.id}/approve`, {
    actor: 'Dono',
    expectedVersion: 0,
    expectedCharterRevision: 1,
  })
  assert.equal(approved.status, 200)
  const decided = await approved.json()
  assert.equal(decided.status, 'approved')

  const charterRes = await get(`/api/projects/${project.id}/charter`);
  const charter = await charterRes.json()
  assert.equal(charter.body, 'Diretriz proposta via HTTP')
  assert.equal(charter.revision, 2)

  const proposedTwo = await post(`/api/projects/${project.id}/approvals`, {
    agent: 'Astra', kind: 'note', title: 'Outra', body: 'corpo', rationale: 'razão',
  })
  const proposalTwo = await proposedTwo.json()
  const rejected = await post(`/api/projects/${project.id}/approvals/${proposalTwo.id}/reject`, {
    actor: 'Dono',
    expectedVersion: 0,
  })
  assert.equal(rejected.status, 200)
  const decidedTwo = await rejected.json()
  assert.equal(decidedTwo.status, 'rejected')
})

test('fila de aprovações (Parte 5) — MCP: propose/list/withdraw existem, approve/reject NUNCA', async (t) => {
  const store = new WorkspaceStore(':memory:')
  const server = createMcpServer(store)
  const client = new Client({ name: 'approvals-mcp-test', version: '1.0.0' })
  t.after(async () => {
    await client.close()
    await server.close()
    store.close()
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const listing = await client.listTools()
  const names = listing.tools.map((tool) => tool.name)
  assert.ok(names.includes('propose_approval'), 'propose_approval deve estar registrada')
  assert.ok(names.includes('list_approvals'), 'list_approvals deve estar registrada')
  assert.ok(names.includes('withdraw_approval'), 'withdraw_approval deve estar registrada')

  // O ponto que não pode falhar: aprovar e recusar são só HTTP.
  for (const forbidden of ['approve_approval', 'reject_approval', 'decide_approval', 'accept_approval']) {
    assert.ok(!names.includes(forbidden), `${forbidden} NÃO pode estar registrada no MCP`)
  }

  const created = await client.callTool({ name: 'create_project', arguments: { name: 'MCP Aprovações', objective: 'Obj' } })
  const projectContent = created.content as Array<{ type: string; text: string }>
  const project = JSON.parse(projectContent[0]!.text)

  const proposed = await client.callTool({
    name: 'propose_approval',
    arguments: {
      projectId: project.id,
      agent: 'Grok',
      kind: 'charter_change',
      title: 'Diretriz proposta pelo MCP',
      body: 'corpo',
      rationale: 'razão',
    },
  })
  assert.equal(proposed.isError, undefined)
  const proposalContent = proposed.content as Array<{ type: string; text: string }>
  const proposal = JSON.parse(proposalContent[0]!.text)
  assert.equal(proposal.status, 'pending')

  const listed = await client.callTool({ name: 'list_approvals', arguments: { projectId: project.id } })
  const listedContent = listed.content as Array<{ type: string; text: string }>
  const all = JSON.parse(listedContent[0]!.text)
  assert.equal(all.length, 1)

  const withdrawn = await client.callTool({
    name: 'withdraw_approval',
    arguments: { projectId: project.id, approvalId: proposal.id, agent: 'Grok', expectedVersion: 0 },
  })
  assert.equal(withdrawn.isError, undefined)
  const withdrawnContent = withdrawn.content as Array<{ type: string; text: string }>
  assert.equal(JSON.parse(withdrawnContent[0]!.text).status, 'withdrawn')
})

test('save_charter pelo MCP vira proposta pendente e nunca grava a diretriz em nome do dono', async (t) => {
  const store = new WorkspaceStore(':memory:')
  const server = createMcpServer(store)
  const client = new Client({ name: 'charter-mcp-test', version: '1.0.0' })
  t.after(async () => {
    await client.close()
    await server.close()
    store.close()
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const project = store.createProject({ name: 'Diretriz protegida', objective: 'Diretriz original do dono.' })
  const antes = store.getCharter(project.id)
  assert.ok(antes)

  // Mesmo declarando human_directive, uma IA pelo MCP não fala em nome do dono.
  const enviado = await client.callTool({
    name: 'save_charter',
    arguments: { projectId: project.id, actor: 'Grok', body: 'Diretriz reescrita pela IA.', expectedRevision: antes.revision, sourceKind: 'human_directive' },
  })
  assert.equal(enviado.isError, undefined)
  const resposta = JSON.parse((enviado.content as Array<{ text: string }>)[0]!.text)
  assert.equal(resposta.status, 'pending_approval')
  assert.equal(resposta.approval.kind, 'charter_change')
  assert.equal(resposta.approval.proposedBy, 'Grok')
  assert.equal(resposta.approval.body, 'Diretriz reescrita pela IA.')

  const depois = store.getCharter(project.id)
  assert.equal(depois?.revision, antes.revision, 'a diretriz não pode mudar de versão')
  assert.equal(depois?.body, 'Diretriz original do dono.')
  assert.equal(store.getProject(project.id).project.objective, 'Diretriz original do dono.')

  const pendentes = store.listApprovals(project.id, { status: 'pending' })
  assert.equal(pendentes.length, 1)
  assert.equal(pendentes[0]!.id, resposta.approval.id)

  // Versão velha continua sendo conflito, e nada entra na fila.
  const velho = await client.callTool({
    name: 'save_charter',
    arguments: { projectId: project.id, actor: 'Grok', body: 'Outra.', expectedRevision: antes.revision + 5 },
  })
  assert.equal(velho.isError, true)
  assert.equal(JSON.parse((velho.content as Array<{ text: string }>)[0]!.text).error.code, 'version_conflict')
  assert.equal(store.listApprovals(project.id, { status: 'pending' }).length, 1)
})
