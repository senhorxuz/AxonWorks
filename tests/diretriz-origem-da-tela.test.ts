import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { DomainError, WorkspaceStore } from '../server/store.js'

function preparar(t: TestContext) {
  const store = new WorkspaceStore(':memory:', { now: () => new Date('2026-11-22T12:00:00.000Z') })
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Axon de teste', objective: 'Versão 1 do dono.' })
  return { store, id }
}

test('sem origem, salvar pela tela continua sendo diretriz humana', (t) => {
  const { store, id } = preparar(t)
  const nova = store.saveCharter(id, { actor: 'Dono do projeto', body: 'Versão 2 do dono.', expectedRevision: 1 })
  assert.equal(nova.sourceKind, 'human_directive')
  assert.equal(nova.vistoPeloDonoEm, undefined)
})

test('origem "human_directive" explícita grava diretriz humana', (t) => {
  const { store, id } = preparar(t)
  const nova = store.saveCharter(id, { actor: 'Dono do projeto', body: 'Versão 2 do dono.', expectedRevision: 1, origem: 'human_directive' })
  assert.equal(nova.sourceKind, 'human_directive')
})

test('origem "agent_report" (IA com nome na barra) grava como atualização de agente, que o dono confere', (t) => {
  const { store, id } = preparar(t)
  const nova = store.saveCharter(id, { actor: 'Astra', body: 'Versão 2 da IA.', expectedRevision: 1, origem: 'agent_report' })
  assert.equal(nova.sourceKind, 'agent_update')
  assert.equal(nova.createdBy, 'Astra')
  assert.equal(nova.vistoPeloDonoEm, undefined)
  // O dono ainda confere e desfaz pelo mesmo caminho do objetivo atualizado por IA.
  const vista = store.marcarObjetivoVisto(id)
  assert.ok(vista?.vistoPeloDonoEm)
})

test('o dono desfaz o que a IA salvou e volta à última diretriz humana', (t) => {
  const { store, id } = preparar(t)
  store.saveCharter(id, { actor: 'Astra', body: 'Versão 2 da IA.', expectedRevision: 1, origem: 'agent_report' })
  const volta = store.desfazerAtualizacaoDoObjetivo(id)
  assert.equal(volta.sourceKind, 'human_directive')
  assert.equal(volta.body, 'Versão 1 do dono.')
})

test('origem desconhecida é recusada com erro estável', (t) => {
  const { store, id } = preparar(t)
  assert.throws(
    () => store.saveCharter(id, { actor: 'Astra', body: 'x', expectedRevision: 1, origem: 'qualquer' } as never),
    (erro) => erro instanceof DomainError && erro.status === 400 && erro.code === 'invalid_input' && erro.message === 'Campo origem inválido.',
  )
})

test('a trava antiga continua: sourceKind de agente no corpo ainda exige aceite humano', (t) => {
  const { store, id } = preparar(t)
  assert.throws(
    () => store.saveCharter(id, { actor: 'Astra', body: 'x', expectedRevision: 1, sourceKind: 'agent_update' }),
    (erro) => erro instanceof DomainError && erro.status === 409 && erro.code === 'human_approval_required',
  )
})
