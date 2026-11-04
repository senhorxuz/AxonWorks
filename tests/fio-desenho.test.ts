import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_NOS, MAX_PONTAS, desenharFio, marcasDosMeses, rotuloCurtoDaData, type NoDoFio, type PedidoDoFio } from '../src/fio/desenho.ts'

// O fio do projeto: fibras que se trançam e convergem em cada coisa feita, com um nó aceso
// no "onde paramos" e fios soltos para o que falta. O desenho sai dos dados reais do projeto.

const dia = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 12)).toISOString()
const nos = (dias: number[], tipo: NoDoFio['tipo'] = 'registro'): NoDoFio[] => dias.map(n => ({ quando: dia(n), tipo }))
const pedido = (extra: Partial<PedidoDoFio> = {}): PedidoDoFio => ({
  semente: 'projeto-a', nos: nos([0, 3, 4, 10, 30]), pontasSoltas: 2, largura: 1200, altura: 168, fibras: 15, ...extra,
})
const fmt = (n: number) => String(Math.round(n * 10) / 10)
const numeros = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe('fio do projeto: desenho', () => {
  it('o mesmo projeto gera sempre o mesmo desenho; outro projeto, outro desenho', () => {
    assert.deepEqual(desenharFio(pedido()), desenharFio(pedido()))
    assert.notDeepEqual(desenharFio(pedido()).fibras, desenharFio(pedido({ semente: 'projeto-b' })).fibras)
  })

  it('desenha o número pedido de fibras, cada uma um caminho', () => {
    const d = desenharFio(pedido())
    assert.equal(d.fibras.length, 15)
    for (const f of d.fibras) assert.match(f, /^M[\d.-]+ [\d.-]+( C[\d. -]+)+$/)
    assert.equal(desenharFio(pedido({ fibras: 1 })).fibras.length, 1)
  })

  it('toda fibra passa exatamente por cada nó: é ali que a trança converge', () => {
    const d = desenharFio(pedido())
    assert.equal(d.nos.length, 5)
    for (const no of d.nos) {
      for (const f of d.fibras) assert.ok(f.includes(`${fmt(no.x)} ${fmt(no.y)}`), `fibra sem o nó de ${no.quando}`)
    }
    for (const f of d.fibras) assert.ok(f.startsWith(`M${fmt(d.origem.x)} ${fmt(d.origem.y)}`), 'fibra nasce na origem')
  })

  it('nós em ordem de tempo, da esquerda para a direita, e só o último aceso no fim da trança', () => {
    const d = desenharFio(pedido({ nos: nos([10, 0, 30, 4, 3]) }))
    assert.deepEqual(d.nos.map(n => n.quando), [dia(0), dia(3), dia(4), dia(10), dia(30)])
    for (let i = 1; i < d.nos.length; i++) assert.ok(d.nos[i]!.x > d.nos[i - 1]!.x)
    assert.ok(d.nos[0]!.x > d.origem.x)
    assert.deepEqual(d.nos.map(n => n.ultimo), [false, false, false, false, true])
    assert.equal(d.nos.at(-1)!.x, d.fimDoTrancado)
  })

  it('o tempo pesa na distância entre nós, sem deixar nós colados', () => {
    const d = desenharFio(pedido({ nos: nos([0, 1, 2, 60]) }))
    const vaos = d.nos.slice(1).map((n, i) => n.x - d.nos[i]!.x)
    assert.ok(vaos[2]! > vaos[0]! * 2, 'o salto de dois meses abre mais espaço')
    assert.ok(Math.min(...vaos) > 20, 'nós próximos no tempo ainda ficam separados')
  })

  it('datas que não se leem mantêm a ordem recebida, igualmente espaçadas', () => {
    const d = desenharFio(pedido({ nos: [{ quando: 'x', tipo: 'cartao' }, { quando: dia(5), tipo: 'tarefa' }, { quando: '', tipo: 'registro' }] }))
    assert.deepEqual(d.nos.map(n => n.tipo), ['cartao', 'tarefa', 'registro'])
    const vaos = d.nos.slice(1).map((n, i) => n.x - d.nos[i]!.x)
    assert.ok(Math.abs(vaos[0]! - vaos[1]!) < 0.001)
  })

  it('datas iguais não quebram o espaçamento', () => {
    const d = desenharFio(pedido({ nos: nos([2, 2, 2]) }))
    const vaos = d.nos.slice(1).map((n, i) => n.x - d.nos[i]!.x)
    assert.ok(Math.abs(vaos[0]! - vaos[1]!) < 0.001)
  })

  it(`no máximo ${MAX_NOS} nós, sempre com o primeiro e o último`, () => {
    const muitos = nos(Array.from({ length: 50 }, (_, i) => i))
    const d = desenharFio(pedido({ nos: muitos }))
    assert.equal(d.nos.length, MAX_NOS)
    assert.equal(d.nos[0]!.quando, dia(0))
    assert.equal(d.nos.at(-1)!.quando, dia(49))
  })

  it('um nó só fica no fim da trança, aceso', () => {
    const d = desenharFio(pedido({ nos: nos([3], 'tarefa') }))
    assert.equal(d.nos.length, 1)
    assert.equal(d.nos[0]!.x, d.fimDoTrancado)
    assert.equal(d.nos[0]!.ultimo, true)
    assert.equal(d.nos[0]!.tipo, 'tarefa')
  })

  it('sem nada feito, as fibras saem soltas da origem e não há nó', () => {
    const d = desenharFio(pedido({ nos: [] }))
    assert.equal(d.nos.length, 0)
    assert.equal(d.fimDoTrancado, d.origem.x)
    assert.equal(d.fibras.length, 15)
  })

  it(`fios soltos: um por pendência, até ${MAX_PONTAS}; nenhum quando não falta nada`, () => {
    assert.equal(desenharFio(pedido({ pontasSoltas: 3 })).pontas.length, 3)
    assert.equal(desenharFio(pedido({ pontasSoltas: 40 })).pontas.length, MAX_PONTAS)
    assert.equal(desenharFio(pedido({ pontasSoltas: 0 })).pontas.length, 0)
    assert.equal(desenharFio(pedido({ pontasSoltas: -2 })).pontas.length, 0)
    assert.equal(desenharFio(pedido({ pontasSoltas: 2.9 })).pontas.length, 2)
    assert.equal(desenharFio(pedido({ pontasSoltas: Number.NaN })).pontas.length, 0)
    const uma = desenharFio(pedido({ pontasSoltas: 1 }))
    assert.equal(uma.pontas.length, 1)
    assert.equal(uma.pontas[0]!.fim.y, uma.altura / 2, 'um fio solto só segue reto pelo meio')
    const d = desenharFio(pedido({ pontasSoltas: 3 }))
    const ultimo = d.nos.at(-1)!
    for (const p of d.pontas) {
      assert.ok(p.d.startsWith(`M${fmt(ultimo.x)} ${fmt(ultimo.y)}`), 'o fio solto sai do nó aceso')
      assert.ok(p.fim.x > ultimo.x)
    }
    assert.equal(new Set(d.pontas.map(p => p.fim.y)).size, 3, 'cada fio solto termina numa altura')
  })

  it('com pendências, os fios soltos terminam até 80% da largura: o resto é dos nomes de cada grupo', () => {
    const d = desenharFio(pedido({ pontasSoltas: 5 }))
    for (const p of d.pontas) assert.ok(p.fim.x <= d.largura * 0.8 + 0.01, `ponta em ${p.fim.x}`)
    assert.ok(d.fimDoTrancado <= d.largura * 0.65, 'a trança fecha antes para os fios soltos terem espaço')
  })

  it('com pendências, a trança termina antes, para caber os fios soltos', () => {
    assert.ok(desenharFio(pedido({ pontasSoltas: 2 })).fimDoTrancado < desenharFio(pedido({ pontasSoltas: 0 })).fimDoTrancado)
  })

  it('nada sai da área do desenho, em qualquer projeto', () => {
    for (const semente of ['a', 'b', 'c', 'outro projeto', 'f6ec1b19']) {
      for (const lista of [[], nos([1]), nos([0, 1, 2, 3, 90]), nos(Array.from({ length: 40 }, (_, i) => i * 3))]) {
        const d = desenharFio(pedido({ semente, nos: lista, pontasSoltas: 6 }))
        for (const caminho of [...d.fibras, ...d.pontas.map(p => p.d)]) {
          const v = numeros(caminho)
          for (let i = 0; i < v.length; i += 2) {
            assert.ok(v[i]! >= 0 && v[i]! <= d.largura, `x fora: ${v[i]}`)
            assert.ok(v[i + 1]! >= 0 && v[i + 1]! <= d.altura, `y fora: ${v[i + 1]}`)
          }
        }
      }
    }
  })

  it('a camada de fundo pode ser mais fechada: as fibras abrem menos, e continuam passando pelos nós', () => {
    const afastamento = (d: ReturnType<typeof desenharFio>) => Math.max(...d.fibras.flatMap(f => numeros(f).filter((_, i) => i % 2 === 1)).map(y => Math.abs(y - d.altura / 2)))
    const aberto = desenharFio(pedido())
    const fechado = desenharFio(pedido({ abertura: 0.55 }))
    assert.ok(afastamento(fechado) < afastamento(aberto) * 0.8)
    for (const no of fechado.nos) for (const f of fechado.fibras) assert.ok(f.includes(`${fmt(no.x)} ${fmt(no.y)}`))
    assert.deepEqual(desenharFio(pedido({ abertura: 5 })), desenharFio(pedido({ abertura: 1 })), 'abertura passa de 1 não estoura a área')
  })

  it('cada nó leva o texto do que foi feito, para a dica ao passar o mouse', () => {
    const d = desenharFio(pedido({ nos: [{ quando: dia(1), tipo: 'tarefa', texto: 'Checkout com Pix' }, { quando: dia(2), tipo: 'registro' }] }))
    assert.deepEqual(d.nos.map(n => n.texto), ['Checkout com Pix', ''])
  })

  it('a versão pequena usa a mesma regra em outra escala', () => {
    const d = desenharFio(pedido({ largura: 120, altura: 40, fibras: 7, pontasSoltas: 0 }))
    assert.equal(d.largura, 120)
    assert.equal(d.fibras.length, 7)
    assert.ok(d.fimDoTrancado <= 120)
  })
})

describe('fio do projeto: rótulo curto da data', () => {
  it('dia e mês abreviado, no fuso do dono', () => {
    assert.equal(rotuloCurtoDaData('2026-10-31T15:00:00.000Z'), '31 out')
    assert.equal(rotuloCurtoDaData('2026-09-01T02:00:00.000Z'), '31 ago', '23h em São Paulo ainda é dia 31')
    assert.equal(rotuloCurtoDaData('2026-01-05T12:00:00.000Z'), '05 jan')
  })

  it('data que não se lê fica sem rótulo', () => {
    assert.equal(rotuloCurtoDaData('ontem'), '')
    assert.equal(rotuloCurtoDaData(''), '')
  })
})

describe('fio do projeto: régua dos meses', () => {
  const desenho = (datas: string[]) => desenharFio(pedido({ nos: datas.map(quando => ({ quando, tipo: 'registro' as const })), pontasSoltas: 0 }))

  it('marca cada virada de mês entre o primeiro e o último nó, no lugar certo da trança', () => {
    const d = desenho(['2026-09-05T15:00:00Z', '2026-10-20T15:00:00Z', '2026-11-10T15:00:00Z'])
    const marcas = marcasDosMeses(d.nos)
    assert.deepEqual(marcas.map(m => m.rotulo), ['out', 'nov'])
    assert.ok(marcas[0]!.x > d.nos[0]!.x && marcas[0]!.x < d.nos[1]!.x, 'outubro começa entre o nó de setembro e o de outubro')
    assert.ok(marcas[1]!.x > d.nos[1]!.x && marcas[1]!.x < d.nos[2]!.x)
  })

  it('janeiro leva o ano, para não confundir a virada', () => {
    const d = desenho(['2026-12-20T15:00:00Z', '2027-01-15T15:00:00Z'])
    assert.deepEqual(marcasDosMeses(d.nos).map(m => m.rotulo), ['jan 27'])
  })

  it('no máximo 8 marcas, espaçadas, em projetos longos', () => {
    const datas = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2025, i, 10, 15)).toISOString())
    const marcas = marcasDosMeses(desenho(datas).nos)
    assert.ok(marcas.length <= 8 && marcas.length >= 6, `marcas: ${marcas.length}`)
    for (let i = 1; i < marcas.length; i++) assert.ok(marcas[i]!.x > marcas[i - 1]!.x)
  })

  it('sem régua quando não há tempo para medir: um nó só, datas ilegíveis ou tudo no mesmo mês', () => {
    assert.deepEqual(marcasDosMeses(desenho(['2026-10-01T15:00:00Z']).nos), [])
    assert.deepEqual(marcasDosMeses(desenho(['ontem', 'hoje']).nos), [])
    assert.deepEqual(marcasDosMeses(desenho(['2026-10-02T15:00:00Z', '2026-10-28T15:00:00Z']).nos), [])
  })
})

describe('fio do projeto: régua dos meses nas bordas', () => {
  it('nó exatamente na meia-noite da virada (fuso do dono) marca o mês em cima do nó', () => {
    const d = desenharFio(pedido({ nos: [{ quando: '2026-10-20T15:00:00Z', tipo: 'registro' }, { quando: '2026-11-01T03:00:00Z', tipo: 'registro' }], pontasSoltas: 0 }))
    const marcas = marcasDosMeses(d.nos)
    assert.equal(marcas.length, 1)
    assert.equal(marcas[0]!.rotulo, 'nov')
    assert.ok(Math.abs(marcas[0]!.x - d.nos[1]!.x) < 0.001)
  })

  it('dois nós no mesmo instante da virada não dividem por zero', () => {
    const d = desenharFio(pedido({ nos: [{ quando: '2026-10-20T15:00:00Z', tipo: 'registro' }, { quando: '2026-11-01T03:00:00Z', tipo: 'registro' }, { quando: '2026-11-01T03:00:00Z', tipo: 'tarefa' }], pontasSoltas: 0 }))
    const marcas = marcasDosMeses(d.nos)
    assert.equal(marcas.length, 1)
    assert.ok(Number.isFinite(marcas[0]!.x))
  })
})
