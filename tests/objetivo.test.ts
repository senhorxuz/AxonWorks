import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'
import { lerDadosDaCarta } from '../server/carta/ler.js'
import { montarCarta } from '../server/carta/montar.js'
import { DomainError, WorkspaceStore } from '../server/store.js'
import { verificarDonoDoObjetivo } from '../server/store/objetivo.js'

const INICIO = '2026-11-19T18:00:00.000Z'
const HOJE = '2026-11-20T01:00:00.000Z'
const AMANHA = '2026-11-21T18:00:00.000Z'
const TEXTO_DO_DONO = 'Versão 1. A Axon guarda continuidade. Regra: não iniciar IAs.'
const entrada = {
  agent: 'Codex',
  objetivo: 'Versão 2. A Axon guarda continuidade. Regra: não iniciar IAs.',
  motivo: 'A versão 2 entrou no ar',
  expectedRevision: 1,
}

function preparar(t: TestContext, arquivo = ':memory:') {
  let agora = INICIO
  const store = new WorkspaceStore(arquivo, { now: () => new Date(agora) })
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Axon de teste', objective: TEXTO_DO_DONO })
  return { store, id, mudarHora: (data: string) => { agora = data } }
}

function recusa(fn: () => unknown, status: number, code: string, message?: RegExp) {
  assert.throws(fn, (erro) => {
    assert.ok(erro instanceof DomainError)
    assert.equal(erro.status, status)
    assert.equal(erro.code, code)
    if (message) assert.match(erro.message, message)
    return true
  })
}

function criarArquivoTemporario() {
  const pasta = mkdtempSync(join(tmpdir(), 'axon-objetivo-'))
  return { arquivo: join(pasta, 'teste.sqlite'), limpar: () => rmSync(pasta, { force: true, recursive: true }) }
}

test('handoff e retomada identificam o objetivo atualizado pela IA mesmo após o dono conferir', t => {
  const { store, id } = preparar(t)
  const marca = '(atualizada por Codex, nome declarado)'
  const conferir = (presente: boolean) => {
    const handoff = store.getHandoff(id).markdown
    const retomada = store.getResumeBrief(id, 'Codex').markdown
    for (const markdown of [handoff, retomada]) {
      const objetivo = markdown.split('## Objetivo')[1]!.split('\n## ')[0]!
      assert.equal(objetivo.includes(marca), presente)
      assert.ok(objetivo.includes(presente ? entrada.objetivo : TEXTO_DO_DONO))
    }
  }
  conferir(false)
  store.updateProjectObjective(id, entrada)
  conferir(true)
  assert.ok(store.getResumeBrief(id, 'Codex').markdown.split('## Charter')[1]!.split('\n## ')[0]!.includes(marca))
  store.marcarObjetivoVisto(id)
  conferir(true)
  store.desfazerAtualizacaoDoObjetivo(id)
  conferir(false)
})

test('a atualização tem autoria e motivo próprios, guarda a anterior e entra como referência no contexto', (t) => {
  const { store, id, mudarHora } = preparar(t)
  const anterior = store.getCharter(id)!
  const projeto = store.getProject(id).project
  assert.equal(Object.hasOwn(anterior, 'motivo'), false)
  assert.equal(Object.hasOwn(anterior, 'vistoPeloDonoEm'), false)

  // A revisão de checkpoint e a revisão da diretriz são independentes.
  for (let revision = 0; revision < 5; revision++) {
    store.saveCheckpoint(id, { agent: 'Codex', expectedRevision: revision, idempotencyKey: `cp-${revision}`, summary: 'Só um registro', nextStep: 'Próximo passo' })
  }
  mudarHora(HOJE)
  const nova = store.updateProjectObjective(id, { ...entrada, motivo: ` ${entrada.motivo} `, agent: ' Codex ' })
  assert.deepEqual(nova, {
    id: nova.id, projectId: id, revision: 2, body: entrada.objetivo, createdBy: entrada.agent,
    createdAt: HOJE, sourceKind: 'agent_update', supersedesId: anterior.id, motivo: entrada.motivo,
  })
  assert.notEqual(nova.id, anterior.id)
  assert.deepEqual(store.getCharter(id), nova)
  assert.deepEqual(store.listCharterHistory(id), [anterior, nova])
  const [auditoria] = store.listAuditLogs({ projectId: id })
  assert.equal(auditoria?.action, 'update_project_objective')
  assert.equal(auditoria?.actorType, 'agent')
  assert.equal(auditoria?.actorId, nova.createdBy)
  assert.equal(auditoria?.resourceType, 'charter')
  assert.equal(auditoria?.resourceId, nova.id)
  assert.deepEqual(auditoria?.details, { motivo: entrada.motivo })
  assert.deepEqual(store.getProject(id).project, { ...projeto, objective: entrada.objetivo, updatedAt: HOJE, revision: 5 })

  const contexto = store.compileContext(id, { agent: 'Outra IA' })
  const secao = contexto.sections.find((secao) => secao.kind === 'charter')
  assert.equal(secao?.title, 'Charter vigente')
  const item = secao?.items[0]
  assert.equal(item?.id, nova.id)
  assert.equal(item?.sourceType, 'charter')
  assert.equal(item?.body, entrada.objetivo)
  assert.equal(item?.provenance, 'agent_report')
  assert.equal(item?.authority, 'reference')
  assert.equal(item?.title, 'Diretriz atualizada por Codex (nome declarado), revisão 2')
  assert.equal(item?.reason, 'Atualização de fatos do projeto registrada por uma IA.')
  assert.equal(contexto.includedSources.find((fonte) => fonte.sourceId === nova.id)?.authority, 'reference')
  assert.match(contexto.markdown, /Diretriz atualizada por Codex \(nome declarado\)/)
  const curto = store.compileContext(id, { agent: 'Outra IA', maxChars: 2000 })
  assert.equal(curto.includedSources.find((fonte) => fonte.sourceId === nova.id)?.authority, 'reference')

  const carta = montarCarta(lerDadosDaCarta(store, id), new Date(HOJE))
  assert.deepEqual(carta.avisos, ['O objetivo foi atualizado por Codex em 19/11/2026: A versão 2 entrou no ar. Confira na aba Diretriz.'])
  assert.deepEqual(carta.avisosDaRetomada, ['O objetivo foi atualizado por Codex em 19/11/2026: A versão 2 entrou no ar. A atualização está na aba Diretriz para conferência do dono.'])
})

test('CAS errado e motivos inválidos deixam o objetivo, o histórico e a auditoria intactos', (t) => {
  const { store, id } = preparar(t)
  const anterior = store.getCharter(id)
  recusa(() => store.updateProjectObjective(id, { ...entrada, expectedRevision: 0 }), 409, 'version_conflict', /revisão do charter mudou/)
  for (const motivo of ['', ' \t\n ', 'a'.repeat(501)]) {
    recusa(() => store.updateProjectObjective(id, { ...entrada, motivo }), 400, 'invalid_input', /Campo motivo inválido/)
  }
  recusa(() => store.updateProjectObjective(id, { ...entrada, objetivo: ' ' }), 400, 'invalid_input', /Campo objetivo inválido/)
  recusa(() => store.updateProjectObjective(id, { ...entrada, agent: ' ' }), 400, 'invalid_input', /Campo agent inválido/)
  recusa(() => store.updateProjectObjective(id, { ...entrada, expectedRevision: -1 }), 400, 'invalid_input', /expectedRevision/)
  recusa(() => store.updateProjectObjective(id, null as never), 400, 'invalid_input', /atualização do objetivo/)
  recusa(() => store.updateProjectObjective(randomUUID(), entrada), 404, 'not_found')
  for (const sourceKind of ['agent_proposal', 'agent_update'] as const) {
    recusa(() => store.saveCharter(id, { actor: 'Codex', body: entrada.objetivo, expectedRevision: 1, sourceKind }), 409, 'human_approval_required', /aceite humano/)
  }
  recusa(() => store.saveCharter(id, null as never), 400, 'invalid_input', /charter/)
  recusa(() => store.saveCharter(id, { actor: '', body: TEXTO_DO_DONO, expectedRevision: 1 }), 400, 'invalid_input', /Campo actor inválido/)
  recusa(() => store.saveCharter(id, { actor: 'Dono', body: '', expectedRevision: 1 }), 400, 'invalid_input', /Campo body inválido/)
  recusa(() => store.saveCharter(id, { actor: 'Dono', body: TEXTO_DO_DONO, expectedRevision: -1 }), 400, 'invalid_input', /Campo expectedRevision inválido/)
  assert.deepEqual(store.listCharterHistory(id), [anterior])
  assert.equal(store.getProject(id).project.objective, TEXTO_DO_DONO)
  assert.deepEqual(store.listAuditLogs({ projectId: id }), [])
  const noLimite = store.updateProjectObjective(id, { ...entrada, motivo: 'a'.repeat(500), objetivo: 'b'.repeat(8000) })
  assert.equal(noLimite.motivo, 'a'.repeat(500))
  const curto = store.compileContext(id, { agent: 'Outra IA', maxChars: 2000 })
  const item = curto.sections.find((secao) => secao.kind === 'charter')?.items[0]
  assert.equal(item?.shortened, true)
  assert.equal(item?.authority, 'reference')
})

test('a marca de vista persiste por revisão, e desfazer recupera o texto humano mais recente numa revisão nova', (t) => {
  const { arquivo, limpar } = criarArquivoTemporario()
  let agora = INICIO
  const store = new WorkspaceStore(arquivo, { now: () => new Date(agora) })
  t.after(() => { store.close(); limpar() })
  const { id } = store.createProject({ name: 'Projeto reaberto', objective: TEXTO_DO_DONO })
  const outro = store.createProject({ name: 'Outro projeto', objective: 'Outra diretriz' })
  store.saveCharter(outro.id, { actor: 'Dono', body: 'Outro texto mais recente', expectedRevision: 1 })
  recusa(() => store.desfazerAtualizacaoDoObjetivo(id), 409, 'nada_a_desfazer', /desfazer/)
  const humana = store.saveCharter(id, { actor: 'Dono', body: 'Texto do dono com ênfase.\nRegra: não iniciar IAs.', expectedRevision: 1 })
  assert.deepEqual(store.marcarObjetivoVisto(id), humana)
  const primeira = store.updateProjectObjective(id, { ...entrada, expectedRevision: 2 })
  agora = HOJE
  assert.deepEqual(store.marcarObjetivoVisto(id), { ...primeira, vistoPeloDonoEm: HOJE })
  agora = AMANHA
  assert.deepEqual(store.marcarObjetivoVisto(id), { ...primeira, vistoPeloDonoEm: HOJE })

  store.close()
  store.reopen()
  assert.deepEqual(store.getCharter(id), { ...primeira, vistoPeloDonoEm: HOJE })
  assert.deepEqual(montarCarta(lerDadosDaCarta(store, id), new Date(agora)).avisos, [])
  const segunda = store.updateProjectObjective(id, { ...entrada, objetivo: 'Correção da versão 3', motivo: 'Nova versão', expectedRevision: 3 })
  assert.equal(segunda.supersedesId, primeira.id)
  assert.equal(Object.hasOwn(segunda, 'vistoPeloDonoEm'), false)
  assert.match(montarCarta(lerDadosDaCarta(store, id), new Date(agora)).avisos[0]!, /Nova versão/)
  const restaurada = store.desfazerAtualizacaoDoObjetivo(id)
  assert.deepEqual(restaurada, {
    id: restaurada.id, projectId: id, revision: 5, body: humana.body, createdBy: 'Dono', createdAt: AMANHA,
    sourceKind: 'human_directive', supersedesId: segunda.id,
  })
  assert.deepEqual(store.listCharterHistory(id).slice(1), [humana, { ...primeira, vistoPeloDonoEm: HOJE }, segunda, restaurada])
  assert.deepEqual(store.getCharter(id), restaurada)
  assert.equal(store.getProject(id).project.objective, humana.body)
  const item = store.compileContext(id, { agent: 'Outra IA' }).sections.find((secao) => secao.kind === 'charter')?.items[0]
  assert.equal(item?.title, 'Charter vigente (revisão 5)')
  assert.equal(item?.authority, 'directive')
  assert.equal(item?.provenance, 'human_directive')
  assert.equal(item?.reason, 'Charter vigente do projeto estabelece objetivo e diretivas principais.')
  assert.deepEqual(montarCarta(lerDadosDaCarta(store, id), new Date(agora)).avisos, [])
  assert.deepEqual(montarCarta(lerDadosDaCarta(store, id), new Date(agora)).avisosDaRetomada, [])
  recusa(() => store.desfazerAtualizacaoDoObjetivo(id), 409, 'nada_a_desfazer')
})

test('migração aditiva funciona num banco anterior, inclusive diretriz sem versão humana', (t) => {
  const { arquivo, limpar } = criarArquivoTemporario()
  const inicial = new WorkspaceStore(arquivo)
  const legado = inicial.createProject({ name: 'Projeto antigo', objective: TEXTO_DO_DONO })
  inicial.close()
  const db = new DatabaseSync(arquivo)
  t.after(() => db.close())
  db.exec('ALTER TABLE charter_revisions DROP COLUMN visto_pelo_dono_em')
  db.prepare("UPDATE charter_revisions SET source_kind = 'agent_proposal' WHERE project_id = ?").run(legado.id)
  const { store, id } = preparar(t, arquivo)
  t.after(limpar)
  const antiga = store.getCharter(legado.id)!
  assert.equal(antiga.sourceKind, 'agent_proposal')
  assert.equal(Object.hasOwn(antiga, 'vistoPeloDonoEm'), false)
  assert.equal(store.compileContext(legado.id, { agent: 'Outra IA' }).sections.find((secao) => secao.kind === 'charter')?.items[0]?.authority, 'proposal')
  const nova = store.updateProjectObjective(legado.id, entrada)
  assert.equal(nova.supersedesId, antiga.id)
  recusa(() => store.desfazerAtualizacaoDoObjetivo(legado.id), 409, 'nada_a_desfazer')
  assert.equal(store.getCharter(legado.id)?.id, nova.id)

  db.prepare('DELETE FROM charter_revisions WHERE project_id = ?').run(id)
  assert.equal(store.marcarObjetivoVisto(id), null)
  const cartaSemDiretriz = montarCarta(lerDadosDaCarta(store, id), new Date(HOJE))
  assert.deepEqual(cartaSemDiretriz.avisos, [])
  assert.deepEqual(cartaSemDiretriz.avisosDaRetomada, [])
  recusa(() => store.desfazerAtualizacaoDoObjetivo(id), 409, 'nada_a_desfazer')
  const primeira = store.updateProjectObjective(id, { ...entrada, expectedRevision: 0 })
  assert.equal(primeira.supersedesId, null)
  assert.equal(primeira.revision, 1)
  db.prepare('DELETE FROM audit_logs WHERE resource_id = ?').run(primeira.id)
  assert.equal(Object.hasOwn(store.getCharter(id)!, 'motivo'), false)
  const cartaSemMotivo = montarCarta(lerDadosDaCarta(store, id), new Date(HOJE))
  assert.match(cartaSemMotivo.avisos[0]!, /^O objetivo foi atualizado por Codex em \d{2}\/\d{2}\/\d{4}\. Confira na aba Diretriz\.$/)
})

test('falha ao gravar o motivo reverte a atualização inteira', (t) => {
  const { arquivo, limpar } = criarArquivoTemporario()
  const { store, id } = preparar(t, arquivo)
  const db = new DatabaseSync(arquivo)
  t.after(() => db.close())
  t.after(limpar)
  db.exec(`CREATE TRIGGER bloquear_auditoria BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'teste de rollback'); END`)
  const antes = store.getCharter(id)
  assert.throws(() => store.updateProjectObjective(id, entrada), /teste de rollback/)
  assert.deepEqual(store.listCharterHistory(id), [antes])
  assert.equal(store.getProject(id).project.objective, TEXTO_DO_DONO)
})

test('a permissão do dono exige contexto de autenticação', () => {
  recusa(() => verificarDonoDoObjetivo(undefined, randomUUID()), 403, 'so_o_dono', /conferir ou desfazer/)
})

test('o aviso da atualização vem antes do aviso de diretriz antiga quando os dois aparecem', (t) => {
  const { store, id } = preparar(t)
  store.updateProjectObjective(id, entrada)
  const dados = lerDadosDaCarta(store, id)
  dados.checkpoints = Array.from({ length: 5 }, (_, revision) => ({
    ...store.saveCheckpoint(id, { agent: 'Codex', expectedRevision: revision, idempotencyKey: `aviso-${revision}`, summary: 'Registro', nextStep: 'Próximo' }),
    createdAt: HOJE,
  }))
  const carta = montarCarta(dados, new Date('2026-12-04T18:00:00.000Z'))
  for (const avisos of [carta.avisos, carta.avisosDaRetomada]) {
    assert.equal(avisos.length, 2)
    assert.match(avisos[0]!, /^O objetivo foi atualizado por Codex/)
    assert.match(avisos[1]!, /^A diretriz deste projeto não muda desde/)
  }
})
