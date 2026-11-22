import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { lerMarkdown, lerTrechos } from '../src/texto/markdown.ts'

describe('lerTrechos: texto dentro da linha', () => {
  it('texto simples é um trecho só', () => {
    assert.deepEqual(lerTrechos('olá mundo'), [{ tipo: 'texto', texto: 'olá mundo' }])
    assert.deepEqual(lerTrechos(''), [])
  })
  it('negrito, itálico e código se separam do texto em volta', () => {
    assert.deepEqual(lerTrechos('**Servidor:** Node e `tsx` são *rápidos*'), [
      { tipo: 'negrito', texto: 'Servidor:' },
      { tipo: 'texto', texto: ' Node e ' },
      { tipo: 'codigo', texto: 'tsx' },
      { tipo: 'texto', texto: ' são ' },
      { tipo: 'italico', texto: 'rápidos' },
    ])
  })
  it('marca sem fecho continua como texto, do jeito que veio', () => {
    assert.deepEqual(lerTrechos('**sem fim'), [{ tipo: 'texto', texto: '**sem fim' }])
    assert.deepEqual(lerTrechos('`aberto'), [{ tipo: 'texto', texto: '`aberto' }])
    assert.deepEqual(lerTrechos('um *solto'), [{ tipo: 'texto', texto: 'um *solto' }])
    assert.deepEqual(lerTrechos('a `` b'), [{ tipo: 'texto', texto: 'a `` b' }])
  })
  it('asterisco de conta (com espaços) não vira itálico', () => {
    assert.deepEqual(lerTrechos('2 * 3 * 4'), [{ tipo: 'texto', texto: '2 * 3 * 4' }])
    assert.deepEqual(lerTrechos('** x**'), [{ tipo: 'texto', texto: '** x**' }])
    assert.deepEqual(lerTrechos('**x **'), [{ tipo: 'texto', texto: '**x **' }])
  })
  it('asteriscos colados em sequência não formam marca dupla por engano', () => {
    assert.deepEqual(lerTrechos('*a**b*'), [{ tipo: 'texto', texto: '*a**b*' }])
    assert.deepEqual(lerTrechos('**a *b* c**'), [{ tipo: 'negrito', texto: 'a *b* c' }])
  })
  it('marca vazia (nada entre as duas) não vira negrito', () => {
    assert.deepEqual(lerTrechos('a **** b'), [{ tipo: 'texto', texto: 'a **** b' }])
  })
  it('sublinhado entre palavras (snake_case) nunca vira marca', () => {
    assert.deepEqual(lerTrechos('use nome_do_agente aqui'), [{ tipo: 'texto', texto: 'use nome_do_agente aqui' }])
  })
  it('HTML, links e imagens ficam como texto cru (e o desenho escapa)', () => {
    assert.deepEqual(lerTrechos('<script>alert(1)</script>'), [{ tipo: 'texto', texto: '<script>alert(1)</script>' }])
    assert.deepEqual(lerTrechos('<img src=x onerror=alert(1)>'), [{ tipo: 'texto', texto: '<img src=x onerror=alert(1)>' }])
    assert.deepEqual(lerTrechos('[clique](javascript:alert(1))'), [{ tipo: 'texto', texto: '[clique](javascript:alert(1))' }])
  })
  it('HTML dentro de negrito e de código continua texto', () => {
    assert.deepEqual(lerTrechos('**<b>x</b>**'), [{ tipo: 'negrito', texto: '<b>x</b>' }])
    assert.deepEqual(lerTrechos('`<script>`'), [{ tipo: 'codigo', texto: '<script>' }])
  })
})

describe('lerMarkdown: blocos', () => {
  it('título de cada nível, com o negrito dentro', () => {
    assert.deepEqual(lerMarkdown('# Arquitetura\n### Servidor **forte**'), [
      { tipo: 'titulo', nivel: 1, trechos: [{ tipo: 'texto', texto: 'Arquitetura' }] },
      { tipo: 'titulo', nivel: 3, trechos: [{ tipo: 'texto', texto: 'Servidor ' }, { tipo: 'negrito', texto: 'forte' }] },
    ])
    assert.equal((lerMarkdown('###### seis')[0] as { nivel: number }).nivel, 6)
  })
  it('#sem espaço, e sete #, não são título', () => {
    assert.deepEqual(lerMarkdown('#semespaco'), [{ tipo: 'paragrafo', trechos: [{ tipo: 'texto', texto: '#semespaco' }] }])
    assert.deepEqual(lerMarkdown('####### sete')[0]?.tipo, 'paragrafo')
  })
  it('título aceita # de fechamento', () => {
    assert.deepEqual(lerMarkdown('## Fim ##'), [{ tipo: 'titulo', nivel: 2, trechos: [{ tipo: 'texto', texto: 'Fim' }] }])
  })
  it('linhas seguidas formam um parágrafo; linha em branco separa', () => {
    assert.deepEqual(lerMarkdown('um\ndois\n\ntrês'), [
      { tipo: 'paragrafo', trechos: [{ tipo: 'texto', texto: 'um dois' }] },
      { tipo: 'paragrafo', trechos: [{ tipo: 'texto', texto: 'três' }] },
    ])
  })
  it('lista com marcador e lista numerada', () => {
    assert.deepEqual(lerMarkdown('- a\n- **b**\n* c'), [
      { tipo: 'lista', numerada: false, itens: [[{ tipo: 'texto', texto: 'a' }], [{ tipo: 'negrito', texto: 'b' }], [{ tipo: 'texto', texto: 'c' }]] },
    ])
    assert.deepEqual(lerMarkdown('1. um\n2) dois'), [
      { tipo: 'lista', numerada: true, itens: [[{ tipo: 'texto', texto: 'um' }], [{ tipo: 'texto', texto: 'dois' }]] },
    ])
  })
  it('lista termina quando o padrão muda, e um tipo de lista não engole o outro', () => {
    const blocos = lerMarkdown('- a\n1. b\ntexto')
    assert.deepEqual(blocos.map(b => b.tipo), ['lista', 'lista', 'paragrafo'])
  })
  it('lista interrompe um parágrafo', () => {
    assert.deepEqual(lerMarkdown('antes\n- item').map(b => b.tipo), ['paragrafo', 'lista'])
  })
  it('bloco de código guarda o texto cru, com a linguagem, e não lê marcas dentro', () => {
    assert.deepEqual(lerMarkdown('```ts\nconst a = **b**;\n# não é título\n```\ndepois'), [
      { tipo: 'codigo', linguagem: 'ts', texto: 'const a = **b**;\n# não é título' },
      { tipo: 'paragrafo', trechos: [{ tipo: 'texto', texto: 'depois' }] },
    ])
  })
  it('cerca sem fechamento vai até o fim do texto', () => {
    assert.deepEqual(lerMarkdown('```\nabre\nsem fim'), [{ tipo: 'codigo', linguagem: '', texto: 'abre\nsem fim' }])
  })
  it('cerca interrompe um parágrafo', () => {
    assert.deepEqual(lerMarkdown('antes\n```\ncodigo\n```').map(b => b.tipo), ['paragrafo', 'codigo'])
  })
  it('citação junta as linhas com > e a linha divisória é um bloco', () => {
    assert.deepEqual(lerMarkdown('> uma\n> duas\n---\ntexto'), [
      { tipo: 'citacao', trechos: [{ tipo: 'texto', texto: 'uma duas' }] },
      { tipo: 'divisoria' },
      { tipo: 'paragrafo', trechos: [{ tipo: 'texto', texto: 'texto' }] },
    ])
    assert.deepEqual(lerMarkdown('***'), [{ tipo: 'divisoria' }])
    assert.deepEqual(lerMarkdown('> x').length, 1)
  })
  it('citação interrompe um parágrafo', () => {
    assert.deepEqual(lerMarkdown('antes\n> citado').map(b => b.tipo), ['paragrafo', 'citacao'])
  })
  it('quebras do Windows valem como as do Unix; texto vazio não tem blocos', () => {
    assert.deepEqual(lerMarkdown('# a\r\n\r\nb'), [
      { tipo: 'titulo', nivel: 1, trechos: [{ tipo: 'texto', texto: 'a' }] },
      { tipo: 'paragrafo', trechos: [{ tipo: 'texto', texto: 'b' }] },
    ])
    assert.deepEqual(lerMarkdown(''), [])
    assert.deepEqual(lerMarkdown('\n\n  \n'), [])
  })
  it('documento hostil: nada vira marcação, tudo vira texto', () => {
    const blocos = lerMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n- <b>x</b>')
    assert.deepEqual(blocos[0], { tipo: 'paragrafo', trechos: [{ tipo: 'texto', texto: '<script>alert(1)</script>' }] })
    assert.deepEqual(blocos[1], { tipo: 'paragrafo', trechos: [{ tipo: 'texto', texto: '<img src=x onerror=alert(1)>' }] })
    assert.deepEqual(blocos[2], { tipo: 'lista', numerada: false, itens: [[{ tipo: 'texto', texto: '<b>x</b>' }]] })
  })
})

describe('tempo em texto grande', () => {
  // Leitura linear: 300 ms de folga. Sob mutação (código instrumentado, dois processos ao mesmo tempo) o relógio
  // fica mais lento; o defeito que isto guarda levava 97 s, então 3 s ainda o pega com folga.
  const LIMITE = '__STRYKER_ACTIVE_MUTANT__' in process.env ? 3000 : 300
  const medir = (texto: string) => { const t0 = performance.now(); lerMarkdown(texto); return performance.now() - t0 }
  it('200 mil caracteres de "*a " leem em menos de 300 ms (3 s sob mutação)', () => {
    assert.ok(medir('*a '.repeat(66_667)) < LIMITE)
  })
  it('200 mil caracteres de "**/*.ts " leem em menos de 300 ms (3 s sob mutação)', () => {
    assert.ok(medir('**/*.ts '.repeat(25_000)) < LIMITE)
  })
  it('o mesmo texto repetido com fechos de verdade continua lendo em tempo curto e com o mesmo resultado', () => {
    const texto = '*a* **b** '.repeat(20_000)
    const t0 = performance.now()
    const blocos = lerMarkdown(texto)
    assert.ok(performance.now() - t0 < LIMITE)
    const primeiro = blocos[0]
    assert.equal(primeiro?.tipo, 'paragrafo')
    if (primeiro?.tipo === 'paragrafo') assert.deepEqual(primeiro.trechos.slice(0, 3), [{ tipo: 'italico', texto: 'a' }, { tipo: 'texto', texto: ' ' }, { tipo: 'negrito', texto: 'b' }])
  })
})

describe('lerMarkdown: cada regra da leitura, nas bordas', () => {
  const unico = (texto: string) => lerMarkdown(texto)
  const para = (texto: string) => [{ tipo: 'paragrafo', trechos: [{ tipo: 'texto', texto }] }]
  const t = (texto: string) => ({ tipo: 'texto', texto })

  it('título com mais de um espaço depois do # não leva o espaço para o texto', () => {
    assert.deepEqual(unico('#  Dois espaços'), [{ tipo: 'titulo', nivel: 1, trechos: [t('Dois espaços')] }])
  })
  it('lista com marcador: vários espaços depois do marcador, e caractere estranho no fim da linha, não viram item', () => {
    assert.deepEqual(unico('-   três espaços'), [{ tipo: 'lista', numerada: false, itens: [[t('três espaços')]] }])
    assert.deepEqual(unico('- item resto'), [{ tipo: 'lista', numerada: false, itens: [[t('item resto')]] }])
  })
  it('lista numerada: só no começo da linha, com um ou mais dígitos, e com o espaço que sobrar fora do item', () => {
    assert.deepEqual(unico('versão 2. nova'), para('versão 2. nova'))
    assert.deepEqual(unico('a1. coisa'), para('a1. coisa'))
    assert.deepEqual(unico('10. dez'), [{ tipo: 'lista', numerada: true, itens: [[t('dez')]] }])
    assert.deepEqual(unico('1.   item'), [{ tipo: 'lista', numerada: true, itens: [[t('item')]] }])
    assert.deepEqual(unico('  3) recuado'), [{ tipo: 'lista', numerada: true, itens: [[t('recuado')]] }])
    assert.deepEqual(unico('1. item resto'), [{ tipo: 'lista', numerada: true, itens: [[t('item resto')]] }])
  })
  it('linha divisória: só ela na linha, com ou sem espaços nas pontas', () => {
    assert.deepEqual(unico('abc ---'), para('abc ---'))
    assert.deepEqual(unico('abc---'), para('abc---'))
    assert.deepEqual(unico('---abc'), para('---abc'))
    assert.deepEqual(unico('-a-a-'), para('-a-a-'))
    assert.deepEqual(unico('---   '), [{ tipo: 'divisoria' }])
    assert.deepEqual(unico('  - - -'), [{ tipo: 'divisoria' }])
  })
  it('citação: o espaço depois do > é opcional, e caractere estranho no fim da linha não a transforma', () => {
    assert.deepEqual(unico('>colado'), [{ tipo: 'citacao', trechos: [t('colado')] }])
    assert.deepEqual(unico('> com espaço'), [{ tipo: 'citacao', trechos: [t('com espaço')] }])
    assert.deepEqual(unico('> a b'), para('> a b'))
  })
  it('bloco de código: a linguagem sem espaços nas pontas, cerca recuada abre e fecha, ``` no fim de uma linha não fecha', () => {
    assert.deepEqual(unico('```  js  \nx\n```'), [{ tipo: 'codigo', linguagem: 'js', texto: 'x' }])
    assert.deepEqual(unico('  ```js\nx\n  ```'), [{ tipo: 'codigo', linguagem: 'js', texto: 'x' }])
    assert.deepEqual(unico('```\na```\nb\n```'), [{ tipo: 'codigo', linguagem: '', texto: 'a```\nb' }])
  })
  it('quebra de linha antiga (só \r) também separa as linhas', () => {
    assert.deepEqual(unico('a\rb'), para('a b'))
    assert.deepEqual(unico('a\r\nb'), para('a b'))
  })
  it('parágrafo: espaços nas pontas de cada linha não entram na junção', () => {
    assert.deepEqual(unico('  a  \n  b  '), para('a b'))
  })
  it('linha só com espaços separa parágrafos', () => {
    assert.deepEqual(unico('a\n   \nb'), [...para('a'), ...para('b')])
  })
  it('lista que vai até a última linha do texto e a que é seguida por outro bloco', () => {
    assert.deepEqual(unico('- a\n- b'), [{ tipo: 'lista', numerada: false, itens: [[t('a')], [t('b')]] }])
    assert.deepEqual(unico('- a\n- b\ntexto'), [{ tipo: 'lista', numerada: false, itens: [[t('a')], [t('b')]] }, ...para('texto')])
  })
})

describe('lerMarkdown: título, sem retrocesso e com as mesmas bordas', () => {
  const t = (texto: string) => ({ tipo: 'texto', texto })
  const titulo = (texto: string) => [{ tipo: 'titulo', nivel: 1, trechos: [t(texto)] }]
  it('espaços e # no fim do título não entram no texto', () => {
    assert.deepEqual(lerMarkdown('# a ## '), titulo('a'))
    assert.deepEqual(lerMarkdown('# a#'), titulo('a'))
    assert.deepEqual(lerMarkdown('# a   '), titulo('a'))
    assert.deepEqual(lerMarkdown('# a # b #'), titulo('a # b'))
  })
  it('título feito só de # guarda o primeiro, como sempre', () => {
    assert.deepEqual(lerMarkdown('# ###'), titulo('#'))
  })
  it('quebra de linha estranha no meio do título (U+2028) não o transforma em título', () => {
    assert.deepEqual(lerMarkdown('# a b'), [{ tipo: 'paragrafo', trechos: [t('# a b')] }])
  })
  it('título vazio não é título', () => {
    assert.deepEqual(lerMarkdown('#   '), [{ tipo: 'paragrafo', trechos: [t('#')] }])
  })
})

describe('lerMarkdown: linhas hostis (muitos espaços e depois algo que não casa) leem em tempo curto', () => {
  const LIMITE = '__STRYKER_ACTIVE_MUTANT__' in process.env ? 3000 : 300
  const sp = ' '.repeat(50_000)
  const casos: Record<string, string> = {
    titulo: '# a' + sp + 'b',
    tituloComQuebraEstranha: '# ' + sp + 'a b',
    tituloComHashes: '# a' + sp + '#' + sp + 'x',
    marcador: '-' + sp + 'a b',
    marcadorVazio: '-' + sp,
    numerado: '1.' + sp + 'a b',
    numeradoQuebrado: '1' + sp + 'x',
    citacao: '>' + sp + 'a b',
    divisoria: '-' + sp + 'a',
    divisoriaRepetida: '- '.repeat(25_000) + 'a',
  }
  for (const [nome, texto] of Object.entries(casos)) {
    it(nome, () => {
      const t0 = performance.now()
      lerMarkdown(texto)
      assert.ok(performance.now() - t0 < LIMITE)
    })
  }
})
