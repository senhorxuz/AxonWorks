import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Duplex } from 'node:stream'
import { test, type TestContext } from 'node:test'
import { createApp } from '../server/app.js'
import { WorkspaceStore } from '../server/store.js'
import type { Licao } from '../shared/licoes.js'

/** Dá ao servidor HTTP um fluxo em memória, sem abrir porta ou conexão de rede. */
class ConexaoEmMemoria extends Duplex {
  readonly resposta: Buffer[] = []

  _read() {}

  _write(pedaco: Buffer, _encoding: BufferEncoding, pronto: () => void) {
    this.resposta.push(pedaco)
    pronto()
  }

  setTimeout() { return this }
  destroySoon() { this.end() }
}

function preparar(t: TestContext) {
  const store = new WorkspaceStore(':memory:')
  const servidor = createServer(createApp(store))
  t.after(() => store.close())
  const projeto = store.createProject({ name: 'Projeto da tela', objective: 'Conferir suas regras' })
  const outro = store.createProject({ name: 'Outro projeto', objective: 'Conferir o isolamento' })
  const caminho = `/api/projects/${projeto.id}/licoes`

  function chamar(rota = caminho, dados?: unknown, token?: string) {
    const conexao = new ConexaoEmMemoria()
    const corpo = dados === undefined ? '' : JSON.stringify(dados)
    const cabecalhos = [
      `${dados === undefined ? 'GET' : 'POST'} ${rota} HTTP/1.0`,
      'Host: localhost',
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(corpo)}`,
    ]
    if (dados !== undefined) cabecalhos.push('X-Workspace-Client: local')
    if (token) cabecalhos.push(`Authorization: Bearer ${token}`)
    return new Promise<{ status: number; corpo: unknown }>((resolve, reject) => {
      const limite = setTimeout(() => conexao.destroy(new Error(`A rota ${rota} não encerrou a resposta HTTP.`)), 2000)
      conexao.once('error', erro => { clearTimeout(limite); reject(erro) })
      conexao.once('finish', () => {
        clearTimeout(limite)
        try {
          const resposta = Buffer.concat(conexao.resposta).toString('utf8')
          const status = Number(resposta.split(' ')[1])
          const json = JSON.parse(resposta.slice(resposta.indexOf('\r\n\r\n') + 4)) as unknown
          resolve({ status, corpo: json })
        } catch (erro) {
          reject(erro)
        } finally {
          conexao.destroy()
        }
      })
      servidor.emit('connection', conexao)
      conexao.push(`${cabecalhos.join('\r\n')}\r\n\r\n${corpo}`)
    })
  }

  return { store, projeto, outro, caminho, chamar }
}

function recusou(resposta: { status: number; corpo: unknown }, status: number, code: string, message?: string) {
  assert.equal(resposta.status, status)
  const erro = (resposta.corpo as { error: { message: string } }).error
  assert.equal(typeof erro.message, 'string')
  assert.ok(erro.message.length > 0)
  assert.deepEqual(resposta.corpo, { error: { code, message: message ?? erro.message } })
}

function licao(resposta: { status: number; corpo: unknown }, status: number): Licao {
  assert.equal(resposta.status, status)
  return resposta.corpo as Licao
}

test('aposentar e corrigir uma lição na lixeira devolvem o código do conflito', async t => {
  const { store, projeto, outro, caminho, chamar } = preparar(t)
  const removida = store.registrarLicao(projeto.id, { texto: 'Conferência anterior', agent: 'Codex' })
  store.excluir(projeto.id, { tipo: 'licao', id: removida.id, agent: 'Dono', origem: 'tela' })
  recusou(await chamar(`${caminho}/${removida.id}/aposentar`, { motivo: 'Obsoleta' }), 409, 'ja_na_lixeira')
  recusou(await chamar(`${caminho}/${removida.id}/corrigir`, { texto: 'Conferência nova' }), 409, 'ja_na_lixeira')
  recusou(await chamar(`/api/projects/${outro.id}/licoes/${removida.id}/corrigir`, { texto: 'Conferência nova' }), 404, 'not_found')
  assert.deepEqual(await chamar(caminho), { status: 200, corpo: [] })
})

test('GET lista projeto e erros gerais, filtra tipo e inclui aposentadas só quando solicitado', async t => {
  const { store, projeto, outro, caminho, chamar } = preparar(t)
  const regra = store.registrarLicao(projeto.id, { tipo: 'regra', texto: 'Manter o título', fraseDoDono: 'Mantenha o título', agent: 'Claude' })
  const global = store.registrarLicao(null, { texto: 'Rever o caminho do terminal', agent: 'Codex' })
  const erro = store.registrarLicao(projeto.id, { texto: 'Conferir a vigência', agent: 'Claude' })
  const aposentada = store.aposentarLicao(erro.id, { motivo: 'Já resolvido', agent: 'Claude' })
  store.registrarLicao(outro.id, { texto: 'Ajustar o modelo', agent: 'Claude' })

  assert.deepEqual(await chamar(), { status: 200, corpo: [regra, global] })
  assert.deepEqual(await chamar(`${caminho}?tipo=erro&incluirAposentadas=true`), { status: 200, corpo: [global, aposentada] })
  assert.deepEqual(await chamar(`${caminho}?tipo=regra&incluirAposentadas=false`), { status: 200, corpo: [regra] })
  assert.deepEqual(await chamar(`${caminho}?incluirAposentadas=false`), { status: 200, corpo: [regra, global] })
})

test('GET recusa filtros inválidos e projetos inexistentes', async t => {
  const { caminho, chamar } = preparar(t)
  recusou(await chamar(`${caminho}?tipo=decisao`), 400, 'invalid_input')
  recusou(await chamar(`${caminho}?tipo=erro&tipo=regra`), 400, 'invalid_input')
  for (const query of ['incluirAposentadas=sim', 'incluirAposentadas=true&incluirAposentadas=false']) {
    recusou(await chamar(`${caminho}?${query}`), 400, 'invalid_input', 'Escolha se quer incluir as lições aposentadas.')
  }
  recusou(await chamar(`/api/projects/${randomUUID()}/licoes`), 404, 'not_found')
})

test('POST cria regra e verificação em nome do dono, inclusive quando a escrita é repetida', async t => {
  const { projeto, caminho, chamar, store } = preparar(t)
  const dados = { tipo: 'regra', texto: 'Sempre  revisar o título.', linhaCurta: 'Revisar o título', agent: 'Outro', fraseDoDono: 'Outra frase', global: true }
  const regra = licao(await chamar(caminho, dados), 201)
  assert.equal(regra.projectId, projeto.id)
  assert.equal(regra.origem, 'Dono')
  assert.equal(regra.tipo, 'regra')
  assert.equal(regra.texto, dados.texto)
  assert.equal(regra.fraseDoDono, dados.texto)
  assert.equal(regra.linhaCurta, dados.linhaCurta)
  assert.equal(regra.substituiId, null)
  assert.deepEqual(licao(await chamar(caminho, { ...dados, texto: 'Sempre revisar o título.' }), 201), regra)
  const verificacao = licao(await chamar(caminho, { tipo: 'verificacao', texto: 'Conferir a página.', momento: 'antes_de_subir' }), 201)
  assert.equal(verificacao.tipo, 'verificacao')
  assert.equal(verificacao.momento, 'antes_de_subir')
  assert.equal(verificacao.fraseDoDono, verificacao.texto)
  assert.deepEqual(store.listarLicoes(projeto.id), [regra, verificacao])
})

test('POST recusa tipo, campos e momento inválidos com o código correspondente', async t => {
  const { caminho, chamar, projeto, store } = preparar(t)
  for (const dados of [{ tipo: 'erro', texto: 'Um erro' }, { texto: 'Sem tipo' }, { tipo: 'outra', texto: 'Outro' }]) {
    recusou(await chamar(caminho, dados), 400, 'invalid_input', 'Escolha entre regra e verificação.')
  }
  recusou(await chamar(caminho, []), 400, 'invalid_input', 'Dados de lição inválidos.')
  for (const texto of [' ', 12, 'x'.repeat(501)]) {
    recusou(await chamar(caminho, { tipo: 'regra', texto }), 400, 'invalid_input', 'Campo texto inválido.')
  }
  for (const extras of [{ linhaCurta: 'a\nb' }, { momento: null }]) {
    recusou(await chamar(caminho, { tipo: 'regra', texto: 'Conferir', ...extras }), 400, 'invalid_input')
  }
  recusou(await chamar(caminho, { tipo: 'regra', texto: 'Acento \uFFFD' }), 400, 'corrupted_text')
  recusou(await chamar(caminho, { tipo: 'regra', texto: 'Conferir', momento: 'antes_de_commit' }), 400, 'momento_so_em_verificacao')
  recusou(await chamar(caminho, { tipo: 'verificacao', texto: 'Conferir' }), 400, 'momento_obrigatorio')
  recusou(await chamar(`/api/projects/${randomUUID()}/licoes`, { tipo: 'regra', texto: 'Conferir' }), 404, 'not_found')
  assert.deepEqual(store.listarLicoes(projeto.id), [])
})

test('corrigir preserva tipo, escopo e momento, grava em nome do dono e guarda o original', async t => {
  const { store, projeto, caminho, chamar } = preparar(t)
  const casos = [
    store.registrarLicao(projeto.id, { tipo: 'regra', texto: 'Cuidado com o título', fraseDoDono: 'Cuide do título', agent: 'Claude' }),
    store.registrarLicao(projeto.id, { tipo: 'verificacao', texto: 'Testar antes', fraseDoDono: 'Rode o teste', momento: 'antes_de_pronto', agent: 'Claude' }),
    store.registrarLicao(null, { texto: 'Usar caminho completo', agent: 'Claude' }),
  ]
  for (const antiga of casos) {
    const texto = `${antiga.texto}.`
    const corrigida = licao(await chamar(`${caminho}/${antiga.id}/corrigir`, {
      texto, linhaCurta: 'Resumo', tipo: 'erro', momento: 'antes_de_subir', agent: 'Outro', substitui: randomUUID(),
    }), 201)
    assert.notEqual(corrigida.id, antiga.id)
    assert.equal(corrigida.substituiId, antiga.id)
    assert.equal(corrigida.texto, texto)
    assert.equal(corrigida.fraseDoDono, antiga.tipo === 'erro' ? null : texto)
    assert.equal(corrigida.tipo, antiga.tipo)
    assert.equal(corrigida.momento, antiga.momento)
    assert.equal(corrigida.projectId, antiga.projectId)
    assert.equal(corrigida.origem, 'Dono')
    assert.equal(corrigida.linhaCurta, 'Resumo')
    const anterior = store.listarLicoes(projeto.id, { incluirAposentadas: true }).find(item => item.id === antiga.id)!
    assert.ok(anterior.aposentadaEm)
    assert.equal(anterior.fraseDoDono, antiga.fraseDoDono)
    assert.equal(anterior.texto, antiga.texto)
    assert.equal(anterior.motivoAposentadoria, `substituída por ${corrigida.id}`)
  }
})

test('corrigir recusa duplicata, corpo inválido e uma versão já aposentada', async t => {
  const { store, projeto, caminho, chamar } = preparar(t)
  const criar = (texto: string) => store.registrarLicao(projeto.id, { tipo: 'regra', texto, fraseDoDono: texto, agent: 'Claude' })
  const antiga = criar('Conferir a página')
  const outra = criar('Conferir o preço')
  const corrigir = `${caminho}/${antiga.id}/corrigir`
  recusou(await chamar(corrigir, { texto: outra.texto }), 409, 'licao_igual_ja_existe')
  recusou(await chamar(corrigir, { texto: '' }), 400, 'invalid_input', 'Campo texto inválido.')
  recusou(await chamar(corrigir, []), 400, 'invalid_input', 'Dados de correção inválidos.')
  assert.deepEqual(store.listarLicoes(projeto.id), [antiga, outra])
  store.aposentarLicao(antiga.id, { motivo: 'Era temporária', pedidoDoDono: 'Desfaça', agent: 'Dono' })
  recusou(await chamar(corrigir, { texto: 'Conferir de novo' }), 409, 'lesson_already_retired')
})

test('aposentar guarda o motivo como pedido do dono e aceita erros do projeto e gerais', async t => {
  const { store, projeto, caminho, chamar } = preparar(t)
  const casos = [
    store.registrarLicao(projeto.id, { tipo: 'regra', texto: 'Conferir preço', fraseDoDono: 'Confira o preço', agent: 'Claude' }),
    store.registrarLicao(projeto.id, { texto: 'Erro do projeto', agent: 'Claude' }),
    store.registrarLicao(null, { texto: 'Erro geral', agent: 'Claude' }),
  ]
  const motivo = 'A orientação mudou.'
  for (const item of casos) {
    const rota = `${caminho}/${item.id}/aposentar`
    const aposentada = licao(await chamar(rota, { motivo, pedidoDoDono: 'Ignorado' }), 200)
    assert.equal(aposentada.id, item.id)
    assert.ok(aposentada.aposentadaEm)
    assert.equal(aposentada.motivoAposentadoria, `${motivo} (pedido do dono: "${motivo}")`)
    recusou(await chamar(rota, { motivo: 'Outro motivo' }), 409, 'lesson_already_retired')
  }
  assert.deepEqual(store.listarLicoes(projeto.id), [])
})

test('aposentar exige motivo do dono e rejeita dados inválidos', async t => {
  const { store, projeto, caminho, chamar } = preparar(t)
  const regra = store.registrarLicao(projeto.id, { tipo: 'regra', texto: 'Conferir preço', fraseDoDono: 'Confira o preço', agent: 'Claude' })
  const rota = `${caminho}/${regra.id}/aposentar`
  for (const dados of [{}, { motivo: ' \t ', pedidoDoDono: 'Outro texto' }]) {
    recusou(await chamar(rota, dados), 400, 'pedido_do_dono_obrigatorio', 'Escreva o motivo para retirar a lição.')
  }
  for (const dados of [{ motivo: 4 }, { motivo: 'x'.repeat(501) }]) {
    recusou(await chamar(rota, dados), 400, 'invalid_input', 'Campo motivo inválido.')
  }
  recusou(await chamar(rota, []), 400, 'invalid_input', 'Dados de aposentadoria inválidos.')
  assert.deepEqual(store.listarLicoes(projeto.id), [regra])
})

test('corrigir e aposentar não aceitam lição de outro projeto, id inválido ou ausente', async t => {
  const { store, outro, caminho, chamar } = preparar(t)
  const externa = store.registrarLicao(outro.id, { texto: 'Erro alheio', agent: 'Claude' })
  for (const acao of ['corrigir', 'aposentar']) {
    const dados = { texto: 'Texto novo', motivo: 'Mudou' }
    for (const id of [externa.id, randomUUID()]) {
      recusou(await chamar(`${caminho}/${id}/${acao}`, dados), 404, 'not_found', 'Lição não encontrada neste projeto.')
    }
    recusou(await chamar(`${caminho}/invalido/${acao}`, dados), 400, 'invalid_input', 'Campo licaoId inválido.')
  }
  assert.deepEqual(store.listarLicoes(outro.id), [externa])
})

test('o token respeita o projeto e só o dono pode escrever em seu nome', async t => {
  const { store, projeto, outro, caminho, chamar } = preparar(t)
  const tokenAgente = store.createAuthToken({ name: 'Agente', tokenType: 'agent', role: 'owner', projectId: projeto.id }).token
  const tokenColaborador = store.createAuthToken({ name: 'Colaborador', tokenType: 'user_session', role: 'collaborator' }).token
  const tokenDono = store.createAuthToken({ name: 'Dono', tokenType: 'user_session', role: 'owner', projectId: projeto.id }).token
  const regra = store.registrarLicao(projeto.id, { tipo: 'regra', texto: 'Revisar', fraseDoDono: 'Revisar', agent: 'Dono' })
  const global = store.registrarLicao(null, { texto: 'Erro geral', agent: 'Claude' })
  assert.deepEqual(await chamar(caminho, undefined, tokenAgente), { status: 200, corpo: [regra, global] })
  const outroProjeto = `/api/projects/${outro.id}/licoes`
  // Texto único da recusa de escopo em toda rota /api/projects/:id (server/auth/escopo.ts).
  recusou(await chamar(outroProjeto, undefined, tokenAgente), 403, 'forbidden_project_scope', 'Este token não possui permissão para acessar este projeto.')
  recusou(await chamar(outroProjeto, { tipo: 'regra', texto: 'Nova' }, tokenDono), 403, 'forbidden_project_scope', 'Este token não possui permissão para acessar este projeto.')
  for (const token of [tokenAgente, tokenColaborador]) {
    for (const rota of [caminho, `${caminho}/${regra.id}/corrigir`, `${caminho}/${regra.id}/aposentar`]) {
      recusou(await chamar(rota, { tipo: 'regra', texto: 'Nova', motivo: 'Mudou' }, token), 403, 'so_o_dono', 'Só o dono pode mudar as lições pela tela.')
    }
  }
  recusou(await chamar(`${caminho}/${global.id}/aposentar`, { motivo: 'Mudou' }, tokenDono), 403, 'forbidden_project_scope', 'Este acesso vale somente para lições deste projeto.')
  const nova = licao(await chamar(caminho, { tipo: 'regra', texto: 'Conferir a publicação' }, tokenDono), 201)
  assert.equal(nova.origem, 'Dono')
  const corrigida = licao(await chamar(`${caminho}/${nova.id}/corrigir`, { texto: 'Conferir a publicação e os links' }, tokenDono), 201)
  assert.equal(corrigida.substituiId, nova.id)
  assert.ok(licao(await chamar(`${caminho}/${corrigida.id}/aposentar`, { motivo: 'Mudou' }, tokenDono), 200).aposentadaEm)
})
