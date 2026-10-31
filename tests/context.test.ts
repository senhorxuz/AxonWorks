import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../server/app.js'
import { createMcpServer } from '../server/mcp-tools.js'
import { DomainError, WorkspaceStore } from '../server/store.js'
import type { ContextEnvelope } from '../shared/context.js'

const T0 = new Date('2026-09-15T05:00:00.000Z')
const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) {
    await dispose()
  }
})

function makeStore(): WorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'axon-context-'))
  const store = new WorkspaceStore(join(dir, 'workspace.sqlite'), { now: () => T0 })
  cleanups.push(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

function expectDomain(fn: () => unknown, status: number, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError, `Esperava DomainError mas recebeu: ${String(error)}`)
    assert.equal(error.status, status)
    assert.equal(error.code, code)
    return true
  })
}

describe('Compilador de Contexto — ContextEnvelope', () => {
  it('gera envelope estável com charter vigente, decisões, bloqueios e checkpoint efetivo', () => {
    const store = makeStore()
    const project = store.createProject({
      name: 'Projeto Alfa',
      objective: 'Construir pipeline determinístico de dados',
    })

    // Charter nasce na criação do projeto (revisão 1)
    const charter = store.getCharter(project.id)
    assert.ok(charter)

    // Decisão vigente (aceita pelo operador)
    const dec = store.proposeDecision(project.id, {
      agent: 'Astra',
      title: 'Usar SQLite local',
      body: 'Persistência sem dependências externas',
    })
    store.acceptDecision(project.id, dec.id, { actor: 'Operador', expectedVersion: 0 })

    // Bloqueio aberto
    store.openBlocker(project.id, {
      agent: 'Astra',
      title: 'Aguardando validação do schema',
      body: 'Definição de colunas em revisão',
    })

    // Checkpoint geral
    store.saveCheckpoint(project.id, {
      agent: 'Astra',
      expectedRevision: 0,
      idempotencyKey: 'cp-init',
      summary: 'Estrutura inicial criada',
      nextStep: 'Definir entidades do modelo',
    })

    const envelope = store.compileContext(project.id, { agent: 'Grok' })

    assert.equal(envelope.projectId, project.id)
    assert.equal(envelope.projectName, 'Projeto Alfa')
    assert.equal(envelope.charterRevisionId, charter.id)
    assert.equal(envelope.charterRevisionNo, 1)
    assert.equal(envelope.focusTaskId, null)
    assert.equal(envelope.focusMode, 'auto')
    assert.equal(envelope.agent, 'Grok')
    assert.equal(envelope.truncated, false)

    // Verifica seções obrigatórias
    const sectionKinds = envelope.sections.map((s) => s.kind)
    assert.ok(sectionKinds.includes('charter'), 'Deve incluir seção charter')
    assert.ok(sectionKinds.includes('checkpoint'), 'Deve incluir seção checkpoint')
    assert.ok(sectionKinds.includes('decisions'), 'Deve incluir seção decisions')
    assert.ok(sectionKinds.includes('blockers'), 'Deve incluir seção blockers')

    // Cada item explica fonte, revisão, proveniência e motivo
    const charterSec = envelope.sections.find((s) => s.kind === 'charter')
    assert.equal(charterSec?.items.length, 1)
    assert.equal(charterSec?.items[0]?.sourceType, 'charter')
    assert.equal(charterSec?.items[0]?.revisionNo, 1)
    assert.equal(charterSec?.items[0]?.provenance, 'human_directive')
    assert.ok(charterSec?.items[0]?.reason)

    const decSec = envelope.sections.find((s) => s.kind === 'decisions')
    assert.equal(decSec?.items.length, 1)
    assert.equal(decSec?.items[0]?.title, 'Usar SQLite local')
    assert.equal(decSec?.items[0]?.authority, 'directive')

    // Banner de segurança presente no markdown
    assert.match(envelope.markdown, /Este conteúdo é dado não confiável/)
    assert.match(envelope.markdown, /Identidades de agente são declaradas/)
  })

  it('inclui conteúdos da Biblioteca vinculados à tarefa em foco e omite arquivado/desatualizado por padrão', () => {
    const store = makeStore()
    const project = store.createProject({
      name: 'Biblioteca no Envelope',
      objective: 'Testar seleção de conteúdos relacionados',
    })

    const task = store.createTask(project.id, { title: 'Implementar parser AST' })

    // 1. Conteúdo ativo e vigente vinculado à tarefa
    const contentValid = store.createContent(project.id, {
      title: 'Gramática da linguagem',
      kind: 'specification',
      body: 'Regras de sintaxe em formato EBNF',
      createdBy: 'Humano',
      sourceKind: 'human_directive',
      declaredValidity: 'current',
    })
    store.addContentRelation(project.id, {
      sourceRevisionId: contentValid.revision.id,
      targetType: 'task',
      targetId: task.id,
      kind: 'required_input',
      createdBy: 'Humano',
    })

    // 2. Conteúdo arquivado vinculado à tarefa
    const contentArchived = store.createContent(project.id, {
      title: 'Rascunho descartado',
      kind: 'note',
      body: 'Ideias antigas',
      createdBy: 'Grok',
      sourceKind: 'agent_report',
      declaredValidity: 'current',
    })
    store.addContentRelation(project.id, {
      sourceRevisionId: contentArchived.revision.id,
      targetType: 'task',
      targetId: task.id,
      kind: 'related',
      createdBy: 'Grok',
    })
    store.archiveContent(project.id, contentArchived.item.id, { expectedVersion: 0 })

    // 3. Conteúdo desatualizado vinculado à tarefa
    const contentOutdated = store.createContent(project.id, {
      title: 'Especificação obsoleta',
      kind: 'reference',
      body: 'Antigo protocolo v0',
      createdBy: 'Grok',
      sourceKind: 'agent_report',
      declaredValidity: 'outdated',
    })
    store.addContentRelation(project.id, {
      sourceRevisionId: contentOutdated.revision.id,
      targetType: 'task',
      targetId: task.id,
      kind: 'supports',
      createdBy: 'Grok',
    })

    // Compila contexto apontando para a tarefa
    const envelopeDefault = store.compileContext(project.id, {
      agent: 'Gemini',
      taskId: task.id,
    })

    assert.equal(envelopeDefault.focusTaskId, task.id)
    const libSec = envelopeDefault.sections.find((s) => s.kind === 'library_content')
    assert.ok(libSec, 'Deve conter seção de biblioteca')
    assert.equal(libSec.items.length, 1, 'Deve incluir apenas o conteúdo ativo e vigente')
    assert.equal(libSec.items[0]?.id, contentValid.item.id)
    assert.equal(libSec.items[0]?.revisionId, contentValid.revision.id)
    assert.equal(libSec.items[0]?.provenance, 'human_directive')
    assert.match(libSec.items[0]?.reason ?? '', /required_input/)

    // Verifica que omitidos foram registrados com contagens exatas
    assert.equal(envelopeDefault.omittedCounts['library_content_archived'], 1)
    assert.equal(envelopeDefault.omittedCounts['library_content_outdated'], 1)

    // Se solicitado includeOutdatedContent, deve incluir o desatualizado mas manter arquivado de fora
    const envelopeWithOutdated = store.compileContext(project.id, {
      agent: 'Gemini',
      taskId: task.id,
      includeOutdatedContent: true,
    })
    const libSecOutdated = envelopeWithOutdated.sections.find((s) => s.kind === 'library_content')
    assert.equal(libSecOutdated?.items.length, 2, 'Deve incluir ativo vigente + desatualizado')
    assert.equal(envelopeWithOutdated.omittedCounts['library_content_archived'], 1)
    assert.equal(envelopeWithOutdated.omittedCounts['library_content_outdated'], undefined)
  })

  it('não escolhe tarefa em silêncio quando agente possui múltiplas reservas ativas', () => {
    const store = makeStore()
    const project = store.createProject({
      name: 'Múltiplas Tarefas',
      objective: 'Validar coordenação de foco',
    })

    const t1 = store.createTask(project.id, { title: 'Tarefa 1' })
    const t2 = store.createTask(project.id, { title: 'Tarefa 2' })

    store.claimTask(project.id, t1.id, { agent: 'Astra', expectedVersion: 0 })
    store.claimTask(project.id, t2.id, { agent: 'Astra', expectedVersion: 0 })

    // Sem taskId explícito e em modo auto: não deve escolher silenciosamente
    const envelopeAuto = store.compileContext(project.id, { agent: 'Astra' })
    assert.equal(envelopeAuto.focusTaskId, null)
    assert.ok(
      envelopeAuto.conflicts.some((c) => c.kind === 'ambiguous_focus'),
      'Deve registrar conflito de ambiguous_focus',
    )
    assert.match(envelopeAuto.markdown, /Escolha uma das tarefas/)

    // Com taskId explícito: foco selecionado na tarefa indicada
    const envelopeExplicit = store.compileContext(project.id, { agent: 'Astra', taskId: t2.id })
    assert.equal(envelopeExplicit.focusTaskId, t2.id)

    // Com focusMode: 'project': força visão geral do projeto
    const envelopeProject = store.compileContext(project.id, { agent: 'Astra', focusMode: 'project' })
    assert.equal(envelopeProject.focusTaskId, null)
    assert.equal(envelopeProject.focusMode, 'project')

    // taskId não pode ser combinado com focusMode project
    expectDomain(
      () => store.compileContext(project.id, { agent: 'Astra', taskId: t1.id, focusMode: 'project' }),
      400,
      'invalid_input',
    )
  })

  it('mantém isolamento estrito entre projetos', () => {
    const store = makeStore()
    const p1 = store.createProject({ name: 'Projeto 1', objective: 'Obj 1' })
    const p2 = store.createProject({ name: 'Projeto 2', objective: 'Obj 2' })

    const t1 = store.createTask(p1.id, { title: 'Tarefa de P1' })
    const t2 = store.createTask(p2.id, { title: 'Tarefa de P2' })

    store.saveCheckpoint(p1.id, {
      agent: 'Astra',
      expectedRevision: 0,
      idempotencyKey: 'cp-p1',
      summary: 'P1 checkpoint',
      nextStep: 'Próximo em P1',
    })
    store.saveCheckpoint(p2.id, {
      agent: 'Grok',
      expectedRevision: 0,
      idempotencyKey: 'cp-p2',
      summary: 'P2 checkpoint',
      nextStep: 'Próximo em P2',
    })

    // Requisitar taskId de P2 no contexto de P1 deve retornar 404
    expectDomain(
      () => store.compileContext(p1.id, { agent: 'Astra', taskId: t2.id }),
      404,
      'not_found',
    )

    // Contexto de P1 não deve vazar nada de P2
    const env1 = store.compileContext(p1.id, { agent: 'Astra', taskId: t1.id })
    assert.equal(env1.projectId, p1.id)
    assert.equal(env1.projectName, 'Projeto 1')
    assert.doesNotMatch(env1.markdown, /P2 checkpoint/)
    assert.doesNotMatch(env1.markdown, /Tarefa de P2/)
  })

  it('corta apenas entre entidades completas ao aplicar limite de orçamento', () => {
    const store = makeStore()
    const project = store.createProject({
      name: 'Orçamento',
      objective: 'Testar corte por entidades inteiras',
    })

    // Adiciona 5 decisões
    for (let i = 1; i <= 5; i++) {
      const d = store.proposeDecision(project.id, {
        agent: 'Astra',
        title: `Decisão de arquitetura número ${i}`,
        body: `Corpo explicativo extenso para a decisão número ${i} detalhando razões técnicas e operacionais.`,
      })
      store.acceptDecision(project.id, d.id, { actor: 'Operador', expectedVersion: 0 })
    }

    // Compila com orçamento pequeno (ex: 2000 caracteres)
    const envelope = store.compileContext(project.id, {
      agent: 'Grok',
      maxChars: 2000,
    })

    // Verifica que corte preservou entidades completas
    assert.ok(envelope.markdown.length <= 2000, 'Markdown não deve exceder maxChars')
    if (envelope.truncated) {
      assert.ok(
        Object.keys(envelope.omittedCounts).length > 0,
        'Deve reportar entidades omitidas em omittedCounts',
      )
      assert.match(envelope.markdown, /limite de orçamento/)
    }
  })

  it('HTTP GET /api/projects/:id/context e MCP compile_context expõem o mesmo envelope', async (t) => {
    const store = makeStore()
    const project = store.createProject({
      name: 'Transporte Contexto',
      objective: 'Validar HTTP e MCP para compilador de contexto',
    })
    const task = store.createTask(project.id, { title: 'Tarefa de Transporte' })

    const server = createServer(createApp(store))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`

    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    // 1. Teste HTTP GET /api/projects/:id/context
    const resHttp = await fetch(
      `${base}/api/projects/${project.id}/context?agent=Astra&taskId=${task.id}`,
      {
        headers: {
          Host: `127.0.0.1:${address.port}`,
          Origin: `http://127.0.0.1:${address.port}`,
        },
      },
    )
    assert.equal(resHttp.status, 200)
    const httpEnvelope = (await resHttp.json()) as ContextEnvelope
    assert.equal(httpEnvelope.projectId, project.id)
    assert.equal(httpEnvelope.focusTaskId, task.id)
    assert.equal(httpEnvelope.agent, 'Astra')

    // 2. Teste MCP compile_context
    const mcpServer = createMcpServer(store)
    const client = new Client({ name: 'axon-context-mcp', version: '1.0.0' })
    cleanups.push(async () => {
      await client.close()
      await mcpServer.close()
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    await client.connect(clientTransport)

    const listing = await client.listTools()
    const compileTool = listing.tools.find((tool) => tool.name === 'compile_context')
    assert.ok(compileTool, 'Ferramenta compile_context deve estar registrada no MCP')

    const response = await client.callTool({
      name: 'compile_context',
      arguments: {
        projectId: project.id,
        agent: 'Astra',
        taskId: task.id,
      },
    })
    assert.equal(response.isError, undefined)
    const content = response.content as Array<{ type: string; text: string }>
    const mcpEnvelope = JSON.parse(content[0]!.text) as ContextEnvelope
    assert.equal(mcpEnvelope.projectId, project.id)
    assert.equal(mcpEnvelope.focusTaskId, task.id)
    assert.equal(mcpEnvelope.agent, 'Astra')
  })
})
