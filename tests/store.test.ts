import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import type { CheckpointInput } from '../shared/types.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const T0 = new Date('2026-09-14T15:00:00.000Z')

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

function expectDomain(fn: () => unknown, status: number, code: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof DomainError, `esperado DomainError, recebido ${String(err)}`)
    assert.equal(err.status, status)
    assert.equal(err.code, code)
    return true
  })
}

function makeStore(now?: () => Date): { store: WorkspaceStore; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'axon-store-'))
  const dbPath = join(dir, 'workspace.sqlite')
  const store = new WorkspaceStore(dbPath, now ? { now } : undefined)
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* já fechado no próprio teste */
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return { store, dbPath }
}

function makeTwo(now?: () => Date): { a: WorkspaceStore; b: WorkspaceStore; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'axon-store-'))
  const dbPath = join(dir, 'workspace.sqlite')
  const opts = now ? { now } : undefined
  const a = new WorkspaceStore(dbPath, opts)
  const b = new WorkspaceStore(dbPath, opts)
  cleanups.push(() => {
    try {
      a.close()
    } catch {
      /* já fechado */
    }
    try {
      b.close()
    } catch {
      /* já fechado */
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return { a, b, dbPath }
}

function reopen(dbPath: string, now?: () => Date): WorkspaceStore {
  const store = new WorkspaceStore(dbPath, now ? { now } : undefined)
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* já fechado */
    }
  })
  return store
}

function seed(store: WorkspaceStore, name = 'Núcleo transacional') {
  const project = store.createProject({
    name,
    objective: 'Preservar estado verificável entre sessões',
  })
  const task = store.createTask(project.id, { title: 'Implementar store' })
  return { project, task }
}

function baseCheckpoint(over: Partial<CheckpointInput> = {}): CheckpointInput {
  return {
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
    agent: 'alfa',
    summary: 'Avanço registrado',
    nextStep: 'Seguir o contrato',
    ...over,
  }
}

describe('WorkspaceStore', () => {
  describe('projetos e persistência', () => {
    it('lista vazio e cria projeto com ids opacos e revisão 0', () => {
      const { store } = makeStore(() => T0)
      assert.deepEqual(store.listProjects(), [])
      const project = store.createProject({
        name: '  AXON  ',
        objective: '  Continuidade entre IAs  ',
        workspacePath: '  D:\\projetos\\axon  ',
      })
      assert.match(project.id, UUID_RE)
      assert.equal(project.name, 'AXON')
      assert.equal(project.objective, 'Continuidade entre IAs')
      assert.equal(project.workspacePath, 'D:\\projetos\\axon')
      assert.equal(project.revision, 0)
      assert.equal(project.createdAt, T0.toISOString())
      assert.equal(project.updatedAt, T0.toISOString())
      assert.equal(store.listProjects().length, 1)
    })

    it('omite workspacePath quando não enviado', () => {
      const { store } = makeStore()
      const project = store.createProject({ name: 'P', objective: 'O' })
      assert.equal(project.workspacePath, '')
    })

    it('ignora id e revisão enviados pelo cliente na criação', () => {
      const { store } = makeStore()
      const forged = randomUUID()
      const project = store.createProject({
        name: 'P',
        objective: 'O',
        id: forged,
        revision: 99,
      } as CreateForged)
      assert.notEqual(project.id, forged)
      assert.equal(project.revision, 0)
    })

    it('preserva projeto, tarefa, checkpoint e mensagem ao reabrir o banco', () => {
      const { store, dbPath } = makeStore(() => T0)
      const { project, task } = seed(store)
      const claimed = store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      const checkpoint = store.saveCheckpoint(
        project.id,
        baseCheckpoint({
          expectedRevision: 0,
          idempotencyKey: 'marco-1',
          taskId: task.id,
          blockers: ['quota'],
          decisions: ['SQLite embutido'],
          evidence: [{ command: 'npx test', outcome: 'passed', details: 'relato' }],
        }),
      )
      const message = store.postMessage(project.id, {
        from: 'alfa',
        to: 'astra',
        kind: 'handoff',
        body: 'Estado gravado no banco',
      })
      store.close()

      const again = reopen(dbPath, () => T0)
      const listed = again.listProjects()
      assert.equal(listed.length, 1)
      assert.equal(listed[0]?.id, project.id)
      const detail = again.getProject(project.id)
      assert.equal(detail.project.name, 'Núcleo transacional')
      assert.equal(detail.project.revision, 1)
      assert.equal(detail.tasks.length, 1)
      assert.equal(detail.tasks[0]?.id, task.id)
      assert.equal(detail.tasks[0]?.status, 'in_progress')
      assert.equal(detail.tasks[0]?.assignee, 'alfa')
      assert.equal(detail.tasks[0]?.version, claimed.version)
      assert.equal(detail.checkpoints.length, 1)
      assert.equal(detail.checkpoints[0]?.id, checkpoint.id)
      assert.equal(detail.checkpoints[0]?.revision, 1)
      assert.equal(detail.checkpoints[0]?.evidence[0]?.provenance, 'agent_report')
      assert.equal(detail.messages.length, 1)
      assert.equal(detail.messages[0]?.id, message.id)
      assert.equal(detail.messages[0]?.body, 'Estado gravado no banco')
    })

    it('getProject 404 para id inexistente e snapshot inclui coleções', () => {
      const { store } = makeStore()
      const { project, task } = seed(store)
      store.postMessage(project.id, { from: 'a', to: 'b', kind: 'note', body: 'olá' })
      const detail = store.getProject(project.id)
      assert.equal(detail.project.id, project.id)
      assert.equal(detail.tasks[0]?.id, task.id)
      assert.equal(detail.checkpoints.length, 0)
      assert.equal(detail.messages.length, 1)
      expectDomain(() => store.getProject(randomUUID()), 404, 'not_found')
    })

    it('exportProject devolve snapshot consistente idêntico a getProject', () => {
      const { store } = makeStore()
      const { project, task } = seed(store)
      store.postMessage(project.id, { from: 'a', to: 'b', kind: 'note', body: 'olá' })
      const exp = store.exportProject(project.id)
      const get = store.getProject(project.id)
      assert.deepEqual(exp, get)
    })
  })

  describe('tarefas, lease e CAS', () => {
    it('cria tarefa todo com versão 0 e não altera revisão do projeto', () => {
      const { store } = makeStore()
      const { project, task } = seed(store)
      assert.match(task.id, UUID_RE)
      assert.equal(task.projectId, project.id)
      assert.equal(task.status, 'todo')
      assert.equal(task.assignee, null)
      assert.equal(task.leaseUntil, null)
      assert.equal(task.version, 0)
      assert.equal(store.getProject(project.id).project.revision, 0)
    })

    it('claim usa lease padrão de 900s, muda para in_progress e incrementa versão', () => {
      const { store } = makeStore(() => T0)
      const { project, task } = seed(store)
      const claimed = store.claimTask(project.id, task.id, { agent: '  alfa  ', expectedVersion: 0 })
      assert.equal(claimed.status, 'in_progress')
      assert.equal(claimed.assignee, 'alfa')
      assert.equal(claimed.version, 1)
      assert.equal(claimed.leaseUntil, new Date(T0.getTime() + 900_000).toISOString())
    })

    it('mesmo agente renova o lease apresentando a versão atual', () => {
      let now = T0
      const { store } = makeStore(() => now)
      const { project, task } = seed(store)
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0, leaseSeconds: 30 })
      now = new Date(T0.getTime() + 10_000)
      const renewed = store.claimTask(project.id, task.id, {
        agent: 'alfa',
        expectedVersion: 1,
        leaseSeconds: 60,
      })
      assert.equal(renewed.version, 2)
      assert.equal(renewed.assignee, 'alfa')
      assert.equal(renewed.status, 'in_progress')
      assert.equal(renewed.leaseUntil, new Date(now.getTime() + 60_000).toISOString())
    })

    it('dois handles: exatamente um vence o claim na mesma versão', () => {
      const { a, b } = makeTwo(() => T0)
      const { project, task } = seed(a)
      const winner = a.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      assert.equal(winner.assignee, 'alfa')
      assert.equal(winner.version, 1)
      expectDomain(
        () => b.claimTask(project.id, task.id, { agent: 'beta', expectedVersion: 0 }),
        409,
        'version_conflict',
      )
      expectDomain(
        () => b.claimTask(project.id, task.id, { agent: 'beta', expectedVersion: 1 }),
        409,
        'lease_held',
      )
      const seen = b.getProject(project.id).tasks[0]
      assert.equal(seen?.assignee, 'alfa')
      assert.equal(seen?.version, 1)
    })

    it('lease expirada permite takeover com relógio injetado; dono antigo não escreve', () => {
      let now = T0
      const { a, b } = makeTwo(() => now)
      const { project, task } = seed(a)
      a.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0, leaseSeconds: 30 })
      const note = a.saveCheckpoint(
        project.id,
        baseCheckpoint({
          expectedRevision: 0,
          idempotencyKey: 'durante-lease',
          taskId: task.id,
          agent: 'alfa',
        }),
      )
      assert.equal(note.revision, 1)

      now = new Date(T0.getTime() + 31_000)
      expectDomain(
        () => b.claimTask(project.id, task.id, { agent: 'beta', expectedVersion: 0 }),
        409,
        'version_conflict',
      )
      const taken = b.claimTask(project.id, task.id, { agent: 'beta', expectedVersion: 1 })
      assert.equal(taken.assignee, 'beta')
      assert.equal(taken.version, 2)
      assert.equal(taken.status, 'in_progress')

      expectDomain(
        () =>
          a.saveCheckpoint(
            project.id,
            baseCheckpoint({
              expectedRevision: 1,
              idempotencyKey: 'depois-takeover',
              taskId: task.id,
              agent: 'alfa',
            }),
          ),
        409,
        'lease_required',
      )
      expectDomain(
        () => a.releaseTask(project.id, task.id, { agent: 'alfa', expectedVersion: 1 }),
        409,
        'version_conflict',
      )
      expectDomain(
        () => a.releaseTask(project.id, task.id, { agent: 'alfa', expectedVersion: 2 }),
        409,
        'lease_inactive',
      )
      expectDomain(
        () => a.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 2 }),
        409,
        'lease_held',
      )
      const still = b.getProject(project.id)
      assert.equal(still.tasks[0]?.assignee, 'beta')
      assert.equal(still.checkpoints.length, 1)
    })

    it('release exige dono com lease ativo e volta a todo', () => {
      const { store } = makeStore(() => T0)
      const { project, task } = seed(store)
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      expectDomain(
        () => store.releaseTask(project.id, task.id, { agent: 'beta', expectedVersion: 1 }),
        409,
        'lease_inactive',
      )
      const released = store.releaseTask(project.id, task.id, { agent: 'alfa', expectedVersion: 1 })
      assert.equal(released.status, 'todo')
      assert.equal(released.assignee, null)
      assert.equal(released.leaseUntil, null)
      assert.equal(released.version, 2)
    })

    it('release após expiração é rejeitado', () => {
      let now = T0
      const { store } = makeStore(() => now)
      const { project, task } = seed(store)
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0, leaseSeconds: 30 })
      now = new Date(T0.getTime() + 31_000)
      expectDomain(
        () => store.releaseTask(project.id, task.id, { agent: 'alfa', expectedVersion: 1 }),
        409,
        'lease_inactive',
      )
    })
  })

  describe('checkpoints, revisão e idempotência', () => {
    it('checkpoint atômico incrementa revisão e força provenance agent_report', () => {
      const { store } = makeStore(() => T0)
      const { project, task } = seed(store)
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      const input = {
        expectedRevision: 0,
        idempotencyKey: 'k-ev',
        taskId: task.id,
        agent: 'alfa',
        summary: 'Testes escritos',
        nextStep: 'Implementar',
        evidence: [
          {
            command: 'npx test',
            outcome: 'passed' as const,
            details: 'saída capturada',
            provenance: 'verified',
          },
        ],
      }
      const saved = store.saveCheckpoint(project.id, input as CheckpointInput)
      assert.match(saved.id, UUID_RE)
      assert.equal(saved.revision, 1)
      assert.equal(saved.taskId, task.id)
      assert.equal(saved.evidence[0]?.provenance, 'agent_report')
      assert.equal(store.getProject(project.id).project.revision, 1)
    })

    it('nota geral do projeto não exige tarefa nem lease', () => {
      const { store } = makeStore()
      const { project } = seed(store)
      const saved = store.saveCheckpoint(
        project.id,
        baseCheckpoint({ summary: 'Nota', nextStep: 'Abrir tarefa' }),
      )
      assert.equal(saved.taskId, null)
      assert.equal(saved.revision, 1)
    })

    it('revisão antiga não sobrescreve; dois handles preservam um único checkpoint', () => {
      const { a, b } = makeTwo()
      const { project } = seed(a)
      const first = a.saveCheckpoint(project.id, baseCheckpoint({ idempotencyKey: 'um' }))
      expectDomain(
        () =>
          b.saveCheckpoint(
            project.id,
            baseCheckpoint({ expectedRevision: 0, idempotencyKey: 'dois', summary: 'Outro' }),
          ),
        409,
        'revision_conflict',
      )
      const detail = b.getProject(project.id)
      assert.equal(detail.project.revision, 1)
      assert.equal(detail.checkpoints.length, 1)
      assert.equal(detail.checkpoints[0]?.id, first.id)
    })

    it('mesma chave e payload igual (ordem de chaves diferente) devolve o original mesmo com revisão antiga', () => {
      const { store } = makeStore()
      const { project } = seed(store)
      const first = store.saveCheckpoint(project.id, {
        expectedRevision: 0,
        idempotencyKey: 'idem-1',
        agent: 'alfa',
        summary: 'Payload estável',
        nextStep: 'Continuar',
        blockers: ['b1'],
        decisions: ['d1'],
        evidence: [{ outcome: 'failed', command: 'npx test', details: 'red' }],
      })
      const replay = store.saveCheckpoint(project.id, {
        nextStep: 'Continuar',
        evidence: [{ details: 'red', outcome: 'failed', command: 'npx test' }],
        summary: 'Payload estável',
        agent: 'alfa',
        blockers: ['b1'],
        expectedRevision: 0,
        decisions: ['d1'],
        idempotencyKey: 'idem-1',
      })
      assert.equal(replay.id, first.id)
      assert.equal(replay.revision, 1)
      assert.equal(store.getProject(project.id).project.revision, 1)
      assert.equal(store.getProject(project.id).checkpoints.length, 1)
    })

    it('campos extras não entram na idempotência nem concedem permissão', () => {
      const { store } = makeStore()
      const { project } = seed(store)
      const first = store.saveCheckpoint(project.id, {
        ...baseCheckpoint({ idempotencyKey: 'extra' }),
        extraField: 'um',
        verified: true,
      } as CheckpointInput & { extraField: string; verified: boolean })
      const replay = store.saveCheckpoint(project.id, {
        ...baseCheckpoint({
          expectedRevision: 0,
          idempotencyKey: 'extra',
        }),
        extraField: 'outro',
        verified: false,
      } as CheckpointInput & { extraField: string; verified: boolean })
      assert.equal(replay.id, first.id)
    })

    it('mesma chave com payload divergente conflita e não grava', () => {
      const { store } = makeStore()
      const { project } = seed(store)
      store.saveCheckpoint(project.id, baseCheckpoint({ idempotencyKey: 'dup', summary: 'A' }))
      expectDomain(
        () =>
          store.saveCheckpoint(
            project.id,
            baseCheckpoint({ expectedRevision: 1, idempotencyKey: 'dup', summary: 'B' }),
          ),
        409,
        'idempotency_conflict',
      )
      assert.equal(store.getProject(project.id).checkpoints.length, 1)
      assert.equal(store.getProject(project.id).project.revision, 1)
    })

    it('checkpoint com taskId exige dono e lease ativo', () => {
      const { store } = makeStore(() => T0)
      const { project, task } = seed(store)
      expectDomain(
        () =>
          store.saveCheckpoint(
            project.id,
            baseCheckpoint({ taskId: task.id, agent: 'alfa', idempotencyKey: 'sem-lease' }),
          ),
        409,
        'lease_required',
      )
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      expectDomain(
        () =>
          store.saveCheckpoint(
            project.id,
            baseCheckpoint({ taskId: task.id, agent: 'beta', idempotencyKey: 'outro' }),
          ),
        409,
        'lease_required',
      )
    })
  })

  describe('isolamento e mensagens', () => {
    it('projeto A não aceita taskId de B', () => {
      const { store } = makeStore()
      const a = seed(store, 'Proj A')
      const b = seed(store, 'Proj B')
      store.claimTask(b.project.id, b.task.id, { agent: 'alfa', expectedVersion: 0 })
      expectDomain(
        () => store.claimTask(a.project.id, b.task.id, { agent: 'alfa', expectedVersion: 0 }),
        404,
        'not_found',
      )
      expectDomain(
        () => store.releaseTask(a.project.id, b.task.id, { agent: 'alfa', expectedVersion: 1 }),
        404,
        'not_found',
      )
      expectDomain(
        () =>
          store.saveCheckpoint(
            a.project.id,
            baseCheckpoint({ taskId: b.task.id, agent: 'alfa', idempotencyKey: 'cruzado' }),
          ),
        404,
        'not_found',
      )
    })

    it('idempotencyKey é escopada ao projeto', () => {
      const { store } = makeStore()
      const a = store.createProject({ name: 'A', objective: 'oa' })
      const b = store.createProject({ name: 'B', objective: 'ob' })
      const ca = store.saveCheckpoint(a.id, baseCheckpoint({ idempotencyKey: 'mesma' }))
      const cb = store.saveCheckpoint(b.id, baseCheckpoint({ idempotencyKey: 'mesma' }))
      assert.notEqual(ca.id, cb.id)
      assert.equal(store.getProject(a.id).checkpoints.length, 1)
      assert.equal(store.getProject(b.id).checkpoints.length, 1)
    })

    it('mensagem persiste após reabrir e rejeita projeto ausente', () => {
      const { store, dbPath } = makeStore(() => T0)
      const { project } = seed(store)
      const msg = store.postMessage(project.id, {
        from: 'alfa',
        to: 'beta',
        kind: 'question',
        body: 'Qual o próximo passo?',
      })
      assert.match(msg.id, UUID_RE)
      assert.equal(msg.projectId, project.id)
      assert.equal(msg.createdAt, T0.toISOString())
      store.close()
      const again = reopen(dbPath)
      assert.equal(again.getProject(project.id).messages[0]?.body, 'Qual o próximo passo?')
      expectDomain(
        () =>
          again.postMessage(randomUUID(), {
            from: 'a',
            to: 'b',
            kind: 'note',
            body: 'x',
          }),
        404,
        'not_found',
      )
    })
  })

  describe('validação robusta', () => {
    it('rejeita textos obrigatórios vazios, só espaço ou longos demais', () => {
      const { store } = makeStore()
      expectDomain(() => store.createProject({ name: '  ', objective: 'obj' }), 400, 'invalid_input')
      expectDomain(() => store.createProject({ name: 'n', objective: '' }), 400, 'invalid_input')
      expectDomain(
        () => store.createProject({ name: 'n'.repeat(201), objective: 'obj' }),
        400,
        'invalid_input',
      )
      expectDomain(
        () => store.createProject({ name: 'n', objective: 'o'.repeat(8001) }),
        400,
        'invalid_input',
      )
      const { project, task } = seed(store)
      expectDomain(() => store.createTask(project.id, { title: '   ' }), 400, 'invalid_input')
      expectDomain(
        () => store.claimTask(project.id, task.id, { agent: '', expectedVersion: 0 }),
        400,
        'invalid_input',
      )
      expectDomain(
        () =>
          store.saveCheckpoint(project.id, {
            expectedRevision: 0,
            idempotencyKey: '  ',
            agent: 'alfa',
            summary: 's',
            nextStep: 'n',
          }),
        400,
        'invalid_input',
      )
      expectDomain(
        () =>
          store.postMessage(project.id, { from: 'a', to: 'b', kind: 'note', body: '  ' }),
        400,
        'invalid_input',
      )
    })

    it('rejeita IDs malformados, tipos inválidos, enums e limites de lease/revisão', () => {
      const { store } = makeStore()
      const { project, task } = seed(store)
      expectDomain(() => store.getProject('nao-uuid'), 400, 'invalid_input')
      expectDomain(() => store.getProject(''), 400, 'invalid_input')
      expectDomain(
        () => store.claimTask(project.id, 'abc', { agent: 'alfa', expectedVersion: 0 }),
        400,
        'invalid_input',
      )
      expectDomain(
        () => store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0.5 }),
        400,
        'invalid_input',
      )
      expectDomain(
        () => store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: -1 }),
        400,
        'invalid_input',
      )
      expectDomain(
        () =>
          store.claimTask(project.id, task.id, {
            agent: 'alfa',
            expectedVersion: 0,
            leaseSeconds: 29,
          }),
        400,
        'invalid_input',
      )
      expectDomain(
        () =>
          store.claimTask(project.id, task.id, {
            agent: 'alfa',
            expectedVersion: 0,
            leaseSeconds: 3601,
          }),
        400,
        'invalid_input',
      )
      expectDomain(
        () =>
          store.saveCheckpoint(project.id, {
            expectedRevision: 1.2,
            idempotencyKey: 'k',
            agent: 'alfa',
            summary: 's',
            nextStep: 'n',
          }),
        400,
        'invalid_input',
      )
      expectDomain(
        () =>
          store.postMessage(project.id, { from: 'a', to: 'b', kind: 'alert' as 'note', body: 'x' }),
        400,
        'invalid_input',
      )
      expectDomain(
        () =>
          store.saveCheckpoint(project.id, {
            expectedRevision: 0,
            idempotencyKey: 'ev',
            agent: 'alfa',
            summary: 's',
            nextStep: 'n',
            evidence: [{ command: 'c', outcome: 'flaky' as 'passed', details: 'd' }],
          }),
        400,
        'invalid_input',
      )
      expectDomain(() => store.getHandoff(project.id, { maxChars: 1999 }), 400, 'invalid_input')
      expectDomain(() => store.getHandoff(project.id, { maxChars: 100001 }), 400, 'invalid_input')
    })

    it('não interpreta SQL no nome do projeto', () => {
      const { store } = makeStore()
      const name = "Robert'); DROP TABLE projects;--"
      const project = store.createProject({ name, objective: 'isolamento' })
      assert.equal(project.name, name)
      assert.equal(store.listProjects().length, 1)
      assert.equal(store.getProject(project.id).project.name, name)
    })
  })
})

type CreateForged = { name: string; objective: string; id: string; revision: number }
