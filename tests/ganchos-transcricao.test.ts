import assert from 'node:assert/strict'
import { appendFileSync, closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  JANELA_PADRAO_BYTES,
  cortarFimSemPartir,
  cortarInicioSemPartir,
  lerFimDaConversa,
} from '../server/ganchos/transcricao.ts'

/**
 * Review Focus 4: a conversa (JSONL do Claude Code) pode vir malformada. Fixtures sintéticas, no
 * formato observado num arquivo real: linhas `user` (texto ou `tool_result`), `assistant` (texto,
 * `tool_use`, `thinking`) e muitas linhas de outros tipos que não interessam.
 */

const pastas: string[] = []

afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function arquivo(linhas: Array<unknown>, final = '\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'axon-conversa-'))
  pastas.push(dir)
  const caminho = join(dir, 'conversa.jsonl')
  writeFileSync(caminho, linhas.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + final)
  return caminho
}

const dono = (texto: string, timestamp = '2026-10-25T10:00:00.000Z') => ({
  type: 'user',
  message: { role: 'user', content: texto },
  timestamp,
  origin: { kind: 'human' },
})
const donoEmPartes = (...textos: string[]) => ({
  type: 'user',
  message: { role: 'user', content: textos.map((text) => ({ type: 'text', text })) },
  timestamp: '2026-10-25T10:01:00.000Z',
})
const resultado = () => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'saída do comando' }] },
})
const claude = (texto: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: texto }] },
})
const ferramenta = (quantas = 1) => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: Array.from({ length: quantas }, (_, i) => ({ type: 'tool_use', id: `t${i}`, name: 'Bash', input: {} })),
  },
})

describe('lerFimDaConversa', () => {
  it('conta pedidos do dono que são texto e usos de ferramenta; tool_result não é pedido', () => {
    const caminho = arquivo([
      { type: 'ai-title', aiTitle: 'Título' },
      dono('Arruma o login'),
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Vou olhar.' }] } },
      ferramenta(2),
      resultado(),
      claude('Arrumei.'),
      donoEmPartes('Agora ', 'o cadastro'),
      { type: 'attachment', attachment: { type: 'hook_success' } },
    ])
    const fim = lerFimDaConversa(caminho, 8000)
    assert.equal(fim.pedidosDoDono, 2)
    assert.equal(fim.usosDeFerramenta, 2)
    assert.equal(fim.texto, 'Dono: Arruma o login\n\nClaude: Vou olhar.\n\nClaude: Arrumei.\n\nDono: Agora o cadastro')
    assert.equal(fim.ultimoPedidoEm, '2026-10-25T10:01:00.000Z')
  })

  it('guarda o texto de cada pedido do dono, na ordem, aparado, sem o que não é pedido e sem o corte do texto da conversa', () => {
    const caminho = arquivo([
      dono('  Arruma o login  '),
      resultado(),
      { ...dono('meta'), isMeta: true },
      claude('Arrumei.'),
      donoEmPartes('Agora ', 'o cadastro'),
      dono('   '),
    ])
    const fim = lerFimDaConversa(caminho, 10)
    assert.deepEqual(fim.pedidos, ['Arruma o login', 'Agora o cadastro'])
    assert.equal(fim.pedidosDoDono, 2)
    assert.equal(fim.texto, 'o cadastro')
  })

  it('não conta o que não foi o dono: meta, subagente, notificação, só imagem, texto vazio', () => {
    const caminho = arquivo([
      { ...dono('Base directory for this skill'), isMeta: true },
      { ...dono('pedido do orquestrador ao subagente'), isSidechain: true },
      { ...claude('resposta do subagente'), isSidechain: true },
      { ...ferramenta(), isSidechain: true },
      { ...dono('<task-notification>'), origin: { kind: 'task-notification' } },
      { type: 'user', message: { content: [{ type: 'image', source: { type: 'base64', data: 'AAAA' } }] } },
      dono('   '),
      { type: 'user', message: { content: [{ type: 'text', text: 'misturado' }, { type: 'tool_result', content: 'x' }] } },
      { type: 'user', message: { content: [{ type: 'text', text: 42 }] } },
      { type: 'user', message: { content: 7 } },
      { type: 'user' },
      { type: 'assistant', message: { content: 'texto solto não conta' } },
      { type: 'assistant' },
      { type: 'assistant', message: { content: [null, 'x', { type: 'text' }, { type: 'text', text: '  ' }] } },
    ])
    assert.deepEqual(lerFimDaConversa(caminho, 8000), { texto: '', pedidosDoDono: 0, pedidos: [], usosDeFerramenta: 0, ultimoPedidoEm: '' })
  })

  it('pedido sem origem conta (formato mais antigo); pedido sem hora não muda a última hora', () => {
    const semOrigem = { type: 'user', message: { content: 'sem origem' }, timestamp: '2026-10-25T09:00:00.000Z' }
    const semHora = { type: 'user', message: { content: 'sem hora' }, timestamp: 5 }
    const fim = lerFimDaConversa(arquivo([semOrigem, semHora]), 8000)
    assert.equal(fim.pedidosDoDono, 2)
    assert.equal(fim.ultimoPedidoEm, '2026-10-25T09:00:00.000Z')
  })

  it('última linha cortada é ignorada; linhas vazias, JSON que não é objeto e tipos desconhecidos também', () => {
    const caminho = arquivo(
      ['', 'null', '"texto"', '[1,2]', dono('primeiro'), ferramenta(), { type: 'novo-tipo', message: { content: 'x' } }, '{"type":"user","message":{"content":"cort'],
      '',
    )
    const fim = lerFimDaConversa(caminho, 8000)
    assert.equal(fim.pedidosDoDono, 1)
    assert.equal(fim.usosDeFerramenta, 1)
    assert.equal(fim.texto, 'Dono: primeiro')
  })

  it('linha que a compactação injetou (isCompactSummary) não é pedido do dono, com ou sem origem humana', () => {
    const sumario = 'This session is being continued from a previous conversation that ran out of context. Summary: ...'
    const caminho = arquivo([
      { type: 'user', isCompactSummary: true, message: { role: 'user', content: sumario }, timestamp: '2026-10-25T10:30:00.000Z' },
      { ...dono(sumario, '2026-10-25T10:31:00.000Z'), isCompactSummary: true },
      { type: 'user', isCompactSummary: true, message: { content: [{ type: 'text', text: sumario }] }, timestamp: '2026-10-25T10:32:00.000Z' },
      dono('Arruma o login', '2026-10-25T09:00:00.000Z'),
    ])
    const fim = lerFimDaConversa(caminho, 8000)
    assert.deepEqual(fim.pedidos, ['Arruma o login'])
    assert.equal(fim.pedidosDoDono, 1)
    assert.equal(fim.texto, 'Dono: Arruma o login')
    assert.equal(fim.ultimoPedidoEm, '2026-10-25T09:00:00.000Z')
  })

  it('isCompactSummary falso, nulo, texto ou ausente não tira o pedido', () => {
    const caminho = arquivo([
      { ...dono('com falso'), isCompactSummary: false },
      dono('sem a marca'),
      { ...dono('com nulo'), isCompactSummary: null },
      { ...dono('com texto'), isCompactSummary: 'true' },
    ])
    assert.deepEqual(lerFimDaConversa(caminho, 8000).pedidos, ['com falso', 'sem a marca', 'com nulo', 'com texto'])
  })

  // Texto que o Claude Code grava como se fosse do dono, mas é comando ou aviso do sistema.
  const TEXTOS_DE_SISTEMA: Array<[string, string]> = [
    ['comando (nome)', '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>'],
    ['comando (mensagem)', '<command-message>axon-salvar-antes-de-compactar</command-message>'],
    ['saída de comando local', '<local-command-stdout>Compacted</local-command-stdout>'],
    ['aviso de comando local', '<local-command-caveat>Caveat: as mensagens abaixo foram geradas por comandos locais.</local-command-caveat>'],
    ['interrupção', '[Request interrupted by user]'],
    ['interrupção numa ferramenta', '[Request interrupted by user for tool use]'],
  ]

  for (const [forma, texto] of TEXTOS_DE_SISTEMA) {
    it(`${forma} não é pedido do dono: não conta, não entra na lista nem no texto, nem muda a hora`, () => {
      const caminho = arquivo([
        dono('Arruma o login', '2026-10-25T09:00:00.000Z'),
        dono(texto, '2026-10-25T10:00:00.000Z'),
        donoEmPartes(texto),
        dono(`  \n${texto}`, '2026-10-25T10:02:00.000Z'),
      ])
      const fim = lerFimDaConversa(caminho, 8000)
      assert.deepEqual(fim.pedidos, ['Arruma o login'])
      assert.equal(fim.pedidosDoDono, 1)
      assert.equal(fim.texto, 'Dono: Arruma o login')
      assert.equal(fim.ultimoPedidoEm, '2026-10-25T09:00:00.000Z')
    })
  }

  it('comando ou saída cortados no meio (sem o fecho) também são do sistema: o que vale é o começo do texto', () => {
    const caminho = arquivo([
      dono('Arruma o login'),
      dono('<command-name>/clear'),
      dono('<command-message>axon-salvar-antes-de-compactar'),
      dono('<local-command-stdout>Compacted'),
    ])
    const fim = lerFimDaConversa(caminho, 8000)
    assert.deepEqual(fim.pedidos, ['Arruma o login'])
    assert.equal(fim.pedidosDoDono, 1)
  })

  // Blocos que ferramentas injetam na mensagem do dono: o Claude Code os grava como texto dele.
  const BLOCOS_INJETADOS: Array<[string, string]> = [
    ['browser_instruction (extensão Claude in Chrome)', '<browser_instruction>\nUse a ferramenta computer.\nNunca clique em anúncios.\n</browser_instruction>'],
    ['system-reminder', '<system-reminder>\nAs always, follow the rules.\r\nSecond line.\n</system-reminder>'],
    ['ide_opened_file', '<ide_opened_file>The user opened the file D:\\Projetos\\alfa\\a.ts in the IDE.</ide_opened_file>'],
    ['ide_selection', '<ide_selection>The user selected lines 1 to 2 from a.ts:\nfoo\nbar\n</ide_selection>'],
    ['local-command-stdout', '<local-command-stdout>Compacted\n(ctrl+o)</local-command-stdout>'],
    ['command-name', '<command-name>/context</command-name>'],
    ['command-message', '<command-message>context</command-message>'],
    ['command-args', '<command-args>--rápido</command-args>'],
    ['bloco com atributos', '<system-reminder origem="hook" n="2">\naviso\n</system-reminder>'],
  ]

  for (const [forma, bloco] of BLOCOS_INJETADOS) {
    it(`${forma}: sozinho não é pedido do dono (não conta, não entra na lista nem no texto, nem muda a hora)`, () => {
      const caminho = arquivo([
        dono('Arruma o login', '2026-10-25T09:00:00.000Z'),
        dono(bloco, '2026-10-25T10:00:00.000Z'),
        donoEmPartes(bloco),
        dono(`  \n${bloco}\n  `, '2026-10-25T10:02:00.000Z'),
        donoEmPartes(bloco, '\n', bloco),
      ])
      const fim = lerFimDaConversa(caminho, 8000)
      assert.deepEqual(fim.pedidos, ['Arruma o login'])
      assert.equal(fim.pedidosDoDono, 1)
      assert.equal(fim.texto, 'Dono: Arruma o login')
      assert.equal(fim.ultimoPedidoEm, '2026-10-25T09:00:00.000Z')
    })

    it(`${forma}: no meio de texto de verdade, o texto fica e o bloco sai`, () => {
      const caminho = arquivo([
        dono(`${bloco}\nArruma o login`, '2026-10-25T09:00:00.000Z'),
        dono(`Agora o cadastro\n${bloco}`, '2026-10-25T09:05:00.000Z'),
        dono(`Troca o ${bloco}botão`, '2026-10-25T09:10:00.000Z'),
        donoEmPartes(bloco, 'Fecha a tela'),
      ])
      const fim = lerFimDaConversa(caminho, 8000)
      assert.deepEqual(fim.pedidos, ['Arruma o login', 'Agora o cadastro', 'Troca o botão', 'Fecha a tela'])
      assert.equal(fim.pedidosDoDono, 4)
      assert.equal(fim.texto, 'Dono: Arruma o login\n\nDono: Agora o cadastro\n\nDono: Troca o botão\n\nDono: Fecha a tela')
      assert.equal(fim.ultimoPedidoEm, '2026-10-25T10:01:00.000Z')
    })
  }

  it('o caso da Alfa: o bloco da extensão do navegador sozinho não vale como pedido, e junto de texto de verdade só o texto fica', () => {
    const bloco = '<browser_instruction>\nNão use o navegador sem pedir.\n</browser_instruction>'
    const caminho = arquivo([
      dono('Publica a versão 2'),
      ferramenta(),
      dono(bloco),
      { type: 'user', message: { content: [{ type: 'text', text: bloco }, { type: 'text', text: 'Agora confere no ar' }] }, timestamp: '2026-10-25T10:03:00.000Z' },
    ])
    const fim = lerFimDaConversa(caminho, 8000)
    assert.deepEqual(fim.pedidos, ['Publica a versão 2', 'Agora confere no ar'])
    assert.equal(fim.pedidosDoDono, 2)
    assert.ok(!fim.texto.includes('browser_instruction'))
  })

  it('bloco injetado seguido de aviso de interrupção: continua não sendo pedido', () => {
    const caminho = arquivo([dono('Arruma o login'), dono('<system-reminder>x</system-reminder>[Request interrupted by user]')])
    assert.deepEqual(lerFimDaConversa(caminho, 8000).pedidos, ['Arruma o login'])
  })

  it('quem só cita o nome do bloco, sem ser um bloco inteiro, continua sendo pedido', () => {
    const pedidos = [
      'Por que o browser_instruction apareceu no rascunho?',
      'Tira o <browser_instruction> do rascunho',
      'O <system-reminder> sem fecho é só texto',
      'Mostra o </ide_selection> sozinho',
      '<ide_opened_filex>nome parecido</ide_opened_filex> fica',
      '<system-reminder>fecho de outro bloco</browser_instruction>',
    ]
    const fim = lerFimDaConversa(arquivo(pedidos.map((p) => dono(p))), 8000)
    assert.deepEqual(fim.pedidos, pedidos)
    assert.equal(fim.pedidosDoDono, pedidos.length)
  })

  it('só vale o começo do texto: quem menciona o comando no meio da frase continua sendo pedido', () => {
    const pedidos = [
      'Por que apareceu <command-name> na tela?',
      'O aviso [Request interrupted by user] some quando?',
      'Mostra o <local-command-stdout> do teste',
      'Troca o <command-message> por outro',
      '<div> quebrou na tela',
      '[Request] lento demais',
      '[Pedido interrompido pelo dono]',
      '<local-comando-x> não é do sistema',
      '<command-args> sozinho',
    ]
    const fim = lerFimDaConversa(arquivo(pedidos.map((p) => dono(p))), 8000)
    assert.deepEqual(fim.pedidos, pedidos)
    assert.equal(fim.pedidosDoDono, pedidos.length)
  })

  it('caminho ausente: tudo zero', () => {
    assert.deepEqual(lerFimDaConversa(undefined, 8000), { texto: '', pedidosDoDono: 0, pedidos: [], usosDeFerramenta: 0, ultimoPedidoEm: '' })
  })

  it('o arquivo é fechado depois de ler', () => {
    const caminho = arquivo([dono('um'), ferramenta()])
    const livreAntes = proximoDescritorLivre(caminho)
    for (let i = 0; i < 3; i += 1) lerFimDaConversa(caminho, 8000, 10)
    assert.equal(proximoDescritorLivre(caminho), livreAntes)
  })

  it('arquivo inexistente: tudo zero', () => {
    assert.deepEqual(lerFimDaConversa(join(tmpdir(), 'axon-nao-existe', 'x.jsonl'), 8000), {
      texto: '',
      pedidosDoDono: 0,
      pedidos: [],
      usosDeFerramenta: 0,
      ultimoPedidoEm: '',
    })
  })

  it('caminho vazio ou que é pasta: tudo zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axon-conversa-pasta-'))
    pastas.push(dir)
    for (const caminho of ['', dir]) {
      assert.deepEqual(lerFimDaConversa(caminho, 8000), { texto: '', pedidosDoDono: 0, pedidos: [], usosDeFerramenta: 0, ultimoPedidoEm: '' })
    }
  })

  it('texto = as últimas mensagens até o limite, sem partir palavra', () => {
    const caminho = arquivo([dono('começo antigo que não cabe'), claude('meio da conversa'), dono('fim recente')])
    const inteiro = 'Dono: começo antigo que não cabe\n\nClaude: meio da conversa\n\nDono: fim recente'
    assert.equal(lerFimDaConversa(caminho, inteiro.length).texto, inteiro)
    // 43 = 'Claude: meio da conversa' + '\n\n' + 'Dono: fim recente': o corte cai logo depois de uma quebra.
    assert.equal(lerFimDaConversa(caminho, 43).texto, 'Claude: meio da conversa\n\nDono: fim recente')
    // 29: o corte cai dentro de "da"; a palavra partida sai.
    const fim = lerFimDaConversa(caminho, 29)
    assert.equal(fim.texto, 'conversa\n\nDono: fim recente')
    assert.ok(fim.texto.length <= 29)
  })

  it('só o fim do arquivo é lido: a linha partida no começo da janela é descartada', () => {
    const recentes = [dono('recente 1'), ferramenta(), dono('recente 2')].map((l) => JSON.stringify(l))
    const caminho = arquivo([dono(`antigo ${'x'.repeat(300)}`), ...recentes])
    // A janela pega as três linhas recentes inteiras e só o fim da antiga.
    const janela = Buffer.byteLength(`${recentes.join('\n')}\n`) + 40
    const fim = lerFimDaConversa(caminho, 8000, janela)
    assert.equal(fim.pedidosDoDono, 2)
    assert.equal(fim.usosDeFerramenta, 1)
    assert.equal(fim.texto, 'Dono: recente 1\n\nDono: recente 2')
  })

  it('a linha partida no começo da janela é descartada mesmo quando o pedaço é JSON válido', () => {
    const escondida = JSON.stringify(dono('escondido'))
    const visivel = JSON.stringify(dono('visível'))
    // A primeira linha é "x" + um JSON inteiro: a janela começa logo depois do "x".
    const caminho = arquivo([`x${escondida}`, visivel])
    const fim = lerFimDaConversa(caminho, 8000, Buffer.byteLength(`${escondida}\n${visivel}\n`))
    assert.equal(fim.texto, 'Dono: visível')
  })

  it('última linha completa sem quebra de linha no fim conta, também com a janela menor que o arquivo', () => {
    const caminho = arquivo([dono('antigo'), dono('primeiro'), ferramenta(), dono('último sem quebra')], '')
    assert.equal(lerFimDaConversa(caminho, 8000).pedidosDoDono, 3)
    const janela = Buffer.byteLength(`${JSON.stringify(dono('primeiro'))}\n${JSON.stringify(ferramenta())}\n${JSON.stringify(dono('último sem quebra'))}`)
    const fim = lerFimDaConversa(caminho, 8000, janela)
    assert.equal(fim.pedidosDoDono, 2)
    assert.equal(fim.texto, 'Dono: primeiro\n\nDono: último sem quebra')
  })

  it('janela que começa exatamente no começo de uma linha não perde essa linha', () => {
    const primeira = JSON.stringify(dono('primeira'))
    const segunda = JSON.stringify(dono('segunda'))
    const caminho = arquivo([primeira, segunda])
    const tamanho = Buffer.byteLength(`${primeira}\n${segunda}\n`)
    assert.equal(lerFimDaConversa(caminho, 8000, tamanho).pedidosDoDono, 2)
    assert.equal(lerFimDaConversa(caminho, 8000, tamanho - 1).pedidosDoDono, 1)
    assert.equal(lerFimDaConversa(caminho, 8000, Buffer.byteLength(`\n${segunda}\n`)).pedidosDoDono, 1)
  })

  it('linha enorme (imagem) no meio não atrapalha a contagem das outras', () => {
    const imagem = { type: 'user', message: { content: [{ type: 'image', source: { data: 'A'.repeat(2_000_000) } }] } }
    const caminho = arquivo([dono('antes'), imagem, ferramenta(), dono('depois')])
    const fim = lerFimDaConversa(caminho, 8000)
    assert.equal(fim.pedidosDoDono, 2)
    assert.equal(fim.usosDeFerramenta, 1)
    assert.equal(fim.texto, 'Dono: antes\n\nDono: depois')
  })

  it('acentos atravessam a leitura intactos, mesmo com a janela partindo um caractere', () => {
    const caminho = arquivo([dono('ação'), dono('decisões não')])
    appendFileSync(caminho, '')
    const fim = lerFimDaConversa(caminho, 8000)
    assert.equal(fim.texto, 'Dono: ação\n\nDono: decisões não')
    const segunda = Buffer.byteLength(`${JSON.stringify(dono('decisões não'))}\n`)
    const partida = lerFimDaConversa(caminho, 8000, segunda + 2)
    assert.equal(partida.texto, 'Dono: decisões não')
    assert.ok(!partida.texto.includes('�'))
  })

  it('janela padrão de 8 MiB', () => {
    assert.equal(JANELA_PADRAO_BYTES, 8 * 1024 * 1024)
  })
})

describe('cortar sem partir palavra', () => {
  it('cortarInicioSemPartir guarda o começo e para antes da palavra que não coube', () => {
    assert.equal(cortarInicioSemPartir('curto', 10), 'curto')
    assert.equal(cortarInicioSemPartir('exato', 5), 'exato')
    assert.equal(cortarInicioSemPartir('ab cd', 5), 'ab cd')
    assert.equal(cortarInicioSemPartir('uma frase longa demais', 12), 'uma frase')
    assert.equal(cortarInicioSemPartir('uma frase longa', 9), 'uma frase')
    assert.equal(cortarInicioSemPartir('uma frase  longa', 10), 'uma frase')
    assert.equal(cortarInicioSemPartir('palavragigante', 5), 'palav')
    // O pedaço termina num espaço e a palavra seguinte não coube: para no espaço.
    assert.equal(cortarInicioSemPartir('ab cd', 3), 'ab')
    // Dois espaços antes da palavra partida: nenhum fica sobrando no fim.
    assert.equal(cortarInicioSemPartir('uma  frase', 7), 'uma')
  })

  it('cortarFimSemPartir guarda o fim e começa depois da palavra que não coube', () => {
    assert.equal(cortarFimSemPartir('curto', 10), 'curto')
    assert.equal(cortarFimSemPartir('exato', 5), 'exato')
    assert.equal(cortarFimSemPartir('ab cd', 5), 'ab cd')
    assert.equal(cortarFimSemPartir('uma frase longa demais', 11), 'demais')
    assert.equal(cortarFimSemPartir('uma frase longa demais', 12), 'longa demais')
    assert.equal(cortarFimSemPartir('uma frase longa', 5), 'longa')
    assert.equal(cortarFimSemPartir('uma frase  longa', 6), 'longa')
    assert.equal(cortarFimSemPartir('palavragigante', 5), 'gante')
    // O corte cai logo depois de uma palavra inteira, antes de dois espaços: nenhum fica no começo.
    assert.equal(cortarFimSemPartir('abc  de', 4), 'de')
    // O corte cai entre dois espaços.
    assert.equal(cortarFimSemPartir('ab  cd', 3), 'cd')
  })
})

/** O menor descritor livre agora: se algo vazou, o próximo `open` devolve um número maior. */
function proximoDescritorLivre(caminho: string): number {
  const fd = openSync(caminho, 'r')
  closeSync(fd)
  return fd
}
