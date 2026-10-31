import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { afterEach, describe, test } from 'node:test'
import { createApp } from '../server/app.ts'
import { WorkspaceStore } from '../server/store.ts'

/**
 * Login próprio: a Axon fica acessível pela internet e a porta é a senha.
 * No computador local nada disso aparece; quem exige login é o modo servidor.
 */

const ENV_ORIGINAL = { ...process.env }
const limpezas: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const limpar of limpezas.splice(0).reverse()) await limpar()
  for (const chave of ['AXON_MODE', 'AXON_ALLOWED_HOSTS', 'AXON_REQUIRE_AUTH']) {
    if (ENV_ORIGINAL[chave] === undefined) delete process.env[chave]
    else process.env[chave] = ENV_ORIGINAL[chave]
  }
})

type Resposta = { status: number; json: any; cookies: string[] }

async function subir() {
  const store = new WorkspaceStore(':memory:')
  const server = createServer(createApp(store))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  const { port } = server.address() as { port: number }
  limpezas.push(async () => { await new Promise<void>(r => server.close(() => r())); store.close() })

  const chamar = (metodo: string, caminho: string, cabecalhos: Record<string, string> = {}, corpo?: unknown) =>
    new Promise<Resposta>((resolve, reject) => {
      const dados = corpo === undefined ? undefined : JSON.stringify(corpo)
      const req = request(
        { host: '127.0.0.1', port, path: caminho, method: metodo, headers: { Host: '127.0.0.1', ...(dados ? { 'Content-Type': 'application/json' } : {}), ...cabecalhos } },
        res => {
          let texto = ''
          res.on('data', c => { texto += c })
          res.on('end', () => resolve({ status: res.statusCode ?? 0, json: texto ? JSON.parse(texto) : null, cookies: res.headers['set-cookie'] ?? [] }))
        },
      )
      req.on('error', reject)
      if (dados) req.write(dados)
      req.end()
    })

  const ESCRITA = { 'X-Workspace-Client': 'local' }
  const criarDono = () => chamar('POST', '/api/auth/register', ESCRITA, { username: 'dono', displayName: 'Dono', password: 'senha-bem-forte-123456', role: 'admin' })
  const entrar = (senha = 'senha-bem-forte-123456', username = 'dono') => chamar('POST', '/api/auth/login', ESCRITA, { username, password: senha })
  return { store, chamar, criarDono, entrar, ESCRITA }
}

/** Pega o valor do cookie da sessão para reenviar nas próximas chamadas. */
function cookieDaSessao(cookies: string[]): string {
  const bruto = cookies.find(c => c.startsWith('axon_sessao='))
  assert.ok(bruto, `nenhum cookie de sessão em ${JSON.stringify(cookies)}`)
  return bruto.split(';')[0]!
}

describe('Login: a porta da Axon no servidor', () => {
  test('no servidor, nada abre sem entrar', async () => {
    process.env.AXON_MODE = 'servidor'
    const { chamar, criarDono } = await subir()
    assert.equal((await criarDono()).status, 201, 'a primeira conta pode ser criada')
    const semLogin = await chamar('GET', '/api/projects')
    assert.equal(semLogin.status, 401)
    assert.equal(semLogin.json.error.code, 'authentication_required')
    assert.equal((await chamar('GET', '/api/health')).status, 200, 'a saúde continua aberta para o monitoramento')
  })

  test('entrar guarda a sessão num cookie blindado e abre as portas', async () => {
    process.env.AXON_MODE = 'servidor'
    const { chamar, criarDono, entrar } = await subir()
    await criarDono()
    const login = await entrar()
    assert.equal(login.status, 200)
    const bruto = login.cookies.find(c => c.startsWith('axon_sessao='))!
    assert.ok(bruto, 'o login devolve o cookie da sessão')
    assert.match(bruto, /HttpOnly/i, 'nenhum script da página consegue ler o cookie')
    assert.match(bruto, /Secure/i, 'o cookie só viaja pelo endereço seguro')
    assert.match(bruto, /SameSite=Strict/i, 'outro site não consegue usar a sessão')
    assert.match(bruto, /Max-Age=43200/, 'a sessão dura 12 horas')
    assert.ok(!login.json.token, 'a senha da sessão não é devolvida no corpo da resposta')

    const comLogin = await chamar('GET', '/api/projects', { Cookie: cookieDaSessao(login.cookies) })
    assert.equal(comLogin.status, 200)
  })

  test('sair derruba a sessão daquele aparelho', async () => {
    process.env.AXON_MODE = 'servidor'
    const { chamar, criarDono, entrar, ESCRITA } = await subir()
    await criarDono()
    const cookie = cookieDaSessao((await entrar()).cookies)
    const saida = await chamar('POST', '/api/auth/logout', { ...ESCRITA, Cookie: cookie }, {})
    assert.equal(saida.status, 200)
    assert.match(saida.cookies.join(' '), /axon_sessao=;/, 'o cookie é apagado no navegador')
    const depois = await chamar('GET', '/api/projects', { Cookie: cookie })
    assert.equal(depois.status, 401, 'o mesmo cookie não serve mais')
  })

  test('errar a senha várias vezes tranca a porta por alguns minutos', async () => {
    process.env.AXON_MODE = 'servidor'
    const { criarDono, entrar } = await subir()
    await criarDono()
    for (let tentativa = 1; tentativa <= 5; tentativa++) {
      const erro = await entrar('chute-errado')
      assert.equal(erro.status, 401, `tentativa ${tentativa}`)
      assert.equal(erro.json.error.message, 'Usuário ou senha incorretos.', 'não entrega se errou o usuário ou a senha')
    }
    const trancada = await entrar('chute-errado')
    assert.equal(trancada.status, 429)
    assert.equal(trancada.json.error.code, 'too_many_attempts')
    assert.match(trancada.json.error.message, /minutos/)
    const comSenhaCerta = await entrar()
    assert.equal(comSenhaCerta.status, 429, 'enquanto está trancada, nem a senha certa entra')
  })

  test('um usuário que não existe conta tentativa igual, sem revelar nada', async () => {
    process.env.AXON_MODE = 'servidor'
    const { criarDono, entrar } = await subir()
    await criarDono()
    for (let tentativa = 1; tentativa <= 5; tentativa++) {
      const erro = await entrar('qualquer-senha', 'fantasma')
      assert.equal(erro.status, 401)
      assert.equal(erro.json.error.message, 'Usuário ou senha incorretos.')
    }
    assert.equal((await entrar('qualquer-senha', 'fantasma')).status, 429)
    assert.equal((await entrar()).status, 200, 'o bloqueio é por usuário: o dono continua entrando')
  })

  test('a tela descobre se precisa criar a primeira conta, sem revelar quem existe', async () => {
    process.env.AXON_MODE = 'servidor'
    const { chamar, criarDono } = await subir()
    const antes = await chamar('GET', '/api/auth/status')
    assert.equal(antes.status, 200, 'essa pergunta é aberta: é ela que mostra a tela certa')
    assert.deepEqual(antes.json, { temConta: false, exigeLogin: true })
    await criarDono()
    const depois = await chamar('GET', '/api/auth/status')
    assert.deepEqual(depois.json, { temConta: true, exigeLogin: true })
    assert.equal((await chamar('GET', '/api/auth/accounts')).status, 401, 'a lista de contas continua fechada')
  })

  test('no computador local, entrar continua opcional e o cookie não exige endereço seguro', async () => {
    const { chamar, criarDono, entrar } = await subir()
    assert.equal((await chamar('GET', '/api/projects')).status, 200, 'local segue sem pedir login')
    assert.deepEqual((await chamar('GET', '/api/auth/status')).json, { temConta: false, exigeLogin: false })
    await criarDono()
    const login = await entrar()
    const bruto = login.cookies.find(c => c.startsWith('axon_sessao='))!
    assert.ok(!/Secure/i.test(bruto), 'no computador local o endereço é http, então o cookie não pode exigir https')
  })
})

describe('Login: esqueci a senha', () => {
  test('trocar a senha pelo servidor deixa entrar com a nova e derruba as sessões abertas', async () => {
    process.env.AXON_MODE = 'servidor'
    const { store, chamar, criarDono, entrar } = await subir()
    await criarDono()
    const sessaoAntiga = cookieDaSessao((await entrar()).cookies)
    assert.equal((await chamar('GET', '/api/projects', { Cookie: sessaoAntiga })).status, 200)

    store.trocarSenha('dono', 'nova-senha-do-dono-2026')

    assert.equal((await chamar('GET', '/api/projects', { Cookie: sessaoAntiga })).status, 401, 'quem estava logado cai fora')
    assert.equal((await entrar()).status, 401, 'a senha antiga não vale mais')
    assert.equal((await entrar('nova-senha-do-dono-2026')).status, 200)
  })

  test('a troca recusa senha curta e usuário que não existe', async () => {
    const { store, criarDono } = await subir()
    await criarDono()
    assert.throws(() => store.trocarSenha('dono', 'curta'), /12/)
    assert.throws(() => store.trocarSenha('fantasma', 'nova-senha-do-dono-2026'), /fantasma/)
  })
})
