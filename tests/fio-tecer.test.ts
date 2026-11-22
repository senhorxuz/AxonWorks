import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TAMANHOS_DA_LETRA, tamanhoDaLetra, tecer, type Desenho } from '../src/fio/tecer.ts'
import type { CoisaFeita, TipoDaCoisa } from '../src/fio/coisas.ts'

let k = 0
/** O dia n do mês de outubro de 2026 (n = 1 é 1/10); passa de 31 e vira novembro. */
const diaN = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString().slice(0, 10)
const coisa = (dia: string, quem: string | undefined = 'Claude', tipo: TipoDaCoisa = 'registro', extra: Partial<CoisaFeita> = {}): CoisaFeita => {
  k++
  return { chave: `${tipo}:${k}`, quando: `${dia}T12:00:00Z`, tipo, texto: `feito ${k}`, ...(quem !== undefined ? { quem } : {}), ...extra }
}
const repetir = (n: number, fazer: (i: number) => CoisaFeita) => Array.from({ length: n }, (_, i) => fazer(i))

/** O que está desenhado numa linha da grade, casa a casa (espaço onde não há nada). */
function linhaDe(d: Desenho, linha: number): string {
  const casas = Array.from({ length: d.usadas }, () => ' ')
  for (const c of d.casas) if (c.linha === linha) casas[c.col] = c.ch
  return casas.join('')
}
const tecerOk = (coisas: CoisaFeita[], colunas: number): Desenho => {
  const d = tecer(coisas, colunas)
  assert.ok(d)
  return d
}

describe('tecer: estados mínimos', () => {
  it('sem coisas: null', () => {
    assert.equal(tecer([], 80), null)
  })

  it('uma coisa só: ├─◉, o início, uma casa de fio e a coisa', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa')], 40)
    assert.equal(linhaDe(d, 0), '├─◉')
    assert.deepEqual(d.casas.map(c => c.classe), ['fiacao', 'fiacao', 'agora'])
    assert.equal(d.usadas, 3)
    assert.equal(d.colunas, 40)
    assert.equal(d.linhas, 1)
    assert.deepEqual(d.fim, { col: 2, linha: 0, trilho: 0 })
    assert.deepEqual(d.dias, [{ col: 2, dia: diaN(1) }])
    assert.equal(d.trilhos.length, 1)
    assert.equal(d.cabe, true)
    assert.equal(d.coisasResumidas, 0)
    assert.equal(d.diasResumidos, 0)
    assert.equal(d.casas[2]!.coisa!.dia, diaN(1))
    assert.equal(d.casas[2]!.coisa!.trilho, 0)
    assert.equal(d.casas[0]!.coisa, undefined)
  })

  it('mesmo dia, mesma IA: símbolos colados; entrega ●, cartão ◆, registro ○, e a última vira ◉', () => {
    const hora = (h: number) => ({ quando: `${diaN(1)}T${h}:00:00Z` })
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa', hora(10)), coisa(diaN(1), 'Claude', 'cartao', hora(11)), coisa(diaN(1), 'Claude', 'registro', hora(12)), coisa(diaN(1), 'Claude', 'tarefa', hora(13))], 40)
    assert.equal(linhaDe(d, 0), '├─●◆○◉')
    assert.deepEqual(d.casas.slice(2).map(c => c.classe), ['entrega', 'cartao', 'registro', 'agora'])
    assert.deepEqual(d.casas.slice(2).map(c => c.coisa!.tipo), ['tarefa', 'cartao', 'registro', 'tarefa'])
    assert.deepEqual(d.dias, [{ col: 2, dia: diaN(1) }])
  })
})

describe('tecer: vãos entre dias', () => {
  it('1 dia depois: uma casa ─ (no mínimo)', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(2))], 11)
    assert.equal(linhaDe(d, 0), '├─●─◉')
    assert.equal(d.casas[3]!.classe, 'fiacao')
    assert.deepEqual(d.dias, [{ col: 2, dia: diaN(1) }, { col: 4, dia: diaN(2) }])
    assert.equal(d.cabe, true)
  })

  it('de 2 a 6 dias depois: duas casas ──', () => {
    assert.equal(linhaDe(tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(3))], 12), 0), '├─●──◉')
    assert.equal(linhaDe(tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(7))], 12), 0), '├─●──◉')
  })

  it('7 dias ou mais: ┄ N dias ┄, com a duração escrita; só o número leva a classe parado-numero', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(8))], 20)
    assert.equal(linhaDe(d, 0), '├─●┄ 7 dias ┄◉')
    const vao = d.casas.slice(3, 13)
    assert.deepEqual(vao.map(c => c.classe), ['parado', 'parado', 'parado-numero', 'parado', 'parado', 'parado', 'parado', 'parado', 'parado', 'parado'])
    assert.equal(d.cabe, true)
  })

  it('dois dígitos: ┄ 10 dias ┄', () => {
    assert.equal(linhaDe(tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(11))], 21), 0), '├─●┄ 10 dias ┄◉')
  })

  it('o vão fica no trilho de quem fez a última coisa do dia anterior', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(1), 'Codex', 'tarefa'), coisa(diaN(3), 'Codex')], 40)
    const vao = d.casas.filter(c => c.ch === '─' && c.col > 3)
    assert.ok(vao.length >= 2)
    assert.ok(vao.every(c => c.linha === 2 && c.trilho === 1))
  })
})

describe('tecer: troca de IA', () => {
  it('desce: ╮ no trilho de saída, │ nas linhas do meio, ╰ no trilho de chegada; uma coluna só', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(1), 'Codex', 'tarefa')], 40)
    assert.equal(d.linhas, 3)
    assert.equal(linhaDe(d, 0), '├─●╮ ')
    assert.equal(linhaDe(d, 1), '   │ ')
    assert.equal(linhaDe(d, 2), '   ╰◉')
    assert.equal(d.usadas, 5)
    assert.deepEqual(d.fim, { col: 4, linha: 2, trilho: 1 })
    assert.deepEqual(d.casas.filter(c => c.col === 3).map(c => c.classe), ['fiacao', 'fiacao', 'fiacao'])
  })

  it('sobe: ╯ │ ╭', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(1), 'Codex', 'tarefa'), coisa(diaN(1), 'Claude')], 40)
    assert.equal(linhaDe(d, 0), '├─●╮ ╭◉')
    assert.equal(linhaDe(d, 1), '   │ │ ')
    assert.equal(linhaDe(d, 2), '   ╰●╯ ')
  })

  it('a troca vem depois do vão, colada no primeiro símbolo da IA nova', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(3), 'Codex')], 13)
    assert.equal(linhaDe(d, 0), '├─●──╮ ')
    assert.equal(linhaDe(d, 2), '     ╰◉')
    assert.deepEqual(d.dias, [{ col: 2, dia: diaN(1) }, { col: 6, dia: diaN(3) }])
  })

  it('troca entre trilhos não vizinhos põe │ em todas as linhas do meio', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(1), 'Codex', 'tarefa'), coisa(diaN(1), 'Fundacao', 'tarefa'), coisa(diaN(1), 'Claude')], 40)
    assert.equal(d.linhas, 5)
    const coluna = d.casas.filter(c => c.col === 7).sort((a, b) => a.linha - b.linha)
    assert.deepEqual(coluna.map(c => [c.linha, c.ch]), [[0, '╭'], [1, '│'], [2, '│'], [3, '│'], [4, '╯']])
    assert.deepEqual(coluna.map(c => c.trilho), [0, 0, 0, 0, 2])
  })

  it('duas IAs dentro de "Outras IAs" não geram troca', () => {
    const quem = ['a', 'a', 'a', 'b', 'b', 'b', 'c', 'c', 'c', 'd', 'd', 'd', 'e', 'e', 'f', 'g']
    const d = tecerOk(quem.map(q => coisa(diaN(1), `${q}ia`, 'tarefa')), 80)
    const trocasNoTrilhoDasOutras = d.casas.filter(c => '╮╯╭╰'.includes(c.ch) && c.trilho === 5 && c.linha === 10)
    // f -> g é "Outras" -> "Outras": entre eles só há símbolos colados
    assert.equal(linhaDe(d, 10).slice(-2), '●◉')
    assert.equal(trocasNoTrilhoDasOutras.length, 1, 'só a entrada em "Outras IAs" vindo do trilho de e')
  })
})

describe('tecer: a sobra vira tempo', () => {
  it('distribui a sobra pelos vãos na proporção dos dias', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(3), 'Claude', 'tarefa'), coisa(diaN(7))], 21)
    // mínimos: 2 e 2 casas; sobra 6, dias 2 e 4: o primeiro vão ganha 2, o segundo 4
    assert.deepEqual(d.casas.filter(c => c.coisa).map(c => c.col), [2, 7, 14])
    assert.equal(d.usadas, 15)
    assert.equal(d.cabe, true)
    assert.equal(linhaDe(d, 0), '├─●────●──────◉')
  })

  it('teto de 30% das colunas por vão, com mínimo de 14; o que sobra fica depois do ◉', () => {
    // 60 colunas: teto 18; o vão de 10 dias (mínimo 11) cresce até 18
    const grande = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(11))], 60)
    assert.equal(grande.usadas, 2 + 1 + 18 + 1)
    assert.equal(linhaDe(grande, 0), `├─●${'┄'.repeat(4)} 10 dias ${'┄'.repeat(5)}◉`)
    // 40 colunas: 30% seria 12, mas o mínimo é 14
    const medio = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(11))], 40)
    assert.equal(medio.usadas, 2 + 1 + 14 + 1)
  })

  it('sem vãos (tudo no mesmo dia), a sobra não vira nada', () => {
    const d = tecerOk([coisa(diaN(1)), coisa(diaN(1))], 80)
    assert.equal(d.usadas, 4)
    assert.equal(d.cabe, true)
  })

  it('o vão cresce até o teto e não passa dele, mesmo com muita sobra', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude', 'tarefa'), coisa(diaN(2))], 200)
    assert.equal(d.usadas, 2 + 1 + 60 + 1, '30% de 200 colunas')
  })
})

describe('tecer: o excesso de um dia vira +N', () => {
  it('mais de 12 símbolos iguais no mesmo dia e trilho: mostra 10 e +N, só quando não cabe', () => {
    const lista = repetir(15, () => coisa(diaN(1)))
    const cabe = tecerOk(lista, 30)
    assert.equal(linhaDe(cabe, 0), `├─${'○'.repeat(14)}◉`)
    assert.equal(cabe.cabe, true)

    const aperto = tecerOk(lista, 21)
    assert.equal(linhaDe(aperto, 0), `├─${'○'.repeat(10)}+4◉`)
    assert.equal(aperto.cabe, false)
    assert.deepEqual(aperto.casas.filter(c => c.classe === 'mais').map(c => c.ch), ['+', '4'])
    assert.ok(aperto.casas.filter(c => c.classe === 'mais').every(c => c.coisa === undefined && c.linha === 0 && c.trilho === 0))
    assert.equal(aperto.casas.filter(c => c.coisa).length, 11, '10 símbolos mais o ◉')
    assert.equal(aperto.coisasResumidas, 0, 'a compressão não é o resumo do começo')
    assert.equal(aperto.diasResumidos, 0)
  })

  it('12 iguais não comprimem, 13 sim (só passa de 12)', () => {
    assert.equal(linhaDe(tecerOk(repetir(13, () => coisa(diaN(1))), 10), 0), `├─${'○'.repeat(12)}◉`)
    assert.equal(linhaDe(tecerOk(repetir(14, () => coisa(diaN(1))), 10), 0), `├─${'○'.repeat(10)}+3◉`)
  })

  it('símbolos diferentes quebram a sequência', () => {
    const lista = [...repetir(7, () => coisa(diaN(1), 'Claude', 'registro')), ...repetir(7, () => coisa(diaN(1), 'Claude', 'cartao')), coisa(diaN(1))]
    assert.ok(!linhaDe(tecerOk(lista, 10), 0).includes('+'))
  })

  it('a sequência não atravessa o dia nem o trilho', () => {
    const lista = [...repetir(8, () => coisa(diaN(1))), ...repetir(8, () => coisa(diaN(2))), ...repetir(8, () => coisa(diaN(2), 'Codex')), coisa(diaN(2), 'Codex')]
    assert.ok(!tecerOk(lista, 10).casas.some(c => c.classe === 'mais'))
  })

  it('o vão depois de uma sequência comprimida continua no trilho certo', () => {
    const lista = [...repetir(14, () => coisa(diaN(1))), coisa(diaN(3), 'Claude', 'tarefa')]
    const d = tecerOk(lista, 23)
    assert.equal(linhaDe(d, 0), `├─${'○'.repeat(10)}+4──◉`)
    assert.deepEqual(d.dias, [{ col: 2, dia: diaN(1) }, { col: 16, dia: diaN(3) }])
  })
})

describe('tecer: o último dia sempre cabe (colunas de 20 em diante)', () => {
  /** Cada coisa um segundo depois da outra: assim a ordem de tempo mantém tarefa e registro alternados. */
  const alternando = (n: number, dia: string, quem = 'Claude') =>
    repetir(n, i => coisa(dia, quem, i % 2 === 0 ? 'tarefa' : 'registro', { quando: `${dia}T12:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }))
  const casasVisiveis = (d: Desenho) => d.casas.filter(c => c.coisa)

  it('60 coisas no mesmo dia alternando tarefa e registro, em 40 colunas: mostra os primeiros, um +N e o ◉ por último', () => {
    const d = tecerOk(alternando(60, diaN(1)), 40)
    assert.ok(d.usadas <= 40, `usadas ${d.usadas}`)
    assert.equal(d.cabe, false)
    assert.equal(d.casas.at(-1)!.classe, 'agora')
    assert.equal(d.casas.at(-1)!.ch, '◉')
    const linha = linhaDe(d, 0)
    assert.match(linha, /^├─(●○)+●?\+\d+◉$/)
    const escondidas = Number(/\+(\d+)/.exec(linha)![1])
    assert.equal(casasVisiveis(d).length + escondidas, 60, 'os símbolos mostrados mais o +N são as 60 coisas')
    assert.equal(d.coisasResumidas, 0)
  })

  it('300 coisas no mesmo dia, em 30 colunas', () => {
    const d = tecerOk(alternando(300, diaN(1)), 30)
    assert.ok(d.usadas <= 30)
    assert.equal(d.casas.at(-1)!.ch, '◉')
    assert.equal(d.fim.col, d.usadas - 1)
  })

  it('o mostrado é o maior que cabe: um símbolo a mais estouraria as colunas', () => {
    const d = tecerOk(alternando(60, diaN(1)), 40)
    const mostrados = casasVisiveis(d).length - 1
    assert.ok(d.usadas >= 39, `usadas ${d.usadas}: sobrou espaço que cabia mais um símbolo`)
    assert.ok(mostrados >= 30)
  })

  it('dias antigos viram resumo curto e o último dia ainda cabe, mesmo em 20 colunas', () => {
    const lista = [...repetir(40, i => coisa(diaN(1 + Math.floor(i / 4)))), ...alternando(80, diaN(15))]
    const d = tecerOk(lista, 20)
    assert.ok(d.usadas <= 20, `usadas ${d.usadas}`)
    assert.equal(d.casas.at(-1)!.ch, '◉')
    assert.equal(d.coisasResumidas, 40)
    assert.equal(linhaDe(d, 0).slice(0, 13), '┄ antes: 40 ┄')
    assert.equal(d.dias.at(-1)!.dia, diaN(15))
  })

  it('várias IAs alternando no último dia: cada troca ocupa uma casa; só o trecho do ◉ fica e o resto vira +N', () => {
    const lista = repetir(60, i => coisa(diaN(1), i % 2 === 0 ? 'Claude' : 'Codex', 'registro'))
    const d = tecerOk(lista, 24)
    assert.ok(d.usadas <= 24, `usadas ${d.usadas}`)
    assert.equal(d.casas.at(-1)!.ch, '◉')
    assert.ok(d.casas.some(c => c.classe === 'mais'))
    assert.equal(casasVisiveis(d).length, 1, 'cada trecho tem um símbolo só: sobra o ◉')
  })

  it('o ◉ nunca some, mesmo quando só cabem o resumo, o +N e ele', () => {
    const lista = [...repetir(500, i => coisa(diaN(1 + Math.floor(i / 50)))), ...alternando(1500, diaN(20))]
    const d = tecerOk(lista, 20)
    assert.equal(linhaDe(d, 0), '┄ antes: 500 ┄+1499◉')
    assert.equal(d.usadas, 20)
  })

  it('só o trecho do ◉ fica, e os trechos de antes viram um +N no começo', () => {
    const antes = repetir(30, i => coisa(diaN(1), i % 2 === 0 ? 'Claude' : 'Codex', 'registro', { quando: `${diaN(1)}T11:00:${String(i).padStart(2, '0')}Z` }))
    const d = tecerOk([...antes, ...alternando(5, diaN(1), 'Gemini')], 20)
    assert.equal(linhaDe(d, 4), '├─+30●○●○◉')
    assert.ok(d.usadas <= 20)
  })

  it('o ◉ fica sozinho atrás de um +N quando nem o resto do último trecho cabe', () => {
    const lista = [
      ...repetir(500, i => coisa(diaN(1 + Math.floor(i / 50)))),
      ...repetir(30, i => coisa(diaN(20), i % 2 === 0 ? 'Claude' : 'Codex', 'registro', { quando: `${diaN(20)}T11:00:${String(i).padStart(2, '0')}Z` })),
      ...alternando(1500, diaN(20), 'Gemini'),
    ]
    const d = tecerOk(lista, 20)
    assert.equal(linhaDe(d, d.fim.linha), '┄ antes: 500 ┄+1529◉')
    assert.equal(d.usadas, 20)
  })

  it('o ◉ fica sozinho quando nem o +N cabe depois de tantos símbolos fora do último trecho', () => {
    const lista = [...repetir(30, i => coisa(diaN(1), i % 2 === 0 ? 'Claude' : 'Codex', 'registro')), ...alternando(500, diaN(1), 'Gemini')]
    const d = tecerOk(lista, 20)
    assert.ok(d.usadas <= 20, `usadas ${d.usadas}`)
    assert.equal(d.casas.at(-1)!.ch, '◉')
  })

  it('abaixo de 20 colunas nada muda: continua sem garantia', () => {
    assert.equal(tecerOk(alternando(30, diaN(1)), 15).cabe, false)
    assert.equal(tecerOk(alternando(30, diaN(1)), 15).usadas, 32)
  })

  it('qualquer entrada com 20 colunas ou mais cabe', () => {
    const quem = ['Claude', 'Codex', 'Gemini', 'Fundacao', 'Kimi', 'Qwen', 'Llama']
    const tipos: TipoDaCoisa[] = ['tarefa', 'cartao', 'registro']
    let semente = 7
    const sorteio = (n: number) => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente % n }
    for (let rodada = 0; rodada < 60; rodada++) {
      const total = 1 + sorteio(300)
      const dias = 1 + sorteio(40)
      const lista = repetir(total, () => coisa(diaN(1 + sorteio(dias)), quem[sorteio(1 + sorteio(7))], tipos[sorteio(3)]))
      const colunas = 20 + sorteio(60)
      const d = tecerOk(lista, colunas)
      assert.ok(d.usadas <= colunas, `rodada ${rodada}: ${total} coisas em ${dias} dias, ${colunas} colunas, usadas ${d.usadas}`)
      assert.equal(d.casas.at(-1)!.ch, '◉')
    }
  })
})

describe('tecer: desempenho', () => {
  it('2000 coisas em 250 dias: a letra e o fio saem em menos de 300 ms', () => {
    const lista = repetir(2000, i => coisa(diaN(1 + Math.floor(i / 8)), ['Claude', 'Codex', 'Gemini'][i % 3], (['tarefa', 'cartao', 'registro'] as const)[i % 3]))
    const inicio = performance.now()
    const tamanho = tamanhoDaLetra(lista, 900, t => t * 0.6)
    const d = tecerOk(lista, Math.floor(900 / (tamanho * 0.6)))
    const gasto = performance.now() - inicio
    assert.ok(gasto < 300, `levou ${Math.round(gasto)} ms`)
    assert.equal(tamanho, 12)
    assert.ok(d.usadas <= d.colunas)
  })
})

describe('tecer: o começo vira resumo', () => {
  it('quando nem comprimindo cabe, os dias mais antigos saem um a um e o começo vira ┄ antes: N coisas em M dias ┄', () => {
    const lista = repetir(40, i => coisa(diaN(1 + Math.floor(i / 2))))
    const d = tecerOk(lista, 60)
    const inicio = '┄ antes: 24 coisas em 12 dias ┄'
    assert.equal(d.coisasResumidas, 24)
    assert.equal(d.diasResumidos, 12)
    assert.equal(d.cabe, false)
    assert.equal(linhaDe(d, 0).slice(0, inicio.length), inicio)
    assert.ok(d.usadas <= 60 - 6, 'sobram as 6 casas de folga')
    assert.equal(d.casas.filter(c => c.coisa).length, 16)
    assert.equal(d.dias[0]!.dia, diaN(13), 'o primeiro dia que ficou')
    assert.equal(d.dias[0]!.col, inicio.length)
    assert.equal(d.casas[0]!.classe, 'parado')
    assert.equal(d.casas[inicio.indexOf('24')]!.classe, 'parado-numero')
    assert.equal(d.casas[inicio.indexOf('coisas')]!.classe, 'parado')
  })

  it('as casas do resumo ficam na linha do primeiro trilho que ficou, e os trilhos só contam o que ficou', () => {
    const lista = [...repetir(30, i => coisa(diaN(1 + i), 'Codex')), ...repetir(20, i => coisa(diaN(31 + i), 'Claude'))]
    const d = tecerOk(lista, 70)
    assert.ok(d.coisasResumidas > 0)
    assert.deepEqual(d.trilhos.map(t => t.rotulo), ['Claude'], 'o Codex ficou todo no resumo')
    assert.equal(d.linhas, 1)
    assert.ok(d.casas.slice(0, 5).every(c => c.linha === 0))
  })

  it('primeiro comprime, depois resume: com a compressão cabendo, não há resumo', () => {
    const lista = [...repetir(20, () => coisa(diaN(1))), coisa(diaN(2), 'Claude', 'tarefa')]
    const comprimido = tecerOk(lista, 26)
    assert.equal(comprimido.coisasResumidas, 0)
    assert.ok(comprimido.casas.some(c => c.classe === 'mais'))
    assert.equal(comprimido.cabe, false)
    const resumido = tecerOk(lista, 12)
    assert.equal(resumido.coisasResumidas, 20)
    assert.equal(resumido.diasResumidos, 1)
    assert.equal(linhaDe(resumido, 0).slice(0, 27), '┄ antes: 20 coisas em 1 dia')
  })

  it('o último dia nunca sai, mesmo sem caber; singular em "1 coisa em 1 dia"', () => {
    const d = tecerOk([coisa(diaN(1)), coisa(diaN(2))], 10)
    assert.equal(d.coisasResumidas, 1)
    assert.equal(d.diasResumidos, 1)
    assert.equal(d.cabe, false)
    assert.equal(linhaDe(d, 0), '┄ antes: 1 coisa em 1 dia ┄◉')
    assert.equal(d.casas.at(-1)!.classe, 'agora')
    assert.equal(d.dias.length, 1)
  })

  it('um dia só que não cabe: não resume nada (o último dia nunca sai)', () => {
    const d = tecerOk(repetir(5, () => coisa(diaN(1))), 3)
    assert.equal(d.coisasResumidas, 0)
    assert.equal(d.cabe, false)
    assert.equal(d.casas.filter(c => c.coisa).length, 5)
  })
})

describe('tecer: os trilhos entram no desenho', () => {
  it('cada trilho ocupa uma linha, com uma linha vazia entre eles; os trilhos vêm no resultado', () => {
    const d = tecerOk([coisa(diaN(1), 'Claude'), coisa(diaN(1), 'Codex'), coisa(diaN(1), 'Fundacao')], 40)
    assert.equal(d.linhas, 5)
    assert.deepEqual(d.trilhos.map(t => t.rotulo), ['Claude', 'Codex', 'Fundacao'])
    assert.deepEqual(d.casas.filter(c => c.coisa).map(c => c.linha), [0, 2, 4])
    assert.deepEqual(d.casas.filter(c => c.coisa).map(c => c.trilho), [0, 1, 2])
  })

  it('a última coisa do mesmo instante é o registro, que vira ◉', () => {
    const t = '2026-10-01T12:00:00Z'
    const d = tecerOk([
      { chave: 'registro:z', quando: t, tipo: 'registro', texto: 'r', quem: 'Claude' },
      { chave: 'tarefa:z', quando: t, tipo: 'tarefa', texto: 't', quem: 'Claude' },
    ], 20)
    assert.equal(linhaDe(d, 0), '├─●◉')
  })
})

describe('tamanhoDaLetra', () => {
  const lista = repetir(30, i => coisa(diaN(1 + i)))
  const casa = (tamanho: number) => tamanho / 2

  it('os tamanhos vão de 20 a 12', () => {
    assert.deepEqual([...TAMANHOS_DA_LETRA], [20, 19, 18, 17, 16, 15, 14, 13, 12])
  })

  it('o maior em que tudo cabe: 67 colunas mínimas', () => {
    assert.equal(tamanhoDaLetra(lista, 700, casa), 20)
    assert.equal(tamanhoDaLetra(lista, 600, casa), 17)
  })

  it('se nenhum couber, 12', () => {
    assert.equal(tamanhoDaLetra(lista, 100, casa), 12)
  })

  it('sem coisas, 12 (não há o que caber)', () => {
    assert.equal(tamanhoDaLetra([], 700, casa), 12)
  })
})
