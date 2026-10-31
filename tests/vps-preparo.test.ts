import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { createApp } from '../server/app.ts'
import { conexaoMcpPeloSsh } from '../server/rede.ts'
import { WorkspaceStore } from '../server/store.ts'
import { textosDoModo } from '../src/modo.ts'

/**
 * Fase 1 da VPS: o que precisa estar certo no código antes de subir.
 * A Axon escuta só a própria máquina; quem fica na frente é a Cloudflare
 * (login por e-mail) ou uma rede privada Tailscale.
 */

const ENV_ORIGINAL = { ...process.env }
const limpezas: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const limpar of limpezas.splice(0).reverse()) await limpar()
  for (const chave of ['AXON_ALLOWED_HOSTS', 'AXON_REQUIRE_AUTH', 'AXON_MODE', 'AXON_SSH_HOST']) {
    if (ENV_ORIGINAL[chave] === undefined) delete process.env[chave]
    else process.env[chave] = ENV_ORIGINAL[chave]
  }
})

async function subir(store = new WorkspaceStore(':memory:')) {
  const server = createServer(createApp(store))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  const { port } = server.address() as { port: number }
  limpezas.push(async () => { await new Promise<void>(r => server.close(() => r())); store.close() })
  // http.request respeita o cabeçalho Host (o fetch do Node não deixa trocar).
  const chamar = (metodo: string, caminho: string, cabecalhos: Record<string, string>, corpo?: unknown) =>
    new Promise<{ status: number; json: any; cookies: string[] }>((resolve, reject) => {
      const dados = corpo === undefined ? undefined : JSON.stringify(corpo)
      const req = request({ host: '127.0.0.1', port, path: caminho, method: metodo, headers: { ...(dados ? { 'Content-Type': 'application/json' } : {}), ...cabecalhos } }, res => {
        let texto = ''
        res.on('data', c => { texto += c })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: texto ? JSON.parse(texto) : null, cookies: res.headers['set-cookie'] ?? [] }))
      })
      req.on('error', reject)
      if (dados) req.write(dados)
      req.end()
    })
  return { store, port, chamar }
}

const REDE_PRIVADA = 'axon-vps.tail1234.ts.net'

/** No servidor tudo exige login: cria o dono, entra e devolve o cookie da sessão. */
async function entrarComoDono(chamar: Awaited<ReturnType<typeof subir>>['chamar'], host: string): Promise<string> {
  const escrita = { Host: host, 'X-Workspace-Client': 'local' }
  await chamar('POST', '/api/auth/register', escrita, { username: 'dono', displayName: 'Dono', password: 'senha-forte-123456', role: 'admin' })
  const login = await chamar('POST', '/api/auth/login', escrita, { username: 'dono', password: 'senha-forte-123456' })
  assert.equal(login.status, 200)
  return login.cookies.find(c => c.startsWith('axon_sessao='))!.split(';')[0]!
}

describe('VPS: endereço da rede privada', () => {
  test('sem configuração, qualquer nome diferente de localhost continua bloqueado', async () => {
    const { chamar } = await subir()
    assert.equal((await chamar('GET', '/api/health', { Host: REDE_PRIVADA })).json.error.code, 'host_forbidden')
  })

  test('com AXON_ALLOWED_HOSTS, o nome da rede privada entra e o resto continua bloqueado', async () => {
    process.env.AXON_ALLOWED_HOSTS = `${REDE_PRIVADA}, 100.101.102.103`
    const { chamar } = await subir()
    assert.equal((await chamar('GET', '/api/health', { Host: REDE_PRIVADA })).status, 200)
    assert.equal((await chamar('GET', '/api/health', { Host: '100.101.102.103:4317' })).status, 200)
    assert.equal((await chamar('GET', '/api/health', { Host: 'invasor.exemplo.com' })).json.error.code, 'host_forbidden')
    // Um nome que só contém o permitido não passa.
    assert.equal((await chamar('GET', '/api/health', { Host: `${REDE_PRIVADA}.invasor.com` })).json.error.code, 'host_forbidden')
  })

  test('escrita vinda da página HTTPS da rede privada é aceita; de outra origem, recusada', async () => {
    process.env.AXON_ALLOWED_HOSTS = REDE_PRIVADA
    const { chamar } = await subir()
    const base = { Host: REDE_PRIVADA, 'X-Workspace-Client': 'local' }
    const criado = await chamar('POST', '/api/projects', { ...base, Origin: `https://${REDE_PRIVADA}` }, { name: 'Pela rede privada', objective: 'Teste.' })
    assert.equal(criado.status, 201)
    const outra = await chamar('POST', '/api/projects', { ...base, Origin: 'https://invasor.exemplo.com' }, { name: 'Não', objective: 'Teste.' })
    assert.equal(outra.json.error.code, 'origin_forbidden')
  })
})

describe('VPS: contas e login', () => {
  test('o cadastro só cria a primeira conta; depois fica fechado', async () => {
    const { chamar } = await subir()
    const local = { Host: '127.0.0.1', 'X-Workspace-Client': 'local' }
    const primeira = await chamar('POST', '/api/auth/register', local, { username: 'dono', displayName: 'Dono', password: 'senha-forte-123456', role: 'admin' })
    assert.equal(primeira.status, 201)
    const segunda = await chamar('POST', '/api/auth/register', local, { username: 'intruso', displayName: 'X', password: 'outra-senha-123456', role: 'admin' })
    assert.equal(segunda.status, 403)
    assert.equal(segunda.json.error.code, 'registration_closed')
  })

  test('com autenticação obrigatória, dá para criar a primeira conta, entrar e continuar usando', async () => {
    process.env.AXON_REQUIRE_AUTH = '1'
    const { chamar } = await subir()
    const local = { Host: '127.0.0.1', 'X-Workspace-Client': 'local' }
    assert.equal((await chamar('GET', '/api/health', { Host: '127.0.0.1' })).status, 200, 'saúde responde sem token, para o monitoramento')
    assert.equal((await chamar('POST', '/api/auth/register', local, { username: 'dono', displayName: 'Dono', password: 'senha-forte-123456', role: 'admin' })).status, 201)
    const login = await chamar('POST', '/api/auth/login', local, { username: 'dono', password: 'senha-forte-123456' })
    assert.equal(login.status, 200)
    const sessao = login.cookies.find(c => c.startsWith('axon_sessao='))!.split(';')[0]!
    assert.equal((await chamar('GET', '/api/projects', { Host: '127.0.0.1' })).status, 401)
    assert.equal((await chamar('GET', '/api/projects', { Host: '127.0.0.1', Cookie: sessao })).status, 200)
    // Com conta existente, o cadastro não vira porta de entrada.
    assert.equal((await chamar('POST', '/api/auth/register', local, { username: 'intruso', displayName: 'X', password: 'outra-senha-123456' })).status, 401)
  })
})

describe('VPS: modo e dados', () => {
  test('a saúde diz se a Axon roda local ou no servidor', async () => {
    assert.equal((await (await subir()).chamar('GET', '/api/health', { Host: '127.0.0.1' })).json.mode, 'local')
    process.env.AXON_MODE = 'servidor'
    assert.equal((await (await subir()).chamar('GET', '/api/health', { Host: '127.0.0.1' })).json.mode, 'servidor')
    process.env.AXON_MODE = 'nuvem'
    assert.throws(() => createApp(new WorkspaceStore(':memory:')), /AXON_MODE deve ser "local" ou "servidor"/)
  })

  test('a tela usa palavras verdadeiras para cada modo', () => {
    assert.equal(textosDoModo('local').salvo, 'Salvo neste computador')
    assert.equal(textosDoModo('servidor').salvo, 'Salvo no seu servidor')
    assert.equal(textosDoModo('servidor').rodape, 'Seus dados ficam no seu servidor')
    assert.equal(textosDoModo('servidor').selo, 'Servidor')
  })

  test('trocar a pasta de trabalho muda só os projetos daquela pasta', () => {
    const store = new WorkspaceStore(':memory:')
    const a = store.createProject({ name: 'A', objective: 'x', workspacePath: 'D:\\projetos\\axon' })
    const b = store.createProject({ name: 'B', objective: 'x', workspacePath: 'D:\\projetos\\outro' })
    assert.equal(store.substituirPastaDeTrabalho('D:\\projetos\\axon', '/srv/axon/projetos/axon'), 1)
    assert.equal(store.getProject(a.id).project.workspacePath, '/srv/axon/projetos/axon')
    assert.equal(store.getProject(b.id).project.workspacePath, 'D:\\projetos\\outro')
    store.close()
  })

  test('copiar o banco gera um arquivo completo e consistente, mesmo com o servidor aberto', () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'axon-copia-'))
    const origem = new WorkspaceStore(path.join(pasta, 'origem.sqlite'))
    origem.createProject({ name: 'Projeto que viaja', objective: 'Ir para a VPS.' })
    const destino = path.join(pasta, 'para-vps.sqlite')
    origem.copiarBancoPara(destino)
    const copia = new WorkspaceStore(destino)
    assert.deepEqual(copia.listProjects().map(p => p.name), ['Projeto que viaja'])
    assert.throws(() => origem.copiarBancoPara(destino), /já existe/)
    copia.close()
    origem.close()
    rmSync(pasta, { recursive: true, force: true })
  })
})

describe('VPS: conexão das IAs pelo SSH', () => {
  test('o comando SSH aponta para o script do MCP dentro da pasta do app', () => {
    assert.deepEqual(conexaoMcpPeloSsh(REDE_PRIVADA, '/srv/axon/app/'), {
      command: 'ssh',
      args: ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', `axon@${REDE_PRIVADA}`, '/srv/axon/app/deploy/mcp.sh'],
    })
  })

  test('no servidor, a tela de Conexões entrega a configuração pelo SSH', async () => {
    process.env.AXON_MODE = 'servidor'
    process.env.AXON_ALLOWED_HOSTS = REDE_PRIVADA
    const { chamar } = await subir()
    const sessao = await entrarComoDono(chamar, REDE_PRIVADA)
    const { json } = await chamar('GET', '/api/connectors', { Host: REDE_PRIVADA, Cookie: sessao })
    assert.equal(json.mcpCommand, 'ssh')
    assert.equal(json.mcpArgs.at(-2), `axon@${REDE_PRIVADA}`)
    assert.match(json.mcpArgs.at(-1), /\/deploy\/mcp\.sh$/)
  })

  test('com a Cloudflare na frente, a IA usa o endereço direto da VPS, não o endereço do site', async () => {
    // O endereço do site aponta para a Cloudflare; o SSH precisa falar com a VPS.
    process.env.AXON_MODE = 'servidor'
    process.env.AXON_ALLOWED_HOSTS = 'axon.meuprojeto.com.br'
    process.env.AXON_SSH_HOST = 'vps.meuprojeto.com.br'
    const { chamar } = await subir()
    const sessao = await entrarComoDono(chamar, 'axon.meuprojeto.com.br')
    const { json } = await chamar('GET', '/api/connectors', { Host: 'axon.meuprojeto.com.br', Cookie: sessao })
    assert.equal(json.mcpCommand, 'ssh')
    assert.equal(json.mcpArgs.at(-2), 'axon@vps.meuprojeto.com.br')
  })

  test('no computador local, continua o comando node de sempre', async () => {
    const { chamar } = await subir()
    const { json } = await chamar('GET', '/api/connectors', { Host: '127.0.0.1' })
    assert.equal(json.mcpCommand, process.execPath)
    assert.equal(json.mcpArgs[0], '--import')
  })
})
