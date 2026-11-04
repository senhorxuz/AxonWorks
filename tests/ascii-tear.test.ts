import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { glifoDoNo, linhaDoTrilho, linhasDoTear, quadroDoTear, quadroFixo, tecerBase, type Celula, type PedidoDoTear, type TrilhoDoTear } from '../src/ascii/tear.ts'

// O Tear: um trilho por projeto sobre uma régua de tempo comum, desenhado em caracteres e vivo no tempo.

const H = 3_600_000
const D = 24 * H
const AGORA = Date.UTC(2026, 9, 31, 15)
// 122 colunas: o tempo ocupa as colunas 0 a 120 (4 colunas por dia em 30 dias) e a 121 é o "agora".
const COLS = 122
const col = (quando: number) => Math.round(((quando - (AGORA - 30 * D)) / (30 * D)) * (COLS - 2))

const vivo: TrilhoDoTear = {
  desde: AGORA - 20 * D, ultimo: AGORA - 2 * H, vivo: true, parado: false,
  atividades: [AGORA - 20 * D, AGORA - 15 * D, AGORA - 10 * D, AGORA - 10 * D + H, AGORA - 5 * D, AGORA - 5 * D + H / 2, AGORA - 5 * D + H, AGORA - 5 * D + 1.5 * H, AGORA - 2 * H],
}
const parado: TrilhoDoTear = { desde: AGORA - 28 * D, ultimo: AGORA - 15 * D, atividades: [AGORA - 28 * D, AGORA - 15 * D], vivo: false, parado: true }
const antigo: TrilhoDoTear = { desde: AGORA - 60 * D, ultimo: AGORA - 40 * D, atividades: [AGORA - 50 * D], vivo: false, parado: true }
const semDado: TrilhoDoTear = { desde: AGORA - 5 * D, ultimo: AGORA - D, atividades: [], vivo: false, parado: false }

const marcas = [
  { quando: AGORA - 21 * D, rotulo: '10 OUT' },
  { quando: AGORA - 14 * D, rotulo: '17 OUT' },
  { quando: AGORA - 7 * D, rotulo: '24 OUT' },
  { quando: AGORA - 6.5 * D, rotulo: '24b' },
  { quando: AGORA - 0.3 * D, rotulo: 'XX' },
  // Termina a duas colunas do AGORA: colado, parece uma palavra só ("07h AGORA").
  { quando: AGORA - 1.25 * D, rotulo: 'YY' },
  { quando: AGORA - 30 * D, rotulo: 'ZZZ' },
]
const pedido = (extra: Partial<PedidoDoTear> = {}): PedidoDoTear => ({
  cols: COLS, inicio: AGORA - 30 * D, fim: AGORA, trilhos: [vivo, parado, antigo, semDado], marcas, ...extra,
})
const texto = (linhas: Celula[][]) => linhas.map(l => l.map(c => c.ch).join(''))
const NOS = /[•●◆◉]/

describe('tear: a grade', () => {
  it('uma linha de folga, duas por trilho e duas de régua; exatamente as colunas pedidas', () => {
    assert.equal(linhasDoTear(4), 11)
    assert.deepEqual([0, 1, 2, 3].map(linhaDoTrilho), [1, 3, 5, 7])
    const quadro = quadroDoTear(tecerBase(pedido()), 0)
    assert.equal(quadro.length, 11)
    for (const linha of quadro) assert.equal(linha.length, COLS)
  })

  it('o nó diz quanto foi feito naquele trecho: • um, ● dois ou três, ◆ quatro ou mais', () => {
    assert.deepEqual([1, 2, 3, 4, 9].map(glifoDoNo), ['•', '●', '●', '◆', '◆'])
  })
})

describe('tear: cada projeto no seu trilho', () => {
  const quadro = quadroFixo(tecerBase(pedido()))
  const linha = (i: number) => quadro[linhaDoTrilho(i)]!

  it('o vivo é brasa: trilho grosso, nós acesos e o último ◉ no lugar exato da última atividade', () => {
    const l = linha(0)
    assert.equal(l[col(AGORA - 15 * D)]!.ch, '•')
    assert.equal(l[col(AGORA - 10 * D)]!.ch, '●')
    assert.equal(l[col(AGORA - 5 * D)]!.ch, '◆')
    assert.deepEqual(l[col(AGORA - 2 * H)], { ch: '◉', c: 'na' })
    assert.equal(l[col(AGORA - 20 * D)]!.c, 'nv', 'a primeira atividade cobre o começo do trilho')
    assert.deepEqual(l[col(AGORA - 12 * D)], { ch: '━', c: 'tv' })
    assert.ok(l.filter(c => NOS.test(c.ch)).every(c => c.c === 'nv' || c.c === 'na'))
  })

  it('o parado é apagado e pontilhado desde a última vez até agora', () => {
    const l = linha(1)
    assert.deepEqual(l[col(AGORA - 28 * D)], { ch: '•', c: 'n2' })
    assert.deepEqual(l[col(AGORA - 15 * D)], { ch: '•', c: 'n2' })
    assert.deepEqual(l[col(AGORA - 20 * D)], { ch: '─', c: 't2' })
    for (let c = col(AGORA - 15 * D) + 1; c <= COLS - 2; c++) assert.deepEqual(l[c], { ch: '·', c: 'p' })
    assert.ok(l.slice(0, col(AGORA - 28 * D)).every(c => c.c === ' ' || c.c === 'u'), 'antes de existir, nada além do urdume')
  })

  it('o que é mais velho que a janela começa com ‹ e não ganha nó fora dela', () => {
    const l = linha(2)
    assert.equal(l[0]!.ch, '‹')
    for (let c = 1; c <= COLS - 2; c++) assert.equal(l[c]!.ch, '·')
    assert.ok(!l.some(c => NOS.test(c.ch)))
  })

  it('sem atividade lida, nenhum nó: só o começo ├, o trilho e o pontilhado', () => {
    const l = linha(3)
    assert.deepEqual(l[col(AGORA - 5 * D)], { ch: '├', c: 't' })
    assert.deepEqual(l[col(AGORA - 3 * D)], { ch: '─', c: 't' })
    assert.deepEqual(l[col(AGORA - D) + 1], { ch: '·', c: 'p' })
    assert.ok(!l.some(c => NOS.test(c.ch)), 'nada inventado')
  })

  it('o projeto mexido agora mesmo não tem pontilhado; o vivo começado antes da janela começa com ‹', () => {
    const l = quadroFixo(tecerBase(pedido({ trilhos: [{ ...vivo, desde: AGORA - 45 * D, atividades: [] }] })))[1]!
    assert.deepEqual(l[0], { ch: '‹', c: 'tv' })
    assert.ok(!l.some(c => c.ch === '·'))
  })
})

describe('tear: a régua e o agora', () => {
  const quadro = quadroFixo(tecerBase(pedido()))
  const rows = quadro.length

  it('a coluna do agora corre de cima a baixo e a régua termina em AGORA', () => {
    for (let r = 0; r < rows - 2; r++) assert.deepEqual(quadro[r]![COLS - 1], { ch: '┊', c: 'ag' })
    assert.deepEqual(quadro[rows - 2]![COLS - 1], { ch: '┘', c: 'ag' })
    assert.ok(texto(quadro).at(-1)!.endsWith('AGORA'))
    assert.ok(quadro[rows - 1]!.slice(-5).every(c => c.c === 'ag'))
  })

  it('cada marca é um ┴ com o rótulo centrado embaixo; a que atropelaria outra, o AGORA ou a borda, some', () => {
    const ticks = quadro[rows - 2]!.flatMap((c, i) => (c.ch === '┴' ? [i] : []))
    assert.deepEqual(ticks, [col(AGORA - 21 * D), col(AGORA - 14 * D), col(AGORA - 7 * D)])
    const rodape = texto(quadro).at(-1)!
    assert.equal(rodape.indexOf('10 OUT'), col(AGORA - 21 * D) - 3)
    for (const rotulo of ['17 OUT', '24 OUT']) assert.ok(rodape.includes(rotulo))
    for (const rotulo of ['24b', 'XX', 'YY', 'ZZZ'])assert.ok(!rodape.includes(rotulo), `${rotulo} não devia aparecer`)
    assert.ok(quadro[rows - 2]!.slice(0, COLS - 1).every(c => c.c === 'u'))
  })

  it('o urdume pontilha as marcas nas casas vazias', () => {
    assert.deepEqual(quadro[0]![col(AGORA - 21 * D)], { ch: '┊', c: 'u' })
    assert.deepEqual(quadro[2]![col(AGORA - 14 * D)], { ch: '┊', c: 'u' })
  })
})

describe('tear: o tempo', () => {
  const base = tecerBase(pedido())

  it('o mesmo instante desenha igual; o tempo move o pulso e o fundo', () => {
    assert.deepEqual(quadroDoTear(base, 1.25), quadroDoTear(base, 1.25))
    assert.notDeepEqual(texto(quadroDoTear(base, 1.25)), texto(quadroDoTear(base, 2.5)))
  })

  it('o pulso de brasa corre só no trilho vivo e só acende o próprio trilho: nada com cara de nó inventado', () => {
    const fixo = quadroFixo(base)
    const instantes = Array.from({ length: 30 }, (_, i) => i * 0.4)
    const cabecas = instantes.flatMap(t => quadroDoTear(base, t).flatMap((l, r) => l.flatMap((c, i) => (c.c === 'bq' ? [{ r, i, ch: c.ch }] : []))))
    assert.ok(cabecas.length > 0)
    assert.ok(cabecas.every(p => p.r === linhaDoTrilho(0) && p.i <= col(AGORA - 2 * H)))
    assert.ok(cabecas.every(p => p.ch === fixo[p.r]![p.i]!.ch && !NOS.test(p.ch)), 'a cabeça do pulso é o trilho aceso')
  })

  it('as ondas em volta do último nó do vivo pulsam em brasa', () => {
    const { row, col: c } = base.aceso!
    assert.deepEqual({ row, col: c }, { row: linhaDoTrilho(0), col: col(AGORA - 2 * H) })
    for (const t of [0.2, 0.7, 1.2, 1.7]) {
      const perto = quadroDoTear(base, t).flatMap((l, r) => l.flatMap((cel, i) => (cel.c === 'b' && Math.abs(r - row) <= 4 && Math.abs(i - c) <= 9 ? [cel] : [])))
      assert.ok(perto.some(cel => cel.ch === '·'), `sem onda em ${t}`)
    }
  })

  it('sem projeto vivo, nada em brasa; vivo sem atividade lida tem pulso mas não tem ondas', () => {
    const quieto = tecerBase(pedido({ trilhos: [parado, semDado] }))
    for (const t of [0, 1, 2, 3, 4, 5]) assert.ok(!quadroDoTear(quieto, t).flat().some(c => c.c === 'b' || c.c === 'bq'))
    const semNos = tecerBase(pedido({ trilhos: [{ ...vivo, atividades: [] }] }))
    assert.equal(semNos.aceso, null)
    assert.ok(Array.from({ length: 30 }, (_, i) => i * 0.4).some(t => quadroDoTear(semNos, t).flat().some(c => c.c === 'bq')))
  })

  it('sem trilhos: só a régua e o fundo', () => {
    const vazio = quadroDoTear(tecerBase(pedido({ trilhos: [] })), 0)
    assert.equal(vazio.length, 3)
    assert.ok(!vazio.flat().some(c => NOS.test(c.ch)))
  })
})

describe('tear: camada fixa', () => {
  // A tela pinta a camada fixa uma vez e, a cada quadro, só as casas que mudam.
  it('tem trilhos, nós e régua, e nada que dependa do tempo', () => {
    const celulas = quadroFixo(tecerBase(pedido())).flat()
    assert.ok(celulas.some(c => c.ch === '◉') && celulas.some(c => c.ch === '┴'))
    assert.ok(!celulas.some(c => c.c === 'b' || c.c === 'bq' || c.c === 'd'), 'pulso, ondas ou poeira na camada fixa')
  })

  it('em qualquer instante, o quadro é a camada fixa mais as casas vivas (pulso, ondas e poeira)', () => {
    const base = tecerBase(pedido())
    const fixo = quadroFixo(base)
    for (const tempo of [0, 1.3, 4.7, 9.1]) {
      quadroDoTear(base, tempo).forEach((linha, r) => linha.forEach((celula, c) => {
        const viva = celula.c === 'b' || celula.c === 'bq' || celula.c === 'd'
        if (!viva) assert.deepEqual(celula, fixo[r]![c], `casa ${r},${c} em ${tempo}s`)
      }))
    }
  })

  it('os nós nunca são tingidos pelas ondas nem cobertos pelo pulso', () => {
    const base = tecerBase(pedido())
    const fixo = quadroFixo(base)
    for (const tempo of [0.2, 0.9, 2.4, 3.3, 6.1]) {
      quadroDoTear(base, tempo).forEach((linha, r) => linha.forEach((celula, c) => {
        if (NOS.test(fixo[r]![c]!.ch)) assert.deepEqual(celula, fixo[r]![c])
      }))
    }
  })
})
