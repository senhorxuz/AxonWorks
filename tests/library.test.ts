import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { DomainError, WorkspaceStore } from '../server/store.ts'

const T0 = new Date('2026-09-15T04:00:00.000Z')
const cleanups: Array<() => void> = []

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose()
})

function makeStore(): WorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'axon-library-'))
  const store = new WorkspaceStore(join(dir, 'workspace.sqlite'), { now: () => T0 })
  cleanups.push(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

function expectDomain(fn: () => unknown, status: number, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.status, status)
    assert.equal(error.code, code)
    return true
  })
}

describe('Biblioteca de Conteúdos', () => {
  it('cria um item ativo com a primeira revisão e proveniência declarada', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'Biblioteca', objective: 'Preservar conhecimento' })

    const created = store.createContent(project.id, {
      title: 'Contrato de continuidade',
      kind: 'specification',
      body: '# Contrato\n\nA Axon funciona como correio.',
      format: 'markdown',
      createdBy: 'Astra',
      sourceKind: 'human_directive',
      sourceLabel: 'Pedido do operador',
      declaredValidity: 'current',
    })

    assert.equal(created.item.projectId, project.id)
    assert.equal(created.item.status, 'active')
    assert.equal(created.item.version, 0)
    assert.equal(created.item.currentRevisionId, created.revision.id)
    assert.equal(created.revision.itemId, created.item.id)
    assert.equal(created.revision.revision, 1)
    assert.equal(created.revision.supersedesId, null)
    assert.equal(created.revision.sourceLabel, 'Pedido do operador')
    assert.equal(store.listContent(project.id).length, 1)
  })

  it('usa CAS na revisão: uma escrita vence e a versão antiga é recusada', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'CAS', objective: 'Evitar sobrescrita silenciosa' })
    const original = store.createContent(project.id, {
      title: 'Plano', kind: 'note', body: 'Versão inicial', createdBy: 'A', sourceKind: 'agent_report',
    })

    const winner = store.reviseContent(project.id, original.item.id, {
      expectedVersion: 0,
      body: 'Versão gravada por A',
      createdBy: 'A',
      sourceKind: 'agent_report',
    })
    assert.equal(winner.item.version, 1)

    expectDomain(
      () => store.reviseContent(project.id, original.item.id, {
        expectedVersion: 0,
        body: 'Versão concorrente de B',
        createdBy: 'B',
        sourceKind: 'agent_report',
      }),
      409,
      'version_conflict',
    )
    assert.equal(store.getContent(project.id, original.item.id).revision.body, 'Versão gravada por A')
  })

  it('preserva revisões anteriores como histórico imutável', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'Histórico', objective: 'Manter fontes' })
    const first = store.createContent(project.id, {
      title: 'Pesquisa', kind: 'research', body: 'Hipótese original', createdBy: 'Gemini', sourceKind: 'agent_report',
      declaredValidity: 'needs_review',
    })
    const second = store.reviseContent(project.id, first.item.id, {
      expectedVersion: 0,
      title: 'Pesquisa validada',
      body: 'Conclusão atual',
      format: 'plain_text',
      createdBy: 'Operador',
      sourceKind: 'external_reference',
      sourceUrl: 'https://example.test/reference',
      declaredValidity: 'current',
    })

    const document = store.getContent(project.id, first.item.id)
    assert.equal(second.revision.revision, 2)
    assert.equal(second.revision.supersedesId, first.revision.id)
    assert.deepEqual(document.revisions.map((revision) => revision.body), ['Hipótese original', 'Conclusão atual'])
    assert.equal(document.revisions[0]?.declaredValidity, 'needs_review')
    assert.equal(document.item.title, 'Pesquisa validada')
  })

  it('busca somente a revisão vigente de itens ativos e devolve fonte', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'Busca', objective: 'Encontrar conhecimento atual' })
    const created = store.createContent(project.id, {
      title: 'Escolha técnica', kind: 'specification', body: 'Usar o mecanismo antigo aurora',
      createdBy: 'A', sourceKind: 'agent_report', declaredValidity: 'outdated',
    })
    store.reviseContent(project.id, created.item.id, {
      expectedVersion: 0,
      body: 'A decisão vigente usa o mecanismo prisma',
      createdBy: 'Humano', sourceKind: 'human_directive', sourceLabel: 'Revisão manual',
    })

    assert.equal(store.searchContent(project.id, 'aurora').length, 0)
    const results = store.searchContent(project.id, 'prisma')
    assert.equal(results.length, 1)
    assert.equal(results[0]?.revision.body, 'A decisão vigente usa o mecanismo prisma')
    assert.match(results[0]?.snippet ?? '', /prisma/i)
    assert.equal(results[0]?.source.kind, 'human_directive')
    assert.equal(results[0]?.source.label, 'Revisão manual')

    // A consulta é conteúdo não confiável e não pode virar sintaxe SQL/FTS.
    assert.deepEqual(store.searchContent(project.id, `prisma' OR 1=1 --`), [])
  })

  it('recusa relações inexistentes ou entre projetos sem deixar escrita parcial', () => {
    const store = makeStore()
    const p1 = store.createProject({ name: 'P1', objective: 'Isolar P1' })
    const p2 = store.createProject({ name: 'P2', objective: 'Isolar P2' })
    const source = store.createContent(p1.id, {
      title: 'Fonte', kind: 'reference', body: 'Fonte confiável', createdBy: 'A', sourceKind: 'external_reference',
    })
    const foreignTask = store.createTask(p2.id, { title: 'Tarefa alheia' })

    expectDomain(() => store.addContentRelation(p1.id, {
      sourceRevisionId: source.revision.id,
      targetType: 'task',
      targetId: foreignTask.id,
      kind: 'required_input',
      createdBy: 'A',
    }), 404, 'not_found')
    expectDomain(() => store.addContentRelation(p1.id, {
      sourceRevisionId: source.revision.id,
      targetType: 'checkpoint',
      targetId: randomUUID(),
      kind: 'supports',
      createdBy: 'A',
    }), 404, 'not_found')
    assert.equal(store.getContent(p1.id, source.item.id).relations.length, 0)

    const localTask = store.createTask(p1.id, { title: 'Tarefa local' })
    const relation = store.addContentRelation(p1.id, {
      sourceRevisionId: source.revision.id,
      targetType: 'task',
      targetId: localTask.id,
      kind: 'required_input',
      createdBy: 'A',
    })
    assert.equal(relation.projectId, p1.id)
    assert.equal(store.getContent(p1.id, source.item.id).relations.length, 1)
  })

  it('arquiva com CAS: sai da lista e busca, mas mantém documento e histórico', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'Arquivo', objective: 'Preservar memória' })
    const created = store.createContent(project.id, {
      title: 'Nota transitória', kind: 'note', body: 'termo encontrável', createdBy: 'A', sourceKind: 'agent_report',
    })
    store.reviseContent(project.id, created.item.id, {
      expectedVersion: 0, body: 'termo encontrável atualizado', createdBy: 'A', sourceKind: 'agent_report',
    })
    const archived = store.archiveContent(project.id, created.item.id, { expectedVersion: 1 })

    assert.equal(archived.status, 'archived')
    assert.equal(archived.version, 2)
    assert.equal(store.listContent(project.id).length, 0)
    assert.equal(store.listContent(project.id, { includeArchived: true }).length, 1)
    assert.equal(store.searchContent(project.id, 'encontrável').length, 0)
    const preserved = store.getContent(project.id, created.item.id)
    assert.equal(preserved.item.status, 'archived')
    assert.equal(preserved.revisions.length, 2)
    expectDomain(() => store.archiveContent(project.id, created.item.id, { expectedVersion: 1 }), 409, 'version_conflict')
  })
})
