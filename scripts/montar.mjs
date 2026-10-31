#!/usr/bin/env node
/**
 * Monta o servidor, o MCP e o programa dos ganchos em JavaScript pronto (spec 7.6).
 *
 *   npm run montar
 *   npm run montar -- --saida <pasta>        (ou a variável AXON_SAIDA_MONTADO)
 *
 * Gera `index.mjs`, `mcp.mjs` e, quando o fonte existir, `ganchos.mjs` (cada um com o seu `.map`) em `dist-server/`
 * ou na pasta pedida. A pasta não vai para o git. Pacotes de `node_modules` ficam de fora (são carregados na hora),
 * então o arquivo montado só traz o código da Axon.
 *
 * Gravação atômica: monta numa pasta ao lado (`<saida>.novo-<pid>`) e só no fim troca cada arquivo por `rename`.
 * Ninguém (o gancho do Claude Code, o servidor do atalho) lê um arquivo pela metade. No Windows, se o arquivo estiver
 * em uso na hora da troca, tenta de novo até 5 vezes; persistindo, diz qual arquivo e sai com erro. A pasta ao lado é
 * apagada no fim, com sucesso ou falha. As decisões estão em `./montar-atomico.mjs`.
 *
 * O caminho do projeto é calculado a partir de `import.meta.url` em `server/config.ts`
 * (`..` do arquivo). `dist-server/` fica no mesmo nível de `server/`, então o resultado é o mesmo.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as dormir } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import {
  PASTA_PADRAO,
  apagarPastaTemporaria,
  caminhoParaMostrar,
  pastaTemporariaDe,
  resolverPastaDeSaida,
  trocarArquivos,
} from './montar-atomico.mjs'

/** `obrigatoria: false` = só entra na montagem se o arquivo existir (os ganchos chegam em outra frente). */
export const ENTRADAS = [
  { nome: 'index', fonte: 'server/index.ts', obrigatoria: true },
  { nome: 'mcp', fonte: 'server/mcp.ts', obrigatoria: true },
  { nome: 'ganchos', fonte: 'server/ganchos/principal.ts', obrigatoria: false },
]

/** Entradas que existem, na ordem de `ENTRADAS`. Uma obrigatória ausente é erro, não silêncio. */
export function entradasPresentes(raiz) {
  return ENTRADAS.filter(entrada => {
    if (existsSync(path.join(raiz, entrada.fonte))) return true
    if (entrada.obrigatoria) throw new Error(`Arquivo-fonte obrigatório ausente: ${entrada.fonte}`)
    return false
  })
}

/** Monta em `saida` (padrão: `dist-server` dentro de `raiz`) e devolve o caminho de cada programa montado. */
export async function montar(raiz, saida = path.resolve(raiz, PASTA_PADRAO)) {
  const entradas = entradasPresentes(raiz)
  const temporaria = pastaTemporariaDe(saida, process.pid)
  const apagarTemporaria = () => rm(temporaria, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  try {
    await apagarTemporaria() // sobra de uma montagem anterior que parou no meio, se o número do processo se repetiu
    await build({
      absWorkingDir: raiz,
      entryPoints: Object.fromEntries(entradas.map(entrada => [entrada.nome, entrada.fonte])),
      outdir: temporaria,
      outExtension: { '.js': '.mjs' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      packages: 'external',
      sourcemap: true,
      logLevel: 'warning',
    })
    await mkdir(saida, { recursive: true })
    await trocarArquivos({
      de: temporaria,
      para: saida,
      nomes: await readdir(temporaria),
      renomear: rename,
      esperar: ms => dormir(ms),
      plataforma: process.platform,
    })
  } finally {
    await apagarPastaTemporaria(temporaria, { apagar: apagarTemporaria, avisar: texto => console.error(texto) })
  }
  return entradas.map(entrada => path.join(saida, `${entrada.nome}.mjs`))
}

const raizDoProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const saida = resolverPastaDeSaida({ argv: process.argv.slice(2), env: process.env, raiz: raizDoProjeto, cwd: process.cwd() })
    const arquivos = await montar(raizDoProjeto, saida)
    console.log(`Montado: ${arquivos.map(arquivo => caminhoParaMostrar(raizDoProjeto, arquivo)).join(', ')}`)
  } catch (erro) {
    console.error(`Não foi possível montar: ${erro instanceof Error ? erro.message : String(erro)}`)
    process.exitCode = 1
  }
}
