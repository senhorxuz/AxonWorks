import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LARGURA_DO_LIVRO, ALTURA_DO_LIVRO, LOMBADA, alturaDaPagina, livroAberto } from '../src/biblioteca/livro.ts'

// O livro aberto do hero da Biblioteca: geometria pura (páginas curvas, bloco de páginas, linhas de
// texto que acompanham a curva, fita marcadora e o lugar do ex-libris).

const numeros = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
const pontos = (d: string) => { const v = numeros(d); return Array.from({ length: v.length / 2 }, (_, i) => ({ x: v[2 * i]!, y: v[2 * i + 1]! })) }

describe('livro: a curva das páginas', () => {
  it('a página afunda junto à lombada e sobe para a borda de fora', () => {
    const vinco = alturaDaPagina(0, 0)
    const borda = alturaDaPagina(1, 0)
    assert.ok(vinco > borda, 'em cima, o vinco fica mais baixo que a borda')
    assert.ok(alturaDaPagina(0, 1) > alturaDaPagina(1, 1), 'embaixo também')
    assert.ok(alturaDaPagina(0.5, 1) > alturaDaPagina(0.5, 0), 'a base fica abaixo do topo')
  })

  it('uma linha a meia altura fica entre o topo e a base da página', () => {
    for (const u of [0, 0.3, 0.8, 1]) {
      const meio = alturaDaPagina(u, 0.5)
      assert.ok(meio > alturaDaPagina(u, 0) && meio < alturaDaPagina(u, 1))
    }
  })
})

describe('livro: o desenho', () => {
  it('o mesmo projeto desenha sempre o mesmo livro; outro projeto, outro texto', () => {
    assert.deepEqual(livroAberto('projeto-a'), livroAberto('projeto-a'))
    assert.notDeepEqual(livroAberto('projeto-a').linhas, livroAberto('projeto-b').linhas)
  })

  it('tudo cabe no desenho', () => {
    const l = livroAberto('projeto-a')
    const todos = [l.capa, l.paginaEsquerda, l.paginaDireita, l.sombra, l.fita, ...l.bordas, ...l.linhas.map(x => x.d)]
    for (const d of todos) {
      for (const p of pontos(d)) {
        assert.ok(p.x >= 0 && p.x <= LARGURA_DO_LIVRO && p.y >= 0 && p.y <= ALTURA_DO_LIVRO, `fora: ${p.x}, ${p.y}`)
      }
    }
  })

  it('as duas páginas têm texto; a esquerda abre com um título mais grosso', () => {
    const l = livroAberto('projeto-a')
    const esquerda = l.linhas.filter(x => x.pagina === 'esquerda')
    const direita = l.linhas.filter(x => x.pagina === 'direita')
    assert.ok(esquerda.length > 10 && direita.length > 6, `${esquerda.length} e ${direita.length}`)
    assert.equal(esquerda[0]!.tipo, 'titulo')
    assert.ok(l.linhas.filter(x => x.tipo === 'titulo').every(x => x.pagina === 'esquerda'))
  })

  it('o texto fica dentro da sua página, sem cruzar a lombada', () => {
    const l = livroAberto('projeto-a')
    for (const linha of l.linhas) {
      for (const p of pontos(linha.d)) {
        if (linha.pagina === 'esquerda') assert.ok(p.x < LOMBADA - 6)
        else assert.ok(p.x > LOMBADA + 6)
      }
    }
  })

  it('cada linha de texto acompanha a curva da página (não é uma reta)', () => {
    const linha = livroAberto('projeto-a').linhas.find(x => x.tipo === 'texto' && pontos(x.d).length > 4)!
    const ys = pontos(linha.d).map(p => p.y)
    assert.ok(Math.max(...ys) - Math.min(...ys) > 0.3)
  })

  it('bloco de páginas: várias bordas finas de cada lado', () => {
    assert.ok(livroAberto('projeto-a').bordas.length >= 12)
  })

  it('a fita nasce na lombada, em cima, e desce até passar da base da página', () => {
    const l = livroAberto('projeto-a')
    const p = pontos(l.fita)
    assert.ok(Math.abs(p[0]!.x - LOMBADA) < 14 && p[0]!.y < alturaDaPagina(0, 0) + 4)
    assert.ok(Math.max(...p.map(q => q.y)) > alturaDaPagina(0, 1) + 6)
  })

  it('o ex-libris fica na página direita, no alto', () => {
    const { emblema } = livroAberto('projeto-a')
    assert.ok(emblema.cx > LOMBADA + emblema.r && emblema.cx + emblema.r < LARGURA_DO_LIVRO)
    assert.ok(emblema.cy - emblema.r > alturaDaPagina(0.5, 0))
  })
})
