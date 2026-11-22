import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { it } from 'node:test'
import { WorkspaceStore } from '../server/store.ts'
import type { EvidenceInput } from '../shared/evidence.ts'

function projeto(store: WorkspaceStore) {
  return store.createProject({ name: 'Projeto', objective: 'Conferir antes de subir' }).id
}

function verificacao(store: WorkspaceStore, projectId: string, texto = 'Conferir a versão.') {
  return store.registrarLicao(projectId, {
    tipo: 'verificacao', momento: 'antes_de_subir', agent: 'Codex', texto, fraseDoDono: texto,
  }).id
}

function relato(details: string, verificacaoId?: string, outcome: EvidenceInput['outcome'] = 'failed'): EvidenceInput {
  return { command: 'preflight', outcome, details, verificacaoId }
}

function entrada(store: WorkspaceStore, projectId: string, idempotencyKey: string, ...evidence: EvidenceInput[]) {
  return {
    expectedRevision: store.getProject(projectId).project.revision,
    idempotencyKey,
    agent: 'Codex',
    summary: 'Conferência executada',
    nextStep: 'Conferir a versão novamente',
    evidence,
  }
}

it('conta só os relatos failed do projeto e devolve a data, o checkpoint e o detalhe mais recentes de cada verificação', (t) => {
  let instante = new Date('2026-11-19T10:00:00.000Z')
  const store = new WorkspaceStore(':memory:', { now: () => instante })
  t.after(() => store.close())
  const projectId = projeto(store)
  const verificacaoId = verificacao(store, projectId)
  const outra = verificacao(store, projectId, 'Conferir a configuração.')
  const semFalha = verificacao(store, projectId, 'Conferir a publicação.')
  const estrangeiro = projeto(store)
  const estrangeira = verificacao(store, estrangeiro)
  assert.deepEqual(store.falhasDasVerificacoes(projectId), [])

  store.saveCheckpoint(projectId, entrada(store, projectId, 'primeiro', relato('Versão antiga', verificacaoId)))
  instante = new Date('2026-11-19T11:00:00.000Z')
  const segundo = store.saveCheckpoint(projectId, entrada(store, projectId, 'segundo', relato('Configuração inválida', outra)))
  instante = new Date('2026-11-19T12:00:00.000Z')
  const { checkpoint } = store.finalizeWork(projectId, {
    ...entrada(store, projectId, 'terceiro', relato('Versão divergente', verificacaoId)),
    taskTransition: { kind: 'keep_claimed' },
  })
  instante = new Date('2026-11-19T13:00:00.000Z')
  store.saveCheckpoint(projectId, entrada(store, projectId, 'recuperou',
    relato('Corrigiu', verificacaoId, 'passed'), relato('Pendente', verificacaoId, 'not_run'),
    relato('Passou de primeira', semFalha, 'passed'), relato('Falha genérica')))
  store.saveCheckpoint(estrangeiro, entrada(store, estrangeiro, 'externo', relato('Falha externa', estrangeira)))

  assert.deepEqual(store.falhasDasVerificacoes(projectId), [
    { verificacaoId, quantas: 2, ultimaEm: checkpoint.createdAt, ultimoCheckpointId: checkpoint.id, ultimoDetalhe: 'Versão divergente' },
    { verificacaoId: outra, quantas: 1, ultimaEm: segundo.createdAt, ultimoCheckpointId: segundo.id, ultimoDetalhe: 'Configuração inválida' },
  ])
  assert.equal(store.listEvidence(projectId, { checkpointId: checkpoint.id })[0]?.assertions[0], 'agent_reported')
})

it('desempata pelo registro gravado por último e preserva o histórico depois de aposentar a verificação', (t) => {
  const store = new WorkspaceStore(':memory:', { now: () => new Date('2026-11-19T10:00:00.000Z') })
  t.after(() => store.close())
  const projectId = projeto(store)
  const id = verificacao(store, projectId)
  store.saveCheckpoint(projectId, entrada(store, projectId, 'primeiro', relato('Primeira tentativa', id)))
  const input = entrada(store, projectId, 'segundo', relato('Segunda tentativa', id), relato('Terceira tentativa', id))
  const ultimo = store.saveCheckpoint(projectId, input)
  store.aposentarLicao(id, { agent: 'Codex', motivo: 'Obsoleta', pedidoDoDono: 'Pode aposentar.' })
  assert.equal(store.saveCheckpoint(projectId, input).id, ultimo.id)
  assert.throws(() => store.saveCheckpoint(projectId, { ...input, evidence: [relato('Segunda tentativa'), relato('Terceira tentativa', id)] }),
    { status: 409, code: 'idempotency_conflict' })
  assert.deepEqual(store.falhasDasVerificacoes(projectId), [{
    verificacaoId: id, quantas: 3, ultimaEm: ultimo.createdAt, ultimoCheckpointId: ultimo.id, ultimoDetalhe: 'Terceira tentativa',
  }])
})

const recusas = {
  inexistente: () => randomUUID(),
  'de outro tipo': (store: WorkspaceStore, projectId: string) =>
    store.registrarLicao(projectId, { texto: 'Apenas um erro.', agent: 'Codex' }).id,
  aposentada: (store: WorkspaceStore, projectId: string) => {
    const id = verificacao(store, projectId, 'Conferência antiga.')
    store.aposentarLicao(id, { agent: 'Codex', motivo: 'Obsoleta', pedidoDoDono: 'Pode aposentar.' })
    return id
  },
  'na lixeira': (store: WorkspaceStore, projectId: string) => {
    const id = verificacao(store, projectId)
    store.excluir(projectId, { tipo: 'licao', id, agent: 'Codex', origem: 'mcp', pedidoDoDono: 'Exclua a verificação.' })
    return id
  },
  'de outro projeto': (store: WorkspaceStore) => verificacao(store, projeto(store)),
  'de formato inválido': () => '',
  nula: () => null as unknown as string,
  'com objeto no lugar do id': () => ({ id: randomUUID() }) as unknown as string,
}

for (const [nome, idInvalido] of Object.entries(recusas)) {
  it(`recusa vincular verificação ${nome} com 400 e reverte toda a gravação`, (t) => {
    const store = new WorkspaceStore(':memory:')
    t.after(() => store.close())
    const projectId = projeto(store)
    const valida = verificacao(store, projectId)
    const invalida = idInvalido(store, projectId)
    const antes = store.getProject(projectId)
    const input = entrada(store, projectId, 'recusado', relato('Válida', valida), relato('Inválida', invalida, 'passed'))
    const erro = {
      status: 400,
      code: 'verificacao_invalida',
      message: 'A evidência precisa apontar para uma verificação ativa deste projeto.',
    }

    assert.throws(() => store.saveCheckpoint(projectId, input), erro)
    assert.throws(() => store.finalizeWork(projectId, { ...input, taskTransition: { kind: 'keep_claimed' } }), erro)
    assert.deepEqual(store.getProject(projectId), antes)
    assert.deepEqual(store.listEvidence(projectId), [])
  })
}

it('migra um banco anterior sem reescrever as evidências e permite reabrir sem repetir a alteração', (t) => {
  const pasta = mkdtempSync(join(tmpdir(), 'axon-verificacoes-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  const caminho = join(pasta, 'teste.sqlite')
  const anterior = new WorkspaceStore(caminho)
  const projectId = projeto(anterior)
  const input = entrada(anterior, projectId, 'legado', relato('Relato anterior à migração'))
  const cp = anterior.saveCheckpoint(projectId, input)
  const evidencias = anterior.listEvidence(projectId)
  anterior.close()

  const db = new DatabaseSync(caminho)
  try {
    db.exec('ALTER TABLE evidence_records DROP COLUMN verificacao_id')
  } finally {
    db.close()
  }

  for (let abertura = 0; abertura < 2; abertura++) {
    const store = new WorkspaceStore(caminho)
    try {
      assert.deepEqual(store.listEvidence(projectId), evidencias)
      assert.deepEqual(store.saveCheckpoint(projectId, input), cp)
      assert.deepEqual(store.falhasDasVerificacoes(projectId), [])
    } finally {
      store.close()
    }
  }
})
