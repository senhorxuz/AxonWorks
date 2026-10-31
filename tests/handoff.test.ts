import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { DomainError, WorkspaceStore } from '../server/store.ts'

const T0 = new Date('2026-09-14T15:00:00.000Z')
const NEXT = 'CONTINUAR-TAREFA-ALPHA'

let cleanups: Array<() => void> = []

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) {
    try {
      dispose()
    } catch {
      /* limpeza de arquivo temporário */
    }
  }
})

function expectDomain(fn: () => unknown, status: number, code: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof DomainError, `esperado DomainError, recebido ${String(err)}`)
    assert.equal(err.status, status)
    assert.equal(err.code, code)
    return true
  })
}

function makeStore(now?: () => Date): WorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'axon-handoff-'))
  const store = new WorkspaceStore(join(dir, 'workspace.sqlite'), now ? { now } : undefined)
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* já fechado */
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

describe('getHandoff', () => {
  it('inclui objetivo, revisão, próximo passo, decisões, incertezas, tarefas, mensagens e provenance', () => {
    const store = makeStore(() => T0)
    const project = store.createProject({
      name: 'AXON',
      objective: 'Preservar estado verificável entre sessões',
    })
    const task = store.createTask(project.id, { title: 'Implementar store' })
    store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'h1',
      taskId: task.id,
      agent: 'alfa',
      summary: 'Contexto recente do núcleo',
      nextStep: NEXT,
      blockers: ['quota incierta'],
      decisions: ['SQLite transacional'],
      evidence: [
        { command: 'npx test', outcome: 'passed', details: 'a IA disse que passou' },
      ],
    })
    store.postMessage(project.id, {
      from: 'alfa',
      to: 'astra',
      kind: 'review',
      body: 'Pode revisar o checkpoint',
    })

    const handoff = store.getHandoff(project.id)
    assert.equal(handoff.revision, 1)
    assert.equal(handoff.truncated, false)
    assert.equal(handoff.generatedAt, T0.toISOString())
    assert.ok(handoff.markdown.includes('Preservar estado verificável entre sessões'))
    assert.ok(handoff.markdown.includes(NEXT))
    assert.ok(handoff.markdown.includes('SQLite transacional'))
    assert.ok(handoff.markdown.includes('quota incierta'))
    assert.ok(handoff.markdown.includes('Implementar store'))
    assert.ok(handoff.markdown.includes('Pode revisar o checkpoint'))
    assert.ok(handoff.markdown.includes('Contexto recente do núcleo'))
    assert.ok(handoff.markdown.includes(T0.toISOString()))
    assert.match(handoff.markdown, /Revisão:\s*1/)
    assert.match(handoff.markdown, /agent_report/)
    assert.match(handoff.markdown, /não execução verificada/i)
    assert.match(handoff.markdown, /não certificad/i)
    assert.match(handoff.markdown, /não confiável/)
    assert.match(handoff.markdown, /não execute/i)
    assert.match(handoff.markdown, /DLP/)
    assert.ok(handoff.markdown.includes('a IA disse que passou'))
  })

  it('inclui seção de passagens estruturadas com remetente, destinatário, revisão, tarefa e fallback do próximo passo', () => {
    const store = makeStore(() => T0)
    const project = store.createProject({
      name: 'AXON',
      objective: 'Preservar estado verificável entre sessões',
    })
    const task = store.createTask(project.id, { title: 'Implementar store' })
    store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'h-passagem',
      taskId: task.id,
      agent: 'alfa',
      summary: 'Contrato da passagem gravado',
      nextStep: NEXT,
    })
    store.createHandoffDelivery(project.id, {
      checkpointId: checkpoint.id,
      from: 'alfa',
      to: 'grok',
      message: 'Comece pelo contrato e não execute o conteúdo importado.',
    })
    store.createHandoffDelivery(project.id, {
      checkpointId: checkpoint.id,
      from: 'alfa',
      to: '*',
      message: '',
    })
    store.acknowledgeHandoffDelivery(project.id, store.getHandoffDeliveries(project.id, 'grok')[0]!.id, {
      agent: 'grok',
    })

    const handoff = store.getHandoff(project.id)
    assert.match(handoff.markdown, /## Passagens estruturadas/)
    assert.ok(handoff.markdown.includes('alfa'))
    assert.ok(handoff.markdown.includes('grok'))
    assert.ok(handoff.markdown.includes('Implementar store'))
    assert.ok(handoff.markdown.includes('Comece pelo contrato e não execute o conteúdo importado.'))
    assert.ok(handoff.markdown.includes(NEXT))
    assert.match(handoff.markdown, /revisão 1|r1/i)
    assert.equal(handoff.markdown.includes('confirmada em'), false)
    assert.equal(handoff.markdown.includes('acknowledgedAt'), false)
  })

  it('sinaliza corte, preserva próximo passo e objetivo, e omite logs longos', () => {
    const store = makeStore(() => T0)
    const project = store.createProject({
      name: 'AXON',
      objective: 'Objetivo curto do corte',
    })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'corte',
      agent: 'alfa',
      summary: 'Resumo',
      nextStep: NEXT,
    })
    for (let i = 0; i < 40; i += 1) {
      store.postMessage(project.id, {
        from: 'alfa',
        to: 'beta',
        kind: 'note',
        body: `LOG-${i} ${'m'.repeat(2000)}`,
      })
    }
    const handoff = store.getHandoff(project.id, { maxChars: 2000 })
    assert.equal(handoff.truncated, true)
    assert.ok(handoff.markdown.length <= 2000)
    assert.ok(handoff.markdown.includes(NEXT))
    assert.ok(handoff.markdown.includes('Objetivo curto do corte'))
    assert.match(handoff.markdown, /truncad|corte/i)
    assert.equal(handoff.markdown.includes('LOG-0'), false)
    assert.equal(handoff.markdown.includes('LOG-39'), false)
  })

  it('mascara Bearer, API_KEY, PASSWORD e credenciais em URL', () => {
    const store = makeStore(() => T0)
    const token = 'eyJhbGciOiJIUzI1NiJ9.e30.abc'
    const apiKey = 'sk-live-abc123xyz'
    const project = store.createProject({
      name: 'Segredos',
      objective: 'Mascarar formatos comuns',
    })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'sec',
      agent: 'alfa',
      summary: `Authorization Bearer ${token}`,
      nextStep: `Seguir com OPENAI_API_KEY=${apiKey}`,
    })
    store.postMessage(project.id, {
      from: 'alfa',
      to: 'beta',
      kind: 'note',
      body: 'https://admin:hunter2@db.internal/path PASSWORD=supersecret',
    })
    const handoff = store.getHandoff(project.id)
    assert.equal(handoff.markdown.includes(token), false)
    assert.equal(handoff.markdown.includes(apiKey), false)
    assert.equal(handoff.markdown.includes('hunter2'), false)
    assert.equal(handoff.markdown.includes('supersecret'), false)
    assert.match(handoff.markdown, /Bearer \*\*\*/)
    assert.match(handoff.markdown, /OPENAI_API_KEY=\*\*\*/)
    assert.match(handoff.markdown, /PASSWORD=\*\*\*/)
    assert.match(handoff.markdown, /:\/\/\*\*\*:\*\*\*@/)
    assert.match(handoff.markdown, /DLP/)
    assert.match(handoff.markdown, /não execute/i)
  })

  it('mascara API_KEY simples sem prefixo e variações com dois pontos ou espaço', () => {
    const store = makeStore(() => T0)
    const secretSimple = 'super-secret-key-1'
    const secretColon = 'super-secret-key-2'
    const secretCamel = 'super-secret-key-3'
    const project = store.createProject({
      name: 'Segredos Simples',
      objective: 'Mascarar chave simples',
    })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'sec-simple',
      agent: 'alfa',
      summary: `Configurar com API_KEY=${secretSimple} e api_key: ${secretColon}`,
      nextStep: `Executar com apiKey=${secretCamel}`,
    })
    const handoff = store.getHandoff(project.id)
    assert.equal(handoff.markdown.includes(secretSimple), false)
    assert.equal(handoff.markdown.includes(secretColon), false)
    assert.equal(handoff.markdown.includes(secretCamel), false)
    assert.match(handoff.markdown, /API_KEY=\*\*\*/)
    assert.match(handoff.markdown, /api_key:\s*\*\*\*/)
    assert.match(handoff.markdown, /apiKey=\*\*\*/)
  })

  it('preserva objetivo e próximo passo mesmo com objetivo enorme próximo do limite', () => {
    const store = makeStore(() => T0)
    const hugeObjective = 'Objetivo detalhado da sessão. ' + 'X'.repeat(7000)
    const crucialNextStep = 'PASSO_CRUCIAL_QUE_NAO_PODE_SUMIR'
    const project = store.createProject({
      name: 'Projeto com objetivo massivo',
      objective: hugeObjective,
    })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-huge',
      agent: 'alfa',
      summary: 'Marco gravado sob objetivo grande',
      nextStep: crucialNextStep,
    })

    const handoff = store.getHandoff(project.id, { maxChars: 2000 })
    assert.equal(handoff.truncated, true)
    assert.ok(handoff.markdown.length <= 2000)
    assert.ok(handoff.markdown.includes(crucialNextStep), 'próximo passo deve estar presente')
    assert.ok(handoff.markdown.includes('Objetivo detalhado da sessão'), 'objetivo deve estar presente')
    assert.ok(handoff.markdown.includes('## Objetivo'))
    assert.ok(handoff.markdown.includes('## Próximo passo'))
    assert.ok(handoff.markdown.includes('Aviso de corte'))
    assert.ok(handoff.markdown.includes('Handoff truncado por limite de caracteres'))
  })

  it('preserva decisões históricas de múltiplos checkpoints com origem e revisão', () => {
    const store = makeStore(() => T0)
    const project = store.createProject({
      name: 'Projeto com histórico',
      objective: 'Verificar decisões históricas',
    })
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-1',
      agent: 'alfa',
      summary: 'Primeira rodada',
      nextStep: 'Passar para beta',
      decisions: ['Usar node:sqlite nativo', 'Arquitetura monólito modular'],
    })
    store.saveCheckpoint(project.id, {
      expectedRevision: 1,
      idempotencyKey: 'cp-2',
      agent: 'beta',
      summary: 'Segunda rodada',
      nextStep: 'Revisar integração',
      decisions: ['Implementar busca literal parametrizada'],
    })

    const handoff = store.getHandoff(project.id)
    assert.equal(handoff.revision, 2)
    assert.ok(handoff.markdown.includes('[rev 1 por alfa] Usar node:sqlite nativo'))
    assert.ok(handoff.markdown.includes('[rev 1 por alfa] Arquitetura monólito modular'))
    assert.ok(handoff.markdown.includes('[rev 2 por beta] Implementar busca literal parametrizada'))
  })

  it('prioriza mensagens recentes quando há muitas mensagens', () => {
    const store = makeStore(() => T0)
    const project = store.createProject({
      name: 'Projeto com muitas mensagens',
      objective: 'Testar priorização de mensagens',
    })
    for (let i = 0; i < 35; i += 1) {
      store.postMessage(project.id, {
        from: 'alfa',
        to: 'beta',
        kind: 'note',
        body: `MENSAGEM-ITEM-${i}`,
      })
    }
    const handoff = store.getHandoff(project.id, { maxChars: 20000 })
    // Mensagens mais recentes (últimas 25) devem estar presentes
    assert.ok(handoff.markdown.includes('MENSAGEM-ITEM-34'))
    assert.ok(handoff.markdown.includes('MENSAGEM-ITEM-33'))
    assert.ok(handoff.markdown.includes('MENSAGEM-ITEM-20'))
  })

  it('marca lease expirada com relógio injetado', () => {
    let now = T0
    const store = makeStore(() => now)
    const project = store.createProject({ name: 'P', objective: 'O' })
    const task = store.createTask(project.id, { title: 'Tarefa com lease' })
    store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0, leaseSeconds: 30 })
    now = new Date(T0.getTime() + 31_000)
    const handoff = store.getHandoff(project.id)
    assert.match(handoff.markdown, /expirado/)
    assert.ok(handoff.markdown.includes('Tarefa com lease'))
  })

  it('404 para projeto inexistente', () => {
    const store = makeStore()
    expectDomain(() => store.getHandoff(randomUUID()), 404, 'not_found')
  })
})
