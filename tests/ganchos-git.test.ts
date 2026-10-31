import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  LIMITE_DO_GIT_MS,
  estadoDaLeitura,
  interpretarGit,
  lerEstadoDoGit,
  type ExecutorDoGit,
  type FilhoDoGit,
  type OpcoesDoFilho,
} from '../server/ganchos/git.ts'

/**
 * Trabalho não registrado (lote 2, D1): o que o git diz da pasta da sessão. Qualquer falha, ausência
 * ou demora do git vira `null` dentro do tempo-limite, sem lançar.
 */

const pastas: string[] = []

afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function temporaria(): string {
  const pasta = mkdtempSync(join(tmpdir(), 'axon-git-'))
  pastas.push(pasta)
  return pasta
}

function gitDisponivel(): boolean {
  try {
    execFileSync('git', ['--version'], { windowsHide: true, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const TEM_GIT = gitDisponivel()

interface Chamada {
  comando: string
  args: string[]
  opcoes: OpcoesDoFilho
}

interface Falso {
  executar: ExecutorDoGit
  chamadas: Chamada[]
  /** O que cada filho falso fez quando foi largado. */
  largados: string[][]
}

/** Executor falso: `responder` decide, por chamada, o que volta (ou `undefined` para nunca responder). */
function executorFalso(responder: (args: string[]) => { erro: Error | null; saida: string } | undefined): Falso {
  const chamadas: Chamada[] = []
  const largados: string[][] = []
  const executar: ExecutorDoGit = (comando, args, opcoes, pronto) => {
    chamadas.push({ comando, args, opcoes })
    const feito: string[] = []
    largados.push(feito)
    const resposta = responder(args)
    if (resposta !== undefined) setImmediate(() => pronto(resposta.erro, resposta.saida))
    const filho: FilhoDoGit = {
      kill: () => {
        feito.push('kill')
        return true
      },
      unref: () => {
        feito.push('unref')
      },
      stdout: { destroy: () => void feito.push('stdout') },
      stderr: { destroy: () => void feito.push('stderr') },
    }
    return filho
  }
  return { executar, chamadas, largados }
}

const ehLog = (args: string[]): boolean => args.includes('log')

const git = (pasta: string, ...args: string[]) =>
  execFileSync('git', ['-C', pasta, '-c', 'user.email=t@axon', '-c', 'user.name=Teste', ...args], { windowsHide: true, stdio: 'pipe' })

/** Com data de autor e de quem gravou fixas (dia de outubro de 2026): o que vale é o dia, não o relógio. */
function comData(dia: string): NodeJS.ProcessEnv {
  const data = `2026-10-${dia}T10:00:00Z`
  return { ...process.env, GIT_COMMITTER_DATE: data, GIT_AUTHOR_DATE: data }
}

/** Commit vazio, em qualquer pasta do repositório (principal ou worktree). */
function commitar(pasta: string, titulo: string, dia: string): void {
  execFileSync('git', ['-C', pasta, '-c', 'user.email=t@axon', '-c', 'user.name=Teste', 'commit', '-q', '--allow-empty', '-m', titulo], {
    windowsHide: true,
    stdio: 'pipe',
    env: comData(dia),
  })
}

/** A pasta principal do dono: parada no ramo `antigo`, com um commit de antes do registro (dia 10). */
function pastaPrincipalNoRamoAntigo(): { base: string; principal: string } {
  const base = temporaria()
  const principal = join(base, 'principal')
  mkdirSync(principal)
  git(principal, 'init', '-q', '-b', 'antigo')
  commitar(principal, 'Antes do registro', '10')
  return { base, principal }
}

const DESDE = '2026-10-11T10:00:00.000Z'
/** Prazo largo: estes testes provam quais commits aparecem, não a pressa (isso é dos testes de tempo). */
const ler = (pasta: string, desde: string) => lerEstadoDoGit(pasta, desde, { limiteMs: 15_000 })
const titulos = (estado: Awaited<ReturnType<typeof lerEstadoDoGit>>): string[] | undefined => estado?.commits.map((c) => c.titulo)

describe('interpretarGit', () => {
  it('cada linha do log vira hash e título (o título pode ter tabulação); cada linha do status é um arquivo', () => {
    const log = 'a1b2c3d\tCorrige o login\r\ne4f5a6b\tTítulo\tcom tabulação\n\n'
    const status = ' M server/a.ts\n?? novo.txt\r\nD  velho.ts\n'
    assert.deepEqual(interpretarGit(log, status), {
      commits: [
        { hash: 'a1b2c3d', titulo: 'Corrige o login' },
        { hash: 'e4f5a6b', titulo: 'Título\tcom tabulação' },
      ],
      alterados: 3,
    })
  })

  it('saída vazia: nenhum commit e nenhum arquivo', () => {
    assert.deepEqual(interpretarGit('', ''), { commits: [], alterados: 0 })
    assert.deepEqual(interpretarGit('\n', '\r\n'), { commits: [], alterados: 0 })
  })

  it('linha de log sem tabulação: o hash é a linha inteira e o título fica vazio', () => {
    assert.deepEqual(interpretarGit('a1b2c3d', '').commits, [{ hash: 'a1b2c3d', titulo: '' }])
  })
})

describe('estadoDaLeitura', () => {
  it('os dois comandos responderam: o estado inteiro', () => {
    assert.deepEqual(estadoDaLeitura('a1b2c3d\tUm\n', ' M a.ts\n'), { commits: [{ hash: 'a1b2c3d', titulo: 'Um' }], alterados: 1 })
  })

  it('só o log falhou (null): sem commits, e os arquivos alterados continuam valendo', () => {
    assert.deepEqual(estadoDaLeitura(null, ' M a.ts\n?? b.ts\n'), { commits: [], alterados: 2 })
  })

  it('só o status falhou (null): sem arquivos alterados, e os commits continuam valendo', () => {
    assert.deepEqual(estadoDaLeitura('a1b2c3d\tUm\n', null), { commits: [{ hash: 'a1b2c3d', titulo: 'Um' }], alterados: 0 })
  })

  it('os dois falharam: não há estado (null)', () => {
    assert.equal(estadoDaLeitura(null, null), null)
  })

  it('saída vazia não é falha: nada a avisar, mas o estado existe', () => {
    assert.deepEqual(estadoDaLeitura('', ''), { commits: [], alterados: 0 })
  })
})

describe('lerEstadoDoGit (executor falso)', () => {
  it('roda log e status na pasta, com o tempo-limite, janela escondida e sem travas opcionais', async () => {
    const falso = executorFalso((args) => ({ erro: null, saida: ehLog(args) ? 'a1b2c3d\tUm\n' : ' M a.ts\n' }))
    const estado = await lerEstadoDoGit('D:\\Projetos\\alfa', '2026-10-20T10:00:00.000Z', { executar: falso.executar })
    assert.deepEqual(estado, { commits: [{ hash: 'a1b2c3d', titulo: 'Um' }], alterados: 1 })
    assert.equal(LIMITE_DO_GIT_MS, 1200)
    assert.deepEqual(
      falso.chamadas.map((c) => [c.comando, c.args]),
      [
        [
          'git',
          [
            ...['-C', 'D:\\Projetos\\alfa', 'log', '--exclude=refs/stash', '--exclude=refs/notes/*', '--all'],
            ...['--since=2026-10-20T10:00:00.000Z', '--no-merges', '--format=%h%x09%s', '-n', '6'],
          ],
        ],
        ['git', ['-C', 'D:\\Projetos\\alfa', 'status', '--porcelain']],
      ],
    )
    for (const { opcoes } of falso.chamadas) {
      assert.equal(opcoes.timeout, 1200)
      assert.equal(opcoes.windowsHide, true)
      assert.equal(opcoes.encoding, 'utf8')
      assert.equal(opcoes.maxBuffer, 1024 * 1024)
      assert.equal(opcoes.env.GIT_OPTIONAL_LOCKS, '0')
      assert.equal(opcoes.env.PATH, process.env.PATH)
    }
    assert.deepEqual(falso.largados, [[], []], 'quem respondeu a tempo não é largado')
  })

  it('resposta a tempo desarma o prazo: depois dele, ninguém é largado', async () => {
    const falso = executorFalso(() => ({ erro: null, saida: '' }))
    assert.deepEqual(await lerEstadoDoGit('p', 'd', { executar: falso.executar, limiteMs: 20 }), { commits: [], alterados: 0 })
    await new Promise((pronto) => setTimeout(pronto, 60))
    assert.deepEqual(falso.largados, [[], []])
  })

  it('comando e argumentos de antes trocáveis; o tempo-limite pedido vai para os dois filhos', async () => {
    const falso = executorFalso(() => ({ erro: null, saida: '' }))
    await lerEstadoDoGit('p', 'd', { executar: falso.executar, comando: 'node', antes: ['falso.mjs'], limiteMs: 50 })
    assert.deepEqual(falso.chamadas[0].comando, 'node')
    assert.deepEqual(falso.chamadas[0].args.slice(0, 3), ['falso.mjs', '-C', 'p'])
    assert.deepEqual(falso.chamadas[1].args.slice(0, 3), ['falso.mjs', '-C', 'p'])
    assert.deepEqual(falso.chamadas.map((c) => c.opcoes.timeout), [50, 50])
  })

  it('erro nos dois comandos: null', async () => {
    const falso = executorFalso(() => ({ erro: new Error('fatal'), saida: 'x\ty' }))
    assert.equal(await lerEstadoDoGit('p', 'd', { executar: falso.executar }), null)
  })

  it('erro só no log: sem commits, mas os arquivos alterados continuam no estado (a saída com erro é descartada)', async () => {
    const falso = executorFalso((args) => (ehLog(args) ? { erro: new Error('fatal: bad object'), saida: 'x\ty' } : { erro: null, saida: ' M a.ts\n?? b.ts\n' }))
    assert.deepEqual(await lerEstadoDoGit('p', 'd', { executar: falso.executar }), { commits: [], alterados: 2 })
  })

  it('erro só no status: sem arquivos alterados, mas os commits continuam no estado (a saída com erro é descartada)', async () => {
    const falso = executorFalso((args) => (ehLog(args) ? { erro: null, saida: 'a1b2c3d\tUm\n' } : { erro: new Error('fatal'), saida: ' M a.ts\n' }))
    assert.deepEqual(await lerEstadoDoGit('p', 'd', { executar: falso.executar }), { commits: [{ hash: 'a1b2c3d', titulo: 'Um' }], alterados: 0 })
  })

  it('executor que lança na hora nos dois: null', async () => {
    const executar: ExecutorDoGit = () => {
      throw new Error('spawn EINVAL')
    }
    assert.equal(await lerEstadoDoGit('p', 'd', { executar }), null)
  })

  it('executor que lança na hora só no log (ou só no status): o outro comando vale', async () => {
    const falso = executorFalso((args) => ({ erro: null, saida: ehLog(args) ? 'a1b2c3d\tUm\n' : ' M a.ts\n' }))
    for (const quebra of ['log', 'status']) {
      const executar: ExecutorDoGit = (comando, args, opcoes, pronto) => {
        if (args.includes(quebra)) throw new Error('spawn EINVAL')
        return falso.executar(comando, args, opcoes, pronto)
      }
      const estado = await lerEstadoDoGit('p', 'd', { executar })
      assert.deepEqual(estado, quebra === 'log' ? { commits: [], alterados: 1 } : { commits: [{ hash: 'a1b2c3d', titulo: 'Um' }], alterados: 0 }, quebra)
    }
  })

  it('demora além do limite nos dois: null no prazo, e cada filho é morto, solto e tem os canos fechados', async () => {
    const falso = executorFalso(() => undefined)
    const inicio = performance.now()
    const estado = await lerEstadoDoGit('p', 'd', { executar: falso.executar, limiteMs: 60 })
    const ms = performance.now() - inicio
    assert.equal(estado, null)
    assert.ok(ms >= 55 && ms < 300, `${ms.toFixed(0)} ms`)
    for (const feito of falso.largados) assert.deepEqual(feito, ['kill', 'stdout', 'stderr', 'unref'])
  })

  it('demora além do limite só em um: no prazo, o que respondeu vale e o que não respondeu é largado', async () => {
    const casos: Array<[string, (args: string[]) => boolean, unknown]> = [
      ['status', ehLog, { commits: [{ hash: 'a1b2c3d', titulo: 'Um' }], alterados: 0 }],
      ['log', (args) => !ehLog(args), { commits: [], alterados: 1 }],
    ]
    for (const [lento, respondeu, esperado] of casos) {
      const falso = executorFalso((args) => (respondeu(args) ? { erro: null, saida: ehLog(args) ? 'a1b2c3d\tUm\n' : ' M a.ts\n' } : undefined))
      const inicio = performance.now()
      const estado = await lerEstadoDoGit('p', 'd', { executar: falso.executar, limiteMs: 60 })
      const ms = performance.now() - inicio
      assert.deepEqual(estado, esperado, `${lento} lento`)
      assert.ok(ms >= 55 && ms < 300, `${lento} lento: ${ms.toFixed(0)} ms`)
      for (const feito of falso.largados) assert.deepEqual(feito, ['kill', 'stdout', 'stderr', 'unref'])
    }
  })

  it('filho sem canos (stdout e stderr nulos) também é largado sem erro', async () => {
    const executar: ExecutorDoGit = () => ({ kill: () => true, unref: () => {}, stdout: null, stderr: null })
    assert.equal(await lerEstadoDoGit('p', 'd', { executar, limiteMs: 20 }), null)
  })
})

describe('lerEstadoDoGit (processo de verdade)', () => {
  it('repositório real: commits depois da data (os mais novos primeiro) e arquivos alterados sem commit', { skip: !TEM_GIT }, async () => {
    const pasta = temporaria()
    git(pasta, 'init', '-q')
    for (const [dia, titulo] of [['10', 'Antes do registro'], ['12', 'Primeiro depois'], ['14', 'Segundo depois']]) {
      execFileSync('git', ['-C', pasta, '-c', 'user.email=t@axon', '-c', 'user.name=Teste', 'commit', '-q', '--allow-empty', '-m', titulo], {
        windowsHide: true,
        env: { ...process.env, GIT_COMMITTER_DATE: `2026-10-${dia}T10:00:00Z`, GIT_AUTHOR_DATE: `2026-10-${dia}T10:00:00Z` },
      })
    }
    writeFileSync(join(pasta, 'novo.txt'), 'x')
    writeFileSync(join(pasta, 'outro.txt'), 'y')
    const estado = await ler(pasta, DESDE)
    assert.deepEqual(estado?.commits.map((c) => c.titulo), ['Segundo depois', 'Primeiro depois'])
    assert.ok(estado?.commits.every((c) => /^[0-9a-f]{7,}$/.test(c.hash)))
    assert.equal(estado?.alterados, 2)
  })

  it('git ausente: null, rápido', async () => {
    const inicio = performance.now()
    assert.equal(await lerEstadoDoGit(temporaria(), '2026-10-11T10:00:00.000Z', { comando: 'git-que-nao-existe-na-axon' }), null)
    assert.ok(performance.now() - inicio < LIMITE_DO_GIT_MS, 'git ausente não espera o tempo-limite')
  })

  it('pasta que não é repositório (ou que não existe): null, rápido', { skip: !TEM_GIT }, async () => {
    const pasta = temporaria()
    let dentroDeRepositorio = true
    try {
      git(pasta, 'rev-parse', '--git-dir')
    } catch {
      dentroDeRepositorio = false
    }
    const alvos = dentroDeRepositorio ? [join(pasta, 'nao-existe')] : [pasta, join(pasta, 'nao-existe')]
    for (const alvo of alvos) {
      const inicio = performance.now()
      assert.equal(await lerEstadoDoGit(alvo, '2026-10-11T10:00:00.000Z'), null, alvo)
      assert.ok(performance.now() - inicio < LIMITE_DO_GIT_MS, alvo)
    }
  })

  it('git lento (simulado): null em até o tempo-limite, mais uma folga pequena', async () => {
    const pasta = temporaria()
    const lento = join(pasta, 'git-lento.mjs')
    writeFileSync(lento, 'setTimeout(() => {}, 10_000)\n')
    const inicio = performance.now()
    const estado = await lerEstadoDoGit(pasta, '2026-10-11T10:00:00.000Z', { comando: process.execPath, antes: [lento] })
    const ms = performance.now() - inicio
    assert.equal(estado, null)
    assert.ok(ms >= LIMITE_DO_GIT_MS - 5 && ms < LIMITE_DO_GIT_MS + 250, `${ms.toFixed(0)} ms`)
  })
})

describe('lerEstadoDoGit (todos os ramos, repositório de verdade)', () => {
  it('commit novo num ramo que não é o HEAD da pasta aparece', { skip: !TEM_GIT }, async () => {
    const { principal } = pastaPrincipalNoRamoAntigo()
    git(principal, 'checkout', '-q', '-b', 'versao')
    commitar(principal, 'Versão nova', '12')
    git(principal, 'checkout', '-q', 'antigo')
    assert.deepEqual(titulos(await ler(principal, DESDE)), ['Versão nova'])
  })

  it('commit novo num worktree (ramo próprio ou HEAD solto) aparece; o alterado só conta na pasta principal', { skip: !TEM_GIT }, async () => {
    const { base, principal } = pastaPrincipalNoRamoAntigo()
    const comRamo = join(base, 'trabalho')
    const solto = join(base, 'solto')
    git(principal, 'worktree', 'add', '-q', '-b', 'trabalho', comRamo)
    git(principal, 'worktree', 'add', '-q', '--detach', solto)
    commitar(comRamo, 'No ramo do worktree', '12')
    commitar(solto, 'No HEAD solto do worktree', '13')
    writeFileSync(join(comRamo, 'so-no-worktree.txt'), 'x')
    const estado = await ler(principal, DESDE)
    assert.deepEqual(titulos(estado), ['No HEAD solto do worktree', 'No ramo do worktree'])
    assert.equal(estado?.alterados, 0, 'o status é só da pasta principal')
    writeFileSync(join(principal, 'na-principal.txt'), 'y')
    assert.equal((await ler(principal, DESDE))?.alterados, 1)
  })

  it('commit que só existe no remoto (origin/main buscado) aparece', { skip: !TEM_GIT }, async () => {
    const { base, principal } = pastaPrincipalNoRamoAntigo()
    const origem = join(base, 'origem.git')
    const outraCopia = join(base, 'outra-copia')
    git(base, 'init', '-q', '--bare', '-b', 'main', origem)
    git(principal, 'remote', 'add', 'origin', origem)
    git(principal, 'push', '-q', 'origin', 'antigo:main')
    git(base, 'clone', '-q', origem, outraCopia)
    commitar(outraCopia, 'Subiu no origin/main', '12')
    git(outraCopia, 'push', '-q', 'origin', 'main')
    assert.deepEqual(titulos(await ler(principal, DESDE)), [], 'antes do fetch a pasta ainda não conhece o commit')
    git(principal, 'fetch', '-q', 'origin')
    assert.deepEqual(titulos(await ler(principal, DESDE)), ['Subiu no origin/main'])
  })

  it('o mesmo commit alcançado por vários ramos, pelo remoto e pelo worktree aparece uma vez só', { skip: !TEM_GIT }, async () => {
    const { base, principal } = pastaPrincipalNoRamoAntigo()
    const origem = join(base, 'origem.git')
    git(base, 'init', '-q', '--bare', '-b', 'main', origem)
    git(principal, 'remote', 'add', 'origin', origem)
    git(principal, 'checkout', '-q', '-b', 'versao')
    commitar(principal, 'Em vários lugares', '12')
    git(principal, 'push', '-q', 'origin', 'versao:main')
    git(principal, 'fetch', '-q', 'origin')
    git(principal, 'branch', 'copia-do-ramo')
    git(principal, 'worktree', 'add', '-q', '--detach', join(base, 'solto'), 'versao')
    git(principal, 'checkout', '-q', 'antigo')
    const estado = await ler(principal, DESDE)
    assert.deepEqual(titulos(estado), ['Em vários lugares'])
  })

  it('commit de junção (merge) e o escondido do stash não contam; os commits de verdade sim', { skip: !TEM_GIT }, async () => {
    const { principal } = pastaPrincipalNoRamoAntigo()
    git(principal, 'checkout', '-q', '-b', 'versao')
    commitar(principal, 'Do ramo', '12')
    git(principal, 'checkout', '-q', 'antigo')
    commitar(principal, 'Na linha principal', '13')
    execFileSync('git', ['-C', principal, '-c', 'user.email=t@axon', '-c', 'user.name=Teste', 'merge', '-q', '--no-ff', '-m', 'Junta o ramo', 'versao'], {
      windowsHide: true,
      stdio: 'pipe',
      env: comData('14'),
    })
    writeFileSync(join(principal, 'guardado.txt'), 'x')
    git(principal, 'add', 'guardado.txt')
    execFileSync('git', ['-C', principal, '-c', 'user.email=t@axon', '-c', 'user.name=Teste', 'stash', 'push', '-q', '-m', 'guardado'], {
      windowsHide: true,
      stdio: 'pipe',
      env: comData('15'),
    })
    assert.deepEqual(titulos(await ler(principal, DESDE)), ['Na linha principal', 'Do ramo'])
  })

  it('nota do git (git notes) não aparece como commit; o commit anotado sim', { skip: !TEM_GIT }, async () => {
    const { principal } = pastaPrincipalNoRamoAntigo()
    commitar(principal, 'Trabalho de verdade', '12')
    execFileSync('git', ['-C', principal, '-c', 'user.email=t@axon', '-c', 'user.name=Teste', 'notes', 'add', '-m', 'anotação', 'HEAD'], {
      windowsHide: true,
      stdio: 'pipe',
      env: comData('13'),
    })
    const semExcluir = git(principal, 'log', '--exclude=refs/stash', '--all', '--no-merges', '--format=%s', `--since=${DESDE}`).toString()
    assert.match(semExcluir, /Notes added by/, 'sem a exclusão, o commit das notas entra no log (a premissa do teste)')
    assert.deepEqual(titulos(await ler(principal, DESDE)), ['Trabalho de verdade'])
  })

  it('ref quebrada (ramo que aponta para objeto inexistente): o log do git falha, mas os arquivos alterados continuam no estado', { skip: !TEM_GIT }, async () => {
    const { principal } = pastaPrincipalNoRamoAntigo()
    commitar(principal, 'Depois do registro', '12')
    writeFileSync(join(principal, 'novo.txt'), 'x')
    writeFileSync(join(principal, 'outro.txt'), 'y')
    writeFileSync(join(principal, '.git', 'refs', 'heads', 'quebrada'), `${'1'.repeat(40)}\n`)
    assert.throws(() => git(principal, 'log', '--all', '--format=%h'), /Command failed/, 'a premissa do teste: o git log --all sai com erro por causa da ref')
    assert.deepEqual(await ler(principal, DESDE), { commits: [], alterados: 2 })
  })

  it('índice quebrado: o status do git falha, mas os commits continuam no estado', { skip: !TEM_GIT }, async () => {
    const { principal } = pastaPrincipalNoRamoAntigo()
    commitar(principal, 'Depois do registro', '12')
    writeFileSync(join(principal, '.git', 'index'), 'isto não é um índice do git')
    assert.throws(() => git(principal, 'status', '--porcelain'), /Command failed/, 'a premissa do teste: o git status sai com erro por causa do índice')
    const estado = await ler(principal, DESDE)
    assert.deepEqual(titulos(estado), ['Depois do registro'])
    assert.equal(estado?.alterados, 0)
  })

  it('só vale depois do registro, e traz no máximo 6, os mais novos primeiro, juntando todos os ramos', { skip: !TEM_GIT }, async () => {
    const { base, principal } = pastaPrincipalNoRamoAntigo()
    const trabalho = join(base, 'trabalho')
    git(principal, 'worktree', 'add', '-q', '-b', 'trabalho', trabalho)
    for (const [pasta, dia, titulo] of [
      [principal, '11', 'Dia 11 na principal'],
      [trabalho, '12', 'Dia 12 no worktree'],
      [principal, '13', 'Dia 13 na principal'],
      [trabalho, '14', 'Dia 14 no worktree'],
      [principal, '15', 'Dia 15 na principal'],
      [trabalho, '16', 'Dia 16 no worktree'],
      [principal, '17', 'Dia 17 na principal'],
    ] as const) {
      commitar(pasta, titulo, dia)
    }
    assert.deepEqual(titulos(await ler(principal, '2026-10-10T12:00:00.000Z')), [
      'Dia 17 na principal',
      'Dia 16 no worktree',
      'Dia 15 na principal',
      'Dia 14 no worktree',
      'Dia 13 na principal',
      'Dia 12 no worktree',
    ])
    assert.deepEqual(titulos(await ler(principal, '2026-10-16T12:00:00.000Z')), ['Dia 17 na principal'])
  })
})
