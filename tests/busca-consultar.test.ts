import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  expressaoFts,
  formasDoTermo,
  LIMITE_MAXIMO,
  LIMITE_PADRAO,
  PESOS,
  paraResultado,
  termosDaConsulta,
  TERMOS_MAXIMOS,
  TIPOS_DA_MEMORIA,
  TITULO_MAXIMO,
  tituloCurto,
  TRECHO_MAXIMO,
  trecho,
  trechoDoResultado,
  validarBusca,
  type Candidato,
} from '../server/busca/consultar.ts'
import { DomainError } from '../server/store/errors.ts'

/**
 * Busca na memória (D7), parte pura: o que o usuário digita vira só palavras (nunca sintaxe FTS crua),
 * cada palavra vira um grupo de formas (o próprio termo como começo de palavra, mais o plural ou o
 * singular que o prefixo não alcança), o trecho mostra o primeiro termo encontrado sem cortar palavra.
 */

function recusa(campo: string) {
  return (erro: unknown) =>
    erro instanceof DomainError && erro.status === 400 && erro.code === 'invalid_input' && erro.message.includes(campo)
}

describe('termos da consulta: só palavras, sem acento e sem caixa', () => {
  it('tira acento e caixa e separa nas não-letras', () => {
    assert.deepEqual(termosDaConsulta('Decisão  de LOGIN'), ['decisao', 'de', 'login'])
    assert.deepEqual(termosDaConsulta('ÇÃO à'), ['cao', 'a'])
  })

  it('acento em forma decomposta (NFD) vira a mesma palavra', () => {
    assert.deepEqual(termosDaConsulta('decisão'), ['decisao'])
  })

  it('operadores e símbolos da sintaxe FTS viram texto ou somem', () => {
    assert.deepEqual(termosDaConsulta('"aspas" AND (x OR y) NOT z NEAR(a b) -menos titulo:valor ^c compact* {a}'), [
      'aspas', 'and', 'x', 'or', 'y', 'not', 'z', 'near', 'a', 'b', 'menos', 'titulo', 'valor', 'c', 'compact', 'a',
    ])
  })

  it('emoji, pontuação e só espaços: nenhuma palavra', () => {
    assert.deepEqual(termosDaConsulta('🚀 ✅ 🔥'), [])
    assert.deepEqual(termosDaConsulta('   \t\n  '), [])
    assert.deepEqual(termosDaConsulta(''), [])
    assert.deepEqual(termosDaConsulta('"*-():^'), [])
    assert.deepEqual(termosDaConsulta('🚀deploy✅'), ['deploy'])
  })

  it('números contam como palavra, inteiros', () => {
    assert.deepEqual(termosDaConsulta('D7 v2.10 2026'), ['d7', 'v2', '10', '2026'])
  })

  it(`no máximo ${TERMOS_MAXIMOS} palavras: as primeiras`, () => {
    const palavras = Array.from({ length: TERMOS_MAXIMOS + 3 }, (_, i) => `p${i}`)
    assert.equal(TERMOS_MAXIMOS, 16)
    assert.deepEqual(termosDaConsulta(palavras.join(' ')), palavras.slice(0, 16))
  })
})

describe('formas de cada termo: plural e singular que o prefixo não alcança', () => {
  for (const [termo, formas] of [
    ['decisoes', ['decisoes', 'decisao']],
    ['alemaes', ['alemaes', 'alemao']],
    ['irmaos', ['irmaos', 'irmao']],
    ['decisao', ['decisao', 'decisoes', 'decisaes', 'decisaos']],
    ['itens', ['itens', 'item']],
    ['item', ['item', 'itens']],
    ['finais', ['finais', 'final']],
    ['papeis', ['papeis', 'papel']],
    ['anzois', ['anzois', 'anzol']],
    ['final', ['final', 'finais']],
    ['papel', ['papel', 'papeis']],
    ['anzol', ['anzol', 'anzois']],
    ['flores', ['flores', 'flor']],
    ['felizes', ['felizes', 'feliz']],
    ['deuses', ['deuses', 'deus']],
    ['testes', ['testes', 'teste']],
    ['mais', ['mais', 'mai']],
  ] as const) {
    it(`${termo} → ${formas.join(', ')}`, () => {
      assert.deepEqual(formasDoTermo(termo), formas)
    })
  }

  it('raiz com menos de 3 letras não ganha forma nova', () => {
    assert.deepEqual(formasDoTermo('nao'), ['nao'])
    assert.deepEqual(formasDoTermo('com'), ['com'])
    assert.deepEqual(formasDoTermo('dos'), ['dos'])
    assert.deepEqual(formasDoTermo('s'), ['s'])
  })

  it('palavra sem final conhecido fica só com ela mesma', () => {
    assert.deepEqual(formasDoTermo('login'), ['login'])
    assert.deepEqual(formasDoTermo('a'), ['a'])
  })
})

describe('expressão FTS: cada palavra é um grupo de prefixos entre aspas, todos obrigatórios', () => {
  it('uma palavra', () => {
    assert.equal(expressaoFts(['login']), '("login"*)')
  })

  it('várias palavras: E entre os grupos, OU entre as formas', () => {
    assert.equal(
      expressaoFts(['decisao', 'login']),
      '("decisao"* OR "decisoes"* OR "decisaes"* OR "decisaos"*) AND ("login"*)',
    )
  })

  it('operador digitado vira palavra entre aspas', () => {
    assert.equal(expressaoFts(termosDaConsulta('NOT near')), '("not"*) AND ("near"*)')
  })
})

describe('validação da busca', () => {
  it('padrões: 10 resultados e todos os tipos, na ordem fixa', () => {
    assert.deepEqual(validarBusca({ query: 'Login' }), { termos: ['login'], limite: LIMITE_PADRAO, tipos: [...TIPOS_DA_MEMORIA] })
    assert.equal(LIMITE_PADRAO, 10)
    assert.deepEqual(TIPOS_DA_MEMORIA, [
      'licao', 'decisao', 'diretriz', 'cartao', 'backlog', 'bloqueio', 'checkpoint', 'mensagem', 'biblioteca',
    ])
  })

  it('consulta sem palavra é válida e não tem termos', () => {
    assert.deepEqual(validarBusca({ query: '   ' }).termos, [])
  })

  it('limit de 1 a 50', () => {
    assert.equal(validarBusca({ query: 'x', limit: 1 }).limite, 1)
    assert.equal(validarBusca({ query: 'x', limit: LIMITE_MAXIMO }).limite, 50)
    for (const limit of [0, 51, 2.5, '10', null, -1]) {
      assert.throws(() => validarBusca({ query: 'x', limit }), recusa('Campo limit inválido. Use um número inteiro de 1 a 50.'))
    }
  })

  it('tipos: só os conhecidos, na ordem fixa; lista vazia = todos', () => {
    assert.deepEqual(validarBusca({ query: 'x', tipos: ['mensagem', 'licao'] }).tipos, ['licao', 'mensagem'])
    assert.deepEqual(validarBusca({ query: 'x', tipos: [] }).tipos, [...TIPOS_DA_MEMORIA])
    for (const tipos of [['licao', 'tarefa'], 'licao', [1], null]) {
      assert.throws(() => validarBusca({ query: 'x', tipos }), recusa(`Campo tipos inválido. Use: ${TIPOS_DA_MEMORIA.join(', ')}.`))
    }
  })

  it('query precisa ser texto; a entrada precisa ser um objeto', () => {
    for (const query of [undefined, 1, null, ['x']]) {
      assert.throws(() => validarBusca({ query }), recusa('Campo query inválido.'))
    }
    assert.throws(() => validarBusca('login'), recusa('busca'))
  })
})

describe('trecho: até o máximo, centrado no primeiro termo, sem cortar palavra', () => {
  const TEXTO = 'aaaa bbbb cccc dddd eeee ffff gggg'

  it('texto curto volta inteiro, com os espaços juntados', () => {
    assert.equal(trecho('  curto \n\t texto  ', ['curto']), 'curto texto')
    assert.equal(trecho('x'.repeat(20), ['x'], 20), 'x'.repeat(20))
  })

  it('termo no meio: reticências nas duas pontas', () => {
    assert.equal(trecho(TEXTO, ['dddd'], 20), '…cccc dddd eeee…')
    assert.equal(trecho(TEXTO, ['cccc'], 20), '…bbbb cccc dddd…')
  })

  it('termo no começo: sem reticência no início; no fim: sem reticência no fim', () => {
    assert.equal(trecho(TEXTO, ['aaaa'], 20), 'aaaa bbbb cccc…')
    assert.equal(trecho(TEXTO, ['gggg'], 20), '…eeee ffff gggg')
  })

  it('termo ausente: começo do texto', () => {
    assert.equal(trecho(TEXTO, ['zzz'], 20), 'aaaa bbbb cccc…')
  })

  it('a palavra que cabe exatamente entra; a que passa de um caractere fica de fora', () => {
    // espaço útil de 18 (20 menos as duas reticências): "bbbb cccccccc dddd" tem 18.
    assert.equal(trecho('aaaa bbbb cccccccc dddd eeee ffff', ['cccc'], 20), '…bbbb cccccccc dddd…')
    assert.equal(trecho('aaaa bbbb cccccccc ddddd eeee ffff', ['cccc'], 20), 'aaaa bbbb cccccccc…')
  })

  it('empate de espaço: a palavra da esquerda entra primeiro', () => {
    assert.equal(trecho('aaaa bbbb cccc dddd eeee', ['cccc'], 12), '…bbbb cccc…')
  })

  it('palavra grande à esquerda: o espaço vai para a direita', () => {
    assert.equal(trecho(`${'x'.repeat(30)} alvo um dois tres quatro`, ['alvo'], 20), '…alvo um dois tres…')
  })

  it('palavra maior que o espaço: cortada, com reticências', () => {
    assert.equal(trecho('x'.repeat(50), ['x'], 20), `${'x'.repeat(18)}…`)
    assert.equal(trecho(`aa ${'x'.repeat(50)}`, ['x'], 20), `…${'x'.repeat(18)}…`)
  })

  it('acha o termo sem acento, sem caixa, como começo de palavra e dentro de pontuação', () => {
    const texto = `${'antes '.repeat(30)}(Compactação), ${'depois '.repeat(30)}`
    const resultado = trecho(texto, ['compact'])
    assert.ok(resultado.length <= TRECHO_MAXIMO, `${resultado.length}`)
    assert.equal(TRECHO_MAXIMO, 200)
    assert.match(resultado, /^….*\(Compactação\),.*…$/)
    const [esquerda, direita] = resultado.split('(Compactação),')
    assert.ok(Math.abs(esquerda.length - direita.length) <= 8, `${esquerda.length} x ${direita.length}`)
    for (const palavra of resultado.replaceAll('…', '').trim().split(' ')) {
      assert.ok(['antes', 'depois', '(Compactação),'].includes(palavra), palavra)
    }
  })

  it('o primeiro termo encontrado, de qualquer palavra da consulta', () => {
    const texto = `${'x '.repeat(60)}segundo ${'y '.repeat(60)}primeiro ${'z '.repeat(60)}`
    assert.match(trecho(texto, ['primeiro', 'segundo']), /segundo/)
    assert.doesNotMatch(trecho(texto, ['primeiro', 'segundo']), /primeiro/)
  })
})

describe('trecho do resultado e título curto', () => {
  it('termo no corpo: trecho do corpo', () => {
    assert.equal(trechoDoResultado('Título', 'corpo com login', ['login']), 'corpo com login')
  })

  it('termo só no título: título e corpo juntos', () => {
    assert.equal(trechoDoResultado('Login novo', 'corpo', ['login']), 'Login novo — corpo')
    assert.equal(trechoDoResultado('Login novo', '  ', ['login']), 'Login novo')
    assert.equal(trechoDoResultado('', 'corpo', ['login']), 'corpo')
  })

  it('título: o próprio; vazio, a primeira linha com texto do corpo', () => {
    assert.equal(tituloCurto('Título  da   decisão', 'corpo'), 'Título da decisão')
    assert.equal(tituloCurto('  ', '\n\n Primeira linha \nsegunda'), 'Primeira linha')
  })

  it(`título longo: cortado em ${TITULO_MAXIMO} no fim de palavra, com reticências`, () => {
    assert.equal(TITULO_MAXIMO, 120)
    const longo = 'palavra '.repeat(20).trim()
    const cortado = tituloCurto(longo, '')
    assert.equal(cortado, `${'palavra '.repeat(15).trim()}…`)
    assert.ok(cortado.length <= 120)
    assert.equal(tituloCurto('y'.repeat(130), ''), `${'y'.repeat(119)}…`)
    assert.equal(tituloCurto('z'.repeat(120), ''), 'z'.repeat(120))
    // O último espaço antes do limite (116) decide o corte, não o limite em si.
    assert.equal(tituloCurto('abcdefghijkl '.repeat(12).trim(), ''), `${'abcdefghijkl '.repeat(9).trim()}…`)
    // Espaço logo depois do limite não conta: a palavra de 120 letras é cortada em 119 mais a reticência.
    assert.equal(tituloCurto(`${'w'.repeat(120)} fim`, ''), `${'w'.repeat(119)}…`)
  })
})

describe('pesos e ordem', () => {
  it('pesos do D7', () => {
    assert.deepEqual(PESOS, {
      licao: 1.5,
      decisaoAceita: 1.4,
      diretriz: 1.3,
      cartao: 1,
      backlog: 1,
      bloqueio: 1,
      biblioteca: 1,
      decisaoProposta: 1,
      checkpoint: 0.9,
      mensagem: 0.8,
      encerrado: 0.5,
    })
  })

  it('resultado: tipo, id, título curto, data, trecho e pontuação com 4 algarismos', () => {
    const c: Candidato = { tipo: 'biblioteca', id: 'x1', data: '2026-02-01T00:00:00.000Z', pontuacao: 1.234567, linha: 9 }
    assert.deepEqual(paraResultado(c, { titulo: 'Guia', corpo: 'Como fazer login' }, ['login']), {
      tipo: 'biblioteca',
      id: 'x1',
      titulo: 'Guia',
      data: '2026-02-01T00:00:00.000Z',
      trecho: 'Como fazer login',
      pontuacao: 1.235,
    })
  })
})
