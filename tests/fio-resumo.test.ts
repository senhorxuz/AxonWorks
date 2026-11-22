import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { daquiEmDiante, fraseDoFio, rotuloAcessivelDoFio, simbolosDaMiniatura } from '../src/fio/resumo.ts'
import type { CoisaFeita } from '../src/fio/coisas.ts'
import type { Carta } from '../shared/carta.ts'

let k = 0
const diaN = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString().slice(0, 10)
const coisa = (dia: string, quem: string | null = 'Claude', extra: Partial<CoisaFeita> = {}): CoisaFeita => {
  k++
  return { chave: `registro:${k}`, quando: `${dia}T12:00:00Z`, tipo: 'registro', texto: `t${k}`, ...(quem !== null ? { quem } : {}), ...extra }
}

/** 28 coisas em 9 dias de trabalho, ao longo de 68 dias (de 1/10 a 7/12), com 3 IAs. */
function projetoCheio(): CoisaFeita[] {
  const dias = [1, 2, 3, 4, 11, 21, 31, 51, 68]
  const ias = ['Claude', 'Codex', 'Fundacao']
  return Array.from({ length: 28 }, (_, i) => coisa(diaN(dias[i % dias.length]!), ias[i % 3]))
}

describe('fraseDoFio: os números contam o projeto inteiro', () => {
  it('28 coisas feitas em 9 dias de trabalho, ao longo de 68. Passou por 3 IAs.', () => {
    assert.deepEqual(fraseDoFio(projetoCheio()), { coisas: '28 coisas feitas', resto: ' em 9 dias de trabalho, ao longo de 68.', ias: 'Passou por 3 IAs.' })
  })

  it('"1 coisa feita", "1 dia", e sem "ao longo de" quando os dias de trabalho são todos', () => {
    assert.deepEqual(fraseDoFio([coisa(diaN(5))]), { coisas: '1 coisa feita', resto: ' em 1 dia de trabalho.', ias: 'Sempre com a mesma IA.' })
    assert.equal(fraseDoFio([coisa(diaN(5)), coisa(diaN(6)), coisa(diaN(7))]).resto, ' em 3 dias de trabalho.')
  })

  it('a ordem das coisas não importa para os dias', () => {
    assert.equal(fraseDoFio([coisa(diaN(20)), coisa(diaN(1)), coisa(diaN(10))]).resto, ' em 3 dias de trabalho, ao longo de 20.')
  })

  it('"Sempre com a mesma IA." com uma família só, mesmo com nomes diferentes', () => {
    assert.equal(fraseDoFio([coisa(diaN(1), 'Claude Opus'), coisa(diaN(2), 'claude-sonnet')]).ias, 'Sempre com a mesma IA.')
  })

  it('sem IA com nome (só "Sem nome" ou dono), a parte das IAs fica vazia', () => {
    assert.equal(fraseDoFio([coisa(diaN(1), null), coisa(diaN(2), null, { peloDono: true })]).ias, '')
  })

  it('"Sem nome" não conta como IA', () => {
    assert.equal(fraseDoFio([coisa(diaN(1), null), coisa(diaN(2), 'Claude')]).ias, 'Sempre com a mesma IA.')
    assert.equal(fraseDoFio([coisa(diaN(1), null), coisa(diaN(2), 'Claude'), coisa(diaN(3), 'Codex')]).ias, 'Passou por 2 IAs.')
  })

  it('sem coisas, a frase que já existe hoje', () => {
    assert.deepEqual(fraseDoFio([]), { coisas: 'Nada feito ainda: o fio começa no primeiro registro', resto: '', ias: '' })
  })
})

describe('rotuloAcessivelDoFio', () => {
  it('resume tudo para o leitor de tela, com o dia de onde paramos', () => {
    assert.equal(rotuloAcessivelDoFio(projetoCheio()), '28 coisas feitas em 9 dias, passou por 3 IAs; onde paramos: 7 dez')
  })

  it('uma IA só, e uma coisa só', () => {
    assert.equal(rotuloAcessivelDoFio([coisa('2026-11-21')]), '1 coisa feita em 1 dia, sempre com a mesma IA; onde paramos: 21 nov')
  })

  it('sem IA com nome, a parte das IAs some', () => {
    assert.equal(rotuloAcessivelDoFio([coisa('2026-11-05', null)]), '1 coisa feita em 1 dia; onde paramos: 5 nov')
  })

  it('onde paramos é a coisa mais nova, mesmo fora de ordem; usa o dia de São Paulo', () => {
    const r = rotuloAcessivelDoFio([coisa('2026-11-21', 'Claude', { quando: '2026-11-22T02:00:00Z' }), coisa('2026-11-10', 'Claude')])
    assert.equal(r, '2 coisas feitas em 2 dias, sempre com a mesma IA; onde paramos: 21 nov')
  })

  it('sem coisas', () => {
    assert.equal(rotuloAcessivelDoFio([]), 'Nada feito ainda: o fio começa no primeiro registro')
  })
})

describe('daquiEmDiante', () => {
  const itens = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) })) as unknown as Carta['falta']['ideias']
  const falta = (extra: Partial<Carta['falta']> = {}): Carta['falta'] => ({ precisa_de_voce: [], travado: [], em_andamento: [], a_fazer: [], ideias: [], ...extra })

  it('lista vazia sem pendência', () => {
    assert.deepEqual(daquiEmDiante(falta()), [])
  })

  it('só os grupos com itens, na ordem de urgência, com quantidade e texto', () => {
    const r = daquiEmDiante(falta({ ideias: itens(2), precisa_de_voce: itens(3), a_fazer: itens(10), em_andamento: itens(2) }))
    assert.deepEqual(r, [
      { grupo: 'precisa_de_voce', quantidade: 3, texto: '3 precisam de você', pede: true },
      { grupo: 'em_andamento', quantidade: 2, texto: '2 em andamento', pede: false },
      { grupo: 'a_fazer', quantidade: 10, texto: '10 a fazer', pede: false },
      { grupo: 'ideias', quantidade: 2, texto: '2 ideias', pede: false },
    ])
  })

  it('singular: "1 precisa de você", "1 ideia", "1 travado"', () => {
    const r = daquiEmDiante(falta({ precisa_de_voce: itens(1), travado: itens(1), ideias: itens(1) }))
    assert.deepEqual(r.map(g => g.texto), ['1 precisa de você', '1 travado', '1 ideia'])
  })

  it('plural de travado; "em andamento" e "a fazer" não mudam', () => {
    const r = daquiEmDiante(falta({ travado: itens(2), em_andamento: itens(1), a_fazer: itens(1) }))
    assert.deepEqual(r.map(g => g.texto), ['2 travados', '1 em andamento', '1 a fazer'])
  })
})

describe('simbolosDaMiniatura', () => {
  it('0 versões: só o início', () => {
    assert.equal(simbolosDaMiniatura(0), '├')
  })

  it('1 versão: ├◉; 3 versões: ├○○◉', () => {
    assert.equal(simbolosDaMiniatura(1), '├◉')
    assert.equal(simbolosDaMiniatura(3), '├○○◉')
  })

  it('no máximo 8 símbolos depois do início', () => {
    assert.equal(simbolosDaMiniatura(8), '├○○○○○○○◉')
    assert.equal(simbolosDaMiniatura(30), '├○○○○○○○◉')
    assert.equal([...simbolosDaMiniatura(30)].length, 9)
  })

  it('valor que não faz sentido vira só o início', () => {
    assert.equal(simbolosDaMiniatura(-4), '├')
    assert.equal(simbolosDaMiniatura(Number.NaN), '├')
  })
})
