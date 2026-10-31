import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'node:test'
import { argumentosMcpAdd, argumentosMcpRemove, citarArgumento } from '../scripts/claude/configuracao.ts'
import { executarComando, executarInstalador, type Claude } from '../scripts/claude/instalar.ts'

/**
 * Instalador do Claude Code (Task 9): tudo aqui roda em pastas temporárias. Nenhum teste toca em
 * ~/.claude, em ~/.claude.json nem chama o `claude` de verdade: o executor do `claude` é falso, e o
 * teste do programa de linha de comando sempre aponta --pasta-claude para uma pasta temporária
 * (o que, por desenho, desliga o registro do MCP).
 */

const criadas: string[] = []
afterEach(() => {
  for (const pasta of criadas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function pastaTemporaria(prefixo: string): string {
  const pasta = mkdtempSync(join(tmpdir(), `axon-${prefixo}-`))
  criadas.push(pasta)
  return pasta
}

const SKILL = '---\nname: axon-ligar-projeto\n---\nTexto da skill\n'
const SKILL_SALVAR = '---\nname: axon-salvar-antes-de-compactar\n---\nTexto da outra skill\n'

function repositorio(comMontado = true): string {
  const raiz = pastaTemporaria('raiz')
  mkdirSync(join(raiz, 'scripts', 'claude', 'skill-ligar-projeto'), { recursive: true })
  writeFileSync(join(raiz, 'scripts', 'claude', 'skill-ligar-projeto', 'SKILL.md'), SKILL)
  mkdirSync(join(raiz, 'scripts', 'claude', 'skill-salvar-antes-de-compactar'), { recursive: true })
  writeFileSync(join(raiz, 'scripts', 'claude', 'skill-salvar-antes-de-compactar', 'SKILL.md'), SKILL_SALVAR)
  if (comMontado) {
    mkdirSync(join(raiz, 'dist-server'))
    writeFileSync(join(raiz, 'dist-server', 'mcp.mjs'), '')
    writeFileSync(join(raiz, 'dist-server', 'ganchos.mjs'), '')
  }
  return raiz
}

interface Cenario {
  raiz: string
  pastaClaude: string
  settings: string
  saida: string[]
  chamadas: string[][]
  rodar: (opcoes?: { desligar?: boolean; simular?: boolean }, claude?: Claude | null) => number
  texto: () => string
}

function cenario(comMontado = true): Cenario {
  const raiz = repositorio(comMontado)
  const pastaClaude = join(pastaTemporaria('claude'), '.claude')
  const saida: string[] = []
  const chamadas: string[][] = []
  const falso: Claude = {
    executar: (args) => {
      chamadas.push(args)
      return { status: 0, saida: '' }
    },
  }
  return {
    raiz,
    pastaClaude,
    settings: join(pastaClaude, 'settings.json'),
    saida,
    chamadas,
    rodar: (opcoes = {}, claude = falso) =>
      executarInstalador(
        { desligar: opcoes.desligar ?? false, simular: opcoes.simular ?? false },
        { raiz, pastaClaude, node: process.execPath, claude, imprimir: (l) => saida.push(l) },
      ),
    texto: () => saida.join('\n'),
  }
}

function gravarSettings(c: Cenario, conteudo: string): void {
  mkdirSync(c.pastaClaude, { recursive: true })
  writeFileSync(c.settings, conteudo)
}

const ORIGINAL = JSON.stringify(
  {
    model: 'opus',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'prettier' }] }] },
  },
  null,
  2,
)

describe('instalador: ligar', () => {
  it('recusa com mensagem clara se os arquivos montados não existem, sem gravar nada', () => {
    const c = cenario(false)
    assert.equal(c.rodar(), 1)
    assert.match(c.texto(), /Rode npm run montar antes\./)
    assert.ok(c.texto().includes(join(c.raiz, 'dist-server', 'mcp.mjs')))
    assert.ok(c.texto().includes(join(c.raiz, 'dist-server', 'ganchos.mjs')))
    assert.equal(existsSync(c.pastaClaude), false)
    assert.deepEqual(c.chamadas, [])
  })

  it('--simular mostra o que muda e não grava nada nem chama o claude', () => {
    const c = cenario()
    gravarSettings(c, ORIGINAL)
    assert.equal(c.rodar({ simular: true }), 0)
    const t = c.texto()
    for (const evento of ['SessionStart', 'PostCompact', 'Stop', 'SessionEnd']) assert.ok(t.includes(evento), evento)
    assert.ok(t.includes(c.settings))
    assert.ok(t.includes(join(c.raiz, 'dist-server', 'ganchos.mjs')))
    assert.match(t, /Nada foi gravado/)
    assert.equal(readFileSync(c.settings, 'utf8'), ORIGINAL)
    assert.deepEqual(readdirSync(c.pastaClaude), ['settings.json'])
    assert.deepEqual(c.chamadas, [])
  })

  it('sem settings.json: cria o arquivo só com os ganchos, copia a skill e registra o MCP', () => {
    const c = cenario()
    assert.equal(c.rodar(), 0)
    const settings = JSON.parse(readFileSync(c.settings, 'utf8'))
    assert.deepEqual(Object.keys(settings), ['hooks'])
    assert.deepEqual(Object.keys(settings.hooks).sort(), ['PostCompact', 'SessionEnd', 'SessionStart', 'Stop'])
    assert.equal(settings.hooks.Stop[0].hooks[0].command, process.execPath)
    assert.deepEqual(settings.hooks.Stop[0].hooks[0].args, [join(c.raiz, 'dist-server', 'ganchos.mjs')])
    assert.equal('axon' in settings.hooks.Stop[0].hooks[0], false)
    assert.equal(existsSync(c.settings + '.antes-da-axon'), false)
    assert.equal(readFileSync(join(c.pastaClaude, 'skills', 'axon-ligar-projeto', 'SKILL.md'), 'utf8'), SKILL)
    assert.equal(readFileSync(join(c.pastaClaude, 'skills', 'axon-salvar-antes-de-compactar', 'SKILL.md'), 'utf8'), SKILL_SALVAR)
    assert.deepEqual(c.chamadas, [argumentosMcpAdd({ node: process.execPath, script: join(c.raiz, 'dist-server', 'mcp.mjs') })])
    assert.match(c.texto(), /npm run claude:desligar/)
  })

  it('com settings.json do dono: guarda a cópia .antes-da-axon, acrescenta e mantém o resto', () => {
    const c = cenario()
    gravarSettings(c, ORIGINAL)
    assert.equal(c.rodar(), 0)
    assert.equal(readFileSync(c.settings + '.antes-da-axon', 'utf8'), ORIGINAL)
    const settings = JSON.parse(readFileSync(c.settings, 'utf8'))
    assert.equal(settings.model, 'opus')
    assert.deepEqual(settings.hooks.PreToolUse, JSON.parse(ORIGINAL).hooks.PreToolUse)
    assert.equal(settings.hooks.SessionStart.length, 1)
  })

  it('ligar de novo não duplica os ganchos nem troca a cópia original', () => {
    const c = cenario()
    gravarSettings(c, ORIGINAL)
    c.rodar()
    const primeira = readFileSync(c.settings, 'utf8')
    writeFileSync(c.settings, primeira.replace('"model": "opus"', '"model": "sonnet"'))
    c.saida.length = 0
    assert.equal(c.rodar(), 0)
    assert.match(c.texto(), /já estão ligados com estes caminhos/)
    const settings = JSON.parse(readFileSync(c.settings, 'utf8'))
    assert.equal(settings.model, 'sonnet')
    assert.equal(settings.hooks.Stop.length, 1)
    assert.equal(readFileSync(c.settings + '.antes-da-axon', 'utf8'), ORIGINAL)
  })

  it('settings.json que não é JSON válido: recusa, não grava nada', () => {
    const c = cenario()
    gravarSettings(c, '{ "model": ')
    assert.equal(c.rodar(), 1)
    assert.match(c.texto(), /settings\.json não é um JSON válido/)
    assert.match(c.texto(), /nada foi alterado/)
    assert.equal(readFileSync(c.settings, 'utf8'), '{ "model": ')
    assert.deepEqual(readdirSync(c.pastaClaude), ['settings.json'])
    assert.deepEqual(c.chamadas, [])
  })

  it('settings.json que não é um objeto: recusa', () => {
    const c = cenario()
    gravarSettings(c, '[1, 2]')
    assert.equal(c.rodar(), 1)
    assert.match(c.texto(), /não é um objeto JSON/)
    assert.equal(readFileSync(c.settings, 'utf8'), '[1, 2]')
  })

  it('settings.json vazio conta como settings vazio', () => {
    const c = cenario()
    gravarSettings(c, '  \n')
    assert.equal(c.rodar(), 0)
    assert.ok(JSON.parse(readFileSync(c.settings, 'utf8')).hooks.Stop)
  })

  it('hooks do dono num formato estranho: recusa e explica, sem gravar', () => {
    const c = cenario()
    gravarSettings(c, '{"hooks": "x"}')
    assert.equal(c.rodar(), 1)
    assert.match(c.texto(), /O campo "hooks" do settings\.json não é um objeto; nada foi alterado\./)
    assert.equal(readFileSync(c.settings, 'utf8'), '{"hooks": "x"}')
  })

  it('sem o comando claude: grava o resto e imprime o comando para o dono rodar', () => {
    const c = cenario()
    assert.equal(c.rodar({}, null), 0)
    assert.ok(existsSync(c.settings))
    assert.match(c.texto(), /claude mcp add --scope user axon --/)
    assert.match(c.texto(), /rode você mesmo/)
    assert.ok(c.texto().includes(citarArgumento(process.execPath)), 'o caminho do node vai citado no comando')
  })

  it('se o servidor já existe: remove o registro antigo e registra de novo, sem aviso de falta', () => {
    const c = cenario()
    const chamadas: string[][] = []
    let jaExiste = true
    const claude: Claude = {
      executar: (args) => {
        chamadas.push(args)
        if (args[1] === 'add' && jaExiste) return { status: 1, saida: 'MCP server axon already exists in user config' }
        if (args[1] === 'remove') jaExiste = false
        return { status: 0, saida: '' }
      },
    }
    assert.equal(c.rodar({}, claude), 0)
    assert.deepEqual(chamadas.map((a) => a[1]), ['add', 'remove', 'add'])
    assert.deepEqual(chamadas[1], ['mcp', 'remove', 'axon', '--scope', 'user'])
    assert.match(c.texto(), /Servidor MCP "axon" registrado no escopo do usuário\./)
    assert.doesNotMatch(c.texto(), /falta registrar/)
  })

  it('se o servidor já existe e a remoção falha: mostra a resposta, o comando manual e sai com erro', () => {
    const c = cenario()
    const claude: Claude = {
      executar: (args) =>
        args[1] === 'add'
          ? { status: 1, saida: 'MCP server axon already exists in user config' }
          : { status: 1, saida: 'não deu para remover' },
    }
    assert.equal(c.rodar({}, claude), 1)
    assert.match(c.texto(), /não deu para remover/)
    assert.match(c.texto(), /falta registrar o servidor MCP/)
  })

  it('se o claude recusa o registro: mostra a resposta dele, o comando manual e sai com erro', () => {
    const c = cenario()
    const recusa: Claude = { executar: () => ({ status: 1, saida: 'Permission denied' }) }
    assert.equal(c.rodar({}, recusa), 1)
    assert.match(c.texto(), /Permission denied/)
    assert.match(c.texto(), /Os ganchos e as skills foram gravados; falta registrar o servidor MCP/)
    assert.match(c.texto(), /claude mcp add --scope user axon --/)
    assert.ok(existsSync(c.settings), 'o que já foi gravado continua, e o desligar sabe desfazer')
  })

  it('--simular diz o que acontece com cada uma das duas skills, sem copiar nenhuma', () => {
    const c = cenario()
    assert.equal(c.rodar({ simular: true }), 0)
    const t = c.texto()
    assert.ok(t.includes('3. Skills da Axon:'))
    assert.ok(t.includes(`Skill axon-ligar-projeto em ${join(c.pastaClaude, 'skills', 'axon-ligar-projeto', 'SKILL.md')}: será instalada.`), t)
    assert.ok(
      t.includes(`Skill axon-salvar-antes-de-compactar em ${join(c.pastaClaude, 'skills', 'axon-salvar-antes-de-compactar', 'SKILL.md')}: será instalada.`),
      t,
    )
    assert.equal(existsSync(join(c.pastaClaude, 'skills')), false)
  })

  it('cada skill tem o seu estado: uma igual fica, a outra é instalada', () => {
    const c = cenario()
    const pasta = join(c.pastaClaude, 'skills', 'axon-ligar-projeto')
    mkdirSync(pasta, { recursive: true })
    writeFileSync(join(pasta, 'SKILL.md'), SKILL)
    const antiga = new Date('2026-01-01T00:00:00.000Z')
    utimesSync(join(pasta, 'SKILL.md'), antiga, antiga)
    assert.equal(c.rodar(), 0)
    assert.equal(statSync(join(pasta, 'SKILL.md')).mtimeMs, antiga.getTime(), 'a skill igual não é regravada')
    assert.match(c.texto(), /Skill axon-ligar-projeto em .*: já está instalada e igual; nada muda\./)
    assert.match(c.texto(), /Skill axon-salvar-antes-de-compactar em .*: será instalada\./)
    assert.equal(readFileSync(join(c.pastaClaude, 'skills', 'axon-salvar-antes-de-compactar', 'SKILL.md'), 'utf8'), SKILL_SALVAR)
  })

  it('a skill já instalada com outro texto é atualizada e o aviso diz isso', () => {
    const c = cenario()
    const destino = join(c.pastaClaude, 'skills', 'axon-ligar-projeto', 'SKILL.md')
    mkdirSync(join(c.pastaClaude, 'skills', 'axon-ligar-projeto'), { recursive: true })
    writeFileSync(destino, 'versão antiga')
    assert.equal(c.rodar(), 0)
    assert.equal(readFileSync(destino, 'utf8'), SKILL)
    assert.match(c.texto(), /substitui a versão anterior/)
  })
})

describe('instalador: desligar', () => {
  it('tira os ganchos da Axon, a skill e o registro do MCP; o resto do settings volta como era', () => {
    const c = cenario()
    gravarSettings(c, ORIGINAL)
    c.rodar()
    c.chamadas.length = 0
    assert.equal(c.rodar({ desligar: true }), 0)
    assert.deepEqual(JSON.parse(readFileSync(c.settings, 'utf8')), JSON.parse(ORIGINAL))
    assert.equal(existsSync(join(c.pastaClaude, 'skills', 'axon-ligar-projeto')), false)
    assert.equal(existsSync(join(c.pastaClaude, 'skills', 'axon-salvar-antes-de-compactar')), false)
    assert.deepEqual(readdirSync(join(c.pastaClaude, 'skills')), [])
    assert.deepEqual(c.chamadas, [argumentosMcpRemove()])
    assert.equal(readFileSync(c.settings + '.antes-da-axon', 'utf8'), ORIGINAL, 'a cópia original fica')
  })

  it('desligar não exige os arquivos montados', () => {
    const c = cenario(false)
    assert.equal(c.rodar({ desligar: true }), 0)
  })

  it('--simular --desligar só mostra', () => {
    const c = cenario()
    gravarSettings(c, ORIGINAL)
    c.rodar()
    const ligado = readFileSync(c.settings, 'utf8')
    c.chamadas.length = 0
    assert.equal(c.rodar({ desligar: true, simular: true }), 0)
    assert.equal(readFileSync(c.settings, 'utf8'), ligado)
    assert.deepEqual(c.chamadas, [])
    assert.match(c.texto(), /Nada foi gravado/)
  })

  it('sem nada ligado, diz isso e não mexe em nada', () => {
    const c = cenario()
    gravarSettings(c, ORIGINAL)
    assert.equal(c.rodar({ desligar: true }), 0)
    assert.equal(readFileSync(c.settings, 'utf8'), ORIGINAL)
    assert.match(c.texto(), /Nenhum gancho da Axon/)
  })

  it('sem settings.json também funciona', () => {
    const c = cenario()
    assert.equal(c.rodar({ desligar: true }), 0)
    assert.equal(existsSync(c.settings), false)
  })

  it('sem o comando claude: imprime o comando de remoção para o dono rodar', () => {
    const c = cenario()
    assert.equal(c.rodar({ desligar: true }, null), 0)
    assert.match(c.texto(), /claude mcp remove axon --scope user/)
  })

  it('o claude diz que a entrada não existe: mostra a resposta e segue, sem erro', () => {
    const c = cenario()
    const naoTem: Claude = { executar: () => ({ status: 1, saida: 'No MCP server found with name: axon' }) }
    assert.equal(c.rodar({ desligar: true }, naoTem), 0)
    assert.match(c.texto(), /No MCP server found with name: axon/)
  })

  it('diz que cada skill sai, e que a não instalada não tem nada a tirar', () => {
    const c = cenario()
    c.rodar()
    rmSync(join(c.pastaClaude, 'skills', 'axon-ligar-projeto'), { recursive: true })
    c.saida.length = 0
    assert.equal(c.rodar({ desligar: true }), 0)
    assert.ok(c.texto().includes('3. Skills da Axon:'))
    assert.match(c.texto(), /A skill axon-ligar-projeto não está instalada; nada a tirar\./)
    assert.ok(
      c.texto().includes(`A skill axon-salvar-antes-de-compactar sai de ${join(c.pastaClaude, 'skills', 'axon-salvar-antes-de-compactar', 'SKILL.md')}.`),
      c.texto(),
    )
    assert.equal(existsSync(join(c.pastaClaude, 'skills', 'axon-salvar-antes-de-compactar')), false)
  })

  it('não apaga uma pasta de skill que tem outros arquivos do dono', () => {
    const c = cenario()
    c.rodar()
    writeFileSync(join(c.pastaClaude, 'skills', 'axon-ligar-projeto', 'anotacao.txt'), 'meu')
    assert.equal(c.rodar({ desligar: true }), 0)
    assert.deepEqual(readdirSync(join(c.pastaClaude, 'skills', 'axon-ligar-projeto')), ['anotacao.txt'])
  })
})

describe('executarComando', () => {
  it('passa os argumentos inteiros, com espaço, & e aspas, mesmo com o executável em pasta com espaço', () => {
    const argumentos = ['a b', 'c&d', 'e"f', '(g)', '']
    const r = executarComando(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...argumentos])
    assert.equal(r.status, 0)
    assert.deepEqual(JSON.parse(r.saida), argumentos)
  })

  it('comando que não existe devolve status diferente de zero em vez de estourar', () => {
    const r = executarComando('comando-que-nao-existe-axon', [])
    assert.notEqual(r.status, 0)
  })
})

describe('programa de linha de comando', () => {
  // Resolvido pelo Node (e não por process.cwd()): na cópia da mutação o node_modules não vem junto,
  // e a resolução sobe até o do projeto.
  const tsx = fileURLToPath(import.meta.resolve('tsx/cli'))
  const programa = join(process.cwd(), 'scripts', 'claude', 'instalar.ts')

  function rodar(args: string[]) {
    const r = spawnSync(process.execPath, [tsx, programa, ...args], { encoding: 'utf8' })
    return { status: r.status, saida: `${r.stdout}${r.stderr}` }
  }

  it('recusa sem os arquivos montados, em português', () => {
    const raiz = repositorio(false)
    const pasta = join(pastaTemporaria('cli'), '.claude')
    const r = rodar(['--raiz', raiz, '--pasta-claude', pasta])
    assert.equal(r.status, 1)
    assert.match(r.saida, /Rode npm run montar antes\./)
    assert.equal(existsSync(pasta), false)
  })

  it('liga e desliga numa pasta temporária, sem chamar o claude de verdade', () => {
    const raiz = repositorio()
    const pasta = join(pastaTemporaria('cli'), '.claude')
    const ligar = rodar(['--raiz', raiz, '--pasta-claude', pasta])
    assert.equal(ligar.status, 0, ligar.saida)
    assert.match(ligar.saida, /rode você mesmo/)
    const settings = JSON.parse(readFileSync(join(pasta, 'settings.json'), 'utf8'))
    assert.equal(settings.hooks.SessionEnd[0].hooks[0].command, process.execPath)
    assert.ok(existsSync(join(pasta, 'skills', 'axon-ligar-projeto', 'SKILL.md')))
    assert.ok(existsSync(join(pasta, 'skills', 'axon-salvar-antes-de-compactar', 'SKILL.md')))
    const desligar = rodar(['--desligar', '--raiz', raiz, '--pasta-claude', pasta])
    assert.equal(desligar.status, 0, desligar.saida)
    assert.deepEqual(JSON.parse(readFileSync(join(pasta, 'settings.json'), 'utf8')), {})
    assert.equal(existsSync(join(pasta, 'skills', 'axon-ligar-projeto')), false)
    assert.equal(existsSync(join(pasta, 'skills', 'axon-salvar-antes-de-compactar')), false)
  })

  it('opção desconhecida: explica o uso e sai com erro', () => {
    const r = rodar(['--bobagem'])
    assert.equal(r.status, 2)
    assert.match(r.saida, /Uso:/)
  })

  it('--ajuda mostra o uso', () => {
    const r = rodar(['--ajuda'])
    assert.equal(r.status, 0)
    assert.match(r.saida, /npm run claude:ligar/)
  })
})

describe('skill ligar-projeto do repositório', () => {
  const texto = readFileSync(join(process.cwd(), 'scripts', 'claude', 'skill-ligar-projeto', 'SKILL.md'), 'utf8')

  it('tem o nome da pasta onde o instalador a coloca e uma descrição que diz quando usar', () => {
    assert.match(texto, /^---\r?\nname: axon-ligar-projeto\r?\ndescription: .{40,}\r?\n---\r?\n/)
    assert.match(texto, /pedir para mandar, subir, ligar ou conectar/)
  })

  it('manda perguntar antes de criar e nunca duplicar em silêncio', () => {
    assert.match(texto, /nunca crie um duplicado em silêncio/)
    assert.match(texto, /esperar o "sim"/)
  })

  it('só cita ferramentas que o servidor MCP realmente tem', () => {
    const citadas = [...texto.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1])
    const conhecidas = new Set(['list_projects', 'create_project', 'save_checkpoint', 'get_charter', 'save_charter', 'get_resume_brief'])
    for (const nome of citadas) assert.ok(conhecidas.has(nome), `ferramenta desconhecida na skill: ${nome}`)
    const fonte = readFileSync(join(process.cwd(), 'server', 'mcp-tools.ts'), 'utf8')
    for (const nome of conhecidas) assert.ok(fonte.includes(`'${nome}'`), `${nome} não está registrada no servidor MCP`)
  })
})

describe('skill salvar-antes-de-compactar do repositório', () => {
  const texto = readFileSync(join(process.cwd(), 'scripts', 'claude', 'skill-salvar-antes-de-compactar', 'SKILL.md'), 'utf8')

  it('tem o nome da pasta onde o instalador a coloca e uma descrição com as frases do dono', () => {
    assert.match(texto, /^---\r?\nname: axon-salvar-antes-de-compactar\r?\ndescription: .{40,}\r?\n---\r?\n/)
    assert.match(texto, /vai compactar já já, vai na Axon e salva tudo/)
    assert.match(texto, /salva tudo na Axon/)
  })

  it('roteiro em passos: projeto, salvamento, gravação, quadro, lições e fechamento', () => {
    const passos = [...texto.matchAll(/^## Passo (\d): (.+)$/gm)].map((m) => `${m[1]} ${m[2]}`)
    assert.deepEqual(passos, [
      '1 achar o projeto',
      '2 montar o salvamento',
      '3 gravar',
      '4 atualizar o quadro',
      '5 registrar as lições',
      '6 fechar com o dono',
    ])
  })

  it('o exemplo de chamada é JSON válido, com todos os campos do save_compaction_snapshot', () => {
    const bloco = /```json\r?\n([\s\S]+?)```/.exec(texto)
    assert.ok(bloco, 'tem um exemplo em JSON')
    const exemplo = JSON.parse(bloco[1]!) as { tool: string; arguments: Record<string, unknown> }
    assert.equal(exemplo.tool, 'save_compaction_snapshot')
    assert.deepEqual(Object.keys(exemplo.arguments).sort(), [
      'agent',
      'arquivosMexidos',
      'decisions',
      'expectedRevision',
      'humanSummary',
      'idempotencyKey',
      'nextStep',
      'pedidosDoDono',
      'pendencias',
      'perguntasAbertas',
      'projectId',
      'summary',
    ])
    assert.ok(String(exemplo.arguments.humanSummary).length <= 280)
  })

  it('só cita ferramentas que o servidor MCP tem (record_lesson vem da frente das lições, nesta mesma onda)', () => {
    const citadas = new Set([...texto.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!))
    const ferramentas = ['list_projects', 'get_project', 'save_compaction_snapshot', 'get_board', 'move_board_card', 'update_board_card', 'create_board_card']
    const codigosDeRecusa = ['revision_conflict', 'invalid_input']
    const deOutraFrente = ['record_lesson']
    assert.deepEqual([...citadas].sort(), [...ferramentas, ...codigosDeRecusa, ...deOutraFrente].sort())
    const fonte = readFileSync(join(process.cwd(), 'server', 'mcp-tools.ts'), 'utf8')
    for (const nome of ferramentas) assert.ok(fonte.includes(`'${nome}'`), `${nome} não está registrada no servidor MCP`)
    const store = readFileSync(join(process.cwd(), 'server', 'store.ts'), 'utf8')
    for (const codigo of codigosDeRecusa) assert.ok(store.includes(`'${codigo}'`), `${codigo} não é um código de recusa da Axon`)
  })

  it('pede o que o salvamento precisa: verdade, pedidos nas palavras do dono e nada de segredo', () => {
    assert.match(texto, /Um teste aparece como aprovado só quando o comando rodou nesta sessão/)
    assert.match(texto, /nas palavras dele/)
    assert.match(texto, /Chave, token e senha ficam fora/)
  })
})
