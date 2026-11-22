import assert from 'node:assert/strict'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { APROVACAO_VISUAL, COMMIT_LOCAL, RAMO_LOCAL, montarCenarioDepoimentos } from './cenarios/depoimentos.ts'

test('depoimentos: chat, evidência, código local, autorização pela tela e só então publicação registrada', async (t) => {
  const { store, projectId, ids } = montarCenarioDepoimentos()
  t.after(() => store.close())
  const servidor = createApp(store).listen(0, '127.0.0.1')
  t.after(() => promisify(servidor.close.bind(servidor))())
  await new Promise<void>((resolve, reject) => servidor.once('listening', resolve).once('error', reject))
  const endereco = servidor.address()
  assert.ok(endereco && typeof endereco !== 'string')
  const raiz = `http://127.0.0.1:${endereco.port}/api/projects/${projectId}`
  const cardId = ids.cartaoDepoimentos
  const entrega = `/entregas/${cardId}`
  const alvo = { projectId, cardId, agent: 'Claude' }
  const mcp = createMcpServer(store)
  const cliente = new Client({ name: 'entrega-testes', version: '1' })
  const [clienteTransporte, servidorTransporte] = InMemoryTransport.createLinkedPair()
  await mcp.connect(servidorTransporte)
  await cliente.connect(clienteTransporte)
  t.after(async () => { await cliente.close(); await mcp.close() })

  async function tool(name: string, args: Record<string, unknown> = alvo, erro?: string) {
    const resultado = await cliente.callTool({ name, arguments: args })
    assert.equal(resultado.isError === true, erro !== undefined, JSON.stringify(resultado))
    assert.ok(Array.isArray(resultado.content))
    const conteudo = resultado.content[0]
    assert.equal(conteudo.type, 'text')
    if (name === 'get_resume_brief') return conteudo.text as string
    const json = JSON.parse(conteudo.text)
    if (erro) assert.equal(json.error.code, erro)
    return json
  }

  async function http(path: string, body?: unknown, token?: string, status = 200, code?: string) {
    const r = await fetch(raiz + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'X-Workspace-Client': 'local', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await r.json()
    assert.equal(r.status, status, JSON.stringify(json))
    if (code) assert.equal(json.error.code, code)
    return json
  }

  const leitura = () => tool('get_resume_brief', { projectId, modo: 'curto', agent: 'IA nova' })
  const pendente = await tool('get_delivery')
  assert.equal(pendente.aprovacoes[0].origem, 'chat')
  assert.equal(pendente.aprovacoes[0].fraseDoDono, APROVACAO_VISUAL)
  assert.equal(pendente.testes.estado, 'passando')
  assert.equal(pendente.testes.evidenciaId, ids.evidenciaVerde)
  assert.equal(pendente.codigo.onde, 'local')
  assert.equal(pendente.codigo.commit, COMMIT_LOCAL)
  assert.equal(pendente.codigo.ramo, RAMO_LOCAL)
  assert.deepEqual(await tool('update_delivery', {
    ...alvo, testes: { estado: 'passando', evidenciaId: ids.evidenciaVerde },
    codigo: { onde: 'local', commit: COMMIT_LOCAL, ramo: RAMO_LOCAL },
  }), pendente)
  assert.deepEqual(await http('/entregas'), [pendente])
  assert.deepEqual(await http(entrega), pendente)
  const antes = await leitura()
  assert.match(antes, /## Depende do dono[\s\S]*?## Entregas em andamento/)
  assert.match(antes, new RegExp(`\\[cartao:${cardId}\\] .*aprovado \\(visual\\).*testes passando.*commit local ${COMMIT_LOCAL}.*publicação pendente: nenhum ambiente autorizado ainda`))
  assert.match(antes, /dito pelo dono no chat, registrado por Claude \(nome declarado\)/)
  assert.doesNotMatch(antes, /publicação autorizada|publicado em staging/)
  const cartaHttp = await http('/carta')
  const cartaMcp = await tool('get_where_we_stopped', { projectId })
  assert.deepEqual(cartaHttp.entregas, cartaMcp.entregas)
  assert.equal(cartaHttp.entregas[0].cardId, cardId)
  assert.match(cartaHttp.entregas[0].resumo, /publicação pendente: nenhum ambiente autorizado ainda/)

  await tool('record_owner_approval', { ...alvo, tipo: 'visual' }, 'frase_do_dono_obrigatoria')
  await tool('record_owner_approval', { ...alvo, tipo: 'publicacao', fraseDoDono: 'pode publicar' }, 'ambiente_obrigatorio')
  await tool('undo_owner_approval', { ...alvo, aprovacaoId: pendente.aprovacoes[0].id }, 'pedido_do_dono_obrigatorio')
  const publicacao = { ambiente: 'staging', commit: COMMIT_LOCAL, evidenciaId: ids.evidenciaVerde }
  await tool('update_delivery', { ...alvo, publicacao }, 'publicacao_sem_autorizacao')
  await http(`${entrega}/aprovar`, { tipo: 'publicacao' }, undefined, 400, 'ambiente_obrigatorio')

  const tokenAgente = store.createAuthToken({ name: 'Agente', tokenType: 'agent', role: 'agent', agentName: 'IA' }).token
  const tokenLeitor = store.createAuthToken({ name: 'Leitor', tokenType: 'user_session', role: 'observer' }).token
  const outro = store.createProject({ name: 'Outro projeto', objective: 'Outro contexto.' })
  const tokenOutro = store.createAuthToken({ name: 'Outro escopo', tokenType: 'agent', role: 'agent', agentName: 'IA', projectId: outro.id }).token
  await http('/entregas', undefined, tokenOutro, 403, 'forbidden_project_scope')
  await http(entrega, undefined, tokenOutro, 403, 'forbidden_project_scope')
  await http(`${entrega}/aprovar`, { tipo: 'publicacao', ambiente: 'staging' }, tokenAgente, 403, 'so_o_dono')
  await http(`${entrega}/aprovar`, { tipo: 'publicacao', ambiente: 'staging' }, tokenLeitor, 403, 'so_o_dono')

  const autorizada = await http(`${entrega}/aprovar`, {
    tipo: 'publicacao', ambiente: 'staging', versao: COMMIT_LOCAL,
    origem: 'chat', registradaPor: 'Identidade do corpo', fraseDoDono: 'frase do corpo',
  })
  const aprovacao = autorizada.aprovacoes[1]
  assert.equal(aprovacao.origem, 'tela')
  assert.equal(aprovacao.registradaPor, 'local-operator')
  assert.equal(aprovacao.fraseDoDono, null)
  assert.equal(aprovacao.versao, COMMIT_LOCAL)
  assert.deepEqual(autorizada.publicacoes, [])
  assert.deepEqual(await http(`${entrega}/aprovar`, { tipo: 'publicacao', ambiente: 'staging', versao: COMMIT_LOCAL }), autorizada)
  const depoisDaAutorizacao = await leitura()
  assert.match(depoisDaAutorizacao, /publicação autorizada para staging/)
  assert.match(depoisDaAutorizacao, /publicação em staging: dono pela tela/)
  assert.doesNotMatch(depoisDaAutorizacao, /publicado em staging|falta autorização para staging/)

  const publicada = await tool('update_delivery', { ...alvo, publicacao })
  assert.deepEqual(publicada.publicacoes, [{ ...publicacao, publicadoEm: publicada.atualizadoEm, registradoPor: 'Claude' }])
  assert.deepEqual(await tool('update_delivery', { ...alvo, publicacao }), publicada)
  assert.match(await leitura(), /publicado em staging, commit a1b2c3d \(relato de Claude\)/)
  assert.doesNotMatch(await leitura(), /publicação autorizada para staging|falta autorização para staging/)

  const desfazer = `${entrega}/aprovacoes/${aprovacao.id}/desfazer`
  await http(desfazer, {}, tokenAgente, 403, 'so_o_dono')
  const desfeita = await http(desfazer, {})
  assert.deepEqual(desfeita.aprovacoes[1], { ...aprovacao, desfeitaEm: desfeita.atualizadoEm, desfeitaPor: { origem: 'tela' } })
  assert.deepEqual(desfeita.publicacoes, publicada.publicacoes)
  assert.deepEqual(await http(desfazer, {}), desfeita)

  const aprovarNoChat = { ...alvo, agent: 'Codex', tipo: 'visual', fraseDoDono: 'gostei da revisão', origem: 'tela' }
  const revisada = await tool('record_owner_approval', aprovarNoChat)
  const chat = revisada.aprovacoes[2]
  assert.equal(chat.origem, 'chat')
  assert.equal(chat.registradaPor, 'Codex')
  assert.equal(chat.fraseDoDono, aprovarNoChat.fraseDoDono)
  assert.deepEqual(await tool('record_owner_approval', aprovarNoChat), revisada)
  const desfeitaNoChat = await tool('undo_owner_approval', { ...alvo, aprovacaoId: chat.id, pedidoDoDono: 'desfaz a aprovação da revisão' })
  assert.deepEqual(desfeitaNoChat.aprovacoes[2], {
    ...chat, desfeitaEm: desfeitaNoChat.atualizadoEm,
    desfeitaPor: { origem: 'chat', agente: 'Claude', pedidoDoDono: 'desfaz a aprovação da revisão' },
  })
  assert.deepEqual(await tool('get_delivery'), desfeitaNoChat)

  store.excluir(projectId, { tipo: 'cartao', id: cardId, agent: 'Claude', pedidoDoDono: 'tirar da lista', origem: 'mcp' })
  assert.deepEqual(await http('/entregas'), [])
  await http(entrega, undefined, undefined, 409, 'ja_na_lixeira')
  await http(`${entrega}/aprovar`, { tipo: 'visual' }, undefined, 409, 'ja_na_lixeira')
  await http(desfazer, {}, undefined, 409, 'ja_na_lixeira')
  await tool('get_delivery', alvo, 'ja_na_lixeira')
  await tool('update_delivery', alvo, 'ja_na_lixeira')
  await tool('record_owner_approval', { ...alvo, tipo: 'visual', fraseDoDono: APROVACAO_VISUAL }, 'ja_na_lixeira')
  await tool('undo_owner_approval', { ...alvo, aprovacaoId: aprovacao.id, pedidoDoDono: 'desfaz' }, 'ja_na_lixeira')
})
