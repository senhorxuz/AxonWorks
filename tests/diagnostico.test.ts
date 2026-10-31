import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { SKILLS_DA_AXON, entradaMcp, mesclarGanchos } from '../scripts/claude/configuracao.ts'
import { caminhosPadrao, coletarFatos, executarDiagnostico, principal, type Ambiente } from '../scripts/diagnostico.ts'
import { WorkspaceStore } from '../server/store.ts'

/**
 * Diagnóstico de um comando (D8), a parte que liga: colhe os fatos do computador e imprime.
 * Tudo aqui roda em pastas e bancos temporários: nenhum teste lê o ~/.claude, o ~/.claude.json ou o banco de verdade.
 */

const criadas: string[] = []
const abertos: WorkspaceStore[] = []
afterEach(() => {
  for (const store of abertos.splice(0)) store.close()
  for (const pasta of criadas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function pastaTemporaria(prefixo: string): string {
  const pasta = mkdtempSync(join(tmpdir(), `axon-diag-${prefixo}-`))
  criadas.push(pasta)
  return pasta
}

const SKILL = '---\nname: axon-ligar-projeto\n---\nTexto da skill\n'
const SKILL_SALVAR = '---\nname: axon-salvar-antes-de-compactar\n---\nTexto da outra skill\n'
const HORA = Date.parse('2026-10-25T12:00:00.000Z')
const UMA_HORA = 3_600_000

function marcarHora(caminho: string, ms: number): void {
  utimesSync(caminho, new Date(ms), new Date(ms))
}

function gravar(caminho: string, conteudo: string, ms?: number): void {
  mkdirSync(join(caminho, '..'), { recursive: true })
  writeFileSync(caminho, conteudo)
  if (ms !== undefined) marcarHora(caminho, ms)
}

interface Cenario {
  amb: Ambiente
  raiz: string
  pastaClaude: string
  settings: string
  claudeJson: string
  banco: string
  saida: string[]
  texto: () => string
}

/** Uma instalação saudável: tudo montado depois do código, ganchos, MCP, as duas skills e banco com um projeto. */
function cenario(): Cenario {
  const raiz = pastaTemporaria('raiz')
  const casa = pastaTemporaria('casa')
  const pastaClaude = join(casa, '.claude')
  const claudeJson = join(casa, '.claude.json')
  const banco = join(raiz, '.axon', 'workspace.sqlite')
  const ganchos = join(raiz, 'dist-server', 'ganchos.mjs')
  const mcp = join(raiz, 'dist-server', 'mcp.mjs')

  gravar(join(raiz, 'server', 'store.ts'), '// código', HORA - UMA_HORA)
  gravar(join(raiz, 'server', 'carta', 'montar.ts'), '// código', HORA - 2 * UMA_HORA)
  gravar(join(raiz, 'shared', 'carta.ts'), '// código', HORA - 3 * UMA_HORA)
  for (const nome of ['index.mjs', 'mcp.mjs', 'ganchos.mjs']) gravar(join(raiz, 'dist-server', nome), '', HORA)
  gravar(join(raiz, 'scripts', 'claude', 'skill-ligar-projeto', 'SKILL.md'), SKILL)
  gravar(join(pastaClaude, 'skills', 'axon-ligar-projeto', 'SKILL.md'), SKILL)
  gravar(join(raiz, 'scripts', 'claude', 'skill-salvar-antes-de-compactar', 'SKILL.md'), SKILL_SALVAR)
  gravar(join(pastaClaude, 'skills', 'axon-salvar-antes-de-compactar', 'SKILL.md'), SKILL_SALVAR)

  const settings = join(pastaClaude, 'settings.json')
  const ligado = mesclarGanchos({ model: 'opus' }, { node: process.execPath, script: ganchos })
  gravar(settings, JSON.stringify(ligado, null, 2))
  gravar(claudeJson, JSON.stringify({ mcpServers: { axon: { type: 'stdio', ...entradaMcp({ node: process.execPath, script: mcp }) } } }))

  const store = new WorkspaceStore(banco)
  try {
    const projeto = store.createProject({ name: 'Axon Works', objective: 'Correio de continuidade', workspacePath: raiz })
    store.registrarEventoDeIntegracao(projeto.id, { tipo: 'abrir', ok: true, detalhe: null })
  } finally {
    store.close()
  }

  const saida: string[] = []
  return {
    amb: { raiz, pastaClaude, arquivoClaudeJson: claudeJson, caminhoDoBanco: banco, imprimir: (l) => saida.push(l) },
    raiz,
    pastaClaude,
    settings,
    claudeJson,
    banco,
    saida,
    texto: () => saida.join('\n'),
  }
}

/** Fotografia de tudo o que existe nas pastas: nome, tamanho e hora de cada arquivo. */
function fotografia(...pastas: string[]): string[] {
  const linhas: string[] = []
  const visitar = (pasta: string): void => {
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, entrada.name)
      if (entrada.isDirectory()) visitar(caminho)
      else linhas.push(`${caminho} ${statSync(caminho).size} ${statSync(caminho).mtimeMs}`)
    }
  }
  for (const pasta of pastas) visitar(pasta)
  return linhas.sort()
}

describe('coletarFatos', () => {
  it('numa instalação saudável, colhe cada fato do computador', () => {
    const c = cenario()
    const fatos = coletarFatos(c.amb)
    assert.equal(fatos.raiz, c.raiz)
    assert.equal(fatos.plataforma, process.platform)
    assert.equal(fatos.arquivoSettings, c.settings)
    assert.equal(fatos.arquivoClaudeJson, c.claudeJson)
    assert.equal(fatos.caminhoDoBanco, c.banco)
    assert.deepEqual(fatos.eventosEsperados, ['SessionStart', 'PostCompact', 'Stop', 'SessionEnd'])
    assert.equal(fatos.settings.tipo, 'ok')
    assert.equal(fatos.claudeJson.tipo, 'ok')
    assert.deepEqual(
      fatos.montados.map((m) => [m.nome, m.presente, m.mtimeMs]),
      [
        ['index.mjs', true, HORA],
        ['mcp.mjs', true, HORA],
        ['ganchos.mjs', true, HORA],
      ],
    )
    assert.deepEqual(fatos.fonteMaisNova, { arquivo: 'server/store.ts', mtimeMs: HORA - UMA_HORA })
    assert.deepEqual(fatos.skills, [
      { nome: 'axon-ligar-projeto', estado: 'igual' },
      { nome: 'axon-salvar-antes-de-compactar', estado: 'igual' },
    ])
    assert.equal(fatos.existe(join(c.raiz, 'dist-server', 'mcp.mjs')), true)
    assert.equal(fatos.existe(join(c.raiz, 'dist-server', 'nao-existe.mjs')), false)
    assert.equal(fatos.banco.tipo, 'aberto')
    if (fatos.banco.tipo !== 'aberto') return
    assert.deepEqual(fatos.banco.quickCheck, ['ok'])
    assert.equal(fatos.banco.projetos.length, 1)
    assert.equal(fatos.banco.projetos[0].nome, 'Axon Works')
    assert.equal(fatos.banco.projetos[0].pasta, c.raiz)
    assert.match(fatos.banco.projetos[0].ultimoRegistroAutomatico ?? '', /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(fatos.banco.projetos[0].ultimoErro, null)
  })

  it('a fonte mais nova é a de qualquer pasta dentro de server/ e shared/, com barras "/"', () => {
    const c = cenario()
    gravar(join(c.raiz, 'shared', 'fundo', 'novo.ts'), '// mais novo', HORA + UMA_HORA)
    assert.deepEqual(coletarFatos(c.amb).fonteMaisNova, { arquivo: 'shared/fundo/novo.ts', mtimeMs: HORA + UMA_HORA })
  })

  it('sem server/ nem shared/, não há fonte para comparar', () => {
    const c = cenario()
    rmSync(join(c.raiz, 'server'), { recursive: true })
    rmSync(join(c.raiz, 'shared'), { recursive: true })
    assert.equal(coletarFatos(c.amb).fonteMaisNova, null)
  })

  it('arquivo montado que falta aparece como ausente', () => {
    const c = cenario()
    rmSync(join(c.raiz, 'dist-server', 'mcp.mjs'))
    const mcp = coletarFatos(c.amb).montados.find((m) => m.nome === 'mcp.mjs')
    assert.equal(mcp?.presente, false)
  })

  const instalada = (c: Cenario, nome: string): string => join(c.pastaClaude, 'skills', nome, 'SKILL.md')

  it('skills: uma por skill da lista da Axon, na ordem dela, com ausente, diferente e igual', () => {
    const c = cenario()
    // Mesmo tamanho, outro conteúdo: só a comparação byte a byte percebe.
    gravar(instalada(c, 'axon-ligar-projeto'), SKILL.replace('Texto', 'Outro'))
    rmSync(instalada(c, 'axon-salvar-antes-de-compactar'))
    assert.deepEqual(coletarFatos(c.amb).skills, [
      { nome: 'axon-ligar-projeto', estado: 'diferente' },
      { nome: 'axon-salvar-antes-de-compactar', estado: 'ausente' },
    ])
    gravar(instalada(c, 'axon-salvar-antes-de-compactar'), SKILL_SALVAR)
    gravar(instalada(c, 'axon-ligar-projeto'), SKILL)
    assert.deepEqual(
      coletarFatos(c.amb).skills.map((s) => [s.nome, s.estado]),
      SKILLS_DA_AXON.map(({ nome }) => [nome, 'igual']),
    )
  })

  it('só as skills da lista da Axon contam: pasta skill-* fora da lista é ignorada, mesmo com SKILL.md e instalada', () => {
    const c = cenario()
    gravar(join(c.raiz, 'scripts', 'claude', 'skill-antiga', 'SKILL.md'), 'versão nova')
    gravar(instalada(c, 'axon-antiga'), 'versão velha')
    gravar(join(c.raiz, 'scripts', 'claude', 'outra-coisa', 'SKILL.md'), 'x')
    mkdirSync(join(c.raiz, 'scripts', 'claude', 'skill-vazia'))
    gravar(join(c.raiz, 'scripts', 'claude', 'skill-solta.md'), 'x')
    assert.deepEqual(
      coletarFatos(c.amb).skills.map((s) => s.nome),
      SKILLS_DA_AXON.map(({ nome }) => nome),
    )
  })

  it('skill da lista sem SKILL.md de origem nesta pasta fica de fora, instalada ou não', () => {
    const c = cenario()
    const origem = join(c.raiz, 'scripts', 'claude', 'skill-salvar-antes-de-compactar', 'SKILL.md')
    rmSync(origem)
    assert.deepEqual(coletarFatos(c.amb).skills, [{ nome: 'axon-ligar-projeto', estado: 'igual' }], 'instalada, mas sem origem')
    rmSync(instalada(c, 'axon-salvar-antes-de-compactar'))
    assert.deepEqual(coletarFatos(c.amb).skills, [{ nome: 'axon-ligar-projeto', estado: 'igual' }], 'nem instalada nem de origem')
    rmSync(join(c.raiz, 'scripts', 'claude', 'skill-ligar-projeto'), { recursive: true })
    assert.deepEqual(coletarFatos(c.amb).skills, [], 'nenhuma origem na pasta')
  })

  it('sem a pasta scripts/claude, não há skills da Axon a conferir', () => {
    const c = cenario()
    rmSync(join(c.raiz, 'scripts'), { recursive: true })
    assert.deepEqual(coletarFatos(c.amb).skills, [])
  })

  it('settings.json e .claude.json: ausente, com BOM, vazio, inválido ou que é uma pasta', () => {
    const c = cenario()
    rmSync(c.settings)
    rmSync(c.claudeJson)
    let fatos = coletarFatos(c.amb)
    assert.deepEqual(fatos.settings, { tipo: 'ausente' })
    assert.deepEqual(fatos.claudeJson, { tipo: 'ausente' })

    gravar(c.settings, '\uFEFF{"model":"opus"}')
    gravar(c.claudeJson, '   \n')
    fatos = coletarFatos(c.amb)
    assert.deepEqual(fatos.settings, { tipo: 'ok', valor: { model: 'opus' } })
    assert.deepEqual(fatos.claudeJson, { tipo: 'ok', valor: {} })

    gravar(c.settings, '{ "model": ')
    fatos = coletarFatos(c.amb)
    assert.equal(fatos.settings.tipo, 'ilegivel')
    if (fatos.settings.tipo === 'ilegivel') assert.match(fatos.settings.motivo, /JSON/)

    rmSync(c.claudeJson)
    mkdirSync(c.claudeJson)
    fatos = coletarFatos(c.amb)
    assert.equal(fatos.claudeJson.tipo, 'ilegivel')
  })

  it('banco: ausente, arquivo que não é banco, banco sem a tabela de projetos', () => {
    const c = cenario()
    rmSync(c.banco)
    assert.deepEqual(coletarFatos(c.amb).banco, { tipo: 'ausente' })

    gravar(c.banco, 'isto não é um banco de dados SQLite, é só texto comprido o bastante para parecer um arquivo')
    const lixo = coletarFatos(c.amb).banco
    assert.equal(lixo.tipo, 'erro')

    rmSync(c.banco)
    const outro = new DatabaseSync(c.banco)
    outro.exec('CREATE TABLE coisas (id TEXT)')
    outro.close()
    const semProjetos = coletarFatos(c.amb).banco
    assert.equal(semProjetos.tipo, 'erro')
    if (semProjetos.tipo === 'erro') assert.match(semProjetos.motivo, /projects/)
  })

  it('banco antigo, sem a tabela de eventos: os projetos aparecem sem registro', () => {
    const c = cenario()
    rmSync(c.banco)
    const antigo = new DatabaseSync(c.banco)
    antigo.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, workspace_path TEXT);
      INSERT INTO projects VALUES ('p1', 'Velho', 'D:/velho')`)
    antigo.close()
    const banco = coletarFatos(c.amb).banco
    assert.deepEqual(banco, {
      tipo: 'aberto',
      quickCheck: ['ok'],
      projetos: [{ nome: 'Velho', pasta: 'D:/velho', ultimoRegistroAutomatico: null, ultimoErro: null }],
    })
  })

  it('só entram os projetos com pasta, em ordem de nome (sem diferenciar maiúsculas)', () => {
    const c = cenario()
    const store = new WorkspaceStore(c.banco)
    try {
      store.createProject({ name: 'beta', objective: 'b', workspacePath: 'D:/beta' })
      store.createProject({ name: 'Alfa', objective: 'a', workspacePath: 'D:/alfa' })
      store.createProject({ name: 'Sem pasta', objective: 's', workspacePath: '' })
      store.createProject({ name: 'Pasta em branco', objective: 's', workspacePath: '   ' })
    } finally {
      store.close()
    }
    const banco = coletarFatos(c.amb).banco
    assert.equal(banco.tipo, 'aberto')
    if (banco.tipo === 'aberto') assert.deepEqual(banco.projetos.map((p) => p.nome), ['Alfa', 'Axon Works', 'beta'])
  })

  it('o erro do gancho ainda não superado aparece no projeto', () => {
    const c = cenario()
    const store = new WorkspaceStore(c.banco)
    try {
      const id = store.listProjects()[0].id
      store.registrarEventoDeIntegracao(id, { tipo: 'fechar', ok: false, detalhe: 'não gravou' })
    } finally {
      store.close()
    }
    const banco = coletarFatos(c.amb).banco
    assert.equal(banco.tipo, 'aberto')
    if (banco.tipo === 'aberto') assert.equal(banco.projetos[0].ultimoErro, 'não gravou')
  })

  it('com a Axon aberta (banco em uso, com o arquivo -wal ao lado), lê o que já foi gravado', () => {
    const c = cenario()
    const aberta = new WorkspaceStore(c.banco)
    abertos.push(aberta)
    aberta.createProject({ name: 'Gravado agora', objective: 'g', workspacePath: 'D:/agora' })
    assert.equal(existsSync(`${c.banco}-wal`), true)
    const banco = coletarFatos(c.amb).banco
    assert.equal(banco.tipo, 'aberto')
    if (banco.tipo === 'aberto') assert.ok(banco.projetos.some((p) => p.nome === 'Gravado agora'))
  })
})

describe('executarDiagnostico', () => {
  it('instalação saudável: tudo ✔, resultado 0', () => {
    const c = cenario()
    assert.equal(executarDiagnostico(c.amb), 0)
    const texto = c.texto()
    assert.match(texto, /^Diagnóstico da Axon \(só lê, não grava nada\)\nPasta da Axon: /)
    assert.equal(texto.includes('✘'), false)
    // Seis conferências; a das skills ganha uma linha por skill da Axon (são duas), então são sete linhas ✔.
    assert.equal(c.saida.filter((l) => l.startsWith('✔')).length, 7)
    assert.match(texto, /Tudo certo: as 7 conferências passaram\.$/)
  })

  it('só lê: nenhum arquivo é criado, alterado ou apagado (nem ao lado do banco)', () => {
    const c = cenario()
    const antes = fotografia(c.raiz, join(c.pastaClaude, '..'))
    executarDiagnostico(c.amb)
    executarDiagnostico({ ...c.amb, imprimir: () => {} })
    assert.deepEqual(fotografia(c.raiz, join(c.pastaClaude, '..')), antes)
  })

  it('só lê também com o banco em uso: não deixa arquivo novo', () => {
    const c = cenario()
    const aberta = new WorkspaceStore(c.banco)
    abertos.push(aberta)
    const antes = readdirSync(join(c.raiz, '.axon')).sort()
    executarDiagnostico(c.amb)
    assert.deepEqual(readdirSync(join(c.raiz, '.axon')).sort(), antes)
  })

  it('nada ligado: cada ✘ traz a frase de como resolver com a pasta da Axon', () => {
    const raiz = pastaTemporaria('vazia')
    const casa = pastaTemporaria('casa-vazia')
    const saida: string[] = []
    const status = executarDiagnostico({
      raiz,
      pastaClaude: join(casa, '.claude'),
      arquivoClaudeJson: join(casa, '.claude.json'),
      caminhoDoBanco: join(raiz, '.axon', 'workspace.sqlite'),
      imprimir: (l) => saida.push(l),
    })
    assert.equal(status, 1)
    const texto = saida.join('\n')
    assert.match(texto, /✘ 1\. Não achei o arquivo de configuração do Claude Code/)
    assert.match(texto, /✘ 2\. Faltam arquivos montados da Axon: dist-server\/index\.mjs, dist-server\/mcp\.mjs e dist-server\/ganchos\.mjs\./)
    assert.match(texto, /✘ 3\. Não achei o servidor MCP "axon"/)
    assert.match(texto, /✘ 4\. Não achei nenhuma skill da Axon/)
    assert.match(texto, /✘ 5\. O banco da Axon não existe em /)
    assert.match(texto, /✘ 6\. Não deu para conferir/)
    assert.equal(saida.filter((l) => l.includes(`Como resolver: Rode npm run montar dentro de ${raiz}.`)).length, 1)
    assert.ok(saida.some((l) => l.includes(`Como resolver: Rode npm run claude:ligar dentro de ${raiz}.`)))
    assert.match(texto, /Resultado: 0 de 6 conferências passaram\. Resolva os itens marcados com ✘/)
  })

  it('código mexido depois da montagem: item 2 pede para montar de novo', () => {
    const c = cenario()
    gravar(join(c.raiz, 'server', 'store.ts'), '// mexido', HORA + UMA_HORA)
    assert.equal(executarDiagnostico(c.amb), 1)
    assert.match(c.texto(), /✘ 2\. O código mudou depois da última montagem: server\/store\.ts é mais novo que dist-server\/index\.mjs, dist-server\/mcp\.mjs e dist-server\/ganchos\.mjs\./)
    assert.match(c.texto(), new RegExp(`Como resolver: Rode npm run montar dentro de ${c.raiz.replaceAll('\\', '\\\\')}\\.`))
  })

  it('ganchos gravados pelo instalador são reconhecidos, e o node que sumiu é apontado', () => {
    const c = cenario()
    const ganchos = join(c.raiz, 'dist-server', 'ganchos.mjs')
    const sumido = join(c.raiz, 'node-que-sumiu', 'node.exe')
    writeFileSync(c.settings, JSON.stringify(mesclarGanchos({}, { node: sumido, script: ganchos })))
    assert.equal(executarDiagnostico(c.amb), 1)
    assert.ok(c.saida.includes(`✘ 1. Os ganchos da Axon apontam para arquivos que não existem: ${sumido}.`))
  })

  it('erro de gancho pendente aparece em ✘ no item 6', () => {
    const c = cenario()
    const store = new WorkspaceStore(c.banco)
    try {
      store.registrarEventoDeIntegracao(store.listProjects()[0].id, { tipo: 'compactar', ok: false, detalhe: 'sem espaço' })
    } finally {
      store.close()
    }
    assert.equal(executarDiagnostico(c.amb), 1)
    assert.ok(c.saida.some((l) => l.startsWith('✘ 6. Projeto Axon Works') && l.endsWith('o último gancho falhou: sem espaço')))
  })
})

describe('caminhosPadrao', () => {
  it('~/.claude, ~/.claude.json e o banco da pasta da Axon', () => {
    const casa = resolve('/casa/dono')
    const raiz = resolve('/projetos/axon')
    assert.deepEqual(caminhosPadrao(raiz, casa, {}), {
      pastaClaude: join(casa, '.claude'),
      arquivoClaudeJson: join(casa, '.claude.json'),
      caminhoDoBanco: join(raiz, '.axon', 'workspace.sqlite'),
    })
  })

  it('AXON_DB_PATH troca o banco, como no servidor; vazio não conta', () => {
    const casa = resolve('/casa/dono')
    const raiz = resolve('/projetos/axon')
    assert.equal(caminhosPadrao(raiz, casa, { AXON_DB_PATH: resolve('/outro/banco.sqlite') }).caminhoDoBanco, resolve('/outro/banco.sqlite'))
    assert.equal(caminhosPadrao(raiz, casa, { AXON_DB_PATH: '' }).caminhoDoBanco, join(raiz, '.axon', 'workspace.sqlite'))
  })
})

describe('principal (linha de comando)', () => {
  function argumentos(c: Cenario): string[] {
    return ['--raiz', c.raiz, '--pasta-claude', c.pastaClaude, '--claude-json', c.claudeJson, '--banco', c.banco]
  }

  it('com os caminhos dados, imprime o relatório e devolve 0 quando tudo está certo', () => {
    const c = cenario()
    const saida: string[] = []
    assert.equal(principal(argumentos(c), (l) => saida.push(l)), 0)
    assert.match(saida.join('\n'), /Tudo certo/)
  })

  it('devolve 1 quando há problema', () => {
    const c = cenario()
    rmSync(c.settings)
    const saida: string[] = []
    assert.equal(principal(argumentos(c), (l) => saida.push(l)), 1)
    assert.match(saida.join('\n'), /✘ 1\./)
  })

  it('--ajuda mostra o uso e devolve 0', () => {
    const saida: string[] = []
    assert.equal(principal(['--ajuda'], (l) => saida.push(l)), 0)
    assert.match(saida.join('\n'), /^Uso: npm run axon:diagnostico/)
    assert.match(saida.join('\n'), /--raiz <p>/)
  })

  it('opção que não existe: mostra o erro e o uso, devolve 2', () => {
    const saida: string[] = []
    assert.equal(principal(['--invento'], (l) => saida.push(l)), 2)
    assert.match(saida.join('\n'), /--invento/)
    assert.match(saida.join('\n'), /Uso: npm run axon:diagnostico/)
  })
})

describe('npm run axon:diagnostico', () => {
  it('o script está no package.json e o programa roda de ponta a ponta com pastas temporárias', () => {
    const c = cenario()
    const pacote = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }
    assert.equal(pacote.scripts['axon:diagnostico'], 'tsx scripts/diagnostico.ts')

    const r = spawnSync(
      process.execPath,
      [
        // Achado pela resolução de módulos (e não por ../node_modules): a fatia de mutação roda numa cópia sem node_modules.
        fileURLToPath(import.meta.resolve('tsx/cli')),
        join(import.meta.dirname, '..', 'scripts', 'diagnostico.ts'),
        '--raiz', c.raiz, '--pasta-claude', c.pastaClaude, '--claude-json', c.claudeJson, '--banco', c.banco,
      ],
      { encoding: 'utf8' },
    )
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /✔ 1\. Ganchos: SessionStart, PostCompact, Stop e SessionEnd/)
    assert.match(r.stdout, /Tudo certo: as 7 conferências passaram\./)
  })
})
