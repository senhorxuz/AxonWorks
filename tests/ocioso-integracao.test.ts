import assert from 'node:assert/strict'
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * TESTE LENTO (cerca de 1 a 2 minutos): o desligamento por ociosidade no servidor montado, de verdade.
 *
 * A regra (quanto tempo, o que conta como uso) é provada no módulo puro, com relógio de mentira, em
 * `ocioso.test.ts`. Aqui se prova a ligação em `server/index.ts`: com `AXON_DESLIGAR_OCIOSO_MIN=1`, dois servidores
 * sobem juntos. O B ninguém usa, e ele tem de fechar sozinho com código 0. O A recebe uma requisição a cada 15 segundos,
 * e tem de continuar de pé depois que o B fechou. Se a requisição não contasse como uso, o A fecharia junto.
 *
 * Não existe variável nem relógio "só de teste" no servidor: o tempo é o de verdade, por isso a espera. A conferência
 * roda a cada 60 s; um timer pode disparar 1 ms antes do limite e deixar o desligamento para a conferência seguinte,
 * então o B fecha entre ~60 s e ~125 s. Para pular este teste: AXON_PULAR_TESTES_LENTOS=1.
 */

const raiz = fileURLToPath(new URL('..', import.meta.url))
const montado = path.join(raiz, 'dist-server', 'index.mjs')
const pular = process.env.AXON_PULAR_TESTES_LENTOS === '1' ? { skip: 'AXON_PULAR_TESTES_LENTOS=1' } : {}

const pastas: string[] = []
const filhos: ChildProcess[] = []

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

interface Servidor { filho: ChildProcess; porta: number; saida: () => string; ligadoEm: Promise<number>; encerrou: Promise<{ codigo: number | null; quando: number }> }

/** Sobe o servidor montado com 1 minuto de ociosidade. `ligadoEm` resolve com a hora em que ele anunciou que está de pé. */
async function subirServidor(): Promise<Servidor> {
  const pasta = mkdtempSync(path.join(os.tmpdir(), 'axon-ocioso-'))
  pastas.push(pasta)
  const porta = await portaLivre()
  const filho = spawn(process.execPath, [montado, '--production'], {
    cwd: raiz,
    env: { ...process.env, AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'ocioso.sqlite'), AXON_DIST_DIR: pasta, AXON_DESLIGAR_OCIOSO_MIN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  filhos.push(filho)
  let saida = ''
  const ligadoEm = new Promise<number>((resolve, reject) => {
    filho.stdout!.on('data', (pedaco: Buffer) => {
      saida += pedaco.toString('utf8')
      if (saida.includes('AXON disponível')) resolve(Date.now())
    })
    filho.stderr!.on('data', (pedaco: Buffer) => { saida += pedaco.toString('utf8') })
    filho.once('exit', codigo => reject(new Error(`o servidor fechou antes de ligar (código ${codigo}): ${saida}`)))
  })
  const encerrou = new Promise<{ codigo: number | null; quando: number }>(resolve => {
    filho.once('exit', codigo => resolve({ codigo, quando: Date.now() }))
  })
  // O "fechou antes de ligar" só vale até ligar; depois disso o fim do processo é o esperado.
  ligadoEm.catch(() => undefined)
  return { filho, porta, saida: () => saida, ligadoEm, encerrou }
}

const dormir = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

before(() => {
  execFileSync(process.execPath, [path.join(raiz, 'scripts', 'montar.mjs')], { cwd: raiz, stdio: 'pipe' })
})

after(async () => {
  for (const filho of filhos) {
    if (filho.exitCode === null) {
      const saiu = new Promise<void>(resolve => filho.once('exit', () => resolve()))
      filho.kill()
      await saiu
    }
  }
  for (const pasta of pastas) rmSync(pasta, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 })
})

test('servidor montado com ociosidade de 1 minuto: o sem uso fecha com código 0, o com uso continua de pé', { ...pular, timeout: 200_000 }, async () => {
  const [parado, usado] = [await subirServidor(), await subirServidor()]
  const [paradoLigadoEm] = await Promise.all([parado.ligadoEm, usado.ligadoEm])

  // O servidor A é usado de verdade, a cada 15 segundos, por uma requisição HTTP real.
  let usando = true
  const batidas = (async () => {
    while (usando) {
      const host = `127.0.0.1:${usado.porta}`
      await fetch(`http://${host}/api/health`, { headers: { Host: host } }).catch(() => undefined)
      await dormir(15_000)
    }
  })()

  try {
    const fim = await parado.encerrou
    assert.equal(fim.codigo, 0, `o servidor sem uso fecha com código 0. Saída: ${parado.saida()}`)
    assert.match(parado.saida(), /AXON desligada: sem uso há 1 min\./)
    const esperouMs = fim.quando - paradoLigadoEm
    assert.ok(esperouMs >= 55_000, `não fechou cedo demais (esperou ${esperouMs} ms)`)

    // O usado continua de pé 5 segundos depois: a requisição conta como uso.
    await dormir(5_000)
    assert.equal(usado.filho.exitCode, null, `o servidor usado seguiu de pé. Saída: ${usado.saida()}`)
    const host = `127.0.0.1:${usado.porta}`
    const resposta = await fetch(`http://${host}/api/health`, { headers: { Host: host } })
    assert.equal(resposta.status, 200)
  } finally {
    usando = false
    await batidas
  }
})

test('sem a variável de ociosidade o servidor montado não se desliga e não anuncia nada', { ...pular, timeout: 60_000 }, async () => {
  const pasta = mkdtempSync(path.join(os.tmpdir(), 'axon-ocioso-'))
  pastas.push(pasta)
  const porta = await portaLivre()
  const env: Record<string, string | undefined> = { ...process.env, AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'ocioso.sqlite'), AXON_DIST_DIR: pasta }
  delete env.AXON_DESLIGAR_OCIOSO_MIN
  const filho = spawn(process.execPath, [montado, '--production'], { cwd: raiz, env, stdio: ['ignore', 'pipe', 'pipe'] })
  filhos.push(filho)
  let saida = ''
  filho.stdout!.on('data', (pedaco: Buffer) => { saida += pedaco.toString('utf8') })
  const limite = Date.now() + 20_000
  while (!saida.includes('AXON disponível') && Date.now() < limite) await dormir(100)
  assert.ok(saida.includes('AXON disponível'), `o servidor ligou. Saída: ${saida}`)
  await dormir(2_000)
  assert.equal(filho.exitCode, null)
})

test('ociosidade inválida derruba o servidor ao subir, com a frase em português', { timeout: 30_000 }, async () => {
  const pasta = mkdtempSync(path.join(os.tmpdir(), 'axon-ocioso-'))
  pastas.push(pasta)
  const porta = await portaLivre()
  const filho = spawn(process.execPath, [montado, '--production'], {
    cwd: raiz,
    env: { ...process.env, AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'ocioso.sqlite'), AXON_DIST_DIR: pasta, AXON_DESLIGAR_OCIOSO_MIN: '0,5' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  filhos.push(filho)
  let erro = ''
  filho.stderr!.on('data', (pedaco: Buffer) => { erro += pedaco.toString('utf8') })
  const codigo = await new Promise<number | null>(resolve => filho.once('exit', resolve))
  assert.notEqual(codigo, 0)
  assert.ok(erro.includes('O tempo de ociosidade deve ser um número inteiro de minutos, de 1 em diante.'), erro)
})
