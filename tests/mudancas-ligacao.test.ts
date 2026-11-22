import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { lerPedidoCurto } from '../server/carta/leitura-curta-entrada.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { WorkspaceStore } from '../server/store.ts'

it('get_resume_brief anuncia a marca, devolve o delta, recusa desde inválido e volta à leitura inteira para marcas antigas', async (t) => {
  const instante = Date.now() - 2000
  const store = new WorkspaceStore(':memory:', { now: () => new Date(instante) })
  const servidor = createMcpServer(store)
  const cliente = new Client({ name: 'mudancas-ligacao', version: '1.0.0' })
  t.after(async () => {
    await cliente.close()
    await servidor.close()
    store.close()
  })
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair()
  await servidor.connect(ladoServidor)
  await cliente.connect(ladoCliente)

  const pasta = 'D:/Trabalho/Axon-E4-teste'
  const projeto = store.createProject({ name: 'Projeto E4', objective: 'Ler o que mudou', workspacePath: pasta })
  const anterior = store.proposeDecision(projeto.id, { agent: 'Astra', title: 'Usar papel', body: 'Texto anterior' })
  const aceita = store.acceptDecision(projeto.id, anterior.id, { actor: 'Astra', expectedVersion: anterior.version })
  const vigente = store.supersedeDecision(projeto.id, anterior.id, { actor: 'Astra', expectedVersion: aceita.version, title: 'Usar tela', body: 'Texto vigente' })
  async function ler(argumentos: Record<string, unknown>) {
    const resposta = await cliente.callTool({ name: 'get_resume_brief', arguments: { projectId: projeto.id, agent: 'Codex', modo: 'curto', ...argumentos } })
    const [{ text }] = resposta.content as Array<{ text: string }>
    return { texto: text, erro: resposta.isError }
  }

  const desde = new Date(instante - 1).toISOString()
  const { texto } = await ler({ desde })
  assert.ok(texto.startsWith(`# O que mudou desde ${desde}\n`))
  assert.ok(texto.includes(`[decisao:${anterior.id}]`))
  assert.ok(texto.includes(`Vigente: [decisao:${vigente.id}] Usar tela`))

  const completa = await ler({})
  const marca = /^Leitura feita em (\S+)\. Para receber só o que mudou depois desta, use desde=\1\.$/m.exec(completa.texto)
  assert.ok(marca)
  assert.equal(completa.texto.split('\n')[2], marca[0])
  const porPasta = await ler({ projectId: undefined, pasta: `${pasta}/server` })
  assert.equal(porPasta.erro, undefined)
  assert.ok(porPasta.texto.startsWith('# Leitura curta — Projeto E4\n'))
  const vazia = await ler({ desde: marca[1] })
  assert.ok(vazia.texto.includes(`Nada relevante mudou desde ${marca[1]}.`))
  assert.match(vazia.texto, /^Leitura feita em /m)

  for (const invalido of ['ontem', '2099-01-01T00:00:00.000Z', '', 123]) {
    const recusa = await ler({ desde: invalido })
    assert.equal(recusa.erro, true)
    assert.equal(JSON.parse(recusa.texto).error.code, 'desde_invalido')
  }

  const antiga = await ler({ desde: '2000-01-01T00:00:00.000Z', maxChars: 2000 })
  assert.ok(antiga.texto.startsWith('# Leitura curta — Projeto E4\n'))
  assert.match(antiga.texto, /melhor fazer a leitura inteira/)
  assert.match(antiga.texto, /## Onde parou/)
  assert.ok(antiga.texto.length <= 2000)

  const legado = await ler({ modo: undefined, desde: 'ontem' })
  assert.equal(JSON.parse(legado.texto).project.id, projeto.id)
})

it('lê a passagem para o agente, as transições intermediárias e a lixeira no banco', (t) => {
  let agora = new Date('2026-11-19T12:00:00.000Z')
  const store = new WorkspaceStore(':memory:', { now: () => agora })
  t.after(() => store.close())
  const projeto = store.createProject({ name: 'Continuidade', objective: 'Conferir o delta' })
  const p = projeto.id
  const desde = agora.toISOString()
  const cartao = store.createBoardCard(p, { actor: 'Astra', title: 'Revisar as artes' })
  const regra = store.registrarLicao(p, { agent: 'Astra', tipo: 'regra', texto: 'Antes da entrega.', fraseDoDono: 'Antes da entrega.' })
  const mensagem = store.postMessage(p, { from: 'Astra', to: 'Codex', kind: 'note', body: 'Prévia anterior.' })
  agora = new Date('2026-11-20T12:00:00.000Z')
  const corrigida = store.registrarLicao(p, { agent: 'Astra', tipo: 'regra', texto: 'Antes da revisão.', fraseDoDono: 'Antes da revisão.', substitui: regra.id })
  const revisao = store.getProject(p).project.revision
  const registro = store.saveCheckpoint(p, { expectedRevision: revisao, idempotencyKey: 'checkpoint', agent: 'Astra', summary: 'Detalhes técnicos', humanSummary: 'Artes separadas.', nextStep: 'Revisar o contraste.' })
  const passagem = store.createHandoffDelivery(p, { from: 'Astra', to: 'Codex', checkpointId: registro.id, message: 'Confira o contraste das artes.' })
  const outraPassagem = store.createHandoffDelivery(p, { from: 'Astra', to: 'Gemini', checkpointId: registro.id, message: 'Revisar textos.' })
  store.acknowledgeHandoffDelivery(p, passagem.id, { agent: 'Codex' })
  const pedido = store.proposeApproval(p, { agent: 'Astra', kind: 'note', title: 'Proposta visual', body: 'Prévia', rationale: 'Escolher a foto' })
  store.approveApproval(p, pedido.id, { actor: 'Dono', expectedVersion: pedido.version })
  const bloqueio = store.openBlocker(p, { agent: 'Astra', title: 'Arquivo da foto', body: 'Aguardando original' })
  store.resolveBlocker(p, bloqueio.id, { agent: 'Astra', expectedVersion: bloqueio.version, note: 'Original recebido' })
  const movido = store.moveBoardCard(p, cartao.id, { actor: 'Astra', expectedVersion: cartao.version, column: 'testing' })
  agora = new Date('2026-11-21T12:00:00.000Z')
  store.moveBoardCard(p, cartao.id, { actor: 'Astra', expectedVersion: movido.version, column: 'pending' })
  store.excluir(p, { origem: 'tela', agent: 'Dono', tipo: 'cartao', id: cartao.id })
  store.excluir(p, { origem: 'tela', agent: 'Dono', tipo: 'mensagem', id: mensagem.id })

  const texto = lerPedidoCurto(store, { projectId: p, agent: 'Codex', desde }, () => agora)
  assert.ok(texto.includes(`[licao:${corrigida.id}] Regra corrigida: Antes da revisão. · Anterior: [licao:${regra.id}] Antes da entrega.`))
  assert.ok(texto.includes(`[aprovacao:${pedido.id}] Pedido aprovado na tela: Proposta visual`))
  assert.ok(texto.includes(`[passagem:${passagem.id}] Passagem de Astra para Codex: Confira o contraste das artes.`))
  assert.ok(!texto.includes(outraPassagem.id))
  assert.ok(texto.includes(`[bloqueio:${bloqueio.id}] Bloqueio aberto: Arquivo da foto`))
  assert.ok(texto.includes(`[bloqueio:${bloqueio.id}] Bloqueio resolvido: Arquivo da foto`))
  assert.ok(texto.includes(`[checkpoint:${registro.id}] Artes separadas. · Próximo passo registrado: Revisar o contraste.`))
  assert.ok(texto.includes(`[cartao:${cartao.id}] Revisar as artes. Moveu de Em teste para Pendente`))
  assert.ok(texto.includes(`[cartao:${cartao.id}] Revisar as artes. Moveu de Pendente para Em teste`))
  assert.ok(texto.includes(`[cartao:${cartao.id}] Foi para a lixeira: Revisar as artes`))
  assert.ok(texto.includes(`[mensagem:${mensagem.id}] Foi para a lixeira: Prévia anterior.`))
})

it('uma volta da lixeira continua no delta após nova exclusão e respeita a marca da leitura', (t) => {
  let agora = new Date('2026-11-19T12:00:00.000Z')
  const store = new WorkspaceStore(':memory:', { now: () => agora })
  t.after(() => store.close())
  const { id: projectId } = store.createProject({ name: 'Continuidade', objective: 'Conferir a restauração' })
  const { id } = store.createBoardCard(projectId, { actor: 'Astra', title: 'Revisar as artes' })
  const alvo = { tipo: 'cartao', id, agent: 'Dono' }
  store.excluir(projectId, { ...alvo, origem: 'tela' })
  const desde = agora.toISOString()
  agora = new Date('2026-11-20T12:00:00.000Z')
  store.restaurar(projectId, alvo)
  const ler = (marca: string) => lerPedidoCurto(store, { projectId, agent: 'Codex', desde: marca }, () => agora)
  const volta = `- [cartao:${id}] Voltou da lixeira: Revisar as artes`
  const ida = `- [cartao:${id}] Foi para a lixeira: Revisar as artes`
  assert.ok(ler(desde).endsWith(volta))
  assert.match(ler(agora.toISOString()), /Nada relevante mudou/)
  agora = new Date('2026-11-21T12:00:00.000Z')
  store.excluir(projectId, { ...alvo, origem: 'tela' })
  assert.ok(ler(desde).endsWith(`${ida}\n${volta}`))
})

it('reserva a marca e o aviso de mais de 90 dias dentro dos 2.000 caracteres da leitura inteira', (t) => {
  let agora = new Date('2026-11-20T12:00:00.000Z')
  const store = new WorkspaceStore(':memory:', { now: () => agora })
  t.after(() => store.close())
  const projeto = store.createProject({ name: 'A'.repeat(160), objective: 'Conferir o limite' })
  const p = projeto.id
  const checkpoint = store.saveCheckpoint(p, {
    agent: 'A'.repeat(80), expectedRevision: 0, idempotencyKey: 'aviso-antigo',
    summary: 'Resumo técnico', humanSummary: 'palavra '.repeat(30), nextStep: 'passo '.repeat(100),
    evidence: [{ command: 'C'.repeat(100), outcome: 'passed', details: '' }],
  })
  agora = new Date('2026-11-21T12:00:00.000Z')
  const nota = store.proposeApproval(p, { agent: 'Astra', kind: 'note', title: 'A'.repeat(100), body: 'Corpo', rationale: 'Razão' })
  store.proposeApproval(p, { agent: 'Astra', kind: 'note', title: 'B'.repeat(100), body: 'Corpo', rationale: 'Razão' })
  store.approveApproval(p, nota.id, { actor: 'Dono', expectedVersion: nota.version })
  store.createHandoffDelivery(p, { from: checkpoint.agent, to: 'Codex', checkpointId: checkpoint.id, message: 'P'.repeat(250) })
  store.openBlocker(p, { agent: 'Astra', title: 'B'.repeat(190), body: 'Aguardando' })
  store.createBoardCard(p, { actor: 'Astra', title: 'Q'.repeat(80), column: 'in_progress' })
  const proposta = store.proposeDecision(p, { agent: 'Astra', title: 'D'.repeat(190), body: 'Proposta' })
  store.acceptDecision(p, proposta.id, { actor: 'Astra', expectedVersion: proposta.version })
  for (let i = 0; i < 20; i++) {
    const texto = `${i}: ${'palavra '.repeat(30)}`
    store.registrarLicao(p, { texto, agent: 'Astra', tipo: 'regra', fraseDoDono: texto })
    store.registrarLicao(p, { texto, agent: 'Astra', tipo: 'verificacao', momento: 'antes_de_commit', fraseDoDono: texto })
    store.registrarLicao(p, { texto, agent: 'Astra' })
  }
  const ler = () => lerPedidoCurto(store, { projectId: p, agent: 'Codex', maxChars: 2000, desde: '2026-01-01T00:00:00Z' }, () => agora)
  const texto = ler()
  assert.ok(texto.length <= 2000, `A leitura tem ${texto.length} caracteres.`)
  assert.match(texto, /^Leitura feita em 2026-11-21T12:00:00.000Z\./m)
  assert.match(texto, /melhor fazer a leitura inteira/)
  assert.match(texto, /Próximo passo anotado no último registro/)
  assert.match(texto, /Atenção: .* verificações do dono ficaram fora/)

  store['db'].prepare('UPDATE projects SET name = ? WHERE id = ?').run('A'.repeat(24), p)
  const naBorda = ler()
  assert.ok(naBorda.length <= 2000, `A leitura na borda tem ${naBorda.length} caracteres.`)
  assert.match(naBorda, /palavra palavra/)
  assert.match(naBorda, /passo passo/)
})

it('recalcula a cobertura do arquivo que mudou mesmo com o registro anterior à marca', (t) => {
  const pasta = mkdtempSync(join(tmpdir(), 'axon-e4-'))
  const nome = 'resultado.txt'
  const arquivo = join(pasta, nome)
  let agora = new Date('2026-11-19T12:00:00.000Z')
  const store = new WorkspaceStore(':memory:', { now: () => agora })
  t.after(() => {
    store.close()
    rmSync(arquivo, { force: true })
    rmdirSync(pasta)
  })
  const projeto = store.createProject({ name: 'Cobertura', objective: 'Conferir o arquivo atual', workspacePath: pasta })
  writeFileSync(arquivo, 'versão conferida')
  store.saveCheckpoint(projeto.id, {
    expectedRevision: 0, idempotencyKey: 'evidencia', agent: 'Codex', summary: 'Relato', nextStep: 'Conferir',
    evidence: [{ command: 'validar arquivo', outcome: 'passed', details: 'Relato', artifacts: [{
      path: nome, sha256: createHash('sha256').update('versão conferida').digest('hex'),
    }] }],
  })
  const desde = '2026-11-20T12:00:00.000Z'
  agora = new Date('2026-11-19T13:00:00.000Z')
  rmSync(arquivo)
  assert.equal(store.listEvidence(projeto.id)[0].freshness, 'missing')
  agora = new Date('2026-11-21T12:00:00.000Z')
  const ler = () => lerPedidoCurto(store, { projectId: projeto.id, agent: 'Codex', desde }, () => agora)
  assert.ok(ler().includes(`Nada relevante mudou desde ${desde}.`))
  assert.match(ler(), /\n\n1 evidências fora da cobertura da versão atual: list_evidence .*get_evidence.*\.$/)
  assert.doesNotMatch(ler(), /validar arquivo|\[evidencia:/)
})
