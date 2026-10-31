import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { afterEach, describe, it } from 'node:test'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import { ArtifactHashCache } from '../server/store/artifact-hash-cache.ts'
import type { CheckpointInput } from '../shared/types.ts'
import type { FinalizeWorkInput } from '../shared/continuity.ts'

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

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function makeStore(now?: () => Date): { store: WorkspaceStore; dbPath: string; workspaceDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'axon-evidence-'))
  const dbPath = join(dir, 'workspace.sqlite')
  const workspaceDir = join(dir, 'workspace')
  mkdirSync(workspaceDir, { recursive: true })
  const store = new WorkspaceStore(dbPath, now ? { now } : undefined)
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* já fechado no próprio teste */
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return { store, dbPath, workspaceDir }
}

function writeWorkspaceFile(workspaceDir: string, relPath: string, content: string): string {
  const full = join(workspaceDir, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
  return sha256(content)
}

// Chamada de finalizeWork com artefatos: shared/continuity.ts ainda tipa FinalizeWorkInput.evidence
// como Omit<Evidence, 'provenance'>[] (não foi atualizado para EvidenceInput[] como shared/types.ts
// fez com CheckpointInput). O runtime aceita e persiste artifacts normalmente (validação passa por
// asRecord/unknown dentro de store.ts).
function finalizeWorkWithArtifacts(
  store: WorkspaceStore,
  projectId: string,
  body: Record<string, unknown>,
) {
  return store.finalizeWork(projectId, body as unknown as FinalizeWorkInput)
}

describe('saveCheckpoint — evidência normalizada e artefatos', () => {
  it('grava evidence_records e evidence_artifacts na mesma transação do checkpoint', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Núcleo',
      objective: 'Evidência verificável',
      workspacePath: workspaceDir,
    })
    const hash = writeWorkspaceFile(workspaceDir, 'server/store.ts', 'conteudo original')

    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-1',
      agent: 'Nucleo',
      summary: 'Implementei evidência',
      nextStep: 'Seguir',
      evidence: [
        {
          command: 'npm test',
          outcome: 'passed',
          details: '263/263 aprovados',
          artifacts: [{ path: 'server/store.ts', sha256: hash, sizeBytes: 17 }],
        },
      ],
    })

    const list = store.listEvidence(project.id, { checkpointId: checkpoint.id })
    assert.equal(list.length, 1)
    const ev = list[0]!
    assert.equal(ev.checkpointId, checkpoint.id)
    assert.equal(ev.position, 0)
    assert.equal(ev.command, 'npm test')
    assert.equal(ev.reportedBy, 'Nucleo')
    assert.equal(ev.provenance, 'agent_report')
    assert.equal(ev.artifacts.length, 1)
    assert.equal(ev.artifacts[0]?.path, 'server/store.ts')
    assert.equal(ev.artifacts[0]?.sha256, hash)
    assert.equal(ev.artifacts[0]?.freshness, 'covers_current')
    assert.equal(ev.freshness, 'covers_current')
    assert.deepEqual(ev.assertions, ['agent_reported', 'artifact_bound'])

    // o evidence_json do checkpoint permanece o original, sem artifacts
    const detail = store.getProject(project.id)
    assert.equal(detail.checkpoints[0]?.evidence[0]?.command, 'npm test')
    assert.equal((detail.checkpoints[0]?.evidence[0] as unknown as { artifacts?: unknown }).artifacts, undefined)
  })

  it('falha em qualquer parte não grava nada: caminhos de artefato duplicados na mesma evidência não deixam resíduo', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Atômico', objective: 'Testar rollback' })

    assert.throws(() =>
      store.saveCheckpoint(project.id, {
        expectedRevision: 0,
        idempotencyKey: 'cp-atomic',
        agent: 'Nucleo',
        summary: 'Tentativa',
        nextStep: 'Seguir',
        evidence: [
          {
            command: 'npm test',
            outcome: 'passed',
            details: '',
            artifacts: [
              { path: 'a.txt', sha256: 'a'.repeat(64) },
              { path: 'a.txt', sha256: 'b'.repeat(64) },
            ],
          },
        ],
      }),
    )

    const reloaded = store.getProject(project.id)
    assert.equal(reloaded.project.revision, 0)
    assert.equal(reloaded.checkpoints.length, 0)
    assert.equal(store.listEvidence(project.id, {}).length, 0)
  })
})

describe('idempotência com artefatos na carga canônica', () => {
  it('mesma idempotencyKey com artefatos diferentes gera conflito explícito, não retorna o checkpoint antigo em silêncio', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Canônico', objective: 'Testar idempotência' })

    const first = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'same-key',
      agent: 'Nucleo',
      summary: 'Primeira',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'a.txt', sha256: 'a'.repeat(64) }] }],
    })

    expectDomain(
      () =>
        store.saveCheckpoint(project.id, {
          expectedRevision: 0,
          idempotencyKey: 'same-key',
          agent: 'Nucleo',
          summary: 'Primeira',
          nextStep: 'Seguir',
          evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'a.txt', sha256: 'c'.repeat(64) }] }],
        }),
      409,
      'idempotency_conflict',
    )

    const detail = store.getProject(project.id)
    assert.equal(detail.checkpoints.length, 1)
    assert.equal(detail.checkpoints[0]?.id, first.id)
    const list = store.listEvidence(project.id, { checkpointId: first.id })
    assert.equal(list[0]?.artifacts[0]?.sha256, 'a'.repeat(64))
  })

  it('mesma idempotencyKey com o mesmo conteúdo (incluindo artefatos) é idempotente', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Canônico2', objective: 'Testar idempotência' })
    const input: CheckpointInput = {
      expectedRevision: 0,
      idempotencyKey: 'same-key-2',
      agent: 'Nucleo',
      summary: 'Primeira',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'a.txt', sha256: 'a'.repeat(64) }] }],
    }
    const first = store.saveCheckpoint(project.id, input)
    const second = store.saveCheckpoint(project.id, input)
    assert.equal(second.id, first.id)
    assert.equal(store.getProject(project.id).checkpoints.length, 1)
  })

  it('finalizeWork também rejeita mesma idempotencyKey com artefatos diferentes', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Finalização', objective: 'Testar idempotência em finalizeWork' })

    finalizeWorkWithArtifacts(store, project.id, {
      agent: 'Nucleo',
      expectedRevision: 0,
      idempotencyKey: 'fin-key',
      summary: 'Primeira',
      nextStep: 'Seguir',
      taskTransition: { kind: 'keep_claimed' },
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'a.txt', sha256: 'a'.repeat(64) }] }],
    })

    expectDomain(
      () =>
        finalizeWorkWithArtifacts(store, project.id, {
          agent: 'Nucleo',
          expectedRevision: 0,
          idempotencyKey: 'fin-key',
          summary: 'Primeira',
          nextStep: 'Seguir',
          taskTransition: { kind: 'keep_claimed' },
          evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'a.txt', sha256: 'f'.repeat(64) }] }],
        }),
      409,
      'idempotency_conflict',
    )

    assert.equal(store.getProject(project.id).checkpoints.length, 1)
  })

  it('finalizeWork grava evidence_records e evidence_artifacts como saveCheckpoint', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({ name: 'Finalização2', objective: 'Testar gravação', workspacePath: workspaceDir })
    const hash = writeWorkspaceFile(workspaceDir, 'a.txt', 'conteudo')

    const result = finalizeWorkWithArtifacts(store, project.id, {
      agent: 'Nucleo',
      expectedRevision: 0,
      idempotencyKey: 'fin-key-2',
      summary: 'Primeira',
      nextStep: 'Seguir',
      taskTransition: { kind: 'keep_claimed' },
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'a.txt', sha256: hash }] }],
    })

    const list = store.listEvidence(project.id, { checkpointId: result.checkpoint.id })
    assert.equal(list.length, 1)
    assert.equal(list[0]?.artifacts[0]?.freshness, 'covers_current')
  })
})

describe('frescor calculado na leitura', () => {
  it('cobre covers_current, stale, missing e no_artifacts dentro do mesmo projeto', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({ name: 'Frescor', objective: 'Testar frescor', workspacePath: workspaceDir })
    const freshHash = writeWorkspaceFile(workspaceDir, 'fresh.txt', 'conteudo A')
    const staleHash = writeWorkspaceFile(workspaceDir, 'stale.txt', 'conteudo B original')
    // missing.txt nunca é criado

    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-fresh',
      agent: 'Nucleo',
      summary: 'Medi tudo',
      nextStep: 'Seguir',
      evidence: [
        { command: 'a', outcome: 'passed', details: '', artifacts: [{ path: 'fresh.txt', sha256: freshHash }] },
        { command: 'b', outcome: 'passed', details: '', artifacts: [{ path: 'stale.txt', sha256: staleHash }] },
        { command: 'c', outcome: 'passed', details: '', artifacts: [{ path: 'missing.txt', sha256: 'a'.repeat(64) }] },
        { command: 'd', outcome: 'passed', details: '' },
      ],
    })

    // muda o conteúdo de stale.txt DEPOIS da medição
    writeWorkspaceFile(workspaceDir, 'stale.txt', 'conteudo B mudou')

    const list = store.listEvidence(project.id, { checkpointId: checkpoint.id })
    const byCommand = new Map(list.map((e) => [e.command, e]))

    assert.equal(byCommand.get('a')?.freshness, 'covers_current')
    assert.equal(byCommand.get('b')?.freshness, 'stale')
    assert.notEqual(byCommand.get('b')?.artifacts[0]?.currentSha256, staleHash)
    assert.equal(byCommand.get('c')?.freshness, 'missing')
    assert.equal(byCommand.get('d')?.freshness, 'no_artifacts')
    assert.deepEqual(byCommand.get('d')?.assertions, ['agent_reported'])

    for (const ev of list) {
      assert.ok(ev.explanation.length > 0, `explanation vazia para ${ev.command}`)
      for (const art of ev.artifacts) assert.ok(art.reason.length > 0, `reason vazia para ${art.path}`)
    }

    // staleOnly filtra só o que deixou de cobrir a versão atual
    const staleOnly = store.listEvidence(project.id, { checkpointId: checkpoint.id, staleOnly: true })
    assert.equal(staleOnly.length, 1)
    assert.equal(staleOnly[0]?.command, 'b')
  })

  it('projeto sem workspacePath cadastrado devolve unverifiable com motivo', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Sem pasta', objective: 'Testar unverifiable' })
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-no-ws',
      agent: 'Nucleo',
      summary: 'Sem pasta',
      nextStep: 'Seguir',
      evidence: [{ command: 'a', outcome: 'passed', details: '', artifacts: [{ path: 'qualquer.txt', sha256: 'a'.repeat(64) }] }],
    })
    const evidenceId = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!.id
    const ev = store.getEvidence(project.id, evidenceId)
    assert.equal(ev.freshness, 'unverifiable')
    assert.equal(ev.artifacts[0]?.freshness, 'unverifiable')
    assert.equal(ev.artifacts[0]?.currentSha256, null)
    assert.ok(ev.artifacts[0]?.reason.length > 0)
  })
})

describe('proteção de caminho — nunca lê fora da pasta cadastrada', () => {
  it('travessia de diretório e arquivo da blacklist devolvem unverifiable sem ler nada fora da raiz', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({ name: 'Traversal', objective: 'Testar escape', workspacePath: workspaceDir })

    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-traversal',
      agent: 'Nucleo',
      summary: 'Tentativa de escape',
      nextStep: 'Seguir',
      evidence: [
        { command: 'a', outcome: 'passed', details: '', artifacts: [{ path: '../fora-da-pasta.txt', sha256: 'a'.repeat(64) }] },
        { command: 'b', outcome: 'passed', details: '', artifacts: [{ path: '.env', sha256: 'a'.repeat(64) }] },
      ],
    })

    const list = store.listEvidence(project.id, { checkpointId: checkpoint.id })
    assert.equal(list.length, 2)
    for (const ev of list) {
      assert.equal(ev.freshness, 'unverifiable')
      assert.equal(ev.artifacts[0]?.currentSha256, null)
      assert.ok(ev.artifacts[0]?.reason.length > 0)
    }
  })
})

describe('crossCheckEvidence — conferência cruzada', () => {
  it('recusa auto-conferência com 409 self_verification_rejected', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Auto', objective: 'Testar auto-conferência' })
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-self',
      agent: 'Astra',
      summary: 'Relato',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '' }],
    })
    const evidenceId = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!.id

    expectDomain(
      () => store.crossCheckEvidence(project.id, evidenceId, { verifiedBy: 'Astra', note: 'Confiro meu próprio trabalho' }),
      409,
      'self_verification_rejected',
    )
  })

  it('aceita conferência de identidade diferente; é append-only e idempotente para o mesmo par (identidade, nota)', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Cruzada', objective: 'Testar conferência' })
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-cross',
      agent: 'Astra',
      summary: 'Relato',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '' }],
    })
    const evidenceId = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!.id

    const first = store.crossCheckEvidence(project.id, evidenceId, { verifiedBy: 'Grok', note: 'Confirmei rodando de novo' })
    assert.equal(first.verifications.length, 1)
    assert.ok(first.assertions.includes('cross_checked'))

    const repeat = store.crossCheckEvidence(project.id, evidenceId, { verifiedBy: 'Grok', note: 'Confirmei rodando de novo' })
    assert.equal(repeat.verifications.length, 1, 'mesmo par (identidade, nota) não deve duplicar')

    const second = store.crossCheckEvidence(project.id, evidenceId, { verifiedBy: 'Grok', note: 'Nova nota, nova conferência' })
    assert.equal(second.verifications.length, 2, 'nota diferente soma um novo registro, append-only')
    assert.equal(second.verifications[0]?.note, 'Confirmei rodando de novo')
    assert.equal(second.verifications[1]?.note, 'Nova nota, nova conferência')
  })
})

describe('registerEvidenceArtifacts', () => {
  it('acrescenta artefatos a uma evidência já gravada sem artefatos iniciais', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({ name: 'Registro', objective: 'Testar registro tardio', workspacePath: workspaceDir })
    const hash = writeWorkspaceFile(workspaceDir, 'depois.txt', 'conteudo tardio')
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-registro',
      agent: 'Astra',
      summary: 'Relato sem artefato inicial',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '' }],
    })
    const evidenceId = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!.id

    const updated = store.registerEvidenceArtifacts(project.id, evidenceId, {
      actor: 'Astra',
      artifacts: [{ path: 'depois.txt', sha256: hash }],
    })
    assert.equal(updated.artifacts.length, 1)
    assert.equal(updated.freshness, 'covers_current')
  })

  it('registrar o mesmo caminho com o mesmo sha256 é idempotente; com sha diferente dá conflito explícito', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Conflito', objective: 'Testar conflito de artefato' })
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-conflito',
      agent: 'Astra',
      summary: 'Relato',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '' }],
    })
    const evidenceId = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!.id

    store.registerEvidenceArtifacts(project.id, evidenceId, { actor: 'Astra', artifacts: [{ path: 'x.txt', sha256: 'a'.repeat(64) }] })
    const again = store.registerEvidenceArtifacts(project.id, evidenceId, { actor: 'Astra', artifacts: [{ path: 'x.txt', sha256: 'a'.repeat(64) }] })
    assert.equal(again.artifacts.length, 1)

    expectDomain(
      () => store.registerEvidenceArtifacts(project.id, evidenceId, { actor: 'Astra', artifacts: [{ path: 'x.txt', sha256: 'b'.repeat(64) }] }),
      409,
      'artifact_conflict',
    )
  })
})

describe('isolamento entre projetos', () => {
  it('getEvidence, listEvidence, registerEvidenceArtifacts e crossCheckEvidence respeitam o projeto', () => {
    const { store } = makeStore(() => T0)
    const projectA = store.createProject({ name: 'A', objective: 'Isolamento A' })
    const projectB = store.createProject({ name: 'B', objective: 'Isolamento B' })
    const checkpoint = store.saveCheckpoint(projectA.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-iso',
      agent: 'Astra',
      summary: 'Relato A',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '' }],
    })
    const evidenceId = store.listEvidence(projectA.id, { checkpointId: checkpoint.id })[0]!.id

    expectDomain(() => store.getEvidence(projectB.id, evidenceId), 404, 'not_found')
    assert.equal(store.listEvidence(projectB.id, {}).length, 0)
    expectDomain(
      () =>
        store.registerEvidenceArtifacts(projectB.id, evidenceId, {
          actor: 'Astra',
          artifacts: [{ path: 'x.txt', sha256: 'a'.repeat(64) }],
        }),
      404,
      'not_found',
    )
    expectDomain(
      () => store.crossCheckEvidence(projectB.id, evidenceId, { verifiedBy: 'Grok', note: 'nota' }),
      404,
      'not_found',
    )
  })
})

describe('imutabilidade e exclusão de projeto', () => {
  it('rejeita UPDATE em checkpoints, evidence_records, evidence_artifacts e evidence_verifications', () => {
    const { store, dbPath } = makeStore(() => T0)
    const project = store.createProject({ name: 'Imutável', objective: 'Testar trigger' })
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-imut',
      agent: 'Astra',
      summary: 'Relato',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'x.txt', sha256: 'a'.repeat(64) }] }],
    })
    const evidenceId = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!.id
    store.crossCheckEvidence(project.id, evidenceId, { verifiedBy: 'Grok', note: 'ok' })
    store.close()

    const raw = new DatabaseSync(dbPath)
    try {
      assert.throws(() => raw.exec(`UPDATE checkpoints SET summary = 'hackeado' WHERE id = '${checkpoint.id}'`))
      assert.throws(() => raw.exec(`UPDATE evidence_records SET command = 'hackeado' WHERE id = '${evidenceId}'`))
      assert.throws(() => raw.exec(`UPDATE evidence_artifacts SET sha256 = '${'f'.repeat(64)}' WHERE evidence_id = '${evidenceId}'`))
      assert.throws(() => raw.exec(`UPDATE evidence_verifications SET note = 'hackeado' WHERE evidence_id = '${evidenceId}'`))
    } finally {
      raw.close()
    }
  })

  it('deleteProject remove evidence_records, evidence_artifacts e evidence_verifications sem quebrar (filhos antes dos pais)', () => {
    const { store, dbPath } = makeStore(() => T0)
    const project = store.createProject({ name: 'Apagar', objective: 'Testar exclusão em cascata' })
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-del',
      agent: 'Astra',
      summary: 'Relato',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'x.txt', sha256: 'a'.repeat(64) }] }],
    })
    const evidenceId = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!.id
    store.crossCheckEvidence(project.id, evidenceId, { verifiedBy: 'Grok', note: 'ok' })

    const deleted = store.deleteProject(project.id, 'Apagar')
    assert.equal(deleted.projectId, project.id)
    store.close()

    const raw = new DatabaseSync(dbPath)
    try {
      const records = raw.prepare('SELECT COUNT(*) as n FROM evidence_records WHERE project_id = ?').get(project.id) as {
        n: number
      }
      const artifacts = raw.prepare('SELECT COUNT(*) as n FROM evidence_artifacts WHERE evidence_id = ?').get(evidenceId) as {
        n: number
      }
      const verifications = raw
        .prepare('SELECT COUNT(*) as n FROM evidence_verifications WHERE evidence_id = ?')
        .get(evidenceId) as { n: number }
      assert.equal(records.n, 0)
      assert.equal(artifacts.n, 0)
      assert.equal(verifications.n, 0)
    } finally {
      raw.close()
    }
  })
})

describe('evidência desatualizada no brief de retomada e no handoff', () => {
  it('getResumeBrief inclui a seção "Evidências que não cobrem mais a versão atual" com fonte e motivo', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Retomada',
      objective: 'Testar seção de evidência desatualizada',
      workspacePath: workspaceDir,
    })
    const hash = writeWorkspaceFile(workspaceDir, 'server/store.ts', 'conteudo original')
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-resume-stale',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [
        {
          command: 'npm test',
          outcome: 'passed',
          details: '263/263 aprovados',
          artifacts: [{ path: 'server/store.ts', sha256: hash }],
        },
      ],
    })
    // muda o conteúdo depois da medição — a evidência deixa de cobrir a versão atual
    writeWorkspaceFile(workspaceDir, 'server/store.ts', 'conteudo mudou')

    const brief = store.getResumeBrief(project.id, 'Astra')
    assert.match(brief.markdown, /## Evidências que não cobrem mais a versão atual/)
    assert.ok(brief.markdown.includes('npm test'))
    assert.ok(brief.markdown.includes('Nucleo'))
    assert.ok(brief.markdown.includes('server/store.ts'))
    assert.ok(!brief.markdown.includes('Nenhuma evidência desatualizada'))
  })

  it('getResumeBrief mostra texto de ausência quando não há evidência desatualizada', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Retomada limpa', objective: 'Sem evidência desatualizada' })
    const brief = store.getResumeBrief(project.id, 'Astra')
    assert.match(brief.markdown, /## Evidências que não cobrem mais a versão atual/)
    assert.match(brief.markdown, /Nenhuma evidência desatualizada/)
  })

  it('getHandoff inclui evidência desatualizada real calculada pelo domínio (integração ponta a ponta)', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Handoff',
      objective: 'Testar handoff com evidência desatualizada real',
      workspacePath: workspaceDir,
    })
    const hash = writeWorkspaceFile(workspaceDir, 'a.ts', 'v1')
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-handoff-stale',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [{ command: 'npx tsc --noEmit', outcome: 'passed', details: '', artifacts: [{ path: 'a.ts', sha256: hash }] }],
    })
    writeWorkspaceFile(workspaceDir, 'a.ts', 'v2')

    const handoff = store.getHandoff(project.id)
    assert.match(handoff.markdown, /## Evidências que não cobrem mais a versão atual/)
    assert.ok(handoff.markdown.includes('npx tsc --noEmit'))
    assert.ok(handoff.markdown.includes('Nucleo'))
    assert.ok(!handoff.markdown.includes('Nenhuma evidência desatualizada'))
  })
})

describe('cálculo de hash em streaming — arquivo grande não é impedimento', () => {
  it('arquivo maior que 128 KB (antigo teto do inspetor de contexto) é verificado normalmente: covers_current', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Arquivo grande',
      objective: 'Testar que hash não usa o teto de inspeção de contexto',
      workspacePath: workspaceDir,
    })
    // 200 KB — acima dos 128 KB do inspetor de contexto, abaixo do teto de hash.
    const bigContent = 'x'.repeat(200 * 1024)
    const hash = writeWorkspaceFile(workspaceDir, 'server/store.ts', bigContent)
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-big-file',
      agent: 'Nucleo',
      summary: 'Medi arquivo grande',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'server/store.ts', sha256: hash }] }],
    })
    const ev = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!
    assert.equal(ev.artifacts[0]?.freshness, 'covers_current')
    assert.equal(ev.freshness, 'covers_current')
  })

  it('hash calculado em múltiplos blocos (arquivo maior que o buffer de streaming) bate com o hash de referência', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Streaming multi-bloco',
      objective: 'Testar acumulação correta do hash entre blocos',
      workspacePath: workspaceDir,
    })
    // Conteúdo não repetitivo maior que o buffer de 64 KB, para atravessar múltiplas leituras.
    const parts: string[] = []
    for (let i = 0; i < 5000; i++) parts.push(`linha-${i}-conteudo-nao-repetitivo\n`)
    const bigContent = parts.join('')
    assert.ok(bigContent.length > 64 * 1024)
    const referenceHash = sha256(bigContent)
    writeWorkspaceFile(workspaceDir, 'multi.txt', bigContent)

    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-multi-chunk',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'multi.txt', sha256: referenceHash }] }],
    })
    const ev = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!
    assert.equal(ev.artifacts[0]?.freshness, 'covers_current')
    assert.equal(ev.artifacts[0]?.currentSha256, referenceHash)
  })
})

describe('frescor agregado conservador com explicação honesta sobre artefatos íntegros', () => {
  it('quando um artefato é unverifiable e outros estão íntegros, a explicação diz quantos estão íntegros', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Parcialmente íntegro',
      objective: 'Testar explicação honesta na agregação conservadora',
      workspacePath: workspaceDir,
    })
    const hashA = writeWorkspaceFile(workspaceDir, 'ok1.txt', 'conteudo ok 1')
    const hashB = writeWorkspaceFile(workspaceDir, 'ok2.txt', 'conteudo ok 2')
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-partial',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [
        {
          command: 'npm test',
          outcome: 'passed',
          details: '',
          artifacts: [
            { path: 'ok1.txt', sha256: hashA },
            { path: 'ok2.txt', sha256: hashB },
            { path: '../fora-da-pasta.txt', sha256: 'a'.repeat(64) },
          ],
        },
      ],
    })
    const ev = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!
    // agregado continua conservador: um unverifiable já derruba o total
    assert.equal(ev.freshness, 'unverifiable')
    // e a explicação diz o que dá pra afirmar sobre os outros dois — sem crase, sem "(s)",
    // sem o jargão "artefato"
    assert.equal(
      ev.explanation,
      'Não foi possível verificar o frescor de 1 de 3 arquivos; os outros 2 continuam iguais (../fora-da-pasta.txt).',
    )
    assert.doesNotMatch(ev.explanation, /\(s\)/)
    assert.doesNotMatch(ev.explanation, /artefato/)
    assert.doesNotMatch(ev.explanation, /`/)
  })

  it('um único arquivo desatualizado (nenhum outro na evidência): singular correto, sem crase', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Um arquivo mudou',
      objective: 'Testar singular na explicação agregada',
      workspacePath: workspaceDir,
    })
    const hash = writeWorkspaceFile(workspaceDir, 'server/store.ts', 'versao 1')
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-single-stale',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'server/store.ts', sha256: hash }] }],
    })
    writeWorkspaceFile(workspaceDir, 'server/store.ts', 'versao 2')

    const ev = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!
    assert.equal(ev.freshness, 'stale')
    assert.equal(
      ev.explanation,
      'Esta evidência não cobre mais a versão atual: 1 arquivo mudou desde a medição (server/store.ts).',
    )
  })

  it('todos os arquivos declarados mudaram (3): plural correto, sem "(s)", sem crase e sem redundância', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Vários arquivos mudaram',
      objective: 'Testar plural na explicação agregada',
      workspacePath: workspaceDir,
    })
    const hashA = writeWorkspaceFile(workspaceDir, 'server/store.ts', 'versao 1')
    const hashB = writeWorkspaceFile(workspaceDir, 'shared/evidence.ts', 'versao 1')
    const hashC = writeWorkspaceFile(workspaceDir, 'shared/events.ts', 'versao 1')
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-triple-stale',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [
        {
          command: 'npm test',
          outcome: 'passed',
          details: '',
          artifacts: [
            { path: 'server/store.ts', sha256: hashA },
            { path: 'shared/evidence.ts', sha256: hashB },
            { path: 'shared/events.ts', sha256: hashC },
          ],
        },
      ],
    })
    writeWorkspaceFile(workspaceDir, 'server/store.ts', 'versao 2')
    writeWorkspaceFile(workspaceDir, 'shared/evidence.ts', 'versao 2')
    writeWorkspaceFile(workspaceDir, 'shared/events.ts', 'versao 2')

    const ev = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!
    assert.equal(ev.freshness, 'stale')
    // começo exato exigido pela tela (tests/ui.spec.ts confere esse prefixo)
    assert.ok(ev.explanation.startsWith('Esta evidência não cobre mais a versão atual'))
    assert.equal(
      ev.explanation,
      'Esta evidência não cobre mais a versão atual: 3 arquivos mudaram desde a medição (server/store.ts, shared/evidence.ts, shared/events.ts).',
    )
    assert.doesNotMatch(ev.explanation, /\(s\)/)
    assert.doesNotMatch(ev.explanation, /artefato/)
    assert.doesNotMatch(ev.explanation, /`/)
    // não afirma "0 de 3 continuam iguais" quando nenhum continua: se todos mudaram, dizer que
    // "nenhum continua igual" é redundante com "todos mudaram" — por isso a frase não tem esse trecho
    assert.doesNotMatch(ev.explanation, /continua/)
  })

  it('parcial, sobrou 1 arquivo igual: singular na cláusula "o outro continua igual"', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Parcial, sobrou um',
      objective: 'Testar parcial com um arquivo íntegro',
      workspacePath: workspaceDir,
    })
    const hashA = writeWorkspaceFile(workspaceDir, 'server/store.ts', 'versao 1')
    const hashIntact = writeWorkspaceFile(workspaceDir, 'shared/events.ts', 'versao 1')
    const hashC = writeWorkspaceFile(workspaceDir, 'shared/evidence.ts', 'versao 1')
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-partial-one-intact',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [
        {
          command: 'npm test',
          outcome: 'passed',
          details: '',
          artifacts: [
            { path: 'server/store.ts', sha256: hashA },
            { path: 'shared/events.ts', sha256: hashIntact },
            { path: 'shared/evidence.ts', sha256: hashC },
          ],
        },
      ],
    })
    // dois mudam, um (shared/events.ts) permanece igual
    writeWorkspaceFile(workspaceDir, 'server/store.ts', 'versao 2')
    writeWorkspaceFile(workspaceDir, 'shared/evidence.ts', 'versao 2')

    const ev = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!
    assert.equal(ev.freshness, 'stale')
    assert.equal(
      ev.explanation,
      'Esta evidência não cobre mais a versão atual: 2 de 3 arquivos mudaram desde a medição; o outro continua igual (server/store.ts, shared/evidence.ts).',
    )
  })

  it('parcial, sobraram 2 ou mais arquivos iguais: plural na cláusula "os outros N continuam iguais"', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Parcial, sobraram dois',
      objective: 'Testar parcial com dois arquivos íntegros',
      workspacePath: workspaceDir,
    })
    const hashChanged = writeWorkspaceFile(workspaceDir, 'server/store.ts', 'versao 1')
    const hashIntactA = writeWorkspaceFile(workspaceDir, 'shared/evidence.ts', 'versao 1')
    const hashIntactB = writeWorkspaceFile(workspaceDir, 'shared/events.ts', 'versao 1')
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-partial-two-intact',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [
        {
          command: 'npm test',
          outcome: 'passed',
          details: '',
          artifacts: [
            { path: 'server/store.ts', sha256: hashChanged },
            { path: 'shared/evidence.ts', sha256: hashIntactA },
            { path: 'shared/events.ts', sha256: hashIntactB },
          ],
        },
      ],
    })
    // só server/store.ts muda; os outros dois continuam iguais
    writeWorkspaceFile(workspaceDir, 'server/store.ts', 'versao 2')

    const ev = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!
    assert.equal(ev.freshness, 'stale')
    assert.equal(
      ev.explanation,
      'Esta evidência não cobre mais a versão atual: 1 de 3 arquivos mudou desde a medição; os outros 2 continuam iguais (server/store.ts).',
    )
  })

  it('quando todos os artefatos estão íntegros, a explicação não menciona contagem parcial', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({ name: 'Tudo íntegro', objective: 'Testar explicação sem ruído', workspacePath: workspaceDir })
    const hashA = writeWorkspaceFile(workspaceDir, 'ok1.txt', 'conteudo ok 1')
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-all-ok',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'ok1.txt', sha256: hashA }] }],
    })
    const ev = store.listEvidence(project.id, { checkpointId: checkpoint.id })[0]!
    assert.equal(ev.freshness, 'covers_current')
    assert.ok(!ev.explanation.includes('íntegro'))
  })
})

describe('compileContext — seção de evidências desatualizadas', () => {
  it('ContextEnvelope inclui a seção stale_evidence com fonte e motivo por item', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Contexto',
      objective: 'Testar seção stale_evidence',
      workspacePath: workspaceDir,
    })
    const hash = writeWorkspaceFile(workspaceDir, 'server/store.ts', 'conteudo original')
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-ctx-stale',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [
        {
          command: 'npm test',
          outcome: 'passed',
          details: '263/263 aprovados',
          artifacts: [{ path: 'server/store.ts', sha256: hash }],
        },
      ],
    })
    writeWorkspaceFile(workspaceDir, 'server/store.ts', 'conteudo mudou')

    const envelope = store.compileContext(project.id, { agent: 'Astra' })
    const section = envelope.sections.find((s) => s.kind === 'stale_evidence')
    assert.ok(section, 'seção stale_evidence ausente do envelope')
    assert.equal(section?.title, 'Evidências que não cobrem mais a versão atual')
    assert.equal(section?.items.length, 1)
    const item = section!.items[0]!
    assert.equal(item.sourceType, 'evidence')
    assert.ok(item.body.includes('npm test'))
    assert.ok(item.body.includes('Nucleo'))
    assert.ok(item.body.includes(checkpoint.id))
    assert.match(item.reason, /desde a medição/)

    // vai para o markdown final (fonte e motivo visíveis, não só na estrutura)
    assert.ok(envelope.markdown.includes('Evidências que não cobrem mais a versão atual'))
    assert.ok(envelope.markdown.includes('npm test'))

    // entra em includedSources como fonte rastreável
    const source = envelope.includedSources.find((s) => s.sourceType === 'evidence')
    assert.ok(source)
    assert.equal(source?.sourceId, item.id)
  })

  it('não aparece seção stale_evidence quando não há evidência desatualizada', () => {
    const { store } = makeStore(() => T0)
    const project = store.createProject({ name: 'Contexto limpo', objective: 'Sem evidência desatualizada' })
    const envelope = store.compileContext(project.id, { agent: 'Astra' })
    assert.equal(envelope.sections.some((s) => s.kind === 'stale_evidence'), false)
    assert.equal(envelope.cutSections.includes('stale_evidence'), false)
  })

  it('corta a seção stale_evidence só entre entidades completas quando o orçamento é pequeno', () => {
    const { store, workspaceDir } = makeStore(() => T0)
    const project = store.createProject({
      name: 'Contexto cortado',
      objective: 'Testar corte por orçamento',
      workspacePath: workspaceDir,
    })
    let revision = 0
    for (let i = 0; i < 10; i++) {
      const relPath = `arquivo-${i}.txt`
      const hash = writeWorkspaceFile(workspaceDir, relPath, `conteudo original ${i}`)
      const checkpoint = store.saveCheckpoint(project.id, {
        expectedRevision: revision,
        idempotencyKey: `cp-ctx-cut-${i}`,
        agent: 'Nucleo',
        summary: `Medi ${i}`,
        nextStep: 'Seguir',
        evidence: [
          {
            command: `MARCA-UNICA-${i}-comando`,
            outcome: 'passed',
            details: '',
            artifacts: [{ path: relPath, sha256: hash }],
          },
        ],
      })
      revision = checkpoint.revision
      writeWorkspaceFile(workspaceDir, relPath, `conteudo mudou ${i}`)
    }

    const envelope = store.compileContext(project.id, { agent: 'Astra', maxChars: 2200 })
    assert.equal(envelope.truncated, true)
    // Para cada item, ou aparece inteiro no markdown, ou não aparece nada dele.
    for (let i = 0; i < 10; i++) {
      const marker = `MARCA-UNICA-${i}-comando`
      const idx = envelope.markdown.indexOf(marker)
      if (idx === -1) continue
      const fullLine = `**Evidência: ${marker}**`
      assert.ok(envelope.markdown.includes(fullLine), `item ${i} apareceu cortado no meio`)
    }
    const section = envelope.sections.find((s) => s.kind === 'stale_evidence')
    const includedCount = section?.items.length ?? 0
    assert.ok(includedCount < 10, 'esperava que o orçamento pequeno cortasse ao menos um item')
  })
})

describe('frescor com lembrança do hash (ArtifactHashCache)', () => {
  // Hasher real que conta quantas vezes leu o disco.
  function countingRealHasher() {
    const state = { calls: 0 }
    return {
      state,
      hashFile: (path: string): string => {
        state.calls += 1
        return createHash('sha256').update(readFileSync(path)).digest('hex')
      },
    }
  }

  function makeStoreWithCache(cache: ArtifactHashCache) {
    const dir = mkdtempSync(join(tmpdir(), 'axon-evidence-cache-'))
    const workspaceDir = join(dir, 'workspace')
    mkdirSync(workspaceDir, { recursive: true })
    const store = new WorkspaceStore(join(dir, 'workspace.sqlite'), { now: () => T0, artifactHashCache: cache })
    cleanups.push(() => {
      try {
        store.close()
      } catch {
        /* já fechado */
      }
      rmSync(dir, { recursive: true, force: true })
    })
    return { store, workspaceDir }
  }

  function seed(store: WorkspaceStore, workspaceDir: string) {
    const project = store.createProject({ name: 'Lembrança', objective: 'Hash lembrado', workspacePath: workspaceDir })
    const hash = writeWorkspaceFile(workspaceDir, 'src/a.ts', 'conteudo original')
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-cache',
      agent: 'Nucleo',
      summary: 'Medi',
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: '', artifacts: [{ path: 'src/a.ts', sha256: hash }] }],
    })
    return { project, checkpoint, hash }
  }

  it('arquivo parado há tempo: leituras repetidas reaproveitam o hash e continuam covers_current', () => {
    const h = countingRealHasher()
    // Relógio 1 minuto à frente: o arquivo recém-criado já conta como antigo.
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => Date.now() + 60_000 })
    const { store, workspaceDir } = makeStoreWithCache(cache)
    const { project } = seed(store, workspaceDir)

    for (let i = 0; i < 3; i++) assert.equal(store.listEvidence(project.id)[0]?.freshness, 'covers_current')
    assert.equal(store.getResumeBrief(project.id, 'Astra').project.id, project.id)
    assert.equal(h.state.calls, 1)
  })

  it('arquivo antigo editado depois (mesmo tamanho, outra data) é recalculado e vira stale', () => {
    const h = countingRealHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => Date.now() + 60_000 })
    const { store, workspaceDir } = makeStoreWithCache(cache)
    const { project, hash } = seed(store, workspaceDir)
    const file = join(workspaceDir, 'src/a.ts')
    const longAgo = new Date(Date.now() - 3_600_000)
    utimesSync(file, longAgo, longAgo)
    assert.equal(store.listEvidence(project.id)[0]?.freshness, 'covers_current')

    writeFileSync(file, 'conteudo ORIGINAL', 'utf-8') // mesmo tamanho
    const later = new Date(longAgo.getTime() + 1000)
    utimesSync(file, later, later)
    const ev = store.listEvidence(project.id)[0]!
    assert.equal(ev.freshness, 'stale')
    assert.notEqual(ev.artifacts[0]?.currentSha256, hash)
    assert.equal(h.state.calls, 2)
  })

  it('arquivo antigo editado com a data de modificação devolvida (mesmo tamanho) é recalculado e vira stale', async () => {
    const h = countingRealHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => Date.now() + 60_000 })
    const { store, workspaceDir } = makeStoreWithCache(cache)
    const { project, hash } = seed(store, workspaceDir)
    const file = join(workspaceDir, 'src/a.ts')
    const longAgo = new Date(Date.now() - 3_600_000)
    utimesSync(file, longAgo, longAgo)
    assert.equal(store.listEvidence(project.id)[0]?.freshness, 'covers_current')
    assert.equal(cache.size, 1)

    // Na produção a janela de 2 s separa a leitura da edição; aqui o relógio é falso,
    // então espera o tique do disco (NTFS ~15 ms) para a data de alteração andar.
    await new Promise((r) => setTimeout(r, 60))
    writeFileSync(file, 'conteudo ORIGINAL', 'utf-8') // mesmo tamanho
    utimesSync(file, longAgo, longAgo) // devolve a data de modificação antiga
    const ev = store.listEvidence(project.id)[0]!
    assert.equal(ev.freshness, 'stale')
    assert.notEqual(ev.artifacts[0]?.currentSha256, hash)
    assert.equal(h.state.calls, 2)
  })

  it('com o relógio real, arquivo recém-gravado nunca é lembrado: regravação no mesmo tamanho é pega na hora', () => {
    const h = countingRealHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile })
    const { store, workspaceDir } = makeStoreWithCache(cache)
    const { project } = seed(store, workspaceDir)

    assert.equal(store.listEvidence(project.id)[0]?.freshness, 'covers_current')
    writeFileSync(join(workspaceDir, 'src/a.ts'), 'conteudo ORIGINAL', 'utf-8') // mesmo tamanho, sem esperar
    assert.equal(store.listEvidence(project.id)[0]?.freshness, 'stale')
    assert.equal(h.state.calls, 2)
    assert.equal(cache.size, 0)
  })
})
