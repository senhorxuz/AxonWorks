import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NOS_NA_MINIATURA, diasDaCarta, nomeDoTipo, nosDaMiniatura, pontasDaCarta, quaisRotular, resumoDosDias } from '../src/fio/dados.ts'
import type { Carta, ItemFeito } from '../shared/carta.ts'

const item = (id: string, quando: string, origem: ItemFeito['origem'] = 'registro'): ItemFeito => ({ id, quando, origem, texto: `feito ${id}` })
const carta = (extra: Partial<Carta> = {}): Carta => ({
  projeto: { id: 'p', nome: 'P', objetivo: '' }, ultimaAtividade: null, diasParado: null, emUmaFrase: null,
  feitoRecente: [], feitoPorMes: [],
  falta: { precisa_de_voce: [], travado: [], em_andamento: [], a_fazer: [], ideias: [] },
  rascunhoAutomatico: null, salvamentos: [], ultimoRegistroEhSalvamento: false, ...extra,
} as Carta)

describe('fio do projeto: um nó por dia', () => {
  it('junta tudo o que foi feito no mesmo dia (fuso de São Paulo), do dia mais antigo ao mais novo', () => {
    const dias = diasDaCarta(carta({
      feitoRecente: [item('4', '2026-10-30T18:00:00Z', 'tarefa'), item('3', '2026-10-30T12:00:00Z')],
      feitoPorMes: [{ mes: '2026-10', itens: [item('2', '2026-10-25T02:30:00Z', 'cartao'), item('1', '2026-10-24T15:00:00Z')] }],
    }))
    assert.equal(dias.length, 2, '02h30 UTC do dia 25 ainda é dia 24 em São Paulo')
    assert.deepEqual(dias.map(d => d.quantidade), [2, 2])
    assert.deepEqual(dias.map(d => d.dia), ['2026-10-24', '2026-10-30'])
  })

  it('o nó do dia leva o instante mais recente daquele dia e a lista do que foi feito, mais novo primeiro', () => {
    const [dia] = diasDaCarta(carta({ feitoRecente: [item('a', '2026-10-30T12:00:00Z'), item('b', '2026-10-30T18:00:00Z')] }))
    assert.equal(dia!.quando, '2026-10-30T18:00:00Z')
    assert.deepEqual(dia!.itens, ['feito b', 'feito a'])
  })

  it('o tipo do nó é o mais importante do dia: entrega, depois cartão, depois registro', () => {
    const tipo = (...origens: ItemFeito['origem'][]) => diasDaCarta(carta({ feitoRecente: origens.map((o, i) => item(String(i), `2026-10-30T1${i}:00:00Z`, o)) }))[0]!.tipo
    assert.equal(tipo('registro', 'tarefa', 'cartao'), 'tarefa')
    assert.equal(tipo('registro', 'cartao'), 'cartao')
    assert.equal(tipo('registro'), 'registro')
  })

  it('sem nada feito, nenhum dia', () => {
    assert.deepEqual(diasDaCarta(carta()), [])
  })
})

describe('fio do projeto: fios soltos com nome', () => {
  it('um fio por grupo de pendência que tem algo, na ordem de importância', () => {
    const falta = { precisa_de_voce: [{}, {}], travado: [{}], em_andamento: [], a_fazer: [{}], ideias: [{}, {}, {}] }
    assert.deepEqual(pontasDaCarta(carta({ falta } as unknown as Partial<Carta>)), [
      { grupo: 'precisa_de_voce', rotulo: 'Precisa de você', quantidade: 2, destaque: 'brasa' },
      { grupo: 'travado', rotulo: 'Travado', quantidade: 1, destaque: 'perigo' },
      { grupo: 'a_fazer', rotulo: 'A fazer', quantidade: 1, destaque: 'neutro' },
      { grupo: 'ideias', rotulo: 'Ideias', quantidade: 3, destaque: 'neutro' },
    ])
    assert.deepEqual(pontasDaCarta(carta()), [])
  })

  it('em andamento também tem nome', () => {
    const falta = { precisa_de_voce: [], travado: [], em_andamento: [{}], a_fazer: [], ideias: [] }
    assert.equal(pontasDaCarta(carta({ falta } as unknown as Partial<Carta>))[0]!.rotulo, 'Em andamento')
  })

  it('o nome de cada tipo de nó, para a dica', () => {
    assert.equal(nomeDoTipo('registro'), 'Registro')
    assert.equal(nomeDoTipo('tarefa'), 'Entrega')
    assert.equal(nomeDoTipo('cartao'), 'Cartão concluído')
  })
})

describe('fio do projeto: legenda', () => {
  const dia = (quantidade: number) => ({ dia: '2026-10-30', quando: '2026-10-30T10:00:00Z', tipo: 'registro' as const, quantidade, itens: [] })
  const precisa = (quantidade: number) => ({ grupo: 'precisa_de_voce' as const, rotulo: 'Precisa de você', quantidade, destaque: 'brasa' as const })

  it('quanto foi feito, em quantos dias, e quanto precisa do dono', () => {
    assert.equal(resumoDosDias([dia(40), dia(30)], [precisa(23)]), '70 coisas feitas em 2 dias · 23 precisam de você')
  })

  it('singulares e sem pendência do dono', () => {
    assert.equal(resumoDosDias([dia(1)], [precisa(1)]), '1 coisa feita em 1 dia · 1 precisa de você')
    assert.equal(resumoDosDias([dia(3)], [{ grupo: 'ideias', rotulo: 'Ideias', quantidade: 4, destaque: 'neutro' }]), '3 coisas feitas em 1 dia')
  })

  it('sem nada feito, diz que o fio ainda vai começar', () => {
    assert.equal(resumoDosDias([], []), 'Nada feito ainda: o fio começa no primeiro registro')
  })
})

describe('fio do projeto: miniatura da lista', () => {
  it(`um nó por versão salva, até ${NOS_NA_MINIATURA}`, () => {
    assert.equal(nosDaMiniatura(3).length, 3)
    assert.equal(nosDaMiniatura(80).length, NOS_NA_MINIATURA)
    assert.equal(nosDaMiniatura(0).length, 0)
    assert.equal(nosDaMiniatura(-1).length, 0)
    assert.ok(nosDaMiniatura(2).every(n => n.tipo === 'registro'))
  })
})

describe('fio do projeto: quais rótulos cabem', () => {
  it('o último sempre aparece; os outros só se ficarem longe o bastante do vizinho já escolhido', () => {
    // Do fim para o começo: 50 sempre; 31 (longe de 50); 30 não (colado no 31); 12 sim; 10 não; 0 sim.
    assert.deepEqual(quaisRotular([0, 10, 12, 30, 31, 50], 8), [0, 2, 4, 5])
  })

  it('todos cabem quando estão espaçados', () => {
    assert.deepEqual(quaisRotular([0, 20, 40], 8), [0, 1, 2])
  })

  it('lista vazia ou de um só', () => {
    assert.deepEqual(quaisRotular([], 8), [])
    assert.deepEqual(quaisRotular([5], 8), [0])
  })

  it('o rótulo do fim ("onde paramos · data") é mais largo: o vizinho dele precisa de folga maior, os outros não', () => {
    // 50 sempre; 40 fica a 10 do fim (menos que 15): sai; 31 fica a 19: entra; 22 fica a 9 do 31 (mais que 8): entra.
    assert.deepEqual(quaisRotular([22, 31, 40, 50], 8, 15), [0, 1, 3])
    // Exatamente na folga do fim também entra.
    assert.deepEqual(quaisRotular([35, 50], 8, 15), [0, 1])
  })
})
