import assert from 'node:assert/strict'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { WorkspaceStore } from '../server/store.ts'
import { criarPastaDeMontagem, distServerReal, fotografarPasta, rodarMontagem } from './apoio/montagem.ts'

/**
 * Programa pré-montado (spec 7.6): o JavaScript gerado por `scripts/montar.mjs` precisa ligar,
 * responder e entregar acentos intactos. Os outros testes rodam no código-fonte; este roda o montado.
 *
 * A montagem vai para uma pasta temporária (`--saida`), nunca para o `dist-server/` do repositório: lá os ganchos do
 * Claude Code e o servidor do atalho leem os arquivos, e regravá-los durante a suíte derrubava este arquivo inteiro
 * (arquivo em uso no Windows) ou deixava um gancho carregar um arquivo pela metade. O último teste confere isso.
 */

const raiz = fileURLToPath(new URL('..', import.meta.url))
const distServerAntes = fotografarPasta(distServerReal)
const pastaDeMontagem = criarPastaDeMontagem()
const montado = (nome: string) => path.join(pastaDeMontagem.saida, nome)
const temGanchos = existsSync(path.join(raiz, 'server', 'ganchos', 'principal.ts'))
const SEM_GANCHOS = { skip: 'ganchos ainda não existem' }
const TEXTO_COM_ACENTOS = 'não decisões'
const SUBSTITUTO_INVALIDO = '�'

const pastasTemporarias: string[] = []
const filhos: ChildProcess[] = []

function pastaTemporaria(): string {
  const pasta = mkdtempSync(path.join(os.tmpdir(), 'axon-montado-'))
  pastasTemporarias.push(pasta)
  return pasta
}

/** Projeto com acentos gravado num banco novo; devolve o caminho do banco e o projeto. */
function bancoComAcentos(workspacePath = ''): { banco: string; projectId: string } {
  const banco = path.join(pastaTemporaria(), 'montado.sqlite')
  const store = new WorkspaceStore(banco)
  try {
    const projeto = store.createProject({ name: 'Acentuação', objective: TEXTO_COM_ACENTOS, workspacePath })
    return { banco, projectId: projeto.id }
  } finally {
    store.close()
  }
}

function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const sonda = createServer()
    sonda.once('error', reject)
    sonda.listen(0, '127.0.0.1', () => {
      const endereco = sonda.address()
      const porta = typeof endereco === 'object' && endereco ? endereco.port : 0
      sonda.close(() => resolve(porta))
    })
  })
}

const dormir = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function esperarAte<T>(descricao: string, tentar: () => T | undefined | Promise<T | undefined>, limiteMs: number, filho: ChildProcess): Promise<T> {
  const fim = Date.now() + limiteMs
  while (Date.now() < fim) {
    if (filho.exitCode !== null) throw new Error(`${descricao}: o processo montado terminou antes (código ${filho.exitCode})`)
    const valor = await Promise.resolve(tentar()).catch(() => undefined)
    if (valor !== undefined) return valor
    await dormir(25)
  }
  throw new Error(`${descricao}: sem resposta em ${limiteMs} ms`)
}

before(() => {
  const montagem = rodarMontagem(['--saida', pastaDeMontagem.saida])
  if (montagem.status !== 0) throw new Error(`A montagem em pasta temporária falhou (código ${montagem.status}): ${montagem.stderr || montagem.stdout}`)
})

after(async () => {
  for (const filho of filhos) {
    if (filho.exitCode === null) {
      const saiu = new Promise<void>(resolve => filho.once('exit', () => resolve()))
      filho.kill()
      await saiu
    }
  }
  for (const pasta of pastasTemporarias) rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  pastaDeMontagem.limpar()
})

test('a montagem gera servidor e MCP, e os ganchos só quando o fonte existe', () => {
  assert.ok(existsSync(montado('index.mjs')), 'index.mjs')
  assert.ok(existsSync(montado('mcp.mjs')), 'mcp.mjs')
  assert.ok(existsSync(montado('index.mjs.map')), 'mapa de fonte do servidor')
  assert.equal(existsSync(montado('ganchos.mjs')), temGanchos)
})

test('servidor montado responde /api/health', { timeout: 30_000 }, async () => {
  const { banco } = bancoComAcentos()
  const porta = await portaLivre()
  const filho = spawn(process.execPath, [montado('index.mjs'), '--production'], {
    cwd: raiz,
    env: { ...process.env, AXON_PORT: String(porta), AXON_DB_PATH: banco, AXON_DIST_DIR: pastaTemporaria() },
    stdio: 'ignore',
  })
  filhos.push(filho)
  const host = `127.0.0.1:${porta}`
  const saude = await esperarAte('GET /api/health', async () => {
    const resposta = await fetch(`http://${host}/api/health`, { headers: { Host: host, Origin: `http://${host}` } })
    return resposta.ok ? ((await resposta.json()) as { status: string }) : undefined
  }, 20_000, filho)
  assert.equal(saude.status, 'ok')
})

test('servidor montado devolve acentos em UTF-8', { timeout: 30_000 }, async () => {
  const { banco, projectId } = bancoComAcentos()
  const porta = await portaLivre()
  const filho = spawn(process.execPath, [montado('index.mjs'), '--production'], {
    cwd: raiz,
    env: { ...process.env, AXON_PORT: String(porta), AXON_DB_PATH: banco, AXON_DIST_DIR: pastaTemporaria() },
    stdio: 'ignore',
  })
  filhos.push(filho)
  const host = `127.0.0.1:${porta}`
  const bytes = await esperarAte('GET /api/projects/:id', async () => {
    const resposta = await fetch(`http://${host}/api/projects/${projectId}`, { headers: { Host: host, Origin: `http://${host}` } })
    return resposta.ok ? Buffer.from(await resposta.arrayBuffer()) : undefined
  }, 20_000, filho)
  const texto = bytes.toString('utf8')
  assert.ok(texto.includes(TEXTO_COM_ACENTOS), 'objetivo com acentos na resposta')
  assert.ok(!texto.includes(SUBSTITUTO_INVALIDO), 'nenhum caractere de substituição')
})

/** Fala com o MCP montado por stdio, guardando os bytes crus da saída para conferir a codificação. */
function abrirMcp(banco: string) {
  const filho = spawn(process.execPath, [montado('mcp.mjs')], { cwd: raiz, env: { ...process.env, AXON_DB_PATH: banco }, stdio: ['pipe', 'pipe', 'ignore'] })
  filhos.push(filho)
  const pedacos: Buffer[] = []
  filho.stdout!.on('data', (pedaco: Buffer) => pedacos.push(pedaco))
  const bytes = () => Buffer.concat(pedacos)
  const respostas = () => bytes().toString('utf8').split('\n').flatMap(linha => {
    try { return [JSON.parse(linha) as { id?: number; result?: { content?: Array<{ text: string }> } }] } catch { return [] }
  })
  const chamar = async (id: number, method: string, params: unknown) => {
    filho.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return esperarAte(`MCP ${method}`, () => respostas().find(r => r.id === id), 15_000, filho)
  }
  return { chamar, bytes, avisar: (method: string) => filho.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`) }
}

test('mcp montado responde initialize e devolve acentos em UTF-8', { timeout: 30_000 }, async () => {
  const { banco, projectId } = bancoComAcentos()
  const mcp = abrirMcp(banco)
  const inicio = await mcp.chamar(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste-montado', version: '1.0.0' } })
  assert.ok(inicio.result, 'initialize devolve resultado')
  mcp.avisar('notifications/initialized')
  const leitura = await mcp.chamar(2, 'tools/call', { name: 'get_project', arguments: { projectId } })
  const conteudo = leitura.result?.content?.[0]?.text ?? ''
  assert.ok(conteudo.includes(TEXTO_COM_ACENTOS), 'objetivo com acentos lido do banco pelo MCP montado')
  const bruto = mcp.bytes().toString('utf8')
  assert.ok(!bruto.includes(SUBSTITUTO_INVALIDO), 'nenhum caractere de substituição na saída crua')
})

test('ganchos montado responde vazio e sai 0 sem stdin', { ...(temGanchos ? {} : SEM_GANCHOS), timeout: 20_000 }, () => {
  const pasta = pastaTemporaria()
  const resultado = spawnSync(process.execPath, [montado('ganchos.mjs')], {
    cwd: raiz,
    input: '',
    env: { ...process.env, AXON_DB_PATH: path.join(pasta, 'inexistente', 'banco.sqlite') },
  })
  assert.equal(resultado.status, 0)
  assert.equal(resultado.stdout.length, 0)
})

test('ganchos montado devolve acentos em UTF-8', { ...(temGanchos ? {} : SEM_GANCHOS), timeout: 20_000 }, () => {
  const pastaDoProjeto = path.join(pastaTemporaria(), 'projeto')
  mkdirSync(pastaDoProjeto)
  const { banco } = bancoComAcentos(pastaDoProjeto)
  const entrada = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'sessao-montado', cwd: pastaDoProjeto, source: 'startup' })
  const resultado = spawnSync(process.execPath, [montado('ganchos.mjs')], {
    cwd: raiz,
    input: entrada,
    env: { ...process.env, AXON_DB_PATH: banco },
  })
  assert.equal(resultado.status, 0)
  const texto = Buffer.from(resultado.stdout).toString('utf8')
  assert.ok(texto.includes(TEXTO_COM_ACENTOS), 'retomada com acentos intactos')
  assert.ok(!texto.includes(SUBSTITUTO_INVALIDO), 'nenhum caractere de substituição')
})

// Tem de ser o último: roda depois de todos os outros testes do arquivo.
test('o dist-server do repositório não foi tocado por este arquivo (mesmos arquivos, mesmas datas)', () => {
  assert.deepEqual(fotografarPasta(distServerReal), distServerAntes)
})
