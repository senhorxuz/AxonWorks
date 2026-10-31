#!/usr/bin/env node
/**
 * Cobertura de uma fatia (padrão ouro: 100% de linhas, ramos, funções e instruções nos módulos novos).
 *
 *   npm run qualidade:cobertura -- <módulo...> -- <teste...>
 *
 * Roda os testes da fatia (node:test via tsx) sob o c8, medindo só os módulos listados, e sai com 1
 * se qualquer medida ficar abaixo de 100. Os mapas de código do tsx fazem o c8 reportar o arquivo .ts.
 */
import { spawnSync } from 'node:child_process'

const argumentos = process.argv.slice(2)
const corte = argumentos.indexOf('--')
const modulos = corte === -1 ? argumentos : argumentos.slice(0, corte)
const testes = corte === -1 ? [] : argumentos.slice(corte + 1)

if (modulos.length === 0 || testes.length === 0) {
  console.error('Uso: npm run qualidade:cobertura -- <módulo...> -- <teste...>')
  process.exit(2)
}

const c8 = [
  './node_modules/c8/bin/c8.js',
  '--all',
  ...modulos.flatMap((m) => ['--include', m]),
  '--reporter=text',
  '--clean',
  '--check-coverage',
  '--lines', '100',
  '--branches', '100',
  '--functions', '100',
  '--statements', '100',
  process.execPath,
  './node_modules/tsx/dist/cli.mjs',
  '--test',
  '--test-concurrency=1',
  ...testes,
]

const r = spawnSync(process.execPath, c8, { stdio: 'inherit' })
process.exit(r.status ?? 1)
