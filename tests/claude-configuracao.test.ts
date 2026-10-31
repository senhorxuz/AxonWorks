import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  ConfiguracaoInvalida,
  SKILLS_DA_AXON,
  argumentosMcpAdd,
  argumentosMcpRemove,
  citarArgumento,
  entradaMcp,
  ehGanchoDaAxon,
  ganchosDaAxon,
  mesclarGanchos,
  removerGanchos,
  type ComandoAxon,
} from '../scripts/claude/configuracao.ts'
import { INSTRUCOES_DO_SERVIDOR } from '../server/mcp-instrucoes.ts'

/**
 * Ligação do Claude Code à Axon (spec 6, 7.1, 7.2 e 8): a parte pura do instalador.
 * Mexer na configuração do dono é só acrescentar, e o que é da Axon precisa poder ser achado e tirado depois.
 */

const NODE = resolve('/ferramentas/node/node.exe')
const GANCHOS = resolve('/axon/dist-server/ganchos.mjs')
const MCP = resolve('/axon/dist-server/mcp.mjs')
const CMD: ComandoAxon = { node: NODE, script: GANCHOS }

function congelar<T>(valor: T): T {
  if (typeof valor === 'object' && valor !== null) {
    for (const filho of Object.values(valor)) congelar(filho)
    Object.freeze(valor)
  }
  return valor
}

const GANCHO_ALHEIO = { type: 'command', command: 'prettier', args: ['--write'], timeout: 20 }

function gancho(timeout: number, node = NODE, script = GANCHOS) {
  return { type: 'command', command: node, args: [script], timeout }
}

/** Como a versão anterior gravava: com o campo próprio `"axon": true`. */
function ganchoAntigo(timeout: number) {
  return { ...gancho(timeout), axon: true }
}

const DA_AXON = {
  SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [gancho(5)] }],
  PostCompact: [{ hooks: [gancho(10)] }],
  Stop: [{ hooks: [gancho(5)] }],
  SessionEnd: [{ hooks: [gancho(30)] }],
}

describe('ganchosDaAxon', () => {
  it('descreve os quatro ganchos com matcher e tempo-limite, sem campo próprio da Axon', () => {
    assert.deepEqual(ganchosDaAxon(CMD), DA_AXON)
    // Campo desconhecido num gancho pode fazer o Claude Code recusar o settings.json inteiro do dono.
    assert.doesNotMatch(JSON.stringify(ganchosDaAxon(CMD)), /"axon"/)
  })

  it('usa o node e o script recebidos, como estão', () => {
    const outro = { node: resolve('/outro/node.exe'), script: resolve('/outro/ganchos.mjs') }
    const g = ganchosDaAxon(outro) as typeof DA_AXON
    assert.equal(g.Stop[0].hooks[0].command, outro.node)
    assert.deepEqual(g.Stop[0].hooks[0].args, [outro.script])
  })

  it('recusa node ou script com caminho relativo, que dependeria da pasta de quem chama', () => {
    assert.throws(() => ganchosDaAxon({ node: 'node', script: GANCHOS }), {
      name: 'ConfiguracaoInvalida',
      message: 'O caminho do node precisa ser absoluto: node',
    })
    assert.throws(() => ganchosDaAxon({ node: NODE, script: 'dist-server/ganchos.mjs' }), {
      name: 'ConfiguracaoInvalida',
      message: 'O caminho do script precisa ser absoluto: dist-server/ganchos.mjs',
    })
  })
})

describe('ehGanchoDaAxon', () => {
  const g = (command: unknown, args: unknown) => ({ type: 'command', command, args, timeout: 5 })

  it('é da Axon: um node rodando dist-server/ganchos.mjs, em qualquer pasta', () => {
    for (const [command, script] of [
      ['C:\\Program Files\\nodejs\\node.exe', 'D:\\Projetos\\axon\\dist-server\\ganchos.mjs'],
      ['/usr/bin/node', '/home/dono/axon/dist-server/ganchos.mjs'],
      ['node', 'dist-server/ganchos.mjs'],
      ['node.exe', 'C:/axon/dist-server/ganchos.mjs'],
    ]) {
      assert.equal(ehGanchoDaAxon(g(command, [script]), 'linux'), true, `${command} ${script}`)
      assert.equal(ehGanchoDaAxon(g(command, [script, '--extra']), 'win32'), true, `${command} ${script} --extra`)
    }
  })

  it('no Windows, barras e maiúsculas não fazem diferença; fora dele, as maiúsculas fazem', () => {
    const misturado = g('C:/Program Files/NodeJS/NODE.EXE', ['D:/Projetos\\Axon\\Dist-Server/Ganchos.MJS'])
    assert.equal(ehGanchoDaAxon(misturado, 'win32'), true)
    assert.equal(ehGanchoDaAxon(misturado, 'linux'), false)
    assert.equal(ehGanchoDaAxon(g('/usr/bin/node', ['/axon/DIST-SERVER/ganchos.mjs']), 'linux'), false)
    assert.equal(ehGanchoDaAxon(g('/usr/bin/Node', ['/axon/dist-server/ganchos.mjs']), 'linux'), false)
    assert.equal(ehGanchoDaAxon(g('C:\\nodejs\\node.exe', ['D:\\axon\\dist-server\\ganchos.mjs']), 'linux'), true)
  })

  it('usa a plataforma de agora quando ninguém diz qual', () => {
    const maiusculas = g('NODE.EXE', ['C:/AXON/DIST-SERVER/GANCHOS.MJS'])
    assert.equal(ehGanchoDaAxon(maiusculas), process.platform === 'win32')
  })

  it('a versão anterior (com "axon": true) também é reconhecida, pelo caminho', () => {
    assert.equal(ehGanchoDaAxon(ganchoAntigo(5)), true)
  })

  it('não é da Axon: outro executável, outro script, pasta de nome parecido ou forma estranha', () => {
    const script = '/axon/dist-server/ganchos.mjs'
    const casos: Array<[string, unknown]> = [
      ['nodemon', g('/usr/bin/nodemon', [script])],
      ['deno', g('/usr/bin/deno', [script])],
      ['xnode', g('/usr/bin/xnode', [script])],
      ['node como pasta', g('/opt/node/bin/bun', [script])],
      ['outro script', g('/usr/bin/node', ['/axon/dist-server/mcp.mjs'])],
      ['script parecido', g('/usr/bin/node', ['/axon/dist-server/ganchos.mjs.bak'])],
      ['pasta de nome parecido', g('/usr/bin/node', ['/axon/meu-dist-server/ganchos.mjs'])],
      ['script fora de args[0]', g('/usr/bin/node', ['--inspect', script])],
      ['args vazio', g('/usr/bin/node', [])],
      ['args não é lista', g('/usr/bin/node', script)],
      ['args[0] não é texto', g('/usr/bin/node', [3])],
      ['command não é texto', g(['/usr/bin/node'], [script])],
      ['sem command', { type: 'command', args: [script] }],
      ['só a marca antiga', { axon: true, command: 'prettier', args: ['--write'] }],
      ['nulo', null],
      ['texto', 'node dist-server/ganchos.mjs'],
      ['lista', ['/usr/bin/node', script]],
    ]
    for (const [descricao, valor] of casos) {
      assert.equal(ehGanchoDaAxon(valor, 'linux'), false, descricao)
      assert.equal(ehGanchoDaAxon(valor, 'win32'), false, descricao)
    }
  })
})

describe('mesclarGanchos', () => {
  it('mescla sem apagar ganchos existentes', () => {
    const antes = congelar({
      model: 'opus',
      permissions: { allow: ['Bash(git status)'] },
      hooks: {
        SessionStart: [{ matcher: 'startup', hooks: [GANCHO_ALHEIO] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [GANCHO_ALHEIO] }],
      },
    })
    const depois = mesclarGanchos(antes, CMD) as typeof antes & { hooks: Record<string, unknown[]> }
    assert.equal(depois.model, 'opus')
    assert.deepEqual(depois.permissions, { allow: ['Bash(git status)'] })
    assert.deepEqual(depois.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [GANCHO_ALHEIO] }])
    assert.deepEqual(depois.hooks.SessionStart, [
      { matcher: 'startup', hooks: [GANCHO_ALHEIO] },
      ...DA_AXON.SessionStart,
    ])
    assert.deepEqual(depois.hooks.PostCompact, DA_AXON.PostCompact)
    assert.deepEqual(depois.hooks.Stop, DA_AXON.Stop)
    assert.deepEqual(depois.hooks.SessionEnd, DA_AXON.SessionEnd)
  })

  it('settings vazio ou sem hooks funciona', () => {
    assert.deepEqual(mesclarGanchos({}, CMD), { hooks: DA_AXON })
    assert.deepEqual(mesclarGanchos({ hooks: {} }, CMD), { hooks: DA_AXON })
    assert.deepEqual(mesclarGanchos({ theme: 'dark' }, CMD), { theme: 'dark', hooks: DA_AXON })
  })

  it('mesclar duas vezes não duplica', () => {
    const uma = mesclarGanchos({ hooks: { Stop: [{ hooks: [GANCHO_ALHEIO] }] } }, CMD)
    const duas = mesclarGanchos(uma, CMD)
    assert.deepEqual(duas, uma)
    assert.equal((duas.hooks as Record<string, unknown[]>).Stop.length, 2)
  })

  it('mesclar de novo com outro caminho troca os ganchos da Axon em vez de acumular', () => {
    const velho = mesclarGanchos({}, CMD)
    const novoNode = resolve('/novo/node.exe')
    const novoScript = resolve('/novo/ganchos.mjs')
    const novo = mesclarGanchos(velho, { node: novoNode, script: novoScript })
    assert.deepEqual(novo, {
      hooks: {
        SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [gancho(5, novoNode, novoScript)] }],
        PostCompact: [{ hooks: [gancho(10, novoNode, novoScript)] }],
        Stop: [{ hooks: [gancho(5, novoNode, novoScript)] }],
        SessionEnd: [{ hooks: [gancho(30, novoNode, novoScript)] }],
      },
    })
  })

  it('troca os ganchos da versão anterior (com "axon": true) em vez de somar', () => {
    const antigo = congelar({
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [GANCHO_ALHEIO] },
          { matcher: 'startup|resume|clear|compact', hooks: [ganchoAntigo(5)] },
        ],
        PostCompact: [{ hooks: [ganchoAntigo(10)] }],
        Stop: [{ hooks: [GANCHO_ALHEIO, ganchoAntigo(5)] }],
        SessionEnd: [{ hooks: [ganchoAntigo(30)] }],
      },
    })
    assert.deepEqual(mesclarGanchos(antigo, CMD), {
      hooks: {
        SessionStart: [{ matcher: 'startup', hooks: [GANCHO_ALHEIO] }, ...DA_AXON.SessionStart],
        PostCompact: DA_AXON.PostCompact,
        Stop: [{ hooks: [GANCHO_ALHEIO] }, ...DA_AXON.Stop],
        SessionEnd: DA_AXON.SessionEnd,
      },
    })
  })

  it('reconhece como da Axon o gancho gravado com outra grafia do caminho, só no Windows', () => {
    const grafia = { type: 'command', command: '/USR/BIN/NODE', args: ['\\AXON\\DIST-SERVER\\GANCHOS.MJS'], timeout: 5 }
    const settings = congelar({ hooks: { Stop: [{ hooks: [grafia] }] } })
    assert.deepEqual(mesclarGanchos(settings, CMD, 'win32'), { hooks: DA_AXON })
    const fora = mesclarGanchos(settings, CMD, 'linux') as { hooks: Record<string, unknown[]> }
    assert.deepEqual(fora.hooks.Stop, [{ hooks: [grafia] }, ...DA_AXON.Stop])
  })

  it('não altera o objeto recebido', () => {
    const antes = congelar({ hooks: { Stop: [{ hooks: [GANCHO_ALHEIO] }] } })
    assert.doesNotThrow(() => mesclarGanchos(antes, CMD))
  })

  it('recusa hooks que não seja objeto, sem tocar em nada', () => {
    for (const hooks of ['texto', ['lista'], 3, null]) {
      assert.throws(() => mesclarGanchos({ hooks }, CMD), {
        name: 'ConfiguracaoInvalida',
        message: 'O campo "hooks" do settings.json não é um objeto; nada foi alterado.',
      })
    }
  })

  it('recusa um evento que não seja lista, sem tocar em nada', () => {
    assert.throws(() => mesclarGanchos({ hooks: { Stop: 'x' } }, CMD), {
      name: 'ConfiguracaoInvalida',
      message: 'O campo "hooks.Stop" do settings.json não é uma lista; nada foi alterado.',
    })
    assert.throws(() => mesclarGanchos({ hooks: { SessionEnd: { a: 1 } } }, CMD), {
      message: 'O campo "hooks.SessionEnd" do settings.json não é uma lista; nada foi alterado.',
    })
  })

  it('recusa caminhos relativos', () => {
    assert.throws(() => mesclarGanchos({}, { node: 'node', script: GANCHOS }), ConfiguracaoInvalida)
  })
})

describe('removerGanchos', () => {
  it('remover tira só os da Axon', () => {
    const outros = {
      model: 'opus',
      hooks: {
        SessionStart: [{ matcher: 'startup', hooks: [GANCHO_ALHEIO] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [GANCHO_ALHEIO] }],
      },
    }
    const com = congelar(mesclarGanchos(outros, CMD))
    assert.deepEqual(removerGanchos(com), outros)
  })

  it('mantém o gancho de outra ferramenta que também usa node, e o que só tem a marca antiga', () => {
    const alheiosComNode = [
      { type: 'command', command: NODE, args: [resolve('/outra/dist/hooks.mjs')], timeout: 5 },
      { type: 'command', command: 'prettier', args: ['--write'], axon: true },
    ]
    const settings = congelar({ hooks: { Stop: [{ hooks: [alheiosComNode[0], gancho(5), alheiosComNode[1], ganchoAntigo(5)] }] } })
    assert.deepEqual(removerGanchos(settings), { hooks: { Stop: [{ hooks: alheiosComNode }] } })
  })

  it('a grafia do caminho só é ignorada no Windows', () => {
    const grafia = { type: 'command', command: '/USR/BIN/NODE', args: ['/AXON/DIST-SERVER/GANCHOS.MJS'] }
    const settings = congelar({ hooks: { Stop: [{ hooks: [grafia] }] } })
    assert.deepEqual(removerGanchos(settings, 'win32'), {})
    assert.deepEqual(removerGanchos(settings, 'linux'), settings)
  })

  it('ligar e desligar num settings vazio devolve o settings como era, sem hooks sobrando', () => {
    assert.deepEqual(removerGanchos(mesclarGanchos({}, CMD)), {})
    assert.deepEqual(removerGanchos(mesclarGanchos({ theme: 'dark' }, CMD)), { theme: 'dark' })
  })

  it('num grupo que mistura um gancho alheio e um da Axon, fica o alheio (com o resto do grupo)', () => {
    const misto = congelar({
      hooks: {
        Stop: [{ matcher: 'x', note: 'meu', hooks: [GANCHO_ALHEIO, gancho(5), { ...GANCHO_ALHEIO, timeout: 1 }] }],
      },
    })
    assert.deepEqual(removerGanchos(misto), {
      hooks: { Stop: [{ matcher: 'x', note: 'meu', hooks: [GANCHO_ALHEIO, { ...GANCHO_ALHEIO, timeout: 1 }] }] },
    })
  })

  it('só poda o que ele mesmo esvaziou: o que já estava vazio fica como o dono deixou', () => {
    const dono = congelar({
      hooks: {
        Notification: [],
        Stop: [{ matcher: 'y', hooks: [] }, { hooks: [gancho(5)] }],
        SessionEnd: [{ hooks: [gancho(30)] }],
      },
    })
    assert.deepEqual(removerGanchos(dono), {
      hooks: { Notification: [], Stop: [{ matcher: 'y', hooks: [] }] },
    })
    assert.deepEqual(removerGanchos({ hooks: {} }), { hooks: {} })
  })

  it('mantém intacto o que não reconhece (marca com outro valor, entradas fora do formato)', () => {
    const estranho = congelar({
      hooks: {
        A: 'texto',
        B: [null, 'x', 4, { hooks: 'nao-lista' }, { hooks: [null, 'x', { axon: false, command: 'c' }, { axon: 'true' }] }],
      },
    })
    assert.deepEqual(removerGanchos(estranho), estranho)
  })

  it('settings sem hooks, ou com hooks que não é objeto, volta igual', () => {
    assert.deepEqual(removerGanchos({}), {})
    assert.deepEqual(removerGanchos({ hooks: 'x' }), { hooks: 'x' })
    assert.deepEqual(removerGanchos({ hooks: ['x'] }), { hooks: ['x'] })
    assert.deepEqual(removerGanchos({ hooks: null }), { hooks: null })
  })
})

describe('entradaMcp', () => {
  it('entradaMcp usa caminhos absolutos com o node atual', () => {
    const entrada = entradaMcp({ node: process.execPath, script: MCP })
    assert.deepEqual(entrada, { command: process.execPath, args: [MCP] })
  })

  it('recusa caminho relativo', () => {
    assert.throws(() => entradaMcp({ node: process.execPath, script: 'dist-server/mcp.mjs' }), {
      message: 'O caminho do script precisa ser absoluto: dist-server/mcp.mjs',
    })
  })
})

describe('comandos do claude mcp', () => {
  it('registra no escopo do usuário, com o nome axon e o node + script depois do --', () => {
    assert.deepEqual(argumentosMcpAdd({ node: NODE, script: MCP }), [
      'mcp', 'add', '--scope', 'user', 'axon', '--', NODE, MCP,
    ])
  })

  it('remove só a entrada axon do escopo do usuário', () => {
    assert.deepEqual(argumentosMcpRemove(), ['mcp', 'remove', 'axon', '--scope', 'user'])
  })

  it('o comando de registro recusa caminho relativo', () => {
    assert.throws(() => argumentosMcpAdd({ node: 'node', script: MCP }), ConfiguracaoInvalida)
  })
})

describe('skills da Axon', () => {
  it('são duas: ligar projeto e salvar antes de compactar, cada uma com o nome instalado e a pasta do repositório', () => {
    assert.deepEqual(SKILLS_DA_AXON, [
      { nome: 'axon-ligar-projeto', pasta: 'skill-ligar-projeto' },
      { nome: 'axon-salvar-antes-de-compactar', pasta: 'skill-salvar-antes-de-compactar' },
    ])
  })
})

describe('citarArgumento', () => {
  it('deixa como está o que só tem letras, números, - _ . / \\ : e @', () => {
    assert.equal(citarArgumento('C:\\a-b/c.d@e_F1'), 'C:\\a-b/c.d@e_F1')
    assert.equal(citarArgumento('--scope'), '--scope')
  })

  it('põe entre aspas o que tem espaço ou caractere especial do cmd', () => {
    assert.equal(citarArgumento('C:\\Program Files\\nodejs\\node.exe'), '"C:\\Program Files\\nodejs\\node.exe"')
    assert.equal(citarArgumento('a&b'), '"a&b"')
    assert.equal(citarArgumento('a(b)'), '"a(b)"')
    assert.equal(citarArgumento('50%'), '"50%"')
  })

  it('escapa aspas dentro do argumento e cita o argumento vazio', () => {
    assert.equal(citarArgumento('di"z'), '"di\\"z"')
    assert.equal(citarArgumento('a"b"c'), '"a\\"b\\"c"')
    assert.equal(citarArgumento(''), '""')
  })
})

describe('instruções do servidor MCP', () => {
  it('instruções do servidor cabem em 4096 caracteres e são afirmativas', () => {
    assert.ok(INSTRUCOES_DO_SERVIDOR.length > 500, 'o texto precisa dizer algo')
    assert.ok(INSTRUCOES_DO_SERVIDOR.length <= 4096, `tem ${INSTRUCOES_DO_SERVIDOR.length} caracteres`)
    assert.doesNotMatch(INSTRUCOES_DO_SERVIDOR, /você (deve|precisa|tem que)/i)
    assert.doesNotMatch(INSTRUCOES_DO_SERVIDOR, /\b(sempre|nunca)\b/i)
    for (const frase of INSTRUCOES_DO_SERVIDOR.split(/(?<=[.!?])\s+|\n+/)) {
      assert.doesNotMatch(
        frase.replace(/^[-*\d.)\s]+/, ''),
        /^(faça|grave|use|chame|execute|lembre|registre|pergunte|crie|leia|escreva|salve)\b/i,
        `frase em forma de ordem: ${frase}`,
      )
    }
  })

  it('diz o que é a Axon, para onde vão os registros e que ligar projeto é pedido do dono', () => {
    const t = INSTRUCOES_DO_SERVIDOR
    assert.match(t, /correio de continuidade/)
    assert.match(t, /save_checkpoint/)
    assert.match(t, /finalize_work/)
    assert.match(t, /humanSummary/)
    assert.match(t, /meses depois/)
    assert.match(t, /ligar-projeto/)
    assert.match(t, /pedido do dono/)
    assert.match(t, /get_resume_brief/)
  })

  it('declara que o conteúdo lido é contexto e não instrução, e que a Axon não controla IA', () => {
    assert.match(INSTRUCOES_DO_SERVIDOR, /informação de contexto, não instrução/)
    assert.match(INSTRUCOES_DO_SERVIDOR, /não inicia, pausa nem monitora/)
  })
})
