// Ajudantes dos testes ponta a ponta do atalho (`scripts/abrir-axon.mjs`): porta livre, pastas temporárias, a execução
// do atalho de verdade e uma CÓPIA da pasta do projeto para os testes que apagam ou mexem na saída montada.
//
// Por que a cópia: o atalho decide pelo que está em `dist/` e `dist-server/`, e o script descobre a pasta onde está
// pelo próprio caminho. Mexer nesses arquivos na pasta principal derrubaria o programa dos ganchos do dono e os
// servidores dele. A cópia leva o código e liga o `node_modules` por junção (não copia pacotes).

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const raiz = fileURLToPath(new URL('../..', import.meta.url))

export const dormir = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const pastas: string[] = []
const pidsParaEncerrar: number[] = []
const filhos: ChildProcess[] = []
const ocupantes: Array<{ close(): void }> = []

export function pastaTemporaria(prefixo = 'axon-atalho-'): string {
  const pasta = mkdtempSync(path.join(os.tmpdir(), prefixo))
  pastas.push(pasta)
  return pasta
}

export function portaLivre(): Promise<number> {
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

/** Registra um servidor ou ocupante para ser fechado no fim do arquivo de teste. */
export function fecharNoFim(ocupante: { close(): void }): void {
  ocupantes.push(ocupante)
}

export interface Resultado { codigo: number | null; saida: string; erro: string }

/** Roda `scripts/abrir-axon.mjs --sem-janelas` da pasta `pastaDoProjeto` e junta o que ele escreveu. */
export function rodarAtalho(env: Record<string, string>, pastaDoProjeto = raiz): Promise<Resultado> {
  return new Promise((resolve, reject) => {
    const script = path.join(pastaDoProjeto, 'scripts', 'abrir-axon.mjs')
    const filho = spawn(process.execPath, [script, '--sem-janelas'], { cwd: pastaDoProjeto, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let saida = ''
    let erro = ''
    filho.stdout.on('data', (pedaco: Buffer) => { saida += pedaco.toString('utf8') })
    filho.stderr.on('data', (pedaco: Buffer) => { erro += pedaco.toString('utf8') })
    filho.once('error', reject)
    filho.once('close', codigo => {
      for (const achado of saida.matchAll(/\(PID (\d+)\)/g)) pidsParaEncerrar.push(Number(achado[1]))
      resolve({ codigo, saida, erro })
    })
  })
}

/** Sobe o servidor montado de `pastaDoProjeto` à mão (sem o atalho), como se um clique anterior o tivesse ligado. */
export function subirServidorAMao(pastaDoProjeto: string, env: Record<string, string>): ChildProcess {
  const filho = spawn(process.execPath, [path.join(pastaDoProjeto, 'dist-server', 'index.mjs'), '--production'], {
    cwd: pastaDoProjeto,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  })
  filhos.push(filho)
  if (filho.pid !== undefined) pidsParaEncerrar.push(filho.pid)
  return filho
}

/** Um processo qualquer que fica vivo até ser encerrado: o "transeunte" dos testes de segurança do encerramento. */
export function subirTranseunte(): ChildProcess {
  const filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  filhos.push(filho)
  if (filho.pid !== undefined) pidsParaEncerrar.push(filho.pid)
  return filho
}

export function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (erro) {
    return (erro as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export interface SaudeLida { status: string; pid: number; iniciadoEm: string }

/** A resposta de saúde da Axon na porta, ou `null` se ninguém responde. */
export async function lerSaudeDaPorta(porta: number): Promise<SaudeLida | null> {
  try {
    const resposta = await fetch(`http://127.0.0.1:${porta}/api/health`, { signal: AbortSignal.timeout(2000) })
    return resposta.ok ? ((await resposta.json()) as SaudeLida) : null
  } catch {
    return null
  }
}

export async function esperarAte(descricao: string, condicao: () => boolean | Promise<boolean>, limiteMs: number): Promise<void> {
  const fim = Date.now() + limiteMs
  while (Date.now() < fim) {
    if (await condicao()) return
    await dormir(100)
  }
  throw new Error(`Passou o prazo (${limiteMs} ms) esperando: ${descricao}`)
}

/** Garante que a pasta principal tem a tela construída e o servidor montado (o mesmo que o atalho faria). */
export function garantirSaidaMontada(): void {
  if (!existsSync(path.join(raiz, 'dist', 'index.html'))) {
    execFileSync(process.execPath, [path.join(raiz, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: raiz, stdio: 'pipe' })
  }
  execFileSync(process.execPath, [path.join(raiz, 'scripts', 'montar.mjs')], { cwd: raiz, stdio: 'pipe' })
}

/**
 * Cópia da pasta do projeto. `comFontes: true` leva o código-fonte, sem `dist/` nem `dist-server/`: o atalho tem de
 * construir tudo. `false` leva a saída pronta (a tela e o servidor montado), sem o código-fonte: não há o que construir.
 */
export function copiarProjeto(opcoes: { comFontes: boolean }): string {
  const copia = pastaTemporaria('axon-copia-')
  mkdirSync(path.join(copia, 'scripts'))
  // montar.mjs importa montar-atomico.mjs (gravação atômica do lote 2): a cópia precisa dos dois.
  for (const arquivo of ['abrir-axon.mjs', 'abrir-axon-decisao.ts', 'montar.mjs', 'montar-atomico.mjs']) {
    copyFileSync(path.join(raiz, 'scripts', arquivo), path.join(copia, 'scripts', arquivo))
  }
  copyFileSync(path.join(raiz, 'package.json'), path.join(copia, 'package.json'))
  symlinkSync(path.join(raiz, 'node_modules'), path.join(copia, 'node_modules'), 'junction')
  if (opcoes.comFontes) {
    for (const item of ['src', 'shared', 'server', 'public', 'index.html', 'vite.config.ts', 'tsconfig.json']) {
      cpSync(path.join(raiz, item), path.join(copia, item), { recursive: true })
    }
  } else {
    cpSync(path.join(raiz, 'dist'), path.join(copia, 'dist'), { recursive: true })
    cpSync(path.join(raiz, 'dist-server'), path.join(copia, 'dist-server'), { recursive: true, filter: origem => !origem.endsWith('.map') })
  }
  return copia
}

/** Encerra o que os testes ligaram e apaga as pastas temporárias. Chamar no `after` do arquivo de teste. */
export async function limparOficina(): Promise<void> {
  for (const filho of filhos) {
    if (filho.exitCode === null) filho.kill()
  }
  for (const pid of pidsParaEncerrar) {
    try { process.kill(pid) } catch { /* já tinha saído */ }
  }
  for (const ocupante of ocupantes) ocupante.close()
  await dormir(1000)
  // `rmSync` recursivo não segue a junção do `node_modules`: apaga o link, não os pacotes.
  for (const pasta of pastas) rmSync(pasta, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 })
}
