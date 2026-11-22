import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { WorkspaceStore } from '../server/store.ts'
import { DomainError } from '../server/store/errors.ts'
import { conferirEscopoDaEntrega, donoDaEntrega, resumirEntregas, resumoDaEntrega } from '../server/store/entrega.ts'

const agent = 'Claude'
const fraseDoDono = ' gostei das artes  '
const visual = { agent, tipo: 'visual', fraseDoDono }
const staging = { agent, tipo: 'publicacao', ambiente: 'staging', fraseDoDono: 'pode publicar no staging' }
const commit = 'a1b2c3d'

function cenario(t: TestContext) {
  let segundos = 0
  const store = new WorkspaceStore(':memory:', { now: () => new Date(Date.UTC(2026, 10, 21, 0, 0, segundos++)) })
  t.after(() => store.close())
  const projectId = store.createProject({ name: 'Depoimentos', objective: 'Melhorar a página.' }).id
  const cardId = store.createBoardCard(projectId, { actor: agent, title: 'Três artes' }).id
  return { store, projectId, cardId }
}

function recusa(fn: () => unknown, status: number, code: string, mensagem?: RegExp) {
  assert.throws(fn, (erro: unknown) => {
    assert.ok(erro instanceof DomainError)
    assert.equal(erro.status, status)
    assert.equal(erro.code, code)
    if (mensagem) assert.match(erro.message, mensagem)
    return true
  })
}

test('um cartão antigo não ganha estado até o primeiro registro; alterações parciais e retries preservam o restante', (t) => {
  const { store, projectId, cardId } = cenario(t)
  assert.equal(store.getDelivery(projectId, cardId), null)
  assert.deepEqual(store.listDeliveries(projectId), [])
  assert.equal(store.updateDelivery(projectId, cardId, { agent }), null)
  const testes = store.updateDelivery(projectId, cardId, { agent, testes: { estado: 'falhando' } })!
  assert.deepEqual(testes, {
    cardId,
    testes: { estado: 'falhando', evidenciaId: null, em: testes.atualizadoEm },
    codigo: { onde: 'nao_feito', commit: null, ramo: null, em: null },
    publicacoes: [],
    aprovacoes: [],
    atualizadoEm: '2026-11-21T00:00:03.000Z',
  })
  const codigo = { onde: 'local', commit, ramo: 'feat/depoimentos' }
  const local = store.updateDelivery(projectId, cardId, { agent, codigo })!
  assert.deepEqual(local.testes, testes.testes)
  assert.deepEqual(local.codigo, { ...codigo, em: local.atualizadoEm })
  assert.deepEqual(store.updateDelivery(projectId, cardId, { agent, codigo }), local)
  assert.deepEqual(store.updateDelivery(projectId, cardId, { agent }), local)
  assert.deepEqual(store.getDelivery(projectId, cardId), local)
  assert.deepEqual(store.listDeliveries(projectId), [local])
})

test('aprovação literal do chat é própria do tipo e fica no histórico após desfazer', (t) => {
  const { store, projectId, cardId } = cenario(t)
  const aprovada = store.recordOwnerApproval(projectId, cardId, { ...visual, versao: commit, ambiente: 'produção' })
  const [aprovacao] = aprovada.aprovacoes
  assert.ok(aprovacao?.id)
  assert.deepEqual(aprovacao, {
    id: aprovacao.id, tipo: 'visual', ambiente: null, origem: 'chat', fraseDoDono,
    versao: commit, registradaPor: agent, em: aprovada.atualizadoEm, desfeitaEm: null,
  })
  assert.deepEqual(store.recordOwnerApproval(projectId, cardId, { ...visual, versao: commit }), aprovada)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, publicacao: { ambiente: 'staging' } }), 409, 'publicacao_sem_autorizacao', /dono.*staging/i)
  recusa(() => store.undoOwnerApproval(projectId, cardId, aprovacao.id, { chat: { agent } }), 400, 'pedido_do_dono_obrigatorio')
  const pedido = { agent: 'Codex', pedidoDoDono: ' desfaz a aprovação das artes ' }
  const desfeita = store.undoOwnerApproval(projectId, cardId, aprovacao.id, { chat: pedido })
  assert.notEqual(desfeita.atualizadoEm, aprovada.atualizadoEm)
  assert.deepEqual(desfeita.aprovacoes, [{
    ...aprovacao, desfeitaEm: desfeita.atualizadoEm,
    desfeitaPor: { origem: 'chat', agente: pedido.agent, pedidoDoDono: pedido.pedidoDoDono },
  }])
  assert.deepEqual(store.undoOwnerApproval(projectId, cardId, aprovacao.id, { chat: { agent, pedidoDoDono: 'Repita' } }), desfeita)
  const auditoria = store.listAuditLogs({ projectId })
  assert.equal(auditoria.length, 1)
  assert.deepEqual(auditoria[0], {
    id: auditoria[0].id, timestamp: auditoria[0].timestamp, projectId, status: 'success', ipAddress: null,
    actorType: 'agent', actorId: pedido.agent, action: 'entrega.aprovacao_desfeita',
    resourceType: 'aprovacao', resourceId: aprovacao.id,
    details: { cardId, origem: 'chat', pedidoDoDono: pedido.pedidoDoDono },
  })
  const aprovadaDeNovo = store.recordOwnerApproval(projectId, cardId, { ...visual, versao: commit })
  assert.equal(aprovadaDeNovo.aprovacoes.length, 2)
  assert.deepEqual(aprovadaDeNovo.aprovacoes[0], desfeita.aprovacoes[0])
})

test('publicação exige autorização vigente para o ambiente e é guardada uma vez por fato', (t) => {
  const { store, projectId, cardId } = cenario(t)
  const autorizada = store.recordOwnerApproval(projectId, cardId, staging)
  const [aprovacao] = autorizada.aprovacoes
  assert.equal(aprovacao?.ambiente, 'staging')
  assert.equal(aprovacao?.versao, null)
  assert.deepEqual(autorizada.publicacoes, [])
  recusa(() => store.updateDelivery(projectId, cardId, { agent, publicacao: { ambiente: 'produção', commit } }), 409, 'publicacao_sem_autorizacao')
  const publicacao = { ambiente: 'staging', commit }
  const publicada = store.updateDelivery(projectId, cardId, { agent, publicacao })!
  assert.deepEqual(publicada.publicacoes, [
    { ...publicacao, publicadoEm: publicada.atualizadoEm, evidenciaId: null, registradoPor: agent },
  ])
  assert.deepEqual(store.updateDelivery(projectId, cardId, { agent, publicacao }), publicada)
  const desfeita = store.undoOwnerApproval(projectId, cardId, aprovacao!.id, { chat: { agent, pedidoDoDono: 'volta a autorização' } })
  assert.deepEqual(desfeita.publicacoes, publicada.publicacoes)
  assert.deepEqual(store.updateDelivery(projectId, cardId, { agent, publicacao }), desfeita)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, publicacao: { ambiente: 'staging', commit: 'b2c3d4e' } }), 409, 'publicacao_sem_autorizacao')
})

test('recusas de entrada e lixeira mantêm o estado do cartão intacto', (t) => {
  const { store, projectId, cardId } = cenario(t)
  recusa(() => store.recordOwnerApproval(projectId, cardId, { ...visual, fraseDoDono: ' \n ' }), 400, 'frase_do_dono_obrigatoria')
  recusa(() => store.recordOwnerApproval(projectId, cardId, { ...staging, ambiente: undefined }), 400, 'ambiente_obrigatorio')
  recusa(() => store.updateDelivery(projectId, cardId, { agent, publicacao: {} }), 400, 'ambiente_obrigatorio')
  recusa(() => store.undoOwnerApproval(projectId, cardId, cardId, { chat: { agent, pedidoDoDono: 'desfaz' } }), 404, 'not_found', /Aprovação não encontrada neste cartão/)
  assert.equal(store.getDelivery(projectId, cardId), null)
  const antes = store.recordOwnerApproval(projectId, cardId, visual)
  store.excluir(projectId, { tipo: 'cartao', id: cardId, agent, pedidoDoDono: 'põe o cartão na lixeira', origem: 'mcp' })
  assert.deepEqual(store.listDeliveries(projectId), [])
  recusa(() => store.getDelivery(projectId, cardId), 409, 'ja_na_lixeira')
  recusa(() => store.updateDelivery(projectId, cardId, { agent }), 409, 'ja_na_lixeira')
  recusa(() => store.recordOwnerApproval(projectId, cardId, staging), 409, 'ja_na_lixeira')
  recusa(() => store.undoOwnerApproval(projectId, cardId, antes.aprovacoes[0]!.id, { chat: { agent, pedidoDoDono: 'desfaz' } }), 409, 'ja_na_lixeira')
  store.restaurar(projectId, { tipo: 'cartao', id: cardId, agent })
  assert.deepEqual(store.getDelivery(projectId, cardId), antes)
})

test('a primeira gravação conjunta é atômica e aceita evidências do próprio projeto', (t) => {
  const { store, projectId, cardId } = cenario(t)
  const outro = store.createProject({ name: 'Outro projeto', objective: 'Separar os dados.' }).id
  const cartaoAlheio = store.createBoardCard(outro, { actor: agent, title: 'Outras artes' }).id
  const salvarEvidencia = (id: string) => {
    const checkpoint = store.saveCheckpoint(id, {
      agent, idempotencyKey: 'verificar-a-entrega', expectedRevision: 0,
      summary: 'Resultado relatado', nextStep: 'Conferir', evidence: [{ command: 'testar prévia', outcome: 'passed', details: 'Prévia conferida.' }],
    })
    return store.listEvidence(id, { checkpointId: checkpoint.id })[0]!.id
  }
  const evidenciaId = salvarEvidencia(projectId)
  const idAlheio = salvarEvidencia(outro)
  const codigo = { onde: 'local', commit }
  const testes = { estado: 'passando', evidenciaId }
  recusa(() => store.getDelivery(projectId, cartaoAlheio), 404, 'not_found', /Cartão não encontrado no projeto/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, testes: { ...testes, evidenciaId: idAlheio } }), 404, 'not_found', /Evidência não encontrada no projeto/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, testes, codigo, publicacao: { ambiente: 'staging' } }), 409, 'publicacao_sem_autorizacao')
  assert.equal(store.getDelivery(projectId, cardId), null)
  store.recordOwnerApproval(projectId, cardId, staging)
  const publicacao = { ambiente: 'staging', commit, evidenciaId }
  const entrega = store.updateDelivery(projectId, cardId, { agent, testes, codigo, publicacao })!
  assert.deepEqual(entrega.testes, { ...testes, em: entrega.atualizadoEm })
  assert.deepEqual(entrega.codigo, { ...codigo, ramo: null, em: entrega.atualizadoEm })
  assert.deepEqual(entrega.publicacoes, [{ ...publicacao, publicadoEm: entrega.atualizadoEm, registradoPor: agent }])
  assert.deepEqual(store.updateDelivery(projectId, cardId, { agent, testes, codigo, publicacao }), entrega)
  assert.equal(resumoDaEntrega(entrega), 'testes passando (relato) · commit local a1b2c3d · publicado em staging, commit a1b2c3d (relato de Claude)')
  const semEvidencia = store.updateDelivery(projectId, cardId, { agent, testes: { ...testes, evidenciaId: null } })!
  assert.equal(semEvidencia.testes.evidenciaId, null)
  assert.notEqual(semEvidencia.testes.em, entrega.testes.em)
  const semRamo = store.updateDelivery(projectId, cardId, { agent, codigo: { ...codigo, ramo: 'prova' } })!
  assert.equal(semRamo.codigo.ramo, 'prova')
  const enviado = store.updateDelivery(projectId, cardId, { agent, codigo: { ...codigo, onde: 'enviado', ramo: 'prova' } })!
  assert.equal(enviado.codigo.onde, 'enviado')
  const outroCommit = store.updateDelivery(projectId, cardId, { agent, codigo: { ...codigo, onde: 'enviado', ramo: 'prova', commit: 'b2c3d4e' } })!
  assert.equal(outroCommit.codigo.commit, 'b2c3d4e')
  const segunda = store.updateDelivery(projectId, cardId, { agent, publicacao: { ...publicacao, evidenciaId: null } })!
  assert.equal(segunda.publicacoes.length, 2)
  assert.equal(segunda.publicacoes[1]!.evidenciaId, null)
  store.recordOwnerApproval(projectId, cardId, { ...staging, ambiente: 'produção' })
  const terceira = store.updateDelivery(projectId, cardId, { agent, publicacao: { ...publicacao, ambiente: 'produção' } })!
  assert.equal(terceira.publicacoes.length, 3)
  assert.equal(terceira.publicacoes[2]!.ambiente, 'produção')
  assert.deepEqual(store.listDeliveries(outro), [])
})

test('recusas distinguem valores ausentes, inválidos e identificadores fora do cartão', (t) => {
  const { store, projectId, cardId } = cenario(t)
  for (const frase of [undefined, null, ' \n ']) {
    recusa(() => store.recordOwnerApproval(projectId, cardId, { ...visual, fraseDoDono: frase }), 400, 'frase_do_dono_obrigatoria', /frase do dono.*chat/)
  }
  for (const ambiente of [undefined, null, ' \t ']) {
    recusa(() => store.recordOwnerApproval(projectId, cardId, { ...staging, ambiente }), 400, 'ambiente_obrigatorio', /Informe o ambiente de publicação/)
  }
  recusa(() => store.recordOwnerApproval(projectId, cardId, { ...staging, ambiente: 42 }), 400, 'invalid_input', /Campo ambiente inválido/)
  recusa(() => store.recordOwnerApproval(projectId, cardId, { ...visual, versao: 42 }), 400, 'invalid_input', /Campo versao inválido/)
  recusa(() => store.recordOwnerApproval(projectId, cardId, { ...visual, fraseDoDono: 42 }), 400, 'invalid_input', /Campo fraseDoDono inválido/)
  recusa(() => store.recordOwnerApproval(projectId, cardId, { ...visual, agent: 42 }), 400, 'invalid_input', /Campo agent inválido/)
  recusa(() => store.recordOwnerApproval(projectId, cardId, { ...visual, tipo: 'deploy' }), 400, 'invalid_input', /Campo tipo inválido\. Valores aceitos: visual, publicacao\./)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, testes: { estado: 'passou' } }), 400, 'invalid_input', /Campo testes\.estado inválido/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, codigo: { onde: 'push' } }), 400, 'invalid_input', /Campo codigo\.onde inválido/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, codigo: { onde: 'local', commit: 42 } }), 400, 'invalid_input', /Campo codigo\.commit inválido/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, codigo: { onde: 'local', ramo: 42 } }), 400, 'invalid_input', /Campo codigo\.ramo inválido/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, testes: { estado: 'passando', evidenciaId: 42 } }), 400, 'invalid_input', /Campo evidenciaId inválido/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, publicacao: { ambiente: 'staging', commit: 42 } }), 400, 'invalid_input', /Campo publicacao\.commit inválido/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent: 42 }), 400, 'invalid_input', /Campo agent inválido/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, codigo: [] }), 400, 'invalid_input', /Dados de codigo inválidos/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, testes: [] }), 400, 'invalid_input', /Dados de testes inválidos/)
  recusa(() => store.updateDelivery(projectId, cardId, { agent, publicacao: [] }), 400, 'invalid_input', /Dados de publicacao inválidos/)
  recusa(() => store.updateDelivery(projectId, cardId, []), 400, 'invalid_input', /Dados de entrega inválidos/)
  recusa(() => store.recordOwnerApproval(projectId, cardId, []), 400, 'invalid_input', /Dados de aprovação da entrega inválidos/)
  const { aprovacoes: [a] } = store.recordOwnerApproval(projectId, cardId, visual)
  for (const pedidoDoDono of [undefined, null, ' \n ']) {
    recusa(() => store.undoOwnerApproval(projectId, cardId, a!.id, { chat: { agent, pedidoDoDono } }), 400, 'pedido_do_dono_obrigatorio', /pedido do dono para desfazer/)
  }
  recusa(() => store.undoOwnerApproval(projectId, cardId, a!.id, { chat: [] }), 400, 'invalid_input', /Dados de pedido do dono inválidos/)
  recusa(() => store.undoOwnerApproval(projectId, cardId, a!.id, { chat: { agent, pedidoDoDono: 42 } }), 400, 'invalid_input', /Campo pedidoDoDono inválido/)
  recusa(() => store.undoOwnerApproval(projectId, cardId, a!.id, { chat: { agent: 42, pedidoDoDono: 'desfaz' } }), 400, 'invalid_input', /Campo agent inválido/)
  recusa(() => store.undoOwnerApproval(projectId, cardId, cardId, 'tela'), 404, 'not_found', /Aprovação não encontrada neste cartão/)
  recusa(() => store.undoOwnerApproval(projectId, cardId, 'errado', 'tela'), 400, 'invalid_input', /aprovacaoId/)
})

test('cada aprovação preserva escopo e autoria e o resumo omite cartões encerrados', (t) => {
  const { store, projectId, cardId } = cenario(t)
  store.recordOwnerApproval(projectId, cardId, visual)
  store.recordOwnerApproval(projectId, cardId, { ...visual, fraseDoDono: 'gostei de novo' })
  store.recordOwnerApproval(projectId, cardId, { ...visual, agent: 'Codex' })
  store.recordOwnerApproval(projectId, cardId, { ...visual, versao: 'v2' })
  store.recordOwnerApproval(projectId, cardId, { tipo: 'visual' }, 'dono')
  store.recordOwnerApproval(projectId, cardId, { ...staging, fraseDoDono: 'pode publicar' })
  const aprovada = store.recordOwnerApproval(projectId, cardId, { ...staging, fraseDoDono: 'pode publicar', ambiente: ' produção ' })
  assert.equal(aprovada.aprovacoes.length, 7)
  assert.equal(aprovada.aprovacoes[6]!.ambiente, 'produção')
  const encerrado = store.createBoardCard(projectId, { actor: agent, title: 'Pronto', column: 'done' })
  const descartado = store.createBoardCard(projectId, { actor: agent, title: 'Descartado', column: 'discarded' })
  store.recordOwnerApproval(projectId, encerrado.id, visual)
  store.recordOwnerApproval(projectId, descartado.id, visual)
  const titulo = '  Três artes \n## Título achatado  '
  const estadoFalhando = store.updateDelivery(projectId, cardId, { agent, testes: { estado: 'falhando' }, codigo: { onde: 'enviado' } })!
  const cartoes = store.getBoard(projectId).cards.map((c) => c.id === cardId ? { ...c, title: titulo } : c)
  const resumo = 'aprovado (visual) · testes falhando (relato) · código enviado · publicação autorizada para staging · publicação autorizada para produção'
  assert.equal(resumoDaEntrega(estadoFalhando), resumo)
  const resumos = resumirEntregas(store.listDeliveries(projectId), cartoes)
  assert.deepEqual(resumos, [{
    cardId, titulo: 'Três artes ## Título achatado', resumo,
    autorias: [
      'visual: dito pelo dono no chat, registrado por Claude (nome declarado)',
      'visual: dito pelo dono no chat, registrado por Codex (nome declarado)',
      'visual: dono pela tela',
      'publicação em staging: dito pelo dono no chat, registrado por Claude (nome declarado)',
      'publicação em produção: dito pelo dono no chat, registrado por Claude (nome declarado)',
    ],
  }])
  const publicada = store.updateDelivery(projectId, cardId, { agent, publicacao: { ambiente: 'produção' } })!
  const desfeita = store.undoOwnerApproval(projectId, cardId, aprovada.aprovacoes[5]!.id, 'tela')
  assert.deepEqual(desfeita.aprovacoes[5]?.desfeitaPor, { origem: 'tela' })
  assert.deepEqual(store.listAuditLogs({ projectId }), [])
  assert.deepEqual(desfeita.publicacoes, publicada.publicacoes)
  assert.equal(resumoDaEntrega(desfeita), 'aprovado (visual) · testes falhando (relato) · código enviado · publicado em produção (relato de Claude) · publicação pendente: falta autorização para staging')
})

test('o histórico fica em ordem de atualização e a autoria só vem da autenticação HTTP', (t) => {
  const { store, projectId, cardId } = cenario(t)
  const outro = store.createBoardCard(projectId, { actor: agent, title: 'Outra entrega' }).id
  const primeiro = store.updateDelivery(projectId, cardId, { agent, codigo: { onde: 'local', commit: null } })!
  const segundo = store.recordOwnerApproval(projectId, outro, visual)
  assert.deepEqual(store.listDeliveries(projectId), [segundo, primeiro])
  // Nenhum ambiente citado: o resumo não supõe "staging".
  assert.equal(resumoDaEntrega(primeiro), 'testes ainda não rodados · código local · publicação pendente: nenhum ambiente autorizado ainda')
  assert.equal(resumoDaEntrega(segundo), 'aprovado (visual) · testes ainda não rodados · código ainda não feito · publicação pendente: nenhum ambiente autorizado ainda')
  recusa(() => donoDaEntrega(undefined, projectId), 403, 'so_o_dono', /Só o dono pode aprovar/)
  const auth = { actorType: 'user', actorId: 'dono', role: 'owner', projectId } as const
  assert.equal(donoDaEntrega(auth, projectId), 'dono')
  recusa(() => donoDaEntrega({ ...auth, actorType: 'agent' }, projectId), 403, 'so_o_dono')
  recusa(() => donoDaEntrega({ ...auth, role: 'observer' }, projectId), 403, 'so_o_dono')
  recusa(() => conferirEscopoDaEntrega({ ...auth, projectId: outro }, projectId), 403, 'forbidden_project_scope', /token não possui permissão/)
  recusa(() => donoDaEntrega({ ...auth, projectId: outro }, projectId), 403, 'forbidden_project_scope')
  assert.equal(conferirEscopoDaEntrega(undefined, projectId), undefined)
})

test('reabrir o banco conserva a entrega e apagar o cartão de vez remove o estado dependente', (t) => {
  const pasta = mkdtempSync(join(tmpdir(), 'axon-entregas-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  const arquivo = join(pasta, 'entregas.sqlite')
  const primeira = new WorkspaceStore(arquivo)
  const projectId = primeira.createProject({ name: 'Entregas', objective: 'Após reabertura.' }).id
  const cardId = primeira.createBoardCard(projectId, { actor: agent, title: 'Depoimentos' }).id
  const aprovada = primeira.recordOwnerApproval(projectId, cardId, visual)
  primeira.close()
  const store = new WorkspaceStore(arquivo)
  try {
    assert.deepEqual(store.getDelivery(projectId, cardId), aprovada)
    const alvo = { tipo: 'cartao', id: cardId, agent }
    store.excluir(projectId, { ...alvo, pedidoDoDono: 'põe o cartão na lixeira', origem: 'mcp' })
    store.apagarDeVez(projectId, { ...alvo, pedidoDoDono: 'apaga de vez', confirmar: true })
    recusa(() => store.getDelivery(projectId, cardId), 404, 'not_found')
    assert.deepEqual(store.listDeliveries(projectId), [])
  } finally {
    store.close()
  }
})
