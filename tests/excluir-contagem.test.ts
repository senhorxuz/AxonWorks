import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { DomainError, WorkspaceStore } from '../server/store.ts'

const pastas: Array<() => void> = []
afterEach(() => { for (const f of pastas.splice(0)) { try { f() } catch { /* limpeza */ } } })

function novaStore(): WorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'axon-excluir-'))
  const store = new WorkspaceStore(join(dir, 'workspace.sqlite'))
  pastas.push(() => { try { store.close() } catch { /* já fechado */ } rmSync(dir, { recursive: true, force: true }) })
  return store
}

describe('contarRascunhosEPassagens: o que a exclusão apaga e nenhuma lista mostra', () => {
  it('projeto novo: zero e zero', () => {
    const store = novaStore()
    const p = store.createProject({ name: 'Vazio', objective: 'Nada ainda.' })
    assert.deepEqual(store.contarRascunhosEPassagens(p.id), { rascunhos: 0, passagens: 0 })
  })
  it('conta os rascunhos e as passagens do projeto, e só os dele', () => {
    const store = novaStore()
    const a = store.createProject({ name: 'Alfa', objective: 'Projeto alfa.' })
    const b = store.createProject({ name: 'Beta', objective: 'Projeto beta.' })
    store.saveWorkDraft(a.id, { agent: 'Astra', expectedVersion: 0, summary: 'Rascunho 1', nextAction: 'Seguir' })
    store.saveWorkDraft(a.id, { agent: 'Gemini', expectedVersion: 0, summary: 'Rascunho 2', nextAction: 'Seguir' })
    store.saveWorkDraft(b.id, { agent: 'Astra', expectedVersion: 0, summary: 'Rascunho de outro', nextAction: 'Seguir' })
    const checkpoint = store.saveCheckpoint(a.id, { expectedRevision: 0, idempotencyKey: 'cp-1', agent: 'Astra', summary: 'Feito.', nextStep: 'Seguir.' })
    store.createHandoffDelivery(a.id, { checkpointId: checkpoint.id, from: 'Astra', to: 'Gemini', message: 'Passagem.' })
    assert.deepEqual(store.contarRascunhosEPassagens(a.id), { rascunhos: 2, passagens: 1 })
    assert.deepEqual(store.contarRascunhosEPassagens(b.id), { rascunhos: 1, passagens: 0 })
  })
  it('projeto que não existe é 404', () => {
    const store = novaStore()
    assert.throws(() => store.contarRascunhosEPassagens('00000000-0000-4000-8000-000000000000'), (e: unknown) => e instanceof DomainError && e.status === 404)
  })
})
