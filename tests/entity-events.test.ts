import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { afterEach, describe, it } from 'node:test'
import { DomainError, WorkspaceStore } from '../server/store.ts'

const T0 = new Date('2026-09-15T10:00:00.000Z')

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
  const dir = mkdtempSync(join(tmpdir(), 'axon-entity-events-'))
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

describe('linha do tempo de bloqueios', () => {
  it('grava evento append-only em cada transição com fromStatus, toStatus, ator, nota e versão resultante', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Bloqueios', objective: 'Testar linha do tempo' })
    const blocker = store.openBlocker(project.id, { agent: 'Astra', title: 'Falta ambiente', body: 'Sem acesso ao servidor' })

    const mitigated = store.mitigateBlocker(project.id, blocker.id, {
      agent: 'Grok',
      expectedVersion: blocker.version,
      note: 'Workaround temporário aplicado',
    })
    const resolved = store.resolveBlocker(project.id, blocker.id, {
      agent: 'Grok',
      expectedVersion: mitigated.version,
      note: 'Ambiente liberado',
    })
    const reopened = store.reopenBlocker(project.id, blocker.id, {
      agent: 'Astra',
      expectedVersion: resolved.version,
      note: 'Voltou a falhar',
    })
    store.acceptBlockerRisk(project.id, blocker.id, {
      agent: 'Astra',
      expectedVersion: reopened.version,
      note: 'Aceitamos o risco por ora',
    })

    const timeline = store.getBlockerTimeline(project.id, blocker.id)
    assert.equal(timeline.entityId, blocker.id)
    assert.equal(timeline.projectId, project.id)
    assert.equal(timeline.events.length, 5)

    const [opened, mit, res, reo, risk] = timeline.events

    assert.equal(opened?.transition, 'opened')
    assert.equal(opened?.fromStatus, null)
    assert.equal(opened?.toStatus, 'open')
    assert.equal(opened?.actor, 'Astra')
    assert.equal(opened?.version, 0)

    assert.equal(mit?.transition, 'mitigated')
    assert.equal(mit?.fromStatus, 'open')
    assert.equal(mit?.toStatus, 'mitigated')
    assert.equal(mit?.actor, 'Grok')
    assert.equal(mit?.note, 'Workaround temporário aplicado')
    assert.equal(mit?.version, 1)

    assert.equal(res?.transition, 'resolved')
    assert.equal(res?.fromStatus, 'mitigated')
    assert.equal(res?.toStatus, 'resolved')
    assert.equal(res?.note, 'Ambiente liberado')
    assert.equal(res?.version, 2)

    assert.equal(reo?.transition, 'reopened')
    assert.equal(reo?.fromStatus, 'resolved')
    assert.equal(reo?.toStatus, 'open')
    assert.equal(reo?.note, 'Voltou a falhar')
    assert.equal(reo?.version, 3)

    assert.equal(risk?.transition, 'accepted_risk')
    assert.equal(risk?.fromStatus, 'open')
    assert.equal(risk?.toStatus, 'accepted_risk')
    assert.equal(risk?.note, 'Aceitamos o risco por ora')
    assert.equal(risk?.version, 4)

    for (const ev of timeline.events) {
      assert.equal(typeof ev.createdAt, 'string')
      assert.equal(ev.projectId, project.id)
      assert.equal(ev.blockerId, blocker.id)
    }
  })

  it('reabrir não apaga a resolução anterior: ela continua na linha do tempo', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Reabertura', objective: 'Testar preservação de histórico' })
    const blocker = store.openBlocker(project.id, { agent: 'Astra', title: 'Falha X', body: 'Descrição Y' })
    const resolved = store.resolveBlocker(project.id, blocker.id, {
      agent: 'Astra',
      expectedVersion: blocker.version,
      note: 'Resolvido com patch A',
    })
    const afterReopen = store.reopenBlocker(project.id, blocker.id, {
      agent: 'Astra',
      expectedVersion: resolved.version,
      note: 'Quebrou de novo',
    })

    // retrato atual reseta (comportamento correto e já existente: é o "estado atual", não histórico)
    assert.equal(afterReopen.status, 'open')
    assert.equal(afterReopen.resolution, null)
    assert.equal(afterReopen.resolvedBy, null)
    assert.equal(afterReopen.resolvedAt, null)

    // a linha do tempo preserva a resolução anterior intacta, sem sobrescrever
    const timeline = store.getBlockerTimeline(project.id, blocker.id)
    const resolvedEvent = timeline.events.find((e) => e.transition === 'resolved')
    assert.ok(resolvedEvent)
    assert.equal(resolvedEvent?.note, 'Resolvido com patch A')
    assert.equal(resolvedEvent?.toStatus, 'resolved')

    const reopenedEvent = timeline.events.find((e) => e.transition === 'reopened')
    assert.ok(reopenedEvent)
    assert.equal(reopenedEvent?.note, 'Quebrou de novo')
    assert.equal(reopenedEvent?.fromStatus, 'resolved')
  })
})

describe('linha do tempo de decisões', () => {
  it('grava evento em proposta, aceite e revogação; nota de revogação não sobrescreve Decision.source', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Decisões', objective: 'Testar linha do tempo' })
    const proposed = store.proposeDecision(project.id, {
      agent: 'Astra',
      title: 'Usar SQLite',
      body: 'Persistência local',
      note: 'Motivo original da proposta',
    })
    const accepted = store.acceptDecision(project.id, proposed.id, { actor: 'Grok', expectedVersion: proposed.version })
    const revoked = store.revokeDecision(project.id, proposed.id, {
      actor: 'Astra',
      expectedVersion: accepted.version,
      note: 'Motivo da revogação, não é a origem',
    })

    // a origem da proposta não foi contaminada pela nota de revogação — este é o bug P1 corrigido
    assert.equal(revoked.source.note, 'Motivo original da proposta')
    assert.equal(revoked.source.kind, 'agent_proposal')

    const timeline = store.getDecisionTimeline(project.id, proposed.id)
    assert.equal(timeline.entityId, proposed.id)
    assert.equal(timeline.events.length, 3)
    const [prop, acc, rev] = timeline.events

    assert.equal(prop?.transition, 'proposed')
    assert.equal(prop?.fromStatus, null)
    assert.equal(prop?.toStatus, 'proposed')
    assert.equal(prop?.actor, 'Astra')
    assert.equal(prop?.note, 'Motivo original da proposta')
    assert.equal(prop?.version, 0)

    assert.equal(acc?.transition, 'accepted')
    assert.equal(acc?.fromStatus, 'proposed')
    assert.equal(acc?.toStatus, 'accepted')
    assert.equal(acc?.actor, 'Grok')
    assert.equal(acc?.version, 1)

    assert.equal(rev?.transition, 'revoked')
    assert.equal(rev?.fromStatus, 'accepted')
    assert.equal(rev?.toStatus, 'revoked')
    assert.equal(rev?.actor, 'Astra')
    assert.equal(rev?.note, 'Motivo da revogação, não é a origem')
    assert.equal(rev?.version, 2)
  })

  it('supersede grava evento superseded na decisão antiga e replaced_by na nova', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Substituição', objective: 'Testar supersede' })
    const proposed = store.proposeDecision(project.id, { agent: 'Astra', title: 'V1', body: 'Corpo V1' })
    const accepted = store.acceptDecision(project.id, proposed.id, { actor: 'Grok', expectedVersion: proposed.version })
    const superseded = store.supersedeDecision(project.id, proposed.id, {
      actor: 'Astra',
      expectedVersion: accepted.version,
      title: 'V2',
      body: 'Corpo V2',
      note: 'V2 corrige limitação de V1',
    })

    const oldTimeline = store.getDecisionTimeline(project.id, proposed.id)
    const supersededEvent = oldTimeline.events.find((e) => e.transition === 'superseded')
    assert.ok(supersededEvent)
    assert.equal(supersededEvent?.fromStatus, 'accepted')
    assert.equal(supersededEvent?.toStatus, 'superseded')
    assert.equal(supersededEvent?.relatedDecisionId, superseded.id)
    assert.equal(supersededEvent?.note, 'V2 corrige limitação de V1')
    assert.equal(supersededEvent?.version, 2)

    const newTimeline = store.getDecisionTimeline(project.id, superseded.id)
    const replacedEvent = newTimeline.events.find((e) => e.transition === 'replaced_by')
    assert.ok(replacedEvent)
    assert.equal(replacedEvent?.fromStatus, null)
    assert.equal(replacedEvent?.toStatus, 'accepted')
    assert.equal(replacedEvent?.relatedDecisionId, proposed.id)
    assert.equal(replacedEvent?.version, 0)
  })
})

describe('isolamento entre projetos nas linhas do tempo', () => {
  it('getBlockerTimeline e getDecisionTimeline respeitam o projeto', () => {
    const { store } = makeStore(() => T0)
    const projectA = store.createProject({ name: 'A', objective: 'Isolamento A' })
    const projectB = store.createProject({ name: 'B', objective: 'Isolamento B' })
    const blocker = store.openBlocker(projectA.id, { agent: 'Astra', title: 'X', body: 'Y' })
    const decision = store.proposeDecision(projectA.id, { agent: 'Astra', title: 'X', body: 'Y' })

    expectDomain(() => store.getBlockerTimeline(projectB.id, blocker.id), 404, 'not_found')
    expectDomain(() => store.getDecisionTimeline(projectB.id, decision.id), 404, 'not_found')

    // no próprio projeto continua acessível
    assert.equal(store.getBlockerTimeline(projectA.id, blocker.id).events.length, 1)
    assert.equal(store.getDecisionTimeline(projectA.id, decision.id).events.length, 1)
  })
})

describe('imutabilidade e exclusão de projeto — eventos', () => {
  it('rejeita UPDATE em blocker_events e decision_events (BEFORE UPDATE)', () => {
    const { store, dbPath } = makeStore(() => T0)
    const project = store.createProject({ name: 'Imutável eventos', objective: 'Testar trigger' })
    const blocker = store.openBlocker(project.id, { agent: 'Astra', title: 'X', body: 'Y' })
    const decision = store.proposeDecision(project.id, { agent: 'Astra', title: 'X', body: 'Y' })
    store.close()

    const raw = new DatabaseSync(dbPath)
    try {
      assert.throws(() => raw.exec(`UPDATE blocker_events SET note = 'hackeado' WHERE blocker_id = '${blocker.id}'`))
      assert.throws(() => raw.exec(`UPDATE decision_events SET note = 'hackeado' WHERE decision_id = '${decision.id}'`))
    } finally {
      raw.close()
    }
  })

  it('deleteProject remove blocker_events e decision_events sem quebrar (filhos antes dos pais)', () => {
    const { store, dbPath } = makeStore(() => T0)
    const project = store.createProject({ name: 'Apagar eventos', objective: 'Testar exclusão em cascata' })
    const blocker = store.openBlocker(project.id, { agent: 'Astra', title: 'X', body: 'Y' })
    const decision = store.proposeDecision(project.id, { agent: 'Astra', title: 'X', body: 'Y' })

    const deleted = store.deleteProject(project.id, 'Apagar eventos')
    assert.equal(deleted.projectId, project.id)
    store.close()

    const raw = new DatabaseSync(dbPath)
    try {
      const be = raw.prepare('SELECT COUNT(*) as n FROM blocker_events WHERE blocker_id = ?').get(blocker.id) as { n: number }
      const de = raw.prepare('SELECT COUNT(*) as n FROM decision_events WHERE decision_id = ?').get(decision.id) as { n: number }
      assert.equal(be.n, 0)
      assert.equal(de.n, 0)
    } finally {
      raw.close()
    }
  })
})
