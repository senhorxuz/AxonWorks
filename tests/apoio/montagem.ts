import { spawnSync } from 'node:child_process'
import { lstatSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Apoio dos testes da montagem: rodar `scripts/montar.mjs` numa pasta de saída temporária e conferir que o
 * `dist-server/` do repositório (lido pelos ganchos do Claude Code e pelo servidor do atalho) não foi tocado.
 */

export const raizDoProjeto = fileURLToPath(new URL('../..', import.meta.url))
export const montarMjs = path.join(raizDoProjeto, 'scripts', 'montar.mjs')
export const distServerReal = path.join(raizDoProjeto, 'dist-server')

/** Nome → "data:tamanho" de cada arquivo da pasta. Pasta que não existe = vazio (e continua igual se ainda não existir). */
export function fotografarPasta(pasta: string): Record<string, string> {
  let nomes: string[]
  try {
    nomes = readdirSync(pasta).sort()
  } catch {
    return {}
  }
  return Object.fromEntries(nomes.map(nome => {
    const info = statSync(path.join(pasta, nome))
    return [nome, `${info.mtimeMs}:${info.size}`]
  }))
}

export interface ResultadoDaMontagem {
  status: number | null
  stdout: string
  stderr: string
}

/** Roda `node scripts/montar.mjs <args>` na raiz do projeto. Erro de execução do processo vira exceção com o motivo. */
export function rodarMontagem(args: string[], env: NodeJS.ProcessEnv = {}): ResultadoDaMontagem {
  const resultado = spawnSync(process.execPath, [montarMjs, ...args], {
    cwd: raizDoProjeto,
    env: { ...process.env, AXON_SAIDA_MONTADO: '', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (resultado.error) throw new Error(`Não consegui rodar a montagem: ${resultado.error.message}`)
  return { status: resultado.status, stdout: resultado.stdout, stderr: resultado.stderr }
}

export interface PastaDeMontagem {
  /** Pasta temporária própria do teste (apagada em `limpar`). */
  base: string
  /** Onde montar: dentro de `base`, ainda não criada. */
  saida: string
  limpar(): void
}

/**
 * Pasta temporária para montar e rodar os programas montados dali. Os pacotes (`express`, o SDK do MCP...) ficam
 * de fora do arquivo montado e o Node os procura subindo as pastas a partir do arquivo; por isso a base leva uma
 * junção `node_modules` apontando para a do projeto. Apagar a base tira a junção primeiro: nunca segue o link.
 */
export function criarPastaDeMontagem(): PastaDeMontagem {
  const base = mkdtempSync(path.join(os.tmpdir(), 'axon-montagem-'))
  const ligacao = path.join(base, 'node_modules')
  symlinkSync(path.join(raizDoProjeto, 'node_modules'), ligacao, 'junction')
  return {
    base,
    saida: path.join(base, 'saida'),
    limpar() {
      try {
        if (lstatSync(ligacao).isSymbolicLink()) unlinkSync(ligacao)
      } catch {
        // a junção já não existe: nada a tirar
      }
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}
