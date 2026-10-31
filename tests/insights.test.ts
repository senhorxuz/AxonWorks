import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, it } from 'node:test'
import { WorkspaceStore } from '../server/store.ts'
import { computeInsights } from '../server/insights/index.ts'
import type { Checkpoint, Task } from '../shared/types.ts'

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

const T0 = new Date('2026-09-15T08:00:00.000Z')

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

function makeStore(now: () => Date): { store: WorkspaceStore; workspaceDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'axon-insights-'))
  const dbPath = join(dir, 'workspace.sqlite')
  const workspaceDir = join(dir, 'workspace')
  mkdirSync(workspaceDir, { recursive: true })
  const store = new WorkspaceStore(dbPath, { now })
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* já fechado no próprio teste */
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return { store, workspaceDir }
}

function writeWorkspaceFile(workspaceDir: string, relPath: string, content: string): void {
  const full = join(workspaceDir, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
}

/** Reivindica e conclui a tarefa (taskTransition declare_done), devolvendo a tarefa e o checkpoint gerados. */
function claimAndComplete(
  store: WorkspaceStore,
  projectId: string,
  taskId: string,
  agent: string,
  idempotencyKey: string,
  evidence?: Array<{
    command: string
    outcome: 'passed' | 'failed' | 'not_run'
    details: string
    artifacts?: Array<{ path: string; sha256: string; sizeBytes?: number }>
  }>,
): { task: Task; checkpoint: Checkpoint } {
  const before = store.getProject(projectId).tasks.find((t) => t.id === taskId)!
  store.claimTask(projectId, taskId, { agent, expectedVersion: before.version })
  const revisionNow = store.getProject(projectId).project.revision
  const result = store.finalizeWork(projectId, {
    agent,
    expectedRevision: revisionNow,
    idempotencyKey,
    summary: `Concluí ${before.title}`,
    nextStep: 'Nenhum',
    taskId,
    evidence: evidence ?? [],
    taskTransition: { kind: 'declare_done' },
  })
  return { task: result.task!, checkpoint: result.checkpoint }
}

describe('nextActions: dependência recém-concluída libera a tarefa', () => {
  it('sugere iniciar a tarefa dependente quando a dependência foi concluída dentro da janela recente', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Fluxo', objective: 'Testar liberação por dependência' })
    const dep = store.createTask(project.id, { title: 'Preparar ambiente' })
    const dependent = store.createTask(project.id, {
      title: 'Rodar migração',
      dependencyTaskIds: [dep.id],
    })

    claimAndComplete(store, project.id, dep.id, 'Grok', 'cp-dep-done')

    now = new Date(T0.getTime() + 60 * 60 * 1000) // 1h depois
    const insights = computeInsights(store, project.id, { now })

    const found = insights.nextActions.find(
      (a) => a.kind === 'dependency_unblocked' && a.taskId === dependent.id,
    )
    assert.ok(found, 'deveria sugerir iniciar a tarefa liberada pela dependência')
    assert.match(found!.reason, /Preparar ambiente/)
    assert.equal(found!.sourceType, 'checkpoint')
  })

  it('NÃO sugere quando a conclusão da dependência já passou da janela recente', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Fluxo velho', objective: 'Testar janela' })
    const dep = store.createTask(project.id, { title: 'Preparar ambiente' })
    const dependent = store.createTask(project.id, {
      title: 'Rodar migração',
      dependencyTaskIds: [dep.id],
    })
    claimAndComplete(store, project.id, dep.id, 'Grok', 'cp-dep-done-old')

    now = new Date(T0.getTime() + 25 * 60 * 60 * 1000) // 25h depois, além da janela de 24h
    const insights = computeInsights(store, project.id, { now })
    const found = insights.nextActions.find(
      (a) => a.kind === 'dependency_unblocked' && a.taskId === dependent.id,
    )
    assert.equal(found, undefined, 'depois de 24h a liberação deixa de ser novidade acionável')
  })

  it('NÃO sugere quando a tarefa dependente já foi reivindicada por alguém', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Fluxo já assumido', objective: 'Testar janela' })
    const dep = store.createTask(project.id, { title: 'Preparar ambiente' })
    const dependent = store.createTask(project.id, {
      title: 'Rodar migração',
      dependencyTaskIds: [dep.id],
    })
    claimAndComplete(store, project.id, dep.id, 'Grok', 'cp-dep-done-claimed')
    store.claimTask(project.id, dependent.id, { agent: 'Astra', expectedVersion: dependent.version })

    now = new Date(T0.getTime() + 60 * 60 * 1000)
    const insights = computeInsights(store, project.id, { now })
    const found = insights.nextActions.find(
      (a) => a.kind === 'dependency_unblocked' && a.taskId === dependent.id,
    )
    assert.equal(found, undefined, 'a tarefa já tem quem cuide dela; sugerir de novo seria ruído')
  })
})

describe('nextActions: evidência desatualizada em tarefa concluída', () => {
  it('sinaliza quando o arquivo declarado mudou depois do checkpoint de conclusão', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Evidência',
      objective: 'Testar frescor',
      workspacePath: workspaceDir,
    })
    const task = store.createTask(project.id, { title: 'Implementar parser' })
    writeWorkspaceFile(workspaceDir, 'server/parser.ts', 'versao 1')
    const hash = sha256('versao 1')
    claimAndComplete(store, project.id, task.id, 'Grok', 'cp-parser-done', [
      {
        command: 'npm test',
        outcome: 'passed',
        details: 'ok',
        artifacts: [{ path: 'server/parser.ts', sha256: hash }],
      },
    ])
    // o arquivo muda depois do registro — a evidência deixa de cobrir a versão atual
    writeWorkspaceFile(workspaceDir, 'server/parser.ts', 'versao 2, mudou depois do registro')

    const insights = computeInsights(store, project.id, { now: T0 })
    const found = insights.nextActions.find(
      (a) => a.kind === 'stale_evidence_on_done_task' && a.taskId === task.id,
    )
    assert.ok(found, 'deveria sinalizar que a evidência não cobre mais o código atual')
    assert.equal(found!.sourceType, 'evidence')
    // motivo em português simples: sem jargão, sem "(s)" de plural, sem repetir a mesma ideia duas
    // vezes (a explicação completa da evidência não é colada aqui — ela já tem seu próprio prefixo
    // fixo, ver server/store.ts), e com o nome do arquivo no fim da frase, entre parênteses
    assert.equal(
      found!.reason,
      '"Implementar parser" foi dada como concluída, mas o comando "npm test" não confirma mais isso: o arquivo declarado mudou depois da medição (server/parser.ts).',
    )
    assert.doesNotMatch(found!.reason, /\(s\)/)
    assert.doesNotMatch(found!.reason, /artefato/)
    assert.doesNotMatch(found!.reason, /`/, 'a tela mostra reason como texto puro; crase apareceria literalmente')
  })

  it('duas evidências desatualizadas na mesma tarefa: plural correto no motivo', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Evidência plural',
      objective: 'Testar plural no motivo da evidência',
      workspacePath: workspaceDir,
    })
    const task = store.createTask(project.id, { title: 'Implementar módulo' })
    writeWorkspaceFile(workspaceDir, 'server/a.ts', 'versao 1')
    writeWorkspaceFile(workspaceDir, 'server/b.ts', 'versao 1')
    const hashA = sha256('versao 1')
    const hashB = sha256('versao 1')
    claimAndComplete(store, project.id, task.id, 'Grok', 'cp-module-done', [
      {
        command: 'npm test',
        outcome: 'passed',
        details: 'ok',
        artifacts: [
          { path: 'server/a.ts', sha256: hashA },
          { path: 'server/b.ts', sha256: hashB },
        ],
      },
    ])
    writeWorkspaceFile(workspaceDir, 'server/a.ts', 'versao 2')
    writeWorkspaceFile(workspaceDir, 'server/b.ts', 'versao 2')

    const insights = computeInsights(store, project.id, { now: T0 })
    const found = insights.nextActions.find(
      (a) => a.kind === 'stale_evidence_on_done_task' && a.taskId === task.id,
    )
    assert.ok(found)
    assert.equal(
      found!.reason,
      '"Implementar módulo" foi dada como concluída, mas o comando "npm test" não confirma mais isso: os arquivos declarados mudaram depois da medição (server/a.ts, server/b.ts).',
    )
    assert.doesNotMatch(found!.reason, /`/)
  })

  it('NÃO sinaliza quando a evidência continua cobrindo a versão atual do arquivo', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Evidência fresca',
      objective: 'Testar frescor',
      workspacePath: workspaceDir,
    })
    const task = store.createTask(project.id, { title: 'Implementar parser' })
    writeWorkspaceFile(workspaceDir, 'server/parser.ts', 'versao 1')
    const hash = sha256('versao 1')
    claimAndComplete(store, project.id, task.id, 'Grok', 'cp-parser-done-fresh', [
      {
        command: 'npm test',
        outcome: 'passed',
        details: 'ok',
        artifacts: [{ path: 'server/parser.ts', sha256: hash }],
      },
    ])

    const insights = computeInsights(store, project.id, { now: T0 })
    const found = insights.nextActions.find(
      (a) => a.kind === 'stale_evidence_on_done_task' && a.taskId === task.id,
    )
    assert.equal(found, undefined, 'arquivo intacto: a evidência ainda cobre a versão atual')
  })
})

describe('nextActions: passagem endereçada e ainda não lida', () => {
  it('sinaliza quando a passagem tem destinatário específico e ninguém confirmou leitura', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Passagem', objective: 'Testar leitura' })
    const task = store.createTask(project.id, { title: 'Migrar dados' })
    const { checkpoint } = claimAndComplete(store, project.id, task.id, 'Grok', 'cp-handoff-1')
    store.createHandoffDelivery(project.id, {
      checkpointId: checkpoint.id,
      from: 'Grok',
      to: 'Astra',
      message: 'Confira a migração antes de seguir.',
    })

    const insights = computeInsights(store, project.id, { now: T0 })
    const found = insights.nextActions.find((a) => a.kind === 'unread_handoff')
    assert.ok(found, 'deveria sinalizar a passagem não lida')
    assert.match(found!.reason, /Astra/)
    assert.equal(found!.sourceType, 'handoff_delivery')
  })

  it('NÃO sinaliza depois que o destinatário confirma a leitura', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Passagem lida', objective: 'Testar leitura' })
    const task = store.createTask(project.id, { title: 'Migrar dados' })
    const { checkpoint } = claimAndComplete(store, project.id, task.id, 'Grok', 'cp-handoff-2')
    const delivery = store.createHandoffDelivery(project.id, {
      checkpointId: checkpoint.id,
      from: 'Grok',
      to: 'Astra',
      message: 'Confira a migração antes de seguir.',
    })
    store.acknowledgeHandoffDelivery(project.id, delivery.id, { agent: 'Astra' })

    const insights = computeInsights(store, project.id, { now: T0 })
    const found = insights.nextActions.find((a) => a.kind === 'unread_handoff')
    assert.equal(found, undefined, 'já foi lida; não deve continuar aparecendo como pendente')
  })
})

describe('nextActions: pergunta ou revisão sem desfecho há muito tempo', () => {
  it('sinaliza pergunta sem desfecho depois de passar a tolerância de atenção', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Pergunta', objective: 'Testar desfecho' })
    store.postMessage(project.id, {
      from: 'Grok',
      to: 'Astra',
      kind: 'question',
      body: 'Uso SQLite ou Postgres no MCP novo?',
    })

    now = new Date(T0.getTime() + 7 * 60 * 60 * 1000) // 7h depois
    const insights = computeInsights(store, project.id, { now })
    const found = insights.nextActions.find((a) => a.kind === 'stale_question_or_review')
    assert.ok(found, 'pergunta parada há 7h deveria aparecer')
    assert.equal(found!.sourceType, 'message')
  })

  it('NÃO sinaliza pergunta recente, ainda dentro da tolerância', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Pergunta recente', objective: 'Testar desfecho' })
    store.postMessage(project.id, {
      from: 'Grok',
      to: 'Astra',
      kind: 'question',
      body: 'Uso SQLite ou Postgres no MCP novo?',
    })

    now = new Date(T0.getTime() + 60 * 60 * 1000) // 1h depois: normal ainda não ter resposta
    const insights = computeInsights(store, project.id, { now })
    const found = insights.nextActions.find((a) => a.kind === 'stale_question_or_review')
    assert.equal(found, undefined)
  })

  it('NÃO sinaliza pergunta já resolvida, mesmo depois de muito tempo', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Pergunta resolvida', objective: 'Testar desfecho' })
    const message = store.postMessage(project.id, {
      from: 'Grok',
      to: 'Astra',
      kind: 'review',
      body: 'Pode revisar o schema novo?',
    })
    store.resolveMessageAttention(project.id, message.id, { agent: 'Astra', note: 'Revisado, ok.' })

    now = new Date(T0.getTime() + 7 * 60 * 60 * 1000)
    const insights = computeInsights(store, project.id, { now })
    const found = insights.nextActions.find((a) => a.kind === 'stale_question_or_review')
    assert.equal(found, undefined)
  })
})

describe('nextActions: bloqueio aberto em tarefa urgente', () => {
  it('sinaliza quando existe bloqueio aberto vinculado a tarefa de prioridade urgente', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Bloqueio urgente', objective: 'Testar prioridade' })
    const task = store.createTask(project.id, { title: 'Corrigir vazamento de dados', priority: 'urgent' })
    const blocker = store.openBlocker(project.id, {
      agent: 'Astra',
      title: 'Falta credencial de produção',
      body: 'Sem acesso ao ambiente para aplicar a correção.',
      taskId: task.id,
    })

    const insights = computeInsights(store, project.id, { now: T0 })
    const found = insights.nextActions.find(
      (a) => a.kind === 'urgent_task_blocked' && a.taskId === task.id,
    )
    assert.ok(found)
    assert.equal(found!.sourceId, blocker.id)
  })

  it('NÃO sinaliza quando a tarefa bloqueada não é urgente', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Bloqueio comum', objective: 'Testar prioridade' })
    const task = store.createTask(project.id, { title: 'Ajustar layout', priority: 'medium' })
    store.openBlocker(project.id, {
      agent: 'Astra',
      title: 'Aguardando definição visual',
      body: 'Falta aprovação do design.',
      taskId: task.id,
    })

    const insights = computeInsights(store, project.id, { now: T0 })
    const found = insights.nextActions.find(
      (a) => a.kind === 'urgent_task_blocked' && a.taskId === task.id,
    )
    assert.equal(found, undefined)
  })

  it('NÃO sinaliza quando o bloqueio já foi resolvido', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Bloqueio resolvido', objective: 'Testar prioridade' })
    const task = store.createTask(project.id, { title: 'Corrigir vazamento de dados', priority: 'urgent' })
    const blocker = store.openBlocker(project.id, {
      agent: 'Astra',
      title: 'Falta credencial de produção',
      body: 'Sem acesso ao ambiente para aplicar a correção.',
      taskId: task.id,
    })
    store.resolveBlocker(project.id, blocker.id, {
      agent: 'Astra',
      expectedVersion: blocker.version,
      note: 'Credencial liberada.',
    })

    const insights = computeInsights(store, project.id, { now: T0 })
    const found = insights.nextActions.find(
      (a) => a.kind === 'urgent_task_blocked' && a.taskId === task.id,
    )
    assert.equal(found, undefined)
  })
})

describe('nextActions: tarefa reaberta repetidas vezes', () => {
  it('sinaliza retrabalho quando a tarefa foi reaberta duas vezes ou mais', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Retrabalho', objective: 'Testar reabertura' })
    const task = store.createTask(project.id, { title: 'Corrigir bug de datas' })

    // ciclo 1: assume, bloqueia, reabre
    store.claimTask(project.id, task.id, { agent: 'Grok', expectedVersion: task.version })
    let revision = store.getProject(project.id).project.revision
    let result = store.finalizeWork(project.id, {
      agent: 'Grok',
      expectedRevision: revision,
      idempotencyKey: 'cp-rework-block',
      summary: 'Travou por falta de acesso',
      nextStep: 'Aguardar acesso',
      taskId: task.id,
      taskTransition: { kind: 'declare_blocked', reason: 'Falta acesso ao ambiente' },
    })
    let current = result.task!
    current = store.reopenTask(project.id, task.id, {
      agent: 'Grok',
      expectedVersion: current.version,
      note: 'Acesso liberado, retomando.',
    })

    // ciclo 2: assume, conclui, reabre de novo (o bug voltou)
    store.claimTask(project.id, task.id, { agent: 'Grok', expectedVersion: current.version })
    revision = store.getProject(project.id).project.revision
    result = store.finalizeWork(project.id, {
      agent: 'Grok',
      expectedRevision: revision,
      idempotencyKey: 'cp-rework-done',
      summary: 'Corrigi a data',
      nextStep: '-',
      taskId: task.id,
      taskTransition: { kind: 'declare_done' },
    })
    current = result.task!
    store.reopenTask(project.id, task.id, {
      agent: 'Astra',
      expectedVersion: current.version,
      note: 'O bug voltou em produção, reabrindo.',
    })

    const insights = computeInsights(store, project.id, { now: T0 })
    const found = insights.nextActions.find(
      (a) => a.kind === 'repeated_reopen' && a.taskId === task.id,
    )
    assert.ok(found, 'duas reaberturas indicam retrabalho')
    assert.equal(found!.sourceType, 'task_event')
  })

  it('NÃO sinaliza quando a tarefa foi reaberta apenas uma vez', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Reabertura única', objective: 'Testar reabertura' })
    const task = store.createTask(project.id, { title: 'Corrigir bug de datas' })

    store.claimTask(project.id, task.id, { agent: 'Grok', expectedVersion: task.version })
    const revision = store.getProject(project.id).project.revision
    const result = store.finalizeWork(project.id, {
      agent: 'Grok',
      expectedRevision: revision,
      idempotencyKey: 'cp-single-reopen',
      summary: 'Travou por falta de acesso',
      nextStep: 'Aguardar acesso',
      taskId: task.id,
      taskTransition: { kind: 'declare_blocked', reason: 'Falta acesso ao ambiente' },
    })
    store.reopenTask(project.id, task.id, {
      agent: 'Grok',
      expectedVersion: result.task!.version,
      note: 'Acesso liberado, retomando.',
    })

    const insights = computeInsights(store, project.id, { now: T0 })
    const found = insights.nextActions.find(
      (a) => a.kind === 'repeated_reopen' && a.taskId === task.id,
    )
    assert.equal(found, undefined, 'uma única reabertura é ajuste pontual, não retrabalho')
  })
})

describe('stalledTasks: IA sumida', () => {
  it('lista tarefa com reserva vencida e nenhum registro daquela identidade nela', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Sumida', objective: 'Testar lease vencido' })
    const task = store.createTask(project.id, { title: 'Escrever migração' })
    store.claimTask(project.id, task.id, { agent: 'Gemini', expectedVersion: task.version, leaseSeconds: 900 })

    now = new Date(T0.getTime() + 900 * 1000 + 6 * 60 * 1000) // vencido há 6min, além da tolerância de 5min
    const insights = computeInsights(store, project.id, { now })
    const found = insights.stalledTasks.find((s) => s.taskId === task.id)
    assert.ok(found)
    assert.equal(found!.assignee, 'Gemini')
  })

  it('NÃO lista quando a identidade deixou algum checkpoint na tarefa', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Sumida com registro', objective: 'Testar lease vencido' })
    const task = store.createTask(project.id, { title: 'Escrever migração' })
    store.claimTask(project.id, task.id, { agent: 'Gemini', expectedVersion: task.version, leaseSeconds: 900 })
    const revision = store.getProject(project.id).project.revision
    store.saveCheckpoint(project.id, {
      expectedRevision: revision,
      idempotencyKey: 'cp-still-working',
      agent: 'Gemini',
      summary: 'Ainda trabalhando na migração',
      nextStep: 'Continuar',
      taskId: task.id,
    })

    now = new Date(T0.getTime() + 900 * 1000 + 6 * 60 * 1000)
    const insights = computeInsights(store, project.id, { now })
    const found = insights.stalledTasks.find((s) => s.taskId === task.id)
    assert.equal(found, undefined, 'há registro dessa identidade na tarefa; ela não está sumida, só atrasada')
  })

  it('NÃO lista quando o vencimento ainda está dentro da tolerância de graça', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Dentro da graça', objective: 'Testar lease vencido' })
    const task = store.createTask(project.id, { title: 'Escrever migração' })
    store.claimTask(project.id, task.id, { agent: 'Gemini', expectedVersion: task.version, leaseSeconds: 900 })

    now = new Date(T0.getTime() + 900 * 1000 + 2 * 60 * 1000) // vencido há só 2min
    const insights = computeInsights(store, project.id, { now })
    const found = insights.stalledTasks.find((s) => s.taskId === task.id)
    assert.equal(found, undefined)
  })
})

describe('signals', () => {
  it('seis sinais no singular: português simples, sem jargão e sem parênteses de plural', () => {
    let now = T0
    const { store, workspaceDir } = makeStore(() => now)
    const project = store.createProject({
      name: 'Sinais',
      objective: 'Testar contagens',
      workspacePath: workspaceDir,
    })

    store.openBlocker(project.id, {
      agent: 'Astra',
      title: 'Falta decisão de arquitetura',
      body: 'Não sabemos qual fila usar.',
    })

    const taskBlocked = store.createTask(project.id, { title: 'Emitir relatório' })
    store.claimTask(project.id, taskBlocked.id, { agent: 'Grok', expectedVersion: taskBlocked.version })
    let revision = store.getProject(project.id).project.revision
    store.finalizeWork(project.id, {
      agent: 'Grok',
      expectedRevision: revision,
      idempotencyKey: 'cp-signal-blocked',
      summary: 'Travei',
      nextStep: 'Aguardar decisão',
      taskId: taskBlocked.id,
      taskTransition: { kind: 'declare_blocked', reason: 'Falta decisão de arquitetura' },
    })

    // única tarefa concluída sem critério marcado desta cena — as demais, criadas abaixo para
    // outros sinais, já nascem com o critério marcado para não contaminar esta contagem
    const taskDone = store.createTask(project.id, {
      title: 'Gerar export',
      acceptanceCriteria: [{ description: 'Exportar CSV válido' }],
    })
    claimAndComplete(store, project.id, taskDone.id, 'Grok', 'cp-signal-done-no-criteria')

    const taskStaleEvidence = store.createTask(project.id, {
      title: 'Implementar parser',
      acceptanceCriteria: [{ description: 'Critério', completed: true }],
    })
    writeWorkspaceFile(workspaceDir, 'server/parser.ts', 'versao 1')
    const hash = sha256('versao 1')
    claimAndComplete(store, project.id, taskStaleEvidence.id, 'Grok', 'cp-signal-stale-evidence', [
      { command: 'npm test', outcome: 'passed', details: 'ok', artifacts: [{ path: 'server/parser.ts', sha256: hash }] },
    ])
    writeWorkspaceFile(workspaceDir, 'server/parser.ts', 'versao 2')

    const taskHandoff = store.createTask(project.id, {
      title: 'Publicar changelog',
      acceptanceCriteria: [{ description: 'Critério', completed: true }],
    })
    const { checkpoint: handoffCheckpoint } = claimAndComplete(store, project.id, taskHandoff.id, 'Grok', 'cp-signal-handoff')
    store.createHandoffDelivery(project.id, {
      checkpointId: handoffCheckpoint.id,
      from: 'Grok',
      to: 'Astra',
      message: 'Confira o changelog.',
    })

    store.postMessage(project.id, { from: 'Gemini', to: 'Astra', kind: 'question', body: 'Uso SQLite ou Postgres?' })

    now = new Date(T0.getTime() + 7 * 60 * 60 * 1000) // além da tolerância de atenção de 6h
    const insights = computeInsights(store, project.id, { now })

    assert.equal(insights.signals.openBlockers.count, 1)
    assert.equal(insights.signals.openBlockers.reason, '1 bloqueio aberto aguardando resolução.')
    assert.equal(insights.signals.blockedTasks.count, 1)
    assert.equal(insights.signals.blockedTasks.reason, '1 tarefa está com status bloqueado.')
    assert.equal(insights.signals.doneTasksWithoutMarkedCriteria.count, 1)
    assert.equal(
      insights.signals.doneTasksWithoutMarkedCriteria.reason,
      '1 tarefa concluída não tem nenhum critério de aceite marcado.',
    )
    assert.equal(insights.signals.staleEvidenceOnDoneTasks.count, 1)
    assert.equal(
      insights.signals.staleEvidenceOnDoneTasks.reason,
      '1 tarefa concluída tem evidência que não cobre mais a versão atual do código.',
    )
    assert.equal(insights.signals.unreadHandoffs.count, 1)
    assert.equal(
      insights.signals.unreadHandoffs.reason,
      '1 passagem com destinatário específico ainda não foi confirmada como lida.',
    )
    assert.equal(insights.signals.staleQuestionsAndReviews.count, 1)
    assert.equal(
      insights.signals.staleQuestionsAndReviews.reason,
      '1 mensagem de pergunta ou revisão segue sem desfecho há mais de 6 horas.',
    )

    for (const signal of Object.values(insights.signals)) {
      assert.doesNotMatch(signal.reason, /\(s\)/, `sem parênteses de plural em: ${signal.reason}`)
      assert.doesNotMatch(signal.reason, /artefato/, `sem jargão "artefato" em: ${signal.reason}`)
    }
  })

  it('seis sinais no plural: concordância verbal e nominal correta com dois ou mais itens', () => {
    let now = T0
    const { store, workspaceDir } = makeStore(() => now)
    const project = store.createProject({
      name: 'Sinais plural',
      objective: 'Testar contagens no plural',
      workspacePath: workspaceDir,
    })

    store.openBlocker(project.id, { agent: 'Astra', title: 'Falta decisão A', body: 'Motivo A.' })
    store.openBlocker(project.id, { agent: 'Astra', title: 'Falta decisão B', body: 'Motivo B.' })

    for (const [i, title] of ['Emitir relatório A', 'Emitir relatório B'].entries()) {
      const task = store.createTask(project.id, { title })
      store.claimTask(project.id, task.id, { agent: 'Grok', expectedVersion: task.version })
      const revision = store.getProject(project.id).project.revision
      store.finalizeWork(project.id, {
        agent: 'Grok',
        expectedRevision: revision,
        idempotencyKey: `cp-plural-blocked-${i}`,
        summary: 'Travei',
        nextStep: 'Aguardar',
        taskId: task.id,
        taskTransition: { kind: 'declare_blocked', reason: 'Motivo' },
      })
    }

    for (const [i, title] of ['Gerar export A', 'Gerar export B'].entries()) {
      const task = store.createTask(project.id, {
        title,
        acceptanceCriteria: [{ description: 'Critério' }],
      })
      claimAndComplete(store, project.id, task.id, 'Grok', `cp-plural-done-${i}`)
    }

    for (const [i, file] of ['server/a.ts', 'server/b.ts'].entries()) {
      const task = store.createTask(project.id, {
        title: `Implementar ${file}`,
        acceptanceCriteria: [{ description: 'Critério', completed: true }],
      })
      writeWorkspaceFile(workspaceDir, file, 'versao 1')
      const hash = sha256('versao 1')
      claimAndComplete(store, project.id, task.id, 'Grok', `cp-plural-stale-${i}`, [
        { command: 'npm test', outcome: 'passed', details: 'ok', artifacts: [{ path: file, sha256: hash }] },
      ])
      writeWorkspaceFile(workspaceDir, file, 'versao 2')
    }

    for (const [i, to] of ['Astra', 'Gemini'].entries()) {
      const task = store.createTask(project.id, {
        title: `Publicar changelog ${i}`,
        acceptanceCriteria: [{ description: 'Critério', completed: true }],
      })
      const { checkpoint } = claimAndComplete(store, project.id, task.id, 'Grok', `cp-plural-handoff-${i}`)
      store.createHandoffDelivery(project.id, { checkpointId: checkpoint.id, from: 'Grok', to, message: 'Confira.' })
    }

    store.postMessage(project.id, { from: 'Gemini', to: 'Astra', kind: 'question', body: 'Pergunta 1?' })
    store.postMessage(project.id, { from: 'Gemini', to: 'Grok', kind: 'review', body: 'Pode revisar isto?' })

    now = new Date(T0.getTime() + 7 * 60 * 60 * 1000)
    const insights = computeInsights(store, project.id, { now })

    assert.equal(insights.signals.openBlockers.count, 2)
    assert.equal(insights.signals.openBlockers.reason, '2 bloqueios abertos aguardando resolução.')
    assert.equal(insights.signals.blockedTasks.count, 2)
    assert.equal(insights.signals.blockedTasks.reason, '2 tarefas estão com status bloqueado.')
    assert.equal(insights.signals.doneTasksWithoutMarkedCriteria.count, 2)
    assert.equal(
      insights.signals.doneTasksWithoutMarkedCriteria.reason,
      '2 tarefas concluídas não têm nenhum critério de aceite marcado.',
    )
    assert.equal(insights.signals.staleEvidenceOnDoneTasks.count, 2)
    assert.equal(
      insights.signals.staleEvidenceOnDoneTasks.reason,
      '2 tarefas concluídas têm evidência que não cobre mais a versão atual do código.',
    )
    assert.equal(insights.signals.unreadHandoffs.count, 2)
    assert.equal(
      insights.signals.unreadHandoffs.reason,
      '2 passagens com destinatário específico ainda não foram confirmadas como lidas.',
    )
    assert.equal(insights.signals.staleQuestionsAndReviews.count, 2)
    assert.equal(
      insights.signals.staleQuestionsAndReviews.reason,
      '2 mensagens de pergunta ou revisão seguem sem desfecho há mais de 6 horas.',
    )
  })

  it('NÃO conta tarefa concluída cujo critério de aceite foi marcado antes da entrega', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Sinais negativos', objective: 'Testar contagens' })
    const task = store.createTask(project.id, {
      title: 'Gerar export',
      acceptanceCriteria: [{ description: 'Exportar CSV válido' }],
    })
    store.updateTaskContract(project.id, task.id, {
      expectedVersion: task.version,
      acceptanceCriteria: [
        { id: task.acceptanceCriteria![0]!.id, description: 'Exportar CSV válido', completed: true },
      ],
    })
    claimAndComplete(store, project.id, task.id, 'Grok', 'cp-signal-done-with-criteria')

    const insights = computeInsights(store, project.id, { now: T0 })
    assert.equal(insights.signals.doneTasksWithoutMarkedCriteria.count, 0)
  })
})

describe('momentum: tarefas concluídas e checkpoints recentes', () => {
  it('conta apenas o que aconteceu dentro de cada janela', () => {
    let now = new Date('2026-09-05T08:00:00.000Z')
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Janela', objective: 'Testar janelas de momentum' })

    const veryOldTask = store.createTask(project.id, { title: 'Tarefa muito antiga' })
    claimAndComplete(store, project.id, veryOldTask.id, 'Grok', 'cp-very-old-done') // 10 dias antes do "agora"

    now = new Date('2026-09-12T08:00:00.000Z') // 3 dias antes
    const oldTask = store.createTask(project.id, { title: 'Tarefa antiga' })
    claimAndComplete(store, project.id, oldTask.id, 'Grok', 'cp-old-done')

    now = new Date('2026-09-15T06:00:00.000Z') // 2 horas antes
    const recentTask = store.createTask(project.id, { title: 'Tarefa recente' })
    claimAndComplete(store, project.id, recentTask.id, 'Grok', 'cp-recent-done')

    const insights = computeInsights(store, project.id, { now: new Date('2026-09-15T08:00:00.000Z') })
    assert.equal(insights.momentum.tasksCompletedLast24h, 1)
    assert.equal(insights.momentum.tasksCompletedLast7d, 2)
    assert.equal(insights.momentum.checkpointsLast24h, 1, 'só o checkpoint da tarefa recente caiu dentro de 24h')
  })
})

describe('momentum: sequência de dias com registro', () => {
  it('conta dias consecutivos terminando no dia mais recente com checkpoint', () => {
    let now = new Date('2026-09-08T09:00:00.000Z')
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Sequência', objective: 'Testar streak' })

    for (const [i, day] of ['2026-09-08', '2026-09-09', '2026-09-10'].entries()) {
      now = new Date(`${day}T09:00:00.000Z`)
      const revision = store.getProject(project.id).project.revision
      store.saveCheckpoint(project.id, {
        expectedRevision: revision,
        idempotencyKey: `cp-streak-${i}`,
        agent: 'Grok',
        summary: `Registro do dia ${day}`,
        nextStep: 'Continuar',
      })
    }

    const insights = computeInsights(store, project.id, { now: new Date('2026-09-10T12:00:00.000Z') })
    assert.equal(insights.momentum.streakDays, 3)
    assert.equal(insights.momentum.streakEndsOn, '2026-09-10')
  })

  it('quebra a sequência quando falta um dia', () => {
    let now = new Date('2026-09-08T09:00:00.000Z')
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Sequência quebrada', objective: 'Testar streak quebrado' })

    let revision = store.getProject(project.id).project.revision
    store.saveCheckpoint(project.id, {
      expectedRevision: revision,
      idempotencyKey: 'cp-gap-1',
      agent: 'Grok',
      summary: 'Dia 8',
      nextStep: 'Continuar',
    })

    // pula 09/09 — sem nenhum registro
    now = new Date('2026-09-10T09:00:00.000Z')
    revision = store.getProject(project.id).project.revision
    store.saveCheckpoint(project.id, {
      expectedRevision: revision,
      idempotencyKey: 'cp-gap-2',
      agent: 'Grok',
      summary: 'Dia 10',
      nextStep: 'Continuar',
    })

    const insights = computeInsights(store, project.id, { now: new Date('2026-09-10T12:00:00.000Z') })
    assert.equal(insights.momentum.streakDays, 1, 'só o dia 10 conta; o dia 9 ficou sem registro')
    assert.equal(insights.momentum.streakEndsOn, '2026-09-10')
  })
})

describe('agentActivity', () => {
  it('resume por identidade: último checkpoint, tarefas concluídas e passagens enviadas — sem julgamento', () => {
    let now = T0
    const { store } = makeStore(() => now)
    const project = store.createProject({ name: 'Atividade', objective: 'Testar por identidade' })

    const task1 = store.createTask(project.id, { title: 'Tarefa 1' })
    const { checkpoint: cp1 } = claimAndComplete(store, project.id, task1.id, 'Grok', 'cp-ag-1')
    store.createHandoffDelivery(project.id, {
      checkpointId: cp1.id,
      from: 'Grok',
      to: 'Astra',
      message: 'Feito.',
    })

    now = new Date(T0.getTime() + 60 * 60 * 1000)
    const task2 = store.createTask(project.id, { title: 'Tarefa 2' })
    store.claimTask(project.id, task2.id, { agent: 'Astra', expectedVersion: task2.version })
    const revision2 = store.getProject(project.id).project.revision
    store.saveCheckpoint(project.id, {
      expectedRevision: revision2,
      idempotencyKey: 'cp-ag-2',
      agent: 'Astra',
      summary: 'Trabalhando na tarefa 2',
      nextStep: 'Seguir',
      taskId: task2.id,
    })

    const insights = computeInsights(store, project.id, { now })
    const grok = insights.agentActivity.find((a) => a.agent === 'Grok')!
    const astra = insights.agentActivity.find((a) => a.agent === 'Astra')!
    assert.ok(grok, 'Grok deveria aparecer na atividade por identidade')
    assert.ok(astra, 'Astra deveria aparecer na atividade por identidade')
    assert.equal(grok.tasksCompleted, 1)
    assert.equal(grok.handoffsSent, 1)
    assert.equal(grok.lastCheckpointAt, cp1.createdAt)
    assert.equal(astra.tasksCompleted, 0)
    assert.equal(astra.handoffsSent, 0)
    assert.ok(astra.lastCheckpointAt)
  })
})
