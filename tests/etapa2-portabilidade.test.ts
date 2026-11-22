import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test, type TestContext } from 'node:test'
import type { TipoNaLixeira } from '../shared/lixeira.js'
import { createApp } from '../server/app.ts'
import { createProjectBundle, createProjectBundleV2, createProjectBundleV3, parseProjectBundle, PortabilityError } from '../server/portability/index.ts'
import { WorkspaceStore } from '../server/store.ts'

test('v1 e v2 exportam o objetivo da última revisão humana e declaram a omissão da atualização da IA', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Loja', objective: 'Objetivo humano inicial' })
  const atualizar = (objetivo: string, expectedRevision: number) =>
    store.updateProjectObjective(id, { objetivo, expectedRevision, agent: 'Codex', motivo: 'Fato novo' })
  atualizar('Primeira atualização da IA', 1)
  const humana = store.saveCharter(id, { actor: 'Dono', body: 'Último objetivo do dono', expectedRevision: 2 })
  atualizar('Segunda atualização da IA', humana.revision)
  atualizar('Objetivo vigente da IA', humana.revision + 1)
  store.marcarObjetivoVisto(id)
  const pacotes = [createProjectBundle(store.exportProject(id)), createProjectBundleV2(store.exportProjectBundleData(id))]

  for (const pacote of pacotes) {
    const validado = parseProjectBundle(JSON.parse(JSON.stringify(pacote)))
    assert.equal(validado.project.project.objective, humana.body)
    assert.ok(validado.omissions?.some(omissao =>
      omissao.entity === 'charterRevisions' &&
        omissao.reason.includes('última revisão do dono') && omissao.reason.includes('a exportação é recusada')))
    const { project } = store.importProjectBundleData(validado)
    assert.equal(project.objective, humana.body)
    assert.equal(store.getCharter(project.id)?.body, humana.body)
    assert.equal(store.getCharter(project.id)?.sourceKind, 'human_directive')
  }
  assert.equal(store.getCharter(id)?.body, 'Objetivo vigente da IA')
})

test('v1 e v2 recusam exportar um objetivo da IA sem revisão humana, mas v3 preserva sua autoria', async t => {
  const store = new WorkspaceStore(':memory:')
  const { id } = store.createProject({ name: 'Loja', objective: 'Primeiro objetivo' })
  store.updateProjectObjective(id, { objetivo: 'Objetivo da IA', expectedRevision: 1, agent: 'Codex', motivo: 'Fato novo' })
  const pacote = createProjectBundleV3(store.exportProjectBundleData(id))
  const { project } = store.importProjectBundleData({
    ...pacote,
    charterRevisions: pacote.charterRevisions.map(revisao =>
      revisao.sourceKind === 'human_directive' ? { ...revisao, sourceKind: 'agent_proposal' } : revisao),
  })
  const erro = { status: 409, code: 'objetivo_da_ia_sem_versao_do_dono', message: /A versão 3 preserva a autoria/ }
  assert.throws(() => createProjectBundle(store.exportProject(project.id)), erro)
  assert.throws(() => createProjectBundleV2(store.exportProjectBundleData(project.id)), erro)
  assert.equal(createProjectBundleV3(store.exportProjectBundleData(project.id)).charterRevisions.at(-1)?.sourceKind, 'agent_update')
  const api = await servidorLocal(t, store)
  for (const versao of [1, 2]) {
    const resposta = await fetch(`${api}/projects/${project.id}/bundle?version=${versao}`)
    assert.equal(resposta.status, erro.status)
    const { error } = await resposta.json()
    assert.equal(error.code, erro.code)
    assert.match(error.message, erro.message)
  }
})

test('v1 omite mensagens e decisões na lixeira e declara isso no pacote importável', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Loja', objective: 'Conferir o catálogo' })
  const visivel = store.postMessage(id, { from: 'Dono', to: 'Codex', kind: 'note', body: 'Visível' })
  const mensagem = store.postMessage(id, { from: 'Dono', to: 'Codex', kind: 'note', body: 'Mensagem excluída' })
  const decisao = store.proposeDecision(id, { agent: 'Codex', title: 'Decisão excluída', body: 'Texto' })
  store.excluir(id, { tipo: 'mensagem', id: mensagem.id, agent: 'Dono', origem: 'tela' })
  store.excluir(id, { tipo: 'decisao', id: decisao.id, agent: 'Dono', origem: 'tela' })
  const v1 = createProjectBundle(store.exportProject(id))
  assert.deepEqual(v1.project.messages, [visivel])
  assert.ok(v1.omissions?.some(omissao => omissao.entity === 'lixeira' &&
    omissao.reason.includes('mensagens excluídas') && omissao.reason.includes('decisões')))
  const { project, idMap } = store.importProjectBundleData(v1)
  assert.equal(idMap[mensagem.id], undefined)
  assert.equal(idMap[decisao.id], undefined)
  assert.deepEqual(store.getProject(project.id).messages.map(item => item.body), [visivel.body])
  assert.deepEqual(store.listDecisions(project.id, { includeHistory: true }), [])
})

test('v2 não reativa itens da lixeira e aceita dados antigos sem histórico da diretriz', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Loja', objective: 'Objetivo original' })
  const mensagem = store.postMessage(id, { from: 'Dono', to: 'Codex', kind: 'note', body: 'Mensagem excluída' })
  store.excluir(id, { tipo: 'mensagem', id: mensagem.id, agent: 'Dono', origem: 'tela' })
  const dados = store.exportProjectBundleData(id)
  delete dados.charterRevisions
  delete dados.messageResolutions
  const v2 = createProjectBundleV2(dados)
  assert.ok(v2.omissions?.some(omissao => omissao.entity === 'lixeira' && omissao.reason.includes('itens excluídos só viajam na v3')))
  const { project } = store.importProjectBundleData(v2)
  assert.equal(store.getCharter(project.id)?.body, 'Objetivo original')
  assert.deepEqual(store.getProject(project.id).messages, [])
  assert.equal(createProjectBundleV2({ ...dados, charterRevisions: [] }).project.project.objective, 'Objetivo original')
})

test('a diretriz atualizada pela IA viaja no pacote v3 com a revisão anterior e a conferência', t => {
  const origem = new WorkspaceStore(':memory:')
  const destino = new WorkspaceStore(':memory:')
  t.after(() => { origem.close(); destino.close() })
  const { id } = origem.createProject({ name: 'Loja', objective: 'Manter o catálogo antigo' })
  origem.updateProjectObjective(id, { objetivo: 'Manter o catálogo novo', agent: 'Codex', motivo: 'O novo catálogo entrou no ar', expectedRevision: 1 })
  const revisao = origem.marcarObjetivoVisto(id)!
  const bundle = createProjectBundleV3(origem.exportProjectBundleData(id))
  assert.deepEqual(bundle.charterRevisions[1], revisao)
  const { project, idMap } = destino.importProjectBundleData(JSON.parse(JSON.stringify(bundle)))
  assert.equal(project.objective, revisao.body)
  const auditoria = destino.listAuditLogs({ projectId: project.id })
  assert.equal(auditoria.length, 1)
  assert.deepEqual(auditoria.map(({ action, actorType, actorId, resourceType, resourceId, details }) => ({
    action, actorType, actorId, resourceType, resourceId, details,
  })), [{
    action: 'import_project_objective', actorType: 'system', actorId: 'Axon',
    resourceType: 'charter', resourceId: idMap[revisao.id], details: { motivo: revisao.motivo },
  }])
  assert.deepEqual(destino.getCharter(project.id), {
    ...revisao, id: idMap[revisao.id], projectId: project.id, supersedesId: idMap[revisao.supersedesId!],
  })
})

test('o pacote v3 leva a lição excluída com a marca e permite restaurá-la no banco novo', t => {
  const origem = new WorkspaceStore(':memory:')
  const destino = new WorkspaceStore(':memory:')
  t.after(() => { origem.close(); destino.close() })
  const { id } = origem.createProject({ name: 'Loja', objective: 'Conferir o catálogo' })
  const regra = origem.registrarLicao(id, { texto: 'Conferir o estoque', tipo: 'regra', fraseDoDono: 'Conferir o estoque', agent: 'Codex' })
  const item = origem.excluir(id, { tipo: 'licao', id: regra.id, agent: 'Codex', origem: 'mcp', pedidoDoDono: 'Tire essa regra' })
  const bundle = createProjectBundleV3(origem.exportProjectBundleData(id))
  const { project, idMap } = destino.importProjectBundleData(JSON.parse(JSON.stringify(bundle)))
  assert.deepEqual(destino.listarLixeira(project.id), [{ ...item, id: idMap[item.id], projectId: project.id }])
  assert.deepEqual(destino.listarLicoes(project.id), [])
  destino.restaurar(project.id, { tipo: 'licao', id: idMap[item.id], agent: 'Dono' })
  assert.deepEqual(destino.listarLicoes(project.id), [{ ...regra, id: idMap[item.id], projectId: project.id }])
})

test('cada tipo permanece oculto e volta ao seu leitor depois de restaurar', t => {
  const instante = '2026-11-21T03:00:00.000Z'
  const origem = new WorkspaceStore(':memory:', { now: () => new Date(instante) })
  const destino = new WorkspaceStore(':memory:')
  t.after(() => { origem.close(); destino.close() })
  const { id } = origem.createProject({ name: 'Oficina', objective: 'Documentar reparos' })
  const agente = 'Codex'
  const cartao = origem.createBoardCard(id, {
    title: 'Reparar painel', description: 'Apertar a tampa', actor: agente, needsOwner: true,
    column: 'testing', labels: ['test'], priority: 'high', checklist: [{ text: 'Conferir a luz', done: true }],
  })
  const licao = origem.registrarLicao(id, { texto: 'Fotografar etiqueta', agent: agente, linhaCurta: 'Foto da etiqueta' })
  const corrigida = origem.registrarLicao(id, { texto: 'Fotografar as duas etiquetas', agent: agente, substitui: licao.id })
  const decisao = origem.proposeDecision(id, { agent: agente, title: 'Usar peça original', body: 'Disponível no estoque' })
  origem.acceptDecision(id, decisao.id, { actor: 'Dono', expectedVersion: decisao.version })
  const mensagem = origem.postMessage(id, { from: 'Dono', to: agente, kind: 'note', body: 'O manual chegou' })
  const backlog = origem.createBacklogItem(id, { createdBy: agente, title: 'Comprar fusível', stage: 'ready' })
  const { item: biblioteca } = origem.createContent(id, {
    title: 'Manual de troca', kind: 'note', body: 'Desligar o aparelho.', createdBy: agente, sourceKind: 'agent_report',
  })
  const outros = origem.createProject({ name: 'Outro projeto', objective: 'Guardar outro histórico' })
  const itemDeOutroProjeto = origem.registrarLicao(outros.id, { texto: 'Conferir embalagem', agent: agente })
  origem.excluir(outros.id, { tipo: 'licao', id: itemDeOutroProjeto.id, agent: 'Dono', origem: 'tela' })
  const itens: Array<[TipoNaLixeira, string]> = [
    ['cartao', cartao.id], ['licao', licao.id], ['licao', corrigida.id], ['decisao', decisao.id],
    ['mensagem', mensagem.id], ['backlog', backlog.id], ['biblioteca', biblioteca.id],
  ]
  for (const [tipo, itemId] of itens) {
    origem.excluir(id, { tipo, id: itemId, agent: 'Dono', origem: 'tela' })
  }
  const bundle = createProjectBundleV3(origem.exportProjectBundleData(id))
  const { project, idMap } = destino.importProjectBundleData(bundle)
  const projeto = project.id
  assert.deepEqual(destino.listarLixeira(projeto), origem.listarLixeira(id).map(item => ({
    ...item, id: idMap[item.id], projectId: projeto,
  })))
  const leitores = () => [
    destino.getBoard(projeto).cards, destino.listarLicoes(projeto), destino.listDecisions(projeto),
    destino.getProject(projeto).messages, destino.listBacklog(projeto), destino.listContent(projeto),
  ] as const
  assert.deepEqual(leitores(), [[], [], [], [], [], []])
  for (const [tipo, itemId] of itens) {
    const novoId = idMap[itemId]
    assert.notEqual(novoId, itemId)
    destino.restaurar(projeto, { tipo, id: novoId, agent: 'Dono' })
  }
  const [cartoes, licoes, decisoes, mensagens, backlogRestaurado, bibliotecaRestaurada] = leitores()
  assert.deepEqual(cartoes, [{ ...cartao, id: idMap[cartao.id], projectId: projeto }])
  assert.deepEqual(licoes[0], {
    ...corrigida, id: idMap[corrigida.id], projectId: projeto, substituiId: idMap[licao.id],
  })
  assert.equal(decisoes[0]?.id, idMap[decisao.id])
  assert.equal(mensagens[0]?.id, idMap[mensagem.id])
  assert.equal(backlogRestaurado[0]?.id, idMap[backlog.id])
  assert.equal(bibliotecaRestaurada[0]?.item.id, idMap[biblioteca.id])
  assert.deepEqual(destino.listarLixeira(projeto), [])
})

test('o pacote sem lixeira permanece importável e não ganha uma chave vazia', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Oficina', objective: 'Documentar reparos' })
  const bundle = createProjectBundleV3(store.exportProjectBundleData(id))
  assert.equal(Object.hasOwn(bundle, 'lixeira'), false)
  assert.equal(Object.hasOwn(bundle.charterRevisions[0]!, 'vistoPeloDonoEm'), false)
  assert.equal(Object.hasOwn(bundle.charterRevisions[0]!, 'motivo'), false)
  assert.equal(Object.hasOwn(parseProjectBundle(bundle), 'lixeira'), false)
  assert.deepEqual(store.listarLixeira(store.importProjectBundleData(bundle).project.id), [])
})

test('recusa marcas órfãs, repetidas, de outro projeto ou com tipo trocado sem criar projeto parcial', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Oficina', objective: 'Documentar reparos' })
  const mensagem = store.postMessage(id, { from: 'Dono', to: 'IA', kind: 'note', body: 'O manual chegou' })
  store.excluir(id, { tipo: 'mensagem', id: mensagem.id, agent: 'Dono', origem: 'tela' })
  const bundle = createProjectBundleV3(store.exportProjectBundleData(id))
  const [marca] = bundle.lixeira!
  const [cenario] = store.listProjects()
  const invalidos = [
    [[{ ...marca, id: randomUUID() }], /Item da lixeira ausente no pacote/],
    [[{ ...marca, projectId: randomUUID() }], /Marca de lixeira duplicada ou fora do projeto/],
    [[marca, marca], /Marca de lixeira duplicada ou fora do projeto/],
    [[{ ...marca, tipo: 'decisao' as const }], /Item da lixeira ausente no pacote/],
  ] as const
  for (const [marcas, mensagem] of invalidos) {
    assert.throws(() => store.importProjectBundleData({ ...bundle, lixeira: [...marcas] }), (erro) => {
      assert.ok(erro instanceof PortabilityError)
      assert.equal(erro.status, 400)
      assert.equal(erro.code, 'invalid_bundle_reference')
      assert.match(erro.message, mensagem)
      return true
    })
    assert.deepEqual(store.listProjects(), [cenario])
  }
})

test('a lixeira e o motivo da diretriz passam pela mesma máscara de segredos do pacote', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Loja', objective: 'Conferir o catálogo' })
  const segredo = 'Bearer segredo-inventado'
  store.updateProjectObjective(id, { objetivo: 'Catálogo novo', motivo: segredo, agent: 'Codex', expectedRevision: 1 })
  const regra = store.registrarLicao(id, { texto: segredo, fraseDoDono: segredo, linhaCurta: segredo, tipo: 'regra', agent: segredo })
  store.excluir(id, { tipo: 'licao', id: regra.id, agent: segredo, origem: 'mcp', pedidoDoDono: segredo })
  const cartao = store.createBoardCard(id, {
    actor: segredo, title: segredo, description: segredo, checklist: [{ text: segredo }],
  })
  store.excluir(id, { tipo: 'cartao', id: cartao.id, agent: segredo, origem: 'tela' })
  const bundle = createProjectBundleV3(store.exportProjectBundleData(id))
  const texto = JSON.stringify(bundle)
  assert.doesNotMatch(texto, /segredo-inventado/)
  assert.equal(bundle.charterRevisions[1]?.motivo, 'Bearer ***')
  assert.equal(bundle.charterRevisions[1]?.vistoPeloDonoEm, undefined)
  assert.equal(bundle.lixeira?.find(item => item.tipo === 'licao')?.registro.fraseDoDono, 'Bearer ***')
  assert.equal(bundle.lixeira?.find(item => item.tipo === 'cartao')?.registro.checklist[0]?.text, 'Bearer ***')
})

test('uma lição na lixeira não pode assumir o identificador de outro registro importado', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const projeto = store.createProject({ name: 'Oficina', objective: 'Documentar reparos' })
  const licao = store.registrarLicao(projeto.id, { texto: 'Anotar reparo', agent: 'Dono' })
  store.excluir(projeto.id, { tipo: 'licao', id: licao.id, agent: 'Dono', origem: 'tela' })
  const bundle = createProjectBundleV3(store.exportProjectBundleData(projeto.id))
  const marca = { ...bundle.lixeira![0]!, id: projeto.id }
  assert.throws(() => store.importProjectBundleData({ ...bundle, lixeira: [marca] }), (erro) => {
    assert.ok(erro instanceof PortabilityError)
    assert.equal(erro.status, 400)
    assert.equal(erro.code, 'invalid_bundle_reference')
    assert.equal(erro.message, `ID de item da lixeira já usado no pacote: ${projeto.id}.`)
    return true
  })
  assert.deepEqual(store.listProjects(), [projeto])
})

test('uma lição cujo antecessor não viaja é restaurada sem apontar para o banco anterior', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Loja', objective: 'Conferir o catálogo' })
  const antiga = store.registrarLicao(id, { texto: 'Conferir estoque', agent: 'Codex' })
  const atual = store.registrarLicao(id, { texto: 'Conferir preço', agent: 'Codex', substitui: antiga.id })
  store.excluir(id, { tipo: 'licao', id: atual.id, agent: 'Dono', origem: 'tela' })
  const pacote = createProjectBundleV3(store.exportProjectBundleData(id))
  const { project, idMap } = store.importProjectBundleData(pacote)
  store.restaurar(project.id, { tipo: 'licao', id: idMap[atual.id], agent: 'Dono' })
  assert.deepEqual(store.listarLicoes(project.id), [{ ...atual, id: idMap[atual.id], projectId: project.id, substituiId: null }])
})

test('uma atualização sem marca de vista continua pendente na cópia', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const projeto = store.createProject({ name: 'Loja', objective: 'Conferir catálogo' })
  const atual = store.updateProjectObjective(projeto.id, {
    objetivo: 'Publicar catálogo', agent: 'Codex', motivo: 'A loja foi ao ar', expectedRevision: 1,
  })
  const pacote = createProjectBundleV3(store.exportProjectBundleData(projeto.id))
  const { project, idMap } = store.importProjectBundleData({ ...pacote, charterRevisions: pacote.charterRevisions.toReversed() })
  const revisao = store.getCharter(project.id)!
  assert.equal(revisao.motivo, atual.motivo)
  assert.equal(revisao.id, idMap[atual.id])
  assert.equal(Object.hasOwn(revisao, 'vistoPeloDonoEm'), false)
})

test('o importador aceita revisão sem motivo de auditoria e mantém o aviso de pendência', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const projeto = store.createProject({ name: 'Loja', objective: 'Conferir catálogo' })
  const atual = store.updateProjectObjective(projeto.id, {
    objetivo: 'Publicar catálogo', agent: 'Codex', motivo: 'A loja foi ao ar', expectedRevision: 1,
  })
  const pacote = createProjectBundleV3(store.exportProjectBundleData(projeto.id))
  const charterRevisions = pacote.charterRevisions.map(revisao => ({ ...revisao, motivo: undefined }))
  const { project, idMap } = store.importProjectBundleData({ ...pacote, charterRevisions })
  assert.equal(store.getCharter(project.id)?.id, idMap[atual.id])
  assert.equal(store.getCharter(project.id)?.sourceKind, 'agent_update')
  assert.equal(store.getCharter(project.id)?.motivo, undefined)
  assert.equal(store.listAuditLogs({ projectId: project.id }).length, 0)
})

test('a v2 declara a omissão da lixeira e a v3 declara o limite dos cartões', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Loja', objective: 'Conferir o catálogo' })
  const dados = store.exportProjectBundleData(id)
  const v2 = createProjectBundleV2(dados)
  const v3 = createProjectBundleV3(dados)
  const { lixeira: _lixeira, ...legado } = dados
  assert.deepEqual(createProjectBundleV2(legado).project, v2.project)
  const categoriasComuns = v3.omissions!.filter(o => o.entity !== 'board_cards')
  assert.deepEqual(v2.omissions!.filter(o => categoriasComuns.some(comum => comum.entity === o.entity)), categoriasComuns)
  assert.deepEqual(v2.omissions?.filter(o => ['board_cards', 'lixeira'].includes(o.entity)), [
    { entity: 'board_cards', reason: 'O quadro de cartões não viaja na v2.' },
    { entity: 'lixeira', reason: 'Os itens excluídos só viajam na v3. A v2 omite também as resoluções vinculadas a mensagens excluídas.' },
  ])
  assert.deepEqual(v3.omissions?.filter(o => ['board_cards', 'board_card_events'].includes(o.entity)), [
    { entity: 'board_cards', reason: 'Só os cartões que estão na lixeira viajam neste formato.' },
    { entity: 'board_card_events', reason: 'O histórico de eventos dos cartões ainda não viaja neste formato.' },
  ])
})

test('v2 e v3 avisam que o estado dos cartões e o ponto de conferência ficam no projeto original', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const projeto = store.createProject({ name: 'Loja', objective: 'Conferir o catálogo' })
  const dados = store.exportProjectBundleData(projeto.id)
  const esperado = [
    { entity: 'entregas', reason: 'O estado das entregas dos cartões, incluindo aprovações, testes, código e publicações, fica no projeto original.' },
    { entity: 'deliveries[].pontoDeConferencia', reason: 'As passagens viajam sem o ponto de conferência, que fica no projeto original.' },
  ]
  for (const pacote of [createProjectBundleV2(dados), createProjectBundleV3(dados)]) {
    assert.deepEqual(pacote.omissions?.filter(({ entity }) => esperado.some(item => item.entity === entity)), esperado)
  }
})

test('a importação recusa lições incompatíveis com o tipo, o momento e a linha curta', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Loja', objective: 'Conferir o catálogo' })
  const frase = 'Rever o texto da vitrine'
  const verificacao = store.registrarLicao(id, {
    texto: frase, fraseDoDono: frase, momento: 'antes_de_pronto', tipo: 'verificacao', agent: 'Dono',
  })
  store.excluir(id, { tipo: 'licao', id: verificacao.id, agent: 'Dono', origem: 'tela' })
  const pacote = createProjectBundleV3(store.exportProjectBundleData(id))
  const marca = pacote.lixeira!.find(item => item.tipo === 'licao')!
  for (const [campos, mensagem] of [
    [{ fraseDoDono: null }, /Regra e verificação precisam da frase do dono/],
    [{ momento: null }, /Só uma verificação tem momento/],
    [{ tipo: 'regra' }, /Só uma verificação tem momento/],
    [{ linhaCurta: 'Duas\nlinhas' }, /linhaCurta/],
  ] as const) {
    assert.throws(() => parseProjectBundle({ ...pacote, lixeira: [{ ...marca, registro: { ...marca.registro, ...campos } }] }), erro => {
      assert.ok(erro instanceof PortabilityError)
      assert.equal(erro.status, 400)
      assert.equal(erro.code, 'invalid_bundle')
      assert.match(erro.message, mensagem)
      return true
    })
  }
  assert.deepEqual(parseProjectBundle(pacote), pacote)
})

async function servidorLocal(t: TestContext, store: WorkspaceStore) {
  const servidor = createServer(createApp(store))
  servidor.listen(0, '127.0.0.1')
  await once(servidor, 'listening')
  t.after(() => new Promise<void>(resolve => {
    servidor.closeAllConnections()
    servidor.close(() => { store.close(); resolve() })
  }))
  const endereco = servidor.address()
  assert.ok(endereco && typeof endereco !== 'string')
  return `http://127.0.0.1:${endereco.port}/api`
}

test('o GET HTTP exporta diretriz e lixeira com 200 e o POST importa em outro banco com 201', async t => {
  const origem = new WorkspaceStore(':memory:')
  const destino = new WorkspaceStore(':memory:')
  const { id } = origem.createProject({ name: 'Loja', objective: 'Manter o catálogo antigo' })
  const revisao = origem.updateProjectObjective(id, {
    objetivo: 'Manter o catálogo novo', agent: 'Codex', motivo: 'Catálogo publicado', expectedRevision: 1,
  })
  const mensagem = origem.postMessage(id, { from: 'Dono', to: 'Codex', kind: 'note', body: 'Mensagem para a lixeira' })
  origem.excluir(id, { tipo: 'mensagem', id: mensagem.id, agent: 'Dono', origem: 'tela' })
  const [api, apiDestino] = await Promise.all([servidorLocal(t, origem), servidorLocal(t, destino)])
  const exportacao = await fetch(`${api}/projects/${id}/bundle`)
  assert.equal(exportacao.status, 200)
  const pacote = await exportacao.json()
  const importacao = await fetch(`${apiDestino}/import`, {
    method: 'POST', headers: { 'X-Workspace-Client': 'local', 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundle: pacote }),
  })
  assert.equal(importacao.status, 201)
  const { project, idMap } = await importacao.json() as ReturnType<WorkspaceStore['importProjectBundleData']>
  assert.equal(destino.getCharter(project.id)?.sourceKind, 'agent_update')
  assert.equal(destino.getCharter(project.id)?.supersedesId, idMap[revisao.supersedesId!])
  assert.deepEqual(destino.getProject(project.id).messages, [])
  assert.equal(destino.listarLixeira(project.id)[0]?.id, idMap[mensagem.id])
})

test('uma marca mantém o tipo do alvo mesmo quando um pacote reaproveita o UUID entre tipos', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const projeto = store.createProject({ name: 'Oficina', objective: 'Documentar reparos' })
  const mensagem = store.postMessage(projeto.id, { from: 'Dono', to: 'IA', kind: 'note', body: 'Mandar manual' })
  store.proposeDecision(projeto.id, { agent: 'IA', title: 'Anexar o manual', body: 'Para orientar o reparo' })
  store.excluir(projeto.id, { tipo: 'mensagem', id: mensagem.id, agent: 'Dono', origem: 'tela' })
  const pacote = createProjectBundleV3(store.exportProjectBundleData(projeto.id))
  const decisions = pacote.decisions.map(decisao => ({ ...decisao, id: mensagem.id }))
  const antes = store.listProjects()
  assert.throws(() => store.importProjectBundleData({ ...pacote, decisions }), erro => {
    assert.ok(erro instanceof PortabilityError)
    assert.equal(erro.status, 400)
    assert.equal(erro.code, 'invalid_bundle_reference')
    assert.equal(erro.message, 'O alvo de uma marca da lixeira não corresponde ao tipo declarado.')
    return true
  })
  assert.deepEqual(store.listProjects(), antes)
  const [marca] = store.listarLixeira(projeto.id)
  assert.equal(marca?.id, mensagem.id)
})

test('aceita o tipo legado agent_proposal e reserva o motivo de atualização para agent_update', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Loja', objective: 'Conferir o catálogo' })
  const dados = store.exportProjectBundleData(id)
  const legado = { ...dados.charterRevisions![0]!, sourceKind: 'agent_proposal' as const, motivo: 'Nota importada' }
  const pacote = createProjectBundleV3({ ...dados, charterRevisions: [legado] })
  assert.equal(pacote.charterRevisions[0]?.sourceKind, 'agent_proposal')
  const { project } = store.importProjectBundleData(pacote)
  assert.deepEqual(store.listAuditLogs({ projectId: project.id }), [])
})

test('o limite real do motivo de aposentadoria e todas as prioridades usadas no quadro cabem na lixeira portável', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Loja', objective: 'Conferir o catálogo' })
  const texto = 'Usar o endereço novo'
  const licao = store.registrarLicao(id, { texto, tipo: 'regra', fraseDoDono: texto, agent: 'Dono' })
  const aposentada = store.aposentarLicao(licao.id, { agent: 'Dono', motivo: 'm'.repeat(500), pedidoDoDono: 'p'.repeat(500) })
  store.excluir(id, { tipo: 'licao', id: licao.id, agent: 'Dono', origem: 'tela' })
  for (const priority of ['urgent', 'high', 'medium', 'low'] as const) {
    const cartao = store.createBoardCard(id, { title: `Prazo ${priority}`, actor: 'Dono', priority })
    store.excluir(id, { tipo: 'cartao', id: cartao.id, agent: 'Dono', origem: 'tela' })
  }
  const pacote = createProjectBundleV3(store.exportProjectBundleData(id))
  assert.deepEqual(pacote.lixeira?.filter(item => item.tipo === 'cartao').map(item => item.registro.priority), ['low', 'medium', 'high', 'urgent'])
  assert.equal(pacote.lixeira?.find(item => item.tipo === 'licao')?.registro.motivoAposentadoria, aposentada.motivoAposentadoria)
})

test('o vínculo de substituição só remapeia lições, mesmo quando houver um cartão com o UUID citado', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Loja', objective: 'Conferir o catálogo' })
  const licao = store.registrarLicao(id, { texto: 'Usar o endereço novo', agent: 'Dono' })
  const cartao = store.createBoardCard(id, { title: 'Mudar endereço', actor: 'Dono' })
  store.excluir(id, { tipo: 'licao', id: licao.id, agent: 'Dono', origem: 'tela' })
  store.excluir(id, { tipo: 'cartao', id: cartao.id, agent: 'Dono', origem: 'tela' })
  const pacote = createProjectBundleV3(store.exportProjectBundleData(id))
  const lixeira = pacote.lixeira!.map(item => item.tipo !== 'licao' ? item : ({
    ...item, registro: { ...item.registro, substituiId: cartao.id },
  }))
  const { project, idMap } = store.importProjectBundleData({ ...pacote, lixeira })
  store.restaurar(project.id, { tipo: 'licao', id: idMap[licao.id], agent: 'Dono' })
  assert.equal(store.listarLicoes(project.id)[0]?.substituiId, null)
})

test('a ida e volta v2 omite quatro tipos da lixeira e as resoluções que perderiam mensagens', t => {
  const origem = new WorkspaceStore(':memory:')
  const destino = new WorkspaceStore(':memory:')
  t.after(() => { origem.close(); destino.close() })
  const { id } = origem.createProject({ name: 'Oficina', objective: 'Planejar reparos' })
  const pergunta = (body: string) => origem.postMessage(id, { from: 'Dono', to: 'Codex', kind: 'question', body })
  const excluida = pergunta('Pergunta excluída')
  const semResposta = pergunta('Pergunta cuja resposta foi excluída')
  const visivel = pergunta('Pergunta com resolução preservada')
  const resposta = origem.postMessage(id, { from: 'Codex', to: 'Dono', kind: 'note', body: 'Resposta excluída' })
  origem.resolveMessageAttention(id, excluida.id, { agent: 'Codex', note: 'Resolvida' })
  origem.resolveMessageAttention(id, semResposta.id, { agent: 'Codex', responseMessageId: resposta.id })
  origem.resolveMessageAttention(id, visivel.id, { agent: 'Codex', note: 'Resolvida' })
  const cartao = origem.createBoardCard(id, { title: 'Trocar a peça', actor: 'Dono' })
  const backlog = origem.createBacklogItem(id, { title: 'Comprar a peça', createdBy: 'Dono' })
  const ativo = origem.createBacklogItem(id, { title: 'Conferir o manual', createdBy: 'Dono' })
  const decisao = origem.proposeDecision(id, { title: 'Guardar a peça', body: 'Para referência', agent: 'Codex' })
  const excluidos: Array<[TipoNaLixeira, string]> = [
    ['cartao', cartao.id], ['mensagem', excluida.id], ['mensagem', resposta.id],
    ['backlog', backlog.id], ['decisao', decisao.id],
  ]
  for (const [tipo, itemId] of excluidos) {
    origem.excluir(id, { tipo, id: itemId, agent: 'Dono', origem: 'tela' })
  }

  const dados = origem.exportProjectBundleData(id)
  const pacote = createProjectBundleV2(dados)
  assert.deepEqual(pacote.messageResolutions?.map(item => item.messageId), [visivel.id])
  const { project, idMap } = destino.importProjectBundleData(JSON.parse(JSON.stringify(pacote)))
  for (const [, itemId] of excluidos) assert.equal(idMap[itemId], undefined)
  assert.deepEqual(destino.getProject(project.id).messages.map(item => item.body).sort(), [semResposta.body, visivel.body].sort())
  assert.deepEqual(destino.listBacklog(project.id).map(item => item.title), [ativo.title])
  assert.deepEqual(destino.getBoard(project.id).cards, [])
  assert.deepEqual(destino.listDecisions(project.id, { includeHistory: true }), [])
  assert.deepEqual(destino.listarLixeira(project.id), [])
  assert.equal(origem.listarLixeira(id).length, excluidos.length)

  const marcaDoCartao = dados.lixeira!.find(item => item.tipo === 'cartao')!
  const comIdsReutilizados = createProjectBundleV2({
    ...dados,
    lixeira: [
      ...dados.lixeira!,
      { ...marcaDoCartao, id: ativo.id },
      { ...marcaDoCartao, id: visivel.id },
    ],
  })
  assert.deepEqual(comIdsReutilizados.backlogItems, pacote.backlogItems)
  assert.deepEqual(comIdsReutilizados.project.messages, pacote.project.messages)
})
