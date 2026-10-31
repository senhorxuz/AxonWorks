// Trabalho não registrado (lote 2, D1): o que o git diz da pasta da sessão, para a retomada avisar
// commits depois do registro mais recente (em todos os ramos, remotos e worktrees) e arquivos alterados
// sem commit (da pasta principal). Só lê.
//
// Nunca atrapalha a sessão: os dois comandos rodam em processos filhos ao mesmo tempo, com tempo-limite
// próprio e um prazo total de `LIMITE_DO_GIT_MS`. Git ausente, pasta fora de repositório, erro ou demora nos
// dois: `null`, sem lançar. Cada comando falha separado: uma ref quebrada derruba o `log --all` (sai com 128)
// mas não o `status`, e vice-versa; o que falhou ou não chegou no prazo fica vazio e o outro vale. No prazo,
// quem não respondeu é morto e solto (canos fechados e `unref`), para que nenhum processo do git segure o
// programa do gancho aberto.
import { execFile } from 'node:child_process'

/** Prazo total do git na abertura da sessão. */
export const LIMITE_DO_GIT_MS = 1200
/** A saída de cada comando cabe nisto; maior (um status enorme) é erro e vira `null`. */
const SAIDA_MAXIMA = 1024 * 1024
/** O log traz até 6: com 6, a retomada sabe que houve mais de 5 sem listar o sexto. */
const COMMITS_LIDOS = '6'
/**
 * O trabalho acontece em outros ramos, em worktrees e no remoto, não no HEAD da pasta principal. `--all`
 * junta todas as refs do repositório (ramos, remotos, tags e o HEAD de cada worktree, que compartilham as
 * refs) e cada commit sai uma vez só. O stash e as notas (`git notes`) ficam de fora: os commits deles
 * ("index on…", "Notes added by…") não são trabalho. As exclusões têm de vir antes do `--all`.
 */
const TODOS_OS_RAMOS = ['--exclude=refs/stash', '--exclude=refs/notes/*', '--all']

export interface CommitRecente {
  hash: string
  titulo: string
}

export interface EstadoDoGit {
  /** Commits depois da data pedida, em qualquer ramo, remoto ou worktree, o mais novo primeiro (até 6). Vazio também quando o `log` falhou. */
  commits: CommitRecente[]
  /** Arquivos alterados sem commit (inclui os novos ainda não acompanhados). Zero também quando o `status` falhou. */
  alterados: number
}

export interface OpcoesDoFilho {
  timeout: number
  windowsHide: boolean
  encoding: 'utf8'
  maxBuffer: number
  env: NodeJS.ProcessEnv
}

/** O pedaço de um processo filho que este módulo usa. */
export interface FilhoDoGit {
  kill(): boolean
  unref(): void
  stdout: { destroy(): void } | null
  stderr: { destroy(): void } | null
}

export type ExecutorDoGit = (
  comando: string,
  args: string[],
  opcoes: OpcoesDoFilho,
  pronto: (erro: Error | null, saida: string) => void,
) => FilhoDoGit

export interface ComoRodarOGit {
  /** Programa do git (padrão: `git`, achado pelo PATH). */
  comando?: string
  /** Argumentos antes dos do git (os testes rodam um git simulado pelo node). */
  antes?: string[]
  limiteMs?: number
  executar?: ExecutorDoGit
}

const executarDeVerdade: ExecutorDoGit = (comando, args, opcoes, pronto) =>
  execFile(comando, args, opcoes, (erro, saida) => pronto(erro, saida))

const linhas = (texto: string): string[] => texto.split(/\r?\n/).filter((linha) => linha !== '')

function commitDaLinha(linha: string): CommitRecente {
  const tab = linha.indexOf('\t')
  return tab === -1 ? { hash: linha, titulo: '' } : { hash: linha.slice(0, tab), titulo: linha.slice(tab + 1) }
}

/** Puro: a saída de `log --format=%h%x09%s` e a de `status --porcelain`. */
export function interpretarGit(log: string, status: string): EstadoDoGit {
  return { commits: linhas(log).map(commitDaLinha), alterados: linhas(status).length }
}

/**
 * Puro: o que cada comando devolveu (`null`: falhou ou não chegou no prazo). Cada um falha separado: o que
 * faltou vira vazio e o outro vale. Só se os dois falharam não há estado (`null`).
 */
export function estadoDaLeitura(log: string | null, status: string | null): EstadoDoGit | null {
  return log === null && status === null ? null : interpretarGit(log ?? '', status ?? '')
}

/** Mata o filho que passou do prazo e o solta: sem canos abertos, ele não segura o programa. */
function largar(filho: FilhoDoGit): void {
  filho.kill()
  filho.stdout?.destroy()
  filho.stderr?.destroy()
  filho.unref()
}

/**
 * Commits depois de `desde` (ISO) em todos os ramos, remotos e worktrees do repositório (sem os de junção) e
 * arquivos alterados sem commit na `pasta` (só nela, não nos worktrees). `GIT_OPTIONAL_LOCKS=0`:
 * o status não grava o índice, então ler nunca disputa trava com o git do dono.
 */
export function lerEstadoDoGit(pasta: string, desde: string, como: ComoRodarOGit = {}): Promise<EstadoDoGit | null> {
  const limiteMs = como.limiteMs ?? LIMITE_DO_GIT_MS
  const executar = como.executar ?? executarDeVerdade
  const comando = como.comando ?? 'git'
  const antes = como.antes ?? []
  const opcoes: OpcoesDoFilho = {
    timeout: limiteMs,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: SAIDA_MAXIMA,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }
  const filhos: FilhoDoGit[] = []
  const lido: { log: string | null; status: string | null } = { log: null, status: null }
  /** Roda um comando e guarda a saída em `lido`; erro (ou executor que lança) deixa `null`, sem derrubar o outro. */
  const rodar = (campo: 'log' | 'status', args: string[]): Promise<void> =>
    new Promise<string>((ok, falha) => {
      filhos.push(executar(comando, [...antes, '-C', pasta, ...args], opcoes, (erro, saida) => (erro ? falha(erro) : ok(saida))))
    })
      .catch(() => null)
      .then((saida) => {
        lido[campo] = saida
      })
  const leituras = Promise.all([
    rodar('log', ['log', ...TODOS_OS_RAMOS, `--since=${desde}`, '--no-merges', '--format=%h%x09%s', '-n', COMMITS_LIDOS]),
    rodar('status', ['status', '--porcelain']),
  ])
  return new Promise((pronto) => {
    const prazo = setTimeout(() => {
      filhos.forEach(largar)
      pronto(estadoDaLeitura(lido.log, lido.status))
    }, limiteMs)
    void leituras.then(() => {
      clearTimeout(prazo)
      pronto(estadoDaLeitura(lido.log, lido.status))
    })
  })
}
