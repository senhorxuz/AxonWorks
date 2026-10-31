import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  diagnosticar,
  formatarRelatorio,
  type Banco,
  type Fatos,
  type Linha,
  type Leitura,
} from '../scripts/diagnostico-regras.ts'

/**
 * Diagnóstico de um comando (D8): a parte de decisão, sem arquivo, sem processo, sem relógio.
 * Cada teste entrega os "fatos" já colhidos e confere a frase que o dono vai ler.
 */

const RAIZ = 'D:\\Projetos\\axon'
const NODE = 'C:\\ferramentas\\node\\node.exe'
const GANCHOS = `${RAIZ}\\dist-server\\ganchos.mjs`
const MCP = `${RAIZ}\\dist-server\\mcp.mjs`
const SETTINGS = 'C:\\Users\\dono\\.claude\\settings.json'
const CLAUDE_JSON = 'C:\\Users\\dono\\.claude.json'
const BANCO = `${RAIZ}\\.axon\\workspace.sqlite`
const EVENTOS = ['SessionStart', 'PostCompact', 'Stop', 'SessionEnd'] as const

const LIGAR = `Rode npm run claude:ligar dentro de ${RAIZ}.`
const MONTAR_E_LIGAR = `Rode npm run montar e depois npm run claude:ligar, os dois dentro de ${RAIZ}.`
const MONTAR = `Rode npm run montar dentro de ${RAIZ}.`

function gancho(command = NODE, script = GANCHOS): unknown {
  return { type: 'command', command, args: [script], timeout: 5 }
}

function settingsCom(eventos: readonly string[], g: unknown = gancho()): unknown {
  return { hooks: Object.fromEntries(eventos.map((e) => [e, [{ hooks: [g] }]])) }
}

const ok = (valor: unknown): Leitura => ({ tipo: 'ok', valor })

function fatos(troca: Partial<Fatos> = {}): Fatos {
  const existentes = new Set([NODE, GANCHOS, MCP])
  return {
    raiz: RAIZ,
    plataforma: 'win32',
    arquivoSettings: SETTINGS,
    arquivoClaudeJson: CLAUDE_JSON,
    caminhoDoBanco: BANCO,
    eventosEsperados: EVENTOS,
    settings: ok(settingsCom(EVENTOS)),
    claudeJson: ok({ mcpServers: { axon: { type: 'stdio', command: NODE, args: [MCP] } } }),
    existe: (caminho) => existentes.has(caminho),
    montados: [
      { nome: 'index.mjs', presente: true, mtimeMs: 2000 },
      { nome: 'mcp.mjs', presente: true, mtimeMs: 2000 },
      { nome: 'ganchos.mjs', presente: true, mtimeMs: 2000 },
    ],
    fonteMaisNova: { arquivo: 'server/store.ts', mtimeMs: 1000 },
    skills: [{ nome: 'axon-ligar-projeto', estado: 'igual' }],
    banco: {
      tipo: 'aberto',
      quickCheck: ['ok'],
      projetos: [
        { nome: 'Axon Works', pasta: RAIZ, ultimoRegistroAutomatico: '2026-10-25T17:03:00.000Z', ultimoErro: null },
      ],
    },
    ...troca,
  }
}

const doItem = (linhas: Linha[], item: number): Linha[] => linhas.filter((l) => l.item === item)
const unica = (linhas: Linha[], item: number): Linha => {
  const achadas = doItem(linhas, item)
  assert.equal(achadas.length, 1, `esperava uma linha do item ${item}, vieram ${achadas.length}`)
  return achadas[0]
}

describe('diagnosticar: tudo certo', () => {
  it('devolve uma linha boa por conferência, sem frase de como resolver', () => {
    const linhas = diagnosticar(fatos())
    assert.deepEqual(
      linhas.map((l) => [l.item, l.ok]),
      [
        [1, true],
        [2, true],
        [3, true],
        [4, true],
        [5, true],
        [6, true],
      ],
    )
    for (const linha of linhas) assert.equal(linha.resolver, undefined)
  })

  it('as frases do que está bom', () => {
    const linhas = diagnosticar(fatos())
    assert.equal(
      unica(linhas, 1).texto,
      'Ganchos: SessionStart, PostCompact, Stop e SessionEnd estão ligados e apontam para arquivos que existem.',
    )
    assert.equal(unica(linhas, 2).texto, 'Os arquivos montados em dist-server são mais novos que tudo em server/ e shared/.')
    assert.equal(unica(linhas, 3).texto, 'O servidor MCP "axon" está registrado no escopo do usuário.')
    assert.equal(unica(linhas, 4).texto, 'A skill axon-ligar-projeto está instalada e igual à desta pasta.')
    assert.equal(
      unica(linhas, 5).texto,
      `O banco ${BANCO} abre e a verificação de integridade (quick_check) respondeu ok.`,
    )
    assert.equal(
      unica(linhas, 6).texto,
      `Projeto Axon Works (${RAIZ}): último registro automático em 25/10/2026 às 14:03.`,
    )
  })
})

describe('item 1: ganchos no settings.json', () => {
  it('sem settings.json: ninguém liga os ganchos', () => {
    const linha = unica(diagnosticar(fatos({ settings: { tipo: 'ausente' } })), 1)
    assert.deepEqual(linha, {
      item: 1,
      ok: false,
      texto: `Não achei o arquivo de configuração do Claude Code (${SETTINGS}), então nenhum gancho da Axon está ligado.`,
      resolver: LIGAR,
    })
  })

  it('settings.json que não é JSON: mostra o motivo e não manda rodar a ligação por cima', () => {
    const linha = unica(diagnosticar(fatos({ settings: { tipo: 'ilegivel', motivo: 'Unexpected token }' } })), 1)
    assert.deepEqual(linha, {
      item: 1,
      ok: false,
      texto: `O arquivo ${SETTINGS} não é um JSON válido (Unexpected token }).`,
      resolver: `Corrija o arquivo à mão (a cópia settings.json.antes-da-axon, se existir, guarda a versão de antes da Axon) e depois rode npm run claude:ligar dentro de ${RAIZ}.`,
    })
  })

  it('settings.json sem nenhum gancho da Axon (só os de outra ferramenta)', () => {
    const alheio = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'prettier', args: ['--write'] }] }] } }
    for (const valor of [alheio, {}, [], null, 'texto', { hooks: 'x' }, { hooks: [] }]) {
      const linha = unica(diagnosticar(fatos({ settings: ok(valor) })), 1)
      assert.deepEqual(linha, {
        item: 1,
        ok: false,
        texto: `Nenhum gancho da Axon está ligado em ${SETTINGS}.`,
        resolver: LIGAR,
      })
    }
  })

  it('faltam eventos: diz quais, no singular e no plural', () => {
    const faltaUm = unica(diagnosticar(fatos({ settings: ok(settingsCom(['SessionStart', 'PostCompact', 'Stop'])) })), 1)
    assert.deepEqual(faltaUm, {
      item: 1,
      ok: false,
      texto: 'Faltam ganchos da Axon para: SessionEnd.',
      resolver: LIGAR,
    })
    const faltaDois = unica(diagnosticar(fatos({ settings: ok(settingsCom(['SessionStart', 'Stop'])) })), 1)
    assert.equal(faltaDois.texto, 'Faltam ganchos da Axon para: PostCompact e SessionEnd.')
    const faltaTres = unica(diagnosticar(fatos({ settings: ok(settingsCom(['Stop'])) })), 1)
    assert.equal(faltaTres.texto, 'Faltam ganchos da Axon para: SessionStart, PostCompact e SessionEnd.')
  })

  it('achar o gancho vale em qualquer posição do grupo e do evento (ao lado de ganchos alheios)', () => {
    const alheio = { type: 'command', command: 'prettier', args: ['--write'] }
    const hooks = Object.fromEntries(
      EVENTOS.map((e) => [e, [{ hooks: [alheio] }, { matcher: 'x', hooks: [alheio, gancho()] }]]),
    )
    const linha = unica(diagnosticar(fatos({ settings: ok({ hooks }) })), 1)
    assert.equal(linha.ok, true)
  })

  it('um evento cujos grupos não são lista, ou um grupo sem lista de ganchos, não conta como ligado', () => {
    const hooks = {
      SessionStart: 'texto',
      PostCompact: [null, 42, { hooks: 'x' }, { semHooks: true }],
      Stop: [{ hooks: [gancho()] }],
      SessionEnd: [{ hooks: [gancho()] }],
    }
    const linha = unica(diagnosticar(fatos({ settings: ok({ hooks }) })), 1)
    assert.equal(linha.texto, 'Faltam ganchos da Axon para: SessionStart e PostCompact.')
  })

  it('só olha os eventos esperados (gancho da Axon num evento qualquer não vale)', () => {
    const linha = unica(
      diagnosticar(fatos({ settings: ok(settingsCom(['PreToolUse'])), eventosEsperados: ['Stop'] })),
      1,
    )
    assert.equal(linha.texto, `Nenhum gancho da Axon está ligado em ${SETTINGS}.`)
  })

  it('gancho que aponta para arquivo que não existe: lista cada caminho uma vez', () => {
    const velho = 'D:\\Projetos\\axon-velho\\dist-server\\ganchos.mjs'
    const linha = unica(diagnosticar(fatos({ settings: ok(settingsCom(EVENTOS, gancho(NODE, velho))) })), 1)
    assert.deepEqual(linha, {
      item: 1,
      ok: false,
      texto: `Os ganchos da Axon apontam para arquivos que não existem: ${velho}.`,
      resolver: MONTAR_E_LIGAR,
    })
  })

  it('o node que sumiu também conta, mas só quando o comando é um caminho (node solto vem do PATH)', () => {
    const sumido = 'C:\\node-antigo\\node.exe'
    const comCaminho = unica(diagnosticar(fatos({ settings: ok(settingsCom(EVENTOS, gancho(sumido, GANCHOS))) })), 1)
    assert.equal(comCaminho.texto, `Os ganchos da Axon apontam para arquivos que não existem: ${sumido}.`)

    const semCaminho = unica(diagnosticar(fatos({ settings: ok(settingsCom(EVENTOS, gancho('node', GANCHOS))) })), 1)
    assert.equal(semCaminho.ok, true)

    const comBarraDePosix = unica(
      diagnosticar(fatos({ settings: ok(settingsCom(EVENTOS, gancho('/usr/bin/node', GANCHOS))) })),
      1,
    )
    assert.equal(comBarraDePosix.texto, 'Os ganchos da Axon apontam para arquivos que não existem: /usr/bin/node.')

    const doisSumidos = unica(
      diagnosticar(fatos({ settings: ok(settingsCom(EVENTOS, gancho(sumido, 'D:\\x\\dist-server\\ganchos.mjs'))) })),
      1,
    )
    assert.equal(
      doisSumidos.texto,
      `Os ganchos da Axon apontam para arquivos que não existem: ${sumido} e D:\\x\\dist-server\\ganchos.mjs.`,
    )
  })

  it('o gancho gravado pela versão antiga (com "axon": true) também é reconhecido', () => {
    const antigo = { ...(gancho() as object), axon: true }
    assert.equal(unica(diagnosticar(fatos({ settings: ok(settingsCom(EVENTOS, antigo)) })), 1).ok, true)
  })

  it('usa a plataforma recebida para reconhecer o gancho (no Windows, maiúsculas não importam)', () => {
    const maiusculo = gancho('C:\\FERRAMENTAS\\NODE\\NODE.EXE', 'D:\\PROJETOS\\AXON\\DIST-SERVER\\GANCHOS.MJS')
    const existe = () => true
    assert.equal(
      unica(diagnosticar(fatos({ plataforma: 'win32', existe, settings: ok(settingsCom(EVENTOS, maiusculo)) })), 1).ok,
      true,
    )
    assert.equal(
      unica(diagnosticar(fatos({ plataforma: 'linux', existe, settings: ok(settingsCom(EVENTOS, maiusculo)) })), 1).ok,
      false,
    )
  })
})

describe('item 2: programa montado em dia', () => {
  const montados = (...mtimes: Array<number | null>) =>
    ['index.mjs', 'mcp.mjs', 'ganchos.mjs'].map((nome, i) => ({
      nome,
      presente: mtimes[i] !== null,
      mtimeMs: mtimes[i] ?? 0,
    }))

  it('faltando arquivo montado: lista os que faltam', () => {
    const um = unica(diagnosticar(fatos({ montados: montados(2000, null, 2000) })), 2)
    assert.deepEqual(um, {
      item: 2,
      ok: false,
      texto: 'Faltam arquivos montados da Axon: dist-server/mcp.mjs.',
      resolver: MONTAR,
    })
    const todos = unica(diagnosticar(fatos({ montados: montados(null, null, null) })), 2)
    assert.equal(
      todos.texto,
      'Faltam arquivos montados da Axon: dist-server/index.mjs, dist-server/mcp.mjs e dist-server/ganchos.mjs.',
    )
  })

  it('faltar arquivo vale mais que estar velho', () => {
    const linha = unica(
      diagnosticar(fatos({ montados: montados(500, null, 2000), fonteMaisNova: { arquivo: 'server/a.ts', mtimeMs: 1000 } })),
      2,
    )
    assert.equal(linha.texto, 'Faltam arquivos montados da Axon: dist-server/mcp.mjs.')
  })

  it('código mais novo que a montagem: diz qual arquivo e quais montados estão velhos', () => {
    const fonteMaisNova = { arquivo: 'shared/carta.ts', mtimeMs: 1500 }
    const um = unica(diagnosticar(fatos({ montados: montados(2000, 1000, 2000), fonteMaisNova })), 2)
    assert.deepEqual(um, {
      item: 2,
      ok: false,
      texto: 'O código mudou depois da última montagem: shared/carta.ts é mais novo que dist-server/mcp.mjs.',
      resolver: MONTAR,
    })
    const dois = unica(diagnosticar(fatos({ montados: montados(1000, 1499, 2000), fonteMaisNova })), 2)
    assert.equal(
      dois.texto,
      'O código mudou depois da última montagem: shared/carta.ts é mais novo que dist-server/index.mjs e dist-server/mcp.mjs.',
    )
  })

  it('mesma hora não é velho; um milissegundo depois é', () => {
    const fonteMaisNova = { arquivo: 'server/a.ts', mtimeMs: 2000 }
    assert.equal(unica(diagnosticar(fatos({ montados: montados(2000, 2000, 2000), fonteMaisNova })), 2).ok, true)
    assert.equal(
      unica(diagnosticar(fatos({ montados: montados(2000, 2000, 2000), fonteMaisNova: { ...fonteMaisNova, mtimeMs: 2001 } })), 2)
        .ok,
      false,
    )
  })

  it('sem nenhum arquivo em server/ e shared/ não há o que comparar: está em dia', () => {
    assert.equal(unica(diagnosticar(fatos({ fonteMaisNova: null })), 2).ok, true)
  })
})

describe('item 3: servidor MCP "axon"', () => {
  const claudeJson = (axon: unknown, extra: object = {}): Leitura => ok({ mcpServers: { axon }, ...extra })

  it('sem o arquivo do Claude Code', () => {
    assert.deepEqual(unica(diagnosticar(fatos({ claudeJson: { tipo: 'ausente' } })), 3), {
      item: 3,
      ok: false,
      texto: `Não achei o servidor MCP "axon": o arquivo ${CLAUDE_JSON} não existe.`,
      resolver: LIGAR,
    })
  })

  it('arquivo do Claude Code que não é JSON', () => {
    assert.deepEqual(unica(diagnosticar(fatos({ claudeJson: { tipo: 'ilegivel', motivo: 'fim inesperado' } })), 3), {
      item: 3,
      ok: false,
      texto: `Não deu para conferir o servidor MCP "axon": o arquivo ${CLAUDE_JSON} não é um JSON válido (fim inesperado).`,
      resolver: `Confira esse arquivo (ele é do Claude Code) e depois rode npm run claude:ligar dentro de ${RAIZ}.`,
    })
  })

  it('não registrado no escopo do usuário', () => {
    const esperado = {
      item: 3,
      ok: false,
      texto: 'O servidor MCP "axon" não está registrado no escopo do usuário.',
      resolver: LIGAR,
    }
    for (const valor of [{}, [], null, 'x', { mcpServers: null }, { mcpServers: {} }, { mcpServers: { outro: {} } }, { mcpServers: { axon: 'x' } }]) {
      assert.deepEqual(unica(diagnosticar(fatos({ claudeJson: ok(valor) })), 3), esperado)
    }
  })

  it('registrado só dentro de um projeto não vale (só o escopo do usuário serve para qualquer pasta)', () => {
    const doProjeto = ok({ projects: { 'D:/Projetos/axon': { mcpServers: { axon: { command: NODE, args: [MCP] } } } } })
    assert.equal(unica(diagnosticar(fatos({ claudeJson: doProjeto })), 3).ok, false)
  })

  it('registrado apontando para arquivo que não existe', () => {
    const velho = 'D:\\Projetos\\axon-velho\\dist-server\\mcp.mjs'
    assert.deepEqual(unica(diagnosticar(fatos({ claudeJson: claudeJson({ command: NODE, args: [velho] }) })), 3), {
      item: 3,
      ok: false,
      texto: `O servidor MCP "axon" está registrado, mas aponta para arquivos que não existem: ${velho}.`,
      resolver: MONTAR_E_LIGAR,
    })
  })

  it('o node do registro que sumiu conta; node solto não; sem args ou args estranhos não quebram', () => {
    const sumido = 'C:\\node-antigo\\node.exe'
    assert.equal(
      unica(diagnosticar(fatos({ claudeJson: claudeJson({ command: sumido, args: [MCP] }) })), 3).texto,
      `O servidor MCP "axon" está registrado, mas aponta para arquivos que não existem: ${sumido}.`,
    )
    assert.equal(unica(diagnosticar(fatos({ claudeJson: claudeJson({ command: 'node', args: [MCP] }) })), 3).ok, true)
    for (const entrada of [{ command: NODE }, { command: NODE, args: 'x' }, { command: NODE, args: [] }, { command: NODE, args: [7] }, { url: 'http://x' }, { command: 7, args: [MCP] }, { command: ['D:/x/node.exe'], args: [MCP] }]) {
      assert.equal(unica(diagnosticar(fatos({ claudeJson: claudeJson(entrada) })), 3).ok, true, JSON.stringify(entrada))
    }
  })

  it('dois caminhos que faltam aparecem juntos', () => {
    const entrada = { command: 'C:\\n\\node.exe', args: ['D:\\y\\mcp.mjs'] }
    assert.equal(
      unica(diagnosticar(fatos({ claudeJson: claudeJson(entrada) })), 3).texto,
      'O servidor MCP "axon" está registrado, mas aponta para arquivos que não existem: C:\\n\\node.exe e D:\\y\\mcp.mjs.',
    )
  })
})

describe('item 4: skills da Axon', () => {
  it('uma linha por skill, na ordem recebida', () => {
    const linhas = doItem(
      diagnosticar(
        fatos({
          skills: [
            { nome: 'axon-ligar-projeto', estado: 'igual' },
            { nome: 'axon-salvar-antes-de-compactar', estado: 'ausente' },
            { nome: 'axon-outra', estado: 'diferente' },
          ],
        }),
      ),
      4,
    )
    assert.deepEqual(linhas, [
      { item: 4, ok: true, texto: 'A skill axon-ligar-projeto está instalada e igual à desta pasta.' },
      {
        item: 4,
        ok: false,
        texto: 'A skill axon-salvar-antes-de-compactar não está instalada.',
        resolver: LIGAR,
      },
      {
        item: 4,
        ok: false,
        texto: 'A skill axon-outra instalada está diferente da desta pasta (desatualizada).',
        resolver: LIGAR,
      },
    ])
  })

  it('nenhuma skill encontrada na pasta da Axon: pede para conferir a pasta', () => {
    assert.deepEqual(unica(diagnosticar(fatos({ skills: [] })), 4), {
      item: 4,
      ok: false,
      texto: `Não achei nenhuma skill da Axon em ${RAIZ}.`,
      resolver: `Confira se ${RAIZ} é a pasta da Axon (use --raiz para apontar a pasta certa).`,
    })
  })
})

describe('item 5: banco', () => {
  const resolverBanco = 'Se o arquivo estiver corrompido, restaure um backup da Axon (pasta .axon/backups) e rode o diagnóstico de novo.'

  it('banco que não existe', () => {
    assert.deepEqual(unica(diagnosticar(fatos({ banco: { tipo: 'ausente' } })), 5), {
      item: 5,
      ok: false,
      texto: `O banco da Axon não existe em ${BANCO}.`,
      resolver: `Abra a Axon uma vez (npm start dentro de ${RAIZ}) para ela criar o banco; se o seu banco fica em outro lugar, defina AXON_DB_PATH.`,
    })
  })

  it('banco que não abre', () => {
    const banco: Banco = { tipo: 'erro', motivo: 'database is locked' }
    assert.deepEqual(unica(diagnosticar(fatos({ banco })), 5), {
      item: 5,
      ok: false,
      texto: `O banco ${BANCO} não abriu: database is locked.`,
      resolver: `Confira se outro programa está travando o arquivo. ${resolverBanco}`,
    })
  })

  it('verificação de integridade com problemas: mostra até 3 e conta o resto', () => {
    const quatro = unica(
      diagnosticar(fatos({ banco: { tipo: 'aberto', quickCheck: ['a', 'b', 'c', 'd'], projetos: [] } })),
      5,
    )
    assert.deepEqual(quatro, {
      item: 5,
      ok: false,
      texto: `A verificação de integridade do banco ${BANCO} achou problemas: a; b; c (e mais 1).`,
      resolver: resolverBanco,
    })
    const tres = unica(diagnosticar(fatos({ banco: { tipo: 'aberto', quickCheck: ['a', 'b', 'c'], projetos: [] } })), 5)
    assert.equal(tres.texto, `A verificação de integridade do banco ${BANCO} achou problemas: a; b; c.`)
    const um = unica(diagnosticar(fatos({ banco: { tipo: 'aberto', quickCheck: ['a'], projetos: [] } })), 5)
    assert.equal(um.texto, `A verificação de integridade do banco ${BANCO} achou problemas: a.`)
  })

  it('quick_check vazio ou "ok" mais outra coisa não é "ok"', () => {
    assert.equal(unica(diagnosticar(fatos({ banco: { tipo: 'aberto', quickCheck: [], projetos: [] } })), 5).ok, false)
    assert.equal(
      unica(diagnosticar(fatos({ banco: { tipo: 'aberto', quickCheck: ['ok', 'página 3 com erro'], projetos: [] } })), 5).ok,
      false,
    )
  })
})

describe('item 6: último registro dos ganchos por projeto', () => {
  const projeto = (troca: object = {}) => ({
    nome: 'Axon Works',
    pasta: RAIZ,
    ultimoRegistroAutomatico: null,
    ultimoErro: null,
    ...troca,
  })
  const comProjetos = (...projetos: ReturnType<typeof projeto>[]): Banco => ({ tipo: 'aberto', quickCheck: ['ok'], projetos })

  it('banco ausente ou que não abriu: não dá para conferir e manda resolver o item 5', () => {
    const esperado = {
      item: 6,
      ok: false,
      texto: 'Não deu para conferir os registros dos ganchos por projeto, porque o banco não abriu (item 5).',
      resolver: 'Resolva o item 5 primeiro.',
    }
    assert.deepEqual(unica(diagnosticar(fatos({ banco: { tipo: 'ausente' } })), 6), esperado)
    assert.deepEqual(unica(diagnosticar(fatos({ banco: { tipo: 'erro', motivo: 'x' } })), 6), esperado)
  })

  it('banco aberto sem projetos com pasta', () => {
    assert.deepEqual(unica(diagnosticar(fatos({ banco: comProjetos() })), 6), {
      item: 6,
      ok: true,
      texto: 'Nenhum projeto com pasta está cadastrado na Axon.',
    })
  })

  it('projeto que nunca teve registro automático não é problema', () => {
    assert.deepEqual(unica(diagnosticar(fatos({ banco: comProjetos(projeto()) })), 6), {
      item: 6,
      ok: true,
      texto: `Projeto Axon Works (${RAIZ}): ainda sem registro automático.`,
    })
  })

  it('a hora do registro é a do fuso de São Paulo', () => {
    const linha = unica(
      diagnosticar(fatos({ banco: comProjetos(projeto({ ultimoRegistroAutomatico: '2026-01-02T02:05:00.000Z' })) })),
      6,
    )
    assert.equal(linha.texto, `Projeto Axon Works (${RAIZ}): último registro automático em 01/01/2026 às 23:05.`)
  })

  it('meia-noite é 00:00 (nunca 24:00) e o mês e o dia têm sempre dois dígitos', () => {
    const linha = unica(
      diagnosticar(fatos({ banco: comProjetos(projeto({ ultimoRegistroAutomatico: '2026-03-05T03:00:00.000Z' })) })),
      6,
    )
    assert.equal(linha.texto, `Projeto Axon Works (${RAIZ}): último registro automático em 05/03/2026 às 00:00.`)
  })

  it('a hora não depende do fuso do computador onde o diagnóstico roda', () => {
    const antes = process.env.TZ
    process.env.TZ = 'Asia/Tokyo'
    try {
      const linha = unica(
        diagnosticar(fatos({ banco: comProjetos(projeto({ ultimoRegistroAutomatico: '2026-10-25T17:03:00.000Z' })) })),
        6,
      )
      assert.equal(linha.texto, `Projeto Axon Works (${RAIZ}): último registro automático em 25/10/2026 às 14:03.`)
    } finally {
      if (antes === undefined) delete process.env.TZ
      else process.env.TZ = antes
    }
  })

  it('data que não dá para ler aparece como veio', () => {
    const linha = unica(
      diagnosticar(fatos({ banco: comProjetos(projeto({ ultimoRegistroAutomatico: 'ontem' })) })),
      6,
    )
    assert.equal(linha.texto, `Projeto Axon Works (${RAIZ}): último registro automático em ontem.`)
  })

  it('erro de gancho ainda não superado: mostra o erro e como resolver', () => {
    const banco = comProjetos(projeto({ ultimoErro: 'database is locked' }))
    assert.deepEqual(unica(diagnosticar(fatos({ banco })), 6), {
      item: 6,
      ok: false,
      texto: `Projeto Axon Works (${RAIZ}): o último gancho falhou: database is locked`,
      resolver: `Abra uma sessão nova do Claude Code nessa pasta; se o erro voltar, rode npm run montar e depois npm run claude:ligar dentro de ${RAIZ}.`,
    })
  })

  it('erro comprido ou em várias linhas vira uma linha de até 200 caracteres', () => {
    const duasLinhas = comProjetos(projeto({ ultimoErro: '\n primeira\n  segunda\r\n\tterceira \n' }))
    assert.equal(
      unica(diagnosticar(fatos({ banco: duasLinhas })), 6).texto,
      `Projeto Axon Works (${RAIZ}): o último gancho falhou: primeira segunda terceira`,
    )
    const exato = 'x'.repeat(200)
    assert.equal(
      unica(diagnosticar(fatos({ banco: comProjetos(projeto({ ultimoErro: exato })) })), 6).texto,
      `Projeto Axon Works (${RAIZ}): o último gancho falhou: ${exato}`,
    )
    const longo = 'y'.repeat(201)
    assert.equal(
      unica(diagnosticar(fatos({ banco: comProjetos(projeto({ ultimoErro: longo })) })), 6).texto,
      `Projeto Axon Works (${RAIZ}): o último gancho falhou: ${'y'.repeat(199)}…`,
    )
  })

  it('uma linha por projeto, na ordem recebida, cada uma com o seu resultado', () => {
    const banco = comProjetos(
      projeto({ nome: 'A', pasta: 'D:\\a' }),
      projeto({ nome: 'B', pasta: 'D:\\b', ultimoErro: 'quebrou' }),
    )
    const linhas = doItem(diagnosticar(fatos({ banco })), 6)
    assert.deepEqual(
      linhas.map((l) => [l.ok, l.texto]),
      [
        [true, 'Projeto A (D:\\a): ainda sem registro automático.'],
        [false, 'Projeto B (D:\\b): o último gancho falhou: quebrou'],
      ],
    )
  })
})

describe('formatarRelatorio', () => {
  const bom: Linha = { item: 1, ok: true, texto: 'Tudo bem aqui.' }
  const ruim: Linha = { item: 2, ok: false, texto: 'Algo quebrou.', resolver: 'Rode o conserto.' }

  it('cabeçalho, uma linha por conferência com ✔/✘, a frase de como resolver e o resultado', () => {
    assert.deepEqual(formatarRelatorio([bom, ruim], RAIZ), {
      linhas: [
        'Diagnóstico da Axon (só lê, não grava nada)',
        `Pasta da Axon: ${RAIZ}`,
        '',
        '✔ 1. Tudo bem aqui.',
        '✘ 2. Algo quebrou.',
        '     Como resolver: Rode o conserto.',
        '',
        'Resultado: 1 de 2 conferências passaram. Resolva os itens marcados com ✘ e rode npm run axon:diagnostico de novo.',
      ],
      problemas: 1,
    })
  })

  it('tudo certo: mensagem de fechamento e nenhum problema', () => {
    assert.deepEqual(formatarRelatorio([bom, { ...bom, item: 2 }], RAIZ), {
      linhas: [
        'Diagnóstico da Axon (só lê, não grava nada)',
        `Pasta da Axon: ${RAIZ}`,
        '',
        '✔ 1. Tudo bem aqui.',
        '✔ 2. Tudo bem aqui.',
        '',
        'Tudo certo: as 2 conferências passaram.',
      ],
      problemas: 0,
    })
  })

  it('conta cada linha com ✘ como um problema', () => {
    const { problemas } = formatarRelatorio([ruim, ruim, bom], RAIZ)
    assert.equal(problemas, 2)
  })

  it('linha ruim sem frase de como resolver não imprime a linha de resolver', () => {
    const semResolver: Linha = { item: 3, ok: false, texto: 'Sem saída.' }
    const { linhas } = formatarRelatorio([semResolver], RAIZ)
    assert.deepEqual(linhas.slice(3, 4), ['✘ 3. Sem saída.'])
    assert.equal(linhas.some((l) => l.includes('Como resolver')), false)
  })

  it('o relatório de uma instalação saudável é só ✔', () => {
    const { problemas, linhas } = formatarRelatorio(diagnosticar(fatos()), RAIZ)
    assert.equal(problemas, 0)
    assert.equal(linhas.at(-1), 'Tudo certo: as 6 conferências passaram.')
  })
})
