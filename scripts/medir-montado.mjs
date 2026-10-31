#!/usr/bin/env node
/**
 * Mede o programa pré-montado contra o atual (tsx): tempo até a primeira resposta e memória parada.
 *
 *   node scripts/medir-montado.mjs --banco <banco real> [--pasta <pasta temporária>] [--porta 4396] [--rodadas 5]
 *
 * Antes: `npm run montar`. O banco real é aberto só para leitura e copiado com VACUUM INTO para uma pasta
 * temporária; as medições usam a cópia (AXON_DB_PATH) e a pasta é apagada no fim. Só para Windows
 * (memória pela tabela de processos do sistema, somando a árvore de cada programa).
 *
 * Cada cenário roda duas rodadas de aquecimento (descartadas: o tsx guarda em disco o que já traduziu) e depois
 * N rodadas valendo, intercaladas entre tsx e montado e com a ordem trocada a cada rodada (para a ordem não
 * favorecer ninguém). Resultado: mediana do tempo (ms) e da memória (MB, working set = o RSS do Windows):
 * a árvore inteira do programa e o maior processo dela (o servidor de verdade, sem o lançador do tsx).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TSX_CLI = path.join(raiz, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const TSX_LOADER = './node_modules/tsx/dist/loader.mjs'
const TEMPO_PARA_ASSENTAR_MS = 1500
const LIMITE_DE_ESPERA_MS = 30_000
const RODADAS_DE_AQUECIMENTO = 2
const MB = 1024 * 1024

const dormir = ms => new Promise(resolve => setTimeout(resolve, ms))

export function mediana(valores) {
  const ordenados = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 === 1 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2
}

function argumento(nome, padrao) {
  const indice = process.argv.indexOf(`--${nome}`)
  return indice >= 0 && process.argv[indice + 1] ? process.argv[indice + 1] : padrao
}

/** Cópia consistente do banco real, aberto só para leitura. */
function copiarBanco(origem, pasta) {
  const destino = path.join(pasta, 'copia.sqlite')
  const banco = new DatabaseSync(origem, { readOnly: true })
  try {
    banco.exec(`VACUUM INTO '${destino.replaceAll("'", "''")}'`)
  } finally {
    banco.close()
  }
  return destino
}

/** Working set do processo e de todos os descendentes: soma da árvore e o maior processo dela. */
function memoriaDaArvore(pidRaiz) {
  const consulta = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress'
  const saida = spawnSync('powershell', ['-NoProfile', '-Command', consulta], { encoding: 'utf8', maxBuffer: 64 * MB })
  const processos = [].concat(JSON.parse(saida.stdout))
  const pids = new Set([pidRaiz])
  let cresceu = true
  while (cresceu) {
    cresceu = false
    for (const p of processos) {
      if (pids.has(p.ParentProcessId) && !pids.has(p.ProcessId)) { pids.add(p.ProcessId); cresceu = true }
    }
  }
  const tamanhos = processos.filter(p => pids.has(p.ProcessId)).map(p => p.WorkingSetSize)
  return { arvore: tamanhos.reduce((soma, t) => soma + t, 0) / MB, principal: Math.max(...tamanhos) / MB }
}

function encerrar(filho) {
  if (filho.exitCode === null) spawnSync('taskkill', ['/PID', String(filho.pid), '/T', '/F'], { stdio: 'ignore' })
}

async function esperarServidor(porta, inicio, filho) {
  while (performance.now() - inicio < LIMITE_DE_ESPERA_MS) {
    if (filho.exitCode !== null) throw new Error(`o servidor terminou sozinho (código ${filho.exitCode})`)
    const ok = await fetch(`http://127.0.0.1:${porta}/api/health`).then(r => r.ok, () => false)
    if (ok) return performance.now() - inicio
    await dormir(10)
  }
  throw new Error('o servidor não respondeu a tempo')
}

function esperarMcp(filho, inicio) {
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error('o MCP não respondeu a tempo')), LIMITE_DE_ESPERA_MS)
    let texto = ''
    filho.stdout.on('data', pedaco => {
      texto += pedaco.toString('utf8')
      if (!texto.includes('\n')) return
      clearTimeout(limite)
      resolve(performance.now() - inicio)
    })
    filho.once('exit', codigo => { clearTimeout(limite); reject(new Error(`o MCP terminou sozinho (código ${codigo})`)) })
    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'medicao', version: '1.0.0' } } }
    filho.stdin.write(`${JSON.stringify(initialize)}\n`)
  })
}

function esperarSaida(filho, inicio) {
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error('os ganchos não terminaram a tempo')), LIMITE_DE_ESPERA_MS)
    filho.once('exit', () => { clearTimeout(limite); resolve(performance.now() - inicio) })
  })
}

/** Uma rodada: devolve { ms, mb } (mb = null quando o programa termina sozinho; senão { arvore, principal }). */
async function rodada(cenario, ambiente) {
  const inicio = performance.now()
  const filho = spawn(process.execPath, cenario.args, { cwd: raiz, env: { ...process.env, ...ambiente }, stdio: ['pipe', 'pipe', 'ignore'] })
  try {
    if (cenario.tipo === 'servidor') return await medirParado(filho, esperarServidor(Number(ambiente.AXON_PORT), inicio, filho))
    if (cenario.tipo === 'mcp') return await medirParado(filho, esperarMcp(filho, inicio))
    filho.stdin.end(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'medicao', cwd: raiz, source: 'startup' }))
    return { ms: await esperarSaida(filho, inicio), mb: null }
  } finally {
    encerrar(filho)
    await dormir(300)
  }
}

async function medirParado(filho, primeiraResposta) {
  const ms = await primeiraResposta
  await dormir(TEMPO_PARA_ASSENTAR_MS)
  return { ms, mb: memoriaDaArvore(filho.pid) }
}

export function cenarios() {
  const existeGanchos = existsSync(path.join(raiz, 'server', 'ganchos', 'principal.ts'))
  const lista = [
    { nome: 'servidor', variante: 'tsx', tipo: 'servidor', args: [TSX_CLI, 'server/index.ts', '--production'] },
    { nome: 'servidor', variante: 'montado', tipo: 'servidor', args: ['dist-server/index.mjs', '--production'] },
    { nome: 'MCP', variante: 'tsx', tipo: 'mcp', args: ['--import', TSX_LOADER, 'server/mcp.ts'] },
    { nome: 'MCP', variante: 'montado', tipo: 'mcp', args: ['dist-server/mcp.mjs'] },
  ]
  if (existeGanchos) {
    lista.push({ nome: 'ganchos', variante: 'tsx', tipo: 'ganchos', args: ['--import', TSX_LOADER, 'server/ganchos/principal.ts'] })
    lista.push({ nome: 'ganchos', variante: 'montado', tipo: 'ganchos', args: ['dist-server/ganchos.mjs'] })
  }
  return lista
}

async function medirPar(par, rodadas, ambiente) {
  const resultados = new Map(par.map(c => [c.variante, []]))
  for (let i = 0; i < RODADAS_DE_AQUECIMENTO + rodadas; i += 1) {
    const ordem = i % 2 === 0 ? par : [...par].reverse()
    for (const cenario of ordem) {
      const medida = await rodada(cenario, ambiente)
      if (i >= RODADAS_DE_AQUECIMENTO) resultados.get(cenario.variante).push(medida)
    }
  }
  return par.map(c => resumo(c, resultados.get(c.variante)))
}

function resumo(cenario, medidas) {
  const mbs = medidas.map(m => m.mb).filter(mb => mb !== null)
  const medianaDe = campo => (mbs.length ? Math.round(mediana(mbs.map(mb => mb[campo])) * 10) / 10 : null)
  return {
    programa: cenario.nome,
    variante: cenario.variante,
    ms: Math.round(mediana(medidas.map(m => m.ms))),
    mbArvore: medianaDe('arvore'),
    mbPrincipal: medianaDe('principal'),
    tempos: medidas.map(m => Math.round(m.ms)),
  }
}

function agrupar(lista) {
  const grupos = new Map()
  for (const c of lista) grupos.set(c.nome, [...(grupos.get(c.nome) ?? []), c])
  return [...grupos.values()]
}

function imprimir(linhas) {
  const mb = valor => (valor === null ? 'n/a' : `${valor} MB`)
  console.log('| Programa | Versão | Tempo até a primeira resposta (mediana) | Memória parada, árvore (mediana) | Memória parada, maior processo (mediana) | Tempos das rodadas (ms) |')
  console.log('|---|---|---|---|---|---|')
  for (const l of linhas) {
    console.log(`| ${l.programa} | ${l.variante} | ${l.ms} ms | ${mb(l.mbArvore)} | ${mb(l.mbPrincipal)} | ${l.tempos.join(', ')} |`)
  }
}

async function principal() {
  const bancoReal = argumento('banco')
  if (!bancoReal) throw new Error('Informe --banco <caminho do banco real>.')
  const rodadas = Number(argumento('rodadas', '5'))
  const porta = argumento('porta', '4396')
  const pasta = mkdtempSync(path.join(argumento('pasta', os.tmpdir()), 'axon-medicao-'))
  try {
    const copia = copiarBanco(bancoReal, pasta)
    const ambiente = { AXON_DB_PATH: copia, AXON_PORT: porta, AXON_DIST_DIR: pasta }
    const linhas = []
    for (const par of agrupar(cenarios())) linhas.push(...await medirPar(par, rodadas, ambiente))
    imprimir(linhas)
    if (!existsSync(path.join(raiz, 'server', 'ganchos', 'principal.ts'))) console.log('\nGanchos: não medidos (server/ganchos/principal.ts ainda não existe neste ramo).')
  } finally {
    rmSync(pasta, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 })
    console.log(`\nCópia do banco apagada: ${existsSync(pasta) ? 'NÃO' : 'sim'}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch(erro => { console.error(`Medição falhou: ${erro.message}`); process.exitCode = 1 })
}
